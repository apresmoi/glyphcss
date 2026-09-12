import type { GlyphGraph } from "./types";
import { canonicalizeGlyphGraph } from "./pipeline";
export const GLYPH_DIAGRAM_BUDGET = Object.freeze({ nodes: 9, edges: 12 });
export const GLYPH_DIAGRAM_DEGRADE_STAGES = ["decoration", "duplicates", "leaf-clusters", "split"] as const;
export function glyphDiagramWithinBudget(graph: GlyphGraph): boolean { return graph.nodes.length <= GLYPH_DIAGRAM_BUDGET.nodes && graph.edges.length <= GLYPH_DIAGRAM_BUDGET.edges; }
export function glyphDiagramDropDecoration(graph: GlyphGraph): GlyphGraph {
  return { ...graph, nodes: graph.nodes.map(({ shape: _shape, ...node }) => node), edges: graph.edges.map(({ label: _label, ...edge }) => ({ ...edge, style: edge.style === "undirected" ? "undirected" : "solid" })), groups: graph.groups?.map(({ label: _label, ...group }) => group) };
}
export function glyphDiagramMergeDuplicates(graph: GlyphGraph): { graph: GlyphGraph; ledger: string[] } {
  const seen = new Map<string, string>(), ledger: string[] = [];
  const edges = canonicalizeGlyphGraph(graph).edges.filter((edge) => {
    const key = JSON.stringify([edge.from, edge.to, edge.style === "undirected"]);
    const prior = seen.get(key);
    if (prior !== undefined) { ledger.push(`duplicates: merged edge "${edge.id}" into "${prior}".`); return false; }
    seen.set(key, edge.id); return true;
  });
  return { graph: { ...graph, edges }, ledger };
}
export function glyphDiagramCollapseLeaves(graph: GlyphGraph): { graph: GlyphGraph; ledger: string[] } {
  const clusters = new Map<string, string[]>(), ledger: string[] = [];
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
    ledger.push(`leaf-clusters: collapsed [${members.join(", ")}] into "${id}"; original nodes remain in meta.`);
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
