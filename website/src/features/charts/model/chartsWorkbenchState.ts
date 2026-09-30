import { charts3dFitsForState, charts3dSourceWithChannel } from "./charts3dFields";
import { resolveCharts3dView, type Charts3dChannels } from "./chartsWorkbench3d";
import { cellOutputSnippets } from "../../../utils/export/cellOutputSnippets";
import {
  type GlyphChartCharset,
  type GlyphChartColorMode,
  type GlyphChartDetail,
  type GlyphChartMark,
  type GlyphChartMarkType,
  type GlyphChartRegionFill,
  type GlyphChartRenderOptions,
  type GlyphChartScaleOptions,
  type GlyphChartTarget,
  type GlyphChartXAxisTitleAt,
  type GlyphChartYAxisTitleAt,
  GLYPH_CHART_TARGET_DEFAULTS,
  glyphChartPlot,
  glyphChartScaleDomains,
} from "@glyphcss/charts";
import { type GlyphPixelBox, glyphMonoWebGridSize } from "../../../utils/glyph-metrics/glyphMonoMetrics";
import { type Instrument3DEffectsState } from "../../rendering/model/effectState";
import { findCharts3dDataset } from "../data/chart3d/index";
import { findChartsDataset } from "../data/index";
import type { PipelineStep } from "../tabular/dataPipeline";
import type { TabularRow } from "../tabular/tabularParse";
import { CHARTS_AXIS_DEFAULT_COLOR } from "./chartsAxisDefaultColor";
import {
  type ChartsDataSource,
  type ChartsTopRecommendation,
  CHARTS_CUSTOM_MAX_BYTES,
  profileChartsData,
  resolveChartsDataRows,
  topChartsRecommendation,
} from "./chartsDataSource";
import { chartsMarkTypeBase, chartsRememberRemoteRows } from "./chartsMarkData";
import {
  chartsBestFit,
  chartsBuildBoundMark,
  chartsMarkTypeFitTable,
  chartsMarkTypeFitsForMark,
  chartsRebindMark,
} from "./chartsMarkTypeFit";
import {
  type ChartsWorkbenchAxis,
  type ChartsWorkbenchAxisColorState,
  type ChartsWorkbenchAxisTitlePlacementState,
  type ChartsWorkbenchMark,
  type ChartsWorkbenchScale,
  type ChartsWorkbenchState,
  type GlyphChartsWorkbenchControls,
  autoAxis,
  autoScale,
  buildChartsWorkbenchSpec,
  buildMark,
  CHART_AXIS_COLOR_MODES,
  CHART_PRESETS,
  CHART_SCALE_TYPES,
  defaultAxisColor,
  defaultAxisTitlePlacement,
  editableMark,
  parseChartMarkData,
  sampleChartMark,
  scaleType,
} from "./chartsSpec";
import {
  type Charts3dAxisOverride,
  type Charts3dCamera,
  type Charts3dGuideOptions,
  type Charts3dMarkTypeId,
  type Charts3dSource,
  type Charts3dViewState,
  CHARTS_3D_DEFAULT_CAMERA,
} from "./chartsWorkbench3d";

export type { GlyphPixelBox } from "../../../utils/glyph-metrics/glyphMonoMetrics";

export type {
  Charts3dAxesOverride,
  Charts3dAxisOverride,
  Charts3dCamera,
  Charts3dColumnRanking,
  Charts3dFit,
  Charts3dFitTable,
  Charts3dGuideOptions,
  Charts3dMarkTypeId,
  Charts3dOrbitMode,
  Charts3dSceneOptions,
  Charts3dShading,
  Charts3dSource,
  Charts3dStyleOption,
  Charts3dViewState,
} from "./chartsWorkbench3d";

export type { Instrument3DEffectsState } from "../../rendering/model/effectState";

export {
  charts3dObjectCharset,
  CHARTS_3D_AXIS_FORMAT_NAMES,
  CHARTS_3D_DEFAULT_CAMERA,
  CHARTS_3D_MARK_TYPES,
  CHARTS_BARS3D_NEEDS,
  CHARTS_LINE3D_NEEDS,
  CHARTS_PARAMETRIC3D_NEEDS,
  CHARTS_SCATTER3D_NEEDS,
  CHARTS_SURFACE_NEEDS,
  chartsBest3dFitFromRows,
  chartsFitTableFromRows,
  chartsRankColumnsForScatter3d,
  chartsSurfaceFitFromRows,
  chartsWorkbench3dSceneOptions,
  createCharts3dViewState,
  resolveCharts3dStyle,
  resolveCharts3dView,
  resolveCharts3dViewForLiveScene,
} from "./chartsWorkbench3d";

export { CHARTS_3D_DATASETS, findCharts3dDataset, randomCharts3dDatasetId } from "../data/chart3d/index";

export type { Chart3dDataset } from "../data/chart3d/index";

export type { ChartsDataSource, ChartsRecommendedChannels, ChartsTopRecommendation } from "./chartsDataSource";

export {
  CHARTS_CUSTOM_MAX_BYTES,
  profileChartsData,
  resolveChartsDataRows,
  topChartsRecommendation,
  xChannelIsDate,
} from "./chartsDataSource";

export { remoteDatasetRecommendationCheck } from "./chartsMarkTypeFit";

export { CHARTS_DATASETS, findChartsDataset, randomChartsDatasetId } from "../data/index";

export type { ChartsDataset } from "../data/index";

export { randomChartsDatasetPick } from "./chartsRandomDataset";

export type { ChartsRandomDatasetPick } from "./chartsRandomDataset";

export const CHART_TARGETS = ["chat", "terminal", "web"] as const;

export const CHART_CHARSETS = ["ascii", "box", "blocks", "braille"] as const;

export const CHART_COLORS = ["none", "ansi16", "ansi256", "truecolor", "css"] as const;

export const CHART_DETAILS = ["auto", "faithful", "balanced", "simplified"] as const;

export const CHART_REGION_FILLS = ["auto", "texture", "solid"] as const satisfies readonly GlyphChartRegionFill[];

// Owner packet items 1/2/3 — legend placement and title align/position, each
// with a matching icon-button group in the Chart dock folder (`ChartsDock.tsx`).
export const CHART_LEGEND_PLACEMENTS = [
  "bottom",
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right",
  "title",
] as const;

export const CHART_TITLE_ALIGNS = ["left", "center", "right"] as const;

export const CHART_TITLE_POSITIONS = ["top", "bottom"] as const;

/** `axes.x.titleAt` (library default `"center"`) — Dock item "Axis Title +
 *  Title at": `axes.y.titleAt`'s own vocabulary is exactly `CHART_TITLE_POSITIONS`
 *  above (`GlyphChartYAxisTitleAt` and `GlyphChartTitlePosition` are the
 *  same `"top" | "bottom"` union), so it has no separate constant here. */
export const CHART_X_AXIS_TITLE_ATS = ["start", "center", "end"] as const;

// Grouped for the rail's own type picker (`ChartsMarkTypePicker.tsx`) —
// trend, compare, distribution, flow, then the three types this page never
// offers as a real pick (`CHARTS_MARK_TYPE_RULES.ranked: false` — rect/text/
// rule) last. Mirrors `CHARTS_MARK_TYPE_RULES`'s own key order exactly
// (`chartsMarkTypeFit.ts`), so the two never drift apart.
export const CHART_MARK_TYPES = [
  "line",
  "area",
  "bar",
  "dot",
  "arc",
  "cell",
  "sankey",
  "funnel",
  "rect",
  "text",
  "rule",
] as const;

export const CHART_TRANSFORMS = ["none", "stack", "group", "normalize", "bin", "window"] as const;

/** A colour-picker swatch shown when a mark's own series preview
 *  (`glyphChartSeriesPreview`, `@glyphcss/charts`) couldn't be computed at
 *  all — invalid mark JSON, mid-edit. Not a palette: the real default
 *  per-series colours always come from the library's own resolution. */
export const CHARTS_DEFAULT_SWATCH_COLOR = "#3b82f6";

export type GlyphChartsWorkbenchControlAction =
  | { type: "target"; value: GlyphChartTarget }
  | { type: "charset"; value: GlyphChartCharset }
  | { type: "color"; value: GlyphChartColorMode }
  | { type: "width" | "height"; value: number }
  | { type: "detail"; value: GlyphChartDetail }
  | { type: "density"; value: number }
  | { type: "reset" };

/** Explicit choices survive target changes, even when equal to the old default. */
export function reduceGlyphChartsWorkbenchControls(
  state: GlyphChartsWorkbenchControls,
  action: GlyphChartsWorkbenchControlAction,
): GlyphChartsWorkbenchControls {
  if (action.type === "target") return { ...state, target: action.value };
  if (action.type === "reset") return { target: state.target, overrides: {} };
  return { ...state, overrides: { ...state.overrides, [action.type]: action.value } };
}

export function resolveGlyphChartsWorkbenchControls(state: GlyphChartsWorkbenchControls) {
  return { target: state.target, ...GLYPH_CHART_TARGET_DEFAULTS[state.target], ...state.overrides };
}

// ── Density (mirrors glyphcss's own per-mesh `density` — AGENTS.md's "Per-
// mesh detail layers": a multiplier on cells per unit, the `<pre>` scaled
// by `font-size`/`line-height` so the on-screen box holds still while the
// picture gains detail) ──────────────────────────────────────────────────
//
// Web only: a `terminal`/`chat` cell is a fixed size set by the CONSUMING
// renderer (a real terminal's font, a chat client's fenced-code-block
// font), which this page cannot resize — density has nothing to scale
// there, so the EFFECTIVE value is always 1 outside `web` while the STATE
// keeps whatever the reader dialed in on web, restored the moment they
// switch back (the task's own framing).
export const CHARTS_DEFAULT_DENSITY = 1;

export const CHARTS_DENSITY_MIN = 1;

export const CHARTS_DENSITY_MAX = 4;

export const CHARTS_DENSITY_STEP = 0.25;

/** The web `<pre>`'s fixed base `font-size` (`.charts-grid-scroll >
 *  .glyph-output`, `charts-workbench.css`) — density divides this, never
 *  the other way round. */
export const CHARTS_DENSITY_BASE_FONT_PX = 13;

/** Smallest a cell may read as — below this a glyph is no longer legible,
 *  so the slider's own max is capped rather than letting a reader dial
 *  past it. */
export const CHARTS_DENSITY_MIN_FONT_PX = 4;

/** Highest density `baseFontPx` can still render before a cell would drop
 *  under `CHARTS_DENSITY_MIN_FONT_PX`, snapped down to the slider's own
 *  step grid and never above `CHARTS_DENSITY_MAX`. */
export function chartsDensitySliderMax(baseFontPx: number = CHARTS_DENSITY_BASE_FONT_PX): number {
  const legible = Math.floor(baseFontPx / CHARTS_DENSITY_MIN_FONT_PX / CHARTS_DENSITY_STEP) * CHARTS_DENSITY_STEP;
  return Math.max(CHARTS_DENSITY_MIN, Math.min(CHARTS_DENSITY_MAX, legible));
}

/** `true` when density has no effect at this target (mirrors `@glyphcss/maps`'
 *  own `mapDirectionLocked` idiom — dim a control with the reason something
 *  else, here the target's own fixed cell size, owns it). */
export function chartsWorkbenchDensityLocked(target: GlyphChartTarget): boolean {
  return target !== "web";
}

export function chartsWorkbenchDensity(controls: GlyphChartsWorkbenchControls): number {
  return controls.overrides.density ?? CHARTS_DEFAULT_DENSITY;
}

/** The density that actually reaches the render grid — always 1 off `web`. */
export function chartsWorkbenchEffectiveDensity(controls: GlyphChartsWorkbenchControls): number {
  return chartsWorkbenchDensityLocked(controls.target) ? CHARTS_DEFAULT_DENSITY : chartsWorkbenchDensity(controls);
}

// ── Web viewport fill (the mirror image of Density's own lock: `web` FILLS
// the measured browser viewport instead of a fixed logical grid, so the
// Width/Height sliders — which SET that fixed grid — have nothing left to
// do there; `terminal`/`chat` render at a size the CONSUMING renderer picks
// with no viewport of this page's own to measure, so they keep the sliders
// exactly as before this feature existed) ────────────────────────────────
/** `true` when the Width/Height sliders have no effect at this target —
 *  `chartsWorkbenchDensityLocked`'s mirror image, `@glyphcss/maps`'
 *  `mapDirectionLocked` idiom (dim with a reason, never hide). */
export function chartsWorkbenchSizeLocked(target: GlyphChartTarget): boolean {
  return target === "web";
}

/** The grid a `web` render fills to — `viewportPx` (measured live,
 *  `InstrumentWorkbench/useElementSize.ts`) when available, else the
 *  target's own default grid (`GLYPH_CHART_TARGET_DEFAULTS.web`,
 *  density-scaled like every other target) for a caller with no viewport to
 *  measure (SSR, a headless test, `renderGlyphChartJson`, the CLI) — the
 *  Width/Height overrides are NEVER read here, on either branch: they own
 *  nothing on `web` (`chartsWorkbenchSizeLocked`), dialed-in-but-inert
 *  exactly like an off-web density override. */
export function chartsWorkbenchWebGridSize(
  viewportPx: GlyphPixelBox | undefined,
  density: number,
): { width: number; height: number } {
  if (viewportPx) return glyphMonoWebGridSize(viewportPx, CHARTS_DENSITY_BASE_FONT_PX, density);
  const defaults = GLYPH_CHART_TARGET_DEFAULTS.web;
  return { width: Math.round(defaults.width * density), height: Math.round(defaults.height * density) };
}

export type ChartsWorkbenchAction =
  | { type: "add-mark"; markType?: GlyphChartMarkType }
  | { type: "remove-mark"; id: number }
  | { type: "update-mark"; id: number; patch: Partial<Omit<ChartsWorkbenchMark, "id">> }
  // The mark card's Type toggle: re-binds the mark to that type's own top-
  // ranked mapping of the same data (`chartsMarkTypeFit.ts`) and refuses a
  // type the data doesn't fit — never keeps the previous type's channels.
  | { type: "set-mark-type"; id: number; markType: GlyphChartMarkType }
  | { type: "sample-mark"; id: number }
  | { type: "apply-preset"; id: string }
  | { type: "set-control"; control: GlyphChartsWorkbenchControlAction }
  | { type: "reset-target" }
  | { type: "reset-chart-style" }
  | { type: "set-scale"; axis: "x" | "y"; patch: Partial<ChartsWorkbenchScale> }
  | { type: "set-axis"; axis: "x" | "y"; patch: Partial<ChartsWorkbenchAxis> }
  // The Axes folder's own per-axis subgroup reset (user feedback, verbatim:
  // "can we somehow do a subgrouping by axis... all the config for this
  // axe... etc"): clears ONLY that axis's own ticks/tickMarks/title/grid
  // (`state.axes[axis]`), its own title placement, and its own colour
  // swatch (harmless when `axisColor.mode === "shared"`, since only the
  // shared swatch paints there) — never the Scales-folder domain, which
  // keeps its own row-level `[reset]` (`RangeSlider`'s own doc) since it
  // lives in a different folder entirely, same scoping rule
  // `reset-chart-style`'s own tooltip already states.
  | { type: "reset-axis"; axis: "x" | "y" }
  | { type: "set-chart"; patch: Partial<ChartsWorkbenchState["chart"]> }
  | { type: "set-terminal"; flag: "NO_COLOR" | "FORCE_COLOR"; value: boolean }
  // Data folder (AGENTS.md's "Charts" — "Data layer"): `set-data-source`/
  // `set-pipeline` stay for backward-compat decode of a link built before
  // this feature (a "Custom…" paste, or a hand-edited pipeline) and for
  // direct reducer use — the rail's live dataset `<select>` no longer
  // dispatches either. **`select-dataset` is the page's ONE entry point**:
  // pick a stock dataset by id and the chart updates immediately from its
  // own curated `recommended` mapping (mark type + channels, plus the
  // `pipeline` reshape a multi-numeric recommendation carries, N4) — no
  // separate "Apply" step. Mirrors the OLD `set-data-source` + `apply-data`
  // pair exactly, just as one action with no in-between state to inspect.
  | { type: "set-data-source"; source: ChartsDataSource | null }
  | { type: "set-pipeline"; pipeline: readonly PipelineStep[] }
  | { type: "select-dataset"; id: string }
  // Dataset search (glyphcss dataset-search feature): a Hugging Face hit or
  // a pasted URL/id resolves to ROWS off-thread (`lib/datasetSearch.ts` +
  // `lib/datasetLoad.ts`, both async and network-touching — a reducer
  // action must not be), so the page loads them first and dispatches this
  // ONE synchronous action with the already-resolved rows, mirroring
  // `select-dataset`'s own curated-mapping commit but reading the general
  // profiler's top pick (a remote dataset carries no curated `recommended`
  // field) and stamping `data.source` as `{ kind: "remote", ref, ... }`.
  | {
      type: "select-remote-dataset";
      ref: string;
      title: string;
      description: string;
      source: { name: string; url: string; licence?: string };
      rows: readonly TabularRow[];
    }
  // Colour controls (this packet).
  | { type: "set-axis-color-mode"; mode: (typeof CHART_AXIS_COLOR_MODES)[number] }
  | { type: "set-axis-color"; which: "shared" | "x" | "y"; color: string }
  | { type: "set-mark-color"; id: number; color: string | readonly string[] | undefined }
  // Axis title placement (Dock item "Axis Title + Title at").
  | { type: "set-axis-title-at"; axis: "x"; value: GlyphChartXAxisTitleAt }
  | { type: "set-axis-title-at"; axis: "y"; value: GlyphChartYAxisTitleAt }
  // Textures row (DIAGNOSIS-solid-colour-fills.md).
  | { type: "set-region-fill"; value: GlyphChartRegionFill }
  // 3D (packet C3, generalized to every mark type by C6). `select-3d-dataset`
  // mounts a vendored `datasets/chart3d/` preset (the tray tile / the mark
  // card's Type toggle when the current table doesn't fit); `select-3d-table`
  // mounts an INLINE mark of the given `markType` resolved from the reader's
  // own currently-loaded 2D table (`chartsFitTableFromRows`) — the mark
  // card's own Type toggle when it does; `select-3d-remote-table` mounts an
  // ALREADY-RESOLVED inline source (`chartsBest3dFitFromRows`, run against a
  // freshly loaded Hugging Face table — `ChartsWorkbench.tsx`'s own
  // `loadRemote3dDataset`, which cannot dispatch a reducer action mid-async
  // fetch and so resolves the fit itself before dispatching). All three
  // reset the camera to auto-fit, mirroring `select-dataset`'s own scale
  // reset. `set-3d-dimension` is what picking a 2D type while in 3D mode
  // dispatches (`set-mark-type` itself always carries `dimension: "2d"` too,
  // so a direct 2D pick needs no separate action).
  | { type: "select-3d-dataset"; id: string }
  | { type: "select-3d-table"; markType: Charts3dMarkTypeId }
  | { type: "select-3d-remote-table"; source: Extract<Charts3dSource, { kind: "inline" }> }
  | { type: "set-3d-dimension"; dimension: "2d" | "3d" }
  | { type: "set-3d-channel"; channel: keyof Charts3dChannels; value: string }
  | { type: "set-3d-camera"; camera: Charts3dCamera }
  | { type: "set-3d-view"; patch: Partial<Pick<Charts3dViewState, "orbitMode" | "shading" | "colorscale" | "style">> }
  // Packet C4, item 1 — the View folder's guide toggles; merges into the
  // EXISTING `chart3d.guides` object, so a single toggle patches one field
  // without disturbing the rest (mirroring `set-axis`'s own merge shape).
  | { type: "set-3d-guides"; patch: Partial<Charts3dGuideOptions> }
  // Packet C6, coordinator addendum — the Axes folder's per-axis
  // title/ticks/format/line/tickMarks/tickLabels/grid/color/domain
  // overrides while a 3D type is active; merges into the ONE named axis's
  // own override object, mirroring `set-axis`'s own 2D shape exactly.
  // `set-3d-axes-color` writes the SHARED `axes.color` every axis's own
  // `color` overrides (C7) — `undefined` clears it back to the library's
  // own default (never `""`, since this is a real hex value, not text).
  | { type: "set-3d-axis"; axis: "x" | "y" | "z"; patch: Partial<Charts3dAxisOverride> }
  // The 3D Axes subgroup's own reset — a full REPLACE of that axis's
  // override back to `{}` (never a merge like `set-3d-axis`'s own patch
  // semantics), so every field the reader touched (title/ticks/format/
  // visibility/colour/domain/titleAt/titleOffset) clears at once, mirroring
  // `Charts3dAxesOverride`'s own "empty means every field follows the
  // library/dataset default" contract.
  | { type: "reset-3d-axis"; axis: "x" | "y" | "z" }
  | { type: "set-3d-axes-color"; color: string | undefined }
  // Packet C4, item 3 — the shared Effects folder's own patch shape.
  | { type: "set-effect3d"; patch: Partial<Instrument3DEffectsState> };

function isDefaultAxisColor(axisColor: ChartsWorkbenchAxisColorState): boolean {
  return (
    axisColor.mode === "shared" &&
    axisColor.shared === CHARTS_AXIS_DEFAULT_COLOR &&
    axisColor.x === CHARTS_AXIS_DEFAULT_COLOR &&
    axisColor.y === CHARTS_AXIS_DEFAULT_COLOR
  );
}

function isDefaultAxisTitlePlacement(placement: ChartsWorkbenchAxisTitlePlacementState): boolean {
  return placement.x === "center" && placement.y === "top";
}

/** Identity string for a data source — used to decide whether picking a NEW
 *  source should drop the existing pipeline (its steps almost certainly
 *  name columns the new source doesn't have), and exported for
 *  `ChartsWorkbench.tsx`'s own Random button: the SAME `dataset:<id>` /
 *  `remote:<ref>` shape `chartsRandomDataset.ts`'s pool keys its own
 *  entries by, so "exclude whatever is currently loaded" is one shared
 *  string comparison rather than two independently-shaped `if` chains. */
export function dataSourceKey(source: ChartsDataSource | null): string {
  if (!source) return "";
  if (source.kind === "dataset") return `dataset:${source.id}`;
  if (source.kind === "remote") return `remote:${source.ref}`;
  return `custom:${source.filename ?? ""}`;
}

export function reduceChartsWorkbenchState(
  state: ChartsWorkbenchState,
  action: ChartsWorkbenchAction,
): ChartsWorkbenchState {
  switch (action.type) {
    case "add-mark":
      return {
        ...state,
        marks: [...state.marks, editableMark(sampleChartMark(action.markType ?? "line"), state.nextMarkId)],
        nextMarkId: state.nextMarkId + 1,
      };
    case "remove-mark":
      return { ...state, marks: state.marks.filter((mark) => mark.id !== action.id) };
    case "update-mark": {
      const mark = state.marks.find((m) => m.id === action.id);
      if (!mark) return state;
      const next: ChartsWorkbenchMark = { ...mark, ...action.patch };
      const replaced = (m: ChartsWorkbenchMark) => state.marks.map((other) => (other.id === mark.id ? m : other));
      // A channel edit re-derives the rows from the reader's own table
      // (`chartsRebindMark`): rows the previous channels left out come back,
      // and rows the new ones can't use are left out and named in the rail.
      // An explicit data or type patch is taken as given.
      const rebound =
        action.patch.channels !== undefined && action.patch.dataText === undefined && action.patch.type === undefined
          ? chartsRebindMark(state.data, next)
          : null;
      if (!rebound) return { ...state, marks: replaced(next) };
      // A typed domain or a time scale belongs to the column it was set on.
      const xChanged = (next.channels.x || undefined) !== (mark.channels.x || undefined);
      const yChanged = (next.channels.y || undefined) !== (mark.channels.y || undefined);
      return {
        ...state,
        marks: replaced({ ...next, dataText: rebound.mark.dataText }),
        scales: {
          x: xChanged ? { type: rebound.isDate ? "time" : "auto", min: "", max: "" } : state.scales.x,
          y: yChanged ? autoScale() : state.scales.y,
        },
      };
    }
    case "set-mark-type": {
      const mark = state.marks.find((m) => m.id === action.id);
      if (!mark) return state;
      // A pick equal to the mark's OWN CURRENT type still means "go back to
      // 2D" while the page is showing the 3D viewport (its `marks` array
      // never changes going into 3D, so this is the only signal) — no mark
      // rebuild needed, since nothing about it changed.
      if (mark.type === action.markType) return state.dimension === "2d" ? state : { ...state, dimension: "2d" };
      const base = chartsMarkTypeBase(state.data, mark);
      const fit = chartsMarkTypeFitsForMark(state.data, mark)[action.markType];
      if (!fit.fits || base.rows === null) return state;
      // The exact build the fit probe rendered (`chartsBuildBoundMark`).
      const built = chartsBuildBoundMark(mark.id, action.markType, base.rows, fit.binding);
      if (!built) return state;
      // Domains belong to the selected columns, not the chart shape.
      // `dimension: "2d"` unconditionally — picking any 2D type (the mark
      // card's own Type toggle) is how a reader switches OUT of 3D.
      return {
        ...state,
        dimension: "2d",
        marks: state.marks.map((m) => (m.id === mark.id ? built.mark : m)),
        scales: {
          x:
            built.mark.channels.x === mark.channels.x
              ? state.scales.x
              : built.isDate
                ? { type: "time", min: "", max: "" }
                : autoScale(),
          y: built.mark.channels.y === mark.channels.y ? state.scales.y : autoScale(),
        },
      };
    }
    case "sample-mark":
      return {
        ...state,
        marks: state.marks.map((mark) =>
          mark.id === action.id ? editableMark(sampleChartMark(mark.type), mark.id) : mark,
        ),
      };
    case "apply-preset": {
      const preset = CHART_PRESETS.find((p) => p.id === action.id);
      if (!preset) return state;
      // P2-1 (review fix, REVIEW-showcase-opus.md): a tray preset REPLACES
      // the chart, but a stale `data.source` used to survive it — the rail
      // card, the `<select>` and the "View data" disclosure kept describing
      // the dataset the PREVIOUS chart was made of, crediting its licence
      // for data that is no longer plotted. A showcase's dataset card is a
      // provenance statement ("this chart is made of THESE rows"), so it
      // must go empty (the `<select>`'s own "— pick a dataset —"
      // placeholder) the moment a preset makes that statement false.
      return {
        ...state,
        dimension: "2d",
        marks: preset.spec.marks.map((mark, i) => editableMark(mark, state.nextMarkId + i)),
        nextMarkId: state.nextMarkId + preset.spec.marks.length,
        scales: { x: autoScale(), y: autoScale() },
        axes: { x: autoAxis(), y: autoAxis() },
        chart: { ...state.chart, title: preset.label, description: preset.spec.description ?? "" },
        data: { source: null, pipeline: [] },
      };
    }
    case "set-control":
      return { ...state, controls: reduceGlyphChartsWorkbenchControls(state.controls, action.control) };
    // P2-6 (REVIEW-dock-colours-sliders-opus.md): the Output folder's own
    // header reset touches OUTPUT settings only — target/charset/color/
    // width/height/detail — and never a hand-picked axis/mark colour or a
    // typed scale domain, which live in a different folder entirely and
    // used to be silently destroyed by this button with no undo. Style
    // (colours + slider domains) gets its OWN reset, `reset-chart-style`,
    // scoped to the Chart folder that shows those controls.
    case "reset-target":
      return { ...state, controls: reduceGlyphChartsWorkbenchControls(state.controls, { type: "reset" }) };
    case "reset-chart-style": {
      // A no-op stays the same array/object reference when nothing was
      // customised — same discipline as `withTable`'s table-editor no-ops.
      const marks = state.marks.some((m) => m.color !== undefined)
        ? state.marks.map((m) => (m.color === undefined ? m : { ...m, color: undefined }))
        : state.marks;
      const styleIsDefault =
        isDefaultAxisColor(state.style.axisColor) &&
        isDefaultAxisTitlePlacement(state.style.axisTitlePlacement) &&
        state.style.regionFill === undefined;
      const style = styleIsDefault
        ? state.style
        : { axisColor: defaultAxisColor(), axisTitlePlacement: defaultAxisTitlePlacement() };
      const hasDomain = ([state.scales.x, state.scales.y] as const).some((s) => s.min.trim() || s.max.trim());
      const scales = hasDomain
        ? { x: { ...state.scales.x, min: "", max: "" }, y: { ...state.scales.y, min: "", max: "" } }
        : state.scales;
      // Tick counts (Dock item "Ticks rows") are the other Axes-folder
      // setting this reset reaches across folders for — same fold-the-
      // scope-honestly call as `axisTitlePlacement` above, so the tooltip
      // that names both stays true (REVIEW-dock-addenda-opus.md P3-3).
      const hasTicks = state.axes.x.ticks !== 0 || state.axes.y.ticks !== 0;
      const axes = hasTicks ? { x: { ...state.axes.x, ticks: 0 }, y: { ...state.axes.y, ticks: 0 } } : state.axes;
      return { ...state, marks, style, scales, axes };
    }
    case "set-axis-color-mode":
      return { ...state, style: { ...state.style, axisColor: { ...state.style.axisColor, mode: action.mode } } };
    case "set-axis-color":
      return {
        ...state,
        style: { ...state.style, axisColor: { ...state.style.axisColor, [action.which]: action.color } },
      };
    case "set-mark-color":
      return {
        ...state,
        marks: state.marks.map((mark) => (mark.id === action.id ? { ...mark, color: action.color } : mark)),
      };
    case "set-axis-title-at":
      return {
        ...state,
        style: {
          ...state.style,
          axisTitlePlacement: { ...state.style.axisTitlePlacement, [action.axis]: action.value },
        },
      };
    case "set-region-fill": {
      // `auto` REMOVES the key rather than storing it, so choosing it is
      // indistinguishable from never touching the row (state, `?c=`, snippet).
      const { regionFill: _previous, ...rest } = state.style;
      return { ...state, style: action.value === "auto" ? rest : { ...rest, regionFill: action.value } };
    }
    case "set-scale":
      return {
        ...state,
        scales: { ...state.scales, [action.axis]: { ...state.scales[action.axis], ...action.patch } },
      };
    case "set-axis":
      return { ...state, axes: { ...state.axes, [action.axis]: { ...state.axes[action.axis], ...action.patch } } };
    case "reset-axis": {
      const axis = action.axis;
      const titlePlacementDefault = defaultAxisTitlePlacement()[axis];
      const a = state.axes[axis];
      // A no-op stays the same object/array reference when nothing was
      // customised — same discipline `reset-chart-style` already follows.
      const isDefault =
        a.ticks === 0 &&
        a.tickMarks === true &&
        a.title === "" &&
        !a.grid &&
        state.style.axisTitlePlacement[axis] === titlePlacementDefault &&
        state.style.axisColor[axis] === CHARTS_AXIS_DEFAULT_COLOR;
      if (isDefault) return state;
      return {
        ...state,
        axes: { ...state.axes, [axis]: autoAxis() },
        style: {
          ...state.style,
          axisTitlePlacement: { ...state.style.axisTitlePlacement, [axis]: titlePlacementDefault },
          axisColor: { ...state.style.axisColor, [axis]: CHARTS_AXIS_DEFAULT_COLOR },
        },
      };
    }
    case "set-chart":
      return { ...state, chart: { ...state.chart, ...action.patch } };
    case "set-terminal":
      return { ...state, terminal: { ...state.terminal, [action.flag]: action.value } };
    case "set-data-source": {
      // N2: the 256 KB cap is enforced HERE — the one place ANY action can
      // install a custom source — not only in `ChartsDataFolder.tsx`'s
      // paste/upload handler, so a dropdown round trip (pick Custom…, type
      // an oversized paste the handler already refused to DISPATCH, pick a
      // dataset, pick Custom… again) can never re-dispatch that same
      // refused text and bypass the cap: `onSelectDataset`'s "Custom…"
      // branch has no size check of its own, and used to install whatever
      // `customText` happened to hold regardless of what the paste handler
      // already rejected.
      if (
        action.source?.kind === "custom" &&
        !action.source.omitted &&
        new TextEncoder().encode(action.source.raw).length > CHARTS_CUSTOM_MAX_BYTES
      ) {
        return state;
      }
      // A new source's pipeline steps almost certainly name columns the
      // OLD source doesn't share — picking a genuinely different source
      // drops them; re-picking the same one (e.g. toggling Custom's file
      // input) keeps whatever the reader already built.
      const samePipeline = dataSourceKey(action.source) === dataSourceKey(state.data.source);
      return { ...state, data: { source: action.source, pipeline: samePipeline ? state.data.pipeline : [] } };
    }
    case "set-pipeline":
      return { ...state, data: { ...state.data, pipeline: action.pipeline } };
    case "select-dataset": {
      const dataset = findChartsDataset(action.id);
      if (!dataset) return state;
      const source: ChartsDataSource = { kind: "dataset", id: action.id };
      const resolved = resolveChartsDataRows(source, []);
      if (!resolved.ok) return state;
      const profiled = profileChartsData(resolved.rows);
      // Always the dataset's own curated mapping (never the profiler's
      // ranking — AGENTS.md's "Charts" "Data layer"): with no pipeline for
      // a user to have changed columns out from under it, the curated
      // channels resolve every time for a real vendored dataset, so this
      // never falls back in practice — but stays the one shared code path
      // so a dataset that somehow doesn't resolve degrades the same way
      // Apply always did, rather than crashing.
      const top = topChartsRecommendation(resolved.dataset, profiled.profile, profiled.recommendations);
      const built = buildRecommendedMarkUpdate(state.nextMarkId, resolved.rows, top);
      // A1: a channel-less recommendation is an honest "nothing to plot"
      // answer, not a chart — never replace the reader's current chart with
      // a 0-ink one.
      if (!built) return state;
      return {
        ...state,
        dimension: "2d",
        marks: [built.mark],
        nextMarkId: state.nextMarkId + 1,
        data: { source, pipeline: [] },
        scales: { x: built.isDate ? { type: "time", min: "", max: "" } : autoScale(), y: autoScale() },
        axes: { x: autoAxis(), y: autoAxis() },
        chart: { ...state.chart, title: dataset.title, description: dataset.description },
      };
    }
    case "select-remote-dataset": {
      // Later type switches re-derive from these rows, not from this
      // mark's reshaped and cleaned copy (`chartsRememberRemoteRows`). A
      // memo of what the action carries, so a repeated call is harmless.
      chartsRememberRemoteRows(action.ref, action.rows);
      // A remote dataset carries no curated `recommended` field (only the
      // vendored `datasets/` entries do), so the mapping is the ranker's
      // best candidate the fit table proved renders — for the search box,
      // a `?c=` re-fetch and Random alike. Random used to sample within
      // 85% of the top score; the pool was mostly mirror images of the top
      // pick (x/y swapped, a sankey reversed) or visibly weaker views, and
      // Random already varies by picking a different dataset every press.
      const best = chartsBestFit(chartsMarkTypeFitTable({ rows: action.rows }));
      const built = best && chartsBuildBoundMark(state.nextMarkId, best.type, action.rows, best.binding);
      if (!built) return state;
      return {
        ...state,
        dimension: "2d",
        marks: [built.mark],
        nextMarkId: state.nextMarkId + 1,
        data: {
          source: {
            kind: "remote",
            ref: action.ref,
            title: action.title,
            description: action.description,
            source: action.source,
          },
          pipeline: [],
        },
        scales: { x: built.isDate ? { type: "time", min: "", max: "" } : autoScale(), y: autoScale() },
        axes: { x: autoAxis(), y: autoAxis() },
        chart: { ...state.chart, title: action.title, description: action.description },
      };
    }
    case "select-3d-dataset": {
      if (!findCharts3dDataset(action.id)) return state;
      return {
        ...state,
        dimension: "3d",
        chart3d: {
          ...state.chart3d,
          source: { kind: "dataset", id: action.id },
          camera: { ...CHARTS_3D_DEFAULT_CAMERA },
        },
      };
    }
    case "select-3d-table": {
      const active = state.dimension === "3d" ? resolveCharts3dView(state.chart3d) : null;
      if (active?.ok && active.resolved.mark.type === action.markType) return state;
      const fit = charts3dFitsForState(state)[action.markType];
      if (!fit.fits) return state;
      return {
        ...state,
        dimension: "3d",
        chart3d: {
          ...state.chart3d,
          source: fit.source,
          camera: state.dimension === "3d" ? state.chart3d.camera : { ...CHARTS_3D_DEFAULT_CAMERA },
        },
      };
    }
    case "select-3d-remote-table":
      return {
        ...state,
        dimension: "3d",
        chart3d: { ...state.chart3d, source: action.source, camera: { ...CHARTS_3D_DEFAULT_CAMERA } },
      };
    case "set-3d-dimension":
      return action.dimension === state.dimension ? state : { ...state, dimension: action.dimension };
    case "set-3d-channel": {
      const source = charts3dSourceWithChannel(state.chart3d.source, action.channel, action.value);
      if (source === state.chart3d.source) return state;
      const chart3d = { ...state.chart3d, source };
      if (!resolveCharts3dView(chart3d).ok) return state;
      return { ...state, chart3d };
    }
    case "set-3d-camera":
      return { ...state, chart3d: { ...state.chart3d, camera: action.camera } };
    case "set-3d-view":
      return { ...state, chart3d: { ...state.chart3d, ...action.patch } };
    case "set-3d-guides":
      return { ...state, chart3d: { ...state.chart3d, guides: { ...state.chart3d.guides, ...action.patch } } };
    case "set-3d-axis":
      return {
        ...state,
        chart3d: {
          ...state.chart3d,
          axes: { ...state.chart3d.axes, [action.axis]: { ...state.chart3d.axes[action.axis], ...action.patch } },
        },
      };
    case "reset-3d-axis": {
      // A no-op stays the same object reference when nothing was
      // customised — same discipline `reset-axis` (2D) already follows.
      if (Object.keys(state.chart3d.axes[action.axis]).length === 0) return state;
      return { ...state, chart3d: { ...state.chart3d, axes: { ...state.chart3d.axes, [action.axis]: {} } } };
    }
    case "set-3d-axes-color": {
      const { color: _color, ...rest } = state.chart3d.axes;
      return {
        ...state,
        chart3d: {
          ...state.chart3d,
          axes: { ...rest, ...(action.color !== undefined ? { color: action.color } : {}) },
        },
      };
    }
    case "set-effect3d":
      return { ...state, effect3d: { ...state.effect3d, ...action.patch } };
  }
}

/**
 * `select-dataset`'s curated (or fallback) recommendation, built through the
 * one build path every mark-installing action shares
 * (`chartsMarkTypeFit.ts`'s `chartsBuildBoundMark`: reshape, drop unusable
 * rows, normalise a date x — the library's time domain accepts only ISO
 * dates, while the profiler also reads `YYYY-MM` and slash dates as dates).
 * `null` when there is no usable recommendation.
 */
function buildRecommendedMarkUpdate(
  nextMarkId: number,
  rows: readonly TabularRow[],
  top: ChartsTopRecommendation | null,
) {
  if (!top) return null;
  return chartsBuildBoundMark(nextMarkId, top.mark, rows, {
    channels: top.channels,
    transform: top.transform ?? "none",
    pipeline: top.pipeline,
  });
}

export function chartMarkFields(mark: ChartsWorkbenchMark): string[] {
  try {
    const data = parseChartMarkData(mark);
    return data.every((row) => typeof row === "number")
      ? ["index", "value"]
      : [...new Set(data.flatMap((row) => (typeof row === "number" ? [] : Object.keys(row))))];
  } catch {
    return [];
  }
}

export type ChartsWorkbenchAxisDomain = ReturnType<typeof glyphChartScaleDomains>["x"];

type ChartsAxisDomainProbe =
  | { readonly ok: true; readonly domain: ChartsWorkbenchAxisDomain }
  | { readonly ok: false; readonly code?: string };

/**
 * One axis's resolved domain with THIS axis read as `type` and the OTHER axis
 * always as `"auto"` — `glyphChartScaleDomains` builds both scales in one
 * call, so a failing other axis (a sign-crossing log domain, say) would
 * otherwise take this one down with it. A failure keeps the library's own
 * rule code (`log-domain`, `bad-time-domain`, `bad-scale`) so a caller can
 * say why.
 */
function probeAxisDomain(
  state: ChartsWorkbenchState,
  axis: "x" | "y",
  type: ChartsWorkbenchScale["type"],
): ChartsAxisDomainProbe {
  try {
    const scaleOpts = { x: {}, y: {} } as { x: GlyphChartScaleOptions; y: GlyphChartScaleOptions };
    scaleOpts[axis] = scaleType({ ...state.scales[axis], type });
    const spec = glyphChartPlot({ marks: state.marks.map(buildMark), scales: scaleOpts });
    return { ok: true, domain: glyphChartScaleDomains(spec)[axis] };
  } catch (error) {
    return { ok: false, code: (error as { code?: string }).code };
  }
}

/**
 * The raw data extent for each axis, ignoring any `min`/`max` the reader
 * has already typed — what a `RangeSlider`'s own bounds (padded/legality-
 * narrowed by the caller, `chartsScaleSliderBounds`) must be computed from,
 * since bounds computed from the CURRENT selection would shrink every time
 * a reader narrows it. Each axis resolves INDEPENDENTLY (`probeAxisDomain`),
 * so a failing Y never blanks X's own control. An axis whose declared type
 * can't resolve is `undefined`; the Dock only gets there from a legacy link,
 * because `chartsWorkbenchScaleTypeFits` disables such a type in the select.
 */
export function chartsWorkbenchInferredDomains(
  state: ChartsWorkbenchState,
): Readonly<Record<"x" | "y", ChartsWorkbenchAxisDomain | undefined>> {
  const axis = (a: "x" | "y"): ChartsWorkbenchAxisDomain | undefined => {
    const probe = probeAxisDomain(state, a, state.scales[a].type);
    return probe.ok ? probe.domain : undefined;
  };
  return { x: axis("x"), y: axis("y") };
}

/** Why both Scales rows are dead on a chart built only of `arc`/`sankey`/
 *  `funnel` marks (`chartsWorkbenchHasCartesianMark`): nothing downstream of
 *  such a spec ever reads `scales.x`/`scales.y`, so a live control there
 *  would move nothing (DIAGNOSIS-scale-domain.md P3-4). */
export const CHARTS_NO_SCALE_REASON = "This chart type has no x/y scale.";

export type ChartsScaleTypeFit =
  | { readonly fits: true }
  | { readonly fits: false; readonly short: string; readonly reason: string };

export type ChartsScaleTypeFitTable = Readonly<Record<ChartsWorkbenchScale["type"], ChartsScaleTypeFit>>;

const CHARTS_SCALE_TYPE_FITS: ChartsScaleTypeFit = { fits: true };

const CHARTS_NUMERIC_SCALE_TYPES: ReadonlySet<ChartsWorkbenchScale["type"]> = new Set(["linear", "log", "sqrt"]);

/**
 * Which scale types each axis's data can carry. The Dock's Type select
 * disables every other type with `short` in the option label and `reason` on
 * its title, the same fit idiom as the mark card's Type toggle
 * (CHARTS-RESEARCH `DIAGNOSIS-scale-rows-mark-card.md`). The library is the
 * ground truth, asked two ways, because either alone lies:
 *
 * - `linear`/`sqrt`/`log` need NUMBERS, and over dates or categories the
 *   library does not reject them: it resolves a fabricated `[0, 1]` and draws
 *   an empty chart (dates) or throws only at paint (categories). So the
 *   axis's own `auto` reading decides the value kind first.
 * - The candidate type must then RESOLVE, which is what catches `log-domain`,
 *   `bad-time-domain` and `bad-scale` — and what lets `time` fit a bar whose
 *   ISO dates `auto` reads as band.
 *
 * `auto` always fits. Twelve domain resolutions (two axes × six types), no
 * render; the Dock recomputes it only when the marks change.
 */
export function chartsWorkbenchScaleTypeFits(
  state: ChartsWorkbenchState,
): Readonly<Record<"x" | "y", ChartsScaleTypeFitTable>> {
  const cartesian = chartsWorkbenchHasCartesianMark(state);
  const zeroAnchored = chartsWorkbenchHasZeroAnchoredMark(state);
  const table = (axis: "x" | "y"): ChartsScaleTypeFitTable => {
    const auto = cartesian ? probeAxisDomain(state, axis, "auto") : undefined;
    const fit = (type: ChartsWorkbenchScale["type"]): ChartsScaleTypeFit => {
      if (type === "auto") return CHARTS_SCALE_TYPE_FITS;
      if (!cartesian) return { fits: false, short: "no x/y scale", reason: CHARTS_NO_SCALE_REASON };
      if (!auto?.ok) return { fits: false, short: "unreadable", reason: "This axis's data can't be read as a scale." };
      if (CHARTS_NUMERIC_SCALE_TYPES.has(type) && auto.domain.type !== "linear") {
        const holds = auto.domain.type === "time" ? "dates" : "categories";
        return {
          fits: false,
          short: "needs numbers",
          reason: `A ${type} scale needs number values; this axis holds ${holds}.`,
        };
      }
      const probe = probeAxisDomain(state, axis, type);
      if (probe.ok) return CHARTS_SCALE_TYPE_FITS;
      if (probe.code === "log-domain") {
        return axis === "y" && zeroAnchored
          ? {
              fits: false,
              short: "can't show 0",
              reason: "A log scale can't include zero, and a bar, area or rect value axis always does.",
            }
          : { fits: false, short: "needs one sign", reason: "A log scale needs values of one sign, with no zero." };
      }
      if (probe.code === "bad-scale")
        return { fits: false, short: "must be numeric", reason: "A bar, area or rect value axis must be numeric." };
      if (probe.code === "bad-time-domain")
        return { fits: false, short: "needs dates", reason: "A time scale needs date values (YYYY-MM-DD)." };
      return { fits: false, short: "unavailable", reason: `This data can't be drawn on a ${type} scale.` };
    };
    return Object.fromEntries(CHART_SCALE_TYPES.map((type) => [type, fit(type)])) as Record<
      ChartsWorkbenchScale["type"],
      ChartsScaleTypeFit
    >;
  };
  return { x: table("x"), y: table("y") };
}

export interface ChartsScaleSliderBounds {
  readonly min: number;
  readonly max: number;
  /** Bar/area/rect y-domain only: the low thumb's own reachable ceiling
   *  and the high thumb's own reachable floor — both `0`, so no thumb
   *  position can ever push the committed domain's minimum above zero or
   *  its maximum below zero (P1: `bar-domain-excludes-zero`). */
  readonly loCeiling?: number;
  /** Log scale only: the sign-exclusion cap for BOTH ends, following the
   *  domain's own SIGN — a small value derived from the domain's own
   *  extent (NOT the padded `min`/`max` above, which a typed value is
   *  otherwise free to undercut/overshoot — `0.001` on a `[1, 1000]`
   *  domain, or `-50` on a `[-100, -1]` one, still render fine and must
   *  stay reachable). For a POSITIVE domain this is a small positive FLOOR
   *  (`RangeSlider` applies `Math.max`); for a domain that is entirely
   *  NEGATIVE it is a small negative CEILING (`Math.min`) instead — a
   *  positive floor there pushed every negative value UP across zero
   *  (the reported `[null, 5e-324]` corruption of a typed `-50` after a
   *  Shift+arrow nudge). Guarantees a typed or dragged min/max can never
   *  cross `0`, which trips the library's own `log-domain` rule and used
   *  to blank the whole chart (NEW-1, REVIEW-dock-colours-sliders-opus-
   *  round2.md — a log domain must keep one sign on both ends, not just
   *  the minimum). `RangeSlider`'s own `loFloor` applies it to both
   *  thumbs' commits without touching either one's native HTML attribute
   *  — see that component's own doc for why. */
  readonly loFloor?: number;
  readonly hiFloor?: number;
}

/**
 * The LEGAL slider bounds for one axis's resolved scale type — never a
 * flat +/-20% pad, which let a bar/area/rect y-domain's low thumb cross
 * zero (excluding it from the committed domain) and let a log domain's pad
 * go negative or through zero (both hard `chartError`s that used to blank
 * the whole chart). `domainMin`/`domainMax` are the actual, already-legal
 * inferred domain (for a zero-anchored mark, `numericDomain` in
 * `scales.ts` has already forced `domainMin <= 0 <= domainMax` — this
 * function narrows the DRAGGABLE range around that fact, it doesn't
 * establish it).
 *
 * - `log`, POSITIVE domain: `[domainMin / 1.2, domainMax * 1.2]` —
 *   multiplicative padding, since additive padding on a log domain
 *   routinely crosses zero. BOTH ends additionally get `loFloor` (NEW-1:
 *   the SAME cap MECHANISM the zero-anchored case uses below, applied to
 *   the opposite kind of boundary — a sign/zero exclusion rather than a
 *   zero-anchor) — a tiny positive value derived from `domainMin`, never
 *   the padded `min` itself, so a typed value well outside the padded
 *   bounds but still legitimately positive (`0.001` on a `[1, 1000]`
 *   domain) stays reachable exactly as P2-1 already allows; only `0` and
 *   negative values (the actual `log-domain` violation) are refused.
 * - `log`, NEGATIVE domain (a log domain need not be positive — only
 *   zero-containing or sign-crossing domains are illegal, AGENTS.md's
 *   "Charts"): the padding MIRRORS the positive case outward from zero —
 *   `[domainMin * 1.2, domainMax / 1.2]` (`domainMin` is the MORE negative
 *   end, so multiplying it by `1.2` moves it further from zero; `domainMax`
 *   is the end CLOSEST to zero, so dividing by `1.2` moves it closer still,
 *   mirroring how `domainMin / 1.2` moves the positive case's closest-to-
 *   zero end closer). `loFloor` mirrors into a CEILING the same way — a
 *   tiny NEGATIVE value derived from `domainMax` (the end closest to
 *   zero), so `RangeSlider`'s sign-aware clamp (see its own `loFloor` doc)
 *   applies `Math.min` instead of `Math.max` and a typed/dragged value can
 *   approach zero but never reach or cross it.
 * - zero-anchored (`zeroAnchored`): pad AWAY from zero only — the low
 *   bound moves further negative only when it's already negative, the
 *   high bound further positive only when it's already positive — and the
 *   low/high THUMBS are additionally capped at `loCeiling`/`hiFloor: 0`,
 *   because bounds alone don't stop a thumb from being dragged to the
 *   wrong side of zero within them.
 * - otherwise: the original symmetric +/-20%-of-span pad (a plain line/dot
 *   chart's axis legitimately need not include zero at all).
 */
export function chartsScaleSliderBounds(
  type: "linear" | "log" | "sqrt" | "time",
  domainMin: number,
  domainMax: number,
  zeroAnchored: boolean,
): ChartsScaleSliderBounds {
  const span = domainMax - domainMin;
  if (type === "log") {
    if (domainMax < 0) {
      // Entirely negative domain — mirror the positive branch below: pad
      // outward (more negative on the low end, closer to zero on the high
      // end) and cap both ends at a tiny NEGATIVE ceiling near the
      // closest-to-zero bound, never the fallback's positive
      // `Number.MIN_VALUE` (that literal pushed every negative value UP
      // across zero — see `loFloor`'s own doc).
      const loFloor = domainMax < 0 ? domainMax * 1e-6 : -Number.MIN_VALUE;
      return { min: domainMin * 1.2, max: domainMax / 1.2, loFloor };
    }
    const loFloor = domainMin > 0 ? domainMin * 1e-6 : Number.MIN_VALUE;
    return { min: domainMin / 1.2, max: domainMax * 1.2, loFloor };
  }
  // `domainMin <= 0 <= domainMax` already holds whenever `zeroAnchored` —
  // subtracting from a non-positive `domainMin` and adding to a
  // non-negative `domainMax` can only move EACH bound further from zero,
  // never past it onto the other side, so the pad itself needs no special
  // casing; only the THUMB caps (`loCeiling`/`hiFloor`) are new.
  const pad = span > 0 ? span * 0.2 : (Math.abs(domainMin) || 1) * 0.2;
  return { min: domainMin - pad, max: domainMax + pad, ...(zeroAnchored ? { loCeiling: 0, hiFloor: 0 } : {}) };
}

/** `true` iff any mark in the workbench is a `bar`/`area`/`rect` —
 *  mirrors `@glyphcss/charts`' own `hasZeroAnchoredMark` (`scales.ts`,
 *  unexported), which is exactly the condition under which the library
 *  forces zero into the Y domain and rejects a domain that excludes it. */
export function chartsWorkbenchHasZeroAnchoredMark(state: ChartsWorkbenchState): boolean {
  return state.marks.some((mark) => ["bar", "area", "rect"].includes(mark.type));
}

/** `arc`/`sankey`/`funnel` are non-cartesian (AGENTS.md's "Charts" — "plumbed
 *  exactly like `arc`": excluded from the x/y scales, from the cartesian
 *  layout gutter, from `transform`). `glyphChartScaleDomains` still resolves
 *  SOME `{ type: "linear", domain: [0, 1] }` for such a spec regardless —
 *  it has no "no scale" answer to give, since a scale is exactly what these
 *  mark types don't have — so a Dock reading that placeholder as a real,
 *  draggable domain (DIAGNOSIS-scale-domain.md P3-4) is this state layer's
 *  own bug to close, not the library's: nothing downstream of a committed
 *  drag on that fabricated `[0, 1]` range ever reads `scales.x`/`scales.y`
 *  for a chart made only of these mark types, so the control was live over
 *  a domain the render could never see. */
const CHARTS_NON_CARTESIAN_MARK_TYPES: ReadonlySet<GlyphChartMarkType> = new Set(["arc", "sankey", "funnel"]);

/** `true` iff at least one mark actually reads an x/y scale — `false` only
 *  when EVERY mark is `arc`/`sankey`/`funnel`, which is what the Dock's
 *  Scales rows key their "this chart type has no x/y scale" disabled state
 *  on (`ScaleDomainControl`, `ChartsDock.tsx`) instead of trusting
 *  `chartsWorkbenchInferredDomains`' placeholder domain. */
export function chartsWorkbenchHasCartesianMark(state: ChartsWorkbenchState): boolean {
  return state.marks.some((mark) => !CHARTS_NON_CARTESIAN_MARK_TYPES.has(mark.type));
}

/** A `RangeSlider`'s numeric domain is timestamps for a `"time"` scale,
 *  the raw number otherwise — the same two cases `buildScale`'s own
 *  `parse`/domain-mapping already distinguish. `null` for an unparsed or
 *  non-finite value (an in-progress edit, or a bound that doesn't apply to
 *  a "band" scale, which never reaches this helper). */
export function chartsScaleBoundToNumber(type: "linear" | "log" | "sqrt" | "time", raw: string): number | null {
  if (type === "time") {
    const t = new Date(raw).getTime();
    return Number.isFinite(t) ? t : null;
  }
  const n = Number(raw);
  return raw.trim() !== "" && Number.isFinite(n) ? n : null;
}

/** The inverse of `chartsScaleBoundToNumber` — what `set-scale`'s `min`/`max` string fields store. */
export function chartsNumberToScaleBound(type: "linear" | "log" | "sqrt" | "time", value: number): string {
  return type === "time" ? new Date(value).toISOString() : String(value);
}

/**
 * The coarsest calendar unit every date on an axis sits on: every value on
 * Jan 1 is `"year"`, every value on the 1st is `"month"`, every value at UTC
 * midnight is `"day"`, anything finer is `"time"`. The Scales row shows and
 * snaps a time domain at this unit (CHARTS-RESEARCH
 * `DIAGNOSIS-scale-rows-mark-card.md`): a yearly axis reads "1980"–"2024",
 * not a date cut to "198".
 */
export type ChartsTimePrecision = "year" | "month" | "day" | "time";

export function chartsTimePrecisionOf(stamps: readonly number[]): ChartsTimePrecision {
  if (stamps.length === 0) return "day";
  let precision: ChartsTimePrecision = "year";
  for (const stamp of stamps) {
    const date = new Date(stamp);
    if (date.getUTCHours() || date.getUTCMinutes() || date.getUTCSeconds() || date.getUTCMilliseconds()) return "time";
    if (date.getUTCDate() !== 1) precision = "day";
    else if (precision === "year" && date.getUTCMonth() !== 0) precision = "month";
  }
  return precision;
}

const CHARTS_ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?)?$/;

/** A strict ISO date (the shape `@glyphcss/charts` reads as `time`), as a
 *  UTC timestamp; `null` for anything else — never `new Date("5.1")`, which
 *  V8 happily reads as a date. */
export function chartsIsoDateStamp(raw: string): number | null {
  return CHARTS_ISO_DATE.test(raw.trim()) ? chartsTimeBoundFromDisplay(raw) : null;
}

/** The precision of every date the cartesian marks put on `axis`, read off
 *  the same mark data `buildMark` hands the library. */
export function chartsWorkbenchAxisTimePrecision(state: ChartsWorkbenchState, axis: "x" | "y"): ChartsTimePrecision {
  const stamps: number[] = [];
  for (const mark of state.marks) {
    const field = (mark.channels as Readonly<Record<string, string | undefined>>)[axis];
    if (!field || CHARTS_NON_CARTESIAN_MARK_TYPES.has(mark.type)) continue;
    let rows: GlyphChartMark["data"];
    try {
      rows = parseChartMarkData(mark);
    } catch {
      continue;
    }
    for (const row of rows) {
      if (typeof row === "number") continue;
      const raw = (row as Readonly<Record<string, unknown>>)[field];
      const stamp = raw instanceof Date ? raw.getTime() : typeof raw === "string" ? chartsIsoDateStamp(raw) : null;
      if (stamp !== null && Number.isFinite(stamp)) stamps.push(stamp);
    }
  }
  return chartsTimePrecisionOf(stamps);
}

/** Average length of each calendar unit — the time slider's native step, so
 *  one arrow press moves one unit and `chartsTimeBoundSnap` lands it exactly. */
export const CHARTS_TIME_UNIT_MS: Readonly<Record<Exclude<ChartsTimePrecision, "time">, number>> = {
  year: 31_556_952_000, // 365.2425 days
  month: 2_629_746_000, // a twelfth of that
  day: 86_400_000,
};

function chartsUtcDay(year: number, month: number, day: number): number {
  const date = new Date(0);
  date.setUTCFullYear(year, month, day);
  date.setUTCHours(0, 0, 0, 0);
  return date.getTime();
}

/** Pulls a timestamp onto `precision`'s own grid (Jan 1, the 1st, midnight):
 *  `"round"` for a thumb, `"floor"`/`"ceil"` for the slider's outer bounds so
 *  the native step grid starts on a unit boundary. `"time"` is untouched. */
export function chartsTimeBoundSnap(
  value: number,
  precision: ChartsTimePrecision,
  mode: "round" | "floor" | "ceil" = "round",
): number {
  if (precision === "time") return value;
  const date = new Date(value);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();
  const lo =
    precision === "year"
      ? chartsUtcDay(year, 0, 1)
      : precision === "month"
        ? chartsUtcDay(year, month, 1)
        : chartsUtcDay(year, month, day);
  if (lo === value) return value;
  const hi =
    precision === "year"
      ? chartsUtcDay(year + 1, 0, 1)
      : precision === "month"
        ? chartsUtcDay(year, month + 1, 1)
        : chartsUtcDay(year, month, day + 1);
  if (mode === "floor") return lo;
  if (mode === "ceil") return hi;
  return value - lo < hi - value ? lo : hi;
}

const CHARTS_TIME_PRECISION_ORDER: readonly ChartsTimePrecision[] = ["time", "day", "month", "year"];

/** The unit a time domain's row SHOWS, STEPS and SNAPS a thumb at: the
 *  coarser of the data's own unit and the span's — the unit the axis's own
 *  ticks run at ("every tick is a year" reads `1980`–`2024`). A span of three
 *  years or more is `"year"`, two months or more `"month"`, two days or more
 *  `"day"`. A coarser unit's boundaries are all finer-unit boundaries too, so
 *  a snapped thumb always lands on a real data position; the full date rides
 *  on each field's title, and a typed date still commits exactly. Month is
 *  the widest string a two-field row at the Dock's width can show without
 *  starving the track (CHARTS-RESEARCH `DIAGNOSIS-scale-rows-mark-card.md`). */
export function chartsTimeDisplayPrecision(precision: ChartsTimePrecision, spanMs: number): ChartsTimePrecision {
  const byspan: ChartsTimePrecision =
    spanMs >= 3 * CHARTS_TIME_UNIT_MS.year
      ? "year"
      : spanMs >= 62 * CHARTS_TIME_UNIT_MS.day
        ? "month"
        : spanMs >= 2 * CHARTS_TIME_UNIT_MS.day
          ? "day"
          : "time";
  return CHARTS_TIME_PRECISION_ORDER[
    Math.max(CHARTS_TIME_PRECISION_ORDER.indexOf(precision), CHARTS_TIME_PRECISION_ORDER.indexOf(byspan))
  ]!;
}

/**
 * `RangeSlider`'s DISPLAY string for a `"time"` domain end — never
 * `toLocaleDateString()`/`new Date(raw)`, which are not inverses of each
 * other and are locale-dependent (P2-2, REVIEW-dock-colours-sliders-opus.md:
 * `de-DE "15.6.2024"` and `en-GB "15/06/2024"` both parsed back as `Invalid
 * Date`, and `en-US "6/15/2024"` parsed back a day off by the reader's own
 * UTC offset). A plain UTC ISO prefix at `precision` (`YYYY`, `YYYY-MM`,
 * `YYYY-MM-DD`, `YYYY-MM-DDTHH:mm`); `chartsTimeBoundFromDisplay` reads every
 * one of those shapes back, so a typed `1990` commits Jan 1 1990 exactly.
 */
export function chartsTimeBoundDisplay(value: number, precision: ChartsTimePrecision = "day"): string {
  const iso = new Date(value).toISOString();
  return iso.slice(0, precision === "year" ? 4 : precision === "month" ? 7 : precision === "day" ? 10 : 16);
}

export function chartsTimeBoundFromDisplay(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const calendar = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/.exec(trimmed);
  if (calendar) {
    const year = Number(calendar[1]);
    const month = calendar[2] ? Number(calendar[2]) - 1 : 0;
    const day = calendar[3] ? Number(calendar[3]) : 1;
    const stamp = chartsUtcDay(year, month, day);
    const date = new Date(stamp);
    // `setUTCFullYear` rolls 2024-02-31 over into March; refuse it instead.
    return date.getUTCFullYear() === year && date.getUTCMonth() === month && date.getUTCDate() === day ? stamp : null;
  }
  // A zoneless date-time is LOCAL to `new Date`; every bound here is UTC.
  const zoned = /T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(trimmed) ? `${trimmed}Z` : trimmed;
  const t = new Date(zoned).getTime();
  return Number.isFinite(t) ? t : null;
}

/** A numeric domain end shown at the slider step's own precision (`step`
 *  2000 → no decimals, 0.5 → one) — "175604.63" in a field sized for six
 *  characters was "175". Display only: a typed value commits as typed. */
export function chartsDomainNumberDisplay(value: number, step: number): string {
  const decimals = step > 0 && Number.isFinite(step) ? Math.min(6, Math.max(0, Math.ceil(-Math.log10(step)))) : 3;
  return String(Number(value.toFixed(decimals)));
}

/**
 * `viewportPx` — the measured live viewport box (`useElementSize`) — is
 * read ONLY on `web`; every other target ignores it entirely, exactly as
 * it ignores `state.controls.overrides.width`/`.height` there (this
 * function's own "Web viewport fill" doc, above `chartsWorkbenchWebGridSize`).
 */
export function chartsWorkbenchRenderOptions(
  state: ChartsWorkbenchState,
  viewportPx?: GlyphPixelBox,
): GlyphChartRenderOptions {
  // `legend` is NOT set here — it already rides in the built spec
  // (`buildChartsWorkbenchSpec`, carrying the chosen placement), and a
  // render `options.legend` would OVERRIDE that placement object with a
  // plain boolean (`resolveGlyphChartLegendOption`'s documented precedence).
  //
  // `density` is stripped out of the spread rather than reaching
  // `renderGlyphChart` — it is a WEBSITE-only render-grid multiplier, not a
  // library render option, and this function's own return type
  // (`GlyphChartRenderOptions`) has no such field. Off `web`, `resolved`'s
  // width/height stay the reader's LOGICAL size and only the values
  // actually handed to the library are multiplied, at the SAME render pass
  // the library already runs — glyphcss's own `density` never adds a pass
  // either (AGENTS.md's "Per-mesh detail layers"). ON `web`, `resolved`'s
  // own width/height (the override, or the target default) are DISCARDED
  // outright — `chartsWorkbenchWebGridSize` derives the grid from the
  // measured viewport instead (`chartsWorkbenchSizeLocked`'s own doc: the
  // Width/Height sliders own nothing there).
  const { density: _density, ...resolved } = resolveGlyphChartsWorkbenchControls(state.controls);
  const density = chartsWorkbenchEffectiveDensity(state.controls);
  // Integer only: the library lays text out in whole cells and rejects a
  // fractional `textScale`; `chartsWorkbenchHtmlColor.ts` corrects the
  // painted size (and its `width` reservation) to the fractional density.
  const textScale = Math.round(density);
  // `size` OVERRIDES `resolved.width`/`.height` below regardless of which
  // branch runs (object-spread order) — computed separately only so the
  // `web` branch never even READS `resolved.width`/`.height` (the ignored
  // override), rather than computing a value and throwing it away.
  const size =
    state.controls.target === "web"
      ? chartsWorkbenchWebGridSize(viewportPx, density)
      : { width: Math.round(resolved.width * density), height: Math.round(resolved.height * density) };
  return {
    ...resolved,
    width: size.width,
    height: size.height,
    detail: state.controls.overrides.detail ?? "auto",
    // `@glyphcss/charts`' own `textScale` (AGENTS.md's "Charts" "Density"
    // paragraph) — the library's ONE render, two-font-size mechanism that
    // keeps chart TEXT at a readable size on the denser grid above. Omitted
    // (never `1`) at `round(density) === 1` — the library's own
    // byte-identical default — matching every other option here (`env`,
    // `charset`/`color`/`width`/`height` themselves) that rides in the
    // returned object only when it differs from doing nothing; this also
    // keeps the generated TypeScript snippet and every option-object
    // snapshot untouched at the page's own default density.
    ...(textScale !== 1 ? { textScale } : {}),
    // Omitted at `auto` (the library default), like `textScale` above.
    ...(state.style.regionFill !== undefined ? { regionFill: state.style.regionFill } : {}),
    ...(state.controls.target === "terminal"
      ? {
          env: {
            ...(state.terminal.NO_COLOR ? { NO_COLOR: "1" } : {}),
            ...(state.terminal.FORCE_COLOR ? { FORCE_COLOR: "1" } : {}),
          },
        }
      : {}),
  };
}

export function generateChartsWorkbenchSnippets(state: ChartsWorkbenchState, viewportPx?: GlyphPixelBox) {
  const spec = buildChartsWorkbenchSpec(state);
  const options = chartsWorkbenchRenderOptions(state, viewportPx);
  const json = JSON.stringify(spec, null, 2);
  return {
    json,
    ...cellOutputSnippets({
      imports: 'import { glyphChartPlot, renderGlyphChart, encodeGlyphChart } from "@glyphcss/charts";',
      htmlExpression: 'encodeGlyphChart(output.build, "html")',
      setup: `const spec = ${json};`,
      expression: `renderGlyphChart(glyphChartPlot(spec), ${JSON.stringify(options, null, 2)})`,
      component: "GlyphChart",
    }),
    typescript: `import { glyphChartPlot, renderGlyphChart } from "@glyphcss/charts";\n\nconst chart = renderGlyphChart(glyphChartPlot(${json}), ${JSON.stringify(options, null, 2)});\n`,
  };
}
