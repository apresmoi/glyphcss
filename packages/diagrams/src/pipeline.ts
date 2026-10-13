import { GLYPH_DIAGRAM_DAGRE_ALIGN, type GlyphDiagramDagreAlignment } from "./fitAlignment";
import type { GlyphCanvasDirection, GlyphCanvasPoint, GlyphCanvasTierName } from "glyphcss";
import type { GlyphGraph, GlyphGraphNode, GlyphGraphEdge, GlyphGraphGroup } from "./types";
import { validateGlyphGraph, glyphDiagramError } from "./validate";
import { glyphDiagramText } from "./labels";
import { ledgerGroupMemberList, ledgerLabelAbbreviated, ledgerLabelFolded, type GlyphDiagramLedgerEntry } from "./ledger";
import { GLYPH_DIAGRAM_LOOP_LABEL_MAX, GLYPH_DIAGRAM_LOOP_SPAN, glyphDiagramLoopGeometry, glyphDiagramLoopSide, glyphDiagramLoopSlots, type GlyphDiagramLoop } from "./loop";

export const GLYPH_DIAGRAM_NODE_PAD = Object.freeze({ x: 1, y: 0 });
export interface GlyphDiagramRect { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number }
/** A group's own member-node bbox padded on every side, clamped to the canvas — the exact rectangle the painter rings with dots. Shared with `route.ts`'s clearance cost so "where the router keeps clear" and "where the boundary is drawn" can never drift apart. */
export const GLYPH_DIAGRAM_GROUP_PAD = 2;
export function glyphDiagramGroupRect(memberNodes: readonly GlyphDiagramRect[], bounds: { readonly cols: number; readonly rows: number }): GlyphDiagramRect | undefined {
  if (!memberNodes.length) return undefined;
  return {
    x0: Math.max(0, Math.min(...memberNodes.map((n) => n.x0)) - GLYPH_DIAGRAM_GROUP_PAD),
    y0: Math.max(0, Math.min(...memberNodes.map((n) => n.y0)) - GLYPH_DIAGRAM_GROUP_PAD),
    x1: Math.min(bounds.cols - 1, Math.max(...memberNodes.map((n) => n.x1)) + GLYPH_DIAGRAM_GROUP_PAD),
    y1: Math.min(bounds.rows - 1, Math.max(...memberNodes.map((n) => n.y1)) + GLYPH_DIAGRAM_GROUP_PAD),
  };
}
/**
 * Each group's enclosing group. A group names its parent when it has one (the only way to nest two groups that list the same
 * nodes); otherwise its parent is the smallest other group that holds all its members.
 */
export function glyphDiagramGroupParents(groups: readonly GlyphGraphGroup[]): Map<string, string | undefined> {
  const holds = (outer: GlyphGraphGroup, inner: GlyphGraphGroup) => inner.members.every((id) => outer.members.includes(id));
  const parents = new Map<string, string | undefined>();
  for (const group of groups) {
    const named = group.parent === undefined ? undefined : groups.find((other) => other.id === group.parent);
    if (named && named !== group && holds(named, group)) { parents.set(group.id, named.id); continue; }
    const inferred = groups.filter((other) => other !== group && other.members.length > group.members.length && holds(other, group))
      .sort((x, y) => x.members.length - y.members.length || compare(x.id, y.id))[0];
    parents.set(group.id, inferred?.id);
  }
  return parents;
}
/** How many groups enclose each group. */
export function glyphDiagramGroupDepths(parents: ReadonlyMap<string, string | undefined>): Map<string, number> {
  const depth = (id: string, seen = 0): number => { const up = parents.get(id); return up === undefined || seen > parents.size ? 0 : 1 + depth(up, seen + 1); };
  return new Map([...parents.keys()].map((id) => [id, depth(id)]));
}
/**
 * Every group's frame. A member counts with its loops and their labels, so the
 * frame encloses them; a frame around another group is padded beyond that
 * group's own, so nested frames never share a border column.
 */
export function glyphDiagramGroupRects(layout: Pick<GlyphDiagramLayout, "nodes" | "groups" | "ports" | "loops" | "frameInset">, bounds: { readonly cols: number; readonly rows: number }): Map<string, GlyphDiagramRect> {
  const loopBounds = glyphDiagramLoopGeometry(layout);
  const extent = (node: GlyphDiagramRect & { readonly id: string }): GlyphDiagramRect => {
    const own = loopBounds.filter((geometry) => geometry.loop.nodeId === node.id).map((geometry) => geometry.bounds);
    return { x0: Math.min(node.x0, ...own.map((b) => b.x0)), y0: Math.min(node.y0, ...own.map((b) => b.y0)), x1: Math.max(node.x1, ...own.map((b) => b.x1)), y1: Math.max(node.y1, ...own.map((b) => b.y1)) };
  };
  const parents = glyphDiagramGroupParents(layout.groups), depths = glyphDiagramGroupDepths(parents);
  const rects = new Map<string, GlyphDiagramRect>();
  // Innermost first, so a frame can be padded outside the frames it holds.
  for (const group of [...layout.groups].sort((a, b) => depths.get(b.id)! - depths.get(a.id)!)) {
    let rect = glyphDiagramGroupRect(layout.nodes.filter((n) => group.members.includes(n.id)).map(extent), bounds);
    if (!rect) continue;
    if (layout.frameInset !== false) for (const [id, inner] of rects) {
      if (parents.get(id) !== group.id) continue;
      rect = { x0: Math.min(rect.x0, Math.max(0, inner.x0 - GLYPH_DIAGRAM_GROUP_PAD)), y0: Math.min(rect.y0, Math.max(0, inner.y0 - GLYPH_DIAGRAM_GROUP_PAD)),
        x1: Math.max(rect.x1, Math.min(bounds.cols - 1, inner.x1 + GLYPH_DIAGRAM_GROUP_PAD)), y1: Math.max(rect.y1, Math.min(bounds.rows - 1, inner.y1 + GLYPH_DIAGRAM_GROUP_PAD)) };
    }
    rects.set(group.id, rect);
  }
  return rects;
}
export interface GlyphDiagramMeasuredNode extends GlyphGraphNode { readonly width: number; readonly height: number; readonly lines: readonly string[] }
export interface GlyphDiagramEdge extends GlyphGraphEdge { readonly id: string }
export interface GlyphDiagramMeasuredGraph {
  readonly nodes: readonly GlyphDiagramMeasuredNode[];
  readonly edges: readonly GlyphDiagramEdge[];
  readonly groups: readonly GlyphGraphGroup[];
  readonly direction: GlyphGraph["direction"];
  /** Self-edges (`from === to`), in edge order; each hangs a compact loop on its node's loop side. */
  readonly loops: readonly GlyphDiagramLoop[];
  readonly ledger: readonly GlyphDiagramLedgerEntry[];
}
export interface GlyphDiagramPort { readonly edgeId: string; readonly nodeId: string; readonly end: "from" | "to"; readonly side: GlyphCanvasDirection; readonly offset: number }
export interface GlyphDiagramReservedGraph extends GlyphDiagramMeasuredGraph { readonly ports: readonly GlyphDiagramPort[] }
export interface GlyphDiagramPositionedNode extends GlyphDiagramMeasuredNode, GlyphDiagramRect {}
export interface GlyphDiagramPositionedPort extends GlyphDiagramPort { readonly anchor: GlyphCanvasPoint; readonly escape: GlyphCanvasPoint }
export interface GlyphDiagramLayout {
  readonly nodes: readonly GlyphDiagramPositionedNode[];
  readonly edges: readonly GlyphDiagramEdge[];
  readonly groups: readonly GlyphGraphGroup[];
  readonly ports: readonly GlyphDiagramPositionedPort[];
  readonly direction: GlyphGraph["direction"];
  readonly loops: readonly GlyphDiagramLoop[];
  /** Whether a frame around another frame is padded outside it (the default). Without, a parent holding exactly its child's members shares its border. */
  readonly frameInset?: boolean;
  readonly width: number; readonly height: number;
  readonly ledger: readonly GlyphDiagramLedgerEntry[];
}
export interface GlyphDiagramLayoutOptions {
  readonly engine?: "dagre" | "elk"; readonly direction?: GlyphGraph["direction"];
  readonly nodesep?: number; readonly ranksep?: number;
  readonly charset?: GlyphCanvasTierName; readonly labelWidth?: number;
  /** Widest a self-loop's label row may be before it wraps onto another row, default 24. */
  readonly loopLabelWidth?: number;
  /** Pad a nested group's frame outside its child's, default true. The fitter turns it off before it splits a graph or cuts a word. */
  readonly frameInset?: boolean;
  readonly margin?: number;
}
/** A node label as the cells will show it: folded to the charset line by line. */
export function glyphDiagramFoldLabel(label: string, charset?: GlyphCanvasTierName): string {
  return label.split(/\r?\n/).map((line) => glyphDiagramText(line, charset)).join("\n");
}
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
/** Punctuation belongs to the preceding piece when a label wraps. */
export function glyphDiagramWords(text: string): string[] {
  return text.split(/\s+|(?<=[-+/:])/).filter(Boolean);
}

/** Stable synthetic ids preserve duplicate edges without depending on input order. */
export function canonicalizeGlyphGraph(graph: GlyphGraph): Omit<GlyphGraph, "edges"> & { edges: GlyphDiagramEdge[] } {
  const sorted = [...graph.edges].sort((a, b) => compare(a.id ?? "", b.id ?? "") || compare(JSON.stringify([a.from, a.to, a.label ?? "", a.style ?? "solid", a.priority ?? 0]), JSON.stringify([b.from, b.to, b.label ?? "", b.style ?? "solid", b.priority ?? 0])));
  const ids = new Set(sorted.flatMap((e) => e.id === undefined ? [] : [e.id]));
  const counts = new Map<string, number>();
  const edges = sorted.map((e) => {
    if (e.id !== undefined) return { ...e, id: e.id };
    const base = `edge:${JSON.stringify([e.from, e.to, e.label ?? "", e.style ?? "solid", e.priority ?? 0])}`;
    let n = counts.get(base) ?? 0;
    while (ids.has(`${base}:${n}`)) n++;
    const id = `${base}:${n}`; counts.set(base, n + 1); ids.add(id);
    return { ...e, id };
  }).sort((a, b) => compare(a.id, b.id));
  // Nodes keep their authored order: it is the only signal for where a loop
  // starts (`backEdgeIds`). Every order-sensitive step sorts on its own.
  return { ...graph, nodes: [...graph.nodes], edges,
    groups: [...(graph.groups ?? [])].map((g) => ({ ...g, members: [...g.members].sort(compare) })).sort((a, b) => compare(a.id, b.id)) };
}
/** Wrap at spaces or after punctuation; only a piece longer than `width` needs letter cuts. */
export function glyphDiagramWrap(text: string, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const pieces = glyphDiagramWords(word);
      for (let i = 0; i < pieces.length; i++) {
        const space = i === 0 && line ? " " : "";
        if (line && line.length + space.length + pieces[i]!.length > width) { lines.push(line); line = ""; }
        let rest = pieces[i]!;
        while (rest.length > width) { if (line) { lines.push(line); line = ""; } lines.push(rest.slice(0, width)); rest = rest.slice(width); }
        line += (i === 0 && line ? " " : "") + rest;
      }
    }
    lines.push(line);
  }
  return lines;
}
export function measureGlyphGraph(graph: GlyphGraph, options: GlyphDiagramLayoutOptions = {}): GlyphDiagramMeasuredGraph {
  const canonical = canonicalizeGlyphGraph(validateGlyphGraph(graph));
  const limit = options.labelWidth ?? 18;
  if (!Number.isInteger(limit) || limit < 1) glyphDiagramError("bad-options", "labelWidth must be a positive integer.");
  const loopLimit = options.loopLabelWidth ?? GLYPH_DIAGRAM_LOOP_LABEL_MAX;
  if (!Number.isInteger(loopLimit) || loopLimit < 1) glyphDiagramError("bad-options", "loopLabelWidth must be a positive integer.");
  const ledger: GlyphDiagramLedgerEntry[] = [];
  // The one place any graph label is folded for the charset and the fold reported: node, edge, loop and group labels all come through it.
  const fold = (label: string, role: string, owner: string): string => {
    const folded = glyphDiagramFoldLabel(label, options.charset);
    if (folded !== label.split(/\r?\n/).map((line) => line.trimEnd()).join("\n")) ledger.push(ledgerLabelFolded({ role, owner, before: label, after: folded }));
    return folded;
  };
  for (const edge of canonical.edges) if (edge.label && edge.from !== edge.to) fold(edge.label, "edge label", `${edge.from} to ${edge.to}`);
  for (const group of canonical.groups ?? []) if (group.label) fold(group.label, "group label", group.id);
  const nodes = canonical.nodes.map((node) => {
    const folded = fold(node.label, "node label", node.id);
    const lines = glyphDiagramWrap(folded, limit);
    const extra = node.shape === "subroutine" ? 2 : 0;
    // A point is the first character of its label and nothing else, and says so when it drops the rest;
    // `reserveGlyphGraphPorts` adds the cells its edges need.
    if (node.shape === "point") {
      const glyph = Array.from(folded.trim())[0] ?? "";
      if (Array.from(folded.trim()).length > 1) ledger.push(ledgerLabelAbbreviated({ role: "node label", before: folded.trim(), after: glyph }));
      return { ...node, lines: [glyph], width: 1, height: 1 };
    }
    return { ...node, lines, width: Math.max(5, ...lines.map((l) => l.length + 2 + 2 * GLYPH_DIAGRAM_NODE_PAD.x + extra)), height: lines.length + 2 + 2 * GLYPH_DIAGRAM_NODE_PAD.y };
  });
  // A loop's label wraps like a node's, so the fitter can trade its width for the room it takes.
  const loops = canonical.edges.filter((edge) => edge.from === edge.to).map((edge) => {
    const text = edge.label ? fold(edge.label, "loop label", edge.from) : "";
    const lines = text.trim() ? glyphDiagramWrap(text, loopLimit) : [];
    return { edgeId: edge.id, nodeId: edge.from, lines, labelWidth: Math.max(0, ...lines.map((line) => line.length)) };
  });
  return { nodes, edges: canonical.edges, groups: canonical.groups ?? [], direction: options.direction ?? canonical.direction, loops, ledger };
}
const sides: Record<GlyphGraph["direction"], readonly [GlyphCanvasDirection, GlyphCanvasDirection]> = { TB: ["s", "n"], BT: ["n", "s"], LR: ["e", "w"], RL: ["w", "e"] };
export function reserveGlyphGraphPorts(measured: GlyphDiagramMeasuredGraph): GlyphDiagramReservedGraph {
  const ports: GlyphDiagramPort[] = [];
  const [fromSide, toSide] = sides[measured.direction];
  // A self-edge never competes for the flow sides: it hangs on the loop side.
  const flow = measured.edges.filter((e) => e.from !== e.to);
  const loopSide = glyphDiagramLoopSide(measured.direction);
  const nodes = measured.nodes.map((node) => {
    let width = node.width, height = node.height;
    // A point has no border to keep ports off its corners: k ports need 2k - 1 cells. Along the flow it also holds what its
    // entries need before the glyph: nothing, one arrowhead, or (several) a bar and then one arrowhead.
    const point = node.shape === "point", room = (count: number) => point ? Math.max(1, 2 * count - 1) : 2 * count + 1;
    // Size both opposite sides before assigning either side's offsets.
    for (const [side, count] of [[fromSide, flow.filter((e) => e.from === node.id).length], [toSide, flow.filter((e) => e.to === node.id).length]] as const) {
      if (side === "n" || side === "s") width = Math.max(width, room(count));
      else height = Math.max(height, room(count));
    }
    if (point) {
      const entries = flow.filter((e) => e.to === node.id).length, along = entries === 0 ? 1 : entries === 1 ? 2 : 3;
      if (loopSide === "e") height = Math.max(height, along); else width = Math.max(width, along);
    }
    for (const side of ["n", "e", "s", "w"] as const) {
      const connections = flow.flatMap((edge) => [
        ...(edge.from === node.id && side === fromSide ? [{ edgeId: edge.id, end: "from" as const }] : []),
        ...(edge.to === node.id && side === toSide ? [{ edgeId: edge.id, end: "to" as const }] : []),
      ]);
      const min = room(connections.length);
      if (side === "n" || side === "s") width = Math.max(width, min); else height = Math.max(height, min);
      const length = side === "n" || side === "s" ? width : height;
      connections.forEach((connection, index) => ports.push({ ...connection, nodeId: node.id, side, offset: Math.floor((length - 1 - 2 * (connections.length - 1)) / 2) + 2 * index }));
    }
    const { slots, length } = glyphDiagramLoopSlots(measured.loops.filter((loop) => loop.nodeId === node.id), loopSide);
    if (loopSide === "e") height = Math.max(height, length); else width = Math.max(width, length);
    for (const slot of slots) ports.push({ edgeId: slot.edgeId, nodeId: node.id, end: "from", side: loopSide, offset: slot.exit }, { edgeId: slot.edgeId, nodeId: node.id, end: "to", side: loopSide, offset: slot.entry });
    return { ...node, width, height };
  });
  return { ...measured, nodes, ports };
}
/** Where a `point` node's glyph sits: centred across the flow, on the side its edges leave from, so the arrowheads entering it have their own row or column. */
export function glyphDiagramPointCell(node: GlyphDiagramRect, direction: GlyphGraph["direction"]): GlyphCanvasPoint {
  const x = node.x0 + Math.floor((node.x1 - node.x0) / 2), y = node.y0 + Math.floor((node.y1 - node.y0) / 2);
  return direction === "TB" ? { x, y: node.y1 } : direction === "BT" ? { x, y: node.y0 } : direction === "LR" ? { x: node.x1, y } : { x: node.x0, y };
}
export const GLYPH_DIAGRAM_DIRECTIONS: Readonly<Record<GlyphCanvasDirection, GlyphCanvasPoint>> = Object.freeze({ n: { x: 0, y: -1 }, e: { x: 1, y: 0 }, s: { x: 0, y: 1 }, w: { x: -1, y: 0 } });
/**
 * The edges that close a loop, found by a depth-first walk from the
 * authored-first node of each loop. They go to dagre reversed, so it ranks
 * the graph acyclic as given; left to its own cycle breaking, dagre walked
 * nodes in id order and could rank a loop's start (`Push`) after its end.
 * Unlooped graphs have no back edges and render the same in any order.
 */
export function backEdgeIds(nodes: readonly { readonly id: string }[], edges: readonly GlyphDiagramEdge[]): Set<string> {
  const rank = new Map(nodes.map((node, i) => [node.id, i]));
  const out = new Map<string, GlyphDiagramEdge[]>();
  const indegree = new Map<string, number>();
  for (const edge of edges) {
    if (edge.from === edge.to) continue;
    out.set(edge.from, [...(out.get(edge.from) ?? []), edge]);
    indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
  }
  for (const list of out.values()) list.sort((a, b) => rank.get(a.to)! - rank.get(b.to)! || compare(a.id, b.id));
  const back = new Set<string>(), state = new Map<string, "open" | "done">();
  const visit = (root: string) => {
    const stack: { id: string; next: number }[] = [{ id: root, next: 0 }];
    state.set(root, "open");
    while (stack.length > 0) {
      const top = stack[stack.length - 1]!;
      const edge = (out.get(top.id) ?? [])[top.next++];
      if (edge === undefined) { state.set(top.id, "done"); stack.pop(); continue; }
      const seen = state.get(edge.to);
      if (seen === "open") back.add(edge.id);
      else if (seen === undefined) { state.set(edge.to, "open"); stack.push({ id: edge.to, next: 0 }); }
    }
  };
  // Sources first, so a loop hanging off a real entry is entered from it.
  for (const node of nodes) if (!indegree.has(node.id) && !state.has(node.id)) visit(node.id);
  for (const node of nodes) if (!state.has(node.id)) visit(node.id);
  return back;
}
export async function layoutGlyphGraph(graph: GlyphGraph | GlyphDiagramReservedGraph, options: GlyphDiagramLayoutOptions = {}): Promise<GlyphDiagramLayout> {
  if (options.engine === "elk") glyphDiagramError("GLYPH_DIAGRAM_ELK_NOT_INSTALLED", "The ELK layout adapter is reserved for phase 4; use engine: dagre.");
  if (options.engine !== undefined && options.engine !== "dagre") glyphDiagramError("bad-options", "Phase 2 supports engine dagre only.");
  const nodesep = options.nodesep ?? 4, ranksep = options.ranksep ?? 4, margin = options.margin ?? 1;
  if (![nodesep, ranksep, margin].every(Number.isInteger) || nodesep < 3 || ranksep < 3 || margin < 0) glyphDiagramError("bad-options", "nodesep/ranksep must be integers >= 3; margin must be an integer >= 0.");
  const reserved = "ports" in graph ? graph : reserveGlyphGraphPorts(measureGlyphGraph(graph, options));
  const dagre = await import("@dagrejs/dagre");
  const align = (options as GlyphDiagramLayoutOptions & { [GLYPH_DIAGRAM_DAGRE_ALIGN]?: GlyphDiagramDagreAlignment })[GLYPH_DIAGRAM_DAGRE_ALIGN];
  const ledger = [...reserved.ledger];
  const loopSide = glyphDiagramLoopSide(reserved.direction), across = loopSide === "e";
  /**
   * `reach`: cells past the node's border the loops and their labels occupy
   * along the loop side's normal; `along`: with loops below a node, the last
   * label cell's offset from the node's left edge.
   */
  const loopRoom = (nodeId: string) => {
    const { slots } = glyphDiagramLoopSlots(reserved.loops.filter((loop) => loop.nodeId === nodeId), loopSide);
    return {
      reach: Math.max(0, ...slots.map((slot) => slot.labelWidth > 0 ? (across ? 3 + slot.labelWidth : 1 + slot.lines.length) : GLYPH_DIAGRAM_LOOP_SPAN)),
      along: Math.max(0, ...slots.map((slot) => slot.entry + 1 + slot.labelWidth)),
    };
  };
  const includedGroups = [...reserved.groups].sort((a, b) => compare(a.id, b.id)).filter((group) => {
    const partialOverlap = reserved.groups.some((other) => other.id !== group.id && group.members.some((id) => other.members.includes(id))
      && !group.members.every((id) => other.members.includes(id)) && !other.members.every((id) => group.members.includes(id)));
    if (partialOverlap) ledger.push(ledgerGroupMemberList({ groupId: group.id, reason: "overlap" }));
    return group.members.length > 0 && !partialOverlap;
  });
  const groupParents = glyphDiagramGroupParents(includedGroups), groupDepths = glyphDiagramGroupDepths(groupParents);
  const build = (back: ReadonlySet<string>) => {
    const g = new dagre.graphlib.Graph({ multigraph: true, compound: true });
    // dagre's own default is `edgesep: 20`, a bare pixel constant left over from
    // its browser-diagram origin. `makeSpaceForEdgeLabels` inserts one dummy
    // label-proxy node per edge into the intervening rank and spaces same-rank
    // dummies `edgesep` apart, which pulls their real sibling endpoints to the
    // same pitch. In TB that pitch coincides with `nodesep` + label width
    // (~20 already) and the defect is invisible; in LR the transverse axis is
    // node HEIGHT (3), so three siblings cost 45 rows instead of ~19
    // (DIAGNOSIS-diagrams-fanout.md RC1/RC3). `1` is the smallest legal
    // separation on this integer cell grid — measured identical in extent to
    // `edgesep: nodesep` (80x19 either way) once it is off the pixel default,
    // so there is no reason to spend more of the grid on it than its own unit.
    g.setGraph({ rankdir: reserved.direction, nodesep, ranksep, marginx: margin, marginy: margin, edgesep: 1, align });
    g.setDefaultEdgeLabel(() => ({}));
    const groupKeys = new Map<string, string>();
    for (const group of includedGroups) {
      let id = `group:${group.id}`;
      while (reserved.nodes.some((node) => node.id === id) || [...groupKeys.values()].includes(id)) id += ":group";
      groupKeys.set(group.id, id); g.setNode(id, {});
    }
    for (const group of includedGroups) {
      const parent = groupParents.get(group.id);
      if (parent !== undefined) g.setParent(groupKeys.get(group.id)!, groupKeys.get(parent)!);
    }
    // Re-sort even staged inputs: the public stage API must not leak insertion order into dagre.
    for (const node of [...reserved.nodes].sort((a, b) => compare(a.id, b.id))) g.setNode(node.id, { width: node.width, height: node.height });
    for (const node of reserved.nodes) {
      const parent = includedGroups.filter((group) => group.members.includes(node.id)).sort((a, b) => groupDepths.get(b.id)! - groupDepths.get(a.id)! || a.members.length - b.members.length || compare(a.id, b.id))[0];
      if (parent) g.setParent(node.id, groupKeys.get(parent.id)!);
    }
    // dagre keeps a self-edge's room as a dummy sibling AFTER the node in its
    // layer, so the node itself stays aligned with its neighbours' centres. One
    // edge per node carries the whole room; its size is the cells the loops
    // and labels need beyond what `nodesep` already leaves between siblings.
    const loopHosts = new Set<string>();
    for (const edge of [...reserved.edges].sort((a, b) => compare(a.id, b.id))) {
      if (edge.from === edge.to) {
        if (loopHosts.has(edge.from)) continue;
        loopHosts.add(edge.from);
        const room = loopRoom(edge.from), node = reserved.nodes.find((n) => n.id === edge.from)!;
        // Without a dummy the siblings keep `nodesep` blank cells apart, and the dummy itself costs one more (`edgesep`),
        // so it is only added when the loop needs at least that much.
        const widen = across ? 0 : Math.max(0, 2 * (room.along + 1) - node.width);
        if (room.reach < nodesep && widen === 0) continue;
        // `labelpos: "c"` stops dagre adding its 10-cell label offset to this size.
        // Below a node the label also runs along the rank, so the layer is widened until the node, centred in it, still has the label inside.
        g.setEdge(edge.from, edge.to, across
          ? { width: room.reach - nodesep, height: node.height, labelpos: "c" }
          : { width: widen, height: Math.max(0, room.reach - nodesep), labelpos: "c" }, edge.id);
      } else if (back.has(edge.id)) g.setEdge(edge.to, edge.from, {}, edge.id);
      else g.setEdge(edge.from, edge.to, {}, edge.id);
    }
    dagre.layout(g);
    return g;
  };
  // Dagre breaks loops itself and usually picks the authored start; when it
  // ranks a loop's closing edge forward instead, the loop's start landed
  // after its end, so lay out again with the authored back edges reversed.
  // Graphs dagre already ranks right keep its exact layout.
  const back = backEdgeIds(reserved.nodes, reserved.edges);
  let g = build(new Set());
  const rank = (id: string) => (g.node(id) as { rank?: number }).rank ?? 0;
  if (reserved.edges.some((edge) => back.has(edge.id) && rank(edge.from) < rank(edge.to))) g = build(back);
  let positioned = reserved.nodes.map((node) => {
    const position = g.node(node.id);
    const x0 = Math.round(position.x - node.width / 2), y0 = Math.round(position.y - node.height / 2);
    return { ...node, x0, y0, x1: x0 + node.width - 1, y1: y0 + node.height - 1 };
  });
  // Single BK alignments can put several connections through one gap. Reserve
  // one channel per crossing edge and a turn, with an extra escape cell beyond
  // caller spacing. Leave the balanced layout byte-identical. Loop dummies and compound frames already own room.
  if (align && !reserved.loops.length && !includedGroups.length) {
    const across = reserved.direction === "TB" || reserved.direction === "BT";
    const coord = (r: number) => Math.min(...positioned.filter(node => rank(node.id) === r).map(node => across ? node.y0 : node.x0));
    const ranks = [...new Set(reserved.nodes.map(node => rank(node.id)))].sort((a, b) => coord(a) - coord(b));
    const shifts = new Map<number, number>();
    let shift = 0;
    for (let i = 0; i < ranks.length; i++) {
      const r = ranks[i]!;
      if (i) {
        const before = ranks[i - 1]!;
        const earlier = positioned.filter(node => rank(node.id) === before), later = positioned.filter(node => rank(node.id) === r);
        const gap = across ? Math.min(...later.map(node => node.y0)) - Math.max(...earlier.map(node => node.y1)) - 1
          : Math.min(...later.map(node => node.x0)) - Math.max(...earlier.map(node => node.x1)) - 1;
        const crossing = reserved.edges.filter(edge => Math.min(rank(edge.from), rank(edge.to)) <= Math.min(before, r) && Math.max(rank(edge.from), rank(edge.to)) >= Math.max(before, r)).length;
        shift += Math.max(0, Math.max(ranksep + 1, crossing + 1) - gap);
      }
      shifts.set(r, shift);
    }
    positioned = positioned.map(node => {
      const delta = shifts.get(rank(node.id))!;
      return across ? { ...node, y0: node.y0 + delta, y1: node.y1 + delta } : { ...node, x0: node.x0 + delta, x1: node.x1 + delta };
    });
  }
  // Compound engines reserve caption padding in their own units. A global
  // translation removes that leading whitespace without changing any node separation.
  // A group nested k deep draws k frames, each GROUP_PAD outside the last, so the outermost needs that room on every side.
  const frameInset = options.frameInset ?? true;
  const inset = frameInset ? Math.max(0, ...groupDepths.values()) * GLYPH_DIAGRAM_GROUP_PAD : 0;
  const shiftX = Math.min(...positioned.map((node) => node.x0)) - margin - inset;
  const shiftY = Math.min(...positioned.map((node) => node.y0)) - margin - inset;
  const nodes = positioned.map((node) => ({ ...node, x0: node.x0 - shiftX, x1: node.x1 - shiftX, y0: node.y0 - shiftY, y1: node.y1 - shiftY }));
  const byId = new Map(nodes.map((node) => [node.id, node]));
  // Capacity and escape slots were reserved before layout. Assign those slots
  // in the engine's actual transverse order, not in lexical edge order: dagre
  // 3 may reverse siblings while retaining a perfectly planar embedding.
  const offsets = new Map<GlyphDiagramPort, number>();
  for (const node of nodes) for (const side of ["n", "e", "s", "w"] as const) {
    const ports = reserved.ports.filter((p) => p.nodeId === node.id && p.side === side);
    const transverse = (port: GlyphDiagramPort) => {
      const edge = reserved.edges.find((e) => e.id === port.edgeId)!;
      const other = byId.get(port.end === "from" ? edge.to : edge.from)!;
      return side === "n" || side === "s" ? other.x0 + other.x1 : other.y0 + other.y1;
    };
    const slots = ports.map((p) => p.offset).sort((a, b) => a - b);
    ports.sort((a, b) => transverse(a) - transverse(b) || compare(a.edgeId, b.edgeId));
    ports.forEach((port, i) => offsets.set(port, slots[i]!));
  }
  const ports = reserved.ports.map((original) => {
    const port = { ...original, offset: offsets.get(original)! };
    const node = byId.get(port.nodeId)!;
    const anchor = port.side === "n" || port.side === "s"
      ? { x: node.x0 + port.offset, y: port.side === "n" ? node.y0 : node.y1 }
      : { x: port.side === "w" ? node.x0 : node.x1, y: node.y0 + port.offset };
    const delta = GLYPH_DIAGRAM_DIRECTIONS[port.side];
    return { ...port, anchor, escape: { x: anchor.x + delta.x, y: anchor.y + delta.y } };
  });
  // A loop's room is part of the layout's extent, so the canvas never clips the label it reserved.
  // A group's frame sits GROUP_PAD outside what it holds, clamped to the canvas. A loop's label ends the layout's own extent, so
  // inside a group it needs one cell beyond it even at margin 0, or the clamped frame would run through the label's last row.
  const inFrame = (id: string) => includedGroups.some((group) => group.members.includes(id));
  const loopRoomEnd = glyphDiagramLoopGeometry({ ports, loops: reserved.loops }).map((g) => ({ ...g.bounds, pad: Math.max(margin, inFrame(g.loop.nodeId) ? 1 : 0) }));
  return { ...reserved, ledger, nodes, ports, frameInset, width: Math.max(1, ...nodes.map((n) => n.x1 + 1 + margin + inset), ...loopRoomEnd.map((b) => b.x1 + 1 + b.pad + inset)), height: Math.max(1, ...nodes.map((n) => n.y1 + 1 + margin + inset), ...loopRoomEnd.map((b) => b.y1 + 1 + b.pad + inset)) };
}
