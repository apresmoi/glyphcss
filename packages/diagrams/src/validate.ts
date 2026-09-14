import type { GlyphGraph, GlyphGraphDirection, GlyphGraphEdgeStyle, GlyphGraphNodeShape } from "./types";

export const GLYPH_DIAGRAM_VALIDATION_RULES = [
  "bad-graph", "empty-nodes", "bad-node", "duplicate-node-id", "bad-edge", "duplicate-edge-id",
  "unknown-node", "bad-group", "duplicate-group-id", "unknown-group", "group-membership", "bad-direction",
  "bad-size", "bad-options", "GLYPH_MERMAID_SYNTAX", "GLYPH_DIAGRAM_UNROUTABLE", "GLYPH_DIAGRAM_ELK_NOT_INSTALLED",
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
export const GLYPH_GRAPH_NODE_SHAPES: readonly GlyphGraphNodeShape[] = ["rect", "rounded", "diamond", "circle", "subroutine", "asymmetric", "stadium", "cylinder"];
export const GLYPH_GRAPH_EDGE_STYLES: readonly GlyphGraphEdgeStyle[] = ["solid", "dotted", "thick", "undirected"];
export const GLYPH_GRAPH_KEYS = ["nodes", "edges", "groups", "direction"];
export const GLYPH_GRAPH_NODE_KEYS = ["id", "label", "kind", "group", "shape", "size"];
export const GLYPH_GRAPH_EDGE_KEYS = ["id", "from", "to", "label", "style", "priority"];
export const GLYPH_GRAPH_GROUP_KEYS = ["id", "label", "members"];

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function identifier(value: unknown): value is string { return typeof value === "string" && /\S/u.test(value); }
function keys(value: Record<string, unknown>, allowed: readonly string[]): boolean { return Object.keys(value).every((key) => allowed.includes(key)); }
function optional(value: Record<string, unknown>, key: string, predicate: (value: unknown) => boolean): boolean { return value[key] === undefined || predicate(value[key]); }
function string(value: unknown): value is string { return typeof value === "string"; }
function member(value: unknown, allowed: readonly string[]): boolean { return string(value) && allowed.includes(value); }
/** D2 round 3 — architecture objects: `node.size` is exactly `[width, height, depth]`, all positive finite numbers (a zero or negative extent has no box to draw). */
function size3(value: unknown): boolean {
  return Array.isArray(value) && value.length === 3 && value.every((v) => typeof v === "number" && Number.isFinite(v) && v > 0);
}

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
  }
  const groups = new Map<string, ReadonlySet<string>>();
  for (const group of graph.groups ?? []) {
    if (groups.has(group.id)) return { code: "duplicate-group-id", message: `Group id "${group.id}" occurs more than once.` };
    const members = new Set(group.members);
    if (members.size !== group.members.length) return { code: "group-membership", message: `Group "${group.id}" lists a member more than once.` };
    if (group.members.some((id) => !nodeIds.has(id))) return { code: "unknown-node", message: `Group "${group.id}" references an unknown node.` };
    groups.set(group.id, members);
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
  if (!Array.isArray(input.nodes) || input.nodes.length === 0) glyphDiagramError("empty-nodes", "A graph requires at least one node.");
  if (!member(input.direction, GLYPH_GRAPH_DIRECTIONS)) glyphDiagramError("bad-direction", "direction must be TB, LR, BT, or RL.");
  for (const [index, node] of input.nodes.entries()) {
    if (!object(node) || !keys(node, GLYPH_GRAPH_NODE_KEYS) || !identifier(node.id) || !string(node.label)
      || !optional(node, "kind", string) || !optional(node, "group", identifier) || !optional(node, "shape", (value) => member(value, GLYPH_GRAPH_NODE_SHAPES))
      || !optional(node, "size", size3)) {
      glyphDiagramError("bad-node", `node[${index}] requires a non-empty id, a string label, and supported optional fields.`);
    }
  }
  for (const [index, edge] of input.edges.entries()) {
    if (!object(edge) || !keys(edge, GLYPH_GRAPH_EDGE_KEYS) || !identifier(edge.from) || !identifier(edge.to)
      || !optional(edge, "id", identifier) || !optional(edge, "label", string) || !optional(edge, "style", (value) => member(value, GLYPH_GRAPH_EDGE_STYLES))
      || !optional(edge, "priority", (value) => typeof value === "number" && Number.isFinite(value))) {
      glyphDiagramError("bad-edge", `edge[${index}] requires from/to ids, a supported style, and finite priority.`);
    }
  }
  if (input.groups !== undefined) {
    if (!Array.isArray(input.groups)) glyphDiagramError("bad-group", "groups must be an array.");
    for (const [index, group] of input.groups.entries()) {
      if (!object(group) || !keys(group, GLYPH_GRAPH_GROUP_KEYS) || !identifier(group.id) || !optional(group, "label", string)
        || !Array.isArray(group.members) || !group.members.every(identifier)) glyphDiagramError("bad-group", `group[${index}] requires an id and an array of node ids as members.`);
    }
  }
  const graph = input as unknown as GlyphGraph;
  const failure = glyphGraphIntegrityFailure(graph);
  if (failure) glyphDiagramError(failure.code, failure.message);
  return {
    nodes: graph.nodes.map((node) => ({ ...node })),
    edges: graph.edges.map((edge) => ({ ...edge })),
    ...(graph.groups === undefined ? {} : { groups: graph.groups.map((group) => ({ ...group, members: [...group.members] })) }),
    direction: graph.direction,
  };
}

const REPAIR_HINTS: Readonly<Record<GlyphDiagramValidationRuleId, string>> = {
  "bad-graph": "Pass { nodes, edges, groups?, direction }; remove unsupported graph fields.",
  "empty-nodes": "Add at least one node with an id and label.",
  "bad-node": `Use a non-empty id, a string label, and shape ${GLYPH_GRAPH_NODE_SHAPES.join(" / ")}; kind and group are optional strings; size (JSON only) is [width, height, depth] as three positive numbers.`,
  "duplicate-node-id": "Give every node a unique id; use labels for repeated display text.",
  "bad-edge": `Use from/to ids, an optional label/id, finite priority, and style ${GLYPH_GRAPH_EDGE_STYLES.join(" / ")}.`,
  "duplicate-edge-id": "Give explicit edge ids unique values, or omit them for deterministic generated ids.",
  "unknown-node": "Add the referenced node or update the edge endpoint/group member to an existing node id.",
  "bad-group": "Use groups: [{ id, label?, members: [nodeId, ...] }].",
  "duplicate-group-id": "Give every group a unique id.",
  "unknown-group": "Add the node's group to graph.groups or remove node.group.",
  "group-membership": "List each member once and include every node that names this group.",
  "bad-direction": `Use direction ${GLYPH_GRAPH_DIRECTIONS.join(" / ")}; the Mermaid adapter also accepts TD.`,
  "bad-size": "Pass positive integer width and height, or omit them.",
  "bad-options": "Use the documented target, charset, color, detail, and dagre layout options.",
  "GLYPH_MERMAID_SYNTAX": "Use flowchart/graph declarations, supported node shapes, and supported edge operators; close every shape and subgraph.",
  "GLYPH_DIAGRAM_UNROUTABLE": "Increase the viewport or node/rank separation, or simplify the graph so every edge has a legal lane.",
  "GLYPH_DIAGRAM_ELK_NOT_INSTALLED": "Use engine: dagre; the ELK adapter is reserved for phase 4.",
  "GLYPH_DIAGRAM_BAD_JSON": "Pass a syntactically valid JSON document encoding a graph object.",
};

export function glyphDiagramRepairHint(id: string): string {
  if (id.startsWith("GLYPH_MERMAID_UNSUPPORTED_")) return "Convert this diagram to a Mermaid flowchart or graph, or pass nodes/edges JSON.";
  return REPAIR_HINTS[id as GlyphDiagramValidationRuleId] ?? "Check the graph and render options against the diagram schema.";
}
