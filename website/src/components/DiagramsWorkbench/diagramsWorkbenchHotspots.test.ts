import { describe, expect, it } from "vitest";
import { GLYPH_DIAGRAM_WORKBENCH_PRESETS, createGlyphDiagramsWorkbenchState, reduceGlyphDiagramsWorkbenchState } from "../../features/diagrams/model/diagramsWorkbenchState";
import { glyphDiagramsWorkbenchHotspots, renderGlyphDiagramsWorkbenchState } from "../../features/diagrams/render/diagramsWorkbenchRender";
import { diagramsSourceLineOfId } from "../../features/diagrams/model/diagramsSourceAid";

// The hotspot anchors: the graph render carries every node's cell box and
// every edge's route runs in the JOINED text's row space — what
// `DiagramsHotspotLayer.tsx` lays real elements over — and each id resolves
// to a source line.
describe("glyphDiagramsWorkbenchHotspots", () => {
  const page = (rows: number, cols: number, nodes: { id: string; x0: number; y0: number; x1: number; y1: number }[], routes: { from: string; to: string; cells: [number, number][] }[] = []) =>
    ({ canvas: { grid: { rows, cols } }, layout: { nodes }, routes: routes.map((r) => ({ edge: { from: r.from, to: r.to }, cells: r.cells.map(([x, y]) => ({ x, y })) })) }) as unknown as Parameters<typeof glyphDiagramsWorkbenchHotspots>[0][number];
  it("offsets a later panel's rows by the earlier panels plus the blank line between them", () => {
    // Mutation: drop the `+ 1` for the blank separator line -> the second
    // panel's node lands one row early -> red.
    const { hotspots, grid } = glyphDiagramsWorkbenchHotspots([page(5, 20, [{ id: "a", x0: 1, y0: 1, x1: 4, y1: 3 }]), page(4, 18, [{ id: "b", x0: 2, y0: 0, x1: 6, y1: 2 }])]);
    expect(hotspots).toEqual([{ kind: "node", id: "a", x0: 1, y0: 1, x1: 4, y1: 3 }, { kind: "node", id: "b", x0: 2, y0: 6, x1: 6, y1: 8 }]);
    expect(grid).toEqual({ cols: 20, rows: 10 });
  });
  it("an edge's route becomes one box per straight run — a bend starts a new one — in the same offset row space", () => {
    // Mutation: drop the bend split -> one box spans the L, covering cells
    // the edge never visits -> red.
    const { hotspots } = glyphDiagramsWorkbenchHotspots([page(3, 10, []), page(6, 10, [], [{ from: "a", to: "b", cells: [[1, 1], [2, 1], [3, 1], [3, 2], [3, 3], [4, 3]] }])]);
    expect(hotspots).toEqual([
      { kind: "edge", from: "a", to: "b", x0: 1, y0: 5, x1: 3, y1: 5 },
      { kind: "edge", from: "a", to: "b", x0: 3, y0: 6, x1: 3, y1: 7 },
      { kind: "edge", from: "a", to: "b", x0: 4, y0: 7, x1: 4, y1: 7 },
    ]);
  });
  it.each(GLYPH_DIAGRAM_WORKBENCH_PRESETS)("the '$label' render carries a hotspot inside the grid for every node, and every id resolves to a source line", async (preset) => {
    const state = reduceGlyphDiagramsWorkbenchState(createGlyphDiagramsWorkbenchState(), { type: "apply-preset", id: preset.id });
    const rendered = await renderGlyphDiagramsWorkbenchState(state, { width: 900, height: 600 });
    expect(rendered.ok).toBe(true);
    if (!rendered.ok) return;
    expect(rendered.grid).toBeDefined();
    const nodes = rendered.hotspots!.filter((h): h is Extract<typeof h, { kind: "node" }> => h.kind === "node");
    const edges = rendered.hotspots!.filter((h): h is Extract<typeof h, { kind: "edge" }> => h.kind === "edge");
    const ids = new Set(nodes.map((h) => h.id));
    for (const edge of JSON.parse(state.json).edges as { from: string; to: string }[]) expect(edges.some((h) => h.from === edge.from && h.to === edge.to)).toBe(true);
    const dialect = state.sourceKind;
    for (const node of JSON.parse(state.json).nodes as { id: string }[]) {
      expect(ids.has(node.id)).toBe(true);
      const box = nodes.find((h) => h.id === node.id)!;
      expect(box.x1).toBeLessThan(rendered.grid!.cols);
      expect(box.y1).toBeLessThan(rendered.grid!.rows);
      expect(diagramsSourceLineOfId(dialect, state[dialect], node.id)).toBeDefined();
    }
    expect(rendered.text.split("\n").length).toBe(rendered.grid!.rows);
  });
});
