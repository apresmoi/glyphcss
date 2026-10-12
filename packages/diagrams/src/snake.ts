import type { GlyphCanvasDirection } from "glyphcss";
import { GLYPH_DIAGRAM_DIRECTIONS, backEdgeIds, type GlyphDiagramLayout, type GlyphDiagramMeasuredGraph, type GlyphDiagramMeasuredNode, type GlyphDiagramPositionedNode, type GlyphDiagramPositionedPort } from "./pipeline";
import { ledgerLayoutWrapped } from "./ledger";

/**
 * `gap`: columns between neighbours. `branchGap`: rows between a main-path
 * row and the branches hanging under it. `rowGap`: rows between one row's
 * lowest box and the next row. The fitter searches the two row gaps: each
 * edge turning through a gap needs a row of its own.
 */
export interface GlyphDiagramSnakeOptions { readonly width: number; readonly gap: number; readonly margin: number; readonly branchGap: number; readonly rowGap: number }

/**
 * A left-to-right graph too wide for its budget, laid out like text: the
 * main path (the longest chain from a start, loops broken at the authored
 * first node) fills a row and wraps onto the next, and every other node
 * hangs under the main-path node it connects to. Each connection then
 * leaves and enters on the side facing the other end, and the ordinary
 * router draws it. Returns undefined when the graph has no long path to
 * wrap, has groups, or a branch cannot hang under its anchor.
 */
export function glyphDiagramSnakeLayout(measured: GlyphDiagramMeasuredGraph, options: GlyphDiagramSnakeOptions): GlyphDiagramLayout | undefined {
  if (measured.direction !== "LR" || measured.groups.length > 0) return undefined;
  const { width, gap, margin, branchGap, rowGap } = options;
  const order = new Map(measured.nodes.map((node, i) => [node.id, i]));
  const back = backEdgeIds(measured.nodes, measured.edges);
  const forward = measured.edges.filter((edge) => edge.from !== edge.to && !back.has(edge.id));
  if (forward.length !== measured.edges.filter((edge) => !back.has(edge.id)).length) return undefined;

  // Longest path over the loop-free edges, ties to the authored-first node.
  const indegree = new Map(measured.nodes.map((node) => [node.id, 0]));
  for (const edge of forward) indegree.set(edge.to, indegree.get(edge.to)! + 1);
  const ready = measured.nodes.filter((node) => indegree.get(node.id) === 0).map((node) => node.id);
  const depth = new Map<string, number>(), parent = new Map<string, string>();
  while (ready.length > 0) {
    ready.sort((a, b) => order.get(a)! - order.get(b)!);
    const id = ready.shift()!;
    const d = depth.get(id) ?? 0;
    depth.set(id, d);
    for (const edge of forward.filter((e) => e.from === id).sort((a, b) => order.get(a.to)! - order.get(b.to)!)) {
      if ((depth.get(edge.to) ?? -1) < d + 1) { depth.set(edge.to, d + 1); parent.set(edge.to, id); }
      indegree.set(edge.to, indegree.get(edge.to)! - 1);
      if (indegree.get(edge.to) === 0) ready.push(edge.to);
    }
  }
  let end = measured.nodes[0]!.id;
  for (const node of measured.nodes) if (depth.get(node.id)! > depth.get(end)!) end = node.id;
  const spine = [end];
  while (parent.has(spine[0]!)) spine.unshift(parent.get(spine[0]!)!);
  if (spine.length < 3) return undefined;
  const onSpine = new Set(spine);

  // Each other node hangs under the main-path node it touches, preferring
  // the one it comes from; a node touching only branches follows them.
  const anchor = new Map<string, string>();
  for (let changed = true; changed;) {
    changed = false;
    for (const node of measured.nodes) {
      if (onSpine.has(node.id) || anchor.has(node.id)) continue;
      const touching = [
        ...measured.edges.filter((e) => e.to === node.id).map((e) => e.from),
        ...measured.edges.filter((e) => e.from === node.id).map((e) => e.to),
      ].filter((id) => onSpine.has(id) || anchor.has(id));
      if (touching.length > 0) { anchor.set(node.id, touching[0]!); changed = true; }
    }
  }
  if (anchor.size + spine.length !== measured.nodes.length) return undefined;

  const label = (from: string, to: string) => Math.max(0, ...measured.edges.filter((e) => e.from === from && e.to === to).map((e) => (e.label ?? "").length));
  const pitch = (from: string, to: string) => Math.max(gap, label(from, to) + 4);
  let sizes = new Map(measured.nodes.map((node) => [node.id, { width: node.width, height: node.height }]));
  for (let pass = 0; pass < 4; pass++) {
    const placed = place(spine, anchor, measured.nodes, sizes, { width, margin, gap, branchGap, rowGap }, pitch);
    if (!placed) return undefined;
    const sides = portSides(measured, placed.rects);
    const grown = growForPorts(sizes, sides);
    if (grown) { sizes = grown; continue; }
    const ports = straightenDrops(measured, anchor, assignPorts(sides, placed.rects), placed.rects);
    const nodes: GlyphDiagramPositionedNode[] = measured.nodes.map((node) => ({ ...node, ...sizes.get(node.id)!, ...placed.rects.get(node.id)! }));
    return {
      nodes, edges: measured.edges, groups: [], ports, direction: "LR",
      width: Math.max(...nodes.map((n) => n.x1)) + 1 + margin, height: Math.max(...nodes.map((n) => n.y1)) + 1 + margin,
      ledger: [...measured.ledger, ledgerLayoutWrapped({ rows: placed.rows, path: spine })],
    };
  }
  return undefined;
}

type Rect = { x0: number; y0: number; x1: number; y1: number };
type Size = { width: number; height: number };

function place(spine: readonly string[], anchor: ReadonlyMap<string, string>, nodes: readonly GlyphDiagramMeasuredNode[], sizes: ReadonlyMap<string, Size>,
  { width, margin, gap, branchGap, rowGap }: GlyphDiagramSnakeOptions, pitch: (from: string, to: string) => number): { rects: Map<string, Rect>; rows: number } | undefined {
  const right = width - margin;
  const rows: string[][] = [[]];
  let cursor = margin;
  for (const [i, id] of spine.entries()) {
    const w = sizes.get(id)!.width;
    const row = rows[rows.length - 1]!;
    const start = row.length === 0 ? margin : cursor + pitch(spine[i - 1]!, id);
    if (row.length > 0 && start + w > right) { rows.push([id]); cursor = margin + w; continue; }
    row.push(id); cursor = start + w;
  }
  const rects = new Map<string, Rect>();
  let top = margin;
  for (const row of rows) {
    const rowHeight = Math.max(...row.map((id) => sizes.get(id)!.height));
    let x = margin;
    for (const [i, id] of row.entries()) {
      if (i > 0) x += pitch(row[i - 1]!, id);
      const { width: w, height: h } = sizes.get(id)!;
      const y0 = top + Math.floor((rowHeight - h) / 2);
      rects.set(id, { x0: x, y0, x1: x + w - 1, y1: y0 + h - 1 });
      x += w;
    }
    let bottom = top + rowHeight - 1;
    const branches = nodes.filter((node) => anchor.has(node.id) && row.includes(rootOf(node.id, anchor)));
    if (branches.length > 0) {
      const bandTop = bottom + 1 + branchGap;
      const bandHeight = Math.max(...branches.map((node) => sizes.get(node.id)!.height));
      // Direct branches in their anchors' order, each followed by the nodes
      // hanging off it, so a branch's own chain reads left to right.
      const band: string[] = [];
      const follow = (id: string) => { band.push(id); for (const child of branches) if (anchor.get(child.id) === id) follow(child.id); };
      for (const node of [...branches].filter((n) => row.includes(anchor.get(n.id)!)).sort((a, b) => rects.get(anchor.get(a.id)!)!.x0 - rects.get(anchor.get(b.id)!)!.x0)) follow(node.id);
      // Each direct branch wants its top port straight under its anchor's
      // bottom port (both centred the way `assignPorts` centres a lone port);
      // a follower wants to sit right after its parent. Pack left to right
      // from those wishes, then pull back from the right edge, so a crowded
      // band slides left rather than giving up.
      const xs: number[] = [];
      for (const [i, id] of band.entries()) {
        const w = sizes.get(id)!.width, home = rects.get(anchor.get(id)!);
        const centre = home ? home.x0 + Math.floor((home.x1 - home.x0) / 2) : undefined;
        const wish = centre === undefined ? margin : centre - Math.floor((w - 1) / 2);
        xs.push(Math.max(i === 0 ? margin : xs[i - 1]! + sizes.get(band[i - 1]!)!.width + gap, wish));
      }
      for (let i = band.length - 1; i >= 0; i--) {
        const limit = i === band.length - 1 ? right : xs[i + 1]! - gap;
        xs[i] = Math.min(xs[i]!, limit - sizes.get(band[i]!)!.width);
      }
      if (xs[0]! < margin) return undefined;
      for (const [i, id] of band.entries()) {
        const { width: w, height: h } = sizes.get(id)!;
        rects.set(id, { x0: xs[i]!, y0: bandTop, x1: xs[i]! + w - 1, y1: bandTop + h - 1 });
      }
      bottom = bandTop + bandHeight - 1;
    }
    top = bottom + 1 + rowGap;
  }
  return { rects, rows: rows.length };
}

function rootOf(id: string, anchor: ReadonlyMap<string, string>): string {
  let at = id;
  while (anchor.has(at)) at = anchor.get(at)!;
  return at;
}

interface Side { readonly edgeId: string; readonly nodeId: string; readonly end: "from" | "to"; readonly side: GlyphCanvasDirection; readonly other: string }

/** Each end leaves on the side facing the other end: across within a row, down to a lower row, and into a higher row from below. */
function portSides(measured: GlyphDiagramMeasuredGraph, rects: ReadonlyMap<string, Rect>): Side[] {
  const sides: Side[] = [];
  for (const edge of measured.edges) {
    const a = rects.get(edge.from)!, b = rects.get(edge.to)!;
    let from: GlyphCanvasDirection, to: GlyphCanvasDirection;
    if (edge.from === edge.to) { from = "e"; to = "w"; }
    else if (b.y0 <= a.y1 && b.y1 >= a.y0) { [from, to] = b.x0 > a.x1 ? ["e", "w"] : ["w", "e"]; }
    else if (b.y0 > a.y1) { from = "s"; to = "n"; }
    else { to = "s"; from = b.x1 < a.x0 ? "w" : b.x0 > a.x1 ? "e" : "n"; }
    sides.push({ edgeId: edge.id, nodeId: edge.from, end: "from", side: from, other: edge.to });
    sides.push({ edgeId: edge.id, nodeId: edge.to, end: "to", side: to, other: edge.from });
  }
  return sides;
}

/** Same capacity rule as `reserveGlyphGraphPorts`: a side holding k ports needs 2k + 1 cells. Undefined when nothing had to grow. */
function growForPorts(sizes: ReadonlyMap<string, Size>, sides: readonly Side[]): Map<string, Size> | undefined {
  let grew = false;
  const next = new Map(sizes);
  for (const [id, size] of sizes) {
    let { width: w, height: h } = size;
    for (const side of ["n", "e", "s", "w"] as const) {
      const min = 2 * sides.filter((s) => s.nodeId === id && s.side === side).length + 1;
      if (side === "n" || side === "s") w = Math.max(w, min); else h = Math.max(h, min);
    }
    if (w !== size.width || h !== size.height) { grew = true; next.set(id, { width: w, height: h }); }
  }
  return grew ? next : undefined;
}

/**
 * A crowded hanging row can't always slide its box under the exit feeding
 * it, but a lone top entry can sit anywhere along the top edge: move it
 * under the exit when that falls inside the box, so the drop runs straight.
 */
function straightenDrops(measured: GlyphDiagramMeasuredGraph, anchor: ReadonlyMap<string, string>, ports: readonly GlyphDiagramPositionedPort[], rects: ReadonlyMap<string, Rect>): GlyphDiagramPositionedPort[] {
  return ports.map((port) => {
    const edge = measured.edges.find((e) => e.id === port.edgeId)!;
    if (port.end !== "to" || port.side !== "n" || anchor.get(edge.to) !== edge.from) return port;
    if (ports.some((p) => p !== port && p.nodeId === port.nodeId && p.side === "n")) return port;
    const out = ports.find((p) => p.edgeId === port.edgeId && p.end === "from")!;
    const box = rects.get(port.nodeId)!;
    if (out.side !== "s" || out.anchor.x <= box.x0 || out.anchor.x >= box.x1) return port;
    const anchorPoint = { x: out.anchor.x, y: box.y0 };
    return { ...port, offset: out.anchor.x - box.x0, anchor: anchorPoint, escape: { x: anchorPoint.x, y: anchorPoint.y - 1 } };
  });
}

function assignPorts(sides: readonly Side[], rects: ReadonlyMap<string, Rect>): GlyphDiagramPositionedPort[] {
  const ports: GlyphDiagramPositionedPort[] = [];
  const groups = new Map<string, Side[]>();
  for (const s of sides) groups.set(`${s.nodeId}\u0000${s.side}`, [...(groups.get(`${s.nodeId}\u0000${s.side}`) ?? []), s]);
  for (const list of groups.values()) {
    const node = rects.get(list[0]!.nodeId)!, side = list[0]!.side;
    const across = side === "n" || side === "s";
    const centre = (id: string) => { const r = rects.get(id)!; return across ? r.x0 + r.x1 : r.y0 + r.y1; };
    list.sort((p, q) => centre(p.other) - centre(q.other) || (p.edgeId < q.edgeId ? -1 : 1));
    const length = across ? node.x1 - node.x0 + 1 : node.y1 - node.y0 + 1;
    list.forEach((s, i) => {
      const offset = Math.floor((length - 1 - 2 * (list.length - 1)) / 2) + 2 * i;
      const anchorPoint = across ? { x: node.x0 + offset, y: side === "n" ? node.y0 : node.y1 } : { x: side === "w" ? node.x0 : node.x1, y: node.y0 + offset };
      const delta = GLYPH_DIAGRAM_DIRECTIONS[side];
      ports.push({ edgeId: s.edgeId, nodeId: s.nodeId, end: s.end, side, offset, anchor: anchorPoint, escape: { x: anchorPoint.x + delta.x, y: anchorPoint.y + delta.y } });
    });
  }
  return ports;
}
