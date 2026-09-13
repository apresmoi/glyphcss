import {
  GLYPH_CHART_TARGET_DEFAULTS,
  glyphChartArc, glyphChartArea, glyphChartBar, glyphChartCell, glyphChartDot,
  glyphChartLine, glyphChartPlot, glyphChartRect, glyphChartRule, glyphChartText,
  glyphChartScaleDomains,
  type GlyphChartAxisOptions, type GlyphChartCharset, type GlyphChartColorMode, type GlyphChartDetail,
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
  { id: "line-rule", label: "Line + rule", spec: glyphChartPlot({ marks: [glyphChartLine(SAMPLE, undefined, { name: "Revenue" }), { ...glyphChartRule([5]), options: { ...glyphChartRule([5]).options, name: "Target" } }], title: "Line + rule" }) },
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
/** `ticks: 0` and `title: ""` both mean "auto" (omitted from the built
 * spec, letting the library's own default — a fitted count / the channel's
 * field name — apply); packet item 6's Dock "Axes" folder. */
export interface ChartsWorkbenchAxis {
  readonly ticks: number;
  readonly tickMarks: boolean;
  readonly title: string;
  readonly grid: boolean;
}
export interface ChartsWorkbenchState {
  readonly marks: readonly ChartsWorkbenchMark[];
  readonly nextMarkId: number;
  readonly controls: GlyphChartsWorkbenchControls;
  readonly scales: Readonly<Record<"x" | "y", ChartsWorkbenchScale>>;
  readonly axes: Readonly<Record<"x" | "y", ChartsWorkbenchAxis>>;
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
  | { type: "rename-column"; id: number; column: string; next: string };

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
const autoAxis = (): ChartsWorkbenchAxis => ({ ticks: 0, tickMarks: true, title: "", grid: false });
export function createChartsWorkbenchState(): ChartsWorkbenchState {
  const preset = CHART_PRESETS[0]!;
  return {
    marks: preset.spec.marks.map((mark, i) => editableMark(mark, i + 1)), nextMarkId: preset.spec.marks.length + 1,
    controls: { target: "web", overrides: {} }, scales: { x: autoScale(), y: autoScale() }, axes: { x: autoAxis(), y: autoAxis() },
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
        nextMarkId: state.nextMarkId + preset.spec.marks.length, scales: { x: autoScale(), y: autoScale() }, axes: { x: autoAxis(), y: autoAxis() },
        chart: { ...state.chart, title: preset.label, description: preset.spec.description ?? "" } };
    }
    case "set-control": return { ...state, controls: reduceGlyphChartsWorkbenchControls(state.controls, action.control) };
    case "reset-target": return { ...state, controls: reduceGlyphChartsWorkbenchControls(state.controls, { type: "reset" }) };
    case "set-scale": return { ...state, scales: { ...state.scales, [action.axis]: { ...state.scales[action.axis], ...action.patch } } };
    case "set-axis": return { ...state, axes: { ...state.axes, [action.axis]: { ...state.axes[action.axis], ...action.patch } } };
    case "set-chart": return { ...state, chart: { ...state.chart, ...action.patch } };
    case "set-terminal": return { ...state, terminal: { ...state.terminal, [action.flag]: action.value } };
    case "set-cell": return { ...state, marks: state.marks.map((mark) => mark.id === action.id ? withTable(mark, (t) => tableSetCell(t, action.row, action.column, action.value)) : mark) };
    case "add-row": return { ...state, marks: state.marks.map((mark) => mark.id === action.id ? withTable(mark, tableAddRow) : mark) };
    case "remove-row": return { ...state, marks: state.marks.map((mark) => mark.id === action.id ? withTable(mark, (t) => tableRemoveRow(t, action.row)) : mark) };
    case "add-column": return { ...state, marks: state.marks.map((mark) => mark.id === action.id ? withTable(mark, (t) => tableAddColumn(t, action.column)) : mark) };
    case "remove-column": return { ...state, marks: state.marks.map((mark) => mark.id === action.id ? withTable(mark, (t) => tableRemoveColumn(t, action.column)) : mark) };
    case "rename-column": return { ...state, marks: state.marks.map((mark) => mark.id === action.id ? withTable(mark, (t) => tableRenameColumn(t, action.column, action.next)) : mark) };
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
    title: state.chart.title, description: state.chart.description,
  });
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
