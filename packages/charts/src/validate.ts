import { resolveGlyphChartTickFormat } from "./tickFormat";
import type { GlyphChartCharset, GlyphChartLegendOption, GlyphChartMark, GlyphChartMarkType, GlyphChartSpec, GlyphChartTitleOption } from "./types";

// Schema generation shares the vocabulary and repair rules; schema.test uses
// an independent JSON Schema evaluator for the structural and domain clauses.
export const GLYPH_CHART_VALIDATION_RULES = [
  "empty-marks", "unknown-mark-type", "empty-data", "missing-xy-channels", "arc-missing-value",
  "unknown-transform", "invalid-transform-n", "invalid-inner-radius", "invalid-rule-axis",
  "bad-size", "non-finite-data", "bad-channels", "bad-options", "bad-scale",
  "log-domain", "bar-domain-excludes-zero", "bad-time-domain", "bad-title", "bad-legend",
  "sankey-bad-value", "bad-axes", "bad-axis-color", "bad-axis-title-at", "bad-mark-color", "funnel-bad-value",
  "funnel-missing-value", "bad-stroke-width", "bad-tick-format", "bad-text-scale", "bad-region-fill", "bad-shades",
] as const;
export type GlyphChartValidationRuleId = typeof GLYPH_CHART_VALIDATION_RULES[number];
export interface GlyphChartValidationError extends Error { readonly code: GlyphChartValidationRuleId }

export function chartError(code: GlyphChartValidationRuleId, message: string): never {
  throw Object.assign(new TypeError(`glyphcss: ${code}: ${message}`), { code });
}

export const MARK_TYPES: readonly GlyphChartMarkType[] = ["line", "area", "bar", "dot", "arc", "rect", "cell", "text", "rule", "sankey", "funnel"];
export const XY_MARK_TYPES = ["line", "area", "bar", "dot", "rect", "cell"];
export const TRANSFORM_KINDS = ["bin", "stack", "group", "normalize", "window"];
export const CHANNELS = ["x", "y", "fill", "stroke", "label", "source", "target", "value", "stage"];
export const SCALE_TYPES = ["linear", "log", "sqrt", "time", "band", "ordinal"];
export const REDUCERS = ["mean", "sum", "min", "max"];
export const TITLE_ALIGNS = ["left", "center", "right"];
export const TITLE_POSITIONS = ["top", "bottom"];
export const LEGEND_PLACEMENTS = ["bottom", "top-left", "top-right", "bottom-left", "bottom-right", "title"];
export const X_AXIS_TITLE_ATS = ["start", "center", "end"];
export const Y_AXIS_TITLE_ATS = ["top", "bottom"];

function object(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function channel(v: unknown): boolean { return typeof v === "string" || typeof v === "function" || Array.isArray(v); }

// Mirrors `glyphcss`'s own cell-canvas contract exactly (`CANVAS_CANONICAL_HEX`
// in `packages/glyphcss/src/render/canvas/canvas.ts`) — canonical lowercase
// `#rrggbb`, so `"none"`, uppercase, `#rgb`, and `rgb(...)` all reject the
// same way a painter's own colour argument would.
const CANONICAL_HEX_COLOR = /^#[0-9a-f]{6}$/;
function isCanonicalHexColor(v: unknown): v is string {
  return typeof v === "string" && CANONICAL_HEX_COLOR.test(v);
}

/**
 * `spec.axes` and `spec.axes.{x,y}` must each be a plain object when
 * present, matching the JSON Schema's own `type: "object"` on all three
 * (`schema.ts`'s `AXIS_SCHEMA`) — an Ajv/runtime parity hole otherwise:
 * `axes: null`/`"red"`/`{ x: null }`/`{ x: 5 }` all rejected via Ajv while
 * `axes?.color`'s optional chaining silently accepted every one of them at
 * runtime and rendered anyway (review finding P3-3). Runtime rejects, since
 * a spec this malformed reaching the canvas is the worse contract.
 */
export function validateGlyphChartAxes(axes: unknown): void {
  if (axes === undefined) return;
  if (!object(axes)) chartError("bad-axes", `axes must be an object, got ${JSON.stringify(axes)}.`);
  if (axes.x !== undefined && !object(axes.x)) chartError("bad-axes", `axes.x must be an object, got ${JSON.stringify(axes.x)}.`);
  if (axes.y !== undefined && !object(axes.y)) chartError("bad-axes", `axes.y must be an object, got ${JSON.stringify(axes.y)}.`);
}

/** `spec.axes?.color` and `spec.axes?.{x,y}?.color` (AGENTS.md's "Charts" "Colours"). */
export function validateGlyphChartAxisColor(axes: GlyphChartSpec["axes"]): void {
  for (const color of [axes?.color, axes?.x?.color, axes?.y?.color]) {
    if (color !== undefined && !isCanonicalHexColor(color)) {
      chartError("bad-axis-color", `axis color must be a canonical lowercase #rrggbb string, got ${JSON.stringify(color)}.`);
    }
  }
}

/**
 * `axes.x.titleAt` / `axes.y.titleAt` — each axis has its own vocabulary
 * (`start`/`center`/`end` for x, `top`/`bottom` for y), so this checks each
 * against its own list rather than a shared one; a value valid for the
 * OTHER axis (e.g. `top` on `axes.x.titleAt`) still rejects.
 */
export function validateGlyphChartAxisTitleAt(axes: GlyphChartSpec["axes"]): void {
  if (axes?.x?.titleAt !== undefined && !X_AXIS_TITLE_ATS.includes(axes.x.titleAt)) {
    chartError("bad-axis-title-at", `axes.x.titleAt must be one of ${X_AXIS_TITLE_ATS.join(", ")}, got ${JSON.stringify(axes.x.titleAt)}.`);
  }
  if (axes?.y?.titleAt !== undefined && !Y_AXIS_TITLE_ATS.includes(axes.y.titleAt)) {
    chartError("bad-axis-title-at", `axes.y.titleAt must be one of ${Y_AXIS_TITLE_ATS.join(", ")}, got ${JSON.stringify(axes.y.titleAt)}.`);
  }
}

/**
 * `axes.x.format`/`axes.y.format` — delegates entirely to
 * `resolveGlyphChartTickFormat` (`tickFormat.ts`), the one function that
 * knows the preset table, so this file carries no parallel copy of it. A
 * raw callback function always passes (the TS/JS-only escape hatch;
 * `renderGlyphChartJson`'s own `JSON.parse` can never produce one, so this
 * branch is unreachable from that path regardless). Anything else — an
 * unknown preset name, bad/missing/unknown params, or a value that is
 * neither a preset name/object nor a function — throws `bad-tick-format`.
 */
export function validateGlyphChartAxisFormat(axes: GlyphChartSpec["axes"]): void {
  resolveGlyphChartTickFormat(axes?.x?.format);
  resolveGlyphChartTickFormat(axes?.y?.format);
}

/** A mark's `options.color`: a single canonical hex, or a non-empty array of them. */
function validateMarkColor(color: unknown): void {
  const arr = typeof color === "string" ? [color] : color;
  if (!Array.isArray(arr) || arr.length === 0 || arr.some((c) => !isCanonicalHexColor(c))) {
    chartError("bad-mark-color", `options.color must be a canonical #rrggbb string, or a non-empty array of them, got ${JSON.stringify(color)}.`);
  }
}
export function validateFiniteData(v: unknown): void {
  if (typeof v === "number" && !Number.isFinite(v)) chartError("non-finite-data", "Data and resolved channels must contain only finite numbers.");
  if (Array.isArray(v)) v.forEach(validateFiniteData);
  else if (object(v)) Object.values(v).forEach(validateFiniteData);
}

function validateMark(mark: GlyphChartMark, index: number): void {
  if (!object(mark) || !MARK_TYPES.includes(mark.type)) chartError("unknown-mark-type", `mark[${index}] must have a known type.`);
  if (!Array.isArray(mark.data) || mark.data.length === 0) chartError("empty-data", `mark[${index}] requires non-empty data.`);
  validateFiniteData(mark.data);
  if (mark.data.some((v) => typeof v !== "number" && !object(v))) chartError("bad-channels", "Data must be numbers or records.");
  if (!object(mark.channels) || Object.entries(mark.channels).some(([k, v]) => !CHANNELS.includes(k) || (v !== undefined && !channel(v)))) chartError("bad-channels", "Use x/y/fill/stroke/label channels with a field, array, or accessor.");
  validateFiniteData(mark.channels);
  if (XY_MARK_TYPES.includes(mark.type) && !mark.data.every((v) => typeof v === "number") && (mark.channels.x === undefined || mark.channels.y === undefined)) chartError("missing-xy-channels", "Record data needs both x and y channels.");
  if (mark.type === "arc" && !mark.data.every((v) => typeof v === "number") && mark.channels.y === undefined) chartError("arc-missing-value", "Arc record data needs a y value channel.");
  // Mirrors `arc-missing-value` exactly: a funnel over RECORD data (never
  // the bare `number[]` shorthand, which needs no channel at all) with no
  // `value` channel used to resolve every row's value to `NaN`
  // (`resolveFunnelRows`) and reject downstream as the generic
  // `non-finite-data` — true, but it names no channel and is the state
  // every mark-type switch or dataset Apply with no `value` mapping yet
  // lands in (fable review, batch 3, finding d). Schema-expressible
  // structurally, exactly like `arc-missing-value`.
  if (mark.type === "funnel" && !mark.data.every((v) => typeof v === "number") && mark.channels.value === undefined) {
    chartError("funnel-missing-value", "Funnel record data needs a value channel.");
  }
  // Structural half of `sankey-bad-value` (mirrors `arc-missing-value`'s own
  // presence check, and is what a declarative JSON Schema clause CAN prove);
  // the deeper "every resolved value is finite and > 0" half is a per-row
  // business rule that can only be checked once channels are resolved, so it
  // runs at resolve time (`flowMarks.ts`) under this SAME code — see that
  // file's own doc for why one code covers both.
  if (mark.type === "sankey" && (mark.channels.source === undefined || mark.channels.target === undefined || mark.channels.value === undefined)) {
    chartError("sankey-bad-value", "Sankey data needs source, target, and value channels.");
  }
  // Structural half of `funnel-bad-value` — schema-expressible ONLY for the
  // funnel's own literal `number[]` shorthand (mirroring `sankey-bad-value`'s
  // split): a value behind an accessor/field-named `value` channel has no
  // sign schema can see, so that half runs once channels resolve
  // (`flowMarks.ts`'s `resolveFunnelRows`, under this same code).
  if (mark.type === "funnel" && mark.data.every((v) => typeof v === "number") && mark.data.some((v) => (v as number) < 0)) {
    chartError("funnel-bad-value", "Funnel values must be finite and not negative (zero is allowed).");
  }
  if (mark.transform !== undefined) {
    // Neither flow mark has an x/y scale for a transform to bin/stack/group
    // against (AGENTS.md's "Charts": both are laid out from their own
    // graph/row structure, never a scale) — silently ignoring `transform`
    // here used to render as if it weren't there at all (P3-5); reject
    // instead, exactly like an unsupported `options` key.
    if (mark.type === "sankey" || mark.type === "funnel") chartError("bad-options", `A ${mark.type} mark does not support transform — it has no x/y scale to bin/stack/group against.`);
    const t = mark.transform;
    if (!object(t) || !TRANSFORM_KINDS.includes(t.kind)) chartError("unknown-transform", "Use a known transform kind.");
    if (t.n !== undefined && (!Number.isInteger(t.n) || t.n <= 0)) chartError("invalid-transform-n", "transform.n must be a positive integer.");
    validateFiniteData(t.by);
    if ((t.reduce !== undefined && !REDUCERS.includes(t.reduce)) || (t.by !== undefined && !channel(t.by))) chartError("bad-options", "Use a supported reducer and grouping channel.");
  }
  if (mark.options !== undefined) {
    const o = mark.options;
    if (!object(o) || Object.keys(o).some((k) => !["innerRadius", "axis", "name", "color", "labels", "strokeWidth", "ribbon"].includes(k)) || (o.name !== undefined && typeof o.name !== "string")) chartError("bad-options", "Only innerRadius, axis, name, color, labels, strokeWidth, and ribbon are supported options; size/shape/curve are not supported.");
    if (o.innerRadius !== undefined && (typeof o.innerRadius !== "number" || !Number.isFinite(o.innerRadius) || o.innerRadius < 0 || o.innerRadius >= 1)) chartError("invalid-inner-radius", "innerRadius must be in [0, 1).");
    if (o.axis !== undefined && o.axis !== "x" && o.axis !== "y") chartError("invalid-rule-axis", "axis must be x or y.");
    if (o.color !== undefined) validateMarkColor(o.color);
    if (o.labels !== undefined && o.labels !== "callout" && o.labels !== "legend-only") chartError("bad-options", "labels must be callout or legend-only.");
    if (o.strokeWidth !== undefined && o.strokeWidth !== 1 && o.strokeWidth !== 2 && o.strokeWidth !== 3) chartError("bad-stroke-width", `strokeWidth must be 1, 2, or 3, got ${JSON.stringify(o.strokeWidth)}.`);
    if (o.ribbon !== undefined && o.ribbon !== "filled" && o.ribbon !== "outline") chartError("bad-options", "ribbon must be filled or outline.");
  }
}

// ISO strings are the JSON representation; Date objects are the native one.
const LEAP_YEAR = "(?:[0-9]{2}(?:0[48]|[2468][048]|[13579][26])|(?:[02468][048]|[13579][26])00)";
const CALENDAR_DATE = `(?:[0-9]{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12][0-9]|3[01])|(?:0[469]|11)-(?:0[1-9]|[12][0-9]|30)|02-(?:0[1-9]|1[0-9]|2[0-8]))|${LEAP_YEAR}-02-29)`;
export const ISO_DATE_PATTERN = `^${CALENDAR_DATE}(?:T(?:[01][0-9]|2[0-3]):[0-5][0-9](?::[0-5][0-9](?:\\.[0-9]+)?)?(?:Z|[+-](?:[01][0-9]|2[0-3]):[0-5][0-9])?)?$`;

export function timeValue(v: unknown): Date {
  const date = v instanceof Date ? v : typeof v === "string" && new RegExp(ISO_DATE_PATTERN).test(v) ? new Date(v) : new Date(NaN);
  if (!Number.isFinite(date.getTime())) chartError("bad-time-domain", "Use valid ISO date strings or Date objects for time values and domains.");
  return date;
}
export function validateLogDomain(domain: readonly number[]): void {
  if (domain.some((v) => !Number.isFinite(v) || v === 0) || domain.some((v) => Math.sign(v) !== Math.sign(domain[0]!))) chartError("log-domain", "A log domain must have one sign and exclude zero.");
}

/**
 * `title: string | { text, align?, position? }` (owner packet: "the title
 * has to have some placement controls"). A bare string is the pre-existing
 * shape; an object requires `text` and rejects any unknown key or
 * out-of-vocabulary `align`/`position`.
 */
export function validateGlyphChartTitleOption(title: GlyphChartTitleOption | undefined): void {
  if (title === undefined || typeof title === "string") return;
  if (
    !object(title) || typeof title.text !== "string"
    || (title.align !== undefined && !TITLE_ALIGNS.includes(title.align as string))
    || (title.position !== undefined && !TITLE_POSITIONS.includes(title.position as string))
    || Object.keys(title).some((k) => !["text", "align", "position"].includes(k))
  ) chartError("bad-title", "title must be a string, or { text, align?, position? } with align in left/center/right and position in top/bottom.");
}

/**
 * `legend: boolean | { placement }` (owner packet: "legends only have on or
 * off but no placements").
 */
export function validateGlyphChartLegendOption(legend: GlyphChartLegendOption | undefined): void {
  if (legend === undefined || typeof legend === "boolean") return;
  if (!object(legend) || !LEGEND_PLACEMENTS.includes(legend.placement as string) || Object.keys(legend).some((k) => k !== "placement")) {
    chartError("bad-legend", `legend must be a boolean, or { placement } with placement in ${LEGEND_PLACEMENTS.join(", ")}.`);
  }
}

export function validateGlyphChartSpec(spec: GlyphChartSpec): GlyphChartSpec {
  if (!object(spec) || !Array.isArray(spec.marks) || spec.marks.length === 0) chartError("empty-marks", "A spec requires at least one mark.");
  spec.marks.forEach(validateMark);
  if (spec.description !== undefined && typeof spec.description !== "string") chartError("bad-options", "description must be a string.");
  validateGlyphChartTitleOption(spec.title);
  validateGlyphChartLegendOption(spec.legend);
  validateGlyphChartAxes(spec.axes);
  validateGlyphChartAxisColor(spec.axes);
  validateGlyphChartAxisTitleAt(spec.axes);
  validateGlyphChartAxisFormat(spec.axes);
  if (spec.scales !== undefined && !object(spec.scales)) chartError("bad-scale", "scales must be an object.");
  const scales = { ...spec.scales };
  for (const [axis, opts] of Object.entries(spec.scales ?? {})) {
    if (opts === undefined) continue;
    if (!["x", "y"].includes(axis) || !object(opts) || (opts.type !== undefined && (typeof opts.type !== "string" || !SCALE_TYPES.includes(opts.type))) || (opts.nice !== undefined && typeof opts.nice !== "boolean")) chartError("bad-scale", "Use a supported scale type and boolean nice.");
    const domain = opts.domain;
    const type = opts.type ?? "linear";
    const zeroAnchored = axis === "y" && spec.marks.some((m) => ["bar", "rect", "area"].includes(m.type));
    if (zeroAnchored && ["band", "ordinal", "time"].includes(type)) chartError("bad-scale", "Bar/rect/area y scales must be numeric and include zero.");
    if (zeroAnchored && type === "log" && domain === undefined) chartError("log-domain", "The inferred zero baseline is incompatible with log scales.");
    if (domain === undefined) continue;
    if (!Array.isArray(domain) || domain.length < 2) chartError(type === "time" ? "bad-time-domain" : "bad-scale", "A domain requires at least two values.");
    if (type !== "band" && type !== "ordinal" && domain.length !== 2) chartError(type === "time" ? "bad-time-domain" : "bad-scale", "Continuous domains require exactly two endpoints.");
    if (type === "time") {
      const dates = domain.map(timeValue);
      scales[axis as "x" | "y"] = { ...opts, domain: dates };
    } else if (type !== "band" && type !== "ordinal") {
      if (domain.some((v) => typeof v !== "number" || !Number.isFinite(v))) chartError("bad-scale", "Numeric domains require finite numbers.");
      const numbers = domain as number[];
      if (type === "log") validateLogDomain(numbers);
      if (axis === "y" && spec.marks.some((m) => ["bar", "rect", "area"].includes(m.type)) && !(Math.min(...numbers) <= 0 && Math.max(...numbers) >= 0)) chartError("bar-domain-excludes-zero", "A bar, rect, or area domain must include zero.");
    }
  }
  return { ...spec, scales };
}

export function validateGlyphChartRenderSize(width: number, height: number): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) chartError("bad-size", `width/height must be positive integers, got ${width}x${height}.`);
}

/** `options.textScale` (AGENTS.md's "Charts" "Density" paragraph) — an integer `>= 1`; `1` is the byte-identical default. */
export function validateGlyphChartTextScale(textScale: number): void {
  if (!Number.isInteger(textScale) || textScale < 1) chartError("bad-text-scale", `textScale must be a positive integer, got ${textScale}.`);
}

export const REGION_FILLS = ["auto", "solid", "texture"] as const;
/** `options.regionFill` (AGENTS.md's "Charts" "Series and shading") — one of `REGION_FILLS`; omitted is `"auto"`. */
export function validateGlyphChartRegionFill(regionFill: unknown): void {
  if (regionFill === undefined) return;
  if (!(REGION_FILLS as readonly unknown[]).includes(regionFill)) chartError("bad-region-fill", `regionFill must be one of ${REGION_FILLS.join(", ")}, got ${JSON.stringify(regionFill)}.`);
}
/**
 * A fill palette replaces the charset's own series glyphs cell for cell, so
 * each entry is one visible character; a space would read as no fill at all,
 * and `ascii` stays 7-bit.
 */
export function validateGlyphChartShades(shades: unknown, charset: GlyphChartCharset): void {
  if (shades === undefined) return;
  const ok = Array.isArray(shades) && shades.length > 0 && shades.every((g) => typeof g === "string" && [...g].length === 1 && /^\S$/u.test(g) && (charset !== "ascii" || /^[\x21-\x7e]$/.test(g)));
  if (!ok) chartError("bad-shades", `shades must be a non-empty array of single visible characters${charset === "ascii" ? " (7-bit ASCII for the ascii charset)" : ""}, got ${JSON.stringify(shades)}.`);
}
const REPAIR_HINTS: Readonly<Record<GlyphChartValidationRuleId, string>> = {
  "empty-marks": "Add at least one mark to spec.marks, e.g. glyphChartLine([...]).",
  "unknown-mark-type": `Use one of: ${MARK_TYPES.join(", ")}.`,
  "empty-data": "Pass a non-empty data array.",
  "missing-xy-channels": "Supply channels.x and channels.y for records, or pass number[].",
  "arc-missing-value": "Supply channels.y for arc record values, with optional fill or label categories, or pass number[].",
  "unknown-transform": `Use one of: ${TRANSFORM_KINDS.join(", ")}.`,
  "invalid-transform-n": "Set transform.n to a positive integer.",
  "invalid-inner-radius": "Set innerRadius to a number in [0, 1).",
  "invalid-rule-axis": "Set axis to x or y.",
  "bad-size": "Pass positive integer width and height, or omit them.",
  "non-finite-data": "Replace NaN and Infinity with finite data and channel values.",
  "bad-channels": "Use x/y/fill/stroke/label with fields, arrays, or accessors over numbers or records.",
  "bad-options": "Remove unsupported options; use a valid name, axis, radius, reducer, and labels mode.",
  "bad-scale": `Use ${SCALE_TYPES.join(", ")} and a domain of finite numbers or categories.`,
  "log-domain": "Use a strictly positive or strictly negative log domain; bars require a zero-capable scale.",
  "bar-domain-excludes-zero": "Extend the explicit bar/rect/area domain to include zero.",
  "bad-time-domain": "Use valid ISO strings or Date objects for time values and domains.",
  "bad-title": `Use a string, or { text, align?, position? } with align in ${TITLE_ALIGNS.join("/")} and position in ${TITLE_POSITIONS.join("/")}.`,
  "bad-legend": `Use a boolean, or { placement } with placement in ${LEGEND_PLACEMENTS.join(", ")}.`,
  "sankey-bad-value": "Supply source, target, and value channels, and make sure every resolved value is finite and greater than 0.",
  "funnel-bad-value": "Make sure every resolved funnel value is finite and not negative (zero is allowed).",
  "funnel-missing-value": "Supply channels.value for funnel record data (a stage channel too, or the row index is used), or pass number[].",
  "bad-axes": "Make axes (and axes.x/axes.y, if present) a plain object, or omit it entirely.",
  "bad-axis-color": "Use a canonical lowercase #rrggbb string for axes.color, axes.x.color, and axes.y.color.",
  "bad-axis-title-at": `Use one of ${X_AXIS_TITLE_ATS.join("/")} for axes.x.titleAt, or one of ${Y_AXIS_TITLE_ATS.join("/")} for axes.y.titleAt.`,
  "bad-mark-color": "Use a canonical lowercase #rrggbb string, or a non-empty array of them, for options.color.",
  "bad-stroke-width": "Set options.strokeWidth to 1, 2, or 3.",
  "bad-tick-format": "Use a known preset name, { preset, ...params } with valid params, or (TS/JS only) a callback (value, index, ticks) => string.",
  "bad-text-scale": "Set textScale to a positive integer (1 or omitted is the default).",
  "bad-shades": "Set shades to an array of single visible characters, e.g. [\"#\", \"=\", \"+\", \":\", \".\"], or omit it.",
  "bad-region-fill": `Set regionFill to one of ${REGION_FILLS.join("/")}, or omit it for auto.`,
};

/**
 * Repair hints for the runtime-only tagged codes (`mixed-x-scale`,
 * `GLYPH_CHART_INTERNAL_COORD`, `sankey-cycle`) that are deliberately NOT
 * `GLYPH_CHART_VALIDATION_RULES` entries (see `mixedXScaleError`'s,
 * `guardCoord`'s, and `flowMarks.ts`'s own docs) — a separate table, not a
 * union-widening of `GlyphChartValidationRuleId`, so schema-parity tests
 * (which enumerate that union) stay untouched. `sankey-cycle` joins them for
 * the identical reason `mixed-x-scale` does: "does this graph have a cycle"
 * is a data-dependent, cross-row property no declarative JSON Schema clause
 * can express. Without this, `renderGlyphChartJson`'s
 * documented `{ error, code, hint }` shape silently lost its `hint` key for
 * these — `JSON.stringify` drops an `undefined` value entirely (review
 * finding 10), indistinguishable from a code the lookup has never heard of.
 */
const RUNTIME_REPAIR_HINTS: Readonly<Record<string, string>> = {
  "mixed-x-scale": "Set an explicit scales.x.type, or make every mark's x channel resolve to the same value type (or one that fits the same band domain).",
  "GLYPH_CHART_INTERNAL_COORD": "Check the named mark's x/y channels resolve to values already in-domain (a band scale needs a matching category; a continuous scale needs a finite number).",
  "sankey-cycle": "Remove the cyclic source -> target link — a sankey's node columns are a DAG's depth order and have no honest position for a cycle.",
  "sankey-missing-channel": "Check the source/target channel's field name against the actual data keys — a typo resolves every row to the same missing value instead of a real node.",
  "bad-chart-input": "Pass a GlyphChartSpec ({ marks: [...] }), a single mark object, an array of marks, or a plain number[] shorthand.",
};

export function glyphChartRepairHint(id: string): string | undefined {
  return (REPAIR_HINTS as Readonly<Record<string, string>>)[id] ?? RUNTIME_REPAIR_HINTS[id];
}
