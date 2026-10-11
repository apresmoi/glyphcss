import {
  type GlyphChartAxisOptions,
  type GlyphChartCharset,
  type GlyphChartColorMode,
  type GlyphChartDetail,
  type GlyphChartLegendPlacement,
  type GlyphChartMark,
  type GlyphChartMarkOptions,
  type GlyphChartMarkType,
  type GlyphChartRegionFill,
  type GlyphChartScaleOptions,
  type GlyphChartSpec,
  type GlyphChartTarget,
  type GlyphChartTitleAlign,
  type GlyphChartTitlePosition,
  type GlyphChartTransformKind,
  type GlyphChartXAxisTitleAt,
  type GlyphChartYAxisTitleAt,
  glyphChartArc,
  glyphChartArea,
  glyphChartBar,
  glyphChartCell,
  glyphChartDot,
  glyphChartFunnel,
  glyphChartLine,
  glyphChartPlot,
  glyphChartRule,
  glyphChartSankey,
  glyphChartScaleDomains,
  glyphChartText,
} from "@glyphcss/charts";
import {
  type Instrument3DEffectsState,
  INSTRUMENT_3D_EFFECT_ALL_TARGET,
  INSTRUMENT_3D_EFFECT_NONE,
} from "../../rendering/model/effectState";
import { energyConsumptionBySourceDataset } from "../data/index";
import type { PipelineStep } from "../tabular/dataPipeline";
import { CHARTS_AXIS_DEFAULT_COLOR } from "./chartsAxisDefaultColor";
import { type ChartsDataSource } from "./chartsDataSource";
import { type Charts3dViewState, createCharts3dViewState } from "./chartsWorkbench3d";

export const CHART_SCALE_TYPES = ["auto", "linear", "log", "sqrt", "time", "band"] as const;

export const CHART_AXIS_COLOR_MODES = ["shared", "per-axis"] as const;

export const CHART_CARTESIAN_CHANNELS = ["x", "y", "fill", "label"] as const;

export const CHART_SANKEY_CHANNELS = ["source", "target", "value"] as const;

export const CHART_FUNNEL_CHANNELS = ["stage", "value"] as const;

/** Full channel vocabulary the editable-mark/URL-codec data model round-trips — a mark's own RELEVANT subset comes from `chartRelevantChannels`. */
export const CHART_CHANNELS = [...CHART_CARTESIAN_CHANNELS, ...CHART_SANKEY_CHANNELS, "stage"] as const;

type Channel = (typeof CHART_CHANNELS)[number];

/** Which of `CHART_CHANNELS` a given mark type actually reads — `sankey`/`funnel` use their own vocabulary instead of x/y/fill/label (AGENTS.md's "Charts" section: they're non-cartesian, like `arc`). */
export function chartRelevantChannels(type: GlyphChartMarkType): readonly Channel[] {
  if (type === "sankey") return CHART_SANKEY_CHANNELS;
  if (type === "funnel") return CHART_FUNNEL_CHANNELS;
  return CHART_CARTESIAN_CHANNELS;
}

export interface GlyphChartsWorkbenchControls {
  readonly target: GlyphChartTarget;
  readonly overrides: {
    readonly charset?: GlyphChartCharset;
    readonly color?: GlyphChartColorMode;
    readonly width?: number;
    readonly height?: number;
    readonly detail?: GlyphChartDetail;
    readonly density?: number;
  };
}

const SAMPLE = [3, 5, 2, 8, 6, 9, 4];

const SERIES = ["North", "South"].flatMap((region, i) =>
  SAMPLE.map((value, month) => ({ month, value: value + i * 2, region })),
);

const BARS = ["Jan", "Feb", "Mar", "Apr"].map((month, i) => ({ month, value: SAMPLE[i]! }));

const STACKED = ["Jan", "Feb", "Mar", "Apr"].flatMap((month, i) => [
  { month, value: SAMPLE[i]!, region: "North" },
  { month, value: SAMPLE[i + 2]!, region: "South" },
]);

const SHARES = [
  { browser: "Chrome", share: 65 },
  { browser: "Safari", share: 20 },
  { browser: "Firefox", share: 15 },
];

const HEATMAP = ["Mon", "Tue", "Wed", "Thu"].flatMap((day, x) =>
  ["AM", "Noon", "PM"].map((hour, y) => ({ day, hour, value: (x + 1) * (y + 1) })),
);

export function sampleChartMark(type: GlyphChartMarkType): GlyphChartMark {
  switch (type) {
    case "line":
      return glyphChartLine(SAMPLE);
    case "area":
      return glyphChartArea(SAMPLE);
    case "bar":
      return glyphChartBar(BARS, { x: "month", y: "value" });
    case "dot":
      return glyphChartDot(SAMPLE);
    case "arc":
      return glyphChartArc(SHARES, { y: "share", fill: "browser" });
    case "cell":
      return glyphChartCell(HEATMAP, { x: "day", y: "hour", fill: "value" });
    case "text":
      return glyphChartText(
        [
          { x: 1, y: 3, label: "Peak" },
          { x: 3, y: 1, label: "Low" },
        ],
        { x: "x", y: "y", label: "label" },
      );
    case "rule":
      return glyphChartRule([5]);
    case "sankey":
      return glyphChartSankey(
        [
          { from: "A", to: "B", amount: 2 },
          { from: "A", to: "C", amount: 1 },
        ],
        { source: "from", target: "to", value: "amount" },
      );
    case "funnel":
      return glyphChartFunnel(
        [
          { stage: "Visits", count: 100 },
          { stage: "Purchases", count: 20 },
        ],
        { stage: "stage", value: "count" },
      );
  }
}

// Named (packet item 4: "Presets in the tray get names ... so every tray
// chart shows a legend") — a single-mark preset gets one series name of its
// own; a preset already split by a categorical `fill` (multi-line, stacked
// bar, pie, donut) already shows a legend from its categories and needs none.
export const CHART_PRESETS: readonly { readonly id: string; readonly label: string; readonly spec: GlyphChartSpec }[] =
  [
    {
      id: "line",
      label: "Line",
      spec: glyphChartPlot({ marks: [glyphChartLine(SAMPLE, undefined, { name: "Revenue" })], title: "Line" }),
    },
    {
      id: "multi-line",
      label: "Multi-series line",
      spec: glyphChartPlot({
        marks: [glyphChartLine(SERIES, { x: "month", y: "value", fill: "region" })],
        title: "Multi-series line",
      }),
    },
    {
      id: "bar",
      label: "Bar",
      spec: glyphChartPlot({
        marks: [glyphChartBar(BARS, { x: "month", y: "value" }, { name: "Sales" })],
        title: "Bar",
      }),
    },
    {
      id: "stacked-bar",
      label: "Stacked bar",
      spec: glyphChartPlot({
        marks: [
          { ...glyphChartBar(STACKED, { x: "month", y: "value", fill: "region" }), transform: { kind: "stack" } },
        ],
        title: "Stacked bar",
      }),
    },
    // Real data, the vendored `energy-consumption-by-source` rows: three of
    // its four layers are under two rows tall at a terminal size, the case a
    // stacked area has to survive. The description carries its CC BY credit,
    // since a preset clears the rail's dataset card.
    {
      id: "stacked-area",
      label: "Stacked area",
      spec: glyphChartPlot({
        marks: [
          {
            ...glyphChartArea(energyConsumptionBySourceDataset.rows, { x: "year", y: "twh", fill: "source" }),
            transform: { kind: "stack" },
          },
        ],
        title: "Stacked area",
        description: `${energyConsumptionBySourceDataset.title} (TWh). Source: ${energyConsumptionBySourceDataset.source.name}, ${energyConsumptionBySourceDataset.source.licence}.`,
      }),
    },
    {
      id: "dot",
      label: "Dot",
      spec: glyphChartPlot({ marks: [glyphChartDot(SAMPLE, undefined, { name: "Visits" })], title: "Dot" }),
    },
    {
      id: "area",
      label: "Area",
      spec: glyphChartPlot({ marks: [glyphChartArea(SAMPLE, undefined, { name: "Traffic" })], title: "Area" }),
    },
    { id: "pie", label: "Pie", spec: glyphChartPlot({ marks: [sampleChartMark("arc")], title: "Pie" }) },
    {
      id: "donut",
      label: "Donut",
      spec: glyphChartPlot({
        marks: [glyphChartArc(SHARES, { y: "share", fill: "browser" }, { innerRadius: 0.5 })],
        title: "Donut",
      }),
    },
    {
      id: "heatmap",
      label: "Heatmap",
      spec: glyphChartPlot({
        marks: [glyphChartCell(HEATMAP, { x: "day", y: "hour", fill: "value" }, { name: "Activity" })],
        title: "Heatmap",
      }),
    },
    {
      id: "line-rule",
      label: "Line + rule",
      spec: glyphChartPlot({
        marks: [glyphChartLine(SAMPLE, undefined, { name: "Revenue" }), glyphChartRule([5], { name: "Target" })],
        title: "Line + rule",
      }),
    },
    {
      id: "sankey",
      label: "Sankey",
      spec: glyphChartPlot({
        marks: [
          glyphChartSankey(
            [
              { from: "Coal", to: "Power", amount: 40 },
              { from: "Gas", to: "Power", amount: 60 },
              { from: "Power", to: "Homes", amount: 70 },
              { from: "Power", to: "Industry", amount: 30 },
            ],
            { source: "from", target: "to", value: "amount" },
          ),
        ],
        title: "Sankey",
      }),
    },
    {
      id: "funnel",
      label: "Funnel",
      spec: glyphChartPlot({
        marks: [
          glyphChartFunnel(
            [
              { stage: "Visits", count: 1000 },
              { stage: "Signups", count: 300 },
              { stage: "Purchases", count: 80 },
            ],
            { stage: "stage", value: "count" },
          ),
        ],
        title: "Funnel",
      }),
    },
  ];

export interface ChartsWorkbenchMark {
  readonly id: number;
  readonly type: GlyphChartMarkType;
  /** Draft JSON belongs to the reducer too; invalid edits remain visible and recoverable. */
  readonly dataText: string;
  readonly channels: Readonly<Partial<Record<Channel, string>>>;
  readonly transform: "none" | GlyphChartTransformKind;
  readonly options: GlyphChartMarkOptions;
  /** A single colour (one series, or every series the same) or one colour
   *  per series in `glyphChartSeriesPreview` order. Kept OUT of `options`
   *  (which mirrors the real `GlyphChartMarkOptions` shape exactly) purely
   *  so `chartsWorkbenchRender.ts`'s `applyChartStyle` stays the ONE place
   *  a workbench colour choice reaches the built spec's real
   *  `options.color` — same reason `state.style.axisColor` is kept out of
   *  `state.axes`. `undefined` = unset (library default). */
  readonly color?: string | readonly string[];
  /** URL-envelope plumbing ONLY (`chartsUrlState.ts`) — never set by any
   *  reducer action. `true` means `dataText` is the `"[]"` OMISSION
   *  SENTINEL: encode blanks a stock/remote-dataset mark's real rows to
   *  keep them out of the `?c=` link, and sets this flag alongside the
   *  blank so decode can tell that blank apart from a genuine empty array
   *  a reader's own edit produced (P3-1/P3-2, REVIEW-showcase-opus.md) — a
   *  NEW field rather than overloading `dataText`'s own value space, so a
   *  link from before this flag existed is never mistaken for one. */
  readonly dataOmitted?: true;
}

export interface ChartsWorkbenchScale {
  readonly type: (typeof CHART_SCALE_TYPES)[number];
  readonly min: string;
  readonly max: string;
}

/** `ticks: 0` and `title: ""` both mean "auto" (omitted from the built
 * spec, letting the library's own default — a fitted count / the channel's
 * field name — apply); packet item 6's Dock "Axes" folder. */
export interface ChartsWorkbenchAxis {
  readonly ticks: number;
  readonly tickMarks: boolean;
  readonly title: string;
  readonly grid: boolean;
}

/** The Data folder's own state (AGENTS.md's "Charts" — "Data layer"):
 *  `source` is either a stock `datasets/` entry or a "Custom…" paste/upload,
 *  `pipeline` is the ordered transform list running on top of it. `null`
 *  source is the default — the Data folder shows the picker with nothing
 *  applied yet, and every mark stays exactly what direct table/JSON editing
 *  (or a preset) put there. */
export interface ChartsWorkbenchDataState {
  readonly source: ChartsDataSource | null;
  readonly pipeline: readonly PipelineStep[];
}

/** Axis colour control (packet item 1) — `"shared"` writes one colour to
 *  both axes, `"per-axis"` writes `x`/`y` independently; all three swatches
 *  are kept even in `"shared"` mode (`x`/`y` simply go unused) so toggling
 *  the mode never loses a colour the reader already picked on either
 *  swatch. */
export interface ChartsWorkbenchAxisColorState {
  readonly mode: (typeof CHART_AXIS_COLOR_MODES)[number];
  readonly shared: string;
  readonly x: string;
  readonly y: string;
}

/** Axis title placement (Dock item "Axis Title + Title at") — kept in
 *  `state.style`, beside `axisColor`, and written through `applyChartStyle`
 *  only, never through `buildAxis`/`buildChartsWorkbenchSpec`: the same
 *  reason `axisColor` lives here rather than in `state.axes` (whose own
 *  `ticks`/`tickMarks`/`title`/`grid` build the base spec's axis options
 *  directly). Defaults mirror the library's own (`"center"`/`"top"`), so a
 *  reader who never opens this row omits `titleAt` entirely and renders
 *  byte-identical to before this option existed. */
export interface ChartsWorkbenchAxisTitlePlacementState {
  readonly x: GlyphChartXAxisTitleAt;
  readonly y: GlyphChartYAxisTitleAt;
}

export interface ChartsWorkbenchStyleState {
  readonly axisColor: ChartsWorkbenchAxisColorState;
  readonly axisTitlePlacement: ChartsWorkbenchAxisTitlePlacementState;
  /** The Dock's Textures row (`@glyphcss/charts`' `regionFill`). Absent is
   *  `"auto"`, so every state and `?c=` link from before the row existed
   *  renders exactly as the library's own default. */
  readonly regionFill?: GlyphChartRegionFill;
}

export interface ChartsWorkbenchState {
  readonly marks: readonly ChartsWorkbenchMark[];
  readonly nextMarkId: number;
  readonly controls: GlyphChartsWorkbenchControls;
  readonly scales: Readonly<Record<"x" | "y", ChartsWorkbenchScale>>;
  readonly axes: Readonly<Record<"x" | "y", ChartsWorkbenchAxis>>;
  readonly chart: {
    readonly title: string;
    readonly description: string;
    readonly legend: boolean;
    readonly legendPlacement: GlyphChartLegendPlacement;
    readonly titleAlign: GlyphChartTitleAlign;
    readonly titlePosition: GlyphChartTitlePosition;
  };
  readonly terminal: { readonly NO_COLOR: boolean; readonly FORCE_COLOR: boolean };
  readonly data: ChartsWorkbenchDataState;
  readonly style: ChartsWorkbenchStyleState;
  // 3D (packet C3, AGENTS.md's "Charts 3D"): no separate dimension toggle —
  // the mark card's "Surface" type IS the switch to 3D (`select-3d-dataset`/
  // `select-3d-table`), and picking any 2D type switches back
  // (`set-mark-type` forces `dimension: "2d"`, below). `chart3d` stays
  // populated even in 2D mode (a fresh default, never `undefined`) so
  // switching INTO 3D never needs a null check — the 2D render path simply
  // never reads it.
  readonly dimension: "2d" | "3d";
  readonly chart3d: Charts3dViewState;
  // Packet C4, item 3 — the shared `Instrument3DEffectsFolder`'s own state
  // shape, mirroring `/diagrams`' own top-level `effect3d` field exactly
  // (never nested inside `chart3d`: an effect is a PREVIEW-ONLY live-scene
  // concern, not part of what `resolveCharts3dView` builds a mark from).
  // Always populated (a fresh default, never `undefined`) so switching INTO
  // 3D needs no null check, same as `chart3d` itself.
  readonly effect3d: Instrument3DEffectsState;
}

export function editableMark(mark: GlyphChartMark, id: number): ChartsWorkbenchMark {
  const numeric = mark.data.every((v) => typeof v === "number");
  const indexKey = mark.type === "funnel" ? "stage" : "x";
  const valueKey = mark.type === "funnel" ? "value" : "y";
  return {
    id,
    type: mark.type,
    dataText: JSON.stringify(mark.data, null, 2),
    channels: Object.fromEntries(
      chartRelevantChannels(mark.type).map((key) => [
        key,
        mark.channels[key] ?? (numeric && key === indexKey ? "index" : numeric && key === valueKey ? "value" : ""),
      ]),
    ),
    transform: mark.transform?.kind ?? "none",
    options: { ...mark.options },
  };
}

export const autoScale = (): ChartsWorkbenchScale => ({ type: "auto", min: "", max: "" });

export const autoAxis = (): ChartsWorkbenchAxis => ({ ticks: 0, tickMarks: true, title: "", grid: false });

export const defaultAxisColor = (): ChartsWorkbenchAxisColorState => ({
  mode: "shared",
  shared: CHARTS_AXIS_DEFAULT_COLOR,
  x: CHARTS_AXIS_DEFAULT_COLOR,
  y: CHARTS_AXIS_DEFAULT_COLOR,
});

export const defaultAxisTitlePlacement = (): ChartsWorkbenchAxisTitlePlacementState => ({ x: "center", y: "top" });

/** Read straight off `InstrumentWorkbench/Instrument3DEffectsFolder`'s own
 *  constants (never a page-side `"none"`/`"all"` copy), mirroring
 *  `GLYPH_DIAGRAMS_WORKBENCH_DEFAULT_EFFECT3D`'s exact shape. */
export const CHARTS_WORKBENCH_DEFAULT_EFFECT3D: Instrument3DEffectsState = {
  effectId: INSTRUMENT_3D_EFFECT_NONE,
  targetId: INSTRUMENT_3D_EFFECT_ALL_TARGET,
};

export function createChartsWorkbenchState(): ChartsWorkbenchState {
  const preset = CHART_PRESETS[0]!;
  return {
    marks: preset.spec.marks.map((mark, i) => editableMark(mark, i + 1)),
    nextMarkId: preset.spec.marks.length + 1,
    controls: { target: "web", overrides: {} },
    scales: { x: autoScale(), y: autoScale() },
    axes: { x: autoAxis(), y: autoAxis() },
    chart: {
      title: preset.label,
      description: "",
      legend: true,
      legendPlacement: "bottom",
      titleAlign: "center",
      titlePosition: "top",
    },
    terminal: { NO_COLOR: false, FORCE_COLOR: false },
    data: { source: null, pipeline: [] },
    style: { axisColor: defaultAxisColor(), axisTitlePlacement: defaultAxisTitlePlacement() },
    dimension: "2d",
    chart3d: createCharts3dViewState(),
    effect3d: CHARTS_WORKBENCH_DEFAULT_EFFECT3D,
  };
}

export function parseChartMarkData(mark: ChartsWorkbenchMark): GlyphChartMark["data"] {
  let data: unknown;
  try {
    data = JSON.parse(mark.dataText);
  } catch {
    throw new TypeError(`Mark ${mark.id}: Invalid JSON. Enter an array of numbers or records.`);
  }
  if (
    !Array.isArray(data) ||
    data.some((row) => typeof row !== "number" && (typeof row !== "object" || row === null || Array.isArray(row)))
  ) {
    throw new TypeError(`Mark ${mark.id}: data must be an array of numbers or records.`);
  }
  return data;
}

export function buildMark(mark: ChartsWorkbenchMark): GlyphChartMark {
  const data = parseChartMarkData(mark);
  const numeric = data.every((row) => typeof row === "number");
  const channels = Object.fromEntries(
    chartRelevantChannels(mark.type).flatMap((key) => {
      const field = mark.channels[key];
      if (!field || mark.type === "rule") return [];
      // Literal channel arrays keep index/value assignments executable through JSON.
      const value = numeric && field === "index" ? data.map((_, i) => i) : numeric && field === "value" ? data : field;
      return [[key, value]];
    }),
  );
  // Sankey/funnel have no x/y scale for a transform to act on (`bad-options`
  // at render time) — a mark switched to one of these TYPES while its own
  // `transform` state still holds a value from a previous type (e.g. the
  // "Stacked bar" preset) must not forward it, since the Transform select
  // being disabled for these types doesn't clear stale state on its own.
  const forwardsTransform = mark.type !== "sankey" && mark.type !== "funnel";
  return {
    type: mark.type,
    data,
    channels,
    ...(forwardsTransform && mark.transform !== "none" ? { transform: { kind: mark.transform } } : {}),
    options: mark.options,
  };
}

export function scaleType(scale: ChartsWorkbenchScale): GlyphChartScaleOptions {
  return scale.type === "auto" ? {} : { type: scale.type };
}

function buildScale(
  scale: ChartsWorkbenchScale,
  inferred?: ReturnType<typeof glyphChartScaleDomains>["x"],
): GlyphChartScaleOptions {
  const opts: GlyphChartScaleOptions = scale.type === "auto" ? {} : { type: scale.type };
  if (!scale.min.trim() && !scale.max.trim()) return opts;
  const type = scale.type === "auto" ? inferred!.type : scale.type;
  const parse = (value: string) => (type === "time" || type === "band" ? value : Number(value));
  if (type === "band") {
    const categories = inferred!.domain.map(String);
    const start = scale.min.trim() ? categories.indexOf(scale.min) : 0;
    const end = scale.max.trim() ? categories.indexOf(scale.max) : categories.length - 1;
    if (start < 0 || end < 0 || start >= end)
      throw new TypeError("Band bounds must name at least two categories in data order.");
    return { type, domain: categories.slice(start, end + 1) };
  }
  const domain = [
    scale.min.trim() ? parse(scale.min) : inferred!.domain[0]!,
    scale.max.trim() ? parse(scale.max) : inferred!.domain.at(-1)!,
  ];
  return { type, domain: domain.map((value) => (value instanceof Date ? value.toISOString() : value)) };
}

function buildAxis(axis: ChartsWorkbenchAxis): GlyphChartAxisOptions {
  return {
    ...(axis.ticks > 0 ? { ticks: axis.ticks } : {}),
    tickMarks: axis.tickMarks,
    ...(axis.title.trim() ? { title: axis.title } : {}),
    grid: axis.grid,
  };
}

export function buildChartsWorkbenchSpec(state: ChartsWorkbenchState): GlyphChartSpec {
  const spec = glyphChartPlot({
    marks: state.marks.map(buildMark),
    scales: { x: scaleType(state.scales.x), y: scaleType(state.scales.y) },
    axes: { x: buildAxis(state.axes.x), y: buildAxis(state.axes.y) },
    title: { text: state.chart.title, align: state.chart.titleAlign, position: state.chart.titlePosition },
    description: state.chart.description,
    legend: state.chart.legend ? { placement: state.chart.legendPlacement } : false,
  });
  const needsDomain = [state.scales.x, state.scales.y].some((scale) => scale.min.trim() || scale.max.trim());
  const inferred = needsDomain ? glyphChartScaleDomains(spec) : undefined;
  return {
    ...spec,
    scales: { x: buildScale(state.scales.x, inferred?.x), y: buildScale(state.scales.y, inferred?.y) },
  };
}
