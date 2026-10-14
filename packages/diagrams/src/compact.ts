import type { GlyphCanvasPoint } from "glyphcss";
import type { GlyphDiagramLayout, GlyphDiagramRect } from "./pipeline";
import { glyphDiagramLoopGeometry } from "./loop";
import type { GlyphDiagramPlacedLabel } from "./labels";
import type { GlyphDiagramRoutingResult } from "./route";

/** Delete only pass-through slices: topology, labels and port clearance survive together. */
export function glyphDiagramCompactGeometry(layout: GlyphDiagramLayout, routing: GlyphDiagramRoutingResult,
  labels: readonly GlyphDiagramPlacedLabel[], bounds: { width: number; height: number }) {
  // Group padding is part of the frame contract; grouped layouts keep their existing geometry.
  if (layout.groups.length) return { layout, routing, labels: [...labels], ...bounds };
  let nodes = [...layout.nodes], ports = [...layout.ports], routes = [...routing.routes], placed = [...labels];
  let width = bounds.width, height = bounds.height;
  while (true) {
    const previousWidth = width, previousHeight = height;
    for (const axis of ["y", "x"] as const) {
      const vertical = axis === "y", lo = vertical ? "y0" : "x0", hi = vertical ? "y1" : "x1";
      const extent = vertical ? height : width;
      const protectedSlices = new Set<number>();
      const protect = (rect: GlyphDiagramRect) => {
        for (let i = rect[lo]; i <= rect[hi]; i++) protectedSlices.add(i);
      };
      for (const node of nodes) {
        if (!vertical || node.shape === "point") protect(node);
        else {
          protectedSlices.add(node.y0); protectedSlices.add(node.y1);
          const top = node.y0 + Math.floor((node.height - node.lines.length) / 2);
          for (let i = top; i < top + node.lines.length; i++) protectedSlices.add(i);
        }
      }
      for (const label of placed) protect(label);
      const current = { ...layout, nodes, ports };
      for (const loop of glyphDiagramLoopGeometry(current)) protect(loop.bounds);
      for (const port of ports) {
        protectedSlices.add(port.anchor[axis]); protectedSlices.add(port.escape[axis]);
      }
      for (const route of routes) route.cells.forEach((p, i) => {
        const prev = route.cells[i - 1], next = route.cells[i + 1];
        if (!prev || !next || prev[axis] === p[axis] || next[axis] === p[axis]) protectedSlices.add(p[axis]);
      });
      const acrossLo = vertical ? "x0" : "y0", acrossHi = vertical ? "x1" : "y1";
      const gaps: { start: number; end: number }[] = [];
      const reserveGap = (a: GlyphDiagramRect, b: GlyphDiagramRect, overlap: boolean) => {
        if (a[hi] < b[lo] && (!overlap || (a[acrossLo] <= b[acrossHi] && a[acrossHi] >= b[acrossLo]))) {
          gaps.push({ start: a[hi] + 1, end: b[lo] - 1 });
        }
      };
      for (const a of nodes) for (const b of nodes) if (a !== b) reserveGap(a, b, false);
      for (const a of nodes) for (const b of placed) { reserveGap(a, b, true); reserveGap(b, a, true); }
      for (const route of routes) for (const cell of route.cells) for (const label of placed) {
        const rect = { x0: cell.x, x1: cell.x, y0: cell.y, y1: cell.y };
        if (!vertical) { reserveGap(rect, label, true); reserveGap(label, rect, true); }
      }
      // A pass-through route must not become a false box side when its blank moat disappears.
      for (const route of routes) route.cells.forEach((p, i) => {
        const next = route.cells[i + 1];
        if (!next || p[axis] !== next[axis]) return;
        const segment = { x0: Math.min(p.x, next.x), x1: Math.max(p.x, next.x), y0: Math.min(p.y, next.y), y1: Math.max(p.y, next.y) };
        for (const node of nodes) { reserveGap(node, segment, true); reserveGap(segment, node, true); }
      });
      const removed = new Set<number>(), map: number[] = [];
      const prefix = [0];
      let shift = 0;
      for (let i = 0; i < extent; i++) {
        map[i] = i - shift;
        const tight = gaps.some(gap => i >= gap.start && i <= gap.end
          && gap.end - gap.start + 1 - (shift - prefix[gap.start]!) <= 1);
        if (!protectedSlices.has(i) && !tight) { removed.add(i); shift++; }
        prefix[i + 1] = shift;
      }
      const point = (p: GlyphCanvasPoint) => ({ ...p, [axis]: map[p[axis]]! });
      nodes = nodes.map(node => {
        const rect = { ...node, [lo]: map[node[lo]]!, [hi]: map[node[hi]]! };
        return { ...rect, width: rect.x1 - rect.x0 + 1, height: rect.y1 - rect.y0 + 1 };
      });
      ports = ports.map(port => {
        const anchor = point(port.anchor), escape = point(port.escape), node = nodes.find(n => n.id === port.nodeId)!;
        return { ...port, anchor, escape, offset: port.side === "n" || port.side === "s" ? anchor.x - node.x0 : anchor.y - node.y0 };
      });
      routes = routes.map(route => ({ ...route, cells: route.cells.filter(p => !removed.has(p[axis])).map(point) }));
      placed = placed.map(label => ({ ...label, [lo]: map[label[lo]]!, [hi]: map[label[hi]]!, [axis]: map[label[axis]]! }));
      if (vertical) height -= shift; else width -= shift;
    }
    if (width === previousWidth && height === previousHeight) break;
  }
  return { layout: { ...layout, nodes, ports, width, height }, routing: { ...routing, routes }, labels: placed, width, height };
}
