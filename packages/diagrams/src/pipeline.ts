import type { GlyphCanvasDirection, GlyphCanvasPoint, GlyphCanvasTierName } from "glyphcss";
import type { GlyphGraph, GlyphGraphNode, GlyphGraphEdge, GlyphGraphGroup } from "./types";
import { validateGlyphGraph, glyphDiagramError } from "./validate";
import { glyphDiagramText } from "./labels";
import { ledgerGroupMemberList, ledgerLabelFolded, type GlyphDiagramLedgerEntry } from "./ledger";

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
export interface GlyphDiagramMeasuredNode extends GlyphGraphNode { readonly width: number; readonly height: number; readonly lines: readonly string[] }
export interface GlyphDiagramEdge extends GlyphGraphEdge { readonly id: string }
export interface GlyphDiagramMeasuredGraph {
  readonly nodes: readonly GlyphDiagramMeasuredNode[];
  readonly edges: readonly GlyphDiagramEdge[];
  readonly groups: readonly GlyphGraphGroup[];
  readonly direction: GlyphGraph["direction"];
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
  readonly width: number; readonly height: number;
  readonly ledger: readonly GlyphDiagramLedgerEntry[];
}
export interface GlyphDiagramLayoutOptions {
  readonly engine?: "dagre" | "elk"; readonly direction?: GlyphGraph["direction"];
  readonly nodesep?: number; readonly ranksep?: number;
  readonly charset?: GlyphCanvasTierName; readonly labelWidth?: number;
  readonly margin?: number;
}
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

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
function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      if (line && line.length + word.length + 1 > width) { lines.push(line); line = ""; }
      let rest = word;
      while (rest.length > width) { if (line) { lines.push(line); line = ""; } lines.push(rest.slice(0, width)); rest = rest.slice(width); }
      line += (line ? " " : "") + rest;
    }
    lines.push(line);
  }
  return lines;
}
export function measureGlyphGraph(graph: GlyphGraph, options: GlyphDiagramLayoutOptions = {}): GlyphDiagramMeasuredGraph {
  const canonical = canonicalizeGlyphGraph(validateGlyphGraph(graph));
  const limit = options.labelWidth ?? 18;
  if (!Number.isInteger(limit) || limit < 1) glyphDiagramError("bad-options", "labelWidth must be a positive integer.");
  const ledger: GlyphDiagramLedgerEntry[] = [];
  const nodes = canonical.nodes.map((node) => {
    const folded = node.label.split(/\r?\n/).map((line) => glyphDiagramText(line, options.charset)).join("\n");
    if (folded !== node.label) ledger.push(ledgerLabelFolded({ nodeId: node.id, before: node.label, after: folded }));
    const lines = wrap(folded, limit);
    const extra = node.shape === "subroutine" ? 2 : 0;
    return { ...node, lines, width: Math.max(5, ...lines.map((l) => l.length + 2 + 2 * GLYPH_DIAGRAM_NODE_PAD.x + extra)), height: lines.length + 2 + 2 * GLYPH_DIAGRAM_NODE_PAD.y };
  });
  return { nodes, edges: canonical.edges, groups: canonical.groups ?? [], direction: options.direction ?? canonical.direction, ledger };
}
const sides: Record<GlyphGraph["direction"], readonly [GlyphCanvasDirection, GlyphCanvasDirection]> = { TB: ["s", "n"], BT: ["n", "s"], LR: ["e", "w"], RL: ["w", "e"] };
export function reserveGlyphGraphPorts(measured: GlyphDiagramMeasuredGraph): GlyphDiagramReservedGraph {
  const ports: GlyphDiagramPort[] = [];
  const [fromSide, toSide] = sides[measured.direction];
  const nodes = measured.nodes.map((node) => {
    let width = node.width, height = node.height;
    // Size both opposite sides before assigning either side's offsets.
    for (const [side, count] of [[fromSide, measured.edges.filter((e) => e.from === node.id).length], [toSide, measured.edges.filter((e) => e.to === node.id).length]] as const) {
      if (side === "n" || side === "s") width = Math.max(width, 2 * count + 1);
      else height = Math.max(height, 2 * count + 1);
    }
    for (const side of ["n", "e", "s", "w"] as const) {
      const connections = measured.edges.flatMap((edge) => [
        ...(edge.from === node.id && side === fromSide ? [{ edgeId: edge.id, end: "from" as const }] : []),
        ...(edge.to === node.id && side === toSide ? [{ edgeId: edge.id, end: "to" as const }] : []),
      ]);
      const min = 2 * connections.length + 1;
      if (side === "n" || side === "s") width = Math.max(width, min); else height = Math.max(height, min);
      const length = side === "n" || side === "s" ? width : height;
      connections.forEach((connection, index) => ports.push({ ...connection, nodeId: node.id, side, offset: Math.floor((length - 1 - 2 * (connections.length - 1)) / 2) + 2 * index }));
    }
    return { ...node, width, height };
  });
  return { ...measured, nodes, ports };
}
export const GLYPH_DIAGRAM_DIRECTIONS: Readonly<Record<GlyphCanvasDirection, GlyphCanvasPoint>> = Object.freeze({ n: { x: 0, y: -1 }, e: { x: 1, y: 0 }, s: { x: 0, y: 1 }, w: { x: -1, y: 0 } });
/**
 * The edges that close a loop, found by a depth-first walk from the
 * authored-first node of each loop. They go to dagre reversed, so it ranks
 * the graph acyclic as given; left to its own cycle breaking, dagre walked
 * nodes in id order and could rank a loop's start (`Push`) after its end.
 * Unlooped graphs have no back edges and render the same in any order.
 */
function backEdgeIds(nodes: readonly { readonly id: string }[], edges: readonly GlyphDiagramEdge[]): Set<string> {
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
  const ledger = [...reserved.ledger];
  const includedGroups = [...reserved.groups].sort((a, b) => compare(a.id, b.id)).filter((group) => {
    const partialOverlap = reserved.groups.some((other) => other.id !== group.id && group.members.some((id) => other.members.includes(id))
      && !group.members.every((id) => other.members.includes(id)) && !other.members.every((id) => group.members.includes(id)));
    if (partialOverlap) ledger.push(ledgerGroupMemberList({ groupId: group.id, reason: "overlap" }));
    return group.members.length > 0 && !partialOverlap;
  });
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
    g.setGraph({ rankdir: reserved.direction, nodesep, ranksep, marginx: margin, marginy: margin, edgesep: 1 });
    g.setDefaultEdgeLabel(() => ({}));
    const groupKeys = new Map<string, string>();
    for (const group of includedGroups) {
      let id = `group:${group.id}`;
      while (reserved.nodes.some((node) => node.id === id) || [...groupKeys.values()].includes(id)) id += ":group";
      groupKeys.set(group.id, id); g.setNode(id, {});
    }
    for (const group of includedGroups) {
      const parent = includedGroups.filter((other) => other.members.length > group.members.length && group.members.every((id) => other.members.includes(id))).sort((a, b) => a.members.length - b.members.length || compare(a.id, b.id))[0];
      if (parent) g.setParent(groupKeys.get(group.id)!, groupKeys.get(parent.id)!);
    }
    // Re-sort even staged inputs: the public stage API must not leak insertion order into dagre.
    for (const node of [...reserved.nodes].sort((a, b) => compare(a.id, b.id))) g.setNode(node.id, { width: node.width, height: node.height });
    for (const node of reserved.nodes) {
      const parent = includedGroups.filter((group) => group.members.includes(node.id)).sort((a, b) => a.members.length - b.members.length || compare(a.id, b.id))[0];
      if (parent) g.setParent(node.id, groupKeys.get(parent.id)!);
    }
    for (const edge of [...reserved.edges].sort((a, b) => compare(a.id, b.id))) {
      if (back.has(edge.id)) g.setEdge(edge.to, edge.from, {}, edge.id);
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
  const positioned = reserved.nodes.map((node) => {
    const position = g.node(node.id);
    const x0 = Math.round(position.x - node.width / 2), y0 = Math.round(position.y - node.height / 2);
    return { ...node, x0, y0, x1: x0 + node.width - 1, y1: y0 + node.height - 1 };
  });
  // Compound engines reserve caption padding in their own units. A global
  // translation removes that leading whitespace without changing any node separation.
  const shiftX = Math.min(...positioned.map((node) => node.x0)) - margin;
  const shiftY = Math.min(...positioned.map((node) => node.y0)) - margin;
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
  return { ...reserved, ledger, nodes, ports, width: Math.max(1, ...nodes.map((n) => n.x1 + 1 + margin)), height: Math.max(1, ...nodes.map((n) => n.y1 + 1 + margin)) };
}
