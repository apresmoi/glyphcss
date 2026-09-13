import type { GlyphChartLegendOption, GlyphChartMark, GlyphChartMarkType, GlyphChartSpec, GlyphChartTitleOption } from "./types";

// Schema generation shares the vocabulary and repair rules; schema.test uses
// an independent JSON Schema evaluator for the structural and domain clauses.
export const GLYPH_CHART_VALIDATION_RULES = [
  "empty-marks", "unknown-mark-type", "empty-data", "missing-xy-channels", "arc-missing-value",
  "unknown-transform", "invalid-transform-n", "invalid-inner-radius", "invalid-rule-axis",
  "bad-size", "non-finite-data", "bad-channels", "bad-options", "bad-scale",
  "log-domain", "bar-domain-excludes-zero", "bad-time-domain", "bad-title", "bad-legend",
] as const;
export type GlyphChartValidationRuleId = typeof GLYPH_CHART_VALIDATION_RULES[number];
export interface GlyphChartValidationError extends Error { readonly code: GlyphChartValidationRuleId }

export function chartError(code: GlyphChartValidationRuleId, message: string): never {
  throw Object.assign(new TypeError(`glyphcss: ${code}: ${message}`), { code });
}

export const MARK_TYPES: readonly GlyphChartMarkType[] = ["line", "area", "bar", "dot", "arc", "rect", "cell", "text", "rule"];
export const XY_MARK_TYPES = ["line", "area", "bar", "dot", "rect", "cell"];
export const TRANSFORM_KINDS = ["bin", "stack", "group", "normalize", "window"];
export const CHANNELS = ["x", "y", "fill", "stroke", "label"];
export const SCALE_TYPES = ["linear", "log", "sqrt", "time", "band", "ordinal"];
export const REDUCERS = ["mean", "sum", "min", "max"];
export const TITLE_ALIGNS = ["left", "center", "right"];
export const TITLE_POSITIONS = ["top", "bottom"];
export const LEGEND_PLACEMENTS = ["bottom", "top-left", "top-right", "bottom-left", "bottom-right", "title"];

function object(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function channel(v: unknown): boolean { return typeof v === "string" || typeof v === "function" || Array.isArray(v); }
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
  if (mark.transform !== undefined) {
    const t = mark.transform;
    if (!object(t) || !TRANSFORM_KINDS.includes(t.kind)) chartError("unknown-transform", "Use a known transform kind.");
    if (t.n !== undefined && (!Number.isInteger(t.n) || t.n <= 0)) chartError("invalid-transform-n", "transform.n must be a positive integer.");
    validateFiniteData(t.by);
    if ((t.reduce !== undefined && !REDUCERS.includes(t.reduce)) || (t.by !== undefined && !channel(t.by))) chartError("bad-options", "Use a supported reducer and grouping channel.");
  }
  if (mark.options !== undefined) {
    const o = mark.options;
    if (!object(o) || Object.keys(o).some((k) => !["innerRadius", "axis", "name"].includes(k)) || (o.name !== undefined && typeof o.name !== "string")) chartError("bad-options", "Only innerRadius, axis, and name are supported options; size/shape/curve are not supported.");
    if (o.innerRadius !== undefined && (typeof o.innerRadius !== "number" || !Number.isFinite(o.innerRadius) || o.innerRadius < 0 || o.innerRadius >= 1)) chartError("invalid-inner-radius", "innerRadius must be in [0, 1).");
    if (o.axis !== undefined && o.axis !== "x" && o.axis !== "y") chartError("invalid-rule-axis", "axis must be x or y.");
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
  "bad-options": "Remove unsupported options; use a valid name, axis, radius, and reducer.",
  "bad-scale": `Use ${SCALE_TYPES.join(", ")} and a domain of finite numbers or categories.`,
  "log-domain": "Use a strictly positive or strictly negative log domain; bars require a zero-capable scale.",
  "bar-domain-excludes-zero": "Extend the explicit bar/rect/area domain to include zero.",
  "bad-time-domain": "Use valid ISO strings or Date objects for time values and domains.",
  "bad-title": `Use a string, or { text, align?, position? } with align in ${TITLE_ALIGNS.join("/")} and position in ${TITLE_POSITIONS.join("/")}.`,
  "bad-legend": `Use a boolean, or { placement } with placement in ${LEGEND_PLACEMENTS.join(", ")}.`,
};

/**
 * Repair hints for the two runtime-only tagged codes (`mixed-x-scale`,
 * `GLYPH_CHART_INTERNAL_COORD`) that are deliberately NOT
 * `GLYPH_CHART_VALIDATION_RULES` entries (see `mixedXScaleError`'s and
 * `guardCoord`'s own docs) — a separate table, not a union-widening of
 * `GlyphChartValidationRuleId`, so schema-parity tests (which enumerate
 * that union) stay untouched. Without this, `renderGlyphChartJson`'s
 * documented `{ error, code, hint }` shape silently lost its `hint` key for
 * these two — `JSON.stringify` drops an `undefined` value entirely (review
 * finding 10), indistinguishable from a code the lookup has never heard of.
 */
const RUNTIME_REPAIR_HINTS: Readonly<Record<string, string>> = {
  "mixed-x-scale": "Set an explicit scales.x.type, or make every mark's x channel resolve to the same value type (or one that fits the same band domain).",
  "GLYPH_CHART_INTERNAL_COORD": "Check the named mark's x/y channels resolve to values already in-domain (a band scale needs a matching category; a continuous scale needs a finite number).",
};

export function glyphChartRepairHint(id: string): string | undefined {
  return (REPAIR_HINTS as Readonly<Record<string, string>>)[id] ?? RUNTIME_REPAIR_HINTS[id];
}
