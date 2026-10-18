import { glyphDiagramCatalogueArt, glyphDiagramCatalogueShape } from "./catalogueShapes";
import { glyphDiagramCompartmentOrder } from "./compartmentLayout";
import { glyphDiagramStateFramePorts } from "./stateFrame";
import { GLYPH_DIAGRAM_DIAMOND_MARKER, glyphDiagramHasDiamondMarker, glyphDiagramNodeText, type GlyphDiagramPresentationOptions } from "./presentation";
import { GLYPH_DIAGRAM_COMPARTMENT_LANES, GLYPH_DIAGRAM_EDGE_WAYPOINTS, GLYPH_DIAGRAM_WORD_WIDTH, GLYPH_DIAGRAM_GROUP_BOUNDS, GLYPH_MERMAID_STATE_REGION, GLYPH_MERMAID_STATE_FRAME, type GlyphMermaidStateRegion, type GlyphMermaidStateFrame } from "./layoutHints";
import { GLYPH_DIAGRAM_DAGRE_ALIGN, type GlyphDiagramDagreAlignment } from "./fitAlignment";
import type { GlyphCanvasDirection, GlyphCanvasPoint, GlyphCanvasTierName } from "glyphcss";
import type { GlyphGraph, GlyphGraphNode, GlyphGraphEdge, GlyphGraphGroup } from "./types";
import { validateGlyphGraph, glyphDiagramError } from "./validate";
import { glyphDiagramText } from "./labels";
import { ledgerGroupMemberList, ledgerLabelAbbreviated, ledgerLabelFolded, type GlyphDiagramLedgerEntry } from "./ledger";
import { GLYPH_DIAGRAM_LOOP_LABEL_MAX, GLYPH_DIAGRAM_LOOP_SPAN, glyphDiagramLoopGeometry, glyphDiagramLoopSide, glyphDiagramLoopSlots, type GlyphDiagramLoop } from "./loop";

export const GLYPH_DIAGRAM_FAN_GAP = Symbol("fan gap");
export const GLYPH_DIAGRAM_EDGE_LABEL_ROOM = Symbol("edge label room");
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
export function glyphDiagramGroupRects(layout: Pick<GlyphDiagramLayout, "nodes" | "groups" | "ports" | "loops" | "frameInset" | typeof GLYPH_DIAGRAM_GROUP_BOUNDS>, bounds: { readonly cols: number; readonly rows: number }): Map<string, GlyphDiagramRect> {
  const loopBounds = glyphDiagramLoopGeometry(layout);
  const extent = (node: GlyphDiagramRect & { readonly id: string }): GlyphDiagramRect => {
    const own = loopBounds.filter((geometry) => geometry.loop.nodeId === node.id).map((geometry) => geometry.bounds);
    return { x0: Math.min(node.x0, ...own.map((b) => b.x0)), y0: Math.min(node.y0, ...own.map((b) => b.y0)), x1: Math.max(node.x1, ...own.map((b) => b.x1)), y1: Math.max(node.y1, ...own.map((b) => b.y1)) };
  };
  const parents = glyphDiagramGroupParents(layout.groups), depths = glyphDiagramGroupDepths(parents);
  const rects = new Map<string, GlyphDiagramRect>();
  // Innermost first, so a frame can be padded outside the frames it holds.
  for (const group of [...layout.groups].sort((a, b) => depths.get(b.id)! - depths.get(a.id)!)) {
    const authored = layout[GLYPH_DIAGRAM_GROUP_BOUNDS]?.get(group.id);
    if (authored) { rects.set(group.id, authored); continue; }
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
export interface GlyphDiagramMeasuredNode extends GlyphGraphNode, GlyphDiagramPresentationOptions { readonly width: number; readonly height: number; readonly lines: readonly string[]; readonly separators?: readonly number[] }
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
export interface GlyphDiagramPort { readonly edgeId: string; readonly nodeId: string; readonly end: "from" | "to"; readonly side: GlyphCanvasDirection; readonly offset: number; readonly trunk?: string }
export interface GlyphDiagramReservedGraph extends GlyphDiagramMeasuredGraph { readonly ports: readonly GlyphDiagramPort[] }
export interface GlyphDiagramPositionedNode extends GlyphDiagramMeasuredNode, GlyphDiagramRect {}
export interface GlyphDiagramPositionedPort extends GlyphDiagramPort { readonly anchor: GlyphCanvasPoint; readonly escape: GlyphCanvasPoint }
export interface GlyphDiagramLayout {
  readonly [GLYPH_DIAGRAM_EDGE_WAYPOINTS]?: Readonly<Record<string, readonly GlyphCanvasPoint[]>>;
  readonly [GLYPH_DIAGRAM_GROUP_BOUNDS]?: ReadonlyMap<string, GlyphDiagramRect>;
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
export interface GlyphDiagramLayoutOptions extends GlyphDiagramPresentationOptions {
  readonly engine?: "dagre" | "elk"; readonly direction?: GlyphGraph["direction"];
  readonly nodesep?: number; readonly ranksep?: number;
  readonly charset?: GlyphCanvasTierName; readonly labelWidth?: number;
  /** Widest a self-loop's label row may be before it wraps onto another row, default 24. */
  readonly loopLabelWidth?: number;
  /** Pad a nested group's frame outside its child's, default true. The fitter turns it off before it splits a graph or cuts a word. */
  readonly frameInset?: boolean;
  readonly margin?: number;
  readonly [GLYPH_DIAGRAM_WORD_WIDTH]?: boolean;
  readonly [GLYPH_DIAGRAM_COMPARTMENT_LANES]?: boolean;
  readonly [GLYPH_DIAGRAM_EDGE_LABEL_ROOM]?: readonly string[];
  readonly [GLYPH_DIAGRAM_FAN_GAP]?: boolean;
}
/** A node label as the cells will show it: folded to the charset line by line. */
export function glyphDiagramFoldLabel(label: string, charset?: GlyphCanvasTierName): string {
  return label.split(/\r?\n/).map((line) => glyphDiagramText(line, charset)).join("\n");
}
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
/** Punctuation belongs to the preceding piece when a label wraps. */
export function glyphDiagramWords(text: string, width = 0): string[] {
  return text.split(/\s+|(?<=[+/:])/).flatMap(piece => piece.length > width ? piece.split(/(?<=-)/) : [piece]).filter(Boolean);
}

/** Stable synthetic ids preserve duplicate edges without depending on input order. */
export function canonicalizeGlyphGraph(graph: GlyphGraph): Omit<GlyphGraph, "edges"> & { edges: GlyphDiagramEdge[] } {
  const signature = (edge: GlyphGraphEdge) => JSON.stringify([edge.from, edge.to, edge.label ?? "", edge.style ?? "solid", edge.priority ?? 0,
    ...(edge.startHead !== undefined || edge.endHead !== undefined || edge.invisible !== undefined ? [edge.startHead, edge.endHead, edge.invisible] : [])]);
  const sorted = [...graph.edges].sort((a, b) => compare(a.id ?? "", b.id ?? "") || compare(signature(a), signature(b)));
  const ids = new Set(sorted.flatMap((e) => e.id === undefined ? [] : [e.id]));
  const counts = new Map<string, number>();
  const edges = sorted.map((e) => {
    if (e.id !== undefined) return { ...e, id: e.id };
    const base = `edge:${signature(e)}`;
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
      const pieces = glyphDiagramWords(word, width);
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
    fold(node.label, "node label", node.id);
    const marker = glyphDiagramHasDiamondMarker(node, options);
    const folded = glyphDiagramNodeText(node, options);
    const nodeLimit = options[GLYPH_DIAGRAM_WORD_WIDTH] ? Math.max(limit, ...glyphDiagramWords([folded, ...(node.compartments ?? []).flat()].join("\n"), Infinity).map(word => word.length)) : limit;
    const lines = glyphDiagramWrap(folded, nodeLimit);
    const separators: number[] = [];
    if (node.shape === "compartment") for (const part of node.compartments ?? []) {
      if (!part.some(row => row.trim())) continue;
      separators.push(lines.length);
      lines.push("", ...part.flatMap((row) => glyphDiagramWrap(fold(row, "member row", node.id), nodeLimit)));
    }
    const extra = node.shape === "subroutine" ? 2 : 0;
    // A point is the first character of its label and nothing else, and says so when it drops the rest;
    // `reserveGlyphGraphPorts` adds the cells its edges need.
    if (node.shape === "point") {
      const glyph = Array.from(folded.trim())[0] ?? "";
      if (Array.from(folded.trim()).length > 1) ledger.push(ledgerLabelAbbreviated({ role: "node label", before: folded.trim(), after: glyph }));
      return { ...node, lines: [glyph], width: 1, height: 1 };
    }
    if (glyphDiagramCatalogueShape(node.shape)) {
      const art = glyphDiagramCatalogueArt(node.shape, lines, options.charset);
      return { ...node, lines, width: art.width, height: art.height };
    }
    return { ...node, [GLYPH_DIAGRAM_DIAMOND_MARKER]: marker, lines, ...(separators.length ? { separators } : {}), width: Math.max(5, ...lines.map((l) => l.length + 2 + 2 * GLYPH_DIAGRAM_NODE_PAD.x + extra)), height: lines.length + 2 + 2 * GLYPH_DIAGRAM_NODE_PAD.y };
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

/** Approved ornate outlines attach on interior rows, leaving their rules intact. */
export function glyphDiagramNodePortSide(node: GlyphGraphNode, side: GlyphCanvasDirection): GlyphCanvasDirection {
  return node.shape === "cloud" || node.shape === "bang" || node.shape === "hexagon" || glyphDiagramCatalogueShape(node.shape)
    ? side === "n" ? "w" : side === "s" ? "e" : side : side;
}

/** Preserve slot order/spacing while keeping side ports off compartment rules and corners. */
export function glyphDiagramPortOffsets(node: GlyphDiagramMeasuredNode, side: GlyphCanvasDirection, desired: readonly number[]): number[] | undefined {
  const catalogue = glyphDiagramCatalogueShape(node.shape) ? glyphDiagramCatalogueArt(node.shape, node.lines, "box", node.width, node.height) : undefined;
  if ((!catalogue && node.shape !== "compartment") || side === "n" || side === "s") return [...desired];
  const top = Math.floor((node.height - node.lines.length) / 2);
  const rules = new Set((node.separators ?? []).map(row => top + row));
  const available = catalogue ? [...catalogue.portRows] : Array.from({ length: node.height - 2 }, (_, i) => i + 1).filter(offset => !rules.has(offset));
  // Backward bounds leave room for later slots before choosing the nearest legal row.
  const latest: number[] = [];
  for (let i = desired.length - 1; i >= 0; i--) {
    const limit = i === desired.length - 1 ? available[available.length - 1]! : latest[i + 1]! - (desired[i + 1]! - desired[i]!);
    const offset = [...available].reverse().find(offset => offset <= limit);
    if (offset === undefined) return undefined;
    latest[i] = offset;
  }
  const offsets: number[] = [];
  for (let i = 0; i < desired.length; i++) {
    const limit = i === 0 ? available[0]! : offsets[i - 1]! + (desired[i]! - desired[i - 1]!);
    const choices = available.filter(offset => offset >= limit && offset <= latest[i]!);
    choices.sort((a, b) => Math.abs(a - desired[i]!) - Math.abs(b - desired[i]!) || a - b);
    offsets.push(choices[0]!);
  }
  return offsets;
}

export function reserveGlyphGraphPorts(measured: GlyphDiagramMeasuredGraph): GlyphDiagramReservedGraph {
  const ports: GlyphDiagramPort[] = [];
  const [fromSide, toSide] = sides[measured.direction];
  // A self-edge never competes for the flow sides: it hangs on the loop side.
  const flow = measured.edges.filter((e) => e.from !== e.to);
  const loopSide = glyphDiagramLoopSide(measured.direction);
  const back = backEdgeIds(measured.nodes, flow);
  // Closing edges use transverse ports, not the flow sides.
  const backSide = loopSide === "e" ? "w" : "n";
  const pointIds = new Set(measured.nodes.filter((node) => node.shape === "point").map((node) => node.id));
  const edgeSide = (edge: GlyphDiagramEdge, end: "from" | "to") => {
    const node = measured.nodes.find(node => node.id === edge[end])!;
    const side = glyphDiagramNodePortSide(node, back.has(edge.id) && !pointIds.has(edge[end]) ? backSide : end === "from" ? fromSide : toSide);
    // Ornate nodes keep their east side for loops; flow ports need separate slots.
    return glyphDiagramNodePortSide(node, "s") === "e" && side === "e" && measured.loops.some(loop => loop.nodeId === node.id) ? "w" : side;
  };
  const nodes = measured.nodes.map((node) => {
    let width = node.width, height = node.height;
    // A point has no border to keep ports off its corners: k ports need 2k - 1 cells. Along the flow it also holds what its
    // entries need before the glyph: nothing, one arrowhead, or (several) a bar and then one arrowhead.
    const point = node.shape === "point", room = (count: number) => point ? Math.max(1, 2 * count - 1) : 2 * count + 1;
    const connectionsOn = (side: GlyphCanvasDirection) => flow.flatMap((edge) => [
      ...(edge.from === node.id && !(edge as GlyphMermaidStateFrame)[GLYPH_MERMAID_STATE_FRAME]?.from && side === edgeSide(edge, "from") ? [{ edgeId: edge.id, end: "from" as const }] : []),
      ...(edge.to === node.id && !(edge as GlyphMermaidStateFrame)[GLYPH_MERMAID_STATE_FRAME]?.to && side === edgeSide(edge, "to") ? [{ edgeId: edge.id, end: "to" as const }] : []),
    ]);
    const slotsOn = (side: GlyphCanvasDirection) => {
      const slots = new Map<string, ReturnType<typeof connectionsOn>>();
      for (const connection of connectionsOn(side)) {
        const edge = flow.find(edge => edge.id === connection.edgeId)!;
        // Forward branches of one style share their stem; points and returns retain their own lanes.
        const parallel = flow.filter(other => other.from === edge.from && other.to === edge.to).length > 1;
        const crossesFrame = measured.groups.some(group => group.members.includes(edge.from) !== group.members.includes(edge.to));
        const mixedFan = connection.end === "from"
          ? flow.some(branch => branch.from === node.id && flow.some(other => other.to === branch.to && other.from !== node.id))
          : flow.some(branch => branch.to === node.id && flow.some(other => other.from === branch.from && other.to !== node.id));
        const key = pointIds.has(edge.from) || pointIds.has(edge.to) || back.has(edge.id) || parallel || crossesFrame || mixedFan || edge.startHead || edge.endHead || edge.invisible ? edge.id : JSON.stringify([node.id, side, connection.end, edge.style ?? "solid"]);
        slots.set(key, [...(slots.get(key) ?? []), connection]);
      }
      return [...slots.entries()];
    };
    // A shared exit would give a relation marker to every edge using it.
    const sharedFanSide = (slots: ReturnType<typeof slotsOn>) => slots.length > 1 && slots.some(([, connections]) => connections.length === 1) && slots.every(([, connections]) => connections.every(connection => connection.end === "from"
      && !flow.some(edge => edge.id === connection.edgeId && edge.startHead && edge.startHead !== "none")
      && !back.has(connection.edgeId) && !pointIds.has(node.id)
      && !pointIds.has(flow.find(edge => edge.id === connection.edgeId)!.to)
      && flow.filter(edge => edge.from === node.id && edge.to === flow.find(edge => edge.id === connection.edgeId)!.to).length === 1
      && !flow.some(edge => edge.to === flow.find(edge => edge.id === connection.edgeId)!.to && edge.from !== node.id)))
      && !measured.groups.length && !back.size;
    // Style lanes diverge outside the box; they do not add blank label rows.
    // Size every side before centering any port on it.
    for (const side of ["n", "e", "s", "w"] as const) {
      const slots = slotsOn(side);
      const count = sharedFanSide(slots) ? 1 : slots.length;
      if (side === "n" || side === "s") width = Math.max(width, room(count));
      else height = Math.max(height, room(count));
    }
    if (point) {
      const entries = flow.filter((e) => e.to === node.id && !(e as GlyphMermaidStateFrame)[GLYPH_MERMAID_STATE_FRAME]?.to).length, along = entries === 0 ? 1 : entries === 1 ? 2 : 3;
      if (loopSide === "e") height = Math.max(height, along); else width = Math.max(width, along);
    }
    const nodeLoopSide = glyphDiagramNodePortSide(node, loopSide);
    const loops = glyphDiagramLoopSlots(measured.loops.filter((loop) => loop.nodeId === node.id), nodeLoopSide);
    if (node.shape === "compartment") {
      if (nodeLoopSide === "e") height = Math.max(height, loops.length); else width = Math.max(width, loops.length);
    }
    const desired = (side: GlyphCanvasDirection) => {
      const slots = slotsOn(side), count = sharedFanSide(slots) ? Math.min(1, slots.length) : slots.length;
      const length = side === "n" || side === "s" ? width : height;
      return Array.from({ length: count }, (_, index) => Math.floor((length - 1 - 2 * (count - 1)) / 2) + 2 * index);
    };
    const loopDesired = loops.slots.flatMap(slot => [slot.exit, slot.entry]);
    if (glyphDiagramCatalogueShape(node.shape)) {
      if (nodeLoopSide === "e") height = Math.max(height, loops.length); else width = Math.max(width, loops.length);
      let art = glyphDiagramCatalogueArt(node.shape, node.lines, "box", width, height);
      width = art.width; height = art.height;
      while ((["e", "w"] as const).some(side => !glyphDiagramPortOffsets({ ...node, width, height }, side, desired(side))) || !glyphDiagramPortOffsets({ ...node, width, height }, nodeLoopSide, loopDesired)) {
        art = glyphDiagramCatalogueArt(node.shape, node.lines, "box", width, height + 1);
        width = art.width; height = art.height;
      }
    }
    if (node.shape === "compartment") while ((["e", "w"] as const).some(side => !glyphDiagramPortOffsets({ ...node, height }, side, desired(side)))
      || !glyphDiagramPortOffsets({ ...node, height }, nodeLoopSide, loopDesired)) height++;
    for (const side of ["n", "e", "s", "w"] as const) {
      const slots = slotsOn(side);
      const offsets = glyphDiagramPortOffsets({ ...node, width, height }, side, desired(side))!;
      slots.forEach(([key, connections], index) => connections.forEach(connection => ports.push({ ...connection,
        nodeId: node.id, side, offset: offsets[sharedFanSide(slots) ? 0 : index]!,
        ...(connections.length > 1 || sharedFanSide(slots) ? { trunk: key } : {}) })));
    }
    if (nodeLoopSide === "e") height = Math.max(height, loops.length); else width = Math.max(width, loops.length);
    const loopOffsets = glyphDiagramPortOffsets({ ...node, width, height }, nodeLoopSide, loopDesired)!;
    loops.slots.forEach((slot, i) => ports.push({ edgeId: slot.edgeId, nodeId: node.id, end: "from", side: nodeLoopSide, offset: loopOffsets[2 * i]! }, { edgeId: slot.edgeId, nodeId: node.id, end: "to", side: nodeLoopSide, offset: loopOffsets[2 * i + 1]! }));
    return { ...node, width, height };
  });
  for (const edge of flow) for (const end of ["from", "to"] as const) {
    if ((edge as GlyphMermaidStateFrame)[GLYPH_MERMAID_STATE_FRAME]?.[end]) ports.push({ edgeId: edge.id, nodeId: edge[end], end, side: end === "from" ? fromSide : toSide, offset: 0 });
  }
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
/** Validate shared layout contracts before either geometry strategy runs. */
export function validateGlyphDiagramLayoutOptions(options: GlyphDiagramLayoutOptions = {}): void {
  if (options.engine === "elk") glyphDiagramError("GLYPH_DIAGRAM_ELK_NOT_INSTALLED", "The ELK layout adapter is reserved for phase 4; use engine: dagre.");
  if (options.engine !== undefined && options.engine !== "dagre") glyphDiagramError("bad-options", "Phase 2 supports engine dagre only.");
  const nodesep = options.nodesep ?? 4, ranksep = options.ranksep ?? 4, margin = options.margin ?? 1;
  if (![nodesep, ranksep, margin].every(Number.isInteger) || nodesep < (options[GLYPH_DIAGRAM_FAN_GAP] ? 1 : 3) || ranksep < 3 || margin < 0) glyphDiagramError("bad-options", "nodesep/ranksep must be integers >= 3; margin must be an integer >= 0.");
}
export async function layoutGlyphGraph(graph: GlyphGraph | GlyphDiagramReservedGraph, options: GlyphDiagramLayoutOptions = {}): Promise<GlyphDiagramLayout> {
  validateGlyphDiagramLayoutOptions(options);
  const nodesep = options.nodesep ?? 4, ranksep = options.ranksep ?? 4, margin = options.margin ?? 1;
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
    g.setGraph({ rankdir: reserved.direction, nodesep: options[GLYPH_DIAGRAM_FAN_GAP] && !across && !reserved.loops.length && !includedGroups.length && reserved.ports.some(port => port.trunk) ? 1 : nodesep, ranksep, marginx: margin, marginy: margin, edgesep: 1, align });
    // Network-simplex may delay a short branch into a later rank. Even a
    // planar route can then frame it between two longer relations.
    if (options[GLYPH_DIAGRAM_COMPARTMENT_LANES]) g.graph().ranker = (ranked: typeof g) => {
      const pending = new Map(ranked.nodes().map(id => [id, ranked.inEdges(id)!.length]));
      const queue = ranked.nodes().filter(id => !pending.get(id));
      for (const id of ranked.nodes()) ranked.node(id).rank = 0;
      for (let i = 0; i < queue.length; i++) for (const edge of ranked.outEdges(queue[i]!)!) {
        ranked.node(edge.w).rank = Math.max(ranked.node(edge.w).rank!, ranked.node(edge.v).rank! + ranked.edge(edge).minlen!);
        pending.set(edge.w, pending.get(edge.w)! - 1);
        if (!pending.get(edge.w)) queue.push(edge.w);
      }
    };
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
      } else {
        const labelWidth = options[GLYPH_DIAGRAM_EDGE_LABEL_ROOM]?.includes(edge.id) ? glyphDiagramText(edge.label ?? "", options.charset).length : 0;
        // Region captions sit over a horizontal run: ranksep already supplies
        // the two side moats, unlike ordinary label dummies.
        const regionCaption = !across && includedGroups.some(group => (group as GlyphMermaidStateRegion)[GLYPH_MERMAID_STATE_REGION]
          && group.members.includes(edge.from) && group.members.includes(edge.to));
        const room = labelWidth ? { width: Math.max(1, labelWidth + (regionCaption ? -2 : 2)), height: options[GLYPH_DIAGRAM_COMPARTMENT_LANES] && across ? 1 : 3, labelpos: "c" } : {};
        const frame = (edge as GlyphMermaidStateFrame)[GLYPH_MERMAID_STATE_FRAME];
        // Panels keep only their own endpoints; absent region peers must not
        // become phantom Dagre nodes that move the remaining boxes.
        const peers = (end: "from" | "to") => frame?.[end]?.nodes.filter(id => reserved.nodes.some(node => node.id === id));
        const froms = peers("from")?.length ? peers("from")! : [edge.from], tos = peers("to")?.length ? peers("to")! : [edge.to];
        // Constrain all region ranks without manufacturing drawable transitions.
        for (const from of froms) for (const to of tos) {
          if (back.has(edge.id)) g.setEdge(to, from, room, edge.id);
          else g.setEdge(from, to, room, edge.id);
        }
      }
    }
    dagre.layout(g, !includedGroups.length && !reserved.loops.length && !back.size ? {
      customOrder: (ordered, order) => {
        order(ordered, {});
        if (options[GLYPH_DIAGRAM_COMPARTMENT_LANES]) {
          const positions = glyphDiagramCompartmentOrder(reserved);
          const rows = new Map<number, string[]>();
          for (const id of ordered.nodes()) {
            const rank = ordered.node(id).rank!;
            rows.set(rank, [...(rows.get(rank) ?? []), id]);
          }
          const position = (id: string) => positions.nodes.get(id)
            ?? positions.edges.get((ordered.node(id) as { edgeObj?: { name?: string } }).edgeObj?.name ?? "") ?? 0;
          for (const row of rows.values()) row.sort((a, b) => position(a) - position(b) || ordered.node(a).order! - ordered.node(b).order!)
            .forEach((id, i) => { ordered.node(id).order = i; });
          return;
        }
        // A source with one destination must not straddle an unrelated fan.
        // Constrain disjoint destination spans, then let Dagre order its dummy
        // chains too; moving just the real boxes leaves the crossing behind.
        const sources = reserved.nodes.filter(node => !reserved.edges.some(edge => edge.to === node.id));
        const spans = sources.flatMap(node => {
          const targets = reserved.edges.filter(edge => edge.from === node.id).map(edge => ordered.node(edge.to));
          if (!targets.length || targets.some(target => target.rank !== targets[0]!.rank)) return [];
          return [{ id: node.id, rank: ordered.node(node.id).rank, targetRank: targets[0]!.rank,
            first: Math.min(...targets.map(target => target.order!)), last: Math.max(...targets.map(target => target.order!)) }];
        });
        const constraints: { left: string; right: string }[] = [];
        // Disjoint tree children can differ in size and descendants without
        // competing topology constraints. Keep their authored top-to-bottom
        // order too; sorting only equivalent leaves reverses whole subtrees.
        const treeNodes = new Map<string, boolean>();
        const tree = (id: string): boolean => {
          if (!treeNodes.has(id)) {
            // A back-link disqualifies a subtree during Dagre's initial cycle pass.
            treeNodes.set(id, false);
            treeNodes.set(id, reserved.edges.filter(edge => edge.from === id).every(edge =>
              reserved.edges.filter(other => other.to === edge.to).length === 1 && tree(edge.to)));
          }
          return treeNodes.get(id)!;
        };
        const siblings = new Map<string, string[]>();
        for (const node of reserved.nodes) {
          const incoming = reserved.edges.filter(edge => edge.to === node.id).map(edge => edge.from).sort(compare);
          if (across || incoming.length !== 1) continue;
          const outgoing = reserved.edges.filter(edge => edge.from === node.id).map(edge => edge.to).sort(compare);
          const parentChildren = reserved.edges.filter(edge => edge.from === incoming[0]);
          const treeFamily = parentChildren.length > 1 && (parentChildren.every(edge => edge.style === "undirected") || parentChildren.some(edge => reserved.edges.some(child => child.from === edge.to)))
            && parentChildren.every(edge => tree(edge.to));
          const key = JSON.stringify(treeFamily ? [ordered.node(node.id).rank, incoming] :
            [ordered.node(node.id).rank, node.width, node.height, node.shape, incoming, outgoing,
              reserved.edges.filter(edge => edge.from === node.id || edge.to === node.id).map(edge => edge.style)]);
          const family = siblings.get(key) ?? [];
          family.push(node.id); siblings.set(key, family);
        }
        for (const family of siblings.values()) family.slice(1).forEach((right, i) => constraints.push({ left: family[i]!, right }));
        for (const rank of new Set(spans.map(span => span.rank))) {
          const row = spans.filter(span => span.rank === rank);
          if (row.some(span => span.targetRank !== row[0]!.targetRank)) continue;
          if (!row.some(left => row.some(right => left.last < right.first
            && ordered.node(left.id).order! > ordered.node(right.id).order!))) continue;
          row.sort((a, b) => a.first + a.last - b.first - b.last || ordered.node(a.id).order! - ordered.node(b.id).order!);
          row.slice(1).forEach((right, i) => constraints.push({ left: row[i]!.id, right: right.id }));
        }
        for (const source of sources) {
          const targets = reserved.edges.filter(edge => edge.from === source.id).map(edge => edge.to);
          if (targets.length !== 1) continue;
          for (const fan of reserved.nodes.filter(node => node.id !== source.id && ordered.node(node.id).rank === ordered.node(source.id).rank)) {
            const children = reserved.edges.filter(edge => edge.from === fan.id).map(edge => edge.to);
            if (children.length < 2 || !children.includes(targets[0]!) || children.some(id => ordered.node(id).rank !== ordered.node(targets[0]!).rank)) continue;
            children.sort((a, b) => ordered.node(a).order! - ordered.node(b).order!);
            if (targets[0] === children[0]) constraints.push({ left: source.id, right: fan.id });
            else if (targets[0] === children.at(-1)) constraints.push({ left: fan.id, right: source.id });
          }
        }
        if (constraints.length) {
          const original = new Map(ordered.nodes().map(id => [id, ordered.node(id).order]));
          // Normalized edges join adjacent ranks, including the dummy chains.
          // Count weighted inversions across every rank, as Dagre's sweep does.
          const crossings = () => {
            const edges = ordered.edges();
            const rows = new Map<number, typeof edges>();
            for (const edge of edges) {
              const rank = ordered.node(edge.v).rank!;
              const row = rows.get(rank) ?? [];
              row.push(edge); rows.set(rank, row);
            }
            let count = 0;
            for (const row of rows.values()) for (let i = 0; i < row.length; i++) {
              const a = row[i]!;
              for (const b of row.slice(i + 1)) {
                if ((ordered.node(a.v).order! - ordered.node(b.v).order!)
                  * (ordered.node(a.w).order! - ordered.node(b.w).order!) < 0) {
                  count += ordered.edge(a).weight! * ordered.edge(b).weight!;
                }
              }
            }
            return count;
          };
          const before = crossings();
          order(ordered, { constraints });
          if (crossings() > before) for (const [id, position] of original) ordered.node(id).order = position;
        }
      },
    } : {});
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
  // Dagre may reverse compound siblings. Move whole region envelopes, including
  // their loop room, into authored slots before assigning any real ports/routes.
  for (const parent of [...includedGroups].sort((a, b) => groupDepths.get(b.id)! - groupDepths.get(a.id)!)) {
    const regions = includedGroups.filter(group => (group as GlyphMermaidStateRegion)[GLYPH_MERMAID_STATE_REGION]?.parent === parent.id)
      .sort((a, b) => (a as GlyphMermaidStateRegion)[GLYPH_MERMAID_STATE_REGION]!.index - (b as GlyphMermaidStateRegion)[GLYPH_MERMAID_STATE_REGION]!.index);
    if (regions.length < 2) continue;
    const envelope = (group: GlyphGraphGroup) => {
      const members = positioned.filter(node => group.members.includes(node.id));
      return { group, lo: Math.min(...members.map(node => across ? node.x0 : node.y0)),
        hi: Math.max(...members.map(node => (across ? node.x1 : node.y1) + loopRoom(node.id).reach)) };
    };
    const authored = regions.map(envelope), visual = [...authored].sort((a, b) => a.lo - b.lo);
    let cursor = visual[0]!.lo;
    const shifts = new Map<string, number>();
    authored.forEach((region, i) => {
      for (const id of region.group.members) shifts.set(id, cursor - region.lo);
      cursor += region.hi - region.lo + 1;
      if (i + 1 < visual.length) cursor += Math.max(1, visual[i + 1]!.lo - visual[i]!.hi - 1);
    });
    positioned = positioned.map(node => {
      const delta = shifts.get(node.id) ?? 0;
      return across ? { ...node, x0: node.x0 + delta, x1: node.x1 + delta } : { ...node, y0: node.y0 + delta, y1: node.y1 + delta };
    });
  }
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
  if (options[GLYPH_DIAGRAM_FAN_GAP] && !across && !reserved.loops.length && !includedGroups.length && !back.size && !reserved.nodes.some(node => node.shape === "point")) {
    for (const source of reserved.nodes) {
      const targets = positioned.filter(node => reserved.edges.some(edge => edge.from === source.id && edge.to === node.id));
      if (targets.length < 2 || targets.some(node => reserved.edges.some(edge => edge.from === node.id || (edge.to === node.id && edge.from !== source.id)))
        || targets.some(node => rank(node.id) !== rank(targets[0]!.id))) continue;
      const near = reserved.direction === "LR" ? Math.min(...targets.map(node => node.x0)) : Math.max(...targets.map(node => node.x1));
      const ids = new Set(targets.map(node => node.id));
      positioned = positioned.map(node => !ids.has(node.id) ? node : reserved.direction === "LR"
        ? { ...node, x0: near, x1: near + node.width - 1 } : { ...node, x1: near, x0: near - node.width + 1 });

    }
  }
  // Compound engines reserve caption padding in their own units. A global
  // translation removes that leading whitespace without changing any node separation.
  // A group nested k deep draws k frames, each GROUP_PAD outside the last, so the outermost needs that room on every side.
  const frameInset = options.frameInset ?? true;
  const inset = frameInset ? Math.max(0, ...groupDepths.values()) * GLYPH_DIAGRAM_GROUP_PAD : 0;
  const lanePoints = options[GLYPH_DIAGRAM_COMPARTMENT_LANES] ? reserved.edges.flatMap(edge =>
    (g.edge({ v: edge.from, w: edge.to, name: edge.id }).points as GlyphCanvasPoint[]).slice(1, -1)) : [];
  const shiftX = Math.min(...positioned.map((node) => node.x0), ...lanePoints.map(p => Math.floor(p.x))) - margin - inset;
  const shiftY = Math.min(...positioned.map((node) => node.y0), ...lanePoints.map(p => Math.floor(p.y))) - margin - inset;
  const nodes = positioned.map((node) => ({ ...node, x0: node.x0 - shiftX, x1: node.x1 - shiftX, y0: node.y0 - shiftY, y1: node.y1 - shiftY }));
  const byId = new Map(nodes.map((node) => [node.id, node]));
  // Follow Dagre's transverse embedding for a reversed edge; a fixed side can
  // cross the forward branch Dagre put on that side. Capacity was reserved on
  // the opposite self-loop side; switching a subset keeps that same capacity.
  const backSides = new Map<string, GlyphCanvasDirection>();
  for (const edge of reserved.edges.filter((edge) => back.has(edge.id))) {
    const from = g.node(edge.from), to = g.node(edge.to);
    const path = g.edge({ v: edge.from, w: edge.to, name: edge.id }) ?? g.edge({ v: edge.to, w: edge.from, name: edge.id });
    const points = path.points as { x: number; y: number }[];
    const axis = across ? "x" : "y";
    const middle = points[Math.floor(points.length / 2)]![axis];
    const positive = middle > (from[axis] + to[axis]) / 2;
    const hasLoop = reserved.loops.some((loop) => loop.nodeId === edge.from || loop.nodeId === edge.to);
    backSides.set(edge.id, hasLoop ? (across ? "w" : "n") : across ? (positive ? "e" : "w") : (positive ? "s" : "n"));
  }
  const compartmentLanes = options[GLYPH_DIAGRAM_COMPARTMENT_LANES] && !includedGroups.length && !reserved.loops.length && !back.size && nodes.every(node => node.shape === "compartment");
  let planned = reserved.ports.map(port => {
    if (backSides.has(port.edgeId) && byId.get(port.nodeId)!.shape !== "point") return { ...port, side: glyphDiagramNodePortSide(byId.get(port.nodeId)!, backSides.get(port.edgeId)!) };
    if (compartmentLanes) {
      const edge = reserved.edges.find(edge => edge.id === port.edgeId)!;
      const points = g.edge({ v: edge.from, w: edge.to, name: edge.id }).points as GlyphCanvasPoint[];
      const node = byId.get(port.nodeId)!;
      const adjacent = port.end === "from" ? points[1]! : points[points.length - 2]!;
      const at = across ? adjacent.x - shiftX : adjacent.y - shiftY;
      // A lateral entry needs two escape cells plus the router's one-cell moat.
      const clearance = port.end === "to" ? 3 : 1;
      if ((port.end === "to" || points.length > 3) && at < (across ? node.x0 : node.y0) - clearance) return { ...port, side: across ? "w" as const : "n" as const };
      if ((port.end === "to" || points.length > 3) && at > (across ? node.x1 : node.y1) + clearance) return { ...port, side: across ? "e" as const : "s" as const };
    }
    return port;
  });
  // A lateral landing may not have enough legal rows. Leave that geometry to
  // the bounded fallback rather than manufacturing an overlapping port.
  if (compartmentLanes && nodes.some(node => (["n", "e", "s", "w"] as const).some(side => {
    const count = planned.filter(port => port.nodeId === node.id && port.side === side).length;
    const length = side === "n" || side === "s" ? node.width : node.height;
    return count > 0 && (length < 2 * count + 1 || !glyphDiagramPortOffsets(node, side,
      Array.from({ length: count }, (_, i) => Math.floor((length - 1 - 2 * (count - 1)) / 2) + 2 * i)));
  }))) planned = reserved.ports.map(port => ({ ...port }));
  // Capacity and escape slots were reserved before layout. Assign those slots
  // in the engine's actual transverse order, not in lexical edge order: dagre
  // 3 may reverse siblings while retaining a perfectly planar embedding.
  const offsets = new Map<GlyphDiagramPort, number>();
  for (const port of planned) if ((reserved.edges.find(edge => edge.id === port.edgeId)! as GlyphMermaidStateFrame)[GLYPH_MERMAID_STATE_FRAME]?.[port.end]) offsets.set(port, port.offset);
  for (const node of nodes) for (const side of ["n", "e", "s", "w"] as const) {
    const ports = planned.filter((p) => p.nodeId === node.id && p.side === side && !(reserved.edges.find(edge => edge.id === p.edgeId)! as GlyphMermaidStateFrame)[GLYPH_MERMAID_STATE_FRAME]?.[p.end]);
    const transverse = (port: GlyphDiagramPort) => {
      const edge = reserved.edges.find((e) => e.id === port.edgeId)!;
      const path = compartmentLanes
        ? g.edge({ v: edge.from, w: edge.to, name: edge.id }).points as GlyphCanvasPoint[] : undefined;
      if (path && path.length > 3 && (across ? side === "n" || side === "s" : side === "w" || side === "e")) {
        const adjacent = port.end === "from" ? path[1]! : path[path.length - 2]!;
        return 2 * (side === "n" || side === "s" ? adjacent.x - shiftX : adjacent.y - shiftY);
      }
      const other = byId.get(port.end === "from" ? edge.to : edge.from)!;
      return side === "n" || side === "s" ? other.x0 + other.x1 : other.y0 + other.y1;
    };
    const length = side === "n" || side === "s" ? node.width : node.height;
    const loops = new Set(reserved.loops.map(loop => loop.edgeId));
    for (const port of ports.filter(port => loops.has(port.edgeId))) offsets.set(port, port.offset);
    const slots = new Map<string, GlyphDiagramPort[]>();
    for (const port of ports.filter(port => !loops.has(port.edgeId))) {
      const key = port.trunk ?? `${port.edgeId}:${port.end}`;
      slots.set(key, [...(slots.get(key) ?? []), port]);
    }
    // A catalogue loop owns the east side. Keep the displaced exits below
    // all entries on the west side, so their return run cannot cut a feeder.
    const loopedCatalogue = glyphDiagramCatalogueShape(node.shape) && reserved.loops.some(loop => loop.nodeId === node.id);
    const ordered = [...slots.values()].sort((a, b) => (loopedCatalogue ? Number(a[0]!.end === "from") - Number(b[0]!.end === "from") : 0)
      || transverse(a[0]!) - transverse(b[0]!) || compare(a[0]!.edgeId, b[0]!.edgeId));
    const reservedOffsets = ordered.map(slot => slot[0]!.offset).sort((a, b) => a - b);
    const centered = glyphDiagramPortOffsets(node, side, ordered.map((_, i) => Math.floor((length - 1 - 2 * (ordered.length - 1)) / 2) + 2 * i))!;
    ordered.forEach((slot, i) => slot.forEach(port => offsets.set(port, ports.some(port => back.has(port.edgeId) || compartmentLanes && reserved.ports.find(original => original.edgeId === port.edgeId && original.end === port.end)!.side !== port.side)
      ? centered[i]! : reservedOffsets[i]!)));
  }
  // A fan-in trunk may meet a nearby source column without a one-cell jog.
  if (across && options[GLYPH_DIAGRAM_FAN_GAP] && !includedGroups.length && !reserved.loops.length && !back.size
    && !reserved.nodes.some(node => node.shape === "point")) {
    for (const node of nodes) for (const side of ["n", "s"] as const) {
      const family = planned.filter(port => port.nodeId === node.id && port.side === side);
      if (family.length < 2 || family.some(port => port.end !== "to" || !port.trunk || port.trunk !== family[0]!.trunk
        || reserved.edges.find(edge => edge.id === port.edgeId)!.label)) continue;
      const at = node.x0 + offsets.get(family[0]!)!;
      const columns = family.map(port => {
        const source = planned.find(other => other.edgeId === port.edgeId && other.end === "from")!;
        return byId.get(source.nodeId)!.x0 + offsets.get(source)!;
      }).filter(x => Math.abs(x - at) <= 1 && x > node.x0 && x < node.x1);
      columns.sort((a, b) => Math.abs(a - at) - Math.abs(b - at) || a - b);
      if (columns.length) {
        const dx = columns[0]! - at;
        const shifted = { ...node, x0: node.x0 + dx, x1: node.x1 + dx };
        if (shifted.x0 < margin || nodes.some(other => other.id !== node.id && other.y0 <= shifted.y1 + 1 && other.y1 >= shifted.y0 - 1
          && other.x0 <= shifted.x1 + 1 && other.x1 >= shifted.x0 - 1)) continue;
        // Move the box with its centre port; moving just the port trades the
        // merge jog for an off-centre arrowhead on the fan-in target.
        nodes[nodes.indexOf(node)] = shifted;
        byId.set(node.id, shifted);
      }
    }
  }
  const ports = planned.map((original) => {
    const port = { ...original, offset: offsets.get(original)! };
    const edge = reserved.edges.find(edge => edge.id === port.edgeId)!;
    if (options[GLYPH_DIAGRAM_FAN_GAP] && across && edge.label && glyphDiagramText(edge.label, options.charset).length > byId.get(port.nodeId)!.width - 4 && !reserved.nodes.some(node => node.shape === "point") && port.end === "to" && (port.side === "n" || port.side === "s")) {
      const source = planned.find(other => other.edgeId === edge.id && other.end === "from")!;
      const sourceNode = byId.get(source.nodeId)!, target = byId.get(port.nodeId)!;
      const stem = sourceNode.x0 + offsets.get(source)!;
      const at = target.x0 + port.offset;
      const distance = glyphDiagramText(edge.label, options.charset).length + 3;
      const wish = stem - Math.sign(stem - at) * distance;
      if (Math.abs(stem - at) < distance && wish > target.x0 && wish < target.x1) port.offset = wish - target.x0;
    }

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
  // Vertical labels live beside the route, beyond the normalized node bounds.
  const labelRoomEnd = across ? reserved.edges.filter(edge => !back.has(edge.id) && options[GLYPH_DIAGRAM_EDGE_LABEL_ROOM]?.includes(edge.id)).map(edge =>
    Math.max(...ports.filter(port => port.edgeId === edge.id).map(port => port.anchor.x))
      + glyphDiagramText(edge.label ?? "", options.charset).length + 3 + margin) : [];
  const waypoints = compartmentLanes ? Object.fromEntries(reserved.edges.map(edge => {
    const points = (g.edge({ v: edge.from, w: edge.to, name: edge.id }).points as GlyphCanvasPoint[]).slice(1, -1)
      .map(p => ({ x: Math.round(p.x - shiftX), y: Math.round(p.y - shiftY) }));
    // Fractional BK positions can round one straight corridor onto two cells.
    // Snap a one-cell drift outward, avoiding a needless S in a long relation.
    const axis = across ? "x" : "y";
    const values = points.map(p => p[axis]), low = Math.min(...values), high = Math.max(...values);
    const from = ports.find(port => port.edgeId === edge.id && port.end === "from")!;
    const delta = GLYPH_DIAGRAM_DIRECTIONS[from.side][axis];
    const lane = delta < 0 ? Math.min(low, from.escape[axis] - 1) : delta > 0 ? Math.max(high, from.escape[axis] + 1) : Math.round((low + high) / 2);
    return [edge.id, high - low <= 1 ? points.map(p => ({ ...p, [axis]: lane })) : points];
  })) : undefined;
  const layout = { ...reserved, ...(waypoints ? { [GLYPH_DIAGRAM_EDGE_WAYPOINTS]: waypoints } : {}), ledger, nodes, ports, frameInset, width: Math.max(1, ...lanePoints.map(p => Math.round(p.x - shiftX) + 1 + margin), ...labelRoomEnd, ...nodes.map((n) => n.x1 + 1 + margin + inset), ...loopRoomEnd.map((b) => b.x1 + 1 + b.pad + inset)), height: Math.max(1, ...lanePoints.map(p => Math.round(p.y - shiftY) + 1 + margin), ...nodes.map((n) => n.y1 + 1 + margin + inset), ...loopRoomEnd.map((b) => b.y1 + 1 + b.pad + inset)) };
  return glyphDiagramStateFramePorts(layout, { cols: layout.width, rows: layout.height });
}
