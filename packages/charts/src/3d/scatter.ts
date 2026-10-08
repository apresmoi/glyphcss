/**
 * `glyphChartScatter3d` — points in 3-space (PLAN-3d.md C5, "3D scatter").
 * Pure model step, mirroring `glyphChartSurface`'s own split: no mesh, no
 * scene — `object.ts`'s `glyphChartObject` consumes the resolved mark.
 */
import { chart3dError } from "./validate";
import { resolveGlyphChart3dColorscaleAnchors, glyphChart3dBandIndex } from "./colorscale";
import { resolveAspect, resolveAxesColor, resolveAxis, resolveCorner, resolveGuides } from "./axisTriadShared";
import type {
  GlyphChart3dAxisOptions,
  GlyphChart3dBuildReport,
  GlyphChart3dChannelValue,
  GlyphChart3dColorscale,
  GlyphChart3dCornerOption,
  GlyphChart3dGuideOptions,
  GlyphChart3dScatterMark,
  GlyphChart3dScatterPoint,
  GlyphChart3dScatterSeriesEntry,
  GlyphChart3dSurfaceRecord,
} from "./types";

/** A small, fixed categorical palette — series colour when `color: "none"` is not set. Deliberately NOT the root package's own series palette (a different vocabulary, a different consumer); kept local and simple. Shared with `line3d.ts`. */
export const GLYPH_CHART_3D_SERIES_PALETTE = ["#4c78a8", "#f58518", "#54a24b", "#e45756", "#72b7b2", "#eeca3b", "#b279a2", "#ff9da6"];
/** Cycled ONLY under `color: "none"` — object.ts's own doc. */
const SERIES_SHAPES = ["cube", "octahedron", "tetrahedron", "icosahedron"] as const;

export interface GlyphChart3dScatterChannels {
  readonly x?: GlyphChart3dChannelValue;
  readonly y?: GlyphChart3dChannelValue;
  readonly z?: GlyphChart3dChannelValue;
  /** Categorical — mutually exclusive with `color`. */
  readonly series?: GlyphChart3dChannelValue;
  /** Continuous — mutually exclusive with `series`; drives a colorscale + colorbar. */
  readonly color?: GlyphChart3dChannelValue;
  /** Continuous — scales each point's own marker size between 0.5x and 2x `options.markerSize`. */
  readonly size?: GlyphChart3dChannelValue;
}

export interface GlyphChart3dScatterOptions {
  readonly aspect?: readonly [number, number, number];
  readonly colorscale?: GlyphChart3dColorscale;
  readonly bands?: number;
  readonly color?: "auto" | "none";
  /** Base object-space marker half-size. Default `0.035`. */
  readonly markerSize?: number;
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

const DEFAULT_MARKER_SIZE = 0.035;

export function glyphChartScatter3d(
  data: readonly GlyphChart3dSurfaceRecord[],
  channels: GlyphChart3dScatterChannels = {},
  options: GlyphChart3dScatterOptions = {},
): GlyphChart3dScatterMark {
  if (!Array.isArray(data) || data.length === 0) chart3dError("scatter-empty", "Scatter data must be a non-empty array of points.");
  if (channels.series !== undefined && channels.color !== undefined) {
    chart3dError("scatter-bad-channel", "channels.series and channels.color are mutually exclusive — a point is coloured by ONE of a category or a continuous value, never both.");
  }

  const resolved = data.map((record, i) => ({
    x: finiteOrThrow(resolveChannel(record, i, channels.x, "x"), `record[${i}].x`),
    y: finiteOrThrow(resolveChannel(record, i, channels.y, "y"), `record[${i}].y`),
    z: finiteOrThrow(resolveChannel(record, i, channels.z, "z"), `record[${i}].z`),
    seriesRaw: channels.series !== undefined ? resolveChannel(record, i, channels.series, "series") : undefined,
    colorRaw: channels.color !== undefined ? resolveChannel(record, i, channels.color, "color") : undefined,
    sizeRaw: channels.size !== undefined ? resolveChannel(record, i, channels.size, "size") : undefined,
  }));

  const aspect = resolveAspect(options.aspect);
  const colorOption = options.color ?? "auto";
  if (colorOption !== "auto" && colorOption !== "none") chart3dError("bad-options", `color must be "auto" or "none", got ${JSON.stringify(colorOption)}.`);

  const seriesNames: string[] = [];
  const seriesIndexOf = new Map<string, number>();
  if (channels.series !== undefined) {
    for (const r of resolved) {
      const name = String(r.seriesRaw);
      if (!seriesIndexOf.has(name)) { seriesIndexOf.set(name, seriesNames.length); seriesNames.push(name); }
    }
  }
  const series: GlyphChart3dScatterSeriesEntry[] = seriesNames.map((name, i) => ({
    name,
    color: GLYPH_CHART_3D_SERIES_PALETTE[i % GLYPH_CHART_3D_SERIES_PALETTE.length]!,
    shape: SERIES_SHAPES[i % SERIES_SHAPES.length]!,
  }));

  let colorLegend: GlyphChart3dScatterMark["colorLegend"] = null;
  let colorDomain: readonly [number, number] | null = null;
  const bands = options.bands === undefined ? 9 : options.bands;
  if (!Number.isInteger(bands) || bands < 1) chart3dError("bad-options", `bands must be a positive integer, got ${JSON.stringify(options.bands)}.`);
  if (channels.color !== undefined && colorOption !== "none") {
    const values = resolved.map((r, i) => finiteOrThrow(r.colorRaw, `record[${i}].color`));
    const min = Math.min(...values), max = Math.max(...values);
    colorDomain = min === max ? [min - 1, max + 1] : [min, max];
    colorLegend = { anchors: resolveGlyphChart3dColorscaleAnchors(options.colorscale), bands, domain: colorDomain };
  }

  let sizeMin = 0, sizeMax = 0, hasSize = false;
  if (channels.size !== undefined) {
    hasSize = true;
    const values = resolved.map((r, i) => finiteOrThrow(r.sizeRaw, `record[${i}].size`));
    sizeMin = Math.min(...values);
    sizeMax = Math.max(...values);
  }
  const baseMarkerSize = options.markerSize ?? DEFAULT_MARKER_SIZE;
  if (typeof baseMarkerSize !== "number" || !Number.isFinite(baseMarkerSize) || baseMarkerSize <= 0) {
    chart3dError("bad-options", `markerSize must be a positive finite number, got ${JSON.stringify(options.markerSize)}.`);
  }

  const points: GlyphChart3dScatterPoint[] = resolved.map((r) => {
    const seriesIndex = channels.series !== undefined ? seriesIndexOf.get(String(r.seriesRaw))! : -1;
    const colorValue = channels.color !== undefined && colorOption !== "none" ? finiteOrThrow(r.colorRaw, "color") : undefined;
    let markerSize = baseMarkerSize;
    if (hasSize) {
      const raw = finiteOrThrow(r.sizeRaw, "size");
      const t = sizeMax === sizeMin ? 0.5 : (raw - sizeMin) / (sizeMax - sizeMin);
      markerSize = baseMarkerSize * (0.5 + 1.5 * t);
    }
    return { x: r.x, y: r.y, z: r.z, seriesIndex, ...(colorValue !== undefined ? { colorValue } : {}), markerSize };
  });

  const axesOptions = options.axes;
  const xTitle = fieldName(channels.x, "x"), yTitle = fieldName(channels.y, "y"), zTitle = fieldName(channels.z, "z");
  const axes = {
    x: resolveAxis(points.map((p) => p.x), axesOptions?.x?.title !== undefined ? axesOptions.x.title : xTitle, axesOptions?.x),
    y: resolveAxis(points.map((p) => p.y), axesOptions?.y?.title !== undefined ? axesOptions.y.title : yTitle, axesOptions?.y),
    z: resolveAxis(points.map((p) => p.z), axesOptions?.z?.title !== undefined ? axesOptions.z.title : zTitle, axesOptions?.z),
  };

  const report: GlyphChart3dBuildReport = { ledger: [] };
  return {
    type: "scatter3d",
    points,
    series,
    colorLegend,
    aspect,
    axes,
    corner: resolveCorner(axesOptions?.corner),
    guides: resolveGuides(options.guides),
    axesColor: resolveAxesColor(axesOptions?.color),
    report,
  };
}
