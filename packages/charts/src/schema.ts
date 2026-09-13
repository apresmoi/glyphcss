import {
  CHANNELS, GLYPH_CHART_VALIDATION_RULES, ISO_DATE_PATTERN, LEGEND_PLACEMENTS, MARK_TYPES, REDUCERS,
  SCALE_TYPES, TITLE_ALIGNS, TITLE_POSITIONS, TRANSFORM_KINDS, X_AXIS_TITLE_ATS, XY_MARK_TYPES,
  Y_AXIS_TITLE_ATS, glyphChartRepairHint,
  type GlyphChartValidationRuleId,
} from "./validate";
import { GLYPH_CHART_TICK_FORMAT_PRESET_NAMES } from "./tickFormat";

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
// Mirrors `validate.ts`'s own `CANONICAL_HEX_COLOR` exactly — Ajv parity
// (`schema.test.ts`) compares this pattern's verdict against that regex.
const HEX_COLOR_SCHEMA = { type: "string", pattern: "^#[0-9a-f]{6}$" };
const MARK_COLOR_SCHEMA = { anyOf: [HEX_COLOR_SCHEMA, { type: "array", minItems: 1, items: HEX_COLOR_SCHEMA }] };
// Mirrors `tickFormat.ts`'s own per-preset `validate`/`required` clauses —
// hand-written rather than derived generically (a preset's params carry
// TYPES `GLYPH_CHART_TICK_FORMAT_PRESETS` doesn't declare structurally, only
// checks at runtime), the same reason `SCALE_SCHEMA`/`MARK_SCHEMA` hardcode
// their own `allOf`/`if`/`then` clauses instead of deriving them from
// `validate.ts`. Only presets that TAKE params need an entry here — every
// other preset name accepts `{ preset: "<name>" }` and nothing else, which
// the shared `additionalProperties: false` below already enforces.
const TICK_FORMAT_PRESET_PARAMS: Readonly<Record<string, { readonly properties: Record<string, unknown>; readonly required?: readonly string[] }>> = {
  percent: { properties: { of: { type: "number" } } },
  // `maximum: 100` mirrors `tickFormat.ts`'s own `requireFiniteNonNegativeInteger`
  // bound (codex P2-12): both presets feed this straight into
  // `Number.prototype.toFixed`, whose spec range is 0..100 inclusive — Ajv
  // and the runtime validator must agree on the SAME ceiling or a spec that
  // fails one and passes the other breaks the parity this schema exists for.
  currency: { properties: { symbol: { type: "string" }, decimals: { type: "integer", minimum: 0, maximum: 100 } } },
  decimals: { properties: { places: { type: "integer", minimum: 0, maximum: 100 } }, required: ["places"] },
  template: { properties: { pattern: { type: "string" } }, required: ["pattern"] },
};
const TICK_FORMAT_OBJECT_SCHEMA = {
  type: "object", required: ["preset"],
  properties: { preset: { enum: GLYPH_CHART_TICK_FORMAT_PRESET_NAMES } },
  allOf: GLYPH_CHART_TICK_FORMAT_PRESET_NAMES.map((name) => ({
    if: { properties: { preset: { const: name } }, required: ["preset"] },
    then: {
      properties: { preset: { const: name }, ...(TICK_FORMAT_PRESET_PARAMS[name]?.properties ?? {}) },
      required: ["preset", ...(TICK_FORMAT_PRESET_PARAMS[name]?.required ?? [])],
      additionalProperties: false,
    },
  })),
};
// A bare string must be a KNOWN preset name that needs NO parameters — a
// preset with a `required` param (`decimals`, `template`) can never be
// legal as a bare string at runtime either (`resolvePreset`'s own
// required-key check fires with `params: {}`), so admitting it here would
// open an Ajv/runtime parity hole (Ajv says valid, `validateGlyphChartSpec`
// throws). A plain function value (the TS/JS-only callback escape hatch)
// has no JSON representation at all, so it never reaches this schema either way.
const TICK_FORMAT_BARE_NAMES = GLYPH_CHART_TICK_FORMAT_PRESET_NAMES.filter((name) => (TICK_FORMAT_PRESET_PARAMS[name]?.required?.length ?? 0) === 0);
const TICK_FORMAT_SCHEMA = { anyOf: [{ enum: TICK_FORMAT_BARE_NAMES }, TICK_FORMAT_OBJECT_SCHEMA] };
const X_AXIS_SCHEMA = { type: "object", properties: { color: HEX_COLOR_SCHEMA, titleAt: { enum: X_AXIS_TITLE_ATS }, format: TICK_FORMAT_SCHEMA } };
const Y_AXIS_SCHEMA = { type: "object", properties: { color: HEX_COLOR_SCHEMA, titleAt: { enum: Y_AXIS_TITLE_ATS }, format: TICK_FORMAT_SCHEMA } };
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
      properties: { innerRadius: { type: "number", minimum: 0, exclusiveMaximum: 1 }, axis: { enum: ["x", "y"] }, name: { type: "string" }, color: MARK_COLOR_SCHEMA, labels: { enum: ["callout", "legend-only"] }, strokeWidth: { enum: [1, 2, 3] }, ribbon: { enum: ["filled", "outline"] } },
    },
  },
  allOf: [{
    if: { properties: { type: { enum: XY_MARK_TYPES }, data: { contains: { type: "object" } } }, required: ["data", "type"] },
    then: { properties: { channels: { required: ["x", "y"] } } },
  }, {
    if: { properties: { type: { const: "arc" }, data: { contains: { type: "object" } } }, required: ["data", "type"] },
    then: { properties: { channels: { required: ["y"] } } },
  }, {
    // Sankey data is always records (a flow has no honest 1-D shorthand),
    // so this fires regardless of `data`'s shape — the structural half of
    // `sankey-bad-value` (see `validate.ts`'s own doc at that check).
    if: { properties: { type: { const: "sankey" } }, required: ["type"] },
    then: { properties: { channels: { required: ["source", "target", "value"] } } },
  }, {
    // Neither flow mark has an x/y scale for `transform` to act on
    // (`validate.ts`'s own doc at this same check) — structurally
    // checkable regardless of the transform's own shape, unlike the
    // resolved-value half of `sankey-bad-value`/`funnel-bad-value`.
    if: { properties: { type: { enum: ["sankey", "funnel"] } }, required: ["type"] },
    then: { not: { required: ["transform"] } },
  }, {
    // Mirrors the `arc-missing-value` clause above: a funnel over RECORD
    // data (never the bare `number[]` shorthand) needs its own `value`
    // channel, structurally checkable (`validate.ts`'s `funnel-missing-value`).
    if: { properties: { type: { const: "funnel" }, data: { contains: { type: "object" } } }, required: ["type", "data"] },
    then: { properties: { channels: { required: ["value"] } } },
  }, {
    // The funnel's own bare `number[]` shorthand IS a literal value list, so
    // "finite and not negative" is schema-expressible for exactly that shape
    // — unlike an accessor/field-named `value` channel, whose resolved sign
    // schema cannot see (the same asymmetry `sankey-bad-value` documents).
    if: { properties: { type: { const: "funnel" }, data: { items: { type: "number" } } }, required: ["type", "data"] },
    then: { properties: { data: { items: { type: "number", minimum: 0 } } } },
  }],
};

export function glyphChartJsonSchema(): GlyphChartJsonSchema {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema", title: "GlyphChartSpec", type: "object", required: ["marks"],
    $defs: { value: { anyOf: [{ type: "number" }, { type: "string" }, { type: "boolean" }, { type: "null" }, { type: "array", items: { $ref: "#/$defs/value" } }, { type: "object", additionalProperties: { $ref: "#/$defs/value" } }] } },
    properties: {
      marks: { type: "array", minItems: 1, items: MARK_SCHEMA },
      scales: { type: "object", properties: { x: SCALE_SCHEMA, y: SCALE_SCHEMA }, additionalProperties: false },
      // Only `color` and `titleAt` are modelled (this rule's own scope) —
      // `ticks`/`tickMarks`/`title`/`grid` have no runtime validation to
      // mirror yet, so `additionalProperties` is left open rather than
      // rejecting a legitimate axis option this schema doesn't know about.
      axes: { type: "object", properties: { color: HEX_COLOR_SCHEMA, x: X_AXIS_SCHEMA, y: Y_AXIS_SCHEMA } },
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
