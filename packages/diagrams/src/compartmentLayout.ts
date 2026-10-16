import type { GlyphDiagramReservedGraph } from "./pipeline";

/** Order real nodes and dummy chains together. Short branches sit outside longer
 * branches, so their parallel runs do not frame an unrelated compartment.
 * Path counts summarize the unfolded DAG without enumerating its paths.
 */
export function glyphDiagramCompartmentOrder(graph: GlyphDiagramReservedGraph) {
  const outgoing = new Map(graph.nodes.map(node => [node.id, [] as typeof graph.edges[number][]]));
  const pending = new Map(graph.nodes.map(node => [node.id, 0]));
  for (const edge of graph.edges) {
    outgoing.get(edge.from)!.push(edge);
    pending.set(edge.to, pending.get(edge.to)! + 1);
  }
  const roots = graph.nodes.filter(node => !pending.get(node.id)).map(node => node.id);
  const order = [...roots];
  for (let i = 0; i < order.length; i++) for (const edge of outgoing.get(order[i]!)!) {
    pending.set(edge.to, pending.get(edge.to)! - 1);
    if (!pending.get(edge.to)) order.push(edge.to);
  }
  const sizes = new Map<string, number>(), depths = new Map<string, number>();
  for (const id of [...order].reverse()) {
    const children = outgoing.get(id)!;
    sizes.set(id, Math.min(Number.MAX_SAFE_INTEGER, Math.max(1, children.reduce((sum, edge) => sum + sizes.get(edge.to)!, 0))));
    depths.set(id, Math.max(0, ...children.map(edge => depths.get(edge.to)! + 1)));
    children.sort((a, b) => depths.get(a.to)! - depths.get(b.to)! || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }
  const starts = new Map<string, { sum: number; count: number }>();
  const nodes = new Map<string, number>(), edges = new Map<string, number>();
  let cursor = 0;
  for (const id of roots) { starts.set(id, { sum: cursor, count: 1 }); cursor += sizes.get(id)!; }
  for (const id of order) {
    const incoming = starts.get(id)!;
    let at = incoming.sum / incoming.count;
    nodes.set(id, at + sizes.get(id)! / 2);
    for (const edge of outgoing.get(id)!) {
      edges.set(edge.id, at + sizes.get(edge.to)! / 2);
      const target = starts.get(edge.to) ?? { sum: 0, count: 0 };
      starts.set(edge.to, { sum: target.sum + at, count: target.count + 1 });
      at += sizes.get(edge.to)!;
    }
  }
  return { nodes, edges };
}
