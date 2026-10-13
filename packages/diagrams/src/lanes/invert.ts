import type { GlyphLaneDag } from "./types";

/** Every parent id a `truncated` window names that its own `nodes` lack — one entry per reference, keyed to the node that names it. */
export function glyphLaneOutsideParents(dag: GlyphLaneDag): { readonly nodeId: string; readonly parentId: string }[] {
  const present = new Set(dag.nodes.map((node) => node.id));
  return dag.nodes.flatMap((node) => node.parents.filter((p) => !present.has(p)).map((parentId) => ({ nodeId: node.id, parentId })));
}

/**
 * Re-expresses a newest-first DAG oldest-first for top-down reading: nodes
 * reversed, each node's `parents` replaced by its children (in the order
 * they appear in the reversed array). The result satisfies the same "every
 * parent occurs later" contract, so `layoutGlyphLaneRows` and its connector
 * semantics apply unchanged — lines joining above a node mean it had several
 * parents, branches below mean it had several children. A window's cut is at
 * the TOP in this order, so each absent parent becomes an `incoming` lane
 * waiting for the node that named it. `continuesFrom` carries each node's
 * ORIGINAL first parent, so the layout keeps a node on its first parent's
 * lane rather than on whichever arriving lane happens to be leftmost.
 */
export function invertGlyphLaneDag(dag: GlyphLaneDag): {
  readonly dag: GlyphLaneDag;
  readonly incoming: readonly { readonly id: string; readonly source: string }[];
  readonly continuesFrom: ReadonlyMap<string, string>;
} {
  const reversed = [...dag.nodes].reverse();
  const children = new Map<string, string[]>(reversed.map((node) => [node.id, []]));
  for (const node of reversed) for (const parentId of node.parents) children.get(parentId)?.push(node.id);
  return {
    dag: { nodes: reversed.map((node) => ({ ...node, parents: children.get(node.id)! })) },
    incoming: reversed.flatMap((node) => node.parents.filter((p) => !children.has(p)).map((source) => ({ id: node.id, source }))),
    continuesFrom: new Map(dag.nodes.flatMap((node) => (node.parents[0] === undefined ? [] : [[node.id, node.parents[0]] as const]))),
  };
}
