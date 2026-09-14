/**
 * `@glyphcss/charts/3d`'s own JSON Schema for `glyphChartSurface`'s input
 * shape (P1-5, PLAN-3d.md §11's C1 row: "rules and schema"). A SEPARATE
 * schema from the root package's `glyphChartJsonSchema()` — the two mark
 * vocabularies don't share a spec (`validate.ts`'s own header doc) — and it
 * describes the SURFACE INPUT (`data`/`channels`/`options`), not
 * `renderGlyphChart3d`'s own render options (`bad-render-size`/
 * `bad-render-options`/`bad-camera` are render-option rules, not schema
 * clauses — mirroring the root's own `bad-size` asymmetry, `schema.test.ts`'s
 * header doc).
 */
import { GLYPH_CHART_3D_COLORSCALE_NAMES } from "./types";
import { GLYPH_CHART_3D_VALIDATION_RULES, glyphChart3dRepairHint } from "./validate";
import type { GlyphChart3dValidationRuleId } from "./validate";

export interface GlyphChart3dSurfaceJsonSchema {
  readonly $schema: string;
  readonly title: string;
  readonly type: "object";
  readonly required: readonly string[];
  readonly properties: Record<string, unknown>;
  readonly [key: string]: unknown;
  readonly "x-glyphcss-validation-rules": Readonly<Record<GlyphChart3dValidationRuleId, string>>;
}

const NUMBER_ARRAY = { type: "array", items: { type: "number" } };
const HEX_COLOR_SCHEMA = { type: "string", pattern: "^#[0-9a-f]{6}$" };
// A `channels.x`/`.y` value is either a position-vector array or a JSON
// field-name string — never an accessor function (JSON has no functions,
// exactly like the root schema's own tick-format callback exclusion).
const CHANNEL_VALUE_SCHEMA = { anyOf: [{ type: "string" }, NUMBER_ARRAY] };
const AXIS_OPTIONS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: { title: { type: "string" }, ticks: { type: "integer", minimum: 1 } },
};

const GRID_DATA_SCHEMA = {
  type: "object", required: ["z"], additionalProperties: false,
  properties: { z: { type: "array", minItems: 2, items: { type: "array", minItems: 2, items: { type: "number" } } } },
};
const RECORD_DATA_SCHEMA = {
  // `minItems: 4` is the structural half of `surface-not-gridded` (a 2x2
  // grid needs at least 4 rows) — the full rule (>= 2 DISTINCT x values AND
  // >= 2 distinct y) is a cross-value invariant no JSON Schema keyword
  // expresses, exactly like `surface-axis-unsorted`/`colorscale-not-monotone`
  // (`schema.test.ts`'s own runtime-only exception list).
  type: "array", minItems: 4,
  items: { type: "object", required: ["x", "y", "z"], properties: { x: { type: "number" }, y: { type: "number" }, z: { type: "number" } } },
};

export function glyphChart3dSurfaceJsonSchema(): GlyphChart3dSurfaceJsonSchema {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: "GlyphChart3dSurfaceInput",
    type: "object",
    required: ["data"],
    properties: {
      data: { anyOf: [GRID_DATA_SCHEMA, RECORD_DATA_SCHEMA] },
      channels: {
        type: "object", additionalProperties: false,
        properties: { x: CHANNEL_VALUE_SCHEMA, y: CHANNEL_VALUE_SCHEMA, z: { type: "string" } },
      },
      options: {
        type: "object", additionalProperties: false,
        properties: {
          aspect: { type: "array", minItems: 3, maxItems: 3, items: { type: "number", exclusiveMinimum: 0 } },
          colorscale: { anyOf: [{ enum: GLYPH_CHART_3D_COLORSCALE_NAMES }, { type: "array", minItems: 2, items: HEX_COLOR_SCHEMA }] },
          bands: { type: "integer", minimum: 1 },
          shading: { enum: ["relief", "value"] },
          color: { enum: ["auto", "none"] },
          maxQuadsX: { type: "integer", minimum: 1 },
          maxQuadsY: { type: "integer", minimum: 1 },
          axes: {
            type: "object", additionalProperties: false,
            properties: { x: AXIS_OPTIONS_SCHEMA, y: AXIS_OPTIONS_SCHEMA, z: AXIS_OPTIONS_SCHEMA },
          },
        },
      },
    },
    "x-glyphcss-validation-rules": Object.fromEntries(
      GLYPH_CHART_3D_VALIDATION_RULES.map((id) => [id, glyphChart3dRepairHint(id)]),
    ) as Record<GlyphChart3dValidationRuleId, string>,
  };
}
