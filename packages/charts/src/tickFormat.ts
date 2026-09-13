/**
 * Named tick-label formatters for `axes.x.format`/`axes.y.format`
 * (AGENTS.md's "Charts" "Axes"). A preset name (string) or `{ preset,
 * ...params }` object is the ONLY shape `renderGlyphChartJson`/the CLI/the
 * JSON schema accept (`schema.ts` derives its own tick-format schema from
 * `GLYPH_CHART_TICK_FORMAT_PRESETS`' own param tables, never a parallel
 * list) — a plain callback `(value, index, ticks) => string` is a TS/JS-only
 * escape hatch with no JSON representation.
 *
 * `"auto"` (or omitting `format` entirely) is today's behaviour:
 * `resolveGlyphChartTickFormat` returns `undefined` for it, so the scale's
 * own default label generation (`scales.ts`'s SI-or-plain numeric ladder,
 * d3's multi-scale time format, or the band category string) runs
 * completely UNTOUCHED — never a re-implementation that could drift from it,
 * which is what makes "byte-identical when `format` is absent" provable
 * rather than merely claimed.
 */

import { format as d3format } from "d3-format";
import { timeFormat } from "d3-time-format";
import type { GlyphChartTickFormat, GlyphChartTickFormatCallback } from "./types";

function tickFormatError(message: string): never {
  throw Object.assign(new TypeError(`glyphcss: bad-tick-format: ${message}`), { code: "bad-tick-format" as const });
}

export interface GlyphChartResolvedTickFormat {
  readonly apply: (value: unknown, index: number, ticks: readonly unknown[]) => string;
  /**
   * Numeric-overflow fallback (`labels.ts`'s abbreviate/drop policy) —
   * present only for a preset that HAS one. A formatted label like
   * `"$1,234.00"` or `"42%"` no longer round-trips through `Number()`, so
   * without this the generic SI-of-the-display-text attempt can never fire
   * and the label just drops — which is correct for a preset with nothing
   * sensible to shrink to (`percent`, `decimals`, `scientific`, the
   * already-abbreviated `si`/`compact`), and wrong for one that does.
   */
  readonly siFallback?: (value: number) => string;
  /**
   * `true` only for a raw callback — its output is opaque text the library
   * cannot parse back into a number, so it is always treated as a CATEGORY
   * label (elided with `…`), never routed through the numeric drop policy a
   * preset's own `numeric` hint enables.
   */
  readonly isCallback: boolean;
}

interface GlyphChartTickFormatPresetEntry {
  /** Every parameter key this preset recognises (besides `preset` itself). */
  readonly params: readonly string[];
  readonly required: readonly string[];
  readonly validate?: (params: Readonly<Record<string, unknown>>) => void;
  readonly apply: (value: unknown, params: Readonly<Record<string, unknown>>) => string;
  readonly siFallback?: (value: number, params: Readonly<Record<string, unknown>>) => string;
}

const SI_FORMAT = d3format("~s");
const PLAIN_FORMAT = d3format("~r");
const cleanMinus = (s: string): string => s.replace(/−/g, "-");
function siOf(value: number): string {
  return cleanMinus(SI_FORMAT(value));
}
function toNumber(value: unknown): number {
  return typeof value === "number" ? value : Number(value);
}
function toDate(value: unknown): Date {
  return value instanceof Date ? value : new Date(String(value));
}

const ISO_DATE = timeFormat("%Y-%m-%d");
const YEAR_ONLY = timeFormat("%Y");
const MONTH_YEAR = timeFormat("%b %Y");
const MONTH_ABBR = timeFormat("%b");
const HOUR_MINUTE = timeFormat("%H:%M");

/**
 * What `format: "auto"`/an absent `format` would show for a single value —
 * used ONLY by the `template` preset's `{value}` substitution (a caller
 * composing a unit onto an otherwise-default label still wants the default
 * numeric/date formatting underneath). Every other preset bypasses this
 * entirely, and the true axis default (`resolveGlyphChartTickFormat`
 * returning `undefined`) never calls it either — see the module doc.
 */
function autoFormatValue(value: unknown): string {
  if (value instanceof Date) return ISO_DATE(value);
  if (typeof value === "number") {
    const abs = Math.abs(value);
    return cleanMinus(abs !== 0 && (abs >= 1000 || abs < 0.01) ? SI_FORMAT(value) : PLAIN_FORMAT(value));
  }
  return String(value);
}

function requireFiniteNonNegativeInteger(v: unknown, field: string, preset: string): void {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0) tickFormatError(`${preset}'s ${field} must be a non-negative integer, got ${JSON.stringify(v)}.`);
}

export const GLYPH_CHART_TICK_FORMAT_PRESETS: Readonly<Record<string, GlyphChartTickFormatPresetEntry>> = {
  auto: { params: [], required: [], apply: (v) => autoFormatValue(v) },
  number: {
    params: [], required: [],
    apply: (v) => d3format(",")(toNumber(v)),
    siFallback: (v) => siOf(v),
  },
  si: { params: [], required: [], apply: (v) => siOf(toNumber(v)) },
  compact: {
    // K/M/B with 1-2 significant digits — d3's own `~s` SI prefixes reused
    // (never a hand-rolled magnitude ladder that could disagree with it),
    // relettered: `k` -> `K`, `G` (giga, d3's SI prefix for 1e9) -> `B`
    // (short-scale "billion", the vocabulary this preset promises).
    params: [], required: [],
    apply: (v) => cleanMinus(d3format(".2~s")(toNumber(v))).replace(/k$/, "K").replace(/G$/, "B"),
  },
  integer: {
    params: [], required: [],
    apply: (v) => String(Math.round(toNumber(v))),
    siFallback: (v) => siOf(Math.round(v)),
  },
  percent: {
    // `of` is the value a tick's own number is a fraction OF — default `1`
    // ("value 0..1 -> 42%"), `{ of: 100 }` for an axis whose values already
    // run 0..100.
    params: ["of"], required: [],
    validate: (p) => {
      if (p.of !== undefined && (typeof p.of !== "number" || !Number.isFinite(p.of) || p.of === 0)) tickFormatError(`percent's of must be a nonzero finite number, got ${JSON.stringify(p.of)}.`);
    },
    apply: (v, p) => `${Math.round((toNumber(v) / (typeof p.of === "number" ? p.of : 1)) * 100)}%`,
  },
  currency: {
    params: ["symbol", "decimals"], required: [],
    validate: (p) => {
      if (p.symbol !== undefined && typeof p.symbol !== "string") tickFormatError(`currency's symbol must be a string, got ${JSON.stringify(p.symbol)}.`);
      if (p.decimals !== undefined) requireFiniteNonNegativeInteger(p.decimals, "decimals", "currency");
    },
    apply: (v, p) => {
      const symbol = typeof p.symbol === "string" ? p.symbol : "$";
      const decimals = typeof p.decimals === "number" ? p.decimals : 2;
      const n = toNumber(v);
      return `${n < 0 ? "-" : ""}${symbol}${d3format(`,.${decimals}f`)(Math.abs(n))}`;
    },
    siFallback: (v, p) => {
      const symbol = typeof p.symbol === "string" ? p.symbol : "$";
      return `${v < 0 ? "-" : ""}${symbol}${siOf(Math.abs(v))}`;
    },
  },
  decimals: {
    params: ["places"], required: ["places"],
    validate: (p) => requireFiniteNonNegativeInteger(p.places, "places", "decimals"),
    apply: (v, p) => toNumber(v).toFixed(p.places as number),
  },
  scientific: { params: [], required: [], apply: (v) => toNumber(v).toExponential(2) },
  date: { params: [], required: [], apply: (v) => ISO_DATE(toDate(v)) },
  year: { params: [], required: [], apply: (v) => YEAR_ONLY(toDate(v)) },
  month: { params: [], required: [], apply: (v) => MONTH_YEAR(toDate(v)) },
  day: { params: [], required: [], apply: (v) => { const d = toDate(v); return `${d.getDate()} ${MONTH_ABBR(d)}`; } },
  time: { params: [], required: [], apply: (v) => HOUR_MINUTE(toDate(v)) },
  template: {
    params: ["pattern"], required: ["pattern"],
    validate: (p) => { if (typeof p.pattern !== "string") tickFormatError(`template's pattern must be a string, got ${JSON.stringify(p.pattern)}.`); },
    apply: (v, p) => (p.pattern as string).replace("{value}", autoFormatValue(v)),
  },
};

export const GLYPH_CHART_TICK_FORMAT_PRESET_NAMES: readonly string[] = Object.keys(GLYPH_CHART_TICK_FORMAT_PRESETS);

function resolvePreset(name: string, params: Readonly<Record<string, unknown>>): GlyphChartResolvedTickFormat {
  const entry = GLYPH_CHART_TICK_FORMAT_PRESETS[name];
  if (!entry) tickFormatError(`Unknown tick format preset "${name}" — use one of ${GLYPH_CHART_TICK_FORMAT_PRESET_NAMES.join(", ")}.`);
  const allowed = new Set(entry.params);
  for (const key of Object.keys(params)) {
    if (!allowed.has(key)) tickFormatError(`Unknown parameter "${key}" for tick format preset "${name}" — use one of ${entry.params.join(", ") || "(no parameters)"}.`);
  }
  for (const required of entry.required) {
    if (params[required] === undefined) tickFormatError(`Tick format preset "${name}" requires "${required}".`);
  }
  entry.validate?.(params);
  return {
    apply: (v) => entry.apply(v, params),
    siFallback: entry.siFallback ? (v: number) => entry.siFallback!(v, params) : undefined,
    isCallback: false,
  };
}

/**
 * Validates AND resolves `axes.{x,y}.format` into the callback layout.ts
 * applies to every raw tick's label. `undefined` (absent, `"auto"`, or
 * `{ preset: "auto" }` with no other keys) means "no override" — the caller
 * must skip formatting entirely rather than calling `autoFormatValue`, which
 * is a template-only convenience, not a promise to reproduce the scale's own
 * default label byte for byte (it does not: a time axis's real default is
 * d3's multi-scale format, not a flat ISO date). Throws `bad-tick-format`
 * (`GlyphChartValidationRuleId`) for anything else — an unknown preset name,
 * bad/unknown params, or a value that is neither a preset name, a preset
 * object, nor a function.
 */
export function resolveGlyphChartTickFormat(format: GlyphChartTickFormat | undefined): GlyphChartResolvedTickFormat | undefined {
  if (format === undefined) return undefined;
  if (typeof format === "function") {
    const callback = format as GlyphChartTickFormatCallback;
    return { apply: (v, i, t) => callback(v as number | Date | string, i, t), isCallback: true };
  }
  if (typeof format === "string") {
    if (format === "auto") return undefined;
    return resolvePreset(format, {});
  }
  if (typeof format === "object" && format !== null && !Array.isArray(format)) {
    const { preset, ...params } = format as Record<string, unknown>;
    if (typeof preset !== "string") tickFormatError("A tick format object requires a string preset.");
    if (preset === "auto" && Object.keys(params).length === 0) return undefined;
    return resolvePreset(preset, params);
  }
  tickFormatError(`axes format must be a preset name, { preset, ...params }, or a callback function, got ${JSON.stringify(format)}.`);
}
