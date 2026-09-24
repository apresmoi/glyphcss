import type { GlyphSequence } from "./types";
import {
  GLYPH_SEQUENCE_VALIDATION_RULES, GLYPH_SEQUENCE_PARTICIPANT_SHAPES, GLYPH_SEQUENCE_MESSAGE_STYLES,
  glyphSequenceIntegrityFailure, glyphSequenceRepairHint, type GlyphSequenceValidationRuleId,
} from "./validate";

export interface GlyphSequenceJsonSchema {
  readonly $schema: string;
  readonly title: string;
  readonly type: "object";
  readonly required: readonly string[];
  readonly properties: Record<string, unknown>;
  readonly [key: string]: unknown;
  readonly "x-glyphcss-validation-rules": Readonly<Record<GlyphSequenceValidationRuleId, string>>;
}

const ID_SCHEMA = { type: "string", pattern: "\\S" };

/** Register with Ajv.addKeyword before compiling for full runtime parity — mirrors `GLYPH_DIAGRAM_JSON_SCHEMA_KEYWORDS`. */
export const GLYPH_SEQUENCE_JSON_SCHEMA_KEYWORDS = [{
  keyword: "glyphSequenceIntegrity",
  schemaType: "boolean" as const,
  type: "object" as const,
  errors: false as const,
  validate: (enabled: boolean, data: unknown): boolean => {
    if (!enabled) return true;
    const sequence = data as GlyphSequence;
    if (!Array.isArray(sequence.participants) || !Array.isArray(sequence.messages)
      || (sequence.frames !== undefined && !Array.isArray(sequence.frames))
      || (sequence.notes !== undefined && !Array.isArray(sequence.notes))
      || sequence.participants.some((p) => !p || typeof p.id !== "string")
      || sequence.messages.some((m) => !m || typeof m.from !== "string" || typeof m.to !== "string")
      || sequence.frames?.some((f) => !f || typeof f.from !== "number" || typeof f.to !== "number")
      || sequence.notes?.some((n) => !n || !Array.isArray(n.over) || typeof n.at !== "number")) return true;
    return glyphSequenceIntegrityFailure(sequence) === null;
  },
}];

export function glyphSequenceJsonSchema(): GlyphSequenceJsonSchema {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: "GlyphSequence",
    $comment: "Register GLYPH_SEQUENCE_JSON_SCHEMA_KEYWORDS with Ajv for duplicate-id, endpoint-reference, and range validation. Standard JSON Schema checks structure only.",
    type: "object", required: ["participants", "messages"], additionalProperties: false,
    properties: {
      participants: {
        type: "array", minItems: 1,
        items: {
          type: "object", required: ["id", "label"], additionalProperties: false,
          properties: { id: ID_SCHEMA, label: { type: "string" }, kind: { type: "string" }, shape: { enum: GLYPH_SEQUENCE_PARTICIPANT_SHAPES } },
        },
      },
      messages: {
        type: "array",
        items: {
          type: "object", required: ["from", "to"], additionalProperties: false,
          properties: { id: ID_SCHEMA, from: ID_SCHEMA, to: ID_SCHEMA, label: { type: "string" }, style: { enum: GLYPH_SEQUENCE_MESSAGE_STYLES } },
        },
      },
      frames: {
        type: "array",
        items: {
          type: "object", required: ["kind", "from", "to"], additionalProperties: false,
          properties: { kind: ID_SCHEMA, label: { type: "string" }, from: { type: "integer", minimum: 0 }, to: { type: "integer", minimum: 0 } },
        },
      },
      notes: {
        type: "array",
        items: {
          type: "object", required: ["text", "over", "at"], additionalProperties: false,
          properties: { text: { type: "string" }, over: { type: "array", minItems: 1, items: ID_SCHEMA }, at: { type: "integer", minimum: 0 } },
        },
      },
    },
    glyphSequenceIntegrity: true,
    "x-glyphcss-validation-rules": Object.fromEntries(GLYPH_SEQUENCE_VALIDATION_RULES.map((id) => [id, glyphSequenceRepairHint(id)])) as Record<GlyphSequenceValidationRuleId, string>,
  };
}
