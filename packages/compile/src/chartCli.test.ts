/**
 * `glyphcss chart` output-format selection (PLAN.md Phase 1 gate: "CLI: TTY
 * -> ANSI, pipe -> text, exercised through a pseudo-TTY in the test, not a
 * flag"). A REAL pty was impractical here (no `node-pty`/pty-mocking
 * dependency in this repo, and adding one for a single gate is out of
 * scope) — so `resolveChartCliOutput` takes `isTTY` as an explicit
 * parameter instead of reading `process.stdout.isTTY` itself, making the
 * TTY/pipe branch a plain, dependency-injected unit test rather than
 * something only a real terminal can prove. `runChart` (the actual CLI
 * entry, invoked from `cli.ts`'s `main()`) passes the real
 * `process.stdout.isTTY` through unchanged.
 */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GlyphChartInput } from "@glyphcss/charts";
import type { GlyphChart3dJsonInput } from "@glyphcss/charts/3d";
import { parseChartArgs, resolveChart3dCliOutput, resolveChartCliOutput, runChart } from "./chartCli";

const SPEC = [3, 5, 2, 8];

describe("resolveChartCliOutput", () => {
  it("TTY with no --color override renders ANSI (contains an SGR escape)", () => {
    const { text: out } = resolveChartCliOutput(SPEC, {}, { isTTY: true });
    expect(out).toContain("\x1b[");
  });

  it("a pipe (isTTY: false) with no --color override renders plain text (no ESC byte)", () => {
    const { text: out } = resolveChartCliOutput(SPEC, {}, { isTTY: false });
    expect(out).not.toContain("\x1b");
  });

  it("--color always overrides the TTY-derived default, either direction", () => {
    const { text: forcedNone } = resolveChartCliOutput(SPEC, { color: "none" }, { isTTY: true });
    expect(forcedNone).not.toContain("\x1b");
    const { text: forcedAnsi } = resolveChartCliOutput(SPEC, { color: "truecolor" }, { isTTY: false });
    expect(forcedAnsi).toContain("\x1b[");
  });

  it("NO_COLOR in the injected env suppresses ANSI on a TTY", () => {
    const { text: out } = resolveChartCliOutput(SPEC, {}, { isTTY: true, vars: { NO_COLOR: "1" } });
    expect(out).not.toContain("\x1b");
  });

  it("honours --target/--charset/--width/--height overrides", () => {
    const { text: out } = resolveChartCliOutput(SPEC, { target: "chat", charset: "ascii", width: 20, height: 8 }, { isTTY: true });
    expect(out).toMatch(/^[\x20-\x7e\n]*$/);
    expect(out.split("\n")[0]!.length).toBe(20);
  });

  // Gate: "literal <>& survives text and is escaped in HTML" — the CLI's
  // own text exit is the raw encoder (see `render.ts`'s own web-target
  // test for the HTML half; the CLI never emits HTML).
  it("a literal <, >, & in a title survives the CLI's raw text output unescaped", () => {
    const spec = { marks: [{ type: "line", data: SPEC, channels: {} }], title: "<a>&b" } as unknown as GlyphChartInput;
    const { text: out } = resolveChartCliOutput(spec, { target: "chat", width: 30, height: 10 }, { isTTY: false });
    expect(out).toContain("<a>&b");
  });
});

function volcano(rows = 8, cols = 8): number[][] {
  const z = Array.from({ length: rows }, () => new Array(cols).fill(0));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const dr = r - (rows - 1) / 2, dc = c - (cols - 1) / 2;
      z[r]![c] = Math.max(0, 30 - (dr * dr + dc * dc));
    }
  }
  return z;
}

describe("--3d: parseChartArgs and resolveChart3dCliOutput", () => {
  it("parses --3d and --camera rotX,rotY,zoom", () => {
    expect(parseChartArgs(["spec.json", "--3d", "--camera", "50,-30,12"])).toEqual({
      file: "spec.json",
      out: undefined,
      opts: { threeD: true, camera: { rotX: 50, rotY: -30, zoom: 12 } },
    });
  });

  it("parses --camera with only rotX,rotY (auto-fit zoom)", () => {
    expect(parseChartArgs(["spec.json", "--3d", "--camera", "50,-30"])).toEqual({
      file: "spec.json",
      out: undefined,
      opts: { threeD: true, camera: { rotX: 50, rotY: -30 } },
    });
  });

  it("parses --style and rejects it without --3d", () => {
    expect(parseChartArgs(["spec.json", "--3d", "--style", "wireframe"])).toEqual({
      file: "spec.json",
      out: undefined,
      opts: { threeD: true, style: "wireframe" },
    });
    expect(() => parseChartArgs(["spec.json", "--style", "wireframe"])).toThrow(expect.objectContaining({ code: "bad-3d-flag" }));
    expect(() => parseChartArgs(["spec.json", "--3d", "--style", "bogus"])).toThrow(expect.objectContaining({ code: "bad-style-arg" }));
  });

  // P1-4 (codex review, round 6): `parseCameraArg`/`parseStyleArg` used to
  // accept a missing argument as `undefined` (silently no-op'd, rather than
  // an error) and `Number("")` (an empty comma field) as a plausible-looking
  // `0` — both examples from the review, reproduced here as pure
  // `parseChartArgs` cases (no file I/O needed).
  describe("strict argument parsing (P1-4)", () => {
    it("--camera 10, (a trailing empty field) rejects with bad-camera-arg, never a silent rotY: 0", () => {
      expect(() => parseChartArgs(["spec.json", "--3d", "--camera", "10,"])).toThrow(expect.objectContaining({ code: "bad-camera-arg" }));
    });

    it("--camera ,  (both fields empty) rejects with bad-camera-arg, never a silent {rotX:0, rotY:0}", () => {
      expect(() => parseChartArgs(["spec.json", "--3d", "--camera", ","])).toThrow(expect.objectContaining({ code: "bad-camera-arg" }));
    });

    it("--camera with no following value rejects with bad-camera-arg, never a silent no-op", () => {
      expect(() => parseChartArgs(["spec.json", "--3d", "--camera"])).toThrow(expect.objectContaining({ code: "bad-camera-arg" }));
    });

    it("--camera with no following value AND no --3d still rejects (a thrown parse error, not a silent no-op)", () => {
      expect(() => parseChartArgs(["spec.json", "--camera"])).toThrow(expect.objectContaining({ code: "bad-camera-arg" }));
    });

    it("--style with no following value rejects with bad-style-arg, never a silent no-op", () => {
      expect(() => parseChartArgs(["spec.json", "--3d", "--style"])).toThrow(expect.objectContaining({ code: "bad-style-arg" }));
    });

    it("--style without --3d rejects regardless of its value — a flag's PRESENCE is what's tested, not the parsed value's definedness", () => {
      expect(() => parseChartArgs(["spec.json", "--style", "solid"])).toThrow(expect.objectContaining({ code: "bad-3d-flag" }));
    });
  });

  it("--style wireframe renders real braille-capable wireframe output, distinct from the solid default", () => {
    const input: GlyphChart3dJsonInput = { data: { z: volcano() } };
    const solid = resolveChart3dCliOutput(input, { target: "web", color: "none", charset: "ascii" }, { isTTY: false });
    const wireframe = resolveChart3dCliOutput(input, { target: "web", color: "none", charset: "ascii", style: "wireframe" }, { isTTY: false });
    expect(wireframe.text).not.toBe(solid.text);
  });

  it("renders a 3D surface spec, with axis titles surviving in plain text", () => {
    const input: GlyphChart3dJsonInput = { data: { z: volcano() }, options: { axes: { x: { title: "x" }, y: { title: "y" }, z: { title: "z" } } } };
    const { text } = resolveChart3dCliOutput(input, { target: "web", color: "none" }, { isTTY: false });
    for (const title of ["x", "y", "z"]) expect(text.includes(title)).toBe(true);
  });

  // Fix round 1, P1-3: `--color none` with NO explicit `options.shading`
  // must default to `shading: "value"` (§5) — the model step
  // (`glyphChartSurface`) no longer bakes in `"relief"` itself
  // (`surface.ts`), so `renderGlyphChart3d` resolves the default from ITS
  // OWN colour mode. Proven two ways: the defaulted render is BYTE-IDENTICAL
  // to an explicit `shading: "value"` render (same computation), and
  // DIFFERENT from an explicit `shading: "relief"` one (mutation: reverting
  // the default collapses this to the relief render instead).
  it("--3d --color none with no explicit shading defaults to shading: value", () => {
    // `charset: "ascii"` (fix round 2's own `style` option): the default
    // `target: "web"` charset is `braille`, which now auto-resolves to
    // `style: "wireframe"` (the SAME round's "braille renders, not
    // downgrades" fix) — a wireframe line has no fill face to texture, so
    // `shading: "value"` is a no-op there and would collapse this test's
    // own value-vs-relief distinction to nothing. This test is about
    // `shading`'s own default, which is a SOLID-render concept.
    const base: GlyphChart3dJsonInput = { data: { z: volcano() } };
    const opts = { target: "web" as const, color: "none" as const, charset: "ascii" as const };
    const defaulted = resolveChart3dCliOutput(base, opts, { isTTY: false });
    const explicitValue = resolveChart3dCliOutput({ ...base, options: { shading: "value" } }, opts, { isTTY: false });
    const explicitRelief = resolveChart3dCliOutput({ ...base, options: { shading: "relief" } }, opts, { isTTY: false });
    expect(defaulted.text).toBe(explicitValue.text);
    expect(defaulted.text).not.toBe(explicitRelief.text);
  });

  it("--camera overrides the auto-fit default", () => {
    const input: GlyphChart3dJsonInput = { data: { z: volcano() } };
    const fitted = resolveChart3dCliOutput(input, { target: "web", color: "none" }, { isTTY: false });
    const fixed = resolveChart3dCliOutput(input, { target: "web", color: "none", camera: { rotX: 65, rotY: 45, zoom: 0.65 } }, { isTTY: false });
    const nonBlank = (s: string) => s.replace(/\s/g, "").length;
    expect(nonBlank(fixed.text)).toBeLessThan(nonBlank(fitted.text) / 3);
  });
});

describe("chart CLI argument parsing and command boundary", () => {
  let directory: string;
  let file: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "glyph-chart-cli-"));
    file = join(directory, "spec.json");
    await writeFile(file, JSON.stringify({ marks: [{ type: "bar", data: [-1, 1], channels: {} }] }));
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(directory, { recursive: true, force: true });
  });

  // Mutation: ignore a CLI flag or round a fractional width while parsing it.
  it("parses every chart output option from argv without rounding width", () => {
    expect(parseChartArgs([file, "--target", "chat", "--charset", "ascii", "--color", "none", "--width", "20.5", "--height", "6", "--out", "chart.txt"]))
      .toEqual({ file, out: "chart.txt", opts: { target: "chat", charset: "ascii", color: "none", width: 20.5, height: 6 } });
  });

  // Mutation: drop --charset during argument parsing/forwarding, or emit a Unicode minus on negative data.
  it("runs --charset ascii on negative bars and writes an exact 20×6 ASCII picture", async () => {
    const outputFile = join(directory, "chart.txt");
    await runChart([file, "--charset", "ascii", "--color", "none", "--width", "20", "--height", "6", "-o", outputFile]);
    const output = await readFile(outputFile, "utf8");
    expect(output).toMatch(/^[\x20-\x7e\n]*$/);
    expect(output).toMatch(/^ *-\d/m);
    expect(output.split("\n").map((line) => line.length)).toEqual(Array(6).fill(20));
    expect(output).toMatch(/[#@]/);
  });

  // Mutation: accept/round --width 20.5, suppress the rule id at the CLI boundary, or report success on validation failure.
  it("rejects --width 20.5 with bad-size and exit 1", async () => {
    const exit = vi.spyOn(process, "exit").mockImplementation((status) => { throw Object.assign(new Error("exit"), { status }); });
    await expect(runChart([file, "--width", "20.5", "--height", "6"]))
      .rejects.toMatchObject({ status: 1 });
    expect(exit).toHaveBeenCalledWith(1);
    expect(vi.mocked(process.stderr.write).mock.calls.flat().join("")).toContain("bad-size");
  });

  // Final-gate-2 review (both P2 #5/#10): the diagram CLI prints its
  // fidelity ledger to stderr; the chart CLI discarded `report` entirely.
  // Reproduces the review's exact input (a pie with a negative value, which
  // `paintArc` logs as `slice-dropped`).
  // Mutation: revert `runChart` to not loop over `ledger` -> stderr stays
  // empty even though a slice was silently dropped -> red.
  it("prints report.ledger entries to stderr, exactly like the diagram CLI", async () => {
    const pieFile = join(directory, "pie.json");
    await writeFile(pieFile, JSON.stringify({ marks: [{ type: "arc", data: [-1, 5, 2], channels: {} }] }));
    await runChart([pieFile, "--width", "30", "--height", "10"]);
    const stderrText = vi.mocked(process.stderr.write).mock.calls.flat().join("");
    expect(stderrText).toContain("glyphcss: slice-dropped:");
  });

  // Mutation: let a missing spec silently return, or exit zero after a read failure.
  it("reports a missing spec file and exits 1", async () => {
    const exit = vi.spyOn(process, "exit").mockImplementation((status) => { throw Object.assign(new Error("exit"), { status }); });
    await expect(runChart([join(directory, "missing.json")])).rejects.toMatchObject({ status: 1 });
    expect(exit).toHaveBeenCalledWith(1);
    const diagnostic = vi.mocked(process.stderr.write).mock.calls.flat().join("");
    expect(diagnostic).toContain("ENOENT");
    expect(diagnostic).toContain("missing.json");
  });

  // Mutation: dispatch --3d to the 2D entry (or vice versa), or drop --camera.
  it("--3d dispatches to renderGlyphChart3d and writes a real frame", async () => {
    const surfaceFile = join(directory, "surface.json");
    await writeFile(surfaceFile, JSON.stringify({ data: { z: volcano() } } satisfies GlyphChart3dJsonInput));
    const outputFile = join(directory, "surface.txt");
    await runChart([surfaceFile, "--3d", "--target", "web", "--color", "none", "-o", outputFile]);
    const output = await readFile(outputFile, "utf8");
    expect(output.replace(/\s/g, "").length).toBeGreaterThan(40);
  });

  // Mutation: `--3d --charset braille` must render a REAL wireframe frame
  // now (fix round 2, USER FEEDBACK) rather than the old braille-unsupported
  // downgrade — never throws, never logs a downgrade ledger entry for it.
  it("--3d --charset braille renders a real wireframe frame with no downgrade ledger entry", async () => {
    const surfaceFile = join(directory, "surface2.json");
    await writeFile(surfaceFile, JSON.stringify({ data: { z: volcano() } } satisfies GlyphChart3dJsonInput));
    await runChart([surfaceFile, "--3d", "--charset", "braille", "--color", "none"]);
    const stderrText = vi.mocked(process.stderr.write).mock.calls.flat().join("");
    expect(stderrText).not.toContain("chart3d-braille-unsupported");
  });

  // Mutation: let --3d swallow renderGlyphChart3d's own tagged error code.
  it("--3d rejects bad surface data with its own tagged code and exit 1", async () => {
    const badFile = join(directory, "bad.json");
    await writeFile(badFile, JSON.stringify({ data: { z: [[0]] } } satisfies GlyphChart3dJsonInput));
    const exit = vi.spyOn(process, "exit").mockImplementation((status) => { throw Object.assign(new Error("exit"), { status }); });
    await expect(runChart([badFile, "--3d"])).rejects.toMatchObject({ status: 1 });
    expect(exit).toHaveBeenCalledWith(1);
    expect(vi.mocked(process.stderr.write).mock.calls.flat().join("")).toContain("surface-too-small");
  });

  // Fix round 1, P1-5: `--camera` requires exactly 2 or 3 FINITE fields, and
  // EVERY 3D-only flag rejects with a code + exit 1 when `--3d` is absent —
  // both used to be silently swallowed (a 1-field camera built a partial
  // `{rotX}` with no `rotY`; a 4-field one silently dropped the extra
  // field; `--camera` with no `--3d` just built an option `resolveChart3dCliOutput`
  // never even ran, since `opts.threeD` gated dispatch).
  describe("--camera validation (P1-5)", () => {
    it("--camera 10 (1 field) rejects with bad-camera-arg and exit 1", async () => {
      const exit = vi.spyOn(process, "exit").mockImplementation((status) => { throw Object.assign(new Error("exit"), { status }); });
      const surfaceFile = join(directory, "surface3.json");
      await writeFile(surfaceFile, JSON.stringify({ data: { z: volcano() } } satisfies GlyphChart3dJsonInput));
      await expect(runChart([surfaceFile, "--3d", "--camera", "10"])).rejects.toMatchObject({ status: 1 });
      expect(exit).toHaveBeenCalledWith(1);
      expect(vi.mocked(process.stderr.write).mock.calls.flat().join("")).toContain("bad-camera-arg");
    });

    it("--camera 10,20,3,4 (4 fields) rejects with bad-camera-arg and exit 1", async () => {
      const exit = vi.spyOn(process, "exit").mockImplementation((status) => { throw Object.assign(new Error("exit"), { status }); });
      const surfaceFile = join(directory, "surface4.json");
      await writeFile(surfaceFile, JSON.stringify({ data: { z: volcano() } } satisfies GlyphChart3dJsonInput));
      await expect(runChart([surfaceFile, "--3d", "--camera", "10,20,3,4"])).rejects.toMatchObject({ status: 1 });
      expect(exit).toHaveBeenCalledWith(1);
      expect(vi.mocked(process.stderr.write).mock.calls.flat().join("")).toContain("bad-camera-arg");
    });

    it("--camera 10,20 without --3d rejects with bad-3d-flag and exit 1", async () => {
      const exit = vi.spyOn(process, "exit").mockImplementation((status) => { throw Object.assign(new Error("exit"), { status }); });
      const surfaceFile = join(directory, "surface5.json");
      await writeFile(surfaceFile, JSON.stringify({ data: { z: volcano() } } satisfies GlyphChart3dJsonInput));
      await expect(runChart([surfaceFile, "--camera", "10,20"])).rejects.toMatchObject({ status: 1 });
      expect(exit).toHaveBeenCalledWith(1);
      expect(vi.mocked(process.stderr.write).mock.calls.flat().join("")).toContain("bad-3d-flag");
    });
  });
});
