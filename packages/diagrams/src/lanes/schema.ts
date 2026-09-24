import type { GlyphLaneDag } from "./types";
import {
  GLYPH_LANE_VALIDATION_RULES, glyphLaneIntegrityFailure, glyphLaneDagRepairHint, type GlyphLaneValidationRuleId,
} from "./validate";

export interface GlyphLaneJsonSchema {
  readonly $schema: string;
  readonly title: string;
  readonly type: "object";
  readonly required: readonly string[];
  readonly properties: Record<string, unknown>;
  readonly [key: string]: unknown;
  readonly "x-glyphcss-validation-rules": Readonly<Record<GlyphLaneValidationRuleId, string>>;
}

const ID_SCHEMA = { type: "string", pattern: "\\S" };

/** Register with Ajv.addKeyword before compiling for full runtime parity — mirrors `GLYPH_SEQUENCE_JSON_SCHEMA_KEYWORDS`. */
export const GLYPH_LANE_JSON_SCHEMA_KEYWORDS = [{
  keyword: "glyphLaneIntegrity",
  schemaType: "boolean" as const,
  type: "object" as const,
  errors: false as const,
  validate: (enabled: boolean, data: unknown): boolean => {
    if (!enabled) return true;
    const dag = data as GlyphLaneDag;
    if (!Array.isArray(dag.nodes) || dag.nodes.some((n) => !n || typeof n.id !== "string" || !Array.isArray(n.parents))) return true;
    return glyphLaneIntegrityFailure(dag) === null;
  },
}];

export function glyphLaneJsonSchema(): GlyphLaneJsonSchema {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: "GlyphLaneDag",
    $comment: "Register GLYPH_LANE_JSON_SCHEMA_KEYWORDS with Ajv for duplicate-id, parent-reference, and time-order validation. Standard JSON Schema checks structure only.",
    type: "object", required: ["nodes"], additionalProperties: false,
    properties: {
      nodes: {
        type: "array", minItems: 1,
        items: {
          type: "object", required: ["id", "label", "parents"], additionalProperties: false,
          properties: {
            id: ID_SCHEMA, label: { type: "string" },
            parents: { type: "array", items: ID_SCHEMA },
            marks: { type: "array", items: { type: "string" } },
          },
        },
      },
    },
    glyphLaneIntegrity: true,
    "x-glyphcss-validation-rules": Object.fromEntries(GLYPH_LANE_VALIDATION_RULES.map((id) => [id, glyphLaneDagRepairHint(id)])) as Record<GlyphLaneValidationRuleId, string>,
  };
}
