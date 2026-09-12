/**
 * Resolves every mark in a spec ONCE — channel materialisation, transform
 * application, and (for `rule` marks) raw axis-value extraction — into a
 * `GlyphChartResolvedMark[]` that `scales.ts`, `layout.ts` and `paint.ts` all
 * read from, so a mark's rows/transform never run twice with a chance to
 * disagree.
 */

import { validateFiniteData } from "./validate";
import { materializeGlyphChartMarkRows } from "./channels";
import { applyGlyphChartTransform } from "./transforms";
import type { GlyphChartMark, GlyphChartMarkRow, GlyphChartSpec } from "./types";

export interface GlyphChartResolvedMark {
  readonly mark: GlyphChartMark;
  /** Populated for every mark type except `rule`. */
  readonly rows: readonly GlyphChartMarkRow[];
  /** Populated only for `rule` marks: raw positions along `mark.options.axis`. */
  readonly ruleValues?: readonly number[];
}

function resolveRuleValues(mark: GlyphChartMark): number[] {
  // `glyphChartRule` stores its values directly as `mark.data` (numbers);
  // a hand-built rule mark may instead carry record data with a channel
  // named for its own axis (e.g. `channels.y` for an axis:"y" rule).
  if (mark.data.length > 0 && typeof mark.data[0] === "number") {
    return mark.data as number[];
  }
  const axis = mark.options?.axis ?? "y";
  const rows = materializeGlyphChartMarkRows({ ...mark, channels: { x: mark.channels.x, y: mark.channels.y } });
  return rows.map((r) => Number(axis === "x" ? r.x : r.y)).filter(Number.isFinite);
}

export function resolveGlyphChartSpec(spec: GlyphChartSpec): GlyphChartResolvedMark[] {
  return spec.marks.map((mark) => {
    if (mark.type === "rule") {
      return { mark, rows: [], ruleValues: resolveRuleValues(mark) };
    }
    let rows = materializeGlyphChartMarkRows(mark);
    validateFiniteData(rows);
    if (mark.transform) rows = applyGlyphChartTransform(rows, mark.transform);
    validateFiniteData(rows);
    return { mark, rows };
  });
}
