import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderGlyphDiagram } from "./render";
import { glyphGraphFromMermaid } from "./mermaid";
import { glyphDiagramGroupRects } from "./pipeline";
import { glyphDiagramHasRoutingClearance } from "./route";

const fixture = (name: string) => readFileSync(resolve(__dirname, `../fixtures/${name}.mmd`), "utf8");

describe("a panel that cannot show anything stays a blank panel", () => {
  it("renders a looped node in a canvas too small for it", async () => {
    // Mutation: leave `loops` on the cleared layout -> paint reads a loop with no ports and throws.
    const r = await renderGlyphDiagram("flowchart TB\nA -->|again| A", { target: "chat", width: 6, height: 4, overflow: "paginate", autoDirection: false });
    expect(r.text.trim()).toBe("");
    expect(r.report.ledger.map((e) => e.code)).toContain("split-panel-dropped");
    expect(r.layout.loops).toEqual([]);
  });
});

describe("the first fit checks loop labels too", () => {
  it("keeps every row of a long multi-line loop label", async () => {
    // Mutation: leave the loop clearance out of the fit's acceptance -> the first layout is taken and `seven` is dropped.
    const r = await renderGlyphDiagram("flowchart TB\nA -->|one<br/>two<br/>three<br/>four<br/>five<br/>six<br/>seven| A\nA --> B[A very wide next node]", { target: "chat", width: 72, height: 24, autoDirection: false });
    for (const row of ["one", "two", "three", "four", "five", "six", "seven"]) expect(r.text).toContain(row);
    expect(r.report.ledger.filter((e) => e.code === "label-dropped")).toEqual([]);
    expect(glyphDiagramHasRoutingClearance(r.layout)).toBe(true);
  });
});

describe("the nested-frame inset is a preference", () => {
  const NESTED = "flowchart TB\nsubgraph O[Outer]\nsubgraph I[Inner]\na-->b\nend\nb-->c\nend\nc-->d";

  it("pins the exempt nested legacy flowchart output with inset frames", async () => {
    const source = "flowchart TB\nsubgraph P[Outer]\nsubgraph Q[Inner]\nA --> B\nend\nC\nend";
    const r = await renderGlyphDiagram(source, { target: "chat", detail: "faithful", overflow: "expand", autoDirection: true, width: 40, height: 25 });
    expect(r.layout.loops).toEqual([]);
    expect(r.layout.nodes.every((n) => n.shape !== "point")).toBe(true);
    expect(r.layout.frameInset).toBe(true);
    expect(r.report.unroutable).toEqual([]);
    await expect(r.text).toMatchFileSnapshot(resolve(__dirname, "../fixtures/expected/nested-legacy.box.chat40x25.txt"));
  });

  it("falls back to shared-border frames before splitting into panels", async () => {
    // Mutation: drop the shared-border fallback in fitGlyphGraph -> layout-overflow and three panels.
    const r = await renderGlyphDiagram(NESTED, { target: "chat", width: 40, height: 24, overflow: "paginate", autoDirection: false });
    expect(r.pages).toHaveLength(1);
    expect(r.layout.frameInset).toBe(false);
    expect(r.report.ledger.map((e) => e.code)).not.toContain("layout-overflow");
    expect(r.report.unroutable).toEqual([]);
    for (const name of ["Outer", "Inner"]) expect(r.text).toContain(name);
  });

  it("takes shared-border frames over cutting words", async () => {
    // Mutation: drop the shared-border fallback -> the padded frames fit only by breaking "Alphabetical" and "Bravissimo".
    const source = "flowchart TB\nsubgraph O[Outer]\nsubgraph I[Inner]\na[Alphabetical]-->b[Bravissimo]\nend\nb-->c[Charlemagne]\nend\nc-->d[Deltaforce]";
    const r = await renderGlyphDiagram(source, { target: "chat", width: 18, height: 60, overflow: "paginate", autoDirection: false, detail: "faithful" });
    expect(r.pages).toHaveLength(1);
    expect(r.layout.frameInset).toBe(false);
    expect(r.report.ledger.map((e) => e.code)).not.toContain("word-cut");
    for (const word of ["Alphabetical", "Bravissimo", "Charlemagne", "Deltaforce"]) expect(r.text).toContain(word);
    // A canvas narrower than shared frames need still gets the padded ones with the words cut, and says so.
    const narrow = await renderGlyphDiagram(source, { target: "chat", width: 14, height: 60, overflow: "paginate", autoDirection: false, detail: "faithful" });
    expect(narrow.pages).toHaveLength(1);
    expect(narrow.report.ledger.map((e) => e.code)).toContain("word-cut");
  });

  it("pads the frames when the canvas has the room", async () => {
    const r = await renderGlyphDiagram(NESTED, { target: "chat", width: 72, height: 40, overflow: "paginate", autoDirection: false });
    expect(r.layout.frameInset).toBe(true);
    const rects = glyphDiagramGroupRects(r.layout, { cols: r.canvas.cols, rows: r.canvas.rows });
    expect(rects.get("O")!.x0).toBeLessThan(rects.get("I")!.x0);
  });

  it.each(["chain", "diamond", "fan-out", "cycle", "subgraph"])("renders %s, a graph with no nested groups, byte-for-byte as committed", async (name) => {
    // Mutation: pad even a single frame (inset for every group) -> the subgraph snapshot moves.
    for (const charset of ["box", "ascii"] as const) {
      const r = await renderGlyphDiagram(fixture(name), { target: "chat", width: 80, height: 32, charset });
      expect(r.text).toBe(readFileSync(resolve(__dirname, `../fixtures/expected/${name}.${charset}.txt`), "utf8"));
    }
  });
});

describe("cut words are reported", () => {
  const BUSY = "stateDiagram-v2\n[*] --> Idle\nstate Busy {\n [*] --> Work\n [*] --> Wait\n Work --> [*]\n Wait --> [*]\n Work --> Work : tick\n}\nIdle --> Busy\nBusy --> Idle : done\nBusy --> [*]";

  it("names the nodes whose words were broken across lines", async () => {
    // Mutation: drop the detection in render.ts -> the ledger shows only budget-compaction.
    const r = await renderGlyphDiagram(BUSY, { target: "chat", width: 24, height: 38, overflow: "paginate", autoDirection: false });
    const entry = r.report.ledger.find((e) => e.code === "word-cut");
    expect(entry).toBeDefined();
    const cut = (entry!.detail as { nodes: { id: string; words: string[] }[] }).nodes;
    expect(cut.map((n) => n.id).sort()).toEqual(expect.arrayContaining(["Idle", "Work"]));
    expect(r.text).not.toContain("Idle");
  });

  it("reports nothing when every word is whole, even across several lines", async () => {
    const r = await renderGlyphDiagram(BUSY, { target: "chat", width: 72, height: 48, overflow: "paginate", autoDirection: false });
    expect(r.text).toContain("Idle");
    expect(r.report.ledger.map((e) => e.code)).not.toContain("word-cut");
    const wrapped = await renderGlyphDiagram("flowchart TB\nA[Several words that wrap onto rows] --> B", { target: "chat", width: 30, height: 20 });
    expect(wrapped.report.ledger.map((e) => e.code)).not.toContain("word-cut");
  });
});

describe("loop label wraps are chosen to fit the canvas", () => {
  it("finds the wrap that fits a tight canvas among many", async () => {
    // Mutation: pick the widest, middle and narrowest wraps without asking which could fit -> only wraps that overflow are tried and the panel is dropped.
    const r = await renderGlyphDiagram("flowchart TB\nA -->|one two three four five six seven eight nine ten| A", { target: "chat", width: 16, height: 8, autoDirection: false, detail: "faithful" });
    expect(r.report.ledger.map((e) => e.code)).not.toContain("split-panel-dropped");
    expect(r.report.unroutable).toEqual([]);
    expect(r.labels.map((l) => l.text).join(" ")).toBe("one two three four five six seven eight nine ten");
  });

  it("grows from three spread wraps when none could fit the width, keeping the canvas narrow", async () => {
    // Mutation: drop the fallback (`possible.length ? possible : loopBreaks` -> `possible`) -> no loop wrap is tried and the canvas grows to 34 columns.
    const r = await renderGlyphDiagram("flowchart TB\nA -->|one two three four five six seven eight nine ten| A", { target: "chat", width: 10, height: 6, autoDirection: false, overflow: "expand", detail: "faithful" });
    expect(r.report.ledger.map((e) => e.code)).toContain("layout-expanded");
    expect(r.canvas.cols).toBeLessThan(20);
    expect(r.report.unroutable).toEqual([]);
  });

  it("lets an expanding canvas grow only as tall as the stacked loops need", async () => {
    // Mutation: apply the height limit when the canvas may grow -> the fitting wraps are filtered out and the canvas grows to 14 rows.
    const source = "flowchart TB\nA[Processor] -->|one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen| A\nA -->|retry after the backoff window until success with delay forever| A";
    const r = await renderGlyphDiagram(source, { target: "chat", width: 39, height: 6, autoDirection: false, overflow: "expand", detail: "faithful" });
    expect([r.canvas.cols, r.canvas.rows]).toEqual([39, 10]);
  });

  it("fits two stacked loops whose labels need their combined room", async () => {
    // Mutation: keep only the widest, middle and narrowest wraps in the dagre search -> 23 columns is never tried and the canvas grows (or the node's word is cut).
    // Mutation: demand one row more than the stack needs (`rows <= height` -> `height - 1`) -> the wrap that fits exactly is filtered out.
    const source = "flowchart TB\nA[Processor] -->|one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen| A\nA -->|retry after the backoff window until success with delay forever| A";
    const grown = await renderGlyphDiagram(source, { target: "chat", width: 39, height: 10, autoDirection: true, overflow: "expand", detail: "faithful" });
    expect([grown.canvas.cols, grown.canvas.rows]).toEqual([39, 10]);
    const flat = await renderGlyphDiagram(source, { target: "chat", width: 39, height: 10, autoDirection: false, overflow: "paginate", detail: "faithful" });
    expect(flat.pages).toHaveLength(1);
    expect(flat.text).toContain("Processor");
    expect(flat.report.ledger.map((e) => e.code)).not.toContain("word-cut");
    expect(flat.report.unroutable).toEqual([]);
  });
});

describe("a group frame never runs through its member's loop", () => {
  it("counts a loop inside a frame as one cell more of layout, even at margin 0", async () => {
    // Mutation: drop the extra cell for loops inside a group -> the clamped frame shares the label's last row.
    const { layoutGlyphGraph, measureGlyphGraph, reserveGlyphGraphPorts } = await import("./pipeline");
    const { glyphDiagramLoopGeometry } = await import("./loop");
    const graph = glyphGraphFromMermaid("flowchart TB\nsubgraph g[Group]\n A -->|one two three| A\nend");
    for (const margin of [0, 1]) {
      const layout = await layoutGlyphGraph(reserveGlyphGraphPorts(measureGlyphGraph(graph)), { margin });
      const rect = glyphDiagramGroupRects(layout, { cols: layout.width, rows: layout.height }).get("g")!;
      for (const g of glyphDiagramLoopGeometry(layout)) expect(g.bounds.x1 < rect.x1 && g.bounds.y1 < rect.y1 && g.bounds.x0 > rect.x0 && g.bounds.y0 > rect.y0).toBe(true);
    }
  });

  it("rejects a canvas that cannot enclose the label instead of clamping the frame through it", async () => {
    const r = await renderGlyphDiagram("flowchart TB\nsubgraph g[Group]\n A -->|one two three four five six seven eight nine ten| A\nend", { target: "chat", width: 16, height: 10, autoDirection: false, detail: "faithful" });
    const rows = r.text.split("\n");
    expect(rows.every((row) => !/[a-z]·|·[a-z]/.test(row))).toBe(true);
  });
});

describe("word cuts are reported for every node and every loop label", () => {
  it("reports a cut in a node that borrows a marker's kind", async () => {
    // Mutation: exempt kinds that start with "state-" from the check -> the cut goes unreported.
    const r = await renderGlyphDiagram({ direction: "TB", nodes: [{ id: "n", label: "Alphabetical", shape: "rect", kind: "state-start" }], edges: [] }, { target: "chat", width: 8, height: 12, autoDirection: false, detail: "faithful" });
    expect(r.layout.nodes[0]!.lines.length).toBeGreaterThan(1);
    expect(r.report.ledger.find((e) => e.code === "word-cut")).toBeDefined();
  });

  it("reports a cut in a loop label", async () => {
    // Mutation: leave loop labels out of the check -> only nodes are compared.
    const r = await renderGlyphDiagram("flowchart TB\nA -->|Supercalifragilistic| A", { target: "chat", width: 40, height: 20, autoDirection: false, detail: "faithful", loopLabelWidth: 8 });
    const entry = r.report.ledger.find((e) => e.code === "word-cut");
    expect((entry!.detail as { nodes: { id: string }[] }).nodes.map((n) => n.id)).toEqual(["A loop"]);
  });

  it("does not report a state marker's own glyph or an ascii twin", async () => {
    const r = await renderGlyphDiagram("stateDiagram-v2\nstate c <<choice>>\n[*] --> c\nc --> [*]", { target: "chat", charset: "ascii" });
    expect(r.report.ledger.map((e) => e.code)).not.toContain("word-cut");
  });
});

describe("the snake and the layout search choose loop wraps the same way", () => {
  const SOURCE = "flowchart LR\nn0[Node 0] --> n1[Node 1] --> n2[Node 2] --> n3[Node 3] --> n4[Node 4]\nn1 -->|one two three four five six seven eight nine ten| n1\nn3 -->|retry after the backoff window until success with delay forever| n3";
  it.each(["paginate", "expand"] as const)("fits a wrapped chain with two long loops in the requested 56x16 (%s)", async (overflow) => {
    // Mutation: give the snake three wraps only (`loopWrapsFor("LR", true)`) -> six panels, or a taller canvas.
    // Mutation: stop collecting tall snakes at three without looking on -> the expanded canvas is 56x20.
    const r = await renderGlyphDiagram(SOURCE, { target: "chat", width: 56, height: 16, autoDirection: false, overflow, detail: "faithful" });
    expect(r.pages).toHaveLength(1);
    expect([r.canvas.cols, r.canvas.rows]).toEqual([56, 16]);
    expect(r.report.ledger.map((e) => e.code)).toContain("layout-wrapped");
    expect(r.report.unroutable).toEqual([]);
  });
});

describe("an empty row is never a label", () => {
  const CHAIN = "flowchart LR\nA[Alpha] --> B[Bravo] --> C[Charlie] --> D[Delta] --> E[Echo] --> F[Foxtrot] --> G[Golf]";
  const dropped = (r: Awaited<ReturnType<typeof renderGlyphDiagram>>) => r.report.ledger.filter((e) => e.code === "label-dropped");

  it("keeps a wrapped chain whole when a loop label has an empty row", async () => {
    // Mutation: submit every row of a label to the arbiter without skipping empty ones -> label-dropped, and the snake candidates are all disqualified.
    const r = await renderGlyphDiagram(`${CHAIN}\nC -->|first<br/><br/>second| C`, { target: "chat", width: 50, height: 30, autoDirection: false, overflow: "paginate", detail: "faithful" });
    expect(r.pages).toHaveLength(1);
    expect(dropped(r)).toEqual([]);
    expect(r.labels.map((l) => l.text)).toEqual(expect.arrayContaining(["first", "second"]));
  });

  it("leaves blank rows and blank labels unplaced and unreported at every submission site", async () => {
    // Mutation: drop the blank-candidate skip in glyphDiagramLabelLayout -> each of these reports a dropped label.
    const r = await renderGlyphDiagram({
      direction: "TB",
      nodes: [{ id: "a", label: "top\n\nbottom", group: "g" }, { id: "b", label: "B", group: "g" }],
      edges: [{ from: "a", to: "b", label: "   " }, { from: "b", to: "b", label: "one\n\ntwo" }, { from: "a", to: "a", label: " " }],
      groups: [{ id: "g", label: "   ", members: ["a", "b"] }],
    }, { target: "chat", width: 60, height: 30, title: "   ", detail: "faithful" });
    expect(dropped(r)).toEqual([]);
    expect(r.report.ledger.map((e) => e.code)).not.toContain("label-abbreviated");
    expect(r.labels.map((l) => l.text)).toEqual(expect.arrayContaining(["one", "two"]));
  });
});
