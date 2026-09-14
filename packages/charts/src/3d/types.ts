/**
 * `@glyphcss/charts/3d`'s public types (PLAN-3d.md §5 "Surface: z(x, y)",
 * packet C1). A `GlyphChart3dSurfaceMark` is the model-layer counterpart of
 * a 2D `GlyphChartMark`: it validates and resolves a `z(x, y)` grid into a
 * numeric grid, a colour band table, and 3 axis scales, with no rendering
 * of its own. `glyphChartObject()` (`object.ts`) turns one into a mounted
 * `GlyphSceneObject`.
 */
import type { GlyphChart3dLedgerEntry } from "./ledger";
import type { GlyphChartCharset } from "../types";
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

/** `0` = the box's own `0` coordinate on that axis, `1` = `aspect[axis]`. */
export type GlyphChart3dCornerBit = 0 | 1;
/** A box vertex (fix round 2's "axes in one corner" redesign — `object.ts`'s own `resolveSharedCorner` doc). */
export type GlyphChart3dCorner = readonly [GlyphChart3dCornerBit, GlyphChart3dCornerBit, GlyphChart3dCornerBit];
/**
 * `"auto"` (default): resolved per camera, every `stamp()` call. Round 6
 * (USER FEEDBACK — "cannot see the axes"): under `"auto"` the x/y axis
 * lines share ONE corner (the front floor edge, nearest the camera) while
 * the z axis resolves its OWN, independent corner (the silhouette vertical
 * edge) — `object.ts`'s `resolveAxisTriadCorners` doc has the full
 * rationale; pinning all three to one shared corner (round 2's original
 * design) could hide the whole triad behind a fully opaque surface. An
 * EXPLICIT `GlyphChart3dCorner` still pins all three axes to that one
 * corner, unchanged — only `"auto"` drops strict single-corner sharing.
 * `guides.walls`/`guides.box`/`guides.grid`/`floorGrid` are unaffected
 * either way — they still resolve ONE shared corner via
 * `object.ts`'s `resolveSharedCorner`, since they are meant to sit
 * behind the data as a backdrop.
 */
export type GlyphChart3dCornerOption = "auto" | GlyphChart3dCorner;

/**
 * Independent toggles over what the axis triad draws (fix round 2, message
 * 3B's "2D extended by one dimension" model — matches 2D's
 * `axes.{x,y}.{grid,tickMarks,title}` naming/style). `axisLines`/`ticks`/
 * `tickLabels`/`titles` default `true`; `walls` (the OTHER 6 edges of
 * the 3 guide planes meeting at the shared corner, i.e. the wall outline)
 * defaults `false` — the bare 3-line triad already reads as a plot block
 * without them; `box` (the remaining 3 far/near edges that complete a
 * 12-edge wireframe) defaults `false`. `axisLines + walls` is the
 * "near/guide" edge set (9 edges); `+ box` is the full 12-edge wireframe.
 *
 * `grid` and `floorGrid` split the 3 guide planes' own gridlines: `grid`
 * draws the 2 WALL planes (perpendicular to x/y, `planeGridLines`'s own
 * `fixedAxis` 0/1); `floorGrid` draws the z=const FLOOR plane (`fixedAxis`
 * 2). **Both default `false` as of fix round 5, Item 2** — round 4 first
 * split the two (floor off, walls on) after measuring the exposed floor
 * plane alone out-inking both walls combined at the coordinator's own
 * ring-ridge-plus-crater fixture; round 5's own coordinator report found
 * the WALL planes still read as "a big dotted diamond... filling the
 * whole upper half of the frame... visually outweigh the data" at that
 * SAME 96x32 fixture, even though the measured ink share was already a
 * modest 7-11% of the plot's own bounding box (well under this option's
 * own 15% regression cap, `render.test.ts`) — a genuinely LOW-density
 * grid across two FULL guide planes still reads as a cage shape (this
 * library's own default oblique camera projects it as a diamond) the eye
 * locks onto ahead of the surface, a visual-WEIGHT defect the ink metric
 * alone never measured. Decided by LOOKING, per the coordinator's own
 * explicit instruction — `docs/design/charts3d.md`'s "C2 fix round 5" has
 * the side-by-side frames: with the grid off, the SAME fixtures read as a
 * clean oblique surface with axis structure only, closer to matplotlib's
 * own default (no pane gridlines unless the reader asks). A caller who
 * wants the guide planes back sets `guides.grid`/`floorGrid: true`
 * explicitly — the mechanism (`planeGridLines`, the distinct faint glyph
 * family from `gridEdgeGlyph`, depth-tested against the real surface) is
 * unchanged, only the default flipped.
 */
export interface GlyphChart3dGuideOptions {
  readonly axisLines?: boolean;
  readonly ticks?: boolean;
  readonly tickLabels?: boolean;
  readonly titles?: boolean;
  readonly grid?: boolean;
  readonly floorGrid?: boolean;
  readonly walls?: boolean;
  readonly box?: boolean;
}

/** Every `GlyphChart3dGuideOptions` field resolved to a concrete boolean. */
export type GlyphChart3dResolvedGuides = Required<GlyphChart3dGuideOptions>;

export interface GlyphChart3dSurfaceOptions {
  /** `[x, y, z]` visual compression baked into the mesh's own object-space coordinates. Default `[1, 1, 0.6]`. */
  readonly aspect?: readonly [number, number, number];
  /** Default `"viridis"`. */
  readonly colorscale?: GlyphChart3dColorscale;
  /** Colour band count — quantizes the z domain, following the 2D `cell` mark's own quantized-shade discipline. Default 9. */
  readonly bands?: number;
  /**
   * `"relief"`: the mesh carries banded colour and the host scene's own
   * Lambert shading does the rest — glyph SHAPE reads slope, colour reads
   * value. `"value"` (a monochrome/`color: "none"` analogue of 2D
   * `regionFill`'s glyph-carries-identity rule) authors a per-triangle
   * grey-ramp texture instead, so glyph DENSITY reads z regardless of face
   * normal or light — see `object.ts`'s own doc. Omitted: `glyphChartObject`
   * (a live scene, always full colour) reads it as `"relief"`;
   * `renderGlyphChart3d` instead resolves ITS OWN default from the render's
   * colour mode (`"value"` under `color: "none"`/NO_COLOR, `"relief"`
   * otherwise) — the model step has no colour-mode visibility to default
   * from itself (fix round 1, P1-3).
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
    /** Explicit override for the shared axis-triad corner — default `"auto"`. */
    readonly corner?: GlyphChart3dCornerOption;
  };
  /** Independent axis-triad rendering toggles — see `GlyphChart3dGuideOptions`'s own doc. */
  readonly guides?: GlyphChart3dGuideOptions;
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
  /** Undefined iff the caller passed no explicit `options.shading` — see the input field's own doc. */
  readonly shading?: "relief" | "value";
  readonly maxQuadsX?: number;
  readonly maxQuadsY?: number;
  readonly axes: {
    readonly x: GlyphChart3dResolvedAxis;
    readonly y: GlyphChart3dResolvedAxis;
    readonly z: GlyphChart3dResolvedAxis;
  };
  /** `"auto"` (default) or an explicit override — `object.ts`'s `resolveSharedCorner` resolves `"auto"` per camera, per `stamp()` call. */
  readonly corner: GlyphChart3dCornerOption;
  /** Every toggle resolved to a concrete boolean (defaults: all `true` except `walls`/`box`, which default `false`). */
  readonly guides: GlyphChart3dResolvedGuides;
  readonly report: GlyphChart3dBuildReport;
}

/** A 3D chart mark — a union of one member today; `scatter3d` (C5) joins it later. */
export type GlyphChart3dMark = GlyphChart3dSurfaceMark;

export interface GlyphChart3dObjectOptions {
  /** Stable object id — default `"surface"`. Two surfaces in one scene need distinct ids (`scene.addObject`'s own uniqueness rule). */
  readonly id?: string;
  /**
   * Fix round 3, Item 2: which glyph family the axis-triad overlay's own
   * gridlines render in (box-drawing `┈`/`┊`, ascii `.`/`:`, or a single
   * sparse braille dot) — default `"box"`. `renderGlyphChart3d` resolves
   * and forwards its OWN charset automatically; a caller mounting this
   * object directly into a live `createGlyphScene` (a `/charts`-style orbit
   * viewport) sets it to match whatever tier that scene is rendering in.
   */
  readonly charset?: GlyphChartCharset;
}

export interface GlyphChart3dBuildReport {
  readonly ledger: GlyphChart3dLedgerEntry[];
}
