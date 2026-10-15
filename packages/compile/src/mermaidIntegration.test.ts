import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { resolveGlyphDiagramCliOutput, runGlyphDiagram } from "./diagramCli";
// Source fixtures also feed the web examples; no bundled skill is regenerated.
const examples: { type: string; owner: string; source: string; labels: string[]; height: number }[] = JSON.parse(await readFile("src/fixtures/mermaidIntegration.json", "utf8"));
const records: { type: string; target: string; text: string }[] = [];

describe("one Mermaid CLI entry", () => {
  it.each(examples)("renders $type at 72 columns for chat and web", async ({ type, source, labels, height }) => {
    for (const target of ["chat", "web"] as const) {
      const text = await resolveGlyphDiagramCliOutput(source, { target, width: 72, height, color: "none" }, { isTTY: false });
      expect(text.trim()).not.toBe("");
      expect(Math.max(...text.split("\n").map(line => [...line].length))).toBeLessThanOrEqual(72);
      for (const label of labels) expect(text).toContain(label);
      records.push({ type, target, text });
      if (target === "chat") {
        const directory = await mkdtemp(join(tmpdir(), "glyph-mermaid-cli-"));
        const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
        try {
          await writeFile(`${directory}/input.mmd`, source);
          await runGlyphDiagram([`${directory}/input.mmd`, "--target", "chat", "--width", "72", "--height", String(height), "-o", `${directory}/output.txt`]);
          expect(await readFile(`${directory}/output.txt`, "utf8")).toBe(text);
        } finally { stderr.mockRestore(); await rm(directory, { recursive: true, force: true }); }
      }
    }
  });

  it.each([
    ["graph", "flowchart"], ["flowchart-elk", "flowchart"], ["classDiagram-v2", "classDiagram"], ["stateDiagram", "stateDiagram"], ["stateDiagram-v2", "stateDiagram"], ["block", "block"], ["block-beta", "block"],
    ["architecture", "architecture"], ["architecture-beta", "architecture"], ["xychart", "xychart"], ["xychart-beta", "xychart"], ["sankey", "sankey"], ["sankey-beta", "sankey"],
    ["radar", "radar"], ["radar-beta", "radar"], ["treemap", "treemap"], ["treemap-beta", "treemap"], ["packet", "packet"], ["packet-beta", "packet"],
  ])("routes the %s header alias", async (alias, type) => {
    const fixture = examples.find(row => row.type === type);
    const source = fixture.source.replace(/^[\w-]+/, alias);
    expect(await resolveGlyphDiagramCliOutput(source, { target: "chat", width: 72 }, { isTTY: false })).toContain(fixture.labels[0]);
  });

  it("detects sequence after BOM, frontmatter, comments and multiline inert init", async () => {
    const source = '\uFEFF---\ntitle: Example\n---\n%% comment\n%%{init: {\n "theme": "dark"\n}}%%\nsequenceDiagram\n A->>B: Hello';
    expect(await resolveGlyphDiagramCliOutput(source, { target: "chat" }, { isTTY: false })).toContain("Hello");
  });

  it("retains reader errors instead of falling through on malformed chart bodies", async () => {
    await expect(resolveGlyphDiagramCliOutput('pie\nnot a slice', {}, { isTTY: false })).rejects.toMatchObject({ code: "GLYPH_MERMAID_SYNTAX" });
    await expect(resolveGlyphDiagramCliOutput('unknownType\n"[{', {}, { isTTY: false })).rejects.toMatchObject({ code: "GLYPH_MERMAID_UNSUPPORTED_UNKNOWNTYPE" });
  });

  it("logs inapplicable options but still renders charts, sequences and Git history", async () => {
    const directory = await mkdtemp(join(tmpdir(), "glyph-integration-"));
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      for (const type of ["pie", "sequenceDiagram", "gitGraph"]) {
        const path = join(directory, `${type}.mmd`);
        await writeFile(path, examples.find(row => row.type === type).source);
        await runGlyphDiagram([path, "--target", "chat", "--direction", "RL", "--nodesep", "3", "--title", "Override"]);
        expect(stdout.mock.calls.flat().join("")).not.toContain("glyphcss:");
        expect(stderr.mock.calls.flat().join("")).toContain("mermaid-option-ignored");
        stderr.mockClear(); stdout.mockClear();
      }
    } finally { vi.restoreAllMocks(); await rm(directory, { recursive: true, force: true }); }
  });
});

afterAll(async () => {
  const path = process.env.GLYPH_INTEGRATION_ARTIFACT;
  if (!path) return;
  await mkdir(dirname(path), { recursive: true });
  const table = ["Type | CLI chat result", "--- | ---", ...examples.map(row => `${row.type} | ${records.some(record => record.type === row.type && record.target === "chat") ? "PASS" : "FAIL"}`)].join("\n");
  const body = examples.map(row => [`\n=== ${row.type} ===\nSOURCE\n${row.source}`, ...["chat", "web"].map(target => {
    const record = records.find(record => record.type === row.type && record.target === target);
    return `\n${target.toUpperCase()} 72 columns, height ${row.height} (${target === "chat" ? "box" : "braille"})\n${record?.text ?? "FAILED"}`;
  })].join("\n")).join("\n");
  await writeFile(path, table + "\n" + body + "\n");
});
