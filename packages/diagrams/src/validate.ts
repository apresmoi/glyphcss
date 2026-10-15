import { GLYPH_MERMAID_BLOCK } from "./layoutHints";
import type { GlyphGraph, GlyphGraphDirection, GlyphGraphEdgeHead, GlyphGraphEdgeStyle, GlyphGraphNodeShape } from "./types";

export const GLYPH_DIAGRAM_VALIDATION_RULES = [
  "bad-graph", "empty-nodes", "bad-node", "duplicate-node-id", "bad-edge", "duplicate-edge-id",
  "unknown-node", "bad-group", "point-loop", "duplicate-group-id", "unknown-group", "group-membership", "bad-direction",
  "bad-size", "bad-options", "bad-color", "GLYPH_MERMAID_SYNTAX", "GLYPH_MERMAID_BLOCK_SYNTAX", "GLYPH_MERMAID_ARCHITECTURE_SYNTAX", "GLYPH_MERMAID_REQUIREMENT_SYNTAX", "GLYPH_MERMAID_C4_SYNTAX", "GLYPH_MERMAID_CLASS_SYNTAX", "GLYPH_MERMAID_ER_SYNTAX", "GLYPH_MERMAID_GIT_SYNTAX", "GLYPH_MERMAID_MINDMAP_SYNTAX", "GLYPH_MERMAID_STATE_NOTE", "GLYPH_MERMAID_STATE_CONCURRENCY", "GLYPH_MERMAID_STATE_FORK_JOIN", "GLYPH_MERMAID_STATE_COMPOSITE_LOOP", "GLYPH_DIAGRAM_UNROUTABLE", "GLYPH_DIAGRAM_ELK_NOT_INSTALLED",
  "GLYPH_DIAGRAM_BAD_JSON",
] as const;
export type GlyphDiagramValidationRuleId = typeof GLYPH_DIAGRAM_VALIDATION_RULES[number];
export interface GlyphDiagramValidationError extends Error { readonly code: string }

export function glyphDiagramError(code: string, message: string): never {
  throw Object.assign(new TypeError(`glyphcss: ${code}: ${message}`), { code });
}

/** Both JSON boundaries (renderGlyphDiagramJson and the compiled CLI's .json input) need a tagged rule id, not a bare native SyntaxError with no `code`. */
export function parseGlyphDiagramJson(json: string): unknown {
  try { return JSON.parse(json); }
  catch (e) { return glyphDiagramError("GLYPH_DIAGRAM_BAD_JSON", `Invalid JSON: ${e instanceof Error ? e.message : String(e)}`); }
}

export const GLYPH_GRAPH_DIRECTIONS: readonly GlyphGraphDirection[] = ["TB", "LR", "BT", "RL"];
export const GLYPH_GRAPH_NODE_SHAPES: readonly GlyphGraphNodeShape[] = ["rect", "rounded", "diamond", "circle", "subroutine", "asymmetric", "stadium", "cylinder", "point", "compartment"];
export const GLYPH_GRAPH_EDGE_STYLES: readonly GlyphGraphEdgeStyle[] = ["solid", "dotted", "thick", "undirected"];
export const GLYPH_GRAPH_EDGE_HEADS: readonly GlyphGraphEdgeHead[] = ["arrow", "circle", "cross", "none", "triangle", "filled-diamond", "open-diamond", "er-one", "er-zero-one", "er-many", "er-zero-many"];
export const GLYPH_GRAPH_KEYS = ["nodes", "edges", "groups", "direction"];
export const GLYPH_GRAPH_NODE_KEYS = ["id", "label", "kind", "group", "shape", "compartments"];
export const GLYPH_GRAPH_EDGE_KEYS = ["id", "from", "to", "label", "style", "priority", "startHead", "endHead", "invisible"];
export const GLYPH_GRAPH_GROUP_KEYS = ["id", "label", "members", "parent"];

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function identifier(value: unknown): value is string { return typeof value === "string" && /\S/u.test(value); }
function keys(value: Record<string, unknown>, allowed: readonly string[]): boolean { return Object.keys(value).every((key) => allowed.includes(key)); }
function optional(value: Record<string, unknown>, key: string, predicate: (value: unknown) => boolean): boolean { return value[key] === undefined || predicate(value[key]); }
function string(value: unknown): value is string { return typeof value === "string"; }
function member(value: unknown, allowed: readonly string[]): boolean { return string(value) && allowed.includes(value); }

interface GlyphGraphIntegrityFailure { readonly code: GlyphDiagramValidationRuleId; readonly message: string }

/** These relational constraints require the schema's registered Ajv keyword. */
export function glyphGraphIntegrityFailure(graph: GlyphGraph): GlyphGraphIntegrityFailure | null {
  const nodeIds = new Set<string>();
  for (const node of graph.nodes) {
    if (nodeIds.has(node.id)) return { code: "duplicate-node-id", message: `Node id "${node.id}" occurs more than once.` };
    nodeIds.add(node.id);
  }
  const edgeIds = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.id !== undefined) {
      if (edgeIds.has(edge.id)) return { code: "duplicate-edge-id", message: `Edge id "${edge.id}" occurs more than once.` };
      edgeIds.add(edge.id);
    }
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) return { code: "unknown-node", message: `Edge "${edge.id ?? `${edge.from} -> ${edge.to}`}" references an unknown node.` };
    if (edge.from === edge.to && graph.nodes.find((node) => node.id === edge.from)!.shape === "point") return { code: "point-loop", message: `Edge "${edge.id ?? edge.from}" loops on the point node "${edge.from}", which has no border to leave and re-enter.` };
  }
  const groups = new Map<string, ReadonlySet<string>>();
  for (const group of graph.groups ?? []) {
    if (groups.has(group.id)) return { code: "duplicate-group-id", message: `Group id "${group.id}" occurs more than once.` };
    const members = new Set(group.members);
    if (members.size !== group.members.length) return { code: "group-membership", message: `Group "${group.id}" lists a member more than once.` };
    if (group.members.some((id) => !nodeIds.has(id))) return { code: "unknown-node", message: `Group "${group.id}" references an unknown node.` };
    groups.set(group.id, members);
  }
  // Every named parent must be a different group before ancestry is walked, so a chain cannot run off the end.
  for (const group of graph.groups ?? []) {
    if (group.parent !== undefined && (!groups.has(group.parent) || group.parent === group.id)) return { code: "unknown-group", message: `Group "${group.id}" names "${group.parent}" as its parent, which is not another group.` };
  }
  for (const group of graph.groups ?? []) {
    if (group.parent === undefined) continue;
    if (group.members.some((id) => !groups.get(group.parent!)!.has(id))) return { code: "group-membership", message: `Group "${group.id}" lists nodes that its parent "${group.parent}" does not.` };
  }
  const parentOf = new Map((graph.groups ?? []).map((group) => [group.id, group.parent]));
  for (const group of graph.groups ?? []) {
    for (let up = group.parent, steps = 0; up !== undefined; up = parentOf.get(up)) {
      if (up === group.id || ++steps > groups.size) return { code: "group-membership", message: `Group "${group.id}" is its own ancestor.` };
    }
  }
  for (const node of graph.nodes) {
    if (node.group === undefined) continue;
    const members = groups.get(node.group);
    if (!members) return { code: "unknown-group", message: `Node "${node.id}" references unknown group "${node.group}".` };
    if (!members.has(node.id)) return { code: "group-membership", message: `Node "${node.id}" must occur in its group "${node.group}" members.` };
  }
  return null;
}

export function validateGlyphGraph(input: unknown): GlyphGraph {
  if (!object(input) || !keys(input, GLYPH_GRAPH_KEYS) || !Array.isArray(input.edges)) glyphDiagramError("bad-graph", "A graph requires nodes and edges arrays, and only nodes/edges/groups/direction fields.");
  // Only an authored empty block is a drawable blank canvas; empty JSON graphs still reject.
  const emptyBlock = (input as Record<PropertyKey, unknown>)[GLYPH_MERMAID_BLOCK]
    && input.edges.length === 0 && (input.groups === undefined || Array.isArray(input.groups) && input.groups.length === 0);
  if (!Array.isArray(input.nodes) || input.nodes.length === 0 && !emptyBlock) glyphDiagramError("empty-nodes", "A graph requires at least one node.");
  if (!member(input.direction, GLYPH_GRAPH_DIRECTIONS)) glyphDiagramError("bad-direction", "direction must be TB, LR, BT, or RL.");
  for (const [index, node] of input.nodes.entries()) {
    if (!object(node) || !keys(node, GLYPH_GRAPH_NODE_KEYS) || !identifier(node.id) || !string(node.label)
      || !optional(node, "kind", string) || !optional(node, "group", identifier) || !optional(node, "shape", (value) => member(value, GLYPH_GRAPH_NODE_SHAPES))) {
      glyphDiagramError("bad-node", `node[${index}] requires a non-empty id, a string label, and supported optional fields.`);
    }
    if (node.compartments !== undefined && (node.shape !== "compartment" || !Array.isArray(node.compartments) || !node.compartments.every((part: unknown) => Array.isArray(part) && part.every(string)))) glyphDiagramError("bad-node", `node[${index}] compartments require the compartment shape and arrays of string rows.`);
    if (node.shape === "point" && !/\S/u.test(node.label as string)) glyphDiagramError("bad-node", `node[${index}] is a point, which is drawn as its label's first character and needs one.`);
  }
  for (const [index, edge] of input.edges.entries()) {
    if (!object(edge) || !keys(edge, GLYPH_GRAPH_EDGE_KEYS) || !identifier(edge.from) || !identifier(edge.to)
      || !optional(edge, "id", identifier) || !optional(edge, "label", string) || !optional(edge, "style", (value) => member(value, GLYPH_GRAPH_EDGE_STYLES))
      || !optional(edge, "startHead", (value) => member(value, GLYPH_GRAPH_EDGE_HEADS))
      || !optional(edge, "endHead", (value) => member(value, GLYPH_GRAPH_EDGE_HEADS))
      || !optional(edge, "invisible", (value) => typeof value === "boolean")
      || !optional(edge, "priority", (value) => typeof value === "number" && Number.isFinite(value))) {
      glyphDiagramError("bad-edge", `edge[${index}] requires from/to ids, a supported style, and finite priority.`);
    }
  }
  if (input.groups !== undefined) {
    if (!Array.isArray(input.groups)) glyphDiagramError("bad-group", "groups must be an array.");
    for (const [index, group] of input.groups.entries()) {
      if (!object(group) || !keys(group, GLYPH_GRAPH_GROUP_KEYS) || !identifier(group.id) || !optional(group, "label", string) || !optional(group, "parent", identifier)
        || !Array.isArray(group.members) || !group.members.every(identifier)) glyphDiagramError("bad-group", `group[${index}] requires an id and an array of node ids as members.`);
    }
  }
  const graph = input as unknown as GlyphGraph;
  const failure = glyphGraphIntegrityFailure(graph);
  if (failure) glyphDiagramError(failure.code, failure.message);
  return {
    ...graph,
    nodes: graph.nodes.map((node) => ({ ...node })),
    edges: graph.edges.map((edge) => ({ ...edge })),
    ...(graph.groups === undefined ? {} : { groups: graph.groups.map((group) => ({ ...group, members: [...group.members] })) }),
    direction: graph.direction,
  };
}

const REPAIR_HINTS: Readonly<Record<GlyphDiagramValidationRuleId, string>> = {
  "bad-graph": "Pass { nodes, edges, groups?, direction }; remove unsupported graph fields.",
  "empty-nodes": "Add at least one node with an id and label.",
  "bad-node": `Use a non-empty id, a string label, and shape ${GLYPH_GRAPH_NODE_SHAPES.join(" / ")}; kind and group are optional strings; a point needs a non-empty label.`,
  "duplicate-node-id": "Give every node a unique id; use labels for repeated display text.",
  "bad-edge": `Use from/to ids, an optional label/id, finite priority, and style ${GLYPH_GRAPH_EDGE_STYLES.join(" / ")}.`,
  "duplicate-edge-id": "Give explicit edge ids unique values, or omit them for deterministic generated ids.",
  "unknown-node": "Add the referenced node or update the edge endpoint/group member to an existing node id.",
  "bad-group": "Use groups: [{ id, label?, members: [nodeId, ...], parent? }].",
  "point-loop": "Give the node a bordered shape to loop on, or remove the self edge; a point has no border to leave and re-enter.",
  "duplicate-group-id": "Give every group a unique id.",
  "unknown-group": "Add the node's group to graph.groups or remove node.group.",
  "group-membership": "List each member once and include every node that names this group.",
  "bad-direction": `Use direction ${GLYPH_GRAPH_DIRECTIONS.join(" / ")}; the Mermaid adapter also accepts TD.`,
  "bad-size": "Pass positive integer width and height, or omit them.",
  "bad-options": "Use the documented target, charset, color, detail, and dagre layout options.",
  "bad-color": "nodeColor/edgeColor must be a canonical lowercase #rrggbb string, or a function returning one.",
  "GLYPH_MERMAID_SYNTAX": "Use flowchart/graph declarations, supported node shapes, and supported edge operators; close every shape and subgraph. In a stateDiagram, use the supported state statements and close every composite state.",
  "GLYPH_MERMAID_BLOCK_SYNTAX": "Use columns, blocks, space blocks and links; close nested blocks with end.",
  "GLYPH_MERMAID_ARCHITECTURE_SYNTAX": "Declare groups/services/junctions and connect id:L/R/T/B ports; name existing parents.",
  "GLYPH_MERMAID_REQUIREMENT_SYNTAX": "Use requirement/element field blocks and labelled relationships; close braces and quotes.",
  "GLYPH_MERMAID_C4_SYNTAX": "Use C4 element, boundary and relationship calls with aliases; close calls and boundaries.",
  "GLYPH_MERMAID_CLASS_SYNTAX": "Use class declarations, member blocks, namespaces and class relations; close blocks and quotes.",
  "GLYPH_MERMAID_ER_SYNTAX": "Use entity attribute blocks and cardinality relationships; close blocks and quotes.",
  "GLYPH_MERMAID_GIT_SYNTAX": "Use commit, branch, checkout/switch, merge or cherry-pick; reference existing branches/commits and immediate merge parents.",
  "GLYPH_MERMAID_MINDMAP_SYNTAX": "Use one root and indentation for children; close node shapes and quoted markdown labels.",
  "GLYPH_MERMAID_STATE_NOTE": "Remove the note; put its text in the state's description (`Id : text`) or in a transition label.",
  "GLYPH_MERMAID_STATE_CONCURRENCY": "Draw each concurrent region as its own composite state or its own diagram; `--` regions are not rendered.",
  "GLYPH_MERMAID_STATE_FORK_JOIN": "Replace the <<fork>>/<<join>> with a <<choice>> or a plain state; the bar is not rendered.",
  "GLYPH_MERMAID_STATE_COMPOSITE_LOOP": "Move the self transition onto one of the composite's inner states, or draw it between the composite and another state.",
  "GLYPH_DIAGRAM_UNROUTABLE": "Increase the viewport or node/rank separation, or simplify the graph so every edge has a legal lane.",
  "GLYPH_DIAGRAM_ELK_NOT_INSTALLED": "Use engine: dagre; the ELK adapter is reserved for phase 4.",
  "GLYPH_DIAGRAM_BAD_JSON": "Pass a syntactically valid JSON document encoding a graph object.",
};

export function glyphDiagramRepairHint(id: string): string {
  if (id.startsWith("GLYPH_MERMAID_UNSUPPORTED_")) return "Convert this diagram to a Mermaid flowchart, graph or stateDiagram, or pass nodes/edges JSON.";
  return REPAIR_HINTS[id as GlyphDiagramValidationRuleId] ?? "Check the graph and render options against the diagram schema.";
}
