import { GLYPH_DIAGRAM_DIRECTIONS, glyphDiagramPortOffsets, glyphDiagramNodePortSide, type GlyphDiagramPositionedPort } from "./pipeline";
import { glyphDiagramFakeFrames, glyphDiagramRouteQuality } from "./routeQuality";
import { glyphDiagramGraphLabels } from "./graphLabels";
import { routeGlyphGraphEdges } from "./route";
import type { GlyphDiagramAttempt, GlyphDiagramFitOptions } from "./fit";
import { GLYPH_DIAGRAM_WORK } from "./work";

/** A layered embedding need not be planar with every edge on its flow sides.
 * Try attachment sides without changing node geometry.
 */
export function glyphDiagramRepairRouting(initial: GlyphDiagramAttempt, options: GlyphDiagramFitOptions, polish = false): GlyphDiagramAttempt {
  if (!initial.fits || initial.layout.loops.length || initial.layout.nodes.some(node => node.shape === "point")) return initial;
  const score = (result: GlyphDiagramAttempt) => {
    const quality = glyphDiagramRouteQuality(result.layout, result.routing.routes);
    return [result.layout.edges.filter(edge => !edge.invisible).length - result.routing.routes.length, quality.crossings, quality.fakeFrames,
      glyphDiagramGraphLabels(result.layout, result.routing, { ...options, width: result.width, height: result.height }).dropped.length,
      quality.edges.reduce((sum, edge) => sum + edge.bends, 0), quality.edges.reduce((sum, edge) => sum + edge.routeCells, 0)];
  };
  const better = (a: number[], b: number[]) => {
    if (a[0] === b[0] && a.slice(1, 4).some((value, i) => value > b[i + 1]!)) return false;
    const difference = a.findIndex((value, i) => value !== b[i]);
    return difference >= 0 && a[difference]! < b[difference]!;
  };
  let best = initial, bestScore = score(best);
  if (!polish && !bestScore[0] && !bestScore[1] && !bestScore[2]) return initial;
  let probes = 0;
  passes: for (let pass = 0; pass < 3; pass++) {
    const before = best;
    const affected = new Set(before.layout.edges.filter(edge => !before.routing.routes.some(route => route.edge.id === edge.id)).map(edge => edge.id));
    if (polish) for (const edge of glyphDiagramRouteQuality(before.layout, before.routing.routes).edges) if (edge.bends > 1) affected.add(edge.edgeId);
    const missing = glyphDiagramGraphLabels(before.layout, before.routing, { ...options, width: before.width, height: before.height }).dropped;
    for (const id of missing) if (id.startsWith("edge:")) affected.add(id.slice(5));
    for (const frame of glyphDiagramFakeFrames(before.layout, before.routing.routes)) for (const id of frame.edgeIds) affected.add(id);
    const axes = new Map<string, { h: Set<string>; v: Set<string> }>();
    for (const route of before.routing.routes) route.cells.forEach((cell, i, cells) => {
      const prev = cells[i - 1], next = cells[i + 1];
      if (!prev || !next || cell.x - prev.x !== next.x - cell.x || cell.y - prev.y !== next.y - cell.y) return;
      const at = axes.get(`${cell.x},${cell.y}`) ?? { h: new Set<string>(), v: new Set<string>() };
      at[prev.y === cell.y ? "h" : "v"].add(route.edge.id); axes.set(`${cell.x},${cell.y}`, at);
    });
    for (const { h, v } of axes.values()) if ([...h].some(id => [...v].some(other => other !== id))) for (const id of [...h, ...v]) affected.add(id);
    for (const edge of [...before.layout.edges].sort((a, b) =>
      Number(before.routing.routes.some(route => route.edge.id === a.id)) - Number(before.routing.routes.some(route => route.edge.id === b.id))
      || (polish ? (before.routing.routes.find(route => route.edge.id === b.id)?.cells.length ?? 0)
        - (before.routing.routes.find(route => route.edge.id === a.id)?.cells.length ?? 0) : 0))) {
      if (edge.invisible || !affected.has(edge.id)) continue;
      const pair = before.layout.ports.filter(port => port.edgeId === edge.id);
      // A shared bus and a composite frame own their attachment geometry.
      if (pair.some(port => port.trunk) || pair.length !== 2) continue;
      const move = (port: GlyphDiagramPositionedPort, side: GlyphDiagramPositionedPort["side"]) => {
        if (side === port.side) return port;
        const node = before.layout.nodes.find(node => node.id === port.nodeId)!;
        if (glyphDiagramNodePortSide(node, side) !== side) return;
        const other = pair.find(other => other !== port)!;
        const length = side === "n" || side === "s" ? node.width : node.height;
        const peers = before.layout.ports.filter(peer => peer.nodeId === node.id && peer.edgeId !== edge.id && peer.side === side);
        const desired = side === "n" || side === "s" ? other.anchor.x - node.x0 : other.anchor.y - node.y0;
        const offsets = Array.from({ length: length - 2 }, (_, i) => i + 1)
          .filter(offset => !peers.some(peer => Math.abs(peer.offset - offset) < 2)
            && glyphDiagramPortOffsets(node, side, [offset])?.[0] === offset)
          .sort((a, b) => Math.abs(a - desired) - Math.abs(b - desired) || a - b);
        const offset = offsets[0];
        if (offset === undefined) return;
        const anchor = side === "n" || side === "s" ? { x: node.x0 + offset, y: side === "n" ? node.y0 : node.y1 }
          : { x: side === "w" ? node.x0 : node.x1, y: node.y0 + offset };
        const delta = GLYPH_DIAGRAM_DIRECTIONS[side];
        return { ...port, side, offset, anchor, escape: { x: anchor.x + delta.x, y: anchor.y + delta.y } };
      };
      const from = pair.find(port => port.end === "from")!, to = pair.find(port => port.end === "to")!;
      // Facing attachments remove a detour sooner than rotating both ends
      // around the compass. Keep unchanged ends in the same candidate pool.
      const sides = ["n", "e", "s", "w"] as const;
      const pairs = sides.flatMap(a => sides.flatMap(b => {
        if (a === from.side && b === to.side) return [];
        const exit = move(from, a), entry = move(to, b);
        if (!exit || !entry) return [];
        const dx = entry.escape.x - exit.escape.x, dy = entry.escape.y - exit.escape.y;
        const distance = Math.abs(dx) + Math.abs(dy);
        const away = Number(GLYPH_DIAGRAM_DIRECTIONS[a].x * dx + GLYPH_DIAGRAM_DIRECTIONS[a].y * dy < 0)
          + Number(GLYPH_DIAGRAM_DIRECTIONS[b].x * dx + GLYPH_DIAGRAM_DIRECTIONS[b].y * dy > 0);
        const bends = Number(dx !== 0 && dy !== 0) + Number((a === "n" || a === "s") === (b === "n" || b === "s") && dx !== 0 && dy !== 0);
        return [{ exit, entry, distance, away, bends }];
      })).sort((a, b) => a.away - b.away || a.bends - b.bends || a.distance - b.distance);
      const bends = glyphDiagramRouteQuality(before.layout, before.routing.routes).edges.find(item => item.edgeId === edge.id)?.bends;
      for (const { exit, entry, bends: minimumBends } of pairs) {
        if (polish && !bestScore.slice(0, 4).some(Boolean) && bends !== undefined && minimumBends >= bends) continue;
        if (++probes > 96) return best;
        const layout = { ...before.layout, ports: before.layout.ports.map(port => port === from ? exit : port === to ? entry : port) };
        const routing = routeGlyphGraphEdges(layout, { width: before.width, height: before.height, stopOnFailure: true,
          [GLYPH_DIAGRAM_WORK]: options[GLYPH_DIAGRAM_WORK] } as Parameters<typeof routeGlyphGraphEdges>[1]);
        const candidate = { ...before, layout, routing, okay: routing.unroutable.length === 0, adjusted: true };
        const candidateScore = score(candidate);
        if (better(candidateScore, bestScore)) { best = candidate; bestScore = candidateScore; }
        if (best !== before && !bestScore.slice(0, polish ? 4 : 3).some(Boolean)) {
          if (polish) continue passes;
          return best;
        }
      }
    }
    if (best === before) break;
  }
  return best;
}
