/**
 * `glyphChartSurface` — validates and resolves a `z(x, y)` grid into a
 * `GlyphChart3dSurfaceMark` (PLAN-3d.md §5 "Surface: z(x, y)"). Pure model
 * step: no mesh, no overlay, no scene — `object.ts`'s `glyphChartObject`
 * consumes the result.
 */
import { scaleLinear } from "d3-scale";
import { format as d3format } from "d3-format";
import { chart3dError } from "./validate";
import { resolveGlyphChart3dColorscaleAnchors } from "./colorscale";
import { ledgerSurfaceDecimated } from "./ledger";
import type {
  GlyphChart3dAxisOptions,
  GlyphChart3dBuildReport,
  GlyphChart3dChannelValue,
  GlyphChart3dCornerOption,
  GlyphChart3dGuideOptions,
  GlyphChart3dResolvedAxis,
  GlyphChart3dResolvedGuides,
  GlyphChart3dSurfaceChannels,
  GlyphChart3dSurfaceData,
  GlyphChart3dSurfaceGridData,
  GlyphChart3dSurfaceMark,
  GlyphChart3dSurfaceOptions,
  GlyphChart3dSurfaceRecord,
} from "./types";

/** `axes.corner` — `"auto"` (default) or an explicit `[0|1,0|1,0|1]` triple/named corner shorthand. */
const CORNER_NAMES: Record<string, readonly [0 | 1, 0 | 1, 0 | 1]> = {
  "x0-y0-z0": [0, 0, 0], "x1-y0-z0": [1, 0, 0], "x1-y1-z0": [1, 1, 0], "x0-y1-z0": [0, 1, 0],
  "x0-y0-z1": [0, 0, 1], "x1-y0-z1": [1, 0, 1], "x1-y1-z1": [1, 1, 1], "x0-y1-z1": [0, 1, 1],
};

function resolveCorner(option: GlyphChart3dCornerOption | keyof typeof CORNER_NAMES | undefined): GlyphChart3dCornerOption {
  if (option === undefined || option === "auto") return "auto";
  if (typeof option === "string") {
    const named = CORNER_NAMES[option];
    if (named === undefined) chart3dError("bad-options", `axes.corner must be "auto", a [0|1,0|1,0|1] triple, or one of ${Object.keys(CORNER_NAMES).join(", ")}, got ${JSON.stringify(option)}.`);
    return named!;
  }
  if (
    Array.isArray(option) && option.length === 3
    && option.every((b) => b === 0 || b === 1)
  ) {
    return option as GlyphChart3dCornerOption;
  }
  chart3dError("bad-options", `axes.corner must be "auto" or a [0|1,0|1,0|1] triple, got ${JSON.stringify(option)}.`);
}

function resolveGuides(options: GlyphChart3dGuideOptions | undefined): GlyphChart3dResolvedGuides {
  const g = options ?? {};
  for (const [key, value] of Object.entries(g)) {
    if (value !== undefined && typeof value !== "boolean") {
      chart3dError("bad-options", `guides.${key} must be a boolean, got ${JSON.stringify(value)}.`);
    }
  }
  return {
    axisLines: g.axisLines ?? true,
    ticks: g.ticks ?? true,
    tickLabels: g.tickLabels ?? true,
    titles: g.titles ?? true,
    // Fix round 5, Item 2 ("the wall grid is still a cage"): default FALSE
    // now (opt-in), not true. Measured ink share was already honest
    // (7-11% of the plot's own bounding box, well under the round-5 gate's
    // 15% cap — `render.test.ts`'s own regression test), so this was never
    // an ink-DENSITY defect; it was a visual-WEIGHT one — the coordinator's
    // own report ("a big dotted diamond... filling the whole upper half of
    // the frame... visually outweigh the data") and this round's own
    // side-by-side render (`docs/design/charts3d.md`'s "C2 fix round 5")
    // both read the SAME geometric wall-plane crosshatch as visually
    // dominant against a typical fixture's own data ink, even at a
    // technically-modest cell count — a few evenly-spaced lines across two
    // full guide planes still reads as a cage shape (a diamond, at this
    // library's own default oblique camera) the eye locks onto ahead of
    // the surface. Decided by LOOKING (the coordinator's own explicit
    // instruction), not by the ink metric alone: with the grid off, the
    // SAME two fixtures read as a clean oblique surface with axis
    // structure only — closer to matplotlib's own DEFAULT (panes with no
    // gridlines drawn unless the reader asks). `guides.grid: true` (or the
    // `floorGrid` companion) still works exactly as built for a caller who
    // wants the guide planes back.
    grid: g.grid ?? false,
    floorGrid: g.floorGrid ?? false,
    walls: g.walls ?? false,
    box: g.box ?? false,
  };
}

const PLAIN_FORMAT = d3format("~r");

function isGridData(data: GlyphChart3dSurfaceData): data is GlyphChart3dSurfaceGridData {
  return typeof data === "object" && data !== null && !Array.isArray(data) && Array.isArray((data as GlyphChart3dSurfaceGridData).z);
}

function finiteOrThrow(v: unknown, context: string): number {
  const n = typeof v === "number" ? v : NaN;
  if (!Number.isFinite(n)) chart3dError("non-finite-data", `${context} must be a finite number, got ${JSON.stringify(v)}.`);
  return n;
}

function resolveRecordChannel(record: GlyphChart3dSurfaceRecord, index: number, value: GlyphChart3dChannelValue | undefined, fallbackField: string): unknown {
  if (value === undefined) return record[fallbackField];
  if (typeof value === "function") return value(record, index);
  return record[value];
}

function fieldName(value: GlyphChart3dChannelValue | readonly number[] | undefined, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

interface ResolvedGrid {
  readonly z: number[][];
  readonly x: number[];
  readonly y: number[];
  readonly xTitle: string;
  readonly yTitle: string;
}

/**
 * Strictly-monotonic check for an explicit position vector (P1-3). A single
 * value (length 1, unreachable today since `cols`/`rows` >= 2, kept for
 * robustness) counts as ascending — there is no pair to disagree.
 */
function axisOrder(values: readonly number[], label: string): "asc" | "desc" {
  let asc = true, desc = true;
  for (let i = 1; i < values.length; i++) {
    if (values[i]! <= values[i - 1]!) asc = false;
    if (values[i]! >= values[i - 1]!) desc = false;
  }
  if (!asc && !desc) {
    chart3dError("surface-axis-unsorted", `channels.${label} must be strictly monotonic (ascending or descending), got ${JSON.stringify(values)}.`);
  }
  return asc ? "asc" : "desc";
}

function resolveGridShape(data: GlyphChart3dSurfaceGridData, channels: GlyphChart3dSurfaceChannels): ResolvedGrid {
  const rows = data.z.length;
  if (rows > 0 && !Array.isArray(data.z[0])) {
    chart3dError("surface-ragged", `z[0] must be an array of numbers, got ${JSON.stringify(data.z[0])}.`);
  }
  const cols = rows > 0 ? (data.z[0] as readonly number[]).length : 0;
  if (rows < 2 || cols < 2) chart3dError("surface-too-small", `A surface needs at least a 2x2 z grid, got ${rows}x${cols}.`);
  const z: number[][] = [];
  for (let r = 0; r < rows; r++) {
    const row = data.z[r];
    if (!Array.isArray(row)) chart3dError("surface-ragged", `z[${r}] must be an array of numbers, got ${JSON.stringify(row)}.`);
    if (row.length !== cols) chart3dError("surface-ragged", `z[${r}] has ${row.length} values; z[0] has ${cols}. Every row must have the same length.`);
    z.push(row.map((v, c) => finiteOrThrow(v, `z[${r}][${c}]`)));
  }
  const xArr = Array.isArray(channels.x) ? channels.x : undefined;
  const yArr = Array.isArray(channels.y) ? channels.y : undefined;
  const x = xArr ? xArr.map((v, i) => finiteOrThrow(v, `x[${i}]`)) : Array.from({ length: cols }, (_, c) => c);
  const y = yArr ? yArr.map((v, i) => finiteOrThrow(v, `y[${i}]`)) : Array.from({ length: rows }, (_, r) => r);
  if (x.length !== cols) chart3dError("bad-options", `channels.x must have ${cols} entries (one per z column), got ${x.length}.`);
  if (y.length !== rows) chart3dError("bad-options", `channels.y must have ${rows} entries (one per z row), got ${y.length}.`);
  // An explicit position vector may legitimately be given in DESCENDING
  // order (Plotly allows it) — normalized here by reversing it and the
  // matching z columns/rows, rather than letting a descending vector invert
  // the mesh's winding (P1-3: `gridSurfacePolygons` assumes increasing
  // order, so a descending vector culls the whole surface under
  // single-sided rendering). A default (no explicit vector) is always
  // ascending by construction and skips this check entirely.
  if (xArr && axisOrder(x, "x") === "desc") {
    x.reverse();
    for (const row of z) row.reverse();
  }
  if (yArr && axisOrder(y, "y") === "desc") {
    y.reverse();
    z.reverse();
  }
  return { z, x, y, xTitle: "", yTitle: "" };
}

function resolveLongRowShape(data: readonly GlyphChart3dSurfaceRecord[], channels: GlyphChart3dSurfaceChannels): ResolvedGrid {
  if (data.length === 0) chart3dError("surface-not-gridded", "Surface data must be non-empty.");
  const xChannel = Array.isArray(channels.x) ? undefined : (channels.x as GlyphChart3dChannelValue | undefined);
  const yChannel = Array.isArray(channels.y) ? undefined : (channels.y as GlyphChart3dChannelValue | undefined);
  const xTitle = fieldName(xChannel, "x");
  const yTitle = fieldName(yChannel, "y");
  const resolved = data.map((record, i) => ({
    x: finiteOrThrow(resolveRecordChannel(record, i, xChannel, "x"), `record[${i}].x`),
    y: finiteOrThrow(resolveRecordChannel(record, i, yChannel, "y"), `record[${i}].y`),
    z: finiteOrThrow(resolveRecordChannel(record, i, channels.z, "z"), `record[${i}].z`),
  }));
  const xs = [...new Set(resolved.map((r) => r.x))].sort((a, b) => a - b);
  const ys = [...new Set(resolved.map((r) => r.y))].sort((a, b) => a - b);
  if (xs.length < 2 || ys.length < 2) {
    chart3dError("surface-not-gridded", `Surface data must cover at least 2 distinct x values and 2 distinct y values, got ${xs.length}x${ys.length}.`);
  }
  const xIndex = new Map(xs.map((v, i) => [v, i]));
  const yIndex = new Map(ys.map((v, i) => [v, i]));
  const z: (number | undefined)[][] = Array.from({ length: ys.length }, () => new Array(xs.length).fill(undefined));
  let filled = 0;
  for (const r of resolved) {
    const ci = xIndex.get(r.x)!;
    const ri = yIndex.get(r.y)!;
    if (z[ri]![ci] !== undefined) chart3dError("surface-ragged", `Duplicate (x=${r.x}, y=${r.y}) cell in surface data.`);
    z[ri]![ci] = r.z;
    filled++;
  }
  if (filled !== xs.length * ys.length) {
    chart3dError("surface-ragged", `Surface data covers ${filled} of ${xs.length * ys.length} (x, y) cells — every combination must be present exactly once.`);
  }
  return { z: z as number[][], x: xs, y: ys, xTitle, yTitle };
}

function resolveAspect(aspect: GlyphChart3dSurfaceOptions["aspect"]): readonly [number, number, number] {
  // Fix round 2, P1-a: the prior [1,1,0.6] left the plot-only (colorbar-
  // excluded) footprint at ~19-23% of the frame at the default camera —
  // wide of the P1-a target (>=45%) — because a row-BOUND fit (the ROW
  // constraint, not columns, binds the auto-fit's own zoom at the default
  // pitch) leaves most of the generous column budget unused. Widening x/y
  // spreads the SAME row-bound zoom across more columns, measured (real
  // renderer, volcano fixture, 100x34, a colorbar + title reserved) to
  // clear the target with margin (0.459) at the DEFAULT camera below.
  if (aspect === undefined) return [1.3, 1.3, 0.6];
  if (!Array.isArray(aspect) || aspect.length !== 3 || aspect.some((v) => typeof v !== "number" || !Number.isFinite(v) || v <= 0)) {
    chart3dError("bad-options", `aspect must be 3 positive finite numbers [x, y, z], got ${JSON.stringify(aspect)}.`);
  }
  return [aspect[0]!, aspect[1]!, aspect[2]!];
}

function resolveBands(bands: number | undefined): number {
  if (bands === undefined) return 9;
  if (!Number.isInteger(bands) || bands < 1) chart3dError("bad-options", `bands must be a positive integer, got ${JSON.stringify(bands)}.`);
  return bands;
}

function resolveMaxQuads(value: number | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || value < 1) chart3dError("bad-options", `${name} must be a positive integer, got ${JSON.stringify(value)}.`);
  return value;
}

function resolveAxis(values: readonly number[], defaultTitle: string, options: GlyphChart3dAxisOptions | undefined): GlyphChart3dResolvedAxis {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const domain: [number, number] = min === max ? [min - 1, max + 1] : [min, max];
  const scale = scaleLinear().domain(domain).nice();
  const requested = options?.ticks;
  if (requested !== undefined && (!Number.isInteger(requested) || requested < 1)) {
    chart3dError("bad-options", `axes ticks must be a positive integer, got ${JSON.stringify(requested)}.`);
  }
  const ticks = scale.ticks(requested ?? 5);
  const title = options?.title !== undefined ? options.title : defaultTitle;
  return {
    title,
    domain: scale.domain() as [number, number],
    ticks,
    tickLabels: ticks.map((t) => PLAIN_FORMAT(t)),
  };
}

/**
 * Validates and resolves surface data into a `GlyphChart3dSurfaceMark`.
 * `data` is either the Plotly grid shape (`{ z }`, with optional `x`/`y`
 * position vectors via `channels`) or long rows that must cover a complete
 * rectangular `(x, y)` grid exactly once.
 */
export function glyphChartSurface(
  data: GlyphChart3dSurfaceData,
  channels: GlyphChart3dSurfaceChannels = {},
  options: GlyphChart3dSurfaceOptions = {},
): GlyphChart3dSurfaceMark {
  const resolved = isGridData(data) ? resolveGridShape(data, channels) : resolveLongRowShape(data, channels);
  const aspect = resolveAspect(options.aspect);
  const bands = resolveBands(options.bands);
  // NOT defaulted here (fix round 1, P1-3): §5 requires `shading: "value"`
  // by default under `color: "none"`/NO_COLOR, and this model-build step has
  // no visibility into the eventual render's own colour mode — that
  // decision belongs to whoever DOES, `renderGlyphChart3d` (`render.ts`'s
  // own `resolveMarkShading`). Leaving `shading` `undefined` when the caller
  // never named one (rather than baking in "relief" here) is what makes
  // that downstream default possible at all; every OTHER consumer of a mark
  // (`glyphChartObject` mounted directly into a live scene, where "colour
  // mode" is a meaningless concept — a real scene always has full colour
  // capability) still reads an undefined `shading` as `"relief"`, its own
  // unchanged default.
  const shading = options.shading;
  if (shading !== undefined && shading !== "relief" && shading !== "value") {
    chart3dError("bad-options", `shading must be "relief" or "value", got ${JSON.stringify(shading)}.`);
  }
  const colorOption = options.color ?? "auto";
  if (colorOption !== "auto" && colorOption !== "none") chart3dError("bad-options", `color must be "auto" or "none", got ${JSON.stringify(colorOption)}.`);
  const colorAnchors = colorOption === "none" ? null : resolveGlyphChart3dColorscaleAnchors(options.colorscale);
  const maxQuadsX = resolveMaxQuads(options.maxQuadsX, "maxQuadsX");
  const maxQuadsY = resolveMaxQuads(options.maxQuadsY, "maxQuadsY");

  const flatZ = resolved.z.flat();
  const zDomain: [number, number] = [Math.min(...flatZ), Math.max(...flatZ)];

  const axesOptions = options.axes;
  const axes = {
    x: resolveAxis(resolved.x, axesOptions?.x?.title !== undefined ? axesOptions.x.title : resolved.xTitle, axesOptions?.x),
    y: resolveAxis(resolved.y, axesOptions?.y?.title !== undefined ? axesOptions.y.title : resolved.yTitle, axesOptions?.y),
    z: resolveAxis(flatZ, axesOptions?.z?.title !== undefined ? axesOptions.z.title : "z", axesOptions?.z),
  };

  const corner = resolveCorner(axesOptions?.corner);
  const guides = resolveGuides(options.guides);

  const rows = resolved.z.length;
  const cols = resolved.z[0]!.length;
  const report: GlyphChart3dBuildReport = { ledger: [] };
  const keptRows = maxQuadsY !== undefined ? Math.max(2, Math.min(rows, maxQuadsY + 1)) : rows;
  const keptCols = maxQuadsX !== undefined ? Math.max(2, Math.min(cols, maxQuadsX + 1)) : cols;
  if (keptRows !== rows || keptCols !== cols) {
    report.ledger.push(ledgerSurfaceDecimated({ sourceRows: rows, sourceCols: cols, keptRows, keptCols }));
  }

  return {
    type: "surface",
    grid: { z: resolved.z, x: resolved.x, y: resolved.y },
    zDomain,
    aspect,
    bands,
    colorAnchors,
    shading,
    maxQuadsX,
    maxQuadsY,
    axes,
    corner,
    guides,
    report,
  };
}
