/**
 * Channel resolution: turns a mark's `data` + `channels` into a flat list of
 * `GlyphChartMarkRow`s every downstream module (scales, transforms, layout,
 * paint) reads uniformly, regardless of whether the caller supplied a plain
 * number array, a field-name string, or an accessor function.
 *
 * A 1-D numeric array infers `x = index, y = identity` for each axis the mark leaves unspecified — the same shorthand Observable Plot's own
 * `Plot.lineY([3,5,2,8])` uses (see `docs/design/charts.md`).
 */

import type { GlyphChartChannelValue, GlyphChartDatum, GlyphChartMark, GlyphChartMarkRow } from "./types";

export type Accessor = (datum: unknown, index: number) => unknown;

/** Exported for `flowMarks.ts` — sankey/funnel channels (`source`/`target`/`value`/`stage`) resolve through the identical field/accessor/array rule as `x`/`y`/`fill`/`stroke`/`label`. */
export function accessorFor(value: GlyphChartChannelValue | undefined): Accessor | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "function") return value as Accessor;
  if (Array.isArray(value)) return (_d, i) => (value as readonly unknown[])[i];
  const field = value as string;
  return (d) => (d as GlyphChartDatum)?.[field];
}

export const identity: Accessor = (d) => d;
export const index: Accessor = (_d, i) => i;

/** `true` iff every element of `data` is a plain finite number (the 1-D shorthand form) — exported for `flowMarks.ts`'s funnel bare-array shorthand. */
export function isNumericArray(data: GlyphChartMark["data"]): data is readonly number[] {
  return data.length > 0 && data.every((v) => typeof v === "number");
}

/**
 * Materialise a mark's rows. For the 1-D numeric shorthand, `x` defaults to the row index and `y` to the value itself
 * (`glyphChartLine([3,5,2,8])` → four rows `{x:0,y:3}…{x:3,y:8}`). Any other
 * shape requires the caller's channel accessors to resolve `x`/`y`
 * (`rule`/`text` marks may legitimately leave one of them unset — painting
 * decides what that means per mark type).
 */
export function materializeGlyphChartMarkRows(mark: GlyphChartMark): GlyphChartMarkRow[] {
  const shorthand = isNumericArray(mark.data);
  const xAcc = accessorFor(mark.channels.x) ?? (shorthand ? index : identity);
  const yAcc = accessorFor(mark.channels.y) ?? (shorthand ? identity : undefined);
  const fillAcc = accessorFor(mark.channels.fill);
  const strokeAcc = accessorFor(mark.channels.stroke);
  const labelAcc = accessorFor(mark.channels.label);

  return mark.data.map((datum, i) => ({
    x: xAcc(datum, i),
    y: yAcc ? yAcc(datum, i) : undefined,
    fill: fillAcc?.(datum, i),
    stroke: strokeAcc?.(datum, i),
    label: labelAcc?.(datum, i),
    index: i,
  }));
}
