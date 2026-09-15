/**
 * `glyphChartBars3d` — upright boxes on a numeric `(x, y)` grid, height
 * `z`, coloured by height (PLAN-3d.md C5, "a 3D bar chart"). `x`/`y` are
 * NUMERIC positions (an index, a year, a coordinate) — `xLabel`/`yLabel`
 * ride on each bar for a caller's own bookkeeping (a legend, a tooltip)
 * but do not become categorical axis ticks; `GlyphChart3dResolvedAxis` is a
 * linear numeric axis throughout this package, matching `surface`/
 * `scatter3d`/`parametric3d`.
 */
import { chart3dError } from "./validate";
import { resolveGlyphChart3dColorscaleAnchors } from "./colorscale";
import { resolveAspect, resolveAxesColor, resolveAxis, resolveCorner, resolveGuides } from "./axisTriadShared";
import type {
  GlyphChart3dAxisOptions,
  GlyphChart3dBar,
  GlyphChart3dBarsMark,
  GlyphChart3dBuildReport,
  GlyphChart3dChannelValue,
  GlyphChart3dColorscale,
  GlyphChart3dCornerOption,
  GlyphChart3dGuideOptions,
  GlyphChart3dSurfaceRecord,
} from "./types";

export interface GlyphChart3dBarsChannels {
  readonly x?: GlyphChart3dChannelValue;
  readonly y?: GlyphChart3dChannelValue;
  readonly z?: GlyphChart3dChannelValue;
  readonly xLabel?: GlyphChart3dChannelValue;
  readonly yLabel?: GlyphChart3dChannelValue;
}

export interface GlyphChart3dBarsOptions {
  readonly aspect?: readonly [number, number, number];
  readonly colorscale?: GlyphChart3dColorscale;
  readonly bands?: number;
  readonly color?: "auto" | "none";
  /** Fraction of the tightest neighbour spacing each bar's own footprint occupies. Default `0.7`. */
  readonly barWidth?: number;
  readonly axes?: {
    readonly x?: GlyphChart3dAxisOptions;
    readonly y?: GlyphChart3dAxisOptions;
    readonly z?: GlyphChart3dAxisOptions;
    readonly corner?: GlyphChart3dCornerOption;
    /** C7: a shared axis colour every axis's own `color` overrides. */
    readonly color?: string;
  };
  readonly guides?: GlyphChart3dGuideOptions;
}

function resolveChannel(record: GlyphChart3dSurfaceRecord, index: number, value: GlyphChart3dChannelValue | undefined, fallbackField: string): unknown {
  if (value === undefined) return record[fallbackField];
  if (typeof value === "function") return value(record, index);
  return record[value];
}
function fieldName(value: GlyphChart3dChannelValue | undefined, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}
function finiteOrThrow(v: unknown, context: string): number {
  const n = typeof v === "number" ? v : NaN;
  if (!Number.isFinite(n)) chart3dError("non-finite-data", `${context} must be a finite number, got ${JSON.stringify(v)}.`);
  return n;
}

/** The tightest gap between any two DISTINCT sorted values — the natural "how close can two bars be" unit. `undefined` when there's only one distinct value. */
function tightestGap(values: readonly number[]): number | undefined {
  const distinct = [...new Set(values)].sort((a, b) => a - b);
  if (distinct.length < 2) return undefined;
  let min = Infinity;
  for (let i = 1; i < distinct.length; i++) min = Math.min(min, distinct[i]! - distinct[i - 1]!);
  return min;
}

export function glyphChartBars3d(
  data: readonly GlyphChart3dSurfaceRecord[],
  channels: GlyphChart3dBarsChannels = {},
  options: GlyphChart3dBarsOptions = {},
): GlyphChart3dBarsMark {
  if (!Array.isArray(data) || data.length === 0) chart3dError("bars-empty", "Bar data must be a non-empty array of bars.");

  const resolved = data.map((record, i) => ({
    x: finiteOrThrow(resolveChannel(record, i, channels.x, "x"), `record[${i}].x`),
    y: finiteOrThrow(resolveChannel(record, i, channels.y, "y"), `record[${i}].y`),
    z: finiteOrThrow(resolveChannel(record, i, channels.z, "z"), `record[${i}].z`),
    xLabel: channels.xLabel !== undefined ? resolveChannel(record, i, channels.xLabel, "xLabel") : undefined,
    yLabel: channels.yLabel !== undefined ? resolveChannel(record, i, channels.yLabel, "yLabel") : undefined,
  }));

  const aspect = resolveAspect(options.aspect);
  const colorOption = options.color ?? "auto";
  if (colorOption !== "auto" && colorOption !== "none") chart3dError("bad-options", `color must be "auto" or "none", got ${JSON.stringify(colorOption)}.`);
  const bands = options.bands === undefined ? 9 : options.bands;
  if (!Number.isInteger(bands) || bands < 1) chart3dError("bad-options", `bands must be a positive integer, got ${JSON.stringify(options.bands)}.`);
  const barWidthFraction = options.barWidth ?? 0.7;
  if (typeof barWidthFraction !== "number" || !Number.isFinite(barWidthFraction) || barWidthFraction <= 0 || barWidthFraction > 1) {
    chart3dError("bad-options", `barWidth must be a finite number in (0, 1], got ${JSON.stringify(options.barWidth)}.`);
  }

  let colorLegend: GlyphChart3dBarsMark["colorLegend"] = null;
  if (colorOption !== "none") {
    const values = resolved.map((r) => r.z);
    const min = Math.min(0, ...values), max = Math.max(...values);
    const domain: readonly [number, number] = min === max ? [min - 1, max + 1] : [min, max];
    colorLegend = { anchors: resolveGlyphChart3dColorscaleAnchors(options.colorscale), bands, domain };
  }

  const xGap = tightestGap(resolved.map((r) => r.x));
  const yGap = tightestGap(resolved.map((r) => r.y));
  const xSpan = Math.max(...resolved.map((r) => r.x)) - Math.min(...resolved.map((r) => r.x)) || 1;
  const ySpan = Math.max(...resolved.map((r) => r.y)) - Math.min(...resolved.map((r) => r.y)) || 1;
  const barHalfWidth: readonly [number, number] = [
    ((xGap ?? xSpan / 2) * barWidthFraction) / 2,
    ((yGap ?? ySpan / 2) * barWidthFraction) / 2,
  ];

  const bars: GlyphChart3dBar[] = resolved.map((r) => ({
    x: r.x, y: r.y, z: r.z,
    ...(r.xLabel !== undefined ? { xLabel: String(r.xLabel) } : {}),
    ...(r.yLabel !== undefined ? { yLabel: String(r.yLabel) } : {}),
  }));

  const axesOptions = options.axes;
  const xTitle = fieldName(channels.x, "x"), yTitle = fieldName(channels.y, "y"), zTitle = fieldName(channels.z, "z");
  // The z axis (and its colour legend, and the mesh below) must include 0 —
  // a bar's own height is drawn from the floor up, so an all-positive
  // dataset whose domain excluded 0 would draw every bar floating.
  const zValues = [0, ...bars.map((b) => b.z)];
  const axes = {
    x: resolveAxis(bars.map((b) => b.x), axesOptions?.x?.title !== undefined ? axesOptions.x.title : xTitle, axesOptions?.x),
    y: resolveAxis(bars.map((b) => b.y), axesOptions?.y?.title !== undefined ? axesOptions.y.title : yTitle, axesOptions?.y),
    z: resolveAxis(zValues, axesOptions?.z?.title !== undefined ? axesOptions.z.title : zTitle, axesOptions?.z),
  };

  const report: GlyphChart3dBuildReport = { ledger: [] };
  return {
    type: "bars3d",
    bars,
    barHalfWidth,
    colorLegend,
    aspect,
    axes,
    corner: resolveCorner(axesOptions?.corner),
    guides: resolveGuides(options.guides),
    axesColor: resolveAxesColor(axesOptions?.color),
    report,
  };
}
