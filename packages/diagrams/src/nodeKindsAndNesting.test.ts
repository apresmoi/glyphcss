import { describe, expect, it } from "vitest";
import { renderGlyphDiagram } from "./render";
import { glyphGraphFromMermaid } from "./mermaid";
import { glyphDiagramGroupRects } from "./pipeline";
import { glyphDiagramRepairHint, GLYPH_DIAGRAM_VALIDATION_RULES, validateGlyphGraph } from "./validate";

describe("kinds are labels, not lookups", () => {
  it.each(["constructor", "toString", "__proto__", "hasOwnProperty"])("renders a JSON node whose kind is %s", async (kind) => {
    // Mutation: look the kind up in a plain object -> an inherited property is read as a marker and the render crashes.
    const r = await renderGlyphDiagram({ direction: "TB", nodes: [{ id: "x", label: "X", kind }], edges: [] }, { target: "chat" });
    expect(r.text).toContain("X");
    expect(r.report.ledger).toEqual([]);
  });

  it("keeps a JSON label even when the node borrows a marker's kind on another shape", async () => {
    // Mutation: apply the marker whatever the shape -> "Start" becomes "●".
    for (const [kind, shape] of [["state-start", "rect"], ["state-end", "rounded"], ["state-choice", "rect"], ["state-start", undefined]] as const) {
      const r = await renderGlyphDiagram({ direction: "TB", nodes: [{ id: "x", label: "Start", kind, ...(shape ? { shape } : {}) }], edges: [] }, { target: "chat" });
      expect(r.text).toContain("Start");
      expect(r.text).not.toMatch(/[●◉◆]/);
    }
  });

  it("still gives the adapter's own markers their glyphs", async () => {
    const r = await renderGlyphDiagram("stateDiagram-v2\n[*] --> A\nA --> [*]", { target: "chat" });
    expect(r.text).toContain("●");
    expect(r.text).toContain("◉");
  });
});

describe("a point holds no loop", () => {
  it("rejects a self edge on a point by name, with a repair hint", () => {
    // Mutation: drop the check in glyphGraphIntegrityFailure -> a loop is drawn beside a blank cell.
    const graph = { direction: "TB", nodes: [{ id: "p", label: "*", shape: "point" }], edges: [{ from: "p", to: "p", label: "again" }] };
    expect(() => validateGlyphGraph(graph)).toThrow(expect.objectContaining({ code: "point-loop" }));
    expect(GLYPH_DIAGRAM_VALIDATION_RULES).toContain("point-loop");
    expect(glyphDiagramRepairHint("point-loop")).toMatch(/bordered shape/);
    return expect(renderGlyphDiagram(graph as never, { target: "chat" })).rejects.toMatchObject({ code: "point-loop" });
  });

  it("never comes from a state diagram", async () => {
    const r = await renderGlyphDiagram("stateDiagram-v2\n[*] --> A\nA --> A : again\nA --> [*]", { target: "chat" });
    expect(r.report.unroutable).toEqual([]);
  });
});

describe("a point's label is reported when it is cut and required to exist", () => {
  it("reports the cut and keeps the first character", async () => {
    // Mutation: drop the abbreviation entry in measureGlyphGraph -> the cut is silent again.
    const r = await renderGlyphDiagram({ direction: "TB", nodes: [{ id: "s", label: "Start of everything", shape: "point" }], edges: [] }, { target: "chat" });
    const entry = r.report.ledger.find((e) => e.code === "label-abbreviated");
    expect(entry).toMatchObject({ detail: { before: "Start of everything", after: "S" } });
    expect(r.layout.nodes[0]!.lines).toEqual(["S"]);
  });

  it("does not report a label that is already one character", async () => {
    const r = await renderGlyphDiagram({ direction: "TB", nodes: [{ id: "s", label: "●", shape: "point" }], edges: [] }, { target: "chat" });
    expect(r.report.ledger).toEqual([]);
  });

  it.each(["", "   "])("rejects the empty point label %j", (label) => {
    // Mutation: drop the point-label check -> an arrow leads into empty space.
    expect(() => validateGlyphGraph({ direction: "TB", nodes: [{ id: "s", label, shape: "point" }], edges: [] })).toThrow(expect.objectContaining({ code: "bad-node" }));
  });
});

describe("nested state diagrams", () => {
  it("puts an empty inner composite in the outer group as an ordinary state", () => {
    // Mutation: do not join a composite declared inside another to its parent -> two sibling nodes and no group.
    const graph = glyphGraphFromMermaid("stateDiagram-v2\nstate Outer {\n state Inner {\n }\n}");
    expect(graph.groups).toEqual([{ id: "Outer", label: "Outer", members: ["Inner"] }]);
    expect(graph.nodes).toEqual([{ id: "Inner", label: "Inner", shape: "rounded", group: "Outer" }]);
  });

  it("keeps both frames when the inner composite lists the same states as the outer", async () => {
    // Mutation: drop `parent` from the adapter's groups -> equal member sets cannot nest and one frame is drawn.
    const source = "stateDiagram-v2\n[*] --> Outer\nstate Outer {\n state Inner {\n  a --> b\n }\n}";
    const graph = glyphGraphFromMermaid(source);
    expect(graph.groups).toEqual([{ id: "Outer", label: "Outer", members: ["a", "b"] }, { id: "Inner", label: "Inner", members: ["a", "b"], parent: "Outer" }]);
    const r = await renderGlyphDiagram(source, { target: "chat", width: 72, height: 30, autoDirection: false });
    const rects = glyphDiagramGroupRects(r.layout, { cols: r.canvas.cols, rows: r.canvas.rows });
    const [outer, inner] = [rects.get("Outer")!, rects.get("Inner")!];
    expect(outer.x0 < inner.x0 && outer.y0 < inner.y0 && outer.x1 > inner.x1 && outer.y1 > inner.y1).toBe(true);
    expect(r.text).toContain("Outer");
    expect(r.text).toContain("Inner");
    expect(r.report.unroutable).toEqual([]);
  });

  it("nests two flowchart subgraphs that list the same nodes", async () => {
    const r = await renderGlyphDiagram("flowchart TB\nsubgraph O[Outer]\nsubgraph I[Inner]\na-->b\nend\nend", { target: "chat", width: 72, height: 30, autoDirection: false });
    const rects = glyphDiagramGroupRects(r.layout, { cols: r.canvas.cols, rows: r.canvas.rows });
    expect(rects.get("O")!.x0).toBeLessThan(rects.get("I")!.x0);
  });

  it("validates a group's parent", () => {
    const base = { direction: "TB", nodes: [{ id: "a", label: "A" }], edges: [] };
    expect(() => validateGlyphGraph({ ...base, groups: [{ id: "g", members: ["a"], parent: "nowhere" }] })).toThrow(expect.objectContaining({ code: "unknown-group" }));
    expect(() => validateGlyphGraph({ ...base, groups: [{ id: "g", members: ["a"], parent: "h" }, { id: "h", members: ["a"], parent: "g" }] })).toThrow(expect.objectContaining({ code: "group-membership" }));
    expect(() => validateGlyphGraph({ ...base, groups: [{ id: "g", members: ["a"] }, { id: "h", members: ["a"], parent: "g" }] })).not.toThrow();
  });
});

describe("state glyphs are authored labels; shape decoration never substitutes by kind", () => {
  it("keeps every authored label whatever its kind and shape", async () => {
    // Mutation: swap a node's label for a marker glyph by its kind -> "Keep this text" becomes "◆".
    for (const [kind, shape] of [["state-choice", "diamond"], ["state-start", "point"], ["state-end", "point"], ["state-start", "diamond"]] as const) {
      const label = shape === "point" ? "K" : "Keep this text";
      const r = await renderGlyphDiagram({ direction: "TB", nodes: [{ id: "A", label, shape, kind }], edges: [] }, { target: "chat" });
      expect(r.text).toContain(label);
      expect(r.meta.nodes[0]!.label).toBe(label);
      expect(r.layout.nodes[0]!.label).toBe(label);
      expect(r.text).not.toMatch(/[●◉]/);
      if (shape === "diamond") expect(r.text).toContain(`◆ ${label}`);
      else expect(r.text).not.toContain("◆");
    }
  });

  it("makes the state adapter write the glyph as the label, ascii twins applied only in ascii", async () => {
    const graph = glyphGraphFromMermaid("stateDiagram-v2\nstate c <<choice>>\n[*] --> c\nc --> [*]");
    expect(graph.nodes.map((n) => n.label)).toEqual(["◆", "●", "◉"]);
    const box = await renderGlyphDiagram(graph, { target: "chat" });
    expect(box.text).toMatch(/●[\s\S]*◆[\s\S]*◉/);
    const ascii = await renderGlyphDiagram(graph, { target: "chat", charset: "ascii" });
    expect(ascii.text).toMatch(/^[\x20-\x7e\n]*$/);
    expect(ascii.report.ledger.map((e) => e.code)).toEqual(["label-folded", "label-folded", "label-folded"]);
    // Folding is by glyph, for any label: a marker inside other text folds to the same look-alike, and is reported as a fold.
    const json = await renderGlyphDiagram({ direction: "TB", nodes: [{ id: "x", label: "●" }, { id: "y", label: "a ◆ b ◉" }], edges: [] }, { target: "chat", charset: "ascii" });
    expect(json.layout.nodes.map((n) => n.lines.join(" "))).toEqual(["*", "a * b @"]);
    expect(json.report.ledger.filter((e) => e.code === "label-folded")).toHaveLength(2);
    expect(json.report.ledger.map((e) => e.code)).not.toContain("word-cut");
    const loop = await renderGlyphDiagram("flowchart TB\nA -->|◆| A", { target: "chat", charset: "ascii" });
    expect(loop.report.ledger.map((e) => e.code)).not.toContain("word-cut");
  });
});

describe("a composite takes its quoted name (state \"Name\" as Id)", () => {
  it.each([
    ["before the body", 'stateDiagram-v2\nstate "Working" as P\nstate P {\n A --> B\n}'],
    ["after the body", 'stateDiagram-v2\nstate P {\n A --> B\n}\nstate "Working" as P'],
    ["on the body's own line", 'stateDiagram-v2\nstate "Working" as P {\n A --> B\n}'],
  ])("labels the group %s", async (_when, source) => {
    // Mutation: label the group with its id alone -> "P" is drawn and the name is lost.
    const graph = glyphGraphFromMermaid(source);
    expect(graph.groups).toEqual([{ id: "P", label: "Working", members: ["A", "B"] }]);
    expect(graph.nodes.map((n) => n.id)).toEqual(["A", "B"]);
    const r = await renderGlyphDiagram(source, { target: "chat", width: 72, height: 30, autoDirection: false });
    expect(r.text).toContain("Working");
  });

  it("keeps the name when an empty composite becomes an ordinary state", () => {
    const graph = glyphGraphFromMermaid('stateDiagram-v2\nstate "Working" as P\nstate P {\n}\n[*] --> P');
    expect(graph.nodes.find((n) => n.id === "P")!.label).toBe("Working");
  });
});

describe("group ancestry is checked before it is walked", () => {
  it("rejects a chain that runs off the end by name", () => {
    // Mutation: walk the chain before checking every parent exists -> a TypeError instead of unknown-group.
    const graph = { direction: "TB", nodes: [{ id: "n", label: "N" }], edges: [], groups: [{ id: "a", members: ["n"], parent: "b" }, { id: "b", members: ["n"], parent: "missing" }] };
    expect(() => validateGlyphGraph(graph)).toThrow(expect.objectContaining({ code: "unknown-group" }));
  });
});

describe("every label kind reports the same fold through the same path", () => {
  const graph = {
    direction: "TB",
    nodes: [{ id: "n", label: "node ★", group: "g" }, { id: "m", label: "clean", group: "g" }],
    edges: [{ from: "n", to: "m", label: "edge ★" }, { from: "n", to: "n", label: "loop ◆" }, { from: "m", to: "m", label: "tidy loop" }],
    groups: [{ id: "g", label: "group ★", members: ["n", "m"] }],
  } as const;

  it("reports node, edge, loop, group and title folds once each, with their role and owner", async () => {
    // Mutation: fold a kind without reporting it (e.g. loop labels through the bare fold) -> its entry is missing.
    const r = await renderGlyphDiagram(graph as never, { target: "chat", charset: "ascii", title: "title ★", width: 72, height: 30 });
    const folds = r.report.ledger.filter((e) => e.code === "label-folded").map((e) => `${e.detail?.role}|${e.detail?.owner}|${e.detail?.after}`).sort();
    expect(folds).toEqual(["edge label|n to m|edge ?", "group label|g|group ?", "loop label|n|loop *", "node label|n|node ?", "title|diagram|title ?"]);
    expect(r.text).toMatch(/^[\x20-\x7e\n]*$/);
  });

  it("reports nothing for labels that are already drawable, or in a charset that draws them", async () => {
    const clean = await renderGlyphDiagram({ direction: "TB", nodes: [{ id: "a", label: "a " }, { id: "b", label: "b" }], edges: [{ from: "a", to: "b", label: "ok " }, { from: "a", to: "a", label: "again\nthere " }] }, { target: "chat", charset: "ascii", title: "fine " });
    expect(clean.report.ledger.map((e) => e.code)).not.toContain("label-folded");
    const box = await renderGlyphDiagram(graph as never, { target: "chat", charset: "box", width: 72, height: 30 });
    expect(box.report.ledger.map((e) => e.code)).not.toContain("label-folded");
  });
});
