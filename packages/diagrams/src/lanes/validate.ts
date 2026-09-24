import type { GlyphLaneDag } from "./types";
import { glyphDiagramError } from "../validate";

export const GLYPH_LANE_VALIDATION_RULES = [
  "bad-lane-dag", "empty-nodes", "bad-lane-node", "duplicate-node-id",
  "unknown-parent", "bad-parent-order", "self-parent", "bad-options", "bad-size", "bad-color",
  "GLYPH_LANE_GIT_SYNTAX", "GLYPH_LANE_BAD_JSON",
] as const;
export type GlyphLaneValidationRuleId = typeof GLYPH_LANE_VALIDATION_RULES[number];

/** Tagged the same way `parseGlyphSequenceJson` tags the sequence pipeline's JSON boundary — its own code so a lane-DAG parse failure is never mistaken for either sibling form's. */
export function parseGlyphLaneDagJson(json: string): unknown {
  try { return JSON.parse(json); }
  catch (e) { return glyphDiagramError("GLYPH_LANE_BAD_JSON", `Invalid JSON: ${e instanceof Error ? e.message : String(e)}`); }
}

export const GLYPH_LANE_KEYS = ["nodes"];
export const GLYPH_LANE_NODE_KEYS = ["id", "label", "parents", "marks"];

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function identifier(value: unknown): value is string { return typeof value === "string" && /\S/u.test(value); }
function keys(value: Record<string, unknown>, allowed: readonly string[]): boolean { return Object.keys(value).every((key) => allowed.includes(key)); }
function optional(value: Record<string, unknown>, key: string, predicate: (value: unknown) => boolean): boolean { return value[key] === undefined || predicate(value[key]); }
function string(value: unknown): value is string { return typeof value === "string"; }
function stringArray(value: unknown): value is readonly string[] { return Array.isArray(value) && value.every(string); }

interface GlyphLaneIntegrityFailure { readonly code: GlyphLaneValidationRuleId; readonly message: string }

/**
 * These relational constraints require the schema's registered Ajv keyword —
 * mirrors `glyphSequenceIntegrityFailure`. `bad-parent-order` is this form's
 * own rule (neither sibling form has an ordering constraint): a parent must
 * occur strictly LATER in `nodes` than its child, which is both what "array
 * order is time" means and what rules out a cycle without a separate graph
 * walk.
 */
export function glyphLaneIntegrityFailure(dag: GlyphLaneDag): GlyphLaneIntegrityFailure | null {
  const indexOf = new Map<string, number>();
  dag.nodes.forEach((node, index) => indexOf.set(node.id, index));
  if (indexOf.size !== dag.nodes.length) {
    const seen = new Set<string>();
    for (const node of dag.nodes) {
      if (seen.has(node.id)) return { code: "duplicate-node-id", message: `Node id "${node.id}" occurs more than once.` };
      seen.add(node.id);
    }
  }
  for (const [index, node] of dag.nodes.entries()) {
    for (const parentId of node.parents) {
      if (parentId === node.id) return { code: "self-parent", message: `Node "${node.id}" names itself as its own parent.` };
      const parentIndex = indexOf.get(parentId);
      if (parentIndex === undefined) return { code: "unknown-parent", message: `Node "${node.id}" references an unknown parent "${parentId}".` };
      if (parentIndex <= index) return { code: "bad-parent-order", message: `Node "${node.id}" references parent "${parentId}", which must occur later in the array (an older node) — array order is time, newest first.` };
    }
  }
  return null;
}

export function validateGlyphLaneDag(input: unknown): GlyphLaneDag {
  if (!object(input) || !keys(input, GLYPH_LANE_KEYS) || !Array.isArray(input.nodes)) glyphDiagramError("bad-lane-dag", "A lane DAG requires a nodes array, and only a nodes field.");
  if (input.nodes.length === 0) glyphDiagramError("empty-nodes", "A lane DAG requires at least one node.");
  for (const [index, node] of input.nodes.entries()) {
    if (!object(node) || !keys(node, GLYPH_LANE_NODE_KEYS) || !identifier(node.id) || !string(node.label)
      || !Array.isArray(node.parents) || !stringArray(node.parents) || !optional(node, "marks", stringArray)) {
      glyphDiagramError("bad-lane-node", `node[${index}] requires a non-empty id, a string label, a string-array parents, and an optional string-array marks.`);
    }
  }
  const dag = input as unknown as GlyphLaneDag;
  const failure = glyphLaneIntegrityFailure(dag);
  if (failure) glyphDiagramError(failure.code, failure.message);
  return { nodes: dag.nodes.map((n) => ({ ...n, parents: [...n.parents], ...(n.marks === undefined ? {} : { marks: [...n.marks] }) })) };
}

const REPAIR_HINTS: Readonly<Record<GlyphLaneValidationRuleId, string>> = {
  "bad-lane-dag": "Pass { nodes }; remove unsupported top-level fields.",
  "empty-nodes": "Add at least one node with an id, label, and parents array.",
  "bad-lane-node": "Use a non-empty id, a string label, a parents array of ids, and an optional marks array of strings.",
  "duplicate-node-id": "Give every node a unique id.",
  "unknown-parent": "Reference only ids present in nodes.",
  "bad-parent-order": "List nodes newest first; a parent must occur later in the array than its child.",
  "self-parent": "A node cannot name itself as its own parent.",
  "bad-options": "Use the documented target, charset, color, and title options.",
  "bad-size": "Pass positive integer width and height, or omit them.",
  "bad-color": "laneColor must be a canonical lowercase #rrggbb string, or a function returning one.",
  "GLYPH_LANE_GIT_SYNTAX": "Pass \"id|parents|decoration|subject\" lines, newest first, one per commit.",
  "GLYPH_LANE_BAD_JSON": "Pass a syntactically valid JSON document encoding a lane DAG object.",
};

export function glyphLaneDagRepairHint(id: string): string {
  return REPAIR_HINTS[id as GlyphLaneValidationRuleId] ?? "Check the lane DAG and render options against the lane DAG schema.";
}
