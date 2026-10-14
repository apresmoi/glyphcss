import { backEdgeIds, glyphDiagramFoldLabel, glyphDiagramWrap, GLYPH_DIAGRAM_DIRECTIONS, type GlyphDiagramEdge, type GlyphDiagramLayout, type GlyphDiagramMeasuredGraph, type GlyphDiagramPositionedPort } from "./pipeline";
import type { GlyphCanvasDirection, GlyphCanvasTierName } from "glyphcss";

interface GlyphDiagramCyclePaths {
  readonly spine: readonly string[];
  readonly band: readonly string[];
  readonly feederIds: ReadonlySet<string>;
  readonly back: ReadonlySet<string>;
  readonly forward: readonly GlyphDiagramEdge[];
}
/** One topology check shared by fitting and cycle geometry. */
export function glyphDiagramCyclePaths(measured: GlyphDiagramMeasuredGraph): GlyphDiagramCyclePaths | undefined {
  if (measured.direction !== "LR" || measured.groups.length || measured.loops.length || measured.nodes.some(node => node.shape === "point")) return undefined;
  const back = backEdgeIds(measured.nodes, measured.edges);
  if (back.size !== 1) return undefined;
  const closing = measured.edges.find(edge => back.has(edge.id))!;
  const forward = measured.edges.filter(edge => !back.has(edge.id));
  if (forward.some(edge => edge.label) || !measured.nodes.some(node => forward.filter(edge => edge.from === node.id).length > 1)) return undefined;
  const order = new Map(measured.nodes.map((node, i) => [node.id, i]));
  const outgoing = (id: string) => forward.filter(edge => edge.from === id).sort((a, b) => order.get(a.to)! - order.get(b.to)!);
  const paths = new Map<string, string[]>();
  const path = (id: string): string[] => {
    const known = paths.get(id);
    if (known) return known;
    const next = outgoing(id).map(edge => path(edge.to)).sort((a, b) => b.length - a.length || order.get(a[0]!)! - order.get(b[0]!)!)[0] ?? [];
    const result = [id, ...next]; paths.set(id, result); return result;
  };
  const spine = path(closing.to);
  if (!spine.includes(closing.from)) return undefined;
  const main = new Set(spine), used = new Set(spine);
  const feeders = measured.nodes.filter(node => !used.has(node.id) && !forward.some(edge => edge.to === node.id));
  if (feeders.some(node => outgoing(node.id).length !== 1 || !main.has(outgoing(node.id)[0]!.to))) return undefined;
  feeders.forEach(node => used.add(node.id));
  const band = feeders.map(node => node.id);
  for (const id of spine) {
    const roots = outgoing(id).filter(edge => !used.has(edge.to));
    // Leaves go before continuing branches, so their bus does not span an unrelated chain.
    roots.sort((a, b) => path(a.to).length - path(b.to).length || order.get(a.to)! - order.get(b.to)!);
    for (const edge of roots) {
      let at: string | undefined = edge.to;
      while (at && !main.has(at)) {
        if (used.has(at)) return undefined;
        used.add(at); band.push(at);
        const edges = outgoing(at);
        if (edges.length > 1) return undefined;
        at = edges[0]?.to;
      }
    }
  }
  if (used.size !== measured.nodes.length) return undefined;
  return { spine, band, feederIds: new Set(feeders.map(node => node.id)), back, forward };
}

/** Keep a cycle's forward path in one row, side paths below it, and its return above. */
export function glyphDiagramCycleLayout(measured: GlyphDiagramMeasuredGraph, options: { width: number; gap: number; margin: number; labelWidth?: number; charset?: GlyphCanvasTierName },
  paths = glyphDiagramCyclePaths(measured)): GlyphDiagramLayout | undefined {
  if (!paths) return undefined;
  const { spine, band, feederIds, back, forward } = paths;
  const main = new Set(spine);
  const feeders = measured.nodes.filter(node => feederIds.has(node.id));
  const outgoing = (id: string) => forward.filter(edge => edge.from === id);
  const byId = new Map(measured.nodes.map(node => [node.id, node]));
  const { gap, margin } = options;
  const stacked = spine.some(id => forward.filter(edge => !main.has(edge.from) && edge.to === id).length > 1);
  const columns = new Map(spine.map((id, i) => [id, i]));
  for (const id of band) {
    const parent = forward.find(edge => edge.to === id)?.from;
    columns.set(id, feederIds.has(id) ? columns.get(outgoing(id)[0]!.to)!
      : columns.get(parent!)! + (outgoing(id).length ? 1 : 0));
  }
  const widths = spine.map((id, i) => Math.max(byId.get(id)!.width, ...band.filter(child => stacked
    ? columns.get(child) === i : feederIds.has(child) && outgoing(child)[0]!.to === id).map(child => byId.get(child)!.width)));
  const corridors = new Set(stacked ? spine.filter(id => outgoing(id).some(edge => !main.has(edge.to) && columns.get(edge.to) !== columns.get(id) && outgoing(edge.to).some(next => main.has(next.to)))
    && band.some(child => columns.get(child) === columns.get(id))) : []);
  for (const id of corridors) {
    const col = columns.get(id)!;
    widths[col] = Math.max(widths[col]!, ...band.filter(child => columns.get(child) === col).map(child => byId.get(child)!.width + 3));
  }
  const xs = [margin];
  widths.slice(0, -1).forEach((width, i) => xs.push(xs[i]! + width + (outgoing(spine[i]!).length > 1 && feeders.some(node => outgoing(node.id)[0]!.to === spine[i]) ? gap : 1)));
  const rowWidth = xs.at(-1)! + widths.at(-1)! + margin;
  const bandWidth = stacked ? rowWidth : band.reduce((sum, id) => sum + byId.get(id)!.width, 0) + gap * Math.max(0, band.length - 1) + 2 * margin;
  if (Math.max(rowWidth, bandWidth) > options.width) return undefined;
  for (const id of corridors) {
    const node = byId.get(id)!, width = widths[columns.get(id)!]!;
    const lines = glyphDiagramWrap(glyphDiagramFoldLabel(node.label, options.charset), Math.min(width - 4 - (node.shape === "subroutine" ? 2 : 0), options.labelWidth ?? Infinity));
    byId.set(id, { ...node, lines, width, height: node.height + lines.length - node.lines.length });
  }
  const rowHeight = Math.max(...spine.map(id => byId.get(id)!.height));
  const bandHeight = Math.max(0, ...band.map(id => byId.get(id)!.height));
  const center = margin + 3 + Math.floor((rowHeight - 1) / 2);
  const nodes = spine.map((id, i) => {
    const node = byId.get(id)!;
    const x0 = xs[i]! + (stacked ? Math.floor((widths[i]! - 1) / 2) - Math.floor((node.width - 1) / 2) : Math.floor((widths[i]! - node.width) / 2)), y0 = center - Math.floor((node.height - 1) / 2);
    return { ...node, x0, x1: x0 + node.width - 1, y0, y1: y0 + node.height - 1 };
  });
  const bandTop = Math.max(...nodes.map(node => node.y1)) + 6;
  let x = margin;
  // Stack siblings in their spine column; reserve a side corridor where a
  // spine branch must pass the sibling below it on the way to a later column.
  const tops = new Map<string, number>();
  if (stacked) {
    const levels = new Map(spine.map(id => [id, 0]));
    const occupied = new Map<number, number>();
    const ordered = [...band].sort((a, b) => Number(!forward.some(edge => edge.to === a && main.has(edge.from))) - Number(!forward.some(edge => edge.to === b && main.has(edge.from))));
    for (const id of ordered) {
      const parent = forward.find(edge => edge.to === id)?.from, column = columns.get(id)!;
      const level = Math.max(1, levels.get(parent!) ?? 1, (occupied.get(column) ?? 0) + 1);
      levels.set(id, level); occupied.set(column, level);
    }
    let top = Math.max(...nodes.map(node => node.y1)) + 4;
    for (let level = 1; level <= Math.max(...levels.values()); level++) {
      const children = band.filter(id => levels.get(id) === level);
      const height = Math.max(...children.map(id => byId.get(id)!.height));
      for (const id of children) tops.set(id, top + Math.floor((height - 1) / 2) - Math.floor((byId.get(id)!.height - 1) / 2));
      top += height + 1;
    }
  }
  for (const id of band) {
    const node = byId.get(id)!, column = columns.get(id)!, x0 = stacked ? xs[column]! + (corridors.has(spine[column]!) ? 0 : Math.floor((widths[column]! - 1) / 2) - Math.floor((node.width - 1) / 2)) : x;
    const y0 = stacked ? tops.get(id)! : bandTop + Math.floor((bandHeight - node.height) / 2);
    nodes.push({ ...node, x0, x1: x0 + node.width - 1, y0, y1: y0 + node.height - 1 });
    x += node.width + gap;
  }
  const positioned = new Map(nodes.map(node => [node.id, node]));
  const sides = new Map<string, readonly [GlyphCanvasDirection, GlyphCanvasDirection]>();
  for (const edge of measured.edges) {
    const fromMain = main.has(edge.from), toMain = main.has(edge.to);
    sides.set(edge.id, back.has(edge.id) ? ["n", "n"] : feederIds.has(edge.from) ? ["n", "s"]
      : !fromMain && toMain ? [stacked || forward.filter(other => !main.has(other.from) && other.to === edge.to).length === 1 ? "e" : "s", "s"] : fromMain && !toMain ? (stacked
        ? ["s", columns.get(edge.to) !== columns.get(edge.from) && outgoing(edge.to).some(next => main.has(next.to)) ? "w" : "n"]
        : feeders.some(node => outgoing(node.id)[0]!.to === edge.from) ? ["e", "w"] : ["s", "n"])
      : stacked && !fromMain && !toMain && (positioned.get(edge.from)!.y0 + Math.floor((positioned.get(edge.from)!.height - 1) / 2))
        !== (positioned.get(edge.to)!.y0 + Math.floor((positioned.get(edge.to)!.height - 1) / 2)) ? ["s", "w"] : ["e", "w"]);
  }
  const ports: GlyphDiagramPositionedPort[] = [];
  for (const edge of measured.edges) for (const end of ["from", "to"] as const) {
    const node = positioned.get(end === "from" ? edge.from : edge.to)!;
    const side = sides.get(edge.id)![end === "from" ? 0 : 1];
    let offset = Math.floor(((side === "n" || side === "s" ? node.width : node.height) - 1) / 2);
    if (stacked && end === "from" && side === "s" && corridors.has(node.id)) offset = node.width - 2;
    const family = measured.edges.filter(other => !back.has(other.id) && (end === "from" ? other.from === node.id : other.to === node.id)
      && sides.get(other.id)![end === "from" ? 0 : 1] === side && (other.style ?? "solid") === (edge.style ?? "solid"));
    // A join below the main row must have a clear vertical channel through the side band.
    if (!stacked && main.has(node.id) && end === "to" && side === "s" && !feederIds.has(edge.from)) {
      const room = Array.from({ length: node.width - 2 }, (_, i) => node.x0 + i + 1).filter(x => !nodes.some(other => !main.has(other.id) && x >= other.x0 - 1 && x <= other.x1 + 1));
      room.sort((a, b) => Math.abs(a - node.x0 - offset) - Math.abs(b - node.x0 - offset));
      if (!room.length) return undefined;
      offset = room[0]! - node.x0;
    }
    if (feederIds.has(edge.from)) {
      const source = positioned.get(edge.from)!, target = positioned.get(edge.to)!;
      const sharedX = Math.floor((Math.max(source.x0, target.x0) + Math.min(source.x1, target.x1)) / 2);
      if (sharedX <= node.x0 || sharedX >= node.x1) return undefined;
      offset = sharedX - node.x0;
    }
    const anchor = side === "n" || side === "s" ? { x: node.x0 + offset, y: side === "n" ? node.y0 : node.y1 }
      : { x: side === "e" ? node.x1 : node.x0, y: node.y0 + offset };
    const delta = GLYPH_DIAGRAM_DIRECTIONS[side];
    ports.push({ edgeId: edge.id, nodeId: node.id, end, side, offset, anchor, escape: { x: anchor.x + delta.x, y: anchor.y + delta.y },
      ...(!back.has(edge.id) && family.length > 1 ? { trunk: JSON.stringify([node.id, side, end, edge.style ?? "solid"]) } : {}) });
  }
  return { ...measured, nodes, ports, width: Math.max(rowWidth, bandWidth), height: Math.max(...nodes.map(node => node.y1)) + 4 + margin };
}
