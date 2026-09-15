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
import {
  GLYPH_CHART_3D_BARS_RULES, GLYPH_CHART_3D_LINE3D_RULES, GLYPH_CHART_3D_PARAMETRIC_RULES,
  GLYPH_CHART_3D_SCATTER_RULES, GLYPH_CHART_3D_SURFACE_RULES, glyphChart3dRepairHint,
} from "./validate";
import type { GlyphChart3dValidationRuleId } from "./validate";
// C7: reuses the ROOT package's own tick-format schema fragment verbatim
// (AGENTS.md's "Charts 3D" C7) — one derivation of
// `GLYPH_CHART_TICK_FORMAT_PRESETS`' own shape, not a parallel 3D copy.
import { TICK_FORMAT_SCHEMA } from "../schema";

/** Shared shape every `glyphChart3d*JsonSchema()` function returns. */
export interface GlyphChart3dJsonSchema {
  readonly $schema: string;
  readonly title: string;
  readonly type: "object";
  readonly required: readonly string[];
  readonly properties: Record<string, unknown>;
  readonly [key: string]: unknown;
  readonly "x-glyphcss-validation-rules": Readonly<Record<GlyphChart3dValidationRuleId, string>>;
}
export type GlyphChart3dSurfaceJsonSchema = GlyphChart3dJsonSchema;

const NUMBER_ARRAY = { type: "array", items: { type: "number" } };
const HEX_COLOR_SCHEMA = { type: "string", pattern: "^#[0-9a-f]{6}$" };
// A `channels.x`/`.y` value is either a position-vector array or a JSON
// field-name string — never an accessor function (JSON has no functions,
// exactly like the root schema's own tick-format callback exclusion).
const CHANNEL_VALUE_SCHEMA = { anyOf: [{ type: "string" }, NUMBER_ARRAY] };
// C7 (AGENTS.md's "Charts 3D" C7): mirrors `GlyphChart3dAxisOptions` field
// for field — `format` is the SAME schema fragment a 2D `axes.{x,y}.format`
// uses, `color` the same canonical-hex pattern, `domain` two ordered finite
// numbers (`min < max` is a cross-value invariant no JSON Schema keyword
// expresses on its own, exactly like `surface-axis-unsorted` — runtime-only,
// `schema.test.ts`'s own exception list).
const AXIS_OPTIONS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string" },
    ticks: { type: "integer", minimum: 1 },
    format: TICK_FORMAT_SCHEMA,
    line: { type: "boolean" },
    tickMarks: { type: "boolean" },
    tickLabels: { type: "boolean" },
    grid: { type: "boolean" },
    color: HEX_COLOR_SCHEMA,
    domain: { type: "array", minItems: 2, maxItems: 2, items: { type: "number" } },
  },
};
const CORNER_BIT_SCHEMA = { enum: [0, 1] };
const CORNER_NAME_SCHEMA = { enum: ["x0-y0-z0", "x1-y0-z0", "x1-y1-z0", "x0-y1-z0", "x0-y0-z1", "x1-y0-z1", "x1-y1-z1", "x0-y1-z1"] };
const CORNER_OPTIONS_SCHEMA = {
  anyOf: [
    { const: "auto" },
    CORNER_NAME_SCHEMA,
    { type: "array", minItems: 3, maxItems: 3, items: CORNER_BIT_SCHEMA },
  ],
};
const GUIDE_OPTIONS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    axisLines: { type: "boolean" },
    ticks: { type: "boolean" },
    tickLabels: { type: "boolean" },
    titles: { type: "boolean" },
    grid: { type: "boolean" },
    walls: { type: "boolean" },
    box: { type: "boolean" },
  },
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
            properties: { x: AXIS_OPTIONS_SCHEMA, y: AXIS_OPTIONS_SCHEMA, z: AXIS_OPTIONS_SCHEMA, corner: CORNER_OPTIONS_SCHEMA, color: HEX_COLOR_SCHEMA },
          },
          guides: GUIDE_OPTIONS_SCHEMA,
        },
      },
    },
    "x-glyphcss-validation-rules": Object.fromEntries(
      GLYPH_CHART_3D_SURFACE_RULES.map((id) => [id, glyphChart3dRepairHint(id)]),
    ) as Record<GlyphChart3dValidationRuleId, string>,
  };
}

function rulesOf(rules: readonly GlyphChart3dValidationRuleId[]): Record<GlyphChart3dValidationRuleId, string> {
  return Object.fromEntries(rules.map((id) => [id, glyphChart3dRepairHint(id)])) as Record<GlyphChart3dValidationRuleId, string>;
}

/** C5: `glyphChartScatter3d`'s own input shape. */
export function glyphChart3dScatterJsonSchema(): GlyphChart3dJsonSchema {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: "GlyphChart3dScatterInput",
    type: "object",
    required: ["data"],
    properties: {
      data: { type: "array", minItems: 1, items: { type: "object" } },
      channels: {
        type: "object", additionalProperties: false,
        properties: { x: { type: "string" }, y: { type: "string" }, z: { type: "string" }, series: { type: "string" }, color: { type: "string" }, size: { type: "string" } },
      },
      options: {
        type: "object", additionalProperties: false,
        properties: {
          aspect: { type: "array", minItems: 3, maxItems: 3, items: { type: "number", exclusiveMinimum: 0 } },
          colorscale: { anyOf: [{ enum: GLYPH_CHART_3D_COLORSCALE_NAMES }, { type: "array", minItems: 2, items: HEX_COLOR_SCHEMA }] },
          bands: { type: "integer", minimum: 1 },
          color: { enum: ["auto", "none"] },
          markerSize: { type: "number", exclusiveMinimum: 0 },
          axes: {
            type: "object", additionalProperties: false,
            properties: { x: AXIS_OPTIONS_SCHEMA, y: AXIS_OPTIONS_SCHEMA, z: AXIS_OPTIONS_SCHEMA, corner: CORNER_OPTIONS_SCHEMA, color: HEX_COLOR_SCHEMA },
          },
          guides: GUIDE_OPTIONS_SCHEMA,
        },
      },
    },
    "x-glyphcss-validation-rules": rulesOf(GLYPH_CHART_3D_SCATTER_RULES),
  };
}

const PARAMETRIC_GRID_SCHEMA = { type: "array", minItems: 1, items: { type: "array", minItems: 1, items: { type: "number" } } };

/** C5: `glyphChartParametric3d`'s own input shape — precomputed x/y/z (and optional value) grids only, a function has no JSON form (this file's own header doc). */
export function glyphChart3dParametricJsonSchema(): GlyphChart3dJsonSchema {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: "GlyphChart3dParametricInput",
    type: "object",
    required: ["data"],
    properties: {
      data: {
        type: "object", required: ["x", "y", "z"], additionalProperties: false,
        properties: { x: PARAMETRIC_GRID_SCHEMA, y: PARAMETRIC_GRID_SCHEMA, z: PARAMETRIC_GRID_SCHEMA, value: PARAMETRIC_GRID_SCHEMA },
      },
      options: {
        type: "object", additionalProperties: false,
        properties: {
          aspect: { type: "array", minItems: 3, maxItems: 3, items: { type: "number", exclusiveMinimum: 0 } },
          colorscale: { anyOf: [{ enum: GLYPH_CHART_3D_COLORSCALE_NAMES }, { type: "array", minItems: 2, items: HEX_COLOR_SCHEMA }] },
          bands: { type: "integer", minimum: 1 },
          color: { enum: ["auto", "none"] },
          wrapU: { type: "boolean" },
          wrapV: { type: "boolean" },
          axes: {
            type: "object", additionalProperties: false,
            properties: { x: AXIS_OPTIONS_SCHEMA, y: AXIS_OPTIONS_SCHEMA, z: AXIS_OPTIONS_SCHEMA, corner: CORNER_OPTIONS_SCHEMA, color: HEX_COLOR_SCHEMA },
          },
          guides: GUIDE_OPTIONS_SCHEMA,
        },
      },
    },
    "x-glyphcss-validation-rules": rulesOf(GLYPH_CHART_3D_PARAMETRIC_RULES),
  };
}

/** C5: `glyphChartBars3d`'s own input shape. */
export function glyphChart3dBarsJsonSchema(): GlyphChart3dJsonSchema {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: "GlyphChart3dBarsInput",
    type: "object",
    required: ["data"],
    properties: {
      data: { type: "array", minItems: 1, items: { type: "object" } },
      channels: {
        type: "object", additionalProperties: false,
        properties: { x: { type: "string" }, y: { type: "string" }, z: { type: "string" }, xLabel: { type: "string" }, yLabel: { type: "string" } },
      },
      options: {
        type: "object", additionalProperties: false,
        properties: {
          aspect: { type: "array", minItems: 3, maxItems: 3, items: { type: "number", exclusiveMinimum: 0 } },
          colorscale: { anyOf: [{ enum: GLYPH_CHART_3D_COLORSCALE_NAMES }, { type: "array", minItems: 2, items: HEX_COLOR_SCHEMA }] },
          bands: { type: "integer", minimum: 1 },
          color: { enum: ["auto", "none"] },
          barWidth: { type: "number", exclusiveMinimum: 0, maximum: 1 },
          axes: {
            type: "object", additionalProperties: false,
            properties: { x: AXIS_OPTIONS_SCHEMA, y: AXIS_OPTIONS_SCHEMA, z: AXIS_OPTIONS_SCHEMA, corner: CORNER_OPTIONS_SCHEMA, color: HEX_COLOR_SCHEMA },
          },
          guides: GUIDE_OPTIONS_SCHEMA,
        },
      },
    },
    "x-glyphcss-validation-rules": rulesOf(GLYPH_CHART_3D_BARS_RULES),
  };
}

const POINT3_SCHEMA = { type: "array", minItems: 3, maxItems: 3, items: { type: "number" } };
const LINE3D_SERIES_SCHEMA = {
  type: "object", required: ["points"], additionalProperties: false,
  properties: { name: { type: "string" }, color: HEX_COLOR_SCHEMA, points: { type: "array", minItems: 2, items: POINT3_SCHEMA } },
};

/** C5: `glyphChartLine3d`'s own input shape — a bare point list (one unnamed series) or an array of named series. */
export function glyphChart3dLineJsonSchema(): GlyphChart3dJsonSchema {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: "GlyphChart3dLineInput",
    type: "object",
    required: ["data"],
    properties: {
      data: { anyOf: [{ type: "array", minItems: 1, items: POINT3_SCHEMA }, { type: "array", minItems: 1, items: LINE3D_SERIES_SCHEMA }] },
      options: {
        type: "object", additionalProperties: false,
        properties: {
          aspect: { type: "array", minItems: 3, maxItems: 3, items: { type: "number", exclusiveMinimum: 0 } },
          axes: {
            type: "object", additionalProperties: false,
            properties: { x: AXIS_OPTIONS_SCHEMA, y: AXIS_OPTIONS_SCHEMA, z: AXIS_OPTIONS_SCHEMA, corner: CORNER_OPTIONS_SCHEMA, color: HEX_COLOR_SCHEMA },
          },
          guides: GUIDE_OPTIONS_SCHEMA,
        },
      },
    },
    "x-glyphcss-validation-rules": rulesOf(GLYPH_CHART_3D_LINE3D_RULES),
  };
}
