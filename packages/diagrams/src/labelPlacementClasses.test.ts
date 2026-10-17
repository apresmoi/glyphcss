import { describe, expect, it } from "vitest";
import { renderGlyphDiagram } from "./render";
import { glyphDiagramLabelLayout, glyphDiagramRectsOverlap } from "./labels";
import { glyphDiagramLoopGeometry } from "./loop";
import { paintGlyphDiagram } from "./paint";
import { layoutGlyphGraph } from "./pipeline";

// Class tests: each enumerates its inputs rather than pinning one reproduction.
describe("a loop's reserved label rows are never taken by another label", () => {
  const directions = ["TB", "BT", "LR", "RL"] as const;
  const ROWS = ["retry", "after the", "backoff", "window", "until", "success"];
  it("keeps every row of a loop label beside labelled edges into and out of the same node, whatever the order", async () => {
    // Mutation: sort fixed-place candidates with the rest by priority and id -> an edge label such as `merge` takes a reserved row and the row is dropped.
    let cases = 0;
    for (const direction of directions) for (const sources of [1, 2, 3]) for (const targets of [0, 1, 2]) for (const rows of [2, 6]) for (const loopFirst of [true, false]) {
      const loop = `D -->|${ROWS.slice(0, rows).join("<br/>")}| D`;
      const lines = [
        ...(loopFirst ? [loop] : []),
        ...Array.from({ length: sources }, (_, i) => `S${i} -->|${["merge", "done", "ok"][i]}| D`),
        ...Array.from({ length: targets }, (_, i) => `D -->|${["next", "other"][i]}| T${i}`),
        ...(loopFirst ? [] : [loop]),
      ];
      const r = await renderGlyphDiagram(`flowchart ${direction}\n${lines.join("\n")}`, { target: "chat", width: 100, height: 60, overflow: "expand", autoDirection: false, detail: "faithful" });
      if (r.report.unroutable.length) continue;
      cases++;
      const label = `${direction} sources=${sources} targets=${targets} rows=${rows} loopFirst=${loopFirst}`;
      expect({ label, dropped: r.report.ledger.filter((e) => e.code === "label-dropped").length }).toEqual({ label, dropped: 0 });
      // The fitter may re-wrap a loop label narrower to make it fit, so the words are what must all be there, in order.
      const edgeId = r.layout.loops[0]!.edgeId;
      const words = r.labels.filter((l) => l.id === `edge:${edgeId}` || l.id.startsWith(`edge-row:[${JSON.stringify(edgeId)},`)).flatMap((l) => l.text.split(" "));
      expect({ label, words }).toEqual({ label, words: ROWS.slice(0, rows).flatMap((row) => row.split(" ")) });
    }
    expect(cases).toBeGreaterThan(100);
  });

  it("keeps the repro: merge and done into a looped node, flowing bottom to top", async () => {
    const r = await renderGlyphDiagram("flowchart BT\nB -->|merge| D\nC -->|done| D\nD -->|retry<br/>after the<br/>backoff<br/>window<br/>until<br/>success<br/>with delay<br/>forever| D", { target: "chat", width: 72, height: 24, overflow: "expand", autoDirection: false, detail: "faithful" });
    expect(r.report.ledger.map((e) => e.code)).not.toContain("label-dropped");
    expect(r.labels.map((l) => l.text)).toEqual(expect.arrayContaining(["until", "merge", "done"]));
  });

  it("holds blank rows and unused row width against searched labels at any priority", () => {
    const reserve = { x0: 3, x1: 8, y0: 2, y1: 2 };
    for (const text of ["", "x"]) {
      const r = glyphDiagramLabelLayout([
        { id: "title", text: "other", x: 6, y: 2, priority: Infinity },
        { id: "edge:L", text, x: 3, y: 2, place: { x: 3, y: 2 }, reserve },
      ], { obstacles: [], viewport: { cols: 12, rows: 5 } });
      const other = r.placed.find((l) => l.id === "title")!;
      expect(other).toBeDefined();
      expect(glyphDiagramRectsOverlap(other, reserve)).toBe(false);
      expect(r.placed.filter((l) => l.id === "edge:L").map((l) => l.text)).toEqual(text ? [text] : []);
      expect(r.ledger).toEqual([]);
      expect(r.dropped).toEqual([]);
    }
  });

  it("reserves the full loop label width beside a short row through the painter", async () => {
    const layout = await layoutGlyphGraph({
      direction: "TB",
      nodes: [{ id: "A", label: "A" }],
      edges: [{ id: "loop", from: "A", to: "A", label: "abcdef\nx" }],
    });
    const { loop, cells, label: room } = glyphDiagramLoopGeometry(layout)[0]!;
    expect(loop.lines).toEqual(["abcdef", "x"]);
    expect(room).toBeDefined();
    const foreign = { id: "foreign", from: "B", to: "C", label: "done" };
    // A route directly below the short row makes its unused columns the nearest label slot.
    const foreignCells = Array.from({ length: 6 }, (_, i) => ({ x: room!.x0 + 1 + i, y: room!.y1 + 1 }));
    const page = paintGlyphDiagram({ ...layout, edges: [...layout.edges, foreign] }, {
      routes: [{ edge: layout.edges[0]!, cells }, { edge: foreign, cells: foreignCells }],
      unroutable: [], ledger: [],
    }, { width: layout.width + 10, height: layout.height + 5, charset: "box", color: "none" });
    expect(page.ledger.filter((e) => e.code === "label-dropped")).toEqual([]);
    expect(page.labels.map((label) => label.text)).toEqual(["abcdef", "x", "done"]);
    const done = page.labels.find((label) => label.id === "edge:foreign")!;
    expect(glyphDiagramRectsOverlap(done, room!)).toBe(false);
    const shortRow = room!.y1 * page.canvas.cols;
    expect(page.canvas.grid.char.slice(shortRow + room!.x0, shortRow + room!.x1 + 1).join("")).toBe("x     ");
  });

  it("keeps the authored blank loop row clear of ship order labels", async () => {
    const r = await renderGlyphDiagram([
      "flowchart TB",
      "D -->|ship order| T0[Tall<br/>One<br/>Two<br/>Three<br/>Four]",
      "D -->|ship order| T1[Tall<br/>One<br/>Two<br/>Three<br/>Four]",
      "D -->|abcdef<br/>abcdef<br/>abcdef<br/>abcdef<br/><br/>abcdef| D",
    ].join("\n"), { target: "chat", detail: "faithful", overflow: "expand", autoDirection: false, width: 72, height: 40 });
    const { loop, label: room } = glyphDiagramLoopGeometry(r.layout)[0]!;
    expect(loop.lines).toEqual(["abcdef", "abcdef", "abcdef", "abcdef", "", "abcdef"]);
    expect(room).toBeDefined();
    expect(r.report.unroutable).toEqual([]);
    expect(r.report.ledger.filter((e) => e.code === "label-dropped")).toEqual([]);
    const foreign = r.labels.filter((l) => l.id !== `edge:${loop.edgeId}` && !l.id.startsWith(`edge-row:[${JSON.stringify(loop.edgeId)},`));
    expect(foreign.map((l) => l.text)).toEqual(["ship order", "ship order"]);
    for (const label of foreign) expect(glyphDiagramRectsOverlap(label, room!)).toBe(false);
    const blankY = room!.y0 + 4;
    expect(r.canvas.grid.char.slice(blankY * r.canvas.cols + room!.x0, blankY * r.canvas.cols + room!.x1 + 1).join("")).toBe(" ".repeat(loop.labelWidth));
  });
});
