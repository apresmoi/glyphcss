import type { GlyphCanvasDirection, GlyphCanvasPoint, GlyphCanvasTierName } from "glyphcss";
import type { GlyphGraph, GlyphGraphNode, GlyphGraphEdge, GlyphGraphGroup } from "./types";
import { validateGlyphGraph, glyphDiagramError } from "./validate";
import { glyphDiagramText } from "./labels";
import { ledgerGroupMemberList, ledgerLabelFolded, type GlyphDiagramLedgerEntry } from "./ledger";

export const GLYPH_DIAGRAM_NODE_PAD = Object.freeze({ x: 1, y: 0 });
export interface GlyphDiagramRect { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number }
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
  return { ...graph, nodes: [...graph.nodes].sort((a, b) => compare(a.id, b.id)), edges,
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
export async function layoutGlyphGraph(graph: GlyphGraph | GlyphDiagramReservedGraph, options: GlyphDiagramLayoutOptions = {}): Promise<GlyphDiagramLayout> {
  if (options.engine === "elk") glyphDiagramError("GLYPH_DIAGRAM_ELK_NOT_INSTALLED", "The ELK layout adapter is reserved for phase 4; use engine: dagre.");
  if (options.engine !== undefined && options.engine !== "dagre") glyphDiagramError("bad-options", "Phase 2 supports engine dagre only.");
  const nodesep = options.nodesep ?? 4, ranksep = options.ranksep ?? 4, margin = options.margin ?? 1;
  if (![nodesep, ranksep, margin].every(Number.isInteger) || nodesep < 3 || ranksep < 3 || margin < 0) glyphDiagramError("bad-options", "nodesep/ranksep must be integers >= 3; margin must be an integer >= 0.");
  const reserved = "ports" in graph ? graph : reserveGlyphGraphPorts(measureGlyphGraph(graph, options));
  const dagre = await import("@dagrejs/dagre");
  const g = new dagre.graphlib.Graph({ multigraph: true, compound: true });
  g.setGraph({ rankdir: reserved.direction, nodesep, ranksep, marginx: margin, marginy: margin });
  g.setDefaultEdgeLabel(() => ({}));
  const ledger = [...reserved.ledger];
  const groupKeys = new Map<string, string>();
  const includedGroups = [...reserved.groups].sort((a, b) => compare(a.id, b.id)).filter((group) => {
    const partialOverlap = reserved.groups.some((other) => other.id !== group.id && group.members.some((id) => other.members.includes(id))
      && !group.members.every((id) => other.members.includes(id)) && !other.members.every((id) => group.members.includes(id)));
    if (partialOverlap) ledger.push(ledgerGroupMemberList({ groupId: group.id, reason: "overlap" }));
    return group.members.length > 0 && !partialOverlap;
  });
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
  for (const edge of [...reserved.edges].sort((a, b) => compare(a.id, b.id))) g.setEdge(edge.from, edge.to, {}, edge.id);
  dagre.layout(g);
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
