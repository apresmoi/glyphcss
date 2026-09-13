import {
  GLYPH_CHART_TARGET_DEFAULTS,
  glyphChartArc, glyphChartArea, glyphChartBar, glyphChartCell, glyphChartDot, glyphChartFunnel,
  glyphChartLine, glyphChartPlot, glyphChartRect, glyphChartRule, glyphChartSankey, glyphChartText,
  glyphChartScaleDomains,
  type GlyphChartAxisOptions, type GlyphChartCharset, type GlyphChartColorMode, type GlyphChartDetail,
  type GlyphChartLegendPlacement,
  type GlyphChartMark, type GlyphChartMarkOptions, type GlyphChartMarkType,
  type GlyphChartRenderOptions, type GlyphChartScaleOptions, type GlyphChartSpec,
  type GlyphChartTarget, type GlyphChartTitleAlign, type GlyphChartTitlePosition, type GlyphChartTransformKind,
} from "@glyphcss/charts";
import type { PipelineStep } from "../../lib/dataPipeline";
import { profileRows } from "../../lib/dataProfile";
import { buildDatasetMark, resolveChartsDataRows, xChannelIsDate, type ChartsDataSource, type ChartsRecommendedChannels } from "./chartsDataSource";
import { CHARTS_AXIS_DEFAULT_COLOR } from "./chartsAxisDefaultColor";

export type { ChartsDataSource, ChartsRecommendedChannels } from "./chartsDataSource";
export { profileChartsData, resolveChartsDataRows, xChannelIsDate } from "./chartsDataSource";
export { CHARTS_DATASETS, findChartsDataset } from "./datasets";
export type { ChartsDataset } from "./datasets";

export const CHART_TARGETS = ["chat", "terminal", "web"] as const;
export const CHART_CHARSETS = ["ascii", "box", "blocks", "braille"] as const;
export const CHART_COLORS = ["none", "ansi16", "ansi256", "truecolor", "css"] as const;
export const CHART_DETAILS = ["auto", "faithful", "balanced", "simplified"] as const;
// Owner packet items 1/2/3 — legend placement and title align/position, each
// with a matching icon-button group in the Chart dock folder (`ChartsDock.tsx`).
export const CHART_LEGEND_PLACEMENTS = ["bottom", "top-left", "top-right", "bottom-left", "bottom-right", "title"] as const;
export const CHART_TITLE_ALIGNS = ["left", "center", "right"] as const;
export const CHART_TITLE_POSITIONS = ["top", "bottom"] as const;
export const CHART_MARK_TYPES = ["line", "area", "bar", "dot", "arc", "rect", "cell", "text", "rule", "sankey", "funnel"] as const;
export const CHART_TRANSFORMS = ["none", "stack", "group", "normalize", "bin", "window"] as const;
export const CHART_SCALE_TYPES = ["auto", "linear", "log", "sqrt", "time", "band"] as const;
// Colour controls (this packet): a shared axis colour or one swatch per
// axis, and a default per-series swatch palette (a local copy of
// `@glyphcss/charts`' own `SERIES_COLORS` — that constant isn't part of the
// package's public surface, and these are just starting values a reader can
// repick, not a shared source of truth two modules must agree on byte for
// byte).
export const CHART_AXIS_COLOR_MODES = ["shared", "per-axis"] as const;
export const CHARTS_SERIES_PALETTE: readonly string[] = ["#3b82f6", "#f97316", "#22c55e", "#ef4444", "#a855f7", "#06b6d4", "#eab308", "#ec4899"];
export const CHART_CARTESIAN_CHANNELS = ["x", "y", "fill", "label"] as const;
export const CHART_SANKEY_CHANNELS = ["source", "target", "value"] as const;
export const CHART_FUNNEL_CHANNELS = ["stage", "value"] as const;
/** Full channel vocabulary the editable-mark/URL-codec data model round-trips — a mark's own RELEVANT subset comes from `chartRelevantChannels`. */
export const CHART_CHANNELS = [...CHART_CARTESIAN_CHANNELS, ...CHART_SANKEY_CHANNELS, "stage"] as const;
type Channel = typeof CHART_CHANNELS[number];
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
  };
}
export type GlyphChartsWorkbenchControlAction =
  | { type: "target"; value: GlyphChartTarget }
  | { type: "charset"; value: GlyphChartCharset }
  | { type: "color"; value: GlyphChartColorMode }
  | { type: "width" | "height"; value: number }
  | { type: "detail"; value: GlyphChartDetail }
  | { type: "reset" };

/** Explicit choices survive target changes, even when equal to the old default. */
export function reduceGlyphChartsWorkbenchControls(state: GlyphChartsWorkbenchControls, action: GlyphChartsWorkbenchControlAction): GlyphChartsWorkbenchControls {
  if (action.type === "target") return { ...state, target: action.value };
  if (action.type === "reset") return { target: state.target, overrides: {} };
  return { ...state, overrides: { ...state.overrides, [action.type]: action.value } };
}
export function resolveGlyphChartsWorkbenchControls(state: GlyphChartsWorkbenchControls) {
  return { target: state.target, ...GLYPH_CHART_TARGET_DEFAULTS[state.target], ...state.overrides };
}

const SAMPLE = [3, 5, 2, 8, 6, 9, 4];
const SERIES = ["North", "South"].flatMap((region, i) => SAMPLE.map((value, month) => ({ month, value: value + i * 2, region })));
const BARS = ["Jan", "Feb", "Mar", "Apr"].map((month, i) => ({ month, value: SAMPLE[i]! }));
const STACKED = ["Jan", "Feb", "Mar", "Apr"].flatMap((month, i) => [
  { month, value: SAMPLE[i]!, region: "North" },
  { month, value: SAMPLE[i + 2]!, region: "South" },
]);
const SHARES = [{ browser: "Chrome", share: 65 }, { browser: "Safari", share: 20 }, { browser: "Firefox", share: 15 }];
const HEATMAP = ["Mon", "Tue", "Wed", "Thu"].flatMap((day, x) => ["AM", "Noon", "PM"].map((hour, y) => ({ day, hour, value: (x + 1) * (y + 1) })));

export function sampleChartMark(type: GlyphChartMarkType): GlyphChartMark {
  switch (type) {
    case "line": return glyphChartLine(SAMPLE);
    case "area": return glyphChartArea(SAMPLE);
    case "bar": return glyphChartBar(BARS, { x: "month", y: "value" });
    case "dot": return glyphChartDot(SAMPLE);
    case "arc": return glyphChartArc(SHARES, { y: "share", fill: "browser" });
    case "rect": return glyphChartRect(SAMPLE);
    case "cell": return glyphChartCell(HEATMAP, { x: "day", y: "hour", fill: "value" });
    case "text": return glyphChartText([{ x: 1, y: 3, label: "Peak" }, { x: 3, y: 1, label: "Low" }], { x: "x", y: "y", label: "label" });
    case "rule": return glyphChartRule([5]);
    case "sankey": return glyphChartSankey([{ from: "A", to: "B", amount: 2 }, { from: "A", to: "C", amount: 1 }], { source: "from", target: "to", value: "amount" });
    case "funnel": return glyphChartFunnel([{ stage: "Visits", count: 100 }, { stage: "Purchases", count: 20 }], { stage: "stage", value: "count" });
  }
}

// Named (packet item 4: "Presets in the tray get names ... so every tray
// chart shows a legend") — a single-mark preset gets one series name of its
// own; a preset already split by a categorical `fill` (multi-line, stacked
// bar, pie, donut) already shows a legend from its categories and needs none.
export const CHART_PRESETS: readonly { readonly id: string; readonly label: string; readonly spec: GlyphChartSpec }[] = [
  { id: "line", label: "Line", spec: glyphChartPlot({ marks: [glyphChartLine(SAMPLE, undefined, { name: "Revenue" })], title: "Line" }) },
  { id: "multi-line", label: "Multi-series line", spec: glyphChartPlot({ marks: [glyphChartLine(SERIES, { x: "month", y: "value", fill: "region" })], title: "Multi-series line" }) },
  { id: "bar", label: "Bar", spec: glyphChartPlot({ marks: [glyphChartBar(BARS, { x: "month", y: "value" }, { name: "Sales" })], title: "Bar" }) },
  { id: "stacked-bar", label: "Stacked bar", spec: glyphChartPlot({ marks: [{ ...glyphChartBar(STACKED, { x: "month", y: "value", fill: "region" }), transform: { kind: "stack" } }], title: "Stacked bar" }) },
  { id: "dot", label: "Dot", spec: glyphChartPlot({ marks: [glyphChartDot(SAMPLE, undefined, { name: "Visits" })], title: "Dot" }) },
  { id: "area", label: "Area", spec: glyphChartPlot({ marks: [glyphChartArea(SAMPLE, undefined, { name: "Traffic" })], title: "Area" }) },
  { id: "pie", label: "Pie", spec: glyphChartPlot({ marks: [sampleChartMark("arc")], title: "Pie" }) },
  { id: "donut", label: "Donut", spec: glyphChartPlot({ marks: [glyphChartArc(SHARES, { y: "share", fill: "browser" }, { innerRadius: 0.5 })], title: "Donut" }) },
  { id: "heatmap", label: "Heatmap", spec: glyphChartPlot({ marks: [glyphChartCell(HEATMAP, { x: "day", y: "hour", fill: "value" }, { name: "Activity" })], title: "Heatmap" }) },
  { id: "line-rule", label: "Line + rule", spec: glyphChartPlot({ marks: [glyphChartLine(SAMPLE, undefined, { name: "Revenue" }), glyphChartRule([5], { name: "Target" })], title: "Line + rule" }) },
  { id: "sankey", label: "Sankey", spec: glyphChartPlot({ marks: [glyphChartSankey([{ from: "Coal", to: "Power", amount: 40 }, { from: "Gas", to: "Power", amount: 60 }, { from: "Power", to: "Homes", amount: 70 }, { from: "Power", to: "Industry", amount: 30 }], { source: "from", target: "to", value: "amount" })], title: "Sankey" }) },
  { id: "funnel", label: "Funnel", spec: glyphChartPlot({ marks: [glyphChartFunnel([{ stage: "Visits", count: 1000 }, { stage: "Signups", count: 300 }, { stage: "Purchases", count: 80 }], { stage: "stage", value: "count" })], title: "Funnel" }) },
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
   *  per series in `chartMarkSeriesNames` order. Kept OUT of `options`
   *  (which mirrors the real `GlyphChartMarkOptions` shape exactly) because
   *  the built `@glyphcss/charts` in this worktree doesn't accept it yet —
   *  see `chartsWorkbenchRender.ts`'s `applyChartStyle`, the one place this
   *  reaches the rendered spec. `undefined` = unset (library default). */
  readonly color?: string | readonly string[];
}
export interface ChartsWorkbenchScale {
  readonly type: typeof CHART_SCALE_TYPES[number];
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
  readonly mode: typeof CHART_AXIS_COLOR_MODES[number];
  readonly shared: string;
  readonly x: string;
  readonly y: string;
}
export interface ChartsWorkbenchStyleState {
  readonly axisColor: ChartsWorkbenchAxisColorState;
}

export interface ChartsWorkbenchState {
  readonly marks: readonly ChartsWorkbenchMark[];
  readonly nextMarkId: number;
  readonly controls: GlyphChartsWorkbenchControls;
  readonly scales: Readonly<Record<"x" | "y", ChartsWorkbenchScale>>;
  readonly axes: Readonly<Record<"x" | "y", ChartsWorkbenchAxis>>;
  readonly chart: {
    readonly title: string; readonly description: string; readonly legend: boolean;
    readonly legendPlacement: GlyphChartLegendPlacement;
    readonly titleAlign: GlyphChartTitleAlign; readonly titlePosition: GlyphChartTitlePosition;
  };
  readonly terminal: { readonly NO_COLOR: boolean; readonly FORCE_COLOR: boolean };
  readonly data: ChartsWorkbenchDataState;
  readonly style: ChartsWorkbenchStyleState;
}
export type ChartsWorkbenchAction =
  | { type: "add-mark"; markType?: GlyphChartMarkType }
  | { type: "remove-mark"; id: number }
  | { type: "update-mark"; id: number; patch: Partial<Omit<ChartsWorkbenchMark, "id">> }
  | { type: "sample-mark"; id: number }
  | { type: "apply-preset"; id: string }
  | { type: "set-control"; control: GlyphChartsWorkbenchControlAction }
  | { type: "reset-target" }
  | { type: "set-scale"; axis: "x" | "y"; patch: Partial<ChartsWorkbenchScale> }
  | { type: "set-axis"; axis: "x" | "y"; patch: Partial<ChartsWorkbenchAxis> }
  | { type: "set-chart"; patch: Partial<ChartsWorkbenchState["chart"]> }
  | { type: "set-terminal"; flag: "NO_COLOR" | "FORCE_COLOR"; value: boolean }
  // Table editor (packet item 7) — setCell/addRow/removeRow/addColumn/
  // removeColumn/renameColumn, spelled with this file's own kebab-case
  // action-type convention (every other action here already is).
  | { type: "set-cell"; id: number; row: number; column: string; value: string }
  | { type: "add-row"; id: number }
  | { type: "remove-row"; id: number; row: number }
  | { type: "add-column"; id: number; column: string }
  | { type: "remove-column"; id: number; column: string }
  | { type: "rename-column"; id: number; column: string; next: string }
  // Data folder (AGENTS.md's "Charts" — "Data layer"): picking a dataset or
  // custom source, editing the pipeline, and committing ("Apply") a mark
  // type + channel mapping built from the resolved rows are three separate
  // actions because Apply needs the OTHER two already reduced (a portal
  // component reads `state.data` to compute what Apply's own button offers).
  | { type: "set-data-source"; source: ChartsDataSource | null }
  | { type: "set-pipeline"; pipeline: readonly PipelineStep[] }
  | { type: "apply-data"; mark: GlyphChartMarkType; channels: ChartsRecommendedChannels }
  // Colour controls (this packet).
  | { type: "set-axis-color-mode"; mode: typeof CHART_AXIS_COLOR_MODES[number] }
  | { type: "set-axis-color"; which: "shared" | "x" | "y"; color: string }
  | { type: "set-mark-color"; id: number; color: string | readonly string[] | undefined };

function editableMark(mark: GlyphChartMark, id: number): ChartsWorkbenchMark {
  const numeric = mark.data.every((v) => typeof v === "number");
  const indexKey = mark.type === "funnel" ? "stage" : "x";
  const valueKey = mark.type === "funnel" ? "value" : "y";
  return {
    id, type: mark.type, dataText: JSON.stringify(mark.data, null, 2),
    channels: Object.fromEntries(chartRelevantChannels(mark.type).map((key) => [key,
      mark.channels[key] ?? (numeric && key === indexKey ? "index" : numeric && key === valueKey ? "value" : ""),
    ])),
    transform: mark.transform?.kind ?? "none", options: { ...mark.options },
  };
}
const autoScale = (): ChartsWorkbenchScale => ({ type: "auto", min: "", max: "" });
const autoAxis = (): ChartsWorkbenchAxis => ({ ticks: 0, tickMarks: true, title: "", grid: false });
const defaultAxisColor = (): ChartsWorkbenchAxisColorState => ({ mode: "shared", shared: CHARTS_AXIS_DEFAULT_COLOR, x: CHARTS_AXIS_DEFAULT_COLOR, y: CHARTS_AXIS_DEFAULT_COLOR });
export function createChartsWorkbenchState(): ChartsWorkbenchState {
  const preset = CHART_PRESETS[0]!;
  return {
    marks: preset.spec.marks.map((mark, i) => editableMark(mark, i + 1)), nextMarkId: preset.spec.marks.length + 1,
    controls: { target: "web", overrides: {} }, scales: { x: autoScale(), y: autoScale() }, axes: { x: autoAxis(), y: autoAxis() },
    chart: { title: preset.label, description: "", legend: true, legendPlacement: "bottom", titleAlign: "center", titlePosition: "top" },
    terminal: { NO_COLOR: false, FORCE_COLOR: false },
    data: { source: null, pipeline: [] },
    style: { axisColor: defaultAxisColor() },
  };
}
function isDefaultAxisColor(axisColor: ChartsWorkbenchAxisColorState): boolean {
  return axisColor.mode === "shared" && axisColor.shared === CHARTS_AXIS_DEFAULT_COLOR
    && axisColor.x === CHARTS_AXIS_DEFAULT_COLOR && axisColor.y === CHARTS_AXIS_DEFAULT_COLOR;
}

/** Identity string for a data source — used only to decide whether picking
 *  a NEW source should drop the existing pipeline (its steps almost
 *  certainly name columns the new source doesn't have). */
function dataSourceKey(source: ChartsDataSource | null): string {
  if (!source) return "";
  return source.kind === "dataset" ? `dataset:${source.id}` : `custom:${source.filename ?? ""}`;
}
export function reduceChartsWorkbenchState(state: ChartsWorkbenchState, action: ChartsWorkbenchAction): ChartsWorkbenchState {
  switch (action.type) {
    case "add-mark": return { ...state, marks: [...state.marks, editableMark(sampleChartMark(action.markType ?? "line"), state.nextMarkId)], nextMarkId: state.nextMarkId + 1 };
    case "remove-mark": return { ...state, marks: state.marks.filter((mark) => mark.id !== action.id) };
    case "update-mark": return { ...state, marks: state.marks.map((mark) => mark.id === action.id ? { ...mark, ...action.patch } : mark) };
    case "sample-mark": return { ...state, marks: state.marks.map((mark) => mark.id === action.id ? editableMark(sampleChartMark(mark.type), mark.id) : mark) };
    case "apply-preset": {
      const preset = CHART_PRESETS.find((p) => p.id === action.id);
      if (!preset) return state;
      return { ...state, marks: preset.spec.marks.map((mark, i) => editableMark(mark, state.nextMarkId + i)),
        nextMarkId: state.nextMarkId + preset.spec.marks.length, scales: { x: autoScale(), y: autoScale() }, axes: { x: autoAxis(), y: autoAxis() },
        chart: { ...state.chart, title: preset.label, description: preset.spec.description ?? "" } };
    }
    case "set-control": return { ...state, controls: reduceGlyphChartsWorkbenchControls(state.controls, action.control) };
    case "reset-target": {
      // The Output folder's header reset also clears the colour controls
      // (this packet) — both stay no-ops (same array/object reference)
      // when nothing was customised, matching `reset.marks === state.marks`
      // for a reset that never touched a mark's colour.
      const marks = state.marks.some((m) => m.color !== undefined)
        ? state.marks.map((m) => m.color === undefined ? m : { ...m, color: undefined })
        : state.marks;
      const style = isDefaultAxisColor(state.style.axisColor) ? state.style : { axisColor: defaultAxisColor() };
      return { ...state, controls: reduceGlyphChartsWorkbenchControls(state.controls, { type: "reset" }), marks, style };
    }
    case "set-axis-color-mode": return { ...state, style: { ...state.style, axisColor: { ...state.style.axisColor, mode: action.mode } } };
    case "set-axis-color": return { ...state, style: { ...state.style, axisColor: { ...state.style.axisColor, [action.which]: action.color } } };
    case "set-mark-color": return { ...state, marks: state.marks.map((mark) => mark.id === action.id ? { ...mark, color: action.color } : mark) };
    case "set-scale": return { ...state, scales: { ...state.scales, [action.axis]: { ...state.scales[action.axis], ...action.patch } } };
    case "set-axis": return { ...state, axes: { ...state.axes, [action.axis]: { ...state.axes[action.axis], ...action.patch } } };
    case "set-chart": return { ...state, chart: { ...state.chart, ...action.patch } };
    case "set-terminal": return { ...state, terminal: { ...state.terminal, [action.flag]: action.value } };
    case "set-cell": return { ...state, marks: state.marks.map((mark) => mark.id === action.id ? withTable(mark, (t) => tableSetCell(t, action.row, action.column, action.value)) : mark) };
    case "add-row": return { ...state, marks: state.marks.map((mark) => mark.id === action.id ? withTable(mark, tableAddRow) : mark) };
    case "remove-row": return { ...state, marks: state.marks.map((mark) => mark.id === action.id ? withTable(mark, (t) => tableRemoveRow(t, action.row)) : mark) };
    case "add-column": return { ...state, marks: state.marks.map((mark) => mark.id === action.id ? withTable(mark, (t) => tableAddColumn(t, action.column)) : mark) };
    case "remove-column": return { ...state, marks: state.marks.map((mark) => mark.id === action.id ? withTable(mark, (t) => tableRemoveColumn(t, action.column)) : mark) };
    case "rename-column": return { ...state, marks: state.marks.map((mark) => {
      if (mark.id !== action.id) return mark;
      const renamed = withTable(mark, (t) => tableRenameColumn(t, action.column, action.next));
      if (renamed === mark || renamed.dataText === mark.dataText) return renamed;
      // final-gate-2 (codex #6): a channel naming the OLD column (e.g.
      // `x: "month"`) went stale the moment the column itself was renamed
      // — the data no longer has that field at all, and the mark then
      // reached the canvas with an unresolved channel, thrown as
      // GLYPH_CHART_INTERNAL_COORD. Every channel that named exactly the
      // renamed column follows it to the new name; any other channel value
      // (a different field, an accessor, "index"/"value") is untouched.
      const channels = Object.fromEntries(Object.entries(renamed.channels).map(([key, value]) => [key, value === action.column ? action.next : value])) as ChartsWorkbenchMark["channels"];
      return { ...renamed, channels };
    }) };
    case "set-data-source": {
      // A new source's pipeline steps almost certainly name columns the
      // OLD source doesn't share — picking a genuinely different source
      // drops them; re-picking the same one (e.g. toggling Custom's file
      // input) keeps whatever the reader already built.
      const samePipeline = dataSourceKey(action.source) === dataSourceKey(state.data.source);
      return { ...state, data: { source: action.source, pipeline: samePipeline ? state.data.pipeline : [] } };
    }
    case "set-pipeline": return { ...state, data: { ...state.data, pipeline: action.pipeline } };
    case "apply-data": {
      if (!state.data.source) return state;
      const resolved = resolveChartsDataRows(state.data.source, state.data.pipeline);
      if (!resolved.ok) return state;
      const mark = buildDatasetMark(state.nextMarkId, action.mark, resolved.rows, action.channels);
      const isDate = xChannelIsDate(profileRows(resolved.rows), action.channels.x);
      return {
        ...state, marks: [mark], nextMarkId: state.nextMarkId + 1,
        scales: { x: isDate ? { type: "time", min: "", max: "" } : autoScale(), y: autoScale() },
        axes: { x: autoAxis(), y: autoAxis() },
        chart: resolved.dataset ? { ...state.chart, title: resolved.dataset.title, description: resolved.dataset.description } : state.chart,
      };
    }
  }
}

export function parseChartMarkData(mark: ChartsWorkbenchMark): GlyphChartMark["data"] {
  let data: unknown;
  try { data = JSON.parse(mark.dataText); }
  catch { throw new TypeError(`Mark ${mark.id}: Invalid JSON. Enter an array of numbers or records.`); }
  if (!Array.isArray(data) || data.some((row) => typeof row !== "number" && (typeof row !== "object" || row === null || Array.isArray(row)))) {
    throw new TypeError(`Mark ${mark.id}: data must be an array of numbers or records.`);
  }
  return data;
}
export function chartMarkFields(mark: ChartsWorkbenchMark): string[] {
  try {
    const data = parseChartMarkData(mark);
    return data.every((row) => typeof row === "number") ? ["index", "value"]
      : [...new Set(data.flatMap((row) => typeof row === "number" ? [] : Object.keys(row)))];
  } catch { return []; }
}

/** Resolves one channel's raw per-row values the same way `buildMark` does
 *  (the numeric-array "index"/"value" pseudo-fields, or a plain record
 *  field lookup) — the shared step `chartMarkSeriesNames` below needs for
 *  every channel it reads. */
function chartMarkChannelValues(data: readonly unknown[], numeric: boolean, field: string | undefined): unknown[] | undefined {
  if (!field) return undefined;
  if (numeric && field === "index") return data.map((_, i) => i);
  if (numeric && field === "value") return data as unknown[];
  return data.map((row) => typeof row === "object" && row !== null && !Array.isArray(row) ? (row as Record<string, unknown>)[field] : undefined);
}

/**
 * The distinct series identities a mark's per-series colour swatches should
 * line up with, in the same first-appearance ROW ORDER `@glyphcss/charts`'
 * own `chartSeries` (`packages/charts/src/series.ts`) groups by — close
 * enough for a colour-picker UI without reaching into that module's
 * private resolve/series pipeline: arc slices (`fill` ?? `label` ?? index,
 * positive values only, mirroring the pie's own "no swatch for a
 * nonpositive slice" rule), sankey SOURCE nodes, funnel STAGES, and a
 * categorical `fill`/`stroke` split for line/area/bar/dot/rect. `null`
 * means the mark is single-series — one plain colour swatch, not a list.
 */
export function chartMarkSeriesNames(mark: ChartsWorkbenchMark): string[] | null {
  let data: unknown[];
  try { data = parseChartMarkData(mark); } catch { return null; }
  const numeric = data.every((row) => typeof row === "number");
  const names = (values: readonly unknown[] | undefined): string[] => {
    const seen: string[] = [];
    for (const value of values ?? []) {
      const name = String(value);
      if (!seen.includes(name)) seen.push(name);
    }
    return seen;
  };
  if (mark.type === "arc") {
    const fill = chartMarkChannelValues(data, numeric, mark.channels.fill);
    const label = chartMarkChannelValues(data, numeric, mark.channels.label);
    const y = chartMarkChannelValues(data, numeric, mark.channels.y);
    const seen: string[] = [];
    data.forEach((_, i) => {
      const value = y ? Number(y[i]) : NaN;
      if (!(Number.isFinite(value) && value > 0)) return;
      const name = String(fill?.[i] ?? label?.[i] ?? i);
      if (!seen.includes(name)) seen.push(name);
    });
    return seen.length ? seen : null;
  }
  if (mark.type === "sankey") {
    const list = names(chartMarkChannelValues(data, numeric, mark.channels.source));
    return list.length ? list : null;
  }
  if (mark.type === "funnel") {
    const list = names(chartMarkChannelValues(data, numeric, mark.channels.stage));
    return list.length ? list : null;
  }
  if (["line", "area", "bar", "dot", "rect"].includes(mark.type)) {
    const channel = (["fill", "stroke"] as const).find((c) => mark.channels[c]);
    if (!channel) return null;
    const list = names(chartMarkChannelValues(data, numeric, mark.channels[channel]));
    return list.length > 1 ? list : null;
  }
  return null;
}

// ── Table editor (packet item 7) ────────────────────────────────────────
//
// The table and the JSON textarea are ONE state: both read/write the same
// `dataText` string, so switching tabs never loses an edit either view
// made. A numeric array is presented as a single "value" column — the
// same pseudo-field `chartMarkFields`'s channel selects already offer —
// and a table edit that TOUCHES that shape (adding/renaming a column)
// promotes it to a record array on the spot, `value` included, so no data
// point silently disappears.
export type ChartsWorkbenchCell = string | number;
export type ChartsWorkbenchTableRow = Readonly<Record<string, ChartsWorkbenchCell>>;
export interface ChartsWorkbenchTable {
  readonly columns: readonly string[];
  readonly rows: readonly ChartsWorkbenchTableRow[];
  /** `false` when `dataText` isn't currently valid table JSON (an array of numbers/records) — the table view shows the JSON tab's own error instead. */
  readonly ok: boolean;
}

function recordRow(row: unknown): ChartsWorkbenchTableRow {
  return typeof row === "object" && row !== null && !Array.isArray(row) ? row as ChartsWorkbenchTableRow : {};
}

/** Pure derivation of the table view from `dataText` — no DOM, easily unit-tested. */
export function chartMarkTable(mark: ChartsWorkbenchMark): ChartsWorkbenchTable {
  let data: unknown[];
  try { data = parseChartMarkData(mark); }
  catch { return { columns: [], rows: [], ok: false }; }
  if (data.every((row) => typeof row === "number")) {
    return { columns: ["value"], rows: data.map((value) => ({ value: value as number })), ok: true };
  }
  const columns = [...new Set(data.flatMap((row) => Object.keys(recordRow(row))))];
  return { columns, rows: data.map(recordRow), ok: true };
}

function tableToDataText(table: ChartsWorkbenchTable): string {
  // A single numeric "value" column round-trips back to the plain number-array shorthand.
  if (table.columns.length === 1 && table.columns[0] === "value" && table.rows.every((row) => typeof row.value === "number")) {
    return JSON.stringify(table.rows.map((row) => row.value), null, 2);
  }
  return JSON.stringify(table.rows.map((row) => Object.fromEntries(table.columns.map((c) => [c, row[c] ?? null]))), null, 2);
}

/** `Date`-looking strings ("2026-01-01", with or without a time part) stay
 * strings; anything else that parses as a finite number becomes one;
 * everything else (including "") stays the literal typed text. */
function parseTableCellInput(raw: string): ChartsWorkbenchCell {
  const trimmed = raw.trim();
  if (trimmed === "") return raw;
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return raw;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : raw;
}

function withTable(mark: ChartsWorkbenchMark, fn: (table: ChartsWorkbenchTable) => ChartsWorkbenchTable): ChartsWorkbenchMark {
  const table = chartMarkTable(mark);
  if (!table.ok) return mark;
  const next = fn(table);
  // A rejected edit (duplicate/empty column name) returns the SAME table
  // reference — skip re-serializing so a no-op action never reformats
  // `dataText`'s whitespace out from under an untouched JSON tab.
  return next === table ? mark : { ...mark, dataText: tableToDataText(next) };
}
/** `setCell` (packet item 7). */
function tableSetCell(table: ChartsWorkbenchTable, row: number, column: string, raw: string): ChartsWorkbenchTable {
  const value = parseTableCellInput(raw);
  return { ...table, rows: table.rows.map((r, i) => i === row ? { ...r, [column]: value } : r) };
}
/** `addRow`. */
function tableAddRow(table: ChartsWorkbenchTable): ChartsWorkbenchTable {
  const blank: Record<string, ChartsWorkbenchCell> = Object.fromEntries(table.columns.map((c) => [c, 0]));
  return { ...table, rows: [...table.rows, blank] };
}
/** `removeRow`. */
function tableRemoveRow(table: ChartsWorkbenchTable, row: number): ChartsWorkbenchTable {
  return { ...table, rows: table.rows.filter((_, i) => i !== row) };
}
/** `addColumn` — a numeric-array table promotes to records first (its one
 * column becomes an explicit "value" field) so the new column has somewhere
 * to live without discarding any existing point. */
function tableAddColumn(table: ChartsWorkbenchTable, column: string): ChartsWorkbenchTable {
  if (!column || table.columns.includes(column)) return table;
  return { columns: [...table.columns, column], rows: table.rows.map((r) => ({ ...r, [column]: 0 })) };
}
/** `removeColumn`. */
function tableRemoveColumn(table: ChartsWorkbenchTable, column: string): ChartsWorkbenchTable {
  return {
    columns: table.columns.filter((c) => c !== column),
    rows: table.rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => k !== column))),
  };
}
/** The name `ChartsMarkCard`'s "+ column" button uses for a freshly added
 * column — the header's own rename input (`renameColumn`) is how it gets a
 * real name. */
export function nextChartTableColumnName(existing: readonly string[]): string {
  let i = 1;
  while (existing.includes(`column${i}`)) i++;
  return `column${i}`;
}
/** `renameColumn`. */
function tableRenameColumn(table: ChartsWorkbenchTable, column: string, next: string): ChartsWorkbenchTable {
  if (!next || column === next || table.columns.includes(next)) return table;
  return {
    columns: table.columns.map((c) => c === column ? next : c),
    rows: table.rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k === column ? next : k, v]))),
  };
}
function buildMark(mark: ChartsWorkbenchMark): GlyphChartMark {
  const data = parseChartMarkData(mark);
  const numeric = data.every((row) => typeof row === "number");
  const channels = Object.fromEntries(chartRelevantChannels(mark.type).flatMap((key) => {
    const field = mark.channels[key];
    if (!field || mark.type === "rule") return [];
    // Literal channel arrays keep index/value assignments executable through JSON.
    const value = numeric && field === "index" ? data.map((_, i) => i) : numeric && field === "value" ? data : field;
    return [[key, value]];
  }));
  return { type: mark.type, data, channels, ...(mark.transform !== "none" ? { transform: { kind: mark.transform } } : {}), options: mark.options };
}
function scaleType(scale: ChartsWorkbenchScale): GlyphChartScaleOptions {
  return scale.type === "auto" ? {} : { type: scale.type };
}
function buildScale(scale: ChartsWorkbenchScale, inferred?: ReturnType<typeof glyphChartScaleDomains>["x"]): GlyphChartScaleOptions {
  const opts: GlyphChartScaleOptions = scale.type === "auto" ? {} : { type: scale.type };
  if (!scale.min.trim() && !scale.max.trim()) return opts;
  const type = scale.type === "auto" ? inferred!.type : scale.type;
  const parse = (value: string) => type === "time" || type === "band" ? value : Number(value);
  if (type === "band") {
    const categories = inferred!.domain.map(String);
    const start = scale.min.trim() ? categories.indexOf(scale.min) : 0;
    const end = scale.max.trim() ? categories.indexOf(scale.max) : categories.length - 1;
    if (start < 0 || end < 0 || start >= end) throw new TypeError("Band bounds must name at least two categories in data order.");
    return { type, domain: categories.slice(start, end + 1) };
  }
  const domain = [scale.min.trim() ? parse(scale.min) : inferred!.domain[0]!, scale.max.trim() ? parse(scale.max) : inferred!.domain.at(-1)!];
  return { type, domain: domain.map((value) => value instanceof Date ? value.toISOString() : value) };
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
    marks: state.marks.map(buildMark), scales: { x: scaleType(state.scales.x), y: scaleType(state.scales.y) },
    axes: { x: buildAxis(state.axes.x), y: buildAxis(state.axes.y) },
    title: { text: state.chart.title, align: state.chart.titleAlign, position: state.chart.titlePosition },
    description: state.chart.description,
    legend: state.chart.legend ? { placement: state.chart.legendPlacement } : false,
  });
  const needsDomain = [state.scales.x, state.scales.y].some((scale) => scale.min.trim() || scale.max.trim());
  const inferred = needsDomain ? glyphChartScaleDomains(spec) : undefined;
  return { ...spec, scales: { x: buildScale(state.scales.x, inferred?.x), y: buildScale(state.scales.y, inferred?.y) } };
}

/**
 * The raw data extent for each axis, ignoring any `min`/`max` the reader
 * has already typed — what a `RangeSlider`'s own `min`/`max` (its
 * draggable BOUNDS, padded by the caller) must be computed from, since
 * bounds computed from the CURRENT selection would shrink every time a
 * reader narrows it. Reuses the exact same `scaleType`/`buildMark`/
 * `glyphChartScaleDomains` pipeline `buildChartsWorkbenchSpec` already
 * runs for its own "blank bound" inference, just with no domain override
 * fed back in. `null` on invalid marks (bad JSON, an unresolved channel) —
 * degrade to no bounds rather than throw, since this reads on every
 * keystroke in the mark editor.
 */
export function chartsWorkbenchInferredDomains(state: ChartsWorkbenchState): ReturnType<typeof glyphChartScaleDomains> | null {
  try {
    const spec = glyphChartPlot({ marks: state.marks.map(buildMark), scales: { x: scaleType(state.scales.x), y: scaleType(state.scales.y) } });
    return glyphChartScaleDomains(spec);
  } catch { return null; }
}

/** A `RangeSlider`'s numeric domain is timestamps for a `"time"` scale,
 *  the raw number otherwise — the same two cases `buildScale`'s own
 *  `parse`/domain-mapping already distinguish. `null` for an unparsed or
 *  non-finite value (an in-progress edit, or a bound that doesn't apply to
 *  a "band" scale, which never reaches this helper). */
export function chartsScaleBoundToNumber(type: "linear" | "log" | "sqrt" | "time", raw: string): number | null {
  if (type === "time") { const t = new Date(raw).getTime(); return Number.isFinite(t) ? t : null; }
  const n = Number(raw);
  return raw.trim() !== "" && Number.isFinite(n) ? n : null;
}
/** The inverse of `chartsScaleBoundToNumber` — what `set-scale`'s `min`/`max` string fields store. */
export function chartsNumberToScaleBound(type: "linear" | "log" | "sqrt" | "time", value: number): string {
  return type === "time" ? new Date(value).toISOString() : String(value);
}
export function chartsWorkbenchRenderOptions(state: ChartsWorkbenchState): GlyphChartRenderOptions {
  // `legend` is NOT set here — it already rides in the built spec
  // (`buildChartsWorkbenchSpec`, carrying the chosen placement), and a
  // render `options.legend` would OVERRIDE that placement object with a
  // plain boolean (`resolveGlyphChartLegendOption`'s documented precedence).
  return { ...resolveGlyphChartsWorkbenchControls(state.controls), detail: state.controls.overrides.detail ?? "auto",
    ...(state.controls.target === "terminal" ? { env: { ...(state.terminal.NO_COLOR ? { NO_COLOR: "1" } : {}), ...(state.terminal.FORCE_COLOR ? { FORCE_COLOR: "1" } : {}) } } : {}) };
}
export function generateChartsWorkbenchSnippets(state: ChartsWorkbenchState) {
  const spec = buildChartsWorkbenchSpec(state);
  const options = chartsWorkbenchRenderOptions(state);
  const json = JSON.stringify(spec, null, 2);
  return { json, typescript: `import { glyphChartPlot, renderGlyphChart } from "@glyphcss/charts";\n\nconst chart = renderGlyphChart(glyphChartPlot(${json}), ${JSON.stringify(options, null, 2)});\n` };
}
