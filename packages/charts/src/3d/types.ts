/**
 * `@glyphcss/charts/3d`'s public types (PLAN-3d.md §5 "Surface: z(x, y)",
 * packet C1). A `GlyphChart3dSurfaceMark` is the model-layer counterpart of
 * a 2D `GlyphChartMark`: it validates and resolves a `z(x, y)` grid into a
 * numeric grid, a colour band table, and 3 axis scales, with no rendering
 * of its own. `glyphChartObject()` (`object.ts`) turns one into a mounted
 * `GlyphSceneObject`.
 */
import type { GlyphChart3dLedgerEntry } from "./ledger";
import type { GlyphChartCharset, GlyphChartTickFormat } from "../types";
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

/**
 * C7 (AGENTS.md's "Charts 3D" "C7"): every field an axis can configure on
 * its own, mirroring the 2D `axes.{x,y}` contract name-for-name
 * (`axisTriadShared.ts`'s `resolveAxis` resolves every one of these; the
 * booleans compose with the mark's own `GlyphChart3dGuideOptions` — an
 * axis's own value wins, `undefined` follows the matching global default).
 */
export interface GlyphChart3dAxisOptions {
  /** Defaults to the resolved field name where the channel is a plain string, following the 2D axis-title default rule; omit/`""` suppresses it. */
  readonly title?: string;
  /** Requested tick count — `d3-scale`'s own `.ticks(n)`, like a 2D axis. Default 5. */
  readonly ticks?: number;
  /**
   * Tick label override — the SAME preset/callback vocabulary as a 2D axis
   * (`GlyphChartTickFormat`, `tickFormat.ts`'s `resolveGlyphChartTickFormat`),
   * folded through the same ASCII-minus rule every 3D label already follows
   * (`axisTriadShared.ts`'s `asciiMinus`). Omitted: today's plain `~r`
   * numeric label, unchanged.
   */
  readonly format?: GlyphChartTickFormat;
  /** Per-axis visibility overriding `guides.axisLines` for this axis ALONE. `undefined` follows the global default. */
  readonly line?: boolean;
  /** Per-axis visibility overriding `guides.ticks` (tick marks, the `+` glyphs) for this axis alone. */
  readonly tickMarks?: boolean;
  /** Per-axis visibility overriding `guides.tickLabels` for this axis alone. */
  readonly tickLabels?: boolean;
  /**
   * Per-axis visibility overriding the guide-plane gridlines whose own tick
   * VALUE belongs to this axis — a wall plane's lines are always z's
   * (`guides.grid`'s own default), a floor plane's are x's and y's
   * (`guides.floorGrid`'s own default); see `axisTriadShared.ts`'s doc.
   */
  readonly grid?: boolean;
  /**
   * Canonical `#rrggbb` colouring this axis's own line, ticks, labels and
   * title — overrides a mark-wide `axes.color` (the 2D `axes.color`
   * pattern), which itself falls back to the library's own muted grey
   * default. Rejects with `bad-axis-color` otherwise.
   */
  readonly color?: string;
  /**
   * Explicit `[min, max]` overriding the data-derived NICE domain. The
   * box's own `aspect` extent is unaffected — only where a data value maps
   * INSIDE it changes — and a value outside this domain clamps to the
   * nearest box edge rather than mapping past it (`object.ts`'s
   * `mapAxisValue`). Rejects with `bad-axis-domain` when non-finite or
   * `min >= max`.
   */
  readonly domain?: readonly [number, number];
  /**
   * Where the axis TITLE sits ALONG its own triad edge — `"start"` (at the
   * origin corner itself, the axis's own data-minimum end), `"center"`
   * (default, byte-identical to before this field existed), or `"end"` (the
   * far end of the edge, the axis's own data-maximum end). Mirrors 2D's
   * `axes.x.titleAt: "start" | "center" | "end"` naming (AGENTS.md's
   * "Charts" "Axes"), though 3D has one shared vocabulary for every axis —
   * there is no analogue of 2D's y-axis `"top" | "bottom"` split, since a 3D
   * title is always pushed OUTWARD from the same fixed corner regardless of
   * which axis it belongs to. Rejects with `bad-axis-title-at` otherwise.
   */
  readonly titleAt?: "start" | "center" | "end";
  /**
   * How far OUTWARD from the triad edge (as a fraction of that axis's own
   * box extent, the same unit `object.ts`'s `outwardPoint` already uses for
   * tick labels) the title is pushed — default the library's own constant
   * (`AXIS_TITLE_MARGIN`, `object.ts`), byte-identical when omitted. Must be
   * a finite number; rejects with `bad-options` otherwise.
   */
  readonly titleOffset?: number;
}

/** `0` = the box's own `0` coordinate on that axis, `1` = `aspect[axis]`. */
export type GlyphChart3dCornerBit = 0 | 1;
/** A box vertex — `object.ts`'s own `resolveOriginCorner`/`resolveSharedCorner` docs. */
export type GlyphChart3dCorner = readonly [GlyphChart3dCornerBit, GlyphChart3dCornerBit, GlyphChart3dCornerBit];
/**
 * `"auto"` (default, C2 fix round 7 — USER FEEDBACK, verbatim: "put the
 * 0,0,0 in one of the corners"): the axis TRIAD (lines/ticks/labels/titles)
 * always resolves to the SINGLE data-min box vertex, `[0, 0, 0]` — the only
 * corner where every axis's own first tick can legitimately sit, so there
 * is nothing left to search for per camera (`object.ts`'s
 * `resolveOriginCorner` doc has the full rationale, superseding round 6's
 * own per-camera `resolveAxisTriadCorners` split). An EXPLICIT
 * `GlyphChart3dCorner` still pins the whole triad to that given corner.
 * `guides.walls`/`guides.box`/`guides.grid`/`floorGrid` are UNAFFECTED
 * either way — they still resolve their own single BACKDROP corner per
 * camera via `object.ts`'s `resolveSharedCorner`, since they are meant to
 * sit behind the data, a different design goal from the triad's own
 * "anchor the data at a fixed, always-visible-by-construction corner" one.
 */
export type GlyphChart3dCornerOption = "auto" | GlyphChart3dCorner;

/**
 * The shared shape every 3D mark type's axis-triad machinery
 * (`object.ts`'s `axisTriadOverlay`/`glyphChart3dLabelAnchors`/
 * `glyphChart3dResolvedCorner`, `render.ts`'s `fitStaticCamera`) reads —
 * `GlyphChart3dSurfaceMark` and every later mark type structurally satisfy
 * it. Generic over WHAT is being plotted; the triad only ever needs to know
 * the box it frames and how to draw its own furniture.
 */
export interface GlyphChart3dAxisTriadSpec {
  readonly aspect: readonly [number, number, number];
  readonly axes: {
    readonly x: GlyphChart3dResolvedAxis;
    readonly y: GlyphChart3dResolvedAxis;
    readonly z: GlyphChart3dResolvedAxis;
  };
  readonly corner: GlyphChart3dCornerOption;
  readonly guides: GlyphChart3dResolvedGuides;
  /** C7: the shared `axes.color` every axis's own `color` overrides — `object.ts`'s `axisRenderColor`. */
  readonly axesColor?: string;
}

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
    /** C7: a shared axis colour every axis's own `color` overrides — mirrors 2D `axes.color`. */
    readonly color?: string;
  };
  /** Independent axis-triad rendering toggles — see `GlyphChart3dGuideOptions`'s own doc. */
  readonly guides?: GlyphChart3dGuideOptions;
}

export interface GlyphChart3dResolvedAxis {
  readonly title: string;
  readonly domain: readonly [number, number];
  readonly ticks: readonly number[];
  /** `d3-format`'s own `"~r"` (or `axes.{x,y,z}.format`'s own resolved preset/callback) — matching the tick's own index in `ticks`. */
  readonly tickLabels: readonly string[];
  /** This axis's own `color` override; `undefined` falls back to the mark's shared `axesColor`, then the library default. */
  readonly color?: string;
  /** This axis's own `line`/`tickMarks`/`tickLabels`/`grid` overrides; `undefined` follows the matching `GlyphChart3dResolvedGuides` field. */
  readonly lineVisible?: boolean;
  readonly tickMarksVisible?: boolean;
  readonly tickLabelsVisible?: boolean;
  readonly gridVisible?: boolean;
  /** This axis's own `titleAt`/`titleOffset` overrides; `undefined` falls back to `object.ts`'s own defaults (`"center"` / `AXIS_TITLE_MARGIN`). */
  readonly titleAt?: "start" | "center" | "end";
  readonly titleOffset?: number;
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
  /** `"auto"` (default, the fixed data-min corner) or an explicit override — `object.ts`'s `resolveOriginCorner` doc. */
  readonly corner: GlyphChart3dCornerOption;
  /** Every toggle resolved to a concrete boolean (defaults: all `true` except `walls`/`box`, which default `false`). */
  readonly guides: GlyphChart3dResolvedGuides;
  /** C7: the resolved shared `axes.color`, or `undefined` when none was given. */
  readonly axesColor?: string;
  readonly report: GlyphChart3dBuildReport;
}

/**
 * A resolved colour legend (colorbar) — present on a mark whenever it has a
 * CONTINUOUS numeric colour channel to explain (`surface`'s own z-band
 * colour; `scatter3d`'s optional numeric `color` channel; `parametric3d`'s
 * value grid; `bars3d`'s height colour). `renderGlyphChart3d`'s colorbar
 * chrome reads this ONE shape regardless of mark type — never `surface`'s
 * own `colorAnchors`/`bands`/`axes.z.domain` triple directly, which stays a
 * surface-only public field for backward-compatible reasons alone.
 */
export interface GlyphChart3dColorLegend {
  readonly anchors: readonly string[];
  readonly bands: number;
  readonly domain: readonly [number, number];
}

/** C5: `glyphChartScatter3d` — points in 3-space, optionally banded by a categorical `series` or a continuous `color` channel. */
export interface GlyphChart3dScatterPoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Index into `series` (`-1` when the mark carries no categorical channel). */
  readonly seriesIndex: number;
  /** The raw numeric `color` channel value, when the mark has one (mutually exclusive with `series`). */
  readonly colorValue?: number;
  /** Resolved object-space half-size for this point's own marker (`markerSize` scaled by the `size` channel, when given). */
  readonly markerSize: number;
}
export interface GlyphChart3dScatterSeriesEntry {
  readonly name: string;
  readonly color: string;
  /** Marker shape cycled by series index — read ONLY under `color: "none"` (object.ts's own doc). */
  readonly shape: "cube" | "octahedron" | "tetrahedron" | "icosahedron";
}
export interface GlyphChart3dScatterMark {
  readonly type: "scatter3d";
  readonly points: readonly GlyphChart3dScatterPoint[];
  readonly series: readonly GlyphChart3dScatterSeriesEntry[];
  readonly colorLegend: GlyphChart3dColorLegend | null;
  readonly aspect: readonly [number, number, number];
  readonly axes: { readonly x: GlyphChart3dResolvedAxis; readonly y: GlyphChart3dResolvedAxis; readonly z: GlyphChart3dResolvedAxis };
  readonly corner: GlyphChart3dCornerOption;
  readonly guides: GlyphChart3dResolvedGuides;
  readonly axesColor?: string;
  readonly report: GlyphChart3dBuildReport;
}

/** C5: `glyphChartParametric3d` — a `(u, v)`-parametrized surface (sphere, torus, Möbius strip, ...) from precomputed x/y/z grids. */
export interface GlyphChart3dParametricGrid {
  readonly x: readonly (readonly number[])[];
  readonly y: readonly (readonly number[])[];
  readonly z: readonly (readonly number[])[];
  /** Optional 4th scalar grid (same shape) driving colour instead of z — spherical harmonics on a sphere, for instance. */
  readonly value?: readonly (readonly number[])[];
  readonly wrapU?: boolean;
  readonly wrapV?: boolean;
}
export interface GlyphChart3dParametricMark {
  readonly type: "parametric3d";
  readonly grid: GlyphChart3dParametricGrid;
  /** The resolved `[min, max]` of whichever field (`value`, else `z`) drives colour. */
  readonly colorLegend: GlyphChart3dColorLegend | null;
  readonly aspect: readonly [number, number, number];
  /** Axis domains are the RAW x/y/z extents of the computed grid — a parametric surface has no independent per-axis data domain to nice separately (unlike `surface`'s own row/col position vectors). */
  readonly axes: { readonly x: GlyphChart3dResolvedAxis; readonly y: GlyphChart3dResolvedAxis; readonly z: GlyphChart3dResolvedAxis };
  readonly corner: GlyphChart3dCornerOption;
  readonly guides: GlyphChart3dResolvedGuides;
  readonly axesColor?: string;
  readonly report: GlyphChart3dBuildReport;
}

/** C5: `glyphChartBars3d` — upright boxes on a categorical or numeric x/y grid, height z, coloured by height. */
export interface GlyphChart3dBar {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly xLabel?: string;
  readonly yLabel?: string;
}
export interface GlyphChart3dBarsMark {
  readonly type: "bars3d";
  readonly bars: readonly GlyphChart3dBar[];
  /** Half-width of a bar's own footprint, object space, on each axis — sized from the tightest x/y spacing so bars never touch. */
  readonly barHalfWidth: readonly [number, number];
  readonly colorLegend: GlyphChart3dColorLegend | null;
  readonly aspect: readonly [number, number, number];
  readonly axes: { readonly x: GlyphChart3dResolvedAxis; readonly y: GlyphChart3dResolvedAxis; readonly z: GlyphChart3dResolvedAxis };
  readonly corner: GlyphChart3dCornerOption;
  readonly guides: GlyphChart3dResolvedGuides;
  readonly axesColor?: string;
  readonly report: GlyphChart3dBuildReport;
}

/** C5: `glyphChartLine3d` — one or more ordered 3D polylines (a trajectory, a helix), drawn as ribbon geometry. */
export interface GlyphChart3dLineSeriesEntry {
  readonly name: string;
  readonly color: string;
  readonly points: readonly (readonly [number, number, number])[];
}
export interface GlyphChart3dLineMark {
  readonly type: "line3d";
  readonly series: readonly GlyphChart3dLineSeriesEntry[];
  readonly aspect: readonly [number, number, number];
  readonly axes: { readonly x: GlyphChart3dResolvedAxis; readonly y: GlyphChart3dResolvedAxis; readonly z: GlyphChart3dResolvedAxis };
  readonly corner: GlyphChart3dCornerOption;
  readonly guides: GlyphChart3dResolvedGuides;
  readonly axesColor?: string;
  readonly report: GlyphChart3dBuildReport;
}

/** A 3D chart mark. */
export type GlyphChart3dMark = GlyphChart3dSurfaceMark | GlyphChart3dScatterMark | GlyphChart3dParametricMark | GlyphChart3dBarsMark | GlyphChart3dLineMark;

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
  /**
   * `scatter3d` only: render every point through its SERIES SHAPE (cube,
   * octahedron, tetrahedron, icosahedron) instead of relying on colour to
   * separate series — the marker-shape half of `renderGlyphChart3d`'s own
   * `color: "none"`/NO_COLOR default (`resolveMarkShading`'s sibling
   * decision for scatter marks). A live scene (always full colour
   * capability) never sets this; default `false`.
   */
  readonly monochrome?: boolean;
}

export interface GlyphChart3dBuildReport {
  readonly ledger: GlyphChart3dLedgerEntry[];
}
