import { describe, expect, it } from "vitest";
import { createGlyphCanvas, type GlyphCanvasPoint } from "glyphcss";
import { computeGlyphDiagramQuality } from "./quality";
import { renderGlyphDiagram } from "./render";
import { ledgerLabelDropped, ledgerUnroutable, ledgerWordsCut } from "./ledger";
import type { GlyphDiagramPage, GlyphDiagramResult } from "./renderTypes";
import type { GlyphDiagramRoute } from "./route";
import type { GlyphDiagramPositionedNode } from "./pipeline";

const budget = { width: 5, height: 5 };
const cells = (...points: [number, number][]): GlyphCanvasPoint[] => points.map(([x, y]) => ({ x, y }));
const route = (id: string, points: readonly GlyphCanvasPoint[], extra: Partial<GlyphDiagramRoute["edge"]> = {}): GlyphDiagramRoute =>
  ({ edge: { id, from: `${id}-source`, to: "sink", ...extra }, cells: points });
function page(routes: GlyphDiagramRoute[] = [], width = 5, height = 5): GlyphDiagramPage {
  return {
    text: "Misleading text: word-cut, arrows >>>, crossings +++",
    canvas: createGlyphCanvas({ cols: width, rows: height }), routes, labels: [],
    layout: { nodes: [], edges: routes.map((r) => r.edge), groups: [], loops: [], ledger: [], direction: "TB", width, height,
      ports: routes.flatMap((r) => (["from", "to"] as const).map((end) => {
        const escape = end === "from" ? r.cells[0]! : r.cells[r.cells.length - 1]!;
        return { edgeId: r.edge.id, nodeId: end === "from" ? r.edge.from : r.edge.to, end, side: end === "from" ? "s" as const : "n" as const,
          offset: 1, escape, anchor: { x: escape.x, y: escape.y + (end === "from" ? -1 : 1) } };
      })) },
  };
}
function result(...pages: GlyphDiagramPage[]): GlyphDiagramResult {
  return { ...pages[0]!, pages,
    meta: { nodes: [], edges: pages.flatMap((p) => p.layout.edges), groups: [], description: "" },
    report: { ledger: [], unroutable: [], unsupportedGlyphs: [] } };
}
const straight = () => route("straight", cells([0, 2], [1, 2], [2, 2], [3, 2], [4, 2]));
const vertical = () => route("vertical", cells([2, 0], [2, 1], [2, 2], [2, 3], [2, 4]));
const detour = () => route("detour", cells([0, 0], [0, 1], [0, 2], [1, 2], [2, 2], [2, 1], [2, 0]));

describe("offline diagram quality", () => {
  it("counts cut words, not affected nodes or matching encoded text", () => {
    const input = result(page());
    const quality = computeGlyphDiagramQuality({ ...input, report: { ...input.report, ledger: [
      ledgerWordsCut({ nodes: [{ id: "a", words: ["longword", "another"] }, { id: "b", words: ["third"] }] }),
      ledgerWordsCut({ nodes: [{ id: "loop", words: ["fourth"] }] }),
    ] } }, budget);
    expect(quality.wordCuts).toBe(4);
    expect(computeGlyphDiagramQuality(input, budget).wordCuts).toBe(0);
  });

  it("counts transverse straight interior intersections once per page", () => {
    const input = result(page([straight(), vertical()]));
    expect(computeGlyphDiagramQuality(input, budget).crossings).toBe(1);
    expect(computeGlyphDiagramQuality(result(input.pages[0]!, input.pages[0]!), budget).crossings).toBe(2);
    // Collinear overlap, a shared endpoint, and a corner contact are separate defects.
    for (const other of [route("parallel", straight().cells), route("endpoint", cells([2, 2], [2, 3], [2, 4])),
      route("corner", cells([2, 0], [2, 1], [2, 2], [3, 2], [4, 2]))]) {
      expect(computeGlyphDiagramQuality(result(page([straight(), other])), budget).crossings).toBe(0);
    }
  });

  it("counts enclosing parallel route pairs, excluding endpoint boxes and boundary contacts", () => {
    const enclosing = page([route("upper", cells([0, 0], [1, 0], [2, 0], [3, 0], [4, 0])),
      route("lower", cells([0, 4], [1, 4], [2, 4], [3, 4], [4, 4]))]);
    const box: GlyphDiagramPositionedNode = { id: "unrelated", label: "x", shape: "rect", lines: ["x"], width: 3, height: 3, x0: 1, x1: 3, y0: 1, y1: 3 };
    const withBox = { ...enclosing, layout: { ...enclosing.layout, nodes: [box] } };
    expect(computeGlyphDiagramQuality(result(withBox), budget).fakeFrames).toBe(1);
    for (const n of [{ ...box, id: "sink" }, { ...box, y0: 0 }, { ...box, x1: 5 }]) {
      expect(computeGlyphDiagramQuality(result({ ...withBox, layout: { ...withBox.layout, nodes: [n] } }), budget).fakeFrames).toBe(0);
    }
    const rotated = { ...withBox, routes: withBox.routes.map(r => ({ ...r, cells: r.cells.map(p => ({ x: p.y, y: p.x })) })) };
    expect(computeGlyphDiagramQuality(result(rotated), budget).fakeFrames).toBe(1);
  });

  it("reports per-edge bend counts and literal cell/escape-distance ratios", () => {
    const quality = computeGlyphDiagramQuality(result(page([straight(), detour()])), budget);
    expect(quality.bends).toEqual({ total: 2, max: 2 });
    expect(quality.detourRatio).toEqual({ mean: 2.375, max: 3.5 });
    expect(quality.edges).toEqual([
      { page: 1, edgeId: "straight", bends: 0, routeCells: 5, portDistance: 4, detourRatio: 1.25 },
      { page: 1, edgeId: "detour", bends: 2, routeCells: 7, portDistance: 2, detourRatio: 3.5 },
    ]);
    const multi = computeGlyphDiagramQuality(result(page([detour()]), page([detour()])), budget);
    expect(multi.bends).toEqual({ total: 4, max: 2 });
  });

  it("excludes zero-distance ratios and includes fixed self-loop routes", () => {
    const p = page([route("same", cells([1, 1])), route("loop", cells([0, 0], [1, 0], [1, 1], [0, 1]), { from: "sink" })]);
    const quality = computeGlyphDiagramQuality(result(p), budget);
    expect(quality.edges[0]!.detourRatio).toBeNull();
    expect(quality.edges[1]!.detourRatio).toBe(4);
    expect(quality.detourRatio).toEqual({ mean: 4, max: 4 });
    expect(quality.bends).toEqual({ total: 2, max: 2 });
  });

  it("counts rendered directed heads by node AND side; point fan-in joins to one", () => {
    const p = page([straight(), vertical(), route("undirected", detour().cells, { style: "undirected" }),
      route("absent", cells([0, 4], [1, 4]))]);
    const onlyRouted = { ...p, routes: p.routes.slice(0, 3) };
    expect(computeGlyphDiagramQuality(result(onlyRouted), budget).maxArrowheadsOnSide).toBe(2);
    const differentSide = { ...onlyRouted, layout: { ...p.layout, ports: p.layout.ports.map((port) =>
      port.edgeId === "vertical" && port.end === "to" ? { ...port, side: "w" as const } : port) } };
    expect(computeGlyphDiagramQuality(result(differentSide), budget).maxArrowheadsOnSide).toBe(1);
    const differentNode = { ...onlyRouted, layout: { ...p.layout, ports: p.layout.ports.map((port) =>
      port.edgeId === "vertical" && port.end === "to" ? { ...port, nodeId: "other" } : port) } };
    expect(computeGlyphDiagramQuality(result(differentNode), budget).maxArrowheadsOnSide).toBe(1);
    const point: GlyphDiagramPositionedNode = { id: "sink", label: "*", shape: "point", lines: ["*"], width: 3, height: 1, x0: 0, x1: 2, y0: 0, y1: 0 };
    expect(computeGlyphDiagramQuality(result({ ...onlyRouted, layout: { ...p.layout, nodes: [point] } }), budget).maxArrowheadsOnSide).toBe(1);
    expect(computeGlyphDiagramQuality(result(page([route("undirected", straight().cells, { style: "undirected" })])), budget).maxArrowheadsOnSide).toBe(0);
  });

  it("weights whitespace by canvas area and measures ALL pages against one render budget", () => {
    const small = page([], 2, 2), large = page([], 4, 2);
    small.canvas.text(0, 0, ["XX"]);
    large.canvas.text(0, 0, ["XXXX"]);
    large.canvas.text(0, 1, ["XX"]);
    const input = result(small, large);
    const quality = computeGlyphDiagramQuality(input, { width: 2, height: 2 });
    expect(quality.expansionRatio).toBe(3);
    expect(quality.whitespaceFraction).toBeCloseTo(1 / 3);
    expect(quality.pages).toBe(2);
    expect(quality.bends).toEqual({ total: 0, max: 0 });
    expect(quality.detourRatio).toEqual({ mean: 0, max: 0 });
  });

  it("unions unroutable ids, ledger losses and original edges missing from every page", () => {
    const p = page([straight()]);
    const input = result(p, p);
    const quality = computeGlyphDiagramQuality({ ...input,
      meta: { ...input.meta, edges: [...input.meta.edges, { id: "silently-missing", from: "a", to: "b" }] },
      report: { ...input.report, unroutable: ["failed"], ledger: [
        ledgerUnroutable({ edgeId: "failed", reason: "blocked" }), ledgerUnroutable({ edgeId: "ledger-only", reason: "clipped" }),
        ledgerLabelDropped({ role: "edge label", reason: "no room" }), ledgerLabelDropped({ role: "group label", reason: "no room" }),
        { code: "routing-attempt", message: "A failed intermediate candidate is not a dropped edge." },
      ] } }, budget);
    expect(quality.droppedEdges).toBe(3);
    expect(quality.droppedLabels).toBe(2);
    expect(computeGlyphDiagramQuality(result(p), budget).droppedEdges).toBe(0);
  });

  it("reads a real render without mutating it or counting the first page twice", async () => {
    const input = await renderGlyphDiagram("graph LR; A --> B", { target: "chat" });
    const before = { text: input.text, chars: [...input.canvas.grid.char], ports: JSON.stringify(input.layout.ports), ledger: JSON.stringify(input.report.ledger) };
    const quality = computeGlyphDiagramQuality(input, { width: 72, height: 24 });
    expect(quality).toMatchObject({ wordCuts: 0, crossings: 0, bends: { total: 0, max: 0 }, maxArrowheadsOnSide: 1,
      expansionRatio: 1, droppedEdges: 0, droppedLabels: 0, pages: 1 });
    expect(quality.edges).toHaveLength(1);
    expect(input.text).toBe(before.text); expect(input.canvas.grid.char).toEqual(before.chars);
    expect(JSON.stringify(input.layout.ports)).toBe(before.ports); expect(JSON.stringify(input.report.ledger)).toBe(before.ledger);
  });

  it("rejects invalid budgets rather than emitting non-finite JSON metrics", () => {
    for (const width of [0, -1, 1.5, Infinity, NaN]) expect(() => computeGlyphDiagramQuality(result(page()), { width, height: 5 })).toThrow(RangeError);
  });
});
