import type { GlyphGraph } from "./types";
import {
  GLYPH_DIAGRAM_VALIDATION_RULES, GLYPH_GRAPH_DIRECTIONS, GLYPH_GRAPH_EDGE_STYLES, GLYPH_GRAPH_NODE_SHAPES,
  glyphDiagramRepairHint, glyphGraphIntegrityFailure, type GlyphDiagramValidationRuleId,
} from "./validate";

export interface GlyphDiagramJsonSchema {
  readonly $schema: string;
  readonly title: string;
  readonly type: "object";
  readonly required: readonly string[];
  readonly properties: Record<string, unknown>;
  readonly [key: string]: unknown;
  readonly "x-glyphcss-validation-rules": Readonly<Record<GlyphDiagramValidationRuleId, string>>;
}

const ID_SCHEMA = { type: "string", pattern: "\\S" };

/** Register with Ajv.addKeyword before compiling for full runtime parity. */
export const GLYPH_DIAGRAM_JSON_SCHEMA_KEYWORDS = [{
  keyword: "glyphGraphIntegrity",
  schemaType: "boolean" as const,
  type: "object" as const,
  errors: false as const,
  validate: (enabled: boolean, data: unknown): boolean => {
    if (!enabled) return true;
    const graph = data as GlyphGraph;
    // Structural failures belong to ordinary JSON Schema; the keyword only
    // compares ids after those properties are readable, independent of order.
    if (!Array.isArray(graph.nodes) || !Array.isArray(graph.edges) || (graph.groups !== undefined && !Array.isArray(graph.groups))
      || graph.nodes.some((node) => !node || typeof node.id !== "string")
      || graph.edges.some((edge) => !edge || typeof edge.from !== "string" || typeof edge.to !== "string")
      || graph.groups?.some((group) => !group || typeof group.id !== "string" || !Array.isArray(group.members))) return true;
    return glyphGraphIntegrityFailure(graph) === null;
  },
}];

export function glyphDiagramJsonSchema(): GlyphDiagramJsonSchema {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: "GlyphGraph",
    $comment: "Register GLYPH_DIAGRAM_JSON_SCHEMA_KEYWORDS with Ajv for duplicate-id, endpoint-reference, and group-membership validation. Standard JSON Schema checks structure only.",
    type: "object", required: ["nodes", "edges", "direction"], additionalProperties: false,
    properties: {
      nodes: {
        type: "array", minItems: 1,
        items: {
          type: "object", required: ["id", "label"], additionalProperties: false,
          properties: {
            id: ID_SCHEMA, label: { type: "string" }, kind: { type: "string" }, group: ID_SCHEMA, shape: { enum: GLYPH_GRAPH_NODE_SHAPES },
          },
        },
      },
      edges: {
        type: "array",
        items: {
          type: "object", required: ["from", "to"], additionalProperties: false,
          properties: { id: ID_SCHEMA, from: ID_SCHEMA, to: ID_SCHEMA, label: { type: "string" }, style: { enum: GLYPH_GRAPH_EDGE_STYLES }, priority: { type: "number" } },
        },
      },
      groups: {
        type: "array",
        items: {
          type: "object", required: ["id", "members"], additionalProperties: false,
          properties: { id: ID_SCHEMA, label: { type: "string" }, members: { type: "array", items: ID_SCHEMA } },
        },
      },
      direction: { enum: GLYPH_GRAPH_DIRECTIONS },
    },
    glyphGraphIntegrity: true,
    "x-glyphcss-validation-rules": Object.fromEntries(GLYPH_DIAGRAM_VALIDATION_RULES.map((id) => [id, glyphDiagramRepairHint(id)])) as Record<GlyphDiagramValidationRuleId, string>,
  };
}
