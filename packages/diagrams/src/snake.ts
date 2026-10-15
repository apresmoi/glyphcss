import type { GlyphCanvasDirection } from "glyphcss";
import { GLYPH_DIAGRAM_DIRECTIONS, backEdgeIds, glyphDiagramPointCell, glyphDiagramPortOffsets, type GlyphDiagramLayout, type GlyphDiagramMeasuredGraph, type GlyphDiagramMeasuredNode, type GlyphDiagramPositionedNode, type GlyphDiagramPositionedPort } from "./pipeline";
import { ledgerLayoutWrapped } from "./ledger";
import { glyphDiagramLoopGeometry, glyphDiagramLoopSlots, type GlyphDiagramLoopSlot } from "./loop";

/**
 * `gap`: columns between neighbours. `branchGap`: rows between a main-path
 * row and the branches hanging under it. `rowGap`: rows between one row's
 * lowest box and the next row. A list gives each row its own gap (the last
 * entry repeats). The fitter searches them: a gap only a straight drop
 * crosses needs one row, and each edge turning through it needs more.
 */
export interface GlyphDiagramSnakeOptions {
  readonly width: number; readonly gap: number; readonly margin: number;
  readonly branchGap: number | readonly number[]; readonly rowGap: number | readonly number[];
  /** Alternate reading direction when repeated row returns would enclose a box. */
  readonly reverseRows?: boolean;
}
const gapAt = (gap: number | readonly number[], row: number) => typeof gap === "number" ? gap : gap[Math.min(row, gap.length - 1)]!;

/**
 * A left-to-right graph too wide for its budget, laid out like text: the
 * main path (the longest chain from a start, loops broken at the authored
 * first node) fills a row and wraps onto the next, and every other node
 * hangs under the main-path node it connects to. Each connection then
 * leaves and enters on the side facing the other end, and the ordinary
 * router draws it. A self-edge is a decoration of its node, not part of the
 * path: its loop hangs below the node, other bottom exits start past the
 * loop's label, and the row makes room for what overhangs. Returns undefined
 * when the graph has no long path to wrap, has groups, or a branch cannot
 * hang under its anchor.
 */
export function glyphDiagramSnakeLayout(measured: GlyphDiagramMeasuredGraph, options: GlyphDiagramSnakeOptions): GlyphDiagramLayout | undefined {
  if (measured.direction !== "LR" || measured.groups.length > 0) return undefined;
  const { width, gap, margin, branchGap, rowGap, reverseRows } = options;
  const order = new Map(measured.nodes.map((node, i) => [node.id, i]));
  const back = backEdgeIds(measured.nodes, measured.edges);
  const flow = measured.edges.filter((edge) => edge.from !== edge.to);
  const forward = flow.filter((edge) => !back.has(edge.id));

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
        ...flow.filter((e) => e.to === node.id).map((e) => e.from),
        ...flow.filter((e) => e.from === node.id).map((e) => e.to),
      ].filter((id) => onSpine.has(id) || anchor.has(id));
      if (touching.length > 0) { anchor.set(node.id, touching[0]!); changed = true; }
    }
  }
  if (anchor.size + spine.length !== measured.nodes.length) return undefined;

  const label = (from: string, to: string) => Math.max(0, ...flow.filter((e) => e.from === from && e.to === to).map((e) => (e.label ?? "").length));
  const pitch = (from: string, to: string) => Math.max(gap, label(from, to) + 4);
  const entries = (id: string) => flow.filter((e) => e.to === id).length;
  // A point starts as its glyph; `growForPorts` gives it the columns its entries and the cells its ports need.
  let sizes = new Map(measured.nodes.map((node) => [node.id, { width: node.width, height: node.height }]));
  const pointIds = new Set(measured.nodes.filter((node) => node.shape === "point").map((node) => node.id));
  const loopsOf = (id: string) => glyphDiagramLoopSlots(measured.loops.filter((loop) => loop.nodeId === id), "s");
  for (let pass = 0; pass < 4; pass++) {
    // What a loop's label overhangs past its node's right edge keeps the next box away.
    const overhang = new Map(measured.nodes.map((node) => [node.id, Math.max(0, ...loopsOf(node.id).slots.map((slot) => slot.entry + slot.labelWidth + 2 - sizes.get(node.id)!.width))]));
    // A loop's label sits below its node, so it only pushes the next box away if that box reaches down to the label's rows.
    const labelRows = (id: string) => Math.max(0, ...loopsOf(id).slots.map((slot) => slot.lines.length));
    const loopDepth = (id: string) => loopsOf(id).slots.length ? Math.max(2, 1 + labelRows(id)) : 0;
    const between = (a: string, aTop: number, b: string, bTop: number) => {
      const rows = labelRows(a), aBottom = aTop + sizes.get(a)!.height - 1;
      return rows > 0 && aBottom + 2 <= bTop + sizes.get(b)!.height && aBottom + 1 + rows >= bTop - 1 ? overhang.get(a)! : 0;
    };
    // A point that opens a row has its entries on its west side, so it keeps the two columns an entry's lane needs.
    const lead = (id: string) => pointIds.has(id) && entries(id) > 0 ? 2 : 0;
    const turnOffset = (id: string) => {
      const from = loopSpan(loopsOf(id).slots);
      return from + Math.floor((sizes.get(id)!.width - from - 1) / 2);
    };
    const placed = place(spine, anchor, measured.nodes, sizes, overhang, between, lead, loopDepth, turnOffset, { width, margin, gap, branchGap, rowGap, reverseRows }, pitch);
    if (!placed) return undefined;
    const sides = portSides(flow, placed.rects, pointIds);
    const grown = growForPorts(measured, sizes, sides, loopsOf);
    if (grown) { sizes = grown; continue; }
    const ports = [...straightenDrops(flow, anchor, assignPorts(measured, sides, placed.rects, loopsOf), placed.rects, loopsOf), ...loopPorts(measured, placed.rects, loopsOf)];
    const nodes: GlyphDiagramPositionedNode[] = measured.nodes.map((node) => ({ ...node, ...sizes.get(node.id)!, ...placed.rects.get(node.id)! }));
    const loopBounds = glyphDiagramLoopGeometry({ ports, loops: measured.loops }).map((g) => g.bounds);
    return {
      nodes, edges: measured.edges, groups: [], ports, direction: "LR", loops: measured.loops,
      width: Math.max(...nodes.map((n) => n.x1), ...loopBounds.map((b) => b.x1)) + 1 + margin, height: Math.max(...nodes.map((n) => n.y1), ...loopBounds.map((b) => b.y1)) + 1 + margin,
      ledger: [...measured.ledger, ledgerLayoutWrapped({ rows: placed.rows, path: spine })],
    };
  }
  return undefined;
}

type Rect = { x0: number; y0: number; x1: number; y1: number };
type Size = { width: number; height: number };

function place(spine: readonly string[], anchor: ReadonlyMap<string, string>, nodes: readonly GlyphDiagramMeasuredNode[], sizes: ReadonlyMap<string, Size>, overhang: ReadonlyMap<string, number>, between: (a: string, aTop: number, b: string, bTop: number) => number, lead: (id: string) => number, loopDepth: (id: string) => number, turnOffset: (id: string) => number,
  { width, margin, gap, branchGap, rowGap, reverseRows }: GlyphDiagramSnakeOptions, pitch: (from: string, to: string) => number): { rects: Map<string, Rect>; rows: number } | undefined {
  const right = width - margin;
  const rows: string[][] = [[]];
  let cursor = margin;
  let turnCentre: number | undefined;
  let lastLeft = margin;
  for (const id of spine) {
    const w = sizes.get(id)!.width;
    const row = rows[rows.length - 1]!;
    // Vertical positions inside a row follow its tallest box, which this node may be.
    const rowHeight = Math.max(sizes.get(id)!.height, ...row.map((other) => sizes.get(other)!.height));
    const top = (other: string) => Math.floor((rowHeight - sizes.get(other)!.height) / 2);
    const prev = row[row.length - 1];
    const start = prev === undefined ? margin + lead(id) : cursor + between(prev, top(prev), id, top(id)) + pitch(prev, id);
    // A reflected row must fit beside its incoming turn, not merely inside
    // the viewport. Reserve that alignment while packing, before a full row
    // can force the whole-band shift to clamp and put jogs back in the turn.
    const first = row[0] ?? id, firstWidth = sizes.get(first)!.width;
    const delta = start - margin - lead(first);
    const x0 = turnCentre === undefined ? start : rows.length % 2 === 0
      ? turnCentre + Math.ceil((firstWidth - 1) / 2) - delta - w + 1
      : turnCentre - Math.floor((firstWidth - 1) / 2) + delta;
    if (row.length > 0 && (start + w + overhang.get(id)! > right
      || (reverseRows && (x0 < margin + lead(id) || x0 + w + overhang.get(id)! > right)))) {
      rows.push([id]); cursor = margin + lead(id) + w;
      turnCentre = reverseRows ? lastLeft + turnOffset(prev!) : undefined;
      lastLeft = turnCentre === undefined ? margin + lead(id) : turnCentre - Math.floor((w - 1) / 2);
      continue;
    }
    row.push(id); cursor = start + w; lastLeft = x0;
  }
  const rects = new Map<string, Rect>();
  let top = margin;
  for (const [rowIndex, row] of rows.entries()) {
    const branches = nodes.filter((node) => anchor.has(node.id) && row.includes(rootOf(node.id, anchor)));
    // The opening branch band sits outside the return corridor. Its whole
    // height is reserved before placing the spine and deriving any ports.
    const above = reverseRows && rowIndex === 0 && branches.length > 0;
    const bandHeight = Math.max(0, ...branches.map((node) => sizes.get(node.id)!.height));
    const aboveGap = Math.max(gapAt(branchGap, rowIndex), ...branches.map(node => loopDepth(node.id) + 1));
    if (above) top += bandHeight + aboveGap;
    const rowHeight = Math.max(...row.map((id) => sizes.get(id)!.height));
    let x = margin + lead(row[0]!);
    for (const [i, id] of row.entries()) {
      const { width: w, height: h } = sizes.get(id)!;
      const y0 = top + Math.floor((rowHeight - h) / 2);
      if (i > 0) { const prev = row[i - 1]!; x += between(prev, rects.get(prev)!.y0, id, y0) + pitch(prev, id); }
      rects.set(id, { x0: x, y0, x1: x + w - 1, y1: y0 + h - 1 });
      x += w;
    }
    let bottom = top + rowHeight - 1;
    if (branches.length > 0) {
      const bandTop = above ? margin : bottom + 1 + gapAt(branchGap, rowIndex);
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
        xs.push(Math.max(i === 0 ? margin : xs[i - 1]! + sizes.get(band[i - 1]!)!.width + between(band[i - 1]!, bandTop, id, bandTop) + gap, wish));
      }
      for (let i = band.length - 1; i >= 0; i--) {
        const id = band[i]!;
        const limit = i === band.length - 1 ? right - overhang.get(id)! : xs[i + 1]! - gap - between(id, bandTop, band[i + 1]!, bandTop);
        xs[i] = Math.min(xs[i]!, limit - sizes.get(id)!.width);
      }
      if (xs[0]! < margin) return undefined;
      for (const [i, id] of band.entries()) {
        const { width: w, height: h } = sizes.get(id)!;
        rects.set(id, { x0: xs[i]!, y0: bandTop, x1: xs[i]! + w - 1, y1: bandTop + h - 1 });
      }
      if (!above) bottom = bandTop + bandHeight - 1;
    }
    // A return across every row gap can look like a frame around the middle
    // row. Reflect complete bands before assigning ports so those turns can
    // run down alternating sides instead, using the same node/route families.
    if (reverseRows) {
      const band = [...row, ...branches.map(node => node.id)];
      if (rowIndex % 2 === 1) {
        const extent = Math.min(...band.map(id => rects.get(id)!.x0)) + Math.max(...band.map(id => rects.get(id)!.x1));
        for (const id of band) {
          const rect = rects.get(id)!;
          rects.set(id, { ...rect, x0: extent - rect.x1, x1: extent - rect.x0 });
        }
        // South loops still extend right after reflection. Repack each row
        // against that real footprint before choosing a whole-band shift.
        for (const line of [row, branches.map(node => node.id)]) {
          const ordered = [...line].sort((a, b) => rects.get(a)!.x0 - rects.get(b)!.x0);
          for (let i = 1; i < ordered.length; i++) {
            const a = ordered[i - 1]!, b = ordered[i]!;
            const previous = rects.get(a)!, current = rects.get(b)!;
            const required = between(a, previous.y0, b, current.y0) + (row.includes(a) && row.includes(b) ? pitch(b, a) : gap);
            const dx = Math.max(0, previous.x1 + 1 + required - current.x0);
            rects.set(b, { ...current, x0: current.x0 + dx, x1: current.x1 + dx });
          }
        }
      }
      if (rowIndex > 0) {
        // Turn ports use integer centres, past any source loop slots. Align
        // the whole band, bounded by point-entry and loop-label clearance.
        const previousRow = rows[rowIndex - 1]!;
        const previous = rects.get(previousRow[previousRow.length - 1]!)!, first = rects.get(row[0]!)!;
        const desired = previous.x0 + turnOffset(previousRow[previousRow.length - 1]!) - Math.floor((first.x0 + first.x1) / 2);
        const min = Math.max(...band.map(id => margin + lead(id) - rects.get(id)!.x0));
        const max = Math.min(...band.map(id => right - 1 - overhang.get(id)! - rects.get(id)!.x1));
        if (min > max) return undefined;
        const shift = Math.max(min, Math.min(max, desired));
        for (const id of band) {
          const rect = rects.get(id)!;
          rects.set(id, { ...rect, x0: rect.x0 + shift, x1: rect.x1 + shift });
        }
      }
    }
    top = bottom + 1 + gapAt(rowGap, rowIndex);
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
function portSides(edges: GlyphDiagramMeasuredGraph["edges"], rects: ReadonlyMap<string, Rect>, points: ReadonlySet<string>): Side[] {
  const sides: Side[] = [];
  for (const edge of edges) {
    const a = rects.get(edge.from)!, b = rects.get(edge.to)!;
    let from: GlyphCanvasDirection, to: GlyphCanvasDirection;
    if (b.y0 <= a.y1 && b.y1 >= a.y0) { [from, to] = b.x0 > a.x1 ? ["e", "w"] : ["w", "e"]; }
    else if (b.y0 > a.y1) { from = "s"; to = "n"; }
    else { to = "s"; from = b.x1 < a.x0 ? "w" : b.x0 > a.x1 ? "e" : "n"; }
    // A point is drawn left to right whatever else the snake does: edges enter on its west and leave on its east.
    sides.push({ edgeId: edge.id, nodeId: edge.from, end: "from", side: points.has(edge.from) ? "e" : from, other: edge.to });
    sides.push({ edgeId: edge.id, nodeId: edge.to, end: "to", side: points.has(edge.to) ? "w" : to, other: edge.from });
  }
  return sides;
}

/** The offset past which other exits below a node start: its last loop's label plus a blank column, or its last loop plus one. */
const loopSpan = (slots: readonly GlyphDiagramLoopSlot[]) => {
  const last = slots[slots.length - 1];
  return last === undefined ? 0 : last.labelWidth > 0 ? last.entry + last.labelWidth + 3 : last.entry + 2;
};
/** Columns a point spans before its glyph, by how many edges enter it. */
const pointAlong = (entries: number) => entries === 0 ? 1 : entries === 1 ? 2 : 3;
/** Cells a side needs for k ports: 2k + 1 around a border, 2k - 1 for a point, which has none. */
const room = (point: boolean, count: number) => point ? Math.max(1, 2 * count - 1) : 2 * count + 1;

/** Same capacity rule as `reserveGlyphGraphPorts`. Undefined when nothing had to grow. */
function growForPorts(measured: GlyphDiagramMeasuredGraph, sizes: ReadonlyMap<string, Size>, sides: readonly Side[], loopsOf: (id: string) => { slots: GlyphDiagramLoopSlot[]; length: number }): Map<string, Size> | undefined {
  let grew = false;
  const next = new Map(sizes);
  for (const [id, size] of sizes) {
    let { width: w, height: h } = size;
    const node = measured.nodes.find((node) => node.id === id)!, point = node.shape === "point", loops = loopsOf(id);
    for (const side of ["n", "e", "s", "w"] as const) {
      const count = sides.filter((s) => s.nodeId === id && s.side === side).length;
      const min = room(point, count) + (side === "s" && count > 0 ? loopSpan(loops.slots) : 0);
      if (side === "n" || side === "s") w = Math.max(w, min); else h = Math.max(h, min);
    }
    for (const side of ["e", "w"] as const) {
      const count = sides.filter(s => s.nodeId === id && s.side === side).length;
      while (!glyphDiagramPortOffsets({ ...node, height: h }, side, Array.from({ length: count }, (_, i) => Math.floor((h - 1 - 2 * (count - 1)) / 2) + 2 * i))) h++;
    }
    if (point) w = Math.max(w, pointAlong(sides.filter((s) => s.nodeId === id && s.end === "to").length));
    w = Math.max(w, loops.length);
    if (w !== size.width || h !== size.height) { grew = true; next.set(id, { width: w, height: h }); }
  }
  return grew ? next : undefined;
}

/** Each loop's two bottom ports, at the slots reserved for them. */
function loopPorts(measured: GlyphDiagramMeasuredGraph, rects: ReadonlyMap<string, Rect>, loopsOf: (id: string) => { slots: GlyphDiagramLoopSlot[] }): GlyphDiagramPositionedPort[] {
  return measured.nodes.flatMap((node) => loopsOf(node.id).slots.flatMap((slot) => (["from", "to"] as const).map((end) => {
    const box = rects.get(node.id)!, offset = end === "from" ? slot.exit : slot.entry, anchor = { x: box.x0 + offset, y: box.y1 };
    return { edgeId: slot.edgeId, nodeId: node.id, end, side: "s" as const, offset, anchor, escape: { x: anchor.x, y: anchor.y + 1 } };
  })));
}

/**
 * A crowded branch band cannot always slide under/over its anchor. Align
 * a lone entry with its exit when the border has room, past any south loops.
 */
function straightenDrops(edges: GlyphDiagramMeasuredGraph["edges"], anchor: ReadonlyMap<string, string>, ports: readonly GlyphDiagramPositionedPort[], rects: ReadonlyMap<string, Rect>, loopsOf: (id: string) => { slots: GlyphDiagramLoopSlot[] }): GlyphDiagramPositionedPort[] {
  return ports.map((port) => {
    const edge = edges.find((e) => e.id === port.edgeId)!;
    if (port.end !== "to" || (port.side !== "n" && port.side !== "s") || anchor.get(edge.to) !== edge.from) return port;
    if (ports.some((p) => p !== port && p.nodeId === port.nodeId && p.side === port.side)) return port;
    const out = ports.find((p) => p.edgeId === port.edgeId && p.end === "from")!;
    const box = rects.get(port.nodeId)!;
    const below = port.side === "n";
    const start = below ? 0 : loopSpan(loopsOf(port.nodeId).slots);
    if (out.side !== (below ? "s" : "n") || out.anchor.x <= box.x0 + start || out.anchor.x >= box.x1) return port;
    const anchorPoint = { x: out.anchor.x, y: below ? box.y0 : box.y1 };
    return { ...port, offset: out.anchor.x - box.x0, anchor: anchorPoint, escape: { x: anchorPoint.x, y: anchorPoint.y + (below ? -1 : 1) } };
  });
}

function assignPorts(measured: GlyphDiagramMeasuredGraph, sides: readonly Side[], rects: ReadonlyMap<string, Rect>, loopsOf: (id: string) => { slots: GlyphDiagramLoopSlot[] }): GlyphDiagramPositionedPort[] {
  const ports: GlyphDiagramPositionedPort[] = [];
  const groups = new Map<string, Side[]>();
  for (const s of sides) groups.set(`${s.nodeId}\u0000${s.side}`, [...(groups.get(`${s.nodeId}\u0000${s.side}`) ?? []), s]);
  for (const list of groups.values()) {
    const node = rects.get(list[0]!.nodeId)!, side = list[0]!.side;
    const across = side === "n" || side === "s";
    const centre = (id: string) => { const r = rects.get(id)!; return across ? r.x0 + r.x1 : r.y0 + r.y1; };
    list.sort((p, q) => centre(p.other) - centre(q.other) || (p.edgeId < q.edgeId ? -1 : 1));
    // Exits below a node with loops start past the loops' labels.
    const from = side === "s" ? loopSpan(loopsOf(list[0]!.nodeId).slots) : 0;
    const length = (across ? node.x1 - node.x0 + 1 : node.y1 - node.y0 + 1) - from;
    const offsets = glyphDiagramPortOffsets({ ...measured.nodes.find(n => n.id === list[0]!.nodeId)!, height: node.y1 - node.y0 + 1 }, side,
      list.map((_, i) => from + Math.floor((length - 1 - 2 * (list.length - 1)) / 2) + 2 * i))!;
    list.forEach((s, i) => {
      const offset = offsets[i]!;
      const anchorPoint = across ? { x: node.x0 + offset, y: side === "n" ? node.y0 : node.y1 } : { x: side === "w" ? node.x0 : node.x1, y: node.y0 + offset };
      const delta = GLYPH_DIAGRAM_DIRECTIONS[side];
      ports.push({ edgeId: s.edgeId, nodeId: s.nodeId, end: s.end, side, offset, anchor: anchorPoint, escape: { x: anchorPoint.x + delta.x, y: anchorPoint.y + delta.y } });
    });
  }
  return ports;
}
