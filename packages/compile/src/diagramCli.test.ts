import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseGlyphDiagramArgs, resolveGlyphDiagramCliOutput, runGlyphDiagram } from "./diagramCli";

const MERMAID = "flowchart LR; input[Input] --> output[Output]";
const GRAPH = { nodes: [{ id: "input", label: "Input" }, { id: "output", label: "Output" }], edges: [{ from: "input", to: "output" }] };

describe("diagram CLI output defaults", () => {
  it("renders ANSI for TTY output and plain text for a pipe", async () => {
    const tty = await resolveGlyphDiagramCliOutput(MERMAID, {}, { isTTY: true });
    const pipe = await resolveGlyphDiagramCliOutput(MERMAID, {}, { isTTY: false });
    expect(tty).toContain("\x1b[");
    expect(pipe).not.toContain("\x1b");
    expect(pipe).toContain("Input");
    expect(pipe).toContain("Output");
  });

  it("lets explicit color override either output destination", async () => {
    expect(await resolveGlyphDiagramCliOutput(MERMAID, { color: "none" }, { isTTY: true })).not.toContain("\x1b");
    expect(await resolveGlyphDiagramCliOutput(MERMAID, { color: "truecolor" }, { isTTY: false })).toContain("\x1b[");
  });

  it("forwards NO_COLOR and FORCE_COLOR without interpreting the flags again", async () => {
    expect(await resolveGlyphDiagramCliOutput(MERMAID, {}, { isTTY: true, vars: { NO_COLOR: "0" } })).not.toContain("\x1b");
    expect(await resolveGlyphDiagramCliOutput(MERMAID, {}, { isTTY: true, vars: { NO_COLOR: "1", FORCE_COLOR: "0" } })).toContain("\x1b[");
  });

  it("preserves literal text while the explicit CSS exit escapes HTML", async () => {
    const source = "flowchart LR; A[\"<a>&b\"] --> B[Done]";
    const plain = await resolveGlyphDiagramCliOutput(source, { target: "chat", color: "none", width: 60, height: 20 }, { isTTY: false });
    const html = await resolveGlyphDiagramCliOutput(source, { target: "web", color: "css", width: 60, height: 20 }, { isTTY: false });
    expect(plain).toContain("<a>&b");
    expect(html).toContain("&lt;a&gt;&amp;b");
    expect(html).not.toContain("<a>");
  });
});

describe("diagram CLI argument and file boundary", () => {
  let directory: string;
  let mermaidFile: string;
  let jsonFile: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "glyph-diagram-cli-"));
    mermaidFile = join(directory, "graph.mmd");
    jsonFile = join(directory, "graph.json");
    await writeFile(mermaidFile, MERMAID);
    await writeFile(jsonFile, JSON.stringify(GRAPH));
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(directory, { recursive: true, force: true });
  });

  it("parses every declared option and preserves fractional sizes for validation", () => {
    expect(parseGlyphDiagramArgs([mermaidFile, "--target", "chat", "--charset", "ascii", "--color", "none", "--width", "60.5", "--height", "20", "--direction", "BT", "--engine", "dagre", "--nodesep", "3", "--ranksep", "4", "--title", "Pipeline", "--detail", "faithful", "--out", "graph.txt"]))
      .toEqual({ file: mermaidFile, out: "graph.txt", opts: { target: "chat", charset: "ascii", color: "none", width: 60.5, height: 20, direction: "BT", engine: "dagre", nodesep: 3, ranksep: 4, title: "Pipeline", detail: "faithful" } });
  });

  it.each(["mmd", "json"])("renders an actual %s file into an exact ASCII picture", async (kind) => {
    const output = join(directory, `${kind}.txt`);
    await runGlyphDiagram([kind === "mmd" ? mermaidFile : jsonFile, "--direction", "LR", "--charset", "ascii", "--color", "none", "--width", "60", "--height", "20", "-o", output]);
    const text = await readFile(output, "utf8");
    expect(text).toMatch(/^[\x20-\x7e\n]*$/);
    expect(text.split("\n").map((line) => line.length)).toEqual(Array(20).fill(60));
    expect(text).toContain("Input");
    expect(text).toContain("Output");
    expect(text).toContain(">");
  });

  it("keeps the fidelity ledger on stderr and the diagram on stdout", async () => {
    const oversized = { nodes: Array.from({ length: 10 }, (_, index) => ({ id: `n${index}`, label: `Node ${index}` })), edges: [] };
    await writeFile(jsonFile, JSON.stringify(oversized));
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await runGlyphDiagram([jsonFile, "--color", "none", "--width", "60", "--height", "20"]);
    const diagnostic = vi.mocked(process.stderr.write).mock.calls.flat().join("");
    const picture = stdout.mock.calls.flat().join("");
    expect(diagnostic).toMatch(/budget|split|collapse|decoration/i);
    expect(picture).toContain("Node");
    expect(picture).not.toContain("glyphcss:");
  });

  it("rejects fractional width with bad-size and exit 1", async () => {
    const exit = vi.spyOn(process, "exit").mockImplementation((status) => { throw Object.assign(new Error("exit"), { status }); });
    await expect(runGlyphDiagram([mermaidFile, "--width", "60.5"])).rejects.toMatchObject({ status: 1 });
    expect(exit).toHaveBeenCalledWith(1);
    expect(vi.mocked(process.stderr.write).mock.calls.flat().join("")).toContain("bad-size");
  });

  it("preserves an unsupported Mermaid kind rule across the command boundary", async () => {
    await writeFile(mermaidFile, "sequenceDiagram\n A->>B: Hello");
    vi.spyOn(process, "exit").mockImplementation((status) => { throw Object.assign(new Error("exit"), { status }); });
    await expect(runGlyphDiagram([mermaidFile])).rejects.toMatchObject({ status: 1 });
    expect(vi.mocked(process.stderr.write).mock.calls.flat().join("")).toContain("GLYPH_MERMAID_UNSUPPORTED_SEQUENCEDIAGRAM");
  });

  it("reports a missing input file and exits 1", async () => {
    vi.spyOn(process, "exit").mockImplementation((status) => { throw Object.assign(new Error("exit"), { status }); });
    await expect(runGlyphDiagram([join(directory, "missing.mmd")])).rejects.toMatchObject({ status: 1 });
    expect(vi.mocked(process.stderr.write).mock.calls.flat().join("")).toContain("ENOENT");
  });

  it("tags malformed JSON input with GLYPH_DIAGRAM_BAD_JSON and exits 1", async () => {
    await writeFile(jsonFile, "{");
    vi.spyOn(process, "exit").mockImplementation((status) => { throw Object.assign(new Error("exit"), { status }); });
    // Mutation: parse the .json file with a bare JSON.parse instead of the
    // tagged parseGlyphDiagramJson -> the printed message loses its code
    // prefix (a native SyntaxError has no `.code`).
    await expect(runGlyphDiagram([jsonFile])).rejects.toMatchObject({ status: 1 });
    expect(vi.mocked(process.stderr.write).mock.calls.flat().join("")).toContain("GLYPH_DIAGRAM_BAD_JSON");
  });

  it.each([["--charset", "bad"], ["--engine", "elk"], ["--width"], ["--unknown"], ["--direction", "TD"]])("rejects malformed options %j before rendering", (arguments_) => {
    expect(() => parseGlyphDiagramArgs([mermaidFile, ...arguments_])).toThrow(expect.objectContaining({ code: "bad-options" }));
  });
});
