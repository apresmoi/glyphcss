import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderGlyphDiagram, renderGlyphDiagramJson } from "./render";
import { glyphDiagramRectsOverlap } from "./labels";
import { glyphGraphFromMermaid } from "./mermaid";
import { GLYPH_CANVAS_TIERS, GLYPH_CANVAS_QUADRANT_GLYPHS } from "glyphcss";

const fixture = (name: string) => readFileSync(resolve(__dirname, `../fixtures/${name}.mmd`), "utf8");
for (const name of ["chain", "diamond", "fan-out", "cycle", "subgraph"]) for (const charset of ["box", "ascii"] as const) {
  it(`${name} ${charset} matches its checked-in cell snapshot`, async () => {
    const options = { target: "chat" as const, width: 80, height: 32, charset };
    const result = await renderGlyphDiagram(fixture(name), options);
    expect(result.pages).toHaveLength(1); expect(result.report.unroutable).toEqual([]);
    expect(result.routes).toHaveLength(result.meta.edges.length);
    await expect(result.text).toMatchFileSnapshot(resolve(__dirname, `../fixtures/expected/${name}.${charset}.txt`));
    expect((await renderGlyphDiagram(fixture(name), options)).text).toBe(result.text);
    if (charset === "ascii") expect(result.text).toMatch(/^[\x20-\x7e\n]*$/);
  });
}

describe("render contracts", () => {
  it("uses vertical glyphs on single-cell box sides", async () => {
    const result = await renderGlyphDiagram("graph LR; A[Alpha] --> B[[Beta]]", { charset: "ascii" });
    for (const n of result.layout.nodes) {
      const target = result.layout.ports.some((p) => p.end === "to" && p.anchor.x === n.x0 && p.anchor.y === n.y0 + 1);
      expect(result.grid.char[(n.y0 + 1) * result.grid.cols + n.x0]).toBe(target ? ">" : "|");
      expect(result.grid.char[(n.y0 + 1) * result.grid.cols + n.x1]).toBe("|");
    }
  });
  it("renders the LangGraph agent fixture in one chat 60x20 panel", async () => {
    const result = await renderGlyphDiagram(fixture("langgraph"), { target: "chat", width: 60, height: 20 });
    expect(result.pages).toHaveLength(1); expect(result.routes).toHaveLength(4);
    expect(result.report.unroutable).toEqual([]);
    expect(result.text.split("\n")).toHaveLength(20);
    expect(result.text.split("\n").every((line) => line.length === 60)).toBe(true);
    expect(result.text).toContain("__start__"); expect(result.text).toContain("__end__");
    await expect(result.text).toMatchFileSnapshot(resolve(__dirname, "../fixtures/expected/langgraph.chat60x20.txt"));
  });
  it("all fixtures remain 7-bit under the ASCII policy, including non-ASCII authored text", async () => {
    for (const name of ["chain", "diamond", "fan-out", "cycle", "subgraph", "langgraph", "six-port"]) {
      const result = await renderGlyphDiagram(fixture(name), { charset: "ascii", width: 120, height: 50 });
      expect(result.text).toMatch(/^[\x20-\x7e\n]*$/);
    }
    const result = await renderGlyphDiagram('graph LR; A["café 漢字"] -->|"−…"| B["< & >"]', { charset: "ascii" });
    expect(result.text).toMatch(/^[\x20-\x7e\n]*$/); expect(result.report.ledger.some((entry) => entry.code === "label-folded")).toBe(true);
  });
  // Mutation: resolve junctions after arrowheads -> every destination loses its tip.
  it.each(["TB", "BT", "LR", "RL"] as const)("paints %s arrowheads on the target border after junction resolution and node fills", async (direction) => {
    const result = await renderGlyphDiagram(`graph ${direction}; A --> B`, { width: 60, height: 20, charset: "ascii" });
    expect(result.routes).toHaveLength(1);
    const last = result.layout.ports.find((p) => p.end === "to")!.anchor;
    const side = { TB: "s", BT: "n", LR: "e", RL: "w" }[direction] as "n" | "e" | "s" | "w";
    expect(result.grid.char[last.y * result.grid.cols + last.x]).toBe(GLYPH_CANVAS_TIERS.ascii.arrow[side]);
  });
  // Mutation: pass no obstacles into paint's label layout or paint node fills after labels -> red.
  it("real edge labels stay disjoint from painted nodes, routes and each other", async () => {
    for (const input of [fixture("diamond"), "graph TB; A -->|a label| B"]) {
      const result = await renderGlyphDiagram(input, { width: 80, height: 32 });
      expect(result.labels.some((label) => label.id.startsWith("edge:"))).toBe(true);
      const obstacles = [...result.layout.nodes, ...result.routes.flatMap((r) => r.cells.map((p) => ({ x0: p.x, y0: p.y, x1: p.x, y1: p.y })))];
      result.labels.forEach((label, i) => {
        [...obstacles, ...result.labels.slice(0, i)].forEach((rect) => expect(glyphDiagramRectsOverlap(label, rect)).toBe(false));
        expect(result.grid.char.slice(label.y * result.grid.cols + label.x, label.y * result.grid.cols + label.x + label.text.length).join("")).toBe(label.text);
      });
    }
  });
  it("uses fresh canvas storage for every render and retains prior results", async () => {
    const a = await renderGlyphDiagram(fixture("cycle"), { width: 80, height: 32 });
    const before = a.grid.char.join("");
    const b = await renderGlyphDiagram("graph LR; X", { width: 80, height: 32 });
    expect(b.grid).not.toBe(a.grid); expect(a.grid.char.join("")).toBe(before);
    expect(b.text).not.toContain("▼"); expect(b.text).toContain("X");
  });
  it("has separate raw, escaped HTML and explicit-environment ANSI exits", async () => {
    const input = 'graph LR; A["<tag> & text"]';
    const raw = await renderGlyphDiagram(input, { color: "none" });
    const html = await renderGlyphDiagram(input, { color: "css" });
    expect(raw.text).toContain("<tag> & text"); expect(html.text).toBe(raw.text);
    expect(html.html).toContain("&lt;tag&gt;"); expect(html.html).toContain("&amp;"); expect(html.html).not.toContain("<tag>");
    const ansi = await renderGlyphDiagram(input, { target: "terminal", color: "ansi16" });
    expect(ansi.text).toContain("\x1b[");
    expect((await renderGlyphDiagram(input, { target: "terminal", env: { NO_COLOR: "0" } })).text).not.toContain("\x1b[");
    expect((await renderGlyphDiagram(input, { target: "terminal", env: { NO_COLOR: "1", FORCE_COLOR: "0" } })).text).toContain("\x1b[");
  });
  it("reports only final unroutable edges after successful split recovery", async () => {
    const graph = glyphGraphFromMermaid("graph TB; A --> B --> C --> D --> E");
    const result = await renderGlyphDiagram(graph, { width: 60, height: 20, detail: "faithful" });
    expect(result.pages.length).toBeGreaterThan(1);
    expect(result.pages.flatMap((p) => p.routes)).toHaveLength(4);
    expect(result.report.unroutable).toEqual([]);
    expect(result.report.ledger.some((entry) => entry.code === "unroutable")).toBe(false);
  });
  it("places interleaved compound groups without enclosing an unrelated node", async () => {
    const graph = glyphGraphFromMermaid("graph LR; subgraph G1[Group 1]; A; C; end; subgraph G2[Group 2]; B; D; end; A --> B; C --> D");
    const result = await renderGlyphDiagram(graph, { width: 120, height: 60 });
    expect(result.pages).toHaveLength(1);
    for (const group of result.layout.groups) {
      const members = result.layout.nodes.filter((node) => group.members.includes(node.id));
      const bounds = { x0: Math.min(...members.map((n) => n.x0)) - 2, x1: Math.max(...members.map((n) => n.x1)) + 2, y0: Math.min(...members.map((n) => n.y0)) - 2, y1: Math.max(...members.map((n) => n.y1)) + 2 };
      const nonmembers = result.layout.nodes.filter((node) => !group.members.includes(node.id));
      // Mutation: drop the unsafe-enclosure guard in paint.ts -> a compact
      // compound layout could still draw a group box around an unrelated node.
      // Unconditional (not gated on `.some`), so this always actually runs.
      expect(nonmembers.every((node) => !glyphDiagramRectsOverlap(node, bounds))).toBe(true);
    }
  });
  it("falls back to an explicit member list, never a false enclosure, when group membership genuinely overlaps", async () => {
    const graph = {
      nodes: [{ id: "A", label: "A" }, { id: "B", label: "B" }, { id: "C", label: "C" }],
      edges: [{ from: "A", to: "B" }, { from: "B", to: "C" }],
      groups: [{ id: "G1", members: ["A", "B"] }, { id: "G2", members: ["B", "C"] }],
      direction: "TB" as const,
    };
    const result = await renderGlyphDiagram(graph, { width: 60, height: 30 });
    expect(result.pages).toHaveLength(1);
    // Mutation: only run this check for geometric overlap, ignoring partial
    // group-membership overlap -> the ledger message never fires and this fails.
    expect(result.report.ledger).toContainEqual(expect.objectContaining({ code: "group-member-list", detail: expect.objectContaining({ groupId: "G1", reason: "unrelated-nodes" }) }));
    expect(result.report.ledger).toContainEqual(expect.objectContaining({ code: "group-member-list", detail: expect.objectContaining({ groupId: "G2", reason: "unrelated-nodes" }) }));
  });
  // Mutation: drop `subcell: false` from the box top/bottom `canvas.line`
  // calls in paint.ts -> the border falls back to the tier's own subcell
  // default and paints a dotted/quadrant edge instead of a flat rule.
  it.each(["braille", "blocks"] as const)("keeps diagram box borders whole-cell under %s, with no sub-cell glyph anywhere in the render", async (charset) => {
    const result = await renderGlyphDiagram("graph LR; A[Alpha] --> B[Beta]", { charset, width: 36, height: 9 });
    // U+2800 is braille's own BLANK pattern (its whole-cell space glyph, used
    // for ordinary label padding) -- everything past it is an actual dot
    // pattern, which a whole-cell border must never contain.
    expect(result.text).not.toMatch(/[⠁-⣿]/);
    for (const glyph of GLYPH_CANVAS_QUADRANT_GLYPHS) if (glyph !== " " && glyph !== "█") expect(result.text.includes(glyph)).toBe(false);
  });
  it("returns repairable JSON errors and validates render bounds", async () => {
    // Mutation: parse malformed JSON with a bare JSON.parse instead of the
    // tagged parseGlyphDiagramJson -> code regresses to null.
    expect(JSON.parse(await renderGlyphDiagramJson("{"))).toMatchObject({ code: "GLYPH_DIAGRAM_BAD_JSON" });
    expect(JSON.parse(await renderGlyphDiagramJson('{"nodes":[],"edges":[]}'))).toMatchObject({ code: "empty-nodes" });
    await expect(renderGlyphDiagram("graph LR; A", { width: 20.5 })).rejects.toMatchObject({ code: "bad-size" });
    await expect(renderGlyphDiagram("graph LR; A", { ranksep: 0 })).rejects.toMatchObject({ code: "bad-options" });
  });
});
