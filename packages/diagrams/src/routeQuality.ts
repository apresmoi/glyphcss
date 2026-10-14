import type { GlyphDiagramLayout } from "./pipeline";
import type { GlyphDiagramRoute } from "./route";

/** Geometry shared by fitting and offline reporting; encoding never enters the score. */
export function glyphDiagramRouteQuality(layout: GlyphDiagramLayout, routes: readonly GlyphDiagramRoute[]) {
  const edges: { edgeId: string; bends: number; routeCells: number; portDistance: number; detourRatio: number | null }[] = [];
  // A crossing is one cell traversed straight through on both axes by different
  // routes. Shared endpoints, collinear strokes and corner contacts are not crossings.
  const crossingAxes = new Map<string, { h: Set<string>; v: Set<string> }>();
  for (const route of routes) {
    let bends = 0;
    route.cells.forEach((cell, i) => {
      const prev = route.cells[i - 1], next = route.cells[i + 1];
      if (!prev || !next) return;
      const incoming = { x: cell.x - prev.x, y: cell.y - prev.y };
      const outgoing = { x: next.x - cell.x, y: next.y - cell.y };
      if (incoming.x !== outgoing.x || incoming.y !== outgoing.y) { bends++; return; }
      const key = `${cell.x},${cell.y}`;
      const axes = crossingAxes.get(key) ?? { h: new Set<string>(), v: new Set<string>() };
      axes[incoming.y === 0 ? "h" : "v"].add(route.edge.id);
      crossingAxes.set(key, axes);
    });
    const from = layout.ports.find((port) => port.edgeId === route.edge.id && port.end === "from")!;
    const to = layout.ports.find((port) => port.edgeId === route.edge.id && port.end === "to")!;
    // Routes include escape cells, not border anchors. Use those same ports in
    // the denominator; count cells literally (a d-step straight walk has d+1 cells).
    const portDistance = Math.abs(from.escape.x - to.escape.x) + Math.abs(from.escape.y - to.escape.y);
    edges.push({ edgeId: route.edge.id, bends, routeCells: route.cells.length,
      portDistance, detourRatio: portDistance === 0 ? null : route.cells.length / portDistance });
  }
  const crossings = [...crossingAxes.values()].filter(({ h, v }) => [...h].some((id) => [...v].some((other) => other !== id))).length;
  return { crossings, edges, fakeFrames: glyphDiagramFakeFrames(layout, routes).length };
}

/** Parallel route segments enclosing an unrelated box can read as a group border. */
export function glyphDiagramFakeFrames(layout: GlyphDiagramLayout, routes: readonly GlyphDiagramRoute[]) {
  const segments: { axis: "h" | "v"; at: number; lo: number; hi: number; from: string; to: string; edgeId: string }[] = [];
  for (const route of routes) {
    let start = 0;
    for (let i = 1; i < route.cells.length; i++) {
      const a = route.cells[start]!, b = route.cells[i]!, next = route.cells[i + 1];
      const horizontal = a.y === b.y;
      if (next && (horizontal ? next.y === b.y : next.x === b.x)) continue;
      segments.push({ axis: horizontal ? "h" : "v", at: horizontal ? a.y : a.x,
        lo: horizontal ? Math.min(a.x, b.x) : Math.min(a.y, b.y),
        hi: horizontal ? Math.max(a.x, b.x) : Math.max(a.y, b.y), from: route.edge.from, to: route.edge.to, edgeId: route.edge.id });
      start = i;
    }
  }
  const frames: { edgeIds: readonly string[]; nodeIds: readonly string[] }[] = [];
  for (let i = 0; i < segments.length; i++) for (let j = i + 1; j < segments.length; j++) {
    const a = segments[i]!, b = segments[j]!;
    if (a.axis !== b.axis || a.at === b.at) continue;
    const lo = Math.max(a.lo, b.lo), hi = Math.min(a.hi, b.hi);
    const encloses = (n: GlyphDiagramLayout["nodes"][number]) => ![a.from, a.to, b.from, b.to].includes(n.id) && (a.axis === "h"
      ? n.x0 >= lo && n.x1 <= hi && n.y0 > Math.min(a.at, b.at) && n.y1 < Math.max(a.at, b.at)
      : n.y0 >= lo && n.y1 <= hi && n.x0 > Math.min(a.at, b.at) && n.x1 < Math.max(a.at, b.at));
    const enclosed = layout.nodes.filter(encloses);
    if (enclosed.length) frames.push({ edgeIds: [a.edgeId, b.edgeId], nodeIds: enclosed.map(node => node.id) });
  }
  return frames;
}
