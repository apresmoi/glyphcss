/**
 * `@glyphcss/charts`' public spec shape (CHARTS-RESEARCH Phase 1) — an
 * Observable-Plot-flavoured mark/spec grammar, not a `type: "line"` enum
 * (marks compose and share scales, as in Plot). A mark constructor
 * (`glyphChartLine`, …) returns a plain `GlyphChartMark`; `glyphChartPlot`
 * composes marks into a `GlyphChartSpec`; `renderGlyphChart` accepts either
 * (or a bare array/mark), normalising through `normalizeGlyphChartInput`.
 */

import type { GlyphCanvas, GlyphCanvasRouteConflict } from "glyphcss";
import type { GlyphChartLedgerEntry } from "./ledger";
export type { GlyphChartLedgerEntry };

export type GlyphChartMarkType =
  | "line"
  | "area"
  | "bar"
  | "dot"
  | "arc"
  | "rect"
  | "cell"
  | "text"
  | "rule"
  | "sankey"
  | "funnel";

/** One data record a mark's channels read fields from. */
export type GlyphChartDatum = Record<string, unknown>;

/**
 * A channel value is a field name (looked up per datum), an accessor
 * function `(datum, index) => value`, or a literal array of pre-computed
 * values running parallel to `data` — the three ways Plot itself accepts a
 * channel.
 */
export type GlyphChartChannelValue =
  | string
  | ((datum: GlyphChartDatum, index: number) => unknown)
  | readonly unknown[];

export interface GlyphChartChannels {
  readonly x?: GlyphChartChannelValue;
  readonly y?: GlyphChartChannelValue;
  readonly fill?: GlyphChartChannelValue;
  readonly stroke?: GlyphChartChannelValue;
  readonly label?: GlyphChartChannelValue;
  /** `sankey` only: the flow's origin node. */
  readonly source?: GlyphChartChannelValue;
  /** `sankey` only: the flow's destination node. */
  readonly target?: GlyphChartChannelValue;
  /** `sankey`/`funnel`: the flow value / stage value. */
  readonly value?: GlyphChartChannelValue;
  /** `funnel` only: the stage name. */
  readonly stage?: GlyphChartChannelValue;
}

/** Mark-specific extras that don't fit the shared channel vocabulary. */
export interface GlyphChartMarkOptions {
  /** `arc`: fraction of the outer radius carved out for a donut hole. */
  readonly innerRadius?: number;
  /**
   * `arc`: how a slice's identity reaches the reader beyond its legend
   * swatch. `"callout"` (default) draws a leader line from each slice's
   * mid-arc out to a `name · NN%` label beside the disc; `"legend-only"`
   * paints just the disc (byte-identical to the render before callouts
   * existed) and leaves identification to the legend row.
   */
  readonly labels?: "callout" | "legend-only";
  /** `rule`: which axis the rule spans; default `"y"` (a horizontal rule at fixed y values, à la Plot's `ruleY`). */
  readonly axis?: "x" | "y";
  /** A caller-supplied series name, used by the legend and `meta.series`. */
  readonly name?: string;
  /**
   * A canonical `#rrggbb`, or an array assigned per series in series order
   * (cycling if shorter; a longer array logs `mark-color-unused`) —
   * overrides the palette colour AND the legend swatch for this mark's own
   * series (AGENTS.md's "Charts" "Colours"). `arc`: per slice. `cell`: the
   * ramp's ink colour, or `[losses, gains]` for a diverging domain.
   * `sankey`: per source node. `funnel`: per stage.
   */
  readonly color?: string | readonly string[];
  /**
   * `line`/`rule`, and an `area`'s own boundary-line legend swatch: stroke
   * thickness, `1` (default, byte-identical when absent) to `3`. `ascii`/
   * `box` widen by substituting a heavier glyph on the SAME walked cells
   * (`glyphcss`'s `GlyphCanvasLineOptions.width`); `blocks`/`braille` widen
   * in real sub-cell DOTS, offset perpendicular to the segment. Series
   * identity is unaffected — a dashed wide line stays dashed, and the
   * legend swatch reflects the width. Any other value rejects with
   * `bad-stroke-width`.
   */
  readonly strokeWidth?: 1 | 2 | 3;
  /**
   * `sankey`: how much of a band's own region gets painted, AGENTS.md's
   * "Charts" sankey clause. `"filled"` (default, byte-identical to before
   * this option existed) paints the whole ribbon; `"outline"` paints only
   * its two edges plus a thin centre stroke — the "should be less filled"
   * ask, for a reader who wants the shape without the ink. No effect on
   * any other mark type. Any other value rejects with `bad-options`.
   */
  readonly ribbon?: "filled" | "outline";
}

export type GlyphChartTransformKind = "bin" | "stack" | "group" | "normalize" | "window";

export interface GlyphChartTransform {
  readonly kind: GlyphChartTransformKind;
  /** `bin`: number of bins (default 10). `window`: window size (default 3). */
  readonly n?: number;
  /** `group`/`stack`: field (or accessor) to group by. */
  readonly by?: GlyphChartChannelValue;
  /** `window`: reducer; default `"mean"`. */
  readonly reduce?: "mean" | "sum" | "min" | "max";
}

export interface GlyphChartMark {
  readonly type: GlyphChartMarkType;
  readonly data: readonly (number | GlyphChartDatum)[];
  readonly channels: GlyphChartChannels;
  readonly transform?: GlyphChartTransform;
  readonly options?: GlyphChartMarkOptions;
}

export interface GlyphChartScaleOptions {
  readonly type?: "linear" | "log" | "sqrt" | "time" | "band" | "ordinal";
  readonly domain?: readonly (number | string | Date)[];
  readonly nice?: boolean;
}

/** One materialised data row after channel resolution (and, if present, transform application). */
export interface GlyphChartMarkRow {
  readonly x: unknown;
  readonly y: unknown;
  /** Present only after a `stack` transform: the segment's baseline and top, replacing plain `y` for painting. */
  readonly y0?: number;
  readonly y1?: number;
  readonly fill?: unknown;
  readonly stroke?: unknown;
  readonly label?: unknown;
  readonly index: number;
}

/**
 * A tick's own label formatter (AGENTS.md's "Charts" "Axes") — a named
 * preset (`"si"`, or `{ preset: "currency", symbol: "$" }` for one that
 * takes parameters; see `GLYPH_CHART_TICK_FORMAT_PRESETS` in
 * `tickFormat.ts`, the ONE table `renderGlyphChartJson`/the CLI/the JSON
 * schema all derive from), or a callback `(value, index, ticks) => string`
 * called per tick with the tick's raw scale value, its index, and the full
 * tick array — a TS/JS-only escape hatch with no JSON representation
 * (`renderGlyphChartJson` and the schema reject a function-shaped value with
 * `bad-tick-format`). `"auto"` (or omitting `format` entirely) is today's
 * behaviour — d3's own multi-scale time format / the existing SI-or-plain
 * numeric ladder / the band category string — byte-identical.
 */
export type GlyphChartTickFormatCallback = (value: number | Date | string, index: number, ticks: readonly unknown[]) => string;
export interface GlyphChartTickFormatPreset {
  readonly preset: string;
  readonly [param: string]: unknown;
}
export type GlyphChartTickFormat = string | GlyphChartTickFormatPreset | GlyphChartTickFormatCallback;

/**
 * One axis's tick-mark/title/grid options (packet "renderers, legends, axes,
 * table editor" item 6). `ticks` is a REQUESTED count, exactly like
 * `scale.ticks(n)` itself — the layout still thins the result to whatever
 * actually fits without collisions (never a raw override that could paint
 * overlapping labels). `title` defaults to the axis channel's own field
 * name when it's a plain string field (never an accessor/array, which has
 * no name to show); explicit `title: ""` suppresses even that default.
 */
export interface GlyphChartAxisOptions {
  readonly ticks?: number;
  readonly tickMarks?: boolean;
  readonly title?: string;
  readonly grid?: boolean;
  /** Canonical `#rrggbb`; overrides `spec.axes.color` for this one axis (line, tick marks, tick labels, title, and grid). */
  readonly color?: string;
  /** See `GlyphChartTickFormat`'s own doc. Applies to axis ticks only — never an arc's own callout percentage or a funnel's value·percent label. */
  readonly format?: GlyphChartTickFormat;
}

/**
 * Where the x-axis title sits on its own row under the tick labels:
 * left-aligned at the plot's left edge, centred (`"center"`, the default —
 * byte-identical when `titleAt` is absent), or right-aligned at the plot's
 * right edge. Applies to both an explicit `title` and the automatic
 * field-name default alike; the row-reservation gating (rows>=20, field name
 * longer than two characters) is unchanged.
 */
export type GlyphChartXAxisTitleAt = "start" | "center" | "end";
export interface GlyphChartXAxisOptions extends GlyphChartAxisOptions {
  readonly titleAt?: GlyphChartXAxisTitleAt;
}

/**
 * Where the y-axis title sits: `"top"` (the default — top-left, above the
 * axis, byte-identical when `titleAt` is absent) or `"bottom"` — below the
 * plot at the axis column, on its own row, which then costs a row exactly
 * as the x-axis title does. When both axis titles land at the bottom, the
 * y title shares the x title's row if it fits to the LEFT of it (painted at
 * column 0, mirroring `"top"`'s own column); otherwise it claims its own
 * row and an `axis-title-stacked` ledger entry records the fallback.
 */
export type GlyphChartYAxisTitleAt = "top" | "bottom";
export interface GlyphChartYAxisOptions extends GlyphChartAxisOptions {
  readonly titleAt?: GlyphChartYAxisTitleAt;
}

/**
 * Legend placement (owner packet: "legends only have on or off but no
 * placements"). `true`/omitted is `"bottom"` — byte-identical to the chart
 * before this option existed. The four corner placements paint INSIDE the
 * plot rect (no chart row reserved); `"title"` shares the title's own row,
 * after the title text, degrading to `"bottom"` (with a ledger entry) when
 * there's no title row or the entries don't fit beside it.
 */
export type GlyphChartLegendPlacement = "bottom" | "top-left" | "top-right" | "bottom-left" | "bottom-right" | "title";
export type GlyphChartLegendOption = boolean | { readonly placement: GlyphChartLegendPlacement };

/**
 * Title placement (owner packet: "the title has to have some placement
 * controls"). A bare string is `{ align: "center", position: "top" }` —
 * byte-identical to the chart before this option existed. `position:
 * "bottom"` reserves the LAST row of the chart (below the legend and axis
 * labels/title, which claim their own rows first).
 */
export type GlyphChartTitleAlign = "left" | "center" | "right";
export type GlyphChartTitlePosition = "top" | "bottom";
export type GlyphChartTitleOption = string | { readonly text: string; readonly align?: GlyphChartTitleAlign; readonly position?: GlyphChartTitlePosition };

export interface GlyphChartSpec {
  readonly marks: readonly GlyphChartMark[];
  readonly scales?: {
    readonly x?: GlyphChartScaleOptions;
    readonly y?: GlyphChartScaleOptions;
  };
  readonly axes?: {
    /** Canonical `#rrggbb`; both axes' line, tick marks, tick labels, title, and grid — a mid grey (`GLYPH_CHART_AXIS_DEFAULT_COLOR`) when colour is on and neither this nor a per-axis `color` is set. */
    readonly color?: string;
    readonly x?: GlyphChartXAxisOptions;
    readonly y?: GlyphChartYAxisOptions;
  };
  readonly title?: GlyphChartTitleOption;
  readonly description?: string;
  readonly legend?: GlyphChartLegendOption;
}

/** Anything `renderGlyphChart`/`glyphChartPlot` accept as "the chart". */
export type GlyphChartInput =
  | GlyphChartSpec
  | GlyphChartMark
  | readonly GlyphChartMark[]
  | readonly number[];

export type GlyphChartTarget = "chat" | "terminal" | "web";
export type GlyphChartCharset = "ascii" | "box" | "blocks" | "braille";
export type GlyphChartColorMode = "none" | "ansi16" | "ansi256" | "truecolor" | "css";
export type GlyphChartDetail = "auto" | "faithful" | "balanced" | "simplified";
/**
 * How a region mark (bar/rect/area/arc) fills: `"texture"` gives each series
 * its own shape glyph, `"solid"` a full block in each series' own colour, and
 * `"auto"` is solid only where colour genuinely carries series identity
 * (AGENTS.md's "Charts" "Series and shading").
 */
export type GlyphChartRegionFill = "auto" | "solid" | "texture";
export type GlyphChartRegionFillReason =
  | "no-region-mark" | "requested-texture" | "color-off" | "colors-collide"
  | "target-terminal" | "target-chat" | "colors-distinct";
/** What `glyphChartRegionFill` decided and why; `message` is one plain sentence a UI can show as-is. */
export interface GlyphChartRegionFillResolution {
  readonly requested: GlyphChartRegionFill;
  readonly fill: "solid" | "texture";
  readonly reason: GlyphChartRegionFillReason;
  readonly message: string;
  /** The first two series found sharing one colour, for `reason: "colors-collide"`. */
  readonly colliding?: readonly [string, string];
}

export interface GlyphChartRenderOptions {
  /** Default `"web"` — the bare `renderGlyphChart(x)` call renders for the web target. */
  readonly target?: GlyphChartTarget;
  readonly charset?: GlyphChartCharset;
  readonly color?: GlyphChartColorMode;
  readonly width?: number;
  readonly height?: number;
  readonly detail?: GlyphChartDetail;
  /**
   * Overrides the target's own column-width / row-height ratio
   * (`GLYPH_CHART_TARGET_DEFAULTS`'s `cellAspect`) fed to
   * `createGlyphCanvas`. Only `arc`'s radius split reads it — see
   * AGENTS.md's "Charts" "Arc shape and callouts" paragraph.
   */
  readonly cellAspect?: number;
  /** Whether/where layout shows the series legend; defaults to true (`"bottom"`). Overrides `spec.legend`. */
  readonly legend?: GlyphChartLegendOption;
  /** Read only for `NO_COLOR`/`FORCE_COLOR`, exactly like the canvas's own ANSI encoder — never `process.env` implicitly. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /**
   * Web-only affordance (AGENTS.md's "Charts" "Density" paragraph):
   * lays out and paints every TEXT the chart draws — title, axis titles,
   * tick labels, legend names/swatches, arc callout labels, funnel labels,
   * sankey node labels — as if each glyph occupied `s x s` cells instead of
   * one, via `glyphcss`'s `canvas.text({ scale })`. Layout reserves label
   * rows/columns in multiples of `s`; the HTML exit (`color: "css"`) emits
   * each origin glyph inside a `font-size:<s>em` span and nothing for its
   * filler cells, so the browser's own font-size-scaled advance width fills
   * the reserved box — no second grid, one render. Default `1`,
   * BYTE-IDENTICAL to before this option existed (verified against a real
   * build of the commit before it landed). An integer `>= 1`; a caller
   * passes `Math.round(density)`. The plain-text/ANSI exits and
   * `@glyphcss/compile`'s static output ignore it entirely — a web-only
   * affordance never reaches a CLI/terminal/compiled exit.
   */
  readonly textScale?: number;
  /**
   * Region-mark fill, default `"auto"`. Applies to the COLOUR-carrying exits
   * only (`html` under `css`, `text` under an ANSI mode): `build.canvas` and
   * a plain `text` always carry textures, so a coloured chart's plain text
   * stays readable. An explicit `"solid"` that would make two series identical
   * (colour off, two series sharing a colour, a sankey/funnel mark) is
   * refused with a `region-fill-solid-refused` ledger entry.
   */
  readonly regionFill?: GlyphChartRegionFill;
}

/**
 * The plot rect in canvas cells (inclusive bounds) — canonical home for a
 * type `layout.ts` used to define locally (Packet F1: it is now part of the
 * public `GlyphChartBuild.plot` shape, the source of a mesh's uv0 mapping
 * once a chart becomes a texture, AGENTS.md's "Charts" §4).
 */
export interface GlyphChartPlotRect {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

export interface GlyphChartMeta {
  readonly title: string | null;
  readonly series: readonly string[];
  readonly values: number;
  readonly description: string | null;
}

export interface GlyphChartReport {
  readonly ledger: readonly GlyphChartLedgerEntry[];
  readonly unsupportedGlyphs: readonly string[];
  /**
   * The cell canvas's own `GlyphCanvasRouteConflict[]` (`glyphcss`,
   * `resolveJunctions()`'s "not fully empty in practice" quantity AGENTS.md's
   * "Charts" sankey clause discusses), forwarded UNCHANGED — a sankey band's
   * ribbon claim can still coincide with another band's at a single cell
   * along its own axis (never a whole run), and this is how a caller
   * verifies that count directly rather than taking the prose's word
   * for it (fable review, batch 3, finding e). Empty for every spec with no
   * sankey mark, byte-identical to before this field existed.
   */
  readonly routeConflicts: readonly GlyphCanvasRouteConflict[];
}

/**
 * The render's own resolved settings (Packet F1) — everything `encodeGlyphChart`
 * needs to pick an exit, and everything a later bridge (`glyphChartTextureSampler`,
 * `glyphChartPlaneObject`, F2/F4) needs to know how the model was rendered.
 */
export interface GlyphChartResolved {
  readonly target: GlyphChartTarget;
  readonly charset: GlyphChartCharset;
  readonly color: GlyphChartColorMode;
  readonly width: number;
  readonly height: number;
  readonly detail: GlyphChartDetail;
  readonly cellAspect: number;
  readonly textScale: number;
  readonly env: Readonly<Record<string, string | undefined>> | undefined;
}

/**
 * `buildGlyphChart`'s result (AGENTS.md's "Charts" §4, Packet F1) — the MODEL
 * step: validate → resolve → scales → layout → paint, with no encoding yet.
 * `canvas` is the TEXTURED paint (monochrome series identity, what every
 * plain-text/ASCII exit and a chart-as-texture reads); `colorCanvas` is the
 * SOLID-fill paint when `regionFill` resolves solid, and is the exact same
 * object as `canvas` otherwise (never a second allocation when nothing
 * distinguishes them) — only the colour-carrying exits (`html` under `css`,
 * `text` under an ANSI mode) read it. `plot` is the plot rect in cells: the
 * source of `uv0` once a chart becomes a texture on a mesh (F2) or a plane
 * object (F4).
 */
export interface GlyphChartBuild {
  readonly canvas: GlyphCanvas;
  readonly colorCanvas: GlyphCanvas;
  readonly plot: GlyphChartPlotRect;
  readonly meta: GlyphChartMeta;
  readonly report: GlyphChartReport;
  readonly resolved: GlyphChartResolved;
}

export interface GlyphChartResult {
  readonly text: string;
  /** Present only for `color: "css"`, or any other colour mode once `textScale > 1`. */
  readonly html?: string;
  /** The model this render painted — `encodeGlyphChart(build, exit)` reproduces `text`/`html` from it. */
  readonly build: GlyphChartBuild;
  readonly meta: GlyphChartMeta;
  readonly report: GlyphChartReport;
}
