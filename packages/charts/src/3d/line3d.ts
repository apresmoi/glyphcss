/**
 * `glyphChartLine3d` — one or more ordered 3D polylines (a trajectory, a
 * helix), drawn as ribbon geometry (PLAN-3d.md C5). Accepts either a bare
 * array of `[x, y, z]` points (one unnamed series — the `renderGlyphChart`
 * root's own `number[]` shorthand, extended to 3D) or an array of named
 * series, each an ordered point list.
 */
import { chart3dError } from "./validate";
import { resolveAspect, resolveAxis, resolveCorner, resolveGuides } from "./axisTriadShared";
import { GLYPH_CHART_3D_SERIES_PALETTE } from "./scatter";
import type {
  GlyphChart3dBuildReport,
  GlyphChart3dCornerOption,
  GlyphChart3dGuideOptions,
  GlyphChart3dLineMark,
  GlyphChart3dLineSeriesEntry,
} from "./types";

export type GlyphChart3dPoint3 = readonly [number, number, number];
export interface GlyphChart3dLineSeriesInput {
  readonly name?: string;
  readonly color?: string;
  readonly points: readonly GlyphChart3dPoint3[];
}
export type GlyphChart3dLineInput = readonly GlyphChart3dPoint3[] | readonly GlyphChart3dLineSeriesInput[];

export interface GlyphChart3dLineOptions {
  readonly aspect?: readonly [number, number, number];
  readonly axes?: {
    readonly x?: { readonly title?: string; readonly ticks?: number };
    readonly y?: { readonly title?: string; readonly ticks?: number };
    readonly z?: { readonly title?: string; readonly ticks?: number };
    readonly corner?: GlyphChart3dCornerOption;
  };
  readonly guides?: GlyphChart3dGuideOptions;
}

function isFlatPointList(data: GlyphChart3dLineInput): data is readonly GlyphChart3dPoint3[] {
  return data.length === 0 || Array.isArray(data[0]) && typeof (data[0] as readonly unknown[])[0] === "number";
}

function checkPoint(p: unknown, context: string): GlyphChart3dPoint3 {
  if (!Array.isArray(p) || p.length !== 3 || p.some((v) => typeof v !== "number" || !Number.isFinite(v))) {
    chart3dError("non-finite-data", `${context} must be a finite [x, y, z] triple, got ${JSON.stringify(p)}.`);
  }
  return [p[0] as number, p[1] as number, p[2] as number];
}

export function glyphChartLine3d(data: GlyphChart3dLineInput, options: GlyphChart3dLineOptions = {}): GlyphChart3dLineMark {
  if (!Array.isArray(data) || data.length === 0) chart3dError("line3d-empty", "Line data must be a non-empty array of points, or an array of named series each with 2+ points.");

  const inputSeries: readonly GlyphChart3dLineSeriesInput[] = isFlatPointList(data)
    ? [{ points: data }]
    : (data as readonly GlyphChart3dLineSeriesInput[]);

  const series: GlyphChart3dLineSeriesEntry[] = inputSeries.map((s, si) => {
    if (!Array.isArray(s.points) || s.points.length < 2) {
      chart3dError("line3d-too-short", `series[${si}] needs at least 2 points, got ${Array.isArray(s.points) ? s.points.length : 0}.`);
    }
    const points = s.points.map((p, pi) => checkPoint(p, `series[${si}].points[${pi}]`));
    return {
      name: s.name ?? `series ${si + 1}`,
      color: s.color ?? GLYPH_CHART_3D_SERIES_PALETTE[si % GLYPH_CHART_3D_SERIES_PALETTE.length]!,
      points,
    };
  });

  const aspect = resolveAspect(options.aspect);
  const allPoints = series.flatMap((s) => s.points);
  const axesOptions = options.axes;
  const axes = {
    x: resolveAxis(allPoints.map((p) => p[0]), axesOptions?.x?.title ?? "x", axesOptions?.x),
    y: resolveAxis(allPoints.map((p) => p[1]), axesOptions?.y?.title ?? "y", axesOptions?.y),
    z: resolveAxis(allPoints.map((p) => p[2]), axesOptions?.z?.title ?? "z", axesOptions?.z),
  };

  const report: GlyphChart3dBuildReport = { ledger: [] };
  return {
    type: "line3d",
    series,
    aspect,
    axes,
    corner: resolveCorner(axesOptions?.corner),
    guides: resolveGuides(options.guides),
    report,
  };
}

/** A Lorenz attractor trajectory, integrated with a fixed-step Euler method — a computed, labelled EXAMPLE (`docs/design/charts3d.md`'s "C5"), not vendored data. Classic parameters `sigma=10, rho=28, beta=8/3`. */
export function glyphChart3dLorenzAttractor(steps = 4000, dt = 0.008): readonly GlyphChart3dPoint3[] {
  const sigma = 10, rho = 28, beta = 8 / 3;
  let x = 0.1, y = 0, z = 0;
  const points: GlyphChart3dPoint3[] = [[x, y, z]];
  for (let i = 0; i < steps; i++) {
    const dx = sigma * (y - x);
    const dy = x * (rho - z) - y;
    const dz = x * y - beta * z;
    x += dx * dt; y += dy * dt; z += dz * dt;
    points.push([x, y, z]);
  }
  return points;
}
