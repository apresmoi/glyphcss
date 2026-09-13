/**
 * `@glyphcss/charts`' public spec shape (CHARTS-RESEARCH Phase 1) — an
 * Observable-Plot-flavoured mark/spec grammar, not a `type: "line"` enum
 * (see `docs/design/charts.md` "Why Plot's model"). A mark constructor
 * (`glyphChartLine`, …) returns a plain `GlyphChartMark`; `glyphChartPlot`
 * composes marks into a `GlyphChartSpec`; `renderGlyphChart` accepts either
 * (or a bare array/mark), normalising through `normalizeGlyphChartInput`.
 */

import type { GlyphCanvasRouteConflict } from "glyphcss";
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

export interface GlyphChartRenderOptions {
  /** Default `"web"` — the bare `renderGlyphChart(x)` call renders for the web target. */
  readonly target?: GlyphChartTarget;
  readonly charset?: GlyphChartCharset;
  readonly color?: GlyphChartColorMode;
  readonly width?: number;
  readonly height?: number;
  readonly detail?: GlyphChartDetail;
  /** Whether/where layout shows the series legend; defaults to true (`"bottom"`). Overrides `spec.legend`. */
  readonly legend?: GlyphChartLegendOption;
  /** Read only for `NO_COLOR`/`FORCE_COLOR`, exactly like the canvas's own ANSI encoder — never `process.env` implicitly. */
  readonly env?: Readonly<Record<string, string | undefined>>;
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
   * verifies that count directly rather than taking the design doc's word
   * for it (fable review, batch 3, finding e). Empty for every spec with no
   * sankey mark, byte-identical to before this field existed.
   */
  readonly routeConflicts: readonly GlyphCanvasRouteConflict[];
}

export interface GlyphChartResult {
  readonly text: string;
  /** Present only for `target: "web"` — the HTML exit. */
  readonly html?: string;
  readonly grid: {
    readonly cols: number;
    readonly rows: number;
    readonly char: readonly string[];
  };
  readonly meta: GlyphChartMeta;
  readonly report: GlyphChartReport;
}
