/**
 * `glyphChartParametric3d` — a `(u, v)`-parametrized surface from
 * PRECOMPUTED `x`/`y`/`z` grids (PLAN-3d.md C5, "spheres, tori, Möbius
 * strips"). Data-only by contract (a function has no JSON form — the doc's
 * own note): the TS API's own convenience wrappers for common shapes
 * (`glyphChart3dSphereGrid`/`glyphChart3dTorusGrid`) sample a function into
 * grids before calling this, so the model step itself never touches `Math.sin`.
 */
import { chart3dError } from "./validate";
import { resolveGlyphChart3dColorscaleAnchors } from "./colorscale";
import { resolveAspect, resolveAxesColor, resolveAxis, resolveCorner, resolveGuides } from "./axisTriadShared";
import type {
  GlyphChart3dAxisOptions,
  GlyphChart3dBuildReport,
  GlyphChart3dColorscale,
  GlyphChart3dCornerOption,
  GlyphChart3dGuideOptions,
  GlyphChart3dParametricGrid,
  GlyphChart3dParametricMark,
} from "./types";

export interface GlyphChart3dParametricInput {
  readonly x: readonly (readonly number[])[];
  readonly y: readonly (readonly number[])[];
  readonly z: readonly (readonly number[])[];
  /** Optional 4th scalar grid (same shape) driving colour instead of z. */
  readonly value?: readonly (readonly number[])[];
}

export interface GlyphChart3dParametricOptions {
  readonly aspect?: readonly [number, number, number];
  readonly colorscale?: GlyphChart3dColorscale;
  readonly bands?: number;
  readonly color?: "auto" | "none";
  /** Connect the last COLUMN back to column 0 (an azimuthal loop, e.g. a sphere's phi or a torus's major angle). Default `false`. */
  readonly wrapU?: boolean;
  /** Connect the last ROW back to row 0 (e.g. a torus's minor angle). Default `false`. */
  readonly wrapV?: boolean;
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

function checkGrid(grid: readonly (readonly number[])[], name: string, rows: number, cols: number): void {
  if (grid.length !== rows) chart3dError("parametric-ragged", `${name} must have ${rows} rows, got ${grid.length}.`);
  for (let r = 0; r < rows; r++) {
    const row = grid[r];
    if (!Array.isArray(row) || row.length !== cols) chart3dError("parametric-ragged", `${name}[${r}] must be an array of ${cols} numbers.`);
    for (let c = 0; c < cols; c++) {
      const v = row[c];
      if (typeof v !== "number" || !Number.isFinite(v)) chart3dError("non-finite-data", `${name}[${r}][${c}] must be a finite number, got ${JSON.stringify(v)}.`);
    }
  }
}

export function glyphChartParametric3d(
  data: GlyphChart3dParametricInput,
  options: GlyphChart3dParametricOptions = {},
): GlyphChart3dParametricMark {
  const rows = data.z?.length ?? 0;
  const cols = rows > 0 ? data.z[0]!.length : 0;
  const wrapU = Boolean(options.wrapU), wrapV = Boolean(options.wrapV);
  if ((rows < 2 && !wrapV) || (cols < 2 && !wrapU)) {
    chart3dError("parametric-too-small", `A parametric surface needs at least a 2x2 grid, got ${rows}x${cols} (wrapU=${wrapU}, wrapV=${wrapV}).`);
  }
  checkGrid(data.x, "x", rows, cols);
  checkGrid(data.y, "y", rows, cols);
  checkGrid(data.z, "z", rows, cols);
  if (data.value !== undefined) checkGrid(data.value, "value", rows, cols);

  const aspect = resolveAspect(options.aspect);
  const colorOption = options.color ?? "auto";
  if (colorOption !== "auto" && colorOption !== "none") chart3dError("bad-options", `color must be "auto" or "none", got ${JSON.stringify(colorOption)}.`);
  const bands = options.bands === undefined ? 9 : options.bands;
  if (!Number.isInteger(bands) || bands < 1) chart3dError("bad-options", `bands must be a positive integer, got ${JSON.stringify(options.bands)}.`);

  const flat = (g: readonly (readonly number[])[]) => g.flatMap((row) => row);
  const colourField = data.value ?? data.z;
  let colorLegend: GlyphChart3dParametricMark["colorLegend"] = null;
  if (colorOption !== "none") {
    const values = flat(colourField);
    const min = Math.min(...values), max = Math.max(...values);
    const domain: readonly [number, number] = min === max ? [min - 1, max + 1] : [min, max];
    colorLegend = { anchors: resolveGlyphChart3dColorscaleAnchors(options.colorscale), bands, domain };
  }

  const grid: GlyphChart3dParametricGrid = { x: data.x, y: data.y, z: data.z, ...(data.value ? { value: data.value } : {}), wrapU, wrapV };

  const axesOptions = options.axes;
  const axes = {
    x: resolveAxis(flat(data.x), axesOptions?.x?.title !== undefined ? axesOptions.x.title : "x", axesOptions?.x),
    y: resolveAxis(flat(data.y), axesOptions?.y?.title !== undefined ? axesOptions.y.title : "y", axesOptions?.y),
    z: resolveAxis(flat(data.z), axesOptions?.z?.title !== undefined ? axesOptions.z.title : "z", axesOptions?.z),
  };

  const report: GlyphChart3dBuildReport = { ledger: [] };
  return {
    type: "parametric3d",
    grid,
    colorLegend,
    aspect,
    axes,
    corner: resolveCorner(axesOptions?.corner),
    guides: resolveGuides(options.guides),
    axesColor: resolveAxesColor(axesOptions?.color),
    report,
  };
}

/** A UV-sampled sphere grid, radius `radius` (default 1), centred at the origin — `rows` latitude samples pole-to-pole (default 20), `cols` longitude samples around (default 32, wrapped). Convenience for `glyphChartParametric3d({ ...glyphChart3dSphereGrid(), value }, { wrapU: true })` — the TS-only function form the model itself can't take. */
export function glyphChart3dSphereGrid(radius = 1, rows = 20, cols = 32): { readonly x: number[][]; readonly y: number[][]; readonly z: number[][] } {
  const x: number[][] = [], y: number[][] = [], z: number[][] = [];
  for (let r = 0; r < rows; r++) {
    const theta = (Math.PI * r) / (rows - 1); // 0 (north pole) .. PI (south pole)
    const xr: number[] = [], yr: number[] = [], zr: number[] = [];
    for (let c = 0; c < cols; c++) {
      const phi = (2 * Math.PI * c) / cols; // [0, 2PI)
      xr.push(radius * Math.sin(theta) * Math.cos(phi));
      yr.push(radius * Math.sin(theta) * Math.sin(phi));
      zr.push(radius * Math.cos(theta));
    }
    x.push(xr); y.push(yr); z.push(zr);
  }
  return { x, y, z };
}

/** A UV-sampled torus grid — `majorRadius` (default 1.4) around the loop, `minorRadius` (default 0.5) of the tube, `rows` minor-angle samples (default 24, wrapped), `cols` major-angle samples (default 36, wrapped). */
export function glyphChart3dTorusGrid(majorRadius = 1.4, minorRadius = 0.5, rows = 24, cols = 36): { readonly x: number[][]; readonly y: number[][]; readonly z: number[][] } {
  const x: number[][] = [], y: number[][] = [], z: number[][] = [];
  for (let r = 0; r < rows; r++) {
    const v = (2 * Math.PI * r) / rows; // minor angle, wraps
    const xr: number[] = [], yr: number[] = [], zr: number[] = [];
    for (let c = 0; c < cols; c++) {
      const u = (2 * Math.PI * c) / cols; // major angle, wraps
      const rr = majorRadius + minorRadius * Math.cos(v);
      xr.push(rr * Math.cos(u));
      yr.push(rr * Math.sin(u));
      zr.push(minorRadius * Math.sin(v));
    }
    x.push(xr); y.push(yr); z.push(zr);
  }
  return { x, y, z };
}
