import type { GlyphMapBands, GlyphMapClassifier, GlyphMapField } from "./types";

function bucketByBreaks(value: number, breaks: readonly number[]): number {
  let band = 0;
  for (const b of breaks) {
    if (value >= b) band++;
    else break;
  }
  return band;
}

function classifyWithBreaks(field: GlyphMapField, breaks: readonly number[]): Uint8Array {
  const bands = new Uint8Array(field.cols * field.rows);
  for (let i = 0; i < bands.length; i++) {
    bands[i] = field.noData[i] ? 0 : bucketByBreaks(field.values[i], breaks);
  }
  return bands;
}

/** Fixed thresholds, ascending. `band = count of breaks <= value` (0..breaks.length). Not an order statistic — legal on categorical fields. */
export function glyphMapBreaks(breaks: readonly number[], opts: { id?: string } = {}): GlyphMapClassifier {
  for (let i = 1; i < breaks.length; i++) {
    if (!(breaks[i] > breaks[i - 1])) {
      throw new RangeError("glyphcss/maps: glyphMapBreaks requires strictly ascending breaks.");
    }
  }
  const id = opts.id ?? `breaks:${breaks.join(",")}`;
  return {
    id,
    orderStatistic: false,
    classifyValue: (v: number) => bucketByBreaks(v, breaks),
    classify: (field: GlyphMapField) => classifyWithBreaks(field, breaks),
  };
}

function domainOf(field: GlyphMapField, range: readonly [number, number] | undefined): [number, number] {
  if (range) return [range[0], range[1]];
  return [field.min, field.max];
}

/** `n` equal-width bins across `[min, max]` (or an explicit `range`). Not an order statistic. */
export function glyphMapEqualInterval(n: number, range?: readonly [number, number], opts: { id?: string } = {}): GlyphMapClassifier {
  if (!Number.isInteger(n) || n < 1) throw new RangeError("glyphcss/maps: glyphMapEqualInterval requires n >= 1.");
  const id = opts.id ?? `equal-interval:${n}${range ? `:${range[0]},${range[1]}` : ""}`;
  const classifyValue = range
    ? (v: number) => {
        const [lo, hi] = range;
        if (hi <= lo) return 0;
        return Math.min(n - 1, Math.max(0, Math.floor(((v - lo) / (hi - lo)) * n)));
      }
    : undefined;
  return {
    id,
    orderStatistic: false,
    classifyValue,
    classify: (field: GlyphMapField) => {
      const [lo, hi] = domainOf(field, range);
      const bands = new Uint8Array(field.cols * field.rows);
      for (let i = 0; i < bands.length; i++) {
        if (field.noData[i]) continue;
        bands[i] = hi <= lo ? 0 : Math.min(n - 1, Math.max(0, Math.floor(((field.values[i] - lo) / (hi - lo)) * n)));
      }
      return bands;
    },
  };
}

/**
 * `n` percentile bins, breakpoints computed from the field's own valid-value
 * distribution ("classify over the whole source at bake time" — MAPS.md §5).
 * A window-relative classifier needs its window pinned, so `classifyValue` is
 * intentionally absent: a quantile classifier's breaks have no meaning
 * independent of the field it was fit against.
 */
export function glyphMapQuantile(n: number, opts: { id?: string } = {}): GlyphMapClassifier {
  if (!Number.isInteger(n) || n < 1) throw new RangeError("glyphcss/maps: glyphMapQuantile requires n >= 1.");
  const id = opts.id ?? `quantile:${n}`;
  return {
    id,
    orderStatistic: true,
    classify: (field: GlyphMapField) => {
      const sorted: number[] = [];
      for (let i = 0; i < field.values.length; i++) {
        if (!field.noData[i]) sorted.push(field.values[i]);
      }
      sorted.sort((a, b) => a - b);
      const breaks: number[] = [];
      if (sorted.length > 0) {
        for (let k = 1; k < n; k++) {
          const p = (k / n) * (sorted.length - 1);
          const lo = Math.floor(p), hi = Math.ceil(p);
          const t = p - lo;
          breaks.push(sorted[lo] + (sorted[hi] - sorted[lo]) * t);
        }
      }
      return classifyWithBreaks(field, breaks);
    },
  };
}

/**
 * `n` log-spaced bins across `[min, max]` (or an explicit `range`). Domain is
 * shifted to be strictly positive before taking logs when it isn't already
 * (elevation/depth fields routinely cross zero), so a value below the
 * smallest strictly-positive break still lands in band 0 rather than
 * producing `NaN`/`-Infinity` bucket math.
 */
export function glyphMapLog(n: number, range?: readonly [number, number], opts: { id?: string } = {}): GlyphMapClassifier {
  if (!Number.isInteger(n) || n < 1) throw new RangeError("glyphcss/maps: glyphMapLog requires n >= 1.");
  const id = opts.id ?? `log:${n}${range ? `:${range[0]},${range[1]}` : ""}`;
  const bandFor = (v: number, lo: number, hi: number): number => {
    const offset = lo <= 0 ? -lo + 1e-6 : 0;
    const slo = lo + offset, shi = hi + offset, sv = v + offset;
    if (shi <= slo || sv <= 0) return 0;
    const t = Math.log(sv / slo) / Math.log(shi / slo);
    return Math.min(n - 1, Math.max(0, Math.floor(t * n)));
  };
  const classifyValue = range ? (v: number) => bandFor(v, range[0], range[1]) : undefined;
  return {
    id,
    orderStatistic: true,
    classifyValue,
    classify: (field: GlyphMapField) => {
      const [lo, hi] = domainOf(field, range);
      const bands = new Uint8Array(field.cols * field.rows);
      for (let i = 0; i < bands.length; i++) {
        if (field.noData[i]) continue;
        bands[i] = bandFor(field.values[i], lo, hi);
      }
      return bands;
    },
  };
}

/**
 * `kind` gates which aggregations are legal (MAPS.md §5): order-statistic
 * classifiers (quantile, log) are meaningless on categorical class codes —
 * this throws rather than coercing.
 */
export function classifyGlyphMapField(field: GlyphMapField, classifier: GlyphMapClassifier): GlyphMapBands {
  if (field.kind === "categorical" && classifier.orderStatistic) {
    throw new TypeError(
      `glyphcss/maps: classifier "${classifier.id}" is an order-statistic classifier and cannot be applied to a categorical field.`,
    );
  }
  return {
    cols: field.cols,
    rows: field.rows,
    bands: classifier.classify(field),
    noData: field.noData,
    field,
    classifier: classifier.id,
  };
}

/**
 * `elevToBand`'s thresholds (`website/scripts/bake-globe.mjs`), frozen as a
 * classifier value. `bake-globe.mjs` imports this instead of keeping its own
 * copy of the breakpoints, so they exist exactly once (MAPS.md §13).
 */
export const GlyphMapClassifiers = {
  etopo1V1: glyphMapBreaks([0, 250, 800, 1600, 2600, 3600, 4600, 5600], { id: "etopo1-v1" }),
};
