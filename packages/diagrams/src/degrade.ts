import type { GlyphGraph } from "./types";
import { canonicalizeGlyphGraph } from "./pipeline";
import { ledgerDuplicateEdgeMerged, ledgerLeafClusterCollapsed, type GlyphDiagramLedgerEntry } from "./ledger";
export const GLYPH_DIAGRAM_BUDGET = Object.freeze({ nodes: 9, edges: 12 });
export const GLYPH_DIAGRAM_DEGRADE_STAGES = ["compaction", "decoration", "duplicates", "leaf-clusters", "split"] as const;
/**
 * REVIEW-diagrams-fanout-opus.md P2-1: a flat `4` was a degree-3 measurement
 * ("`ranksep: 3` fills the whole rank gap for a 3-way fan") stated as a
 * universal property; it goes to 0/8 on a degree-4 fan and stays 0/6 to
 * 6/6 climbing degree 6 (`six-port.mmd` needs `7`). The largest single-side
 * port count `N` anywhere in the graph is what the port-lane reservation
 * (`pipeline.ts`'s `min = 2 * connections.length + 1`) and `route.ts`'s
 * escape-lane clearance (`otherLanes`: each port protects its escape cell
 * plus one more, each with a Manhattan-1 halo) actually crowd the rank gap
 * with — measured directly through the real layout+route pipeline
 * (`O -> {N kids} -> M`, `six-port.mmd`'s single fan-out): degree 3 needs
 * `4`, degree 4 needs `5`, degree 6 needs `7` — `N + 1` fits every measured
 * point and is the per-graph floor `renderGlyphDiagram`'s compaction rung
 * steps down toward (never past the validated `>= 3` minimum). It is a
 * LOWER BOUND for the step-down search, not a promise that spacing at the
 * floor itself routes every fan — the search (render.ts) tries every
 * spacing from the caller's own value down to this floor and accepts the
 * first that both fits AND routes; a graph whose floor undershoots what its
 * own geometry needs still finds its answer partway down, or falls through
 * to the next degrade rung same as before this existed.
 */
export function glyphDiagramCompactionFloor(graph: GlyphGraph): number {
  const degree = new Map<string, { out: number; in: number }>();
  for (const node of graph.nodes) degree.set(node.id, { out: 0, in: 0 });
  for (const edge of graph.edges) {
    const from = degree.get(edge.from); if (from) from.out++;
    const to = degree.get(edge.to); if (to) to.in++;
  }
  let maxDegree = 0;
  for (const { out, in: inbound } of degree.values()) maxDegree = Math.max(maxDegree, out, inbound);
  return Math.max(3, maxDegree + 1);
}
export function glyphDiagramWithinBudget(graph: GlyphGraph): boolean { return graph.nodes.length <= GLYPH_DIAGRAM_BUDGET.nodes && graph.edges.length <= GLYPH_DIAGRAM_BUDGET.edges; }
export function glyphDiagramDropDecoration(graph: GlyphGraph): GlyphGraph {
  return { ...graph, nodes: graph.nodes.map(({ shape: _shape, ...node }) => node), edges: graph.edges.map(({ label: _label, ...edge }) => ({ ...edge, style: edge.style === "undirected" ? "undirected" : "solid" })), groups: graph.groups?.map(({ label: _label, ...group }) => group) };
}
export function glyphDiagramMergeDuplicates(graph: GlyphGraph): { graph: GlyphGraph; ledger: GlyphDiagramLedgerEntry[] } {
  const seen = new Map<string, string>(), ledger: GlyphDiagramLedgerEntry[] = [];
  const edges = canonicalizeGlyphGraph(graph).edges.filter((edge) => {
    const key = JSON.stringify([edge.from, edge.to, edge.style === "undirected"]);
    const prior = seen.get(key);
    if (prior !== undefined) { ledger.push(ledgerDuplicateEdgeMerged({ edgeId: edge.id, into: prior })); return false; }
    seen.set(key, edge.id); return true;
  });
  return { graph: { ...graph, edges }, ledger };
}
export function glyphDiagramCollapseLeaves(graph: GlyphGraph): { graph: GlyphGraph; ledger: GlyphDiagramLedgerEntry[] } {
  const clusters = new Map<string, string[]>(), ledger: GlyphDiagramLedgerEntry[] = [];
  for (const node of graph.nodes) {
    const incoming = graph.edges.filter((e) => e.to === node.id);
    if (incoming.length !== 1 || graph.edges.some((e) => e.from === node.id)) continue;
    // Group membership is semantic; collapse only siblings from the same explicit group set.
    const groups = (graph.groups ?? []).filter((g) => g.members.includes(node.id)).map((g) => g.id).sort();
    const key = JSON.stringify([incoming[0]!.from, groups, node.group ?? ""]);
    clusters.set(key, [...(clusters.get(key) ?? []), node.id]);
  }
  let result = graph;
  for (const members of clusters.values()) {
    if (members.length < 2) continue;
    const idBase = `cluster:${JSON.stringify(members.slice().sort())}`;
    let id = idBase;
    while (result.nodes.some((n) => n.id === id)) id += ":cluster";
    const first = result.nodes.find((n) => n.id === members[0])!;
    const cluster = { id, label: `${members.length} leaves`, kind: "cluster", ...(first.group ? { group: first.group } : {}) };
    result = { ...result, nodes: [...result.nodes.filter((n) => !members.includes(n.id)), cluster],
      edges: result.edges.map((e) => members.includes(e.to) ? { ...e, to: id } : e),
      groups: result.groups?.map((g) => ({ ...g, members: [...g.members.filter((n) => !members.includes(n)), ...(members.some((n) => g.members.includes(n)) ? [id] : [])] })) };
    ledger.push(ledgerLeafClusterCollapsed({ members, into: id }));
  }
  const merged = glyphDiagramMergeDuplicates(result);
  return { graph: merged.graph, ledger: [...ledger, ...merged.ledger] };
}
/** Edge-induced panels repeat boundary nodes so every original connection remains inspectable. */
export function splitGlyphGraph(graph: GlyphGraph): GlyphGraph[] {
  const canonical = canonicalizeGlyphGraph(graph), panels: GlyphGraph[] = [];
  const covered = new Set<string>();
  const subset = (ids: Set<string>, edges: GlyphGraph["edges"]): GlyphGraph => ({
    direction: graph.direction, nodes: canonical.nodes.filter((n) => ids.has(n.id)), edges,
    groups: canonical.groups?.map((g) => ({ ...g, members: g.members.filter((id) => ids.has(id)) })).filter((g) => g.members.length),
  });
  for (const edge of canonical.edges) {
    const ids = new Set([edge.from, edge.to]);
    ids.forEach((id) => covered.add(id)); panels.push(subset(ids, [edge]));
  }
  for (const node of canonical.nodes) if (!covered.has(node.id)) panels.push(subset(new Set([node.id]), []));
  return panels;
}
