/**
 * `@glyphcss/charts/3d`'s public types (PLAN-3d.md §5 "Surface: z(x, y)",
 * packet C1). A `GlyphChart3dSurfaceMark` is the model-layer counterpart of
 * a 2D `GlyphChartMark`: it validates and resolves a `z(x, y)` grid into a
 * numeric grid, a colour band table, and 3 axis scales, with no rendering
 * of its own. `glyphChartObject()` (`object.ts`) turns one into a mounted
 * `GlyphSceneObject`.
 */
import type { GlyphChart3dLedgerEntry } from "./ledger";
export type { GlyphChart3dLedgerEntry };

/** Row-major `z` grid, the Plotly `surface` shape: `z[row][col]`. */
export interface GlyphChart3dSurfaceGridData {
  readonly z: readonly (readonly number[])[];
}

/** One long-format record — the alternative surface input shape. */
export type GlyphChart3dSurfaceRecord = Record<string, unknown>;

export type GlyphChart3dSurfaceData = GlyphChart3dSurfaceGridData | readonly GlyphChart3dSurfaceRecord[];

/** A channel accessor for the long-row input shape — a field name or a `(record, index) => value` function. */
export type GlyphChart3dChannelValue = string | ((record: GlyphChart3dSurfaceRecord, index: number) => unknown);

export interface GlyphChart3dSurfaceChannels {
  /**
   * Grid-shape input: an explicit column-position vector (length
   * `z[0].length`); default uniform. Long-row input: the x field/accessor
   * (default `"x"`).
   */
  readonly x?: readonly number[] | GlyphChart3dChannelValue;
  /** Same as `x`, for rows / the y field (default `"y"`). */
  readonly y?: readonly number[] | GlyphChart3dChannelValue;
  /** Long-row input only: the z field/accessor (default `"z"`). Ignored for grid-shape input (its `z` comes from `data.z`). */
  readonly z?: GlyphChart3dChannelValue;
}

export const GLYPH_CHART_3D_COLORSCALE_NAMES = ["viridis", "cividis", "magma", "greys"] as const;
export type GlyphChart3dColorscaleName = typeof GLYPH_CHART_3D_COLORSCALE_NAMES[number];
/** A named preset, or an ORDERED array of canonical `#rrggbb` anchors (custom colorscale — interpolated the same way a preset's own anchors are). */
export type GlyphChart3dColorscale = GlyphChart3dColorscaleName | readonly string[];

export interface GlyphChart3dAxisOptions {
  /** Defaults to the resolved field name where the channel is a plain string, following the 2D axis-title default rule; omit/`""` suppresses it. */
  readonly title?: string;
  /** Requested tick count — `d3-scale`'s own `.ticks(n)`, like a 2D axis. Default 5. */
  readonly ticks?: number;
}

export interface GlyphChart3dSurfaceOptions {
  /** `[x, y, z]` visual compression baked into the mesh's own object-space coordinates. Default `[1, 1, 0.6]`. */
  readonly aspect?: readonly [number, number, number];
  /** Default `"viridis"`. */
  readonly colorscale?: GlyphChart3dColorscale;
  /** Colour band count — quantizes the z domain, following the 2D `cell` mark's own quantized-shade discipline. Default 9. */
  readonly bands?: number;
  /**
   * `"relief"` (default): the mesh carries banded colour and the host
   * scene's own Lambert shading does the rest — glyph SHAPE reads slope,
   * colour reads value. `"value"` (a monochrome/`color: "none"` analogue
   * of 2D `regionFill`'s glyph-carries-identity rule) is a C2/rendering
   * concern — accepted here for forward JSON/schema compatibility but not
   * yet wired to any different mesh; see `docs/design/charts3d.md`.
   */
  readonly shading?: "relief" | "value";
  /** `"none"` drops all per-quad colour (uncoloured polygons — the scene's default gray, Lambert-shaded). Default `"auto"` (colorscale banding on). */
  readonly color?: "auto" | "none";
  /** Maximum QUADS kept along the x/y axis after decimation (vertices = this + 1). Omit for no cap — the model still ALWAYS keeps the argmax/argmin row and column when a cap does apply. */
  readonly maxQuadsX?: number;
  readonly maxQuadsY?: number;
  readonly axes?: {
    readonly x?: GlyphChart3dAxisOptions;
    readonly y?: GlyphChart3dAxisOptions;
    readonly z?: GlyphChart3dAxisOptions;
  };
}

export interface GlyphChart3dResolvedAxis {
  readonly title: string;
  readonly domain: readonly [number, number];
  readonly ticks: readonly number[];
  /** `d3-format`'s own `"~r"` — a plain, non-abbreviated numeric label per tick, matching the tick's own index in `ticks`. */
  readonly tickLabels: readonly string[];
}

/** A resolved, validated surface model — everything `glyphChartObject` needs, and nothing it has to re-derive. */
export interface GlyphChart3dSurfaceMark {
  readonly type: "surface";
  readonly grid: {
    /** Numeric, rectangular, finite — `z[row][col]`. */
    readonly z: readonly (readonly number[])[];
    /** Column positions in DATA units, length `z[0].length`. */
    readonly x: readonly number[];
    /** Row positions in DATA units, length `z.length`. */
    readonly y: readonly number[];
  };
  readonly zDomain: readonly [number, number];
  readonly aspect: readonly [number, number, number];
  readonly bands: number;
  /** `null` when `options.color === "none"`. */
  readonly colorAnchors: readonly string[] | null;
  readonly shading: "relief" | "value";
  readonly maxQuadsX?: number;
  readonly maxQuadsY?: number;
  readonly axes: {
    readonly x: GlyphChart3dResolvedAxis;
    readonly y: GlyphChart3dResolvedAxis;
    readonly z: GlyphChart3dResolvedAxis;
  };
  readonly report: GlyphChart3dBuildReport;
}

/** A 3D chart mark — a union of one member today; `scatter3d` (C5) joins it later. */
export type GlyphChart3dMark = GlyphChart3dSurfaceMark;

export interface GlyphChart3dObjectOptions {
  /** Stable object id — default `"surface"`. Two surfaces in one scene need distinct ids (`scene.addObject`'s own uniqueness rule). */
  readonly id?: string;
}

export interface GlyphChart3dBuildReport {
  readonly ledger: GlyphChart3dLedgerEntry[];
}
