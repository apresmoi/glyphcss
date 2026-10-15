import { GLYPH_DIAGRAM_DIAMOND_MARKER } from "./presentation";
import { GLYPH_DIAGRAM_BRANCH_LABEL, GLYPH_DIAGRAM_ROUTE_TOUCH } from "./layoutHints";
import { glyphDiagramLabelLayout, glyphDiagramRectsOverlap, type GlyphDiagramLabelCandidate } from "./labels";
import { glyphDiagramGroupRects, type GlyphDiagramLayout } from "./pipeline";
import { glyphDiagramLoopGeometry } from "./loop";
import type { GlyphDiagramRoutingResult } from "./route";
import type { GlyphDiagramRenderOptions } from "./renderTypes";

/** Shared reservation/placement, independent of output encoding and colour callbacks. */
export function glyphDiagramGraphLabels(layout: GlyphDiagramLayout, routing: GlyphDiagramRoutingResult,
  options: GlyphDiagramRenderOptions & { width: number; height: number }) {
  const candidates: GlyphDiagramLabelCandidate[] = [];
  const groups = glyphDiagramGroupRects(layout, { cols: options.width, rows: options.height });
  const drawn = new Map(groups);
  for (const group of layout.groups) {
    const nodes = layout.nodes.filter(node => group.members.includes(node.id));
    const rect = groups.get(group.id);
    if (!rect) continue;
    const unrelated = layout.nodes.some(node => !group.members.includes(node.id) && glyphDiagramRectsOverlap(node, rect));
    const partial = layout.groups.some(other => other.id !== group.id && group.members.some(id => other.members.includes(id))
      && !group.members.every(id => other.members.includes(id)) && !other.members.every(id => group.members.includes(id)));
    if (unrelated || partial) {
      drawn.delete(group.id);
      candidates.push({ id: `group:${group.id}`, text: `${group.label ?? group.id}: ${nodes.map(node => node.label).join(", ")}`,
        x: Math.floor(options.width / 2), y: rect.y0, priority: 1 });
    } else if (group.label) candidates.push({ id: `group:${group.id}`, text: group.label,
      x: Math.floor((rect.x0 + rect.x1) / 2), y: rect.y0, priority: 1, maxWidth: rect.x1 - rect.x0 - 1 });
  }
  const counts = new Map<string, number>();
  for (const route of routing.routes) for (const cell of route.cells) {
    const key = `${cell.x},${cell.y}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  for (const route of routing.routes) if (route.edge.label) {
    const loop = layout.loops.find(item => item.edgeId === route.edge.id);
    if (loop) {
      const room = glyphDiagramLoopGeometry(layout).find(g => g.loop === loop)?.label;
      if (room) loop.lines.forEach((text, i) => {
        const id = i === 0 ? `edge:${route.edge.id}` : `edge-row:${JSON.stringify([route.edge.id, i])}`;
        const y = room.y0 + i;
        candidates.push({ id, text, x: room.x0, y, place: { x: room.x0, y },
          reserve: { x0: room.x0, x1: room.x1, y0: y, y1: y }, priority: route.edge.priority });
      });
    } else {
      const branch = route.cells.filter(cell => counts.get(`${cell.x},${cell.y}`) === 1);
      const mid = branch[Math.floor(branch.length / 2)] ?? route.cells[Math.floor(route.cells.length / 2)]!;
      const avoid = layout.groups.filter(group => drawn.has(group.id) && !group.members.includes(route.edge.from) && !group.members.includes(route.edge.to))
        .map(group => ({ groupId: group.id, rect: drawn.get(group.id)! }));
      const fan = !layout.loops.length && !layout.nodes.some(node => node.shape === "point")
        && layout.ports.some(port => port.edgeId === route.edge.id && port.end === "from" && port.trunk)
        && (route.edge.label.length > layout.nodes.find(node => node.id === route.edge.to)!.width - 4 || /\s/.test(route.edge.label));
      const entry = layout.ports.find(port => port.edgeId === route.edge.id && port.end === "to")!;
      candidates.push({ id: `edge:${route.edge.id}`, text: route.edge.label, x: fan ? entry.anchor.x : mid.x, y: mid.y,
        route: branch, [GLYPH_DIAGRAM_BRANCH_LABEL]: fan,
        [GLYPH_DIAGRAM_ROUTE_TOUCH]: layout.nodes.some(node => node.id === route.edge.from && node[GLYPH_DIAGRAM_DIAMOND_MARKER])
          && layout.ports.some(port => port.edgeId === route.edge.id && port.end === "from" && port.trunk), maxWidth: options.width, priority: route.edge.priority, avoid });
    }
  }
  if (options.title) candidates.push({ id: "title", text: options.title, x: Math.floor(options.width / 2), y: 0, priority: Infinity });
  // External text clears boxes and vertical stems by one cell.
  const obstacles = [...layout.nodes.map(n => ({ x0: n.x0 - 1, y0: n.y0 - 1, x1: n.x1 + 1, y1: n.y1 + 1 })),
    ...routing.routes.flatMap(route => route.cells.map((p, i) => {
      const prev = route.cells[i - 1], next = route.cells[i + 1];
      const vertical = prev?.x === p.x || next?.x === p.x;
      return { x0: p.x - Number(vertical), y0: p.y, x1: p.x + Number(vertical), y1: p.y };
    }))];
  return glyphDiagramLabelLayout(candidates, { charset: options.charset, viewport: { cols: options.width, rows: options.height }, obstacles });
}
