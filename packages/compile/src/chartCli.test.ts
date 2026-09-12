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
import { parseChartArgs, resolveChartCliOutput, runChart } from "./chartCli";

const SPEC = [3, 5, 2, 8];

describe("resolveChartCliOutput", () => {
  it("TTY with no --color override renders ANSI (contains an SGR escape)", () => {
    const out = resolveChartCliOutput(SPEC, {}, { isTTY: true });
    expect(out).toContain("\x1b[");
  });

  it("a pipe (isTTY: false) with no --color override renders plain text (no ESC byte)", () => {
    const out = resolveChartCliOutput(SPEC, {}, { isTTY: false });
    expect(out).not.toContain("\x1b");
  });

  it("--color always overrides the TTY-derived default, either direction", () => {
    const forcedNone = resolveChartCliOutput(SPEC, { color: "none" }, { isTTY: true });
    expect(forcedNone).not.toContain("\x1b");
    const forcedAnsi = resolveChartCliOutput(SPEC, { color: "truecolor" }, { isTTY: false });
    expect(forcedAnsi).toContain("\x1b[");
  });

  it("NO_COLOR in the injected env suppresses ANSI on a TTY", () => {
    const out = resolveChartCliOutput(SPEC, {}, { isTTY: true, vars: { NO_COLOR: "1" } });
    expect(out).not.toContain("\x1b");
  });

  it("honours --target/--charset/--width/--height overrides", () => {
    const out = resolveChartCliOutput(SPEC, { target: "chat", charset: "ascii", width: 20, height: 8 }, { isTTY: true });
    expect(out).toMatch(/^[\x20-\x7e\n]*$/);
    expect(out.split("\n")[0]!.length).toBe(20);
  });

  // Gate: "literal <>& survives text and is escaped in HTML" — the CLI's
  // own text exit is the raw encoder (see `render.ts`'s own web-target
  // test for the HTML half; the CLI never emits HTML).
  it("a literal <, >, & in a title survives the CLI's raw text output unescaped", () => {
    const spec = { marks: [{ type: "line", data: SPEC, channels: {} }], title: "<a>&b" } as unknown as GlyphChartInput;
    const out = resolveChartCliOutput(spec, { target: "chat", width: 30, height: 10 }, { isTTY: false });
    expect(out).toContain("<a>&b");
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

  // Mutation: let a missing spec silently return, or exit zero after a read failure.
  it("reports a missing spec file and exits 1", async () => {
    const exit = vi.spyOn(process, "exit").mockImplementation((status) => { throw Object.assign(new Error("exit"), { status }); });
    await expect(runChart([join(directory, "missing.json")])).rejects.toMatchObject({ status: 1 });
    expect(exit).toHaveBeenCalledWith(1);
    const diagnostic = vi.mocked(process.stderr.write).mock.calls.flat().join("");
    expect(diagnostic).toContain("ENOENT");
    expect(diagnostic).toContain("missing.json");
  });
});
