import {
  GLYPH_CHART_TARGET_DEFAULTS,
  glyphChartArc, glyphChartArea, glyphChartBar, glyphChartCell, glyphChartDot,
  glyphChartLine, glyphChartPlot, glyphChartRect, glyphChartRule, glyphChartText,
  glyphChartScaleDomains,
  type GlyphChartCharset, type GlyphChartColorMode, type GlyphChartDetail,
  type GlyphChartMark, type GlyphChartMarkOptions, type GlyphChartMarkType,
  type GlyphChartRenderOptions, type GlyphChartScaleOptions, type GlyphChartSpec,
  type GlyphChartTarget, type GlyphChartTransformKind,
} from "@glyphcss/charts";

export const CHART_TARGETS = ["chat", "terminal", "web"] as const;
export const CHART_CHARSETS = ["ascii", "box", "blocks", "braille"] as const;
export const CHART_COLORS = ["none", "ansi16", "ansi256", "truecolor", "css"] as const;
export const CHART_DETAILS = ["auto", "faithful", "balanced", "simplified"] as const;
export const CHART_MARK_TYPES = ["line", "area", "bar", "dot", "arc", "rect", "cell", "text", "rule"] as const;
export const CHART_TRANSFORMS = ["none", "stack", "group", "normalize", "bin", "window"] as const;
export const CHART_SCALE_TYPES = ["auto", "linear", "log", "sqrt", "time", "band"] as const;
export const CHART_CHANNELS = ["x", "y", "fill", "label"] as const;
type Channel = typeof CHART_CHANNELS[number];

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
  }
}

export const CHART_PRESETS: readonly { readonly id: string; readonly label: string; readonly spec: GlyphChartSpec }[] = [
  { id: "line", label: "Line", spec: glyphChartPlot({ marks: [sampleChartMark("line")], title: "Line" }) },
  { id: "multi-line", label: "Multi-series line", spec: glyphChartPlot({ marks: [glyphChartLine(SERIES, { x: "month", y: "value", fill: "region" })], title: "Multi-series line" }) },
  { id: "bar", label: "Bar", spec: glyphChartPlot({ marks: [sampleChartMark("bar")], title: "Bar" }) },
  { id: "stacked-bar", label: "Stacked bar", spec: glyphChartPlot({ marks: [{ ...glyphChartBar(STACKED, { x: "month", y: "value", fill: "region" }), transform: { kind: "stack" } }], title: "Stacked bar" }) },
  { id: "dot", label: "Dot", spec: glyphChartPlot({ marks: [sampleChartMark("dot")], title: "Dot" }) },
  { id: "area", label: "Area", spec: glyphChartPlot({ marks: [sampleChartMark("area")], title: "Area" }) },
  { id: "pie", label: "Pie", spec: glyphChartPlot({ marks: [sampleChartMark("arc")], title: "Pie" }) },
  { id: "donut", label: "Donut", spec: glyphChartPlot({ marks: [glyphChartArc(SHARES, { y: "share", fill: "browser" }, { innerRadius: 0.5 })], title: "Donut" }) },
  { id: "heatmap", label: "Heatmap", spec: glyphChartPlot({ marks: [sampleChartMark("cell")], title: "Heatmap" }) },
  { id: "line-rule", label: "Line + rule", spec: glyphChartPlot({ marks: [sampleChartMark("line"), sampleChartMark("rule")], title: "Line + rule" }) },
];

export interface ChartsWorkbenchMark {
  readonly id: number;
  readonly type: GlyphChartMarkType;
  /** Draft JSON belongs to the reducer too; invalid edits remain visible and recoverable. */
  readonly dataText: string;
  readonly channels: Readonly<Partial<Record<Channel, string>>>;
  readonly transform: "none" | GlyphChartTransformKind;
  readonly options: GlyphChartMarkOptions;
}
export interface ChartsWorkbenchScale {
  readonly type: typeof CHART_SCALE_TYPES[number];
  readonly min: string;
  readonly max: string;
}
export interface ChartsWorkbenchState {
  readonly marks: readonly ChartsWorkbenchMark[];
  readonly nextMarkId: number;
  readonly controls: GlyphChartsWorkbenchControls;
  readonly scales: Readonly<Record<"x" | "y", ChartsWorkbenchScale>>;
  readonly chart: { readonly title: string; readonly description: string; readonly legend: boolean };
  readonly terminal: { readonly NO_COLOR: boolean; readonly FORCE_COLOR: boolean };
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
  | { type: "set-chart"; patch: Partial<ChartsWorkbenchState["chart"]> }
  | { type: "set-terminal"; flag: "NO_COLOR" | "FORCE_COLOR"; value: boolean };

function editableMark(mark: GlyphChartMark, id: number): ChartsWorkbenchMark {
  const numeric = mark.data.every((v) => typeof v === "number");
  return {
    id, type: mark.type, dataText: JSON.stringify(mark.data, null, 2),
    channels: Object.fromEntries(CHART_CHANNELS.map((key) => [key,
      mark.channels[key] ?? (numeric && key === "x" ? "index" : numeric && key === "y" ? "value" : ""),
    ])),
    transform: mark.transform?.kind ?? "none", options: { ...mark.options },
  };
}
const autoScale = (): ChartsWorkbenchScale => ({ type: "auto", min: "", max: "" });
export function createChartsWorkbenchState(): ChartsWorkbenchState {
  const preset = CHART_PRESETS[0]!;
  return {
    marks: preset.spec.marks.map((mark, i) => editableMark(mark, i + 1)), nextMarkId: preset.spec.marks.length + 1,
    controls: { target: "chat", overrides: {} }, scales: { x: autoScale(), y: autoScale() },
    chart: { title: preset.label, description: "", legend: true }, terminal: { NO_COLOR: false, FORCE_COLOR: false },
  };
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
        nextMarkId: state.nextMarkId + preset.spec.marks.length, scales: { x: autoScale(), y: autoScale() },
        chart: { ...state.chart, title: preset.label, description: preset.spec.description ?? "" } };
    }
    case "set-control": return { ...state, controls: reduceGlyphChartsWorkbenchControls(state.controls, action.control) };
    case "reset-target": return { ...state, controls: reduceGlyphChartsWorkbenchControls(state.controls, { type: "reset" }) };
    case "set-scale": return { ...state, scales: { ...state.scales, [action.axis]: { ...state.scales[action.axis], ...action.patch } } };
    case "set-chart": return { ...state, chart: { ...state.chart, ...action.patch } };
    case "set-terminal": return { ...state, terminal: { ...state.terminal, [action.flag]: action.value } };
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
function buildMark(mark: ChartsWorkbenchMark): GlyphChartMark {
  const data = parseChartMarkData(mark);
  const numeric = data.every((row) => typeof row === "number");
  const channels = Object.fromEntries(CHART_CHANNELS.flatMap((key) => {
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
export function buildChartsWorkbenchSpec(state: ChartsWorkbenchState): GlyphChartSpec {
  const spec = glyphChartPlot({ marks: state.marks.map(buildMark), scales: { x: scaleType(state.scales.x), y: scaleType(state.scales.y) }, title: state.chart.title, description: state.chart.description });
  const needsDomain = [state.scales.x, state.scales.y].some((scale) => scale.min.trim() || scale.max.trim());
  const inferred = needsDomain ? glyphChartScaleDomains(spec) : undefined;
  return { ...spec, scales: { x: buildScale(state.scales.x, inferred?.x), y: buildScale(state.scales.y, inferred?.y) } };
}
export function chartsWorkbenchRenderOptions(state: ChartsWorkbenchState): GlyphChartRenderOptions {
  return { ...resolveGlyphChartsWorkbenchControls(state.controls), detail: state.controls.overrides.detail ?? "auto", legend: state.chart.legend,
    ...(state.controls.target === "terminal" ? { env: { ...(state.terminal.NO_COLOR ? { NO_COLOR: "1" } : {}), ...(state.terminal.FORCE_COLOR ? { FORCE_COLOR: "1" } : {}) } } : {}) };
}
export function generateChartsWorkbenchSnippets(state: ChartsWorkbenchState) {
  const spec = buildChartsWorkbenchSpec(state);
  const options = chartsWorkbenchRenderOptions(state);
  const json = JSON.stringify(spec, null, 2);
  return { json, typescript: `import { glyphChartPlot, renderGlyphChart } from "@glyphcss/charts";\n\nconst chart = renderGlyphChart(glyphChartPlot(${json}), ${JSON.stringify(options, null, 2)});\n` };
}
