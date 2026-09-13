import {
  CHANNELS, GLYPH_CHART_VALIDATION_RULES, ISO_DATE_PATTERN, LEGEND_PLACEMENTS, MARK_TYPES, REDUCERS,
  SCALE_TYPES, TITLE_ALIGNS, TITLE_POSITIONS, TRANSFORM_KINDS, XY_MARK_TYPES, glyphChartRepairHint,
  type GlyphChartValidationRuleId,
} from "./validate";

export interface GlyphChartJsonSchema {
  readonly $schema: string;
  readonly title: string;
  readonly type: "object";
  readonly required: readonly string[];
  readonly properties: Record<string, unknown>;
  readonly [key: string]: unknown;
  readonly "x-glyphcss-validation-rules": Readonly<Record<GlyphChartValidationRuleId, string>>;
}
const CHANNEL_SCHEMA = { anyOf: [{ type: "string" }, { type: "array", items: { $ref: "#/$defs/value" } }] };
const NUMERIC_DOMAIN = { type: "array", minItems: 2, maxItems: 2, items: { type: "number" } };
const SCALE_SCHEMA = {
  type: "object",
  properties: { type: { enum: SCALE_TYPES }, nice: { type: "boolean" }, domain: { type: "array", minItems: 2, items: { anyOf: [{ type: "number" }, { type: "string" }] } } },
  allOf: [
    { if: { properties: { type: { const: "time" } }, required: ["type"] }, then: { properties: { domain: { maxItems: 2, items: { type: "string", pattern: ISO_DATE_PATTERN } } } } },
    { if: { properties: { type: { enum: ["linear", "sqrt", "log"] } } }, then: { properties: { domain: NUMERIC_DOMAIN } } },
    { if: { properties: { type: { const: "log" } }, required: ["type"] }, then: { properties: { domain: { anyOf: [{ items: { type: "number", exclusiveMinimum: 0 } }, { items: { type: "number", exclusiveMaximum: 0 } }] } } } },
  ],
};
const MARK_SCHEMA = {
  type: "object", required: ["type", "data", "channels"],
  properties: {
    type: { enum: MARK_TYPES },
    data: { type: "array", minItems: 1, items: { anyOf: [{ type: "number" }, { type: "object", additionalProperties: { $ref: "#/$defs/value" } }] } },
    channels: { type: "object", properties: Object.fromEntries(CHANNELS.map((c) => [c, CHANNEL_SCHEMA])), additionalProperties: false },
    transform: {
      type: "object", required: ["kind"],
      properties: { kind: { enum: TRANSFORM_KINDS }, n: { type: "integer", minimum: 1 }, by: CHANNEL_SCHEMA, reduce: { enum: REDUCERS } },
    },
    options: {
      type: "object", additionalProperties: false,
      properties: { innerRadius: { type: "number", minimum: 0, exclusiveMaximum: 1 }, axis: { enum: ["x", "y"] }, name: { type: "string" } },
    },
  },
  allOf: [{
    if: { properties: { type: { enum: XY_MARK_TYPES }, data: { contains: { type: "object" } } }, required: ["data", "type"] },
    then: { properties: { channels: { required: ["x", "y"] } } },
  }, {
    if: { properties: { type: { const: "arc" }, data: { contains: { type: "object" } } }, required: ["data", "type"] },
    then: { properties: { channels: { required: ["y"] } } },
  }],
};

export function glyphChartJsonSchema(): GlyphChartJsonSchema {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema", title: "GlyphChartSpec", type: "object", required: ["marks"],
    $defs: { value: { anyOf: [{ type: "number" }, { type: "string" }, { type: "boolean" }, { type: "null" }, { type: "array", items: { $ref: "#/$defs/value" } }, { type: "object", additionalProperties: { $ref: "#/$defs/value" } }] } },
    properties: {
      marks: { type: "array", minItems: 1, items: MARK_SCHEMA },
      scales: { type: "object", properties: { x: SCALE_SCHEMA, y: SCALE_SCHEMA }, additionalProperties: false },
      title: {
        anyOf: [
          { type: "string" },
          { type: "object", required: ["text"], additionalProperties: false, properties: { text: { type: "string" }, align: { enum: TITLE_ALIGNS }, position: { enum: TITLE_POSITIONS } } },
        ],
      },
      description: { type: "string" },
      legend: {
        anyOf: [
          { type: "boolean" },
          { type: "object", required: ["placement"], additionalProperties: false, properties: { placement: { enum: LEGEND_PLACEMENTS } } },
        ],
      },
    },
    allOf: [{
      if: { properties: { marks: { contains: { properties: { type: { enum: ["bar", "rect", "area"] } }, required: ["type"] } } } },
      then: { properties: { scales: { properties: { y: { properties: { type: { not: { enum: ["band", "ordinal", "time", "log"] } }, domain: { allOf: [{ contains: { type: "number", maximum: 0 } }, { contains: { type: "number", minimum: 0 } }] } } } } } } },
    }],
    "x-glyphcss-validation-rules": Object.fromEntries(GLYPH_CHART_VALIDATION_RULES.map((id) => [id, glyphChartRepairHint(id)])) as Record<GlyphChartValidationRuleId, string>,
  };
}
