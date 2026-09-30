// `/charts` 3D (packet C3, generalized to every 3D mark type by packet C6,
// AGENTS.md's "Charts 3D"): the state, fit-table and resolve helpers a
// `ChartsWorkbenchState` needs to host a live `GlyphChart3dMark` — surface,
// scatter3d, parametric3d, bars3d or line3d — alongside its existing 2D
// marks. Mirrors `chartsMarkTypeFit.ts`'s own "a type fits iff the built
// mark validates" idiom, never a restated rule of its own — the library's
// own constructors decide.
import {
  GLYPH_CHART_TICK_FORMAT_PRESET_NAMES,
  type GlyphChartCharset,
  type GlyphChartColorMode,
} from "@glyphcss/charts";
import {
  GLYPH_CHART_3D_DEFAULT_CAMERA,
  glyphChartBars3d,
  glyphChartLine3d,
  glyphChartParametric3d,
  glyphChartScatter3d,
  glyphChartSurface,
  type GlyphChart3dAxisOptions,
  type GlyphChart3dBarsChannels,
  type GlyphChart3dColorscaleName,
  type GlyphChart3dMark,
  type GlyphChart3dScatterChannels,
  type GlyphChart3dStyle,
  type GlyphChart3dSurfaceChannels,
  type GlyphChart3dSurfaceOptions,
} from "@glyphcss/charts/3d";
import { CHARTS_3D_DATASETS, findCharts3dDataset, type Chart3dDataset } from "../data/chart3d/index";
import { profileRows, type ColumnProfile } from "../tabular/dataProfile";
import type { TabularRow } from "../tabular/tabularParse";
import { chartsMarkTypeBase } from "./chartsMarkData";
import type { ChartsWorkbenchDataState, ChartsWorkbenchMark } from "./chartsSpec";

export type Charts3dOrbitMode = "turntable" | "trackball";

/**
 * Codex review finding (relayed by the coordinator): the live 3D viewport
 * hard-coded `mode: "solid"` and never read charset/style at all, so a
 * braille selection rendered solid geometry live while the STATIC exit
 * (Copy, terminal) resolved the SAME selection to a real depth-tested
 * wireframe (`render.ts`'s own `resolveGlyphChart3dStyle`) — live and Copy
 * disagreed on the picture for the identical state, and `style: "ink"` was
 * unreachable live at all.
 *
 * GAP (named, not fixed here — C2 round 5 owns `packages/charts/src/3d`):
 * `resolveGlyphChart3dStyle` and the `mode`/`charMode`/`hiddenLines`
 * assembly it feeds (`render.ts`'s `renderObjectFrame`) are private,
 * unexported functions — there is no public resolver a live-scene consumer
 * can call to stay in sync with the static exit's own resolution.
 * `resolveCharts3dStyle`/`chartsWorkbench3dSceneOptions` below are a
 * page-local MIRROR of that exact (small, stable) logic, verified line for
 * line against `render.ts`'s own `resolveGlyphChart3dStyle`/`chromeTier`/
 * `renderObjectFrame` — never re-derived or guessed. Exporting the two
 * library functions by name would let this page call them directly
 * instead of maintaining a copy.
 */
export type Charts3dStyleOption = "auto" | GlyphChart3dStyle;

/** Mirrors `render.ts`'s own `resolveGlyphChart3dStyle` exactly: an
 *  explicit style always wins; `"auto"` resolves `braille` to `"wireframe"`
 *  (glyphcss's braille encoder is wireframe-only) and every other charset
 *  to `"solid"`. */
export function resolveCharts3dStyle(charset: GlyphChartCharset, styleOption: Charts3dStyleOption): GlyphChart3dStyle {
  if (styleOption !== "auto") return styleOption;
  return charset === "braille" ? "wireframe" : "solid";
}

/**
 * Which axis-line geometry the LIVE viewport mounts, mirroring
 * `renderGlyphChart3d`'s own resolution so the orbit view and Copy/terminal
 * draw the same axis for the same state.
 *
 * USER DECISION, verbatim: "those are the axes we should be using" —
 * `"thin"` (one degenerate face traced as a single sub-cell line, as fine
 * as the data beside it) wherever the scene can trace lines at all, and the
 * ribbon everywhere else, since a degenerate face has no AREA and a solid
 * mode would paint no axis from it at all.
 */
export function charts3dAxisRender(mode: string): "thin" | "geometry" {
  return mode === "wireframe" ? "thin" : "geometry";
}

/** Mirrors `render.ts`'s own `chromeTier` exactly: `blocks` degrades to
 *  `ascii` for the object's own always-mounted grid/tick overlay glyphs —
 *  the geometry can never actually render in halfblock either
 *  (`glyphChart3dCharsetDegrades`), so the overlay tier follows suit. */
export function charts3dObjectCharset(charset: GlyphChartCharset): GlyphChartCharset {
  return charset === "blocks" ? "ascii" : charset;
}

/**
 * Packet C4, item 1 — the View folder's guide toggles. Derived structurally
 * off `glyphChartSurface`'s own `GlyphChart3dSurfaceOptions["guides"]`
 * field (`packages/charts/src/3d/types.ts`'s `GlyphChart3dGuideOptions`)
 * rather than a hand-duplicated `{ axisLines, ticks, ... }` shape — the
 * fields ride along verbatim from whatever the library's own input type
 * declares, so a field the library adds later needs no shape edit here
 * (only a new toggle row in `ChartsDock.tsx`). NOTE (a library-export gap
 * to fix, not fixed here — C2 round 5 owns `packages/charts/src/3d`):
 * `GlyphChart3dGuideOptions`/`GlyphChart3dResolvedGuides`/`GlyphChart3dCornerOption`
 * are NOT in `@glyphcss/charts/3d`'s own `index.ts` export list (only
 * `GlyphChart3dSurfaceOptions`, which structurally references the
 * unexported type, is) — this derived-by-indexed-access type is the
 * workaround; exporting them by name would let a future page read the
 * type directly instead.
 */
export type Charts3dGuideOptions = NonNullable<GlyphChart3dSurfaceOptions["guides"]>;
/** `"auto"` (the default) OMITS `options.shading` from the `glyphChartSurface`
 *  call entirely, so the LIBRARY's own default applies — never re-derived
 *  or hardcoded here (a coordination note from the C2 fix round: its
 *  default is becoming colour-mode-aware, `"value"` under `color: "none"`,
 *  so a page-side `?? "relief"` would silently fight it). `"relief"`/
 *  `"value"` are an explicit reader override from the View folder.
 *  SURFACE-ONLY (packet C6): no other mark type's own options carry a
 *  `shading` field, so this is ignored (never forwarded) while a
 *  non-surface 3D type is active. */
export type Charts3dShading = "auto" | "relief" | "value";

export interface Charts3dCamera {
  readonly rotX: number;
  readonly rotY: number;
  /** `undefined` = auto-fit (`glyphChart3dFitCamera`'s own contract — the
   *  default, and what every reset returns to). Never computed here: a
   *  fitted zoom always comes from calling that function (or from
   *  `renderGlyphChart3d`'s own internal auto-fit when this stays
   *  `undefined`), so a library-side change to its margin/safety defaults
   *  reaches this page with no code change. */
  readonly zoom?: number;
  /** Trackball orientation (`createGlyphOrbitControls`'s own `mode:
   *  "trackball"` path, a 9-element row-major 3x3 matrix) — set alongside
   *  `useMat: true` whenever the live viewport's orbit mode is trackball;
   *  `rotX`/`rotY` still ride along (turntable's own last pose before a
   *  mode switch) but are NOT what a trackball orientation renders from.
   *  `renderGlyphChart3d`'s own `camera` option accepts `{ mat, zoom, center
   *  }` now (packet C4, closing the earlier library gap this doc used to
   *  name) — `chartsWorkbench3dRender.ts` threads `mat`/`useMat` straight
   *  through, so the static exit (terminal/chat/Copy ASCII/ANSI) reproduces
   *  a trackball pose exactly. */
  readonly mat?: readonly number[];
  readonly useMat?: boolean;
  /** The orbit controls' own pan target (`GlyphOrbitControlsHandle.getTarget()`
   *  — `createGlyphOrbitControls`'s "Numeric conventions" doc) — a middle/
   *  right/Shift-drag or two-finger pan moves `camera.target` off the mark's
   *  own fitted centre, and this is what lets that offset survive an orbit-
   *  drag release into `?c=`/Copy/a later mount, append-only. `undefined`
   *  (the default, and what "Reset camera" always returns to) means the
   *  fitted centre — `Charts3dViewport.tsx`'s own mount effect, which never
   *  reads this key at all for an untouched camera. */
  readonly pan?: readonly [number, number, number];
}

/**
 * `createGlyphOrbitControls`'s own `zoomRange` auto-derive factor
 * (`AUTO_ZOOM_RANGE_FACTOR`, `packages/glyphcss/src/api/createGlyphOrbitControls.ts`),
 * mirrored here so `Charts3dViewport.tsx` can compute an EXPLICIT range
 * around the mounted camera's own fitted zoom — a fitted 3D-chart camera
 * routinely sits at 500+, well outside the library's pre-`zoomRange` hard-
 * coded `[0.1, 500]` clamp, which is what made the very first wheel notch
 * snap a fitted view back down to 500 ("the zoom has limits", user report).
 * Passing it explicitly (rather than relying on the library's own mount-time
 * auto-derive) keeps the range deterministic and re-derivable after a mark-
 * type swap re-fits the camera to a wholly different object's bounds.
 */
export const CHARTS_3D_ZOOM_RANGE_FACTOR = 64;
export function charts3dZoomRange(zoom: number): [number, number] {
  const z = Math.abs(zoom) || 1;
  return [z / CHARTS_3D_ZOOM_RANGE_FACTOR, z * CHARTS_3D_ZOOM_RANGE_FACTOR];
}

/** Every mark type `@glyphcss/charts/3d` exposes — the mark card's Type
 *  toggle (packet C6, `ChartsMarkCard.tsx`) offers one button per entry. */
export const CHARTS_3D_MARK_TYPES = ["surface", "scatter3d", "bars3d", "line3d", "parametric3d"] as const;
export type Charts3dMarkTypeId = (typeof CHARTS_3D_MARK_TYPES)[number];

/** A vendored `datasets/chart3d/` entry, or an INLINE mark resolved from
 *  the reader's own currently-loaded table (`chartsFitTableFromRows`,
 *  below) or a freshly-loaded Hugging Face table (`chartsBest3dFitFromRows`)
 *  — real data, just not one of the vendored presets. One variant per mark
 *  type that can honestly be fit FROM a tabular table — `parametric3d` has
 *  none (packet C6: a parametric surface needs a closed-form `(u, v)`
 *  sampling function, which a table of rows can never supply — preset-only,
 *  by contract, never offered as fitting arbitrary data). `line3d`'s own
 *  `channels` are plain field names (never the constructor's own function-
 *  channel escape hatch) SPECIFICALLY so this shape stays JSON-safe end to
 *  end — `chartsUrlStateForEncode` keeps `channels` in the link (only
 *  `rows` is blanked), and a function value silently vanishes under
 *  `JSON.stringify`. */
export type Charts3dChannels = {
  readonly x: string;
  readonly y: string;
  readonly z: string;
  readonly series?: string;
  readonly xLabel?: string;
  readonly yLabel?: string;
};

export type Charts3dSource = {
  readonly description?: string;
  readonly attribution?: { readonly name: string; readonly url: string; readonly licence?: string };
} & (
  | { readonly kind: "dataset"; readonly id: string; readonly channels?: Charts3dChannels }
  | {
      readonly kind: "inline";
      readonly markType: "surface";
      readonly title: string;
      readonly rows: readonly TabularRow[];
      readonly channels: GlyphChart3dSurfaceChannels;
    }
  | {
      readonly kind: "inline";
      readonly markType: "scatter3d";
      readonly title: string;
      readonly rows: readonly TabularRow[];
      readonly channels: { readonly x: string; readonly y: string; readonly z: string; readonly series?: string };
    }
  | {
      readonly kind: "inline";
      readonly markType: "bars3d";
      readonly title: string;
      readonly rows: readonly TabularRow[];
      readonly channels: {
        readonly x: string;
        readonly y: string;
        readonly z: string;
        readonly xLabel?: string;
        readonly yLabel?: string;
      };
    }
  | {
      readonly kind: "inline";
      readonly markType: "line3d";
      readonly title: string;
      readonly rows: readonly TabularRow[];
      readonly channels: { readonly x: string; readonly y: string; readonly z: string };
    }
);

/**
 * Per-axis reader overrides (the addendum's Axes-folder rows, packet C6;
 * widened to every C7 field by the coordinator's own follow-up) — mirrors
 * `Charts3dGuideOptions`'s own "empty means every field follows the
 * library/dataset default" contract: an empty `{}` (every axis) changes
 * nothing, and only a field the reader actually touched rides through to
 * the built mark's own `options.axes.{x,y,z}`. `title: ""` and every other
 * field `undefined` mean "no override", mirroring 2D's own
 * `ChartsWorkbenchAxis`'s "`title: ''` means auto" rule.
 *
 * `format` is a BARE PRESET NAME ONLY (`CHARTS_3D_AXIS_FORMAT_NAMES`,
 * below) — the library's own `GlyphChartTickFormat` also accepts `{
 * preset, ...params }` and a raw callback, neither of which this Dock row
 * offers a field for (a per-preset param editor, e.g. `currency`'s own
 * `symbol`, is out of this packet's scope); every offered preset has NO
 * required params so a bare name alone is always valid.
 */
export interface Charts3dAxisOverride {
  readonly title?: string;
  readonly ticks?: number;
  readonly format?: string;
  readonly line?: boolean;
  readonly tickMarks?: boolean;
  readonly tickLabels?: boolean;
  readonly grid?: boolean;
  readonly color?: string;
  readonly domain?: readonly [number, number];
  /** Axis title placement (user feedback, verbatim: "we need to be able to
   *  configure the position of the title of the axis") — mirrors the
   *  library's own `GlyphChart3dAxisOptions.titleAt`/`titleOffset`
   *  (AGENTS.md's "Axis title position"): `titleAt` is the origin corner's
   *  own start/centre/end of that axis's triad edge, `titleOffset` is how
   *  far outward (in the library's own fraction units, default `0.6`) the
   *  title pushes past the box. Both `undefined` (no override) follow the
   *  library's own default — `object.ts`'s `axisTitleAtT`/`axisTitleOffset`. */
  readonly titleAt?: "start" | "center" | "end";
  readonly titleOffset?: number;
}
export interface Charts3dAxesOverride {
  readonly x: Charts3dAxisOverride;
  readonly y: Charts3dAxisOverride;
  readonly z: Charts3dAxisOverride;
  /** The shared `axes.color` every axis's own `color` overrides (C7's own
   *  doc, mirroring 2D `axes.color`). */
  readonly color?: string;
}

/** Zero-required-param, NUMERIC-appropriate tick-format presets a bare
 *  Dock select can offer safely — every 3D axis domain is always plain
 *  linear numeric (`GlyphChart3dResolvedAxis.domain`), so the date/month/
 *  day/time/year presets (which read a tick's raw number as a TIMESTAMP)
 *  are wrong here and excluded; `decimals` and `template` both have a
 *  REQUIRED param this row has no field for and are excluded too.
 *  `GLYPH_CHART_TICK_FORMAT_PRESET_NAMES` is the library's own full list —
 *  this is a documented, safe SUBSET of it, never a restated one that could
 *  drift (each name is checked to still exist in that list, so a preset
 *  the library later renames or removes disappears from this row too,
 *  rather than offering a name `resolveGlyphChartTickFormat` would reject). */
const CHARTS_3D_AXIS_FORMAT_CANDIDATES = [
  "number",
  "si",
  "compact",
  "integer",
  "percent",
  "currency",
  "scientific",
] as const;
export const CHARTS_3D_AXIS_FORMAT_NAMES: readonly string[] = CHARTS_3D_AXIS_FORMAT_CANDIDATES.filter((name) =>
  GLYPH_CHART_TICK_FORMAT_PRESET_NAMES.includes(name),
);

export interface Charts3dViewState {
  readonly source: Charts3dSource;
  readonly camera: Charts3dCamera;
  readonly orbitMode: Charts3dOrbitMode;
  readonly shading: Charts3dShading;
  readonly colorscale: GlyphChart3dColorscaleName;
  /** `"auto"` (default) resolves per charset (`resolveCharts3dStyle`'s own
   *  doc) on BOTH exits; an explicit `"solid"`/`"wireframe"`/`"ink"` always
   *  wins, independent of charset, on both too. */
  readonly style: Charts3dStyleOption;
  /** Guide-overlay overrides (packet C4, item 1) — an EMPTY object (the
   *  default) means every guide follows the library's own defaults; only a
   *  field a reader has actually toggled is present here, so a future
   *  library default change reaches this page automatically for every
   *  untouched field. Always populated (never `undefined`), mirroring
   *  `effect3d`'s own "never a null check" rule. */
  readonly guides: Charts3dGuideOptions;
  /** Per-axis title/tick overrides (packet C6, coordinator addendum — "you
   *  cannot configure the z axis in the /charts sidebar"). Always
   *  populated with all three axes present (each individually empty by
   *  default), mirroring `guides`' own always-populated rule. */
  readonly axes: Charts3dAxesOverride;
}

/** Read straight off the library (`GLYPH_CHART_3D_DEFAULT_CAMERA`) — never
 *  a page-side `{ rotX: 65, rotY: 45 }` copy that could drift from it. */
export const CHARTS_3D_DEFAULT_CAMERA: Charts3dCamera = { ...GLYPH_CHART_3D_DEFAULT_CAMERA };

const EMPTY_AXES_OVERRIDE: Charts3dAxesOverride = { x: {}, y: {}, z: {} };

export function createCharts3dViewState(datasetId: string = CHARTS_3D_DATASETS[0]!.id): Charts3dViewState {
  return {
    source: { kind: "dataset", id: datasetId },
    camera: { ...CHARTS_3D_DEFAULT_CAMERA },
    orbitMode: "turntable",
    shading: "auto",
    colorscale: "viridis",
    style: "auto",
    guides: {},
    axes: EMPTY_AXES_OVERRIDE,
  };
}

export interface Charts3dResolved {
  readonly mark: GlyphChart3dMark;
  readonly title: string;
  readonly description: string;
  readonly source: { readonly name: string; readonly url: string; readonly licence?: string } | null;
}
export type Charts3dResolveResult =
  | { readonly ok: true; readonly resolved: Charts3dResolved }
  | { readonly ok: false; readonly error: string };

/** `title === ""` (no override) resolves to the dataset's/inline source's
 *  own title — 2D's own "empty means auto" rule (`ChartsWorkbenchAxis`'s
 *  own doc), applied here so a reader's override always wins. Every other
 *  field is a plain `override ?? datasetAxis` — a reader's explicit choice
 *  always wins, an untouched field keeps the dataset's own default (which
 *  may itself be undefined, letting the library's own default apply).
 *  Returns `undefined` when NOTHING overrides or sets any field, so the
 *  built call omits the key entirely and an unedited chart renders
 *  byte-identical to before this merge existed. */
function mergedAxisOption(
  datasetAxis: GlyphChart3dAxisOptions | undefined,
  override: Charts3dAxisOverride | undefined,
): GlyphChart3dAxisOptions | undefined {
  const title = override?.title && override.title.length > 0 ? override.title : datasetAxis?.title;
  const ticks = override?.ticks ?? datasetAxis?.ticks;
  const format = override?.format ?? datasetAxis?.format;
  const line = override?.line ?? datasetAxis?.line;
  const tickMarks = override?.tickMarks ?? datasetAxis?.tickMarks;
  const tickLabels = override?.tickLabels ?? datasetAxis?.tickLabels;
  const grid = override?.grid ?? datasetAxis?.grid;
  const color = override?.color ?? datasetAxis?.color;
  const domain = override?.domain ?? datasetAxis?.domain;
  const titleAt = override?.titleAt ?? datasetAxis?.titleAt;
  const titleOffset = override?.titleOffset ?? datasetAxis?.titleOffset;
  if (
    [title, ticks, format, line, tickMarks, tickLabels, grid, color, domain, titleAt, titleOffset].every(
      (v) => v === undefined,
    )
  )
    return undefined;
  return {
    ...(title !== undefined ? { title } : {}),
    ...(ticks !== undefined ? { ticks } : {}),
    ...(format !== undefined ? { format } : {}),
    ...(line !== undefined ? { line } : {}),
    ...(tickMarks !== undefined ? { tickMarks } : {}),
    ...(tickLabels !== undefined ? { tickLabels } : {}),
    ...(grid !== undefined ? { grid } : {}),
    ...(color !== undefined ? { color } : {}),
    ...(domain !== undefined ? { domain } : {}),
    ...(titleAt !== undefined ? { titleAt } : {}),
    ...(titleOffset !== undefined ? { titleOffset } : {}),
  };
}
/** The shared `axes` option every one of the five 3D constructors accepts
 *  (`{x?,y?,z?,corner?,color?}`) — merges the dataset's/inline source's own
 *  defaults with the reader's Axes-folder overrides, including the shared
 *  `axes.color` (C7). `corner` is untouched here (no Dock control writes
 *  it, and no vendored dataset sets one) — a caller that needs it keeps
 *  spreading `...dataset.options` underneath this result, which still
 *  carries the dataset's own `axes.corner` unless this same key stomps it;
 *  since this function never emits `corner`, that never happens.
 *  `undefined` when nothing to say at all, so an unedited chart's built
 *  options are byte-identical to before this merge existed. */
function mergedAxesOption(
  datasetAxes:
    | {
        readonly x?: GlyphChart3dAxisOptions;
        readonly y?: GlyphChart3dAxisOptions;
        readonly z?: GlyphChart3dAxisOptions;
        readonly color?: string;
      }
    | undefined,
  view: Charts3dViewState,
):
  | {
      readonly x?: GlyphChart3dAxisOptions;
      readonly y?: GlyphChart3dAxisOptions;
      readonly z?: GlyphChart3dAxisOptions;
      readonly color?: string;
    }
  | undefined {
  const x = mergedAxisOption(datasetAxes?.x, view.axes.x);
  const y = mergedAxisOption(datasetAxes?.y, view.axes.y);
  const z = mergedAxisOption(datasetAxes?.z, view.axes.z);
  const color = view.axes.color ?? datasetAxes?.color;
  if (x === undefined && y === undefined && z === undefined && color === undefined) return undefined;
  return {
    ...(x !== undefined ? { x } : {}),
    ...(y !== undefined ? { y } : {}),
    ...(z !== undefined ? { z } : {}),
    ...(color !== undefined ? { color } : {}),
  };
}

/**
 * Builds the `GlyphChart3dMark` a `Charts3dViewState` describes — the ONE
 * place `view.source`/`view.colorscale`/`view.axes` become a mark, read by
 * the static (Copy/terminal/chat) exit, the live viewport and the tray
 * thumbnails. Dispatches on the source's own `markType` (packet C6,
 * generalizing C3's surface-only version): `shading` is forwarded ONLY for
 * `surface` (no other constructor's options accept it); `colorscale`/
 * `bands` for every type that carries a colour legend (every type but
 * `line3d`, which has none — `GlyphChart3dLineOptions` has no such field).
 *
 * `shading: "auto"` leaves `options.shading` OMITTED (`undefined`), on
 * purpose, for `surface`: `renderGlyphChart3d` itself resolves an undefined
 * mark shading from ITS OWN render-time colour mode (`"value"` under
 * `color: "none"`/NO_COLOR, `"relief"` otherwise, C2 fix round 1's P1-3) —
 * the ONE place that actually knows it, since the SAME mark can be rendered
 * at different colour modes (terminal vs. chat, NO_COLOR toggled) without
 * rebuilding it. An explicit `"relief"`/`"value"` override always wins,
 * unconditionally, on every exit.
 *
 * The LIVE viewport does NOT use this function's own "auto" shading
 * resolution — see `resolveCharts3dViewForLiveScene`, below, for why a live
 * `glyphChartObject` mount needs its own colour-aware pre-resolution.
 */
export function resolveCharts3dView(view: Charts3dViewState): Charts3dResolveResult {
  try {
    if (view.source.kind === "dataset") {
      const dataset = findCharts3dDataset(view.source.id);
      if (!dataset) return { ok: false, error: `Unknown 3D dataset "${view.source.id}".` };
      const mark = buildChart3dDatasetMark(dataset, view);
      return {
        ok: true,
        resolved: { mark, title: dataset.title, description: dataset.description, source: dataset.source },
      };
    }
    const mark = buildChart3dInlineMark(view.source, view);
    return {
      ok: true,
      resolved: {
        mark,
        title: view.source.title,
        description: view.source.description ?? "",
        source: view.source.attribution ?? null,
      },
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function tableDatasetAxes(
  dataset: Extract<Chart3dDataset, { markType: "scatter3d" | "bars3d" }>,
  view: Charts3dViewState,
) {
  const axes = { ...dataset.options?.axes };
  const channels = view.source.kind === "dataset" ? view.source.channels : undefined;
  for (const axis of ["x", "y", "z"] as const) {
    if (channels && channels[axis] !== dataset.channels?.[axis]) {
      axes[axis] = { ...axes[axis], title: channels[axis] };
    }
  }
  return mergedAxesOption(axes, view);
}

function buildChart3dDatasetMark(dataset: Chart3dDataset, view: Charts3dViewState): GlyphChart3dMark {
  const shadingOption = view.shading === "auto" ? {} : { shading: view.shading };
  // Computed PER BRANCH (never hoisted above the switch) — `dataset` is
  // still the full 5-way union up here, so `dataset.options` has no one
  // shape to merge against until `dataset.markType` narrows it.
  switch (dataset.markType) {
    case "surface": {
      const axes = mergedAxesOption(dataset.options?.axes, view);
      return glyphChartSurface(dataset.data, dataset.channels, {
        ...dataset.options,
        ...shadingOption,
        colorscale: view.colorscale,
        guides: view.guides,
        ...(axes !== undefined ? { axes } : {}),
      });
    }
    case "scatter3d": {
      const axes = tableDatasetAxes(dataset, view);
      return glyphChartScatter3d(
        dataset.data,
        view.source.kind === "dataset" ? (view.source.channels ?? dataset.channels) : dataset.channels,
        {
          ...dataset.options,
          colorscale: view.colorscale,
          guides: view.guides,
          ...(axes !== undefined ? { axes } : {}),
        },
      );
    }
    case "parametric3d": {
      const axes = mergedAxesOption(dataset.options?.axes, view);
      return glyphChartParametric3d(dataset.data, {
        ...dataset.options,
        colorscale: view.colorscale,
        guides: view.guides,
        ...(axes !== undefined ? { axes } : {}),
      });
    }
    case "bars3d": {
      const axes = tableDatasetAxes(dataset, view);
      return glyphChartBars3d(
        dataset.data,
        view.source.kind === "dataset" ? (view.source.channels ?? dataset.channels) : dataset.channels,
        {
          ...dataset.options,
          colorscale: view.colorscale,
          guides: view.guides,
          ...(axes !== undefined ? { axes } : {}),
        },
      );
    }
    case "line3d": {
      const axes = mergedAxesOption(dataset.options?.axes, view);
      return glyphChartLine3d(dataset.data, {
        ...dataset.options,
        guides: view.guides,
        ...(axes !== undefined ? { axes } : {}),
      });
    }
  }
}

function buildChart3dInlineMark(
  source: Extract<Charts3dSource, { kind: "inline" }>,
  view: Charts3dViewState,
): GlyphChart3dMark {
  const shadingOption = view.shading === "auto" ? {} : { shading: view.shading };
  const axes = mergedAxesOption(undefined, view);
  const axesOption = axes !== undefined ? { axes } : {};
  switch (source.markType) {
    case "surface":
      return glyphChartSurface(source.rows, source.channels, {
        ...shadingOption,
        colorscale: view.colorscale,
        guides: view.guides,
        ...axesOption,
      });
    case "scatter3d":
      return glyphChartScatter3d(source.rows, source.channels, {
        colorscale: view.colorscale,
        guides: view.guides,
        ...axesOption,
      });
    case "bars3d":
      return glyphChartBars3d(source.rows, source.channels, {
        colorscale: view.colorscale,
        guides: view.guides,
        ...axesOption,
      });
    case "line3d": {
      const points = source.rows.map((r): readonly [number, number, number] => [
        Number(r[source.channels.x]),
        Number(r[source.channels.y]),
        Number(r[source.channels.z]),
      ]);
      return glyphChartLine3d(points, { guides: view.guides, ...axesOption });
    }
  }
}

/**
 * The LIVE viewport's own resolve: `glyphChartObject`/`glyphChartSurface`
 * default an undefined `shading` to `"relief"` UNCONDITIONALLY (neither has
 * a render-time colour mode to be aware of — that resolution is
 * `renderGlyphChart3d`'s own, see `resolveCharts3dView`'s doc), so mounting
 * a `shading: "auto"` mark directly into a live `createGlyphScene` (never
 * through `renderGlyphChart3d`) would always render `"relief"` even under
 * `color: none` — useless there (Lambert shape with no colour to show a z
 * band in). `colorEnabled` is the live scene's OWN resolved `useColors`
 * (`chartsWorkbench3dSceneOptions`'s own `color !== "none"`), so this
 * applies the IDENTICAL ternary `renderGlyphChart3d` applies internally,
 * just one layer earlier — the two exits always agree on what "auto" means
 * for the same colour mode. A no-op for every OTHER mark type (none has a
 * `shading` option) — `resolveCharts3dView` already omits it there.
 */
export function resolveCharts3dViewForLiveScene(view: Charts3dViewState, colorEnabled: boolean): Charts3dResolveResult {
  if (view.shading !== "auto") return resolveCharts3dView(view);
  return resolveCharts3dView({ ...view, shading: colorEnabled ? "relief" : "value" });
}

// ── Live scene options (target x charset x style x colour, honoured live) ──

export interface Charts3dSceneOptions {
  readonly useColors: boolean;
  /** The scene's own render mode — `resolveCharts3dStyle`'s own result. */
  readonly mode: GlyphChart3dStyle;
  /** Set only under a `"wireframe"` mode on the `braille` charset — every
   *  other combination is `undefined` (explicitly, not omitted), so a
   *  caller applying this whole bundle via `scene.setOptions` always
   *  clears a stale value from a prior charset/style, never merges over
   *  one that no longer applies. */
  readonly charMode?: "braille";
  /** Set only under a `"wireframe"` mode (`"ink"` computes its own
   *  occlusion internally and needs none) — same explicit-`undefined`
   *  clearing rule as `charMode`. */
  readonly hiddenLines?: "hide";
}

/**
 * The live `createGlyphScene` options a resolved charset x style x colour
 * choice maps to (packet C3's own gate, widened by C4: "the live viewport
 * must honour the resolved target x charset x colour choices" — `color:
 * none` must be `useColors: false` — now EXTENDED to `mode`/`charMode`/
 * `hiddenLines`, a codex-review finding: the live viewport used to
 * hard-code `mode: "solid"` and never read charset/style at all, so a
 * braille selection rendered solid geometry live while Copy/terminal
 * rendered the SAME selection as a real wireframe — live and Copy
 * disagreed on the picture for identical state, and `style: "ink"` was
 * unreachable live. `resolveCharts3dStyle`'s own doc has the "why a
 * page-local mirror, not a library call" rationale. `glyphChart3dCharsetDegrades`
 * (C2 fix round 1) still applies to the AXIS/TICK OVERLAY's own halfblock/
 * quadrant self-disable (a SEPARATE, 2D-chart-only charMode concern —
 * AGENTS.md's "Render modes": "halfblock/quadrant... no-ops with
 * transformCells"), never to `"braille"`, which is wireframe-compatible
 * and exactly what makes the `resolveCharts3dStyle`'s own braille-to-
 * wireframe rule work. Target itself doesn't enter this — the live scene
 * only ever mounts for `target === "web"` (`ChartsWorkbench.tsx`'s own
 * dimension/target branch); `chat`/`terminal` show `renderGlyphChart3d`'s
 * own static frame instead, which already honours charset/style/colour
 * through the library's own path.
 *
 * C3 fix round 2 (user feedback, unchanged by this widening): what to tell
 * the reader about a charset the 3D view can't show (`blocks` alone, per
 * `glyphChart3dCharsetDegrades`) lives on the Dock's own dimmed Charset
 * toggle (`ChartsDock.tsx`'s `chartsCharsetToggle`), never a note painted
 * inside the viewport (AGENTS.md's own "TargetPreview" rule).
 */
export function chartsWorkbench3dSceneOptions(
  charset: GlyphChartCharset,
  color: GlyphChartColorMode,
  style: Charts3dStyleOption,
): Charts3dSceneOptions {
  const resolvedStyle = resolveCharts3dStyle(charset, style);
  return {
    useColors: color !== "none",
    mode: resolvedStyle,
    charMode: resolvedStyle === "wireframe" && charset === "braille" ? "braille" : undefined,
    hiddenLines: resolvedStyle === "wireframe" ? "hide" : undefined,
  };
}

// ── Column ranking (packet C6) ──────────────────────────────────────────

function numericColumnValues(records: readonly TabularRow[], col: string): number[] {
  const out: number[] = [];
  for (const r of records) {
    const v = r[col];
    if (typeof v === "number" && Number.isFinite(v)) out.push(v);
  }
  return out;
}
function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
}
function variance(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const m = mean(values);
  return mean(values.map((v) => (v - m) ** 2));
}
/** Plain Pearson correlation — `0` (treated as "no relation") whenever
 *  either series is degenerate (fewer than 2 finite pairs, or zero
 *  variance), never `NaN` leaking into a ranking comparison. */
function pearsonCorrelation(xs: readonly number[], ys: readonly number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return 0;
  const mx = mean(xs.slice(0, n)),
    my = mean(ys.slice(0, n));
  let cov = 0,
    vx = 0,
    vy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - mx,
      dy = ys[i]! - my;
    cov += dx * dy;
    vx += dx * dx;
    vy += dy * dy;
  }
  if (vx === 0 || vy === 0) return 0;
  return cov / Math.sqrt(vx * vy);
}
function lowCardinalityCategoricalColumn(columns: readonly ColumnProfile[], max = 12): string | undefined {
  return columns
    .filter((c) => c.type === "category" && c.distinctCount >= 2 && c.distinctCount <= max)
    .sort((a, b) => a.distinctCount - b.distinctCount)[0]?.name;
}

export interface Charts3dColumnRanking {
  /** Exactly 3 numeric column names, greedily picked for high spread
   *  (variance) and low pairwise correlation with each other — the "three
   *  numeric axes that show the most, most independently" triple, not
   *  merely the first three columns in table order. */
  readonly columns: readonly [string, string, string];
  /** A low-cardinality categorical column, when the table has one — the
   *  natural series/colour channel for a scatter (2-12 distinct values). */
  readonly categorical?: string;
}

/**
 * Picks the three LEAST mutually correlated, highest-spread numeric
 * columns of a table — the default-channel rule the coordinator asked for
 * ("pick the three numeric columns with the most spread and least
 * correlation, and colour by a low-cardinality categorical column if one
 * exists"), shared by the local-table Scatter 3D fit check AND a freshly
 * loaded Hugging Face table's default channels (`chartsBest3dFitFromRows`).
 * Greedy, not exhaustive (an exhaustive search over every 3-column
 * combination is unnecessary at this page's column counts and would cost
 * more to justify than a greedy pick already delivers): the highest-
 * variance column seeds the pick, then each further column maximizes
 * `variance * (1 - maxAbsCorrelationWithAlreadyPicked)` — a column that
 * duplicates information an earlier pick already carries scores low
 * regardless of its own raw spread. `null` when fewer than 3 numeric
 * columns exist.
 */
export function chartsRankColumnsForScatter3d(records: readonly TabularRow[]): Charts3dColumnRanking | null {
  if (records.length === 0) return null;
  const profile = profileRows(records);
  const numericCols = profile.columns.filter((c) => c.type === "number" || c.type === "integer").map((c) => c.name);
  if (numericCols.length < 3) return null;
  const valuesOf = new Map(numericCols.map((c) => [c, numericColumnValues(records, c)] as const));
  const varOf = new Map(numericCols.map((c) => [c, variance(valuesOf.get(c)!)] as const));
  const sorted = [...numericCols].sort((a, b) => varOf.get(b)! - varOf.get(a)!);
  const picked: string[] = [sorted[0]!];
  while (picked.length < 3) {
    let best: string | null = null,
      bestScore = -Infinity;
    for (const c of numericCols) {
      if (picked.includes(c)) continue;
      const maxCorr = Math.max(
        0,
        ...picked.map((p) => Math.abs(pearsonCorrelation(valuesOf.get(c)!, valuesOf.get(p)!))),
      );
      const score = varOf.get(c)! * (1 - maxCorr);
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }
    picked.push(best!);
  }
  const categorical = lowCardinalityCategoricalColumn(profile.columns);
  return { columns: picked as [string, string, string], categorical };
}

// ── Per-type fit checks (mark card + HF loading) ────────────────────────

export type Charts3dFit =
  | { readonly fits: true; readonly source: Extract<Charts3dSource, { kind: "inline" }> }
  | { readonly fits: false; readonly reason: string };
export type Charts3dFitTable = Record<Charts3dMarkTypeId, Charts3dFit>;

export const CHARTS_SURFACE_NEEDS =
  "Surface needs a complete x × y grid of z values (three number columns, one x/y pair per row, no repeats and no gaps).";
export const CHARTS_SCATTER3D_NEEDS = "Scatter 3D needs at least 3 numeric columns.";
export const CHARTS_BARS3D_NEEDS =
  "Columns 3D needs two position columns (categorical or numeric) plus a numeric value column.";
export const CHARTS_LINE3D_NEEDS = "Line 3D needs at least 3 numeric columns, taken in row order.";
export const CHARTS_PARAMETRIC3D_NEEDS = "Parametric surfaces are preset-only — pick one from the tray.";

function recordRows(rows: readonly TabularRow[] | readonly number[] | null): readonly TabularRow[] | null {
  if (rows === null || rows.length === 0 || rows.some((row) => typeof row === "number")) return null;
  return rows as readonly TabularRow[];
}

/**
 * Whether the reader's CURRENTLY loaded 2D table (the same rows
 * `chartsMarkTypeFit.ts` reads for the other types) can honestly become a
 * surface: at least 3 numeric columns whose first three (in profiled
 * order) cover a complete, unique `(x, y)` grid — checked by attempting the
 * real `glyphChartSurface` build and catching its own validation error,
 * never a restated grid-completeness rule. None of the 16 vendored 2D
 * datasets are gridded this way (they're time series/categorical), so this
 * disables on real data by default; the 3D preset TILES (the primary path
 * to 3D) bypass this check entirely — they mount a known-good vendored
 * grid directly. Scoped to the first 3 numeric columns in profiled order
 * (not every x/y/z permutation) — a later increment can widen this; a
 * reader who wants a different triple picks one of the vendored 3D
 * presets, or a future column picker.
 */
export function chartsSurfaceFitFromRecords(records: readonly TabularRow[], title: string): Charts3dFit {
  const numericCols = profileRows(records)
    .columns.filter((c) => c.type === "number" || c.type === "integer")
    .map((c) => c.name);
  if (numericCols.length < 3) return { fits: false, reason: CHARTS_SURFACE_NEEDS };
  const channels: GlyphChart3dSurfaceChannels = { x: numericCols[0]!, y: numericCols[1]!, z: numericCols[2]! };
  try {
    glyphChartSurface(records, channels);
  } catch {
    return { fits: false, reason: CHARTS_SURFACE_NEEDS };
  }
  return { fits: true, source: { kind: "inline", markType: "surface", title, rows: records, channels } };
}
export function chartsSurfaceFitFromRows(
  data: ChartsWorkbenchDataState,
  marks: readonly ChartsWorkbenchMark[],
): Charts3dFit {
  const mark = marks[0];
  if (!mark) return { fits: false, reason: CHARTS_SURFACE_NEEDS };
  const records = recordRows(chartsMarkTypeBase(data, mark).rows);
  if (!records) return { fits: false, reason: CHARTS_SURFACE_NEEDS };
  return chartsSurfaceFitFromRecords(records, "Custom surface");
}

/** Scatter 3D needs 3+ numeric columns — `chartsRankColumnsForScatter3d`
 *  picks WHICH three (and an optional series column), then the real
 *  `glyphChartScatter3d` build confirms it, mirroring the surface fit's own
 *  "attempt the real constructor" idiom. */
export function chartsScatter3dFitFromRecords(records: readonly TabularRow[], title: string): Charts3dFit {
  const ranking = chartsRankColumnsForScatter3d(records);
  if (!ranking) return { fits: false, reason: CHARTS_SCATTER3D_NEEDS };
  const [x, y, z] = ranking.columns;
  const channels: GlyphChart3dScatterChannels = {
    x,
    y,
    z,
    ...(ranking.categorical !== undefined ? { series: ranking.categorical } : {}),
  };
  try {
    glyphChartScatter3d(records, channels);
  } catch {
    return { fits: false, reason: CHARTS_SCATTER3D_NEEDS };
  }
  return {
    fits: true,
    source: {
      kind: "inline",
      markType: "scatter3d",
      title,
      rows: records,
      channels: { x, y, z, ...(ranking.categorical !== undefined ? { series: ranking.categorical } : {}) },
    },
  };
}
export function chartsScatter3dFitFromRows(
  data: ChartsWorkbenchDataState,
  marks: readonly ChartsWorkbenchMark[],
): Charts3dFit {
  const mark = marks[0];
  if (!mark) return { fits: false, reason: CHARTS_SCATTER3D_NEEDS };
  const records = recordRows(chartsMarkTypeBase(data, mark).rows);
  if (!records) return { fits: false, reason: CHARTS_SCATTER3D_NEEDS };
  return chartsScatter3dFitFromRecords(records, "Custom scatter");
}

/** Maps each distinct raw value of `col` (in first-seen order) to a stable
 *  integer index — the "categorical position as a numeric axis" bridge
 *  `bars3d`'s NUMERIC x/y channels need (`packages/charts/src/3d/bars.ts`'s
 *  own doc: "x/y are NUMERIC positions... xLabel/yLabel ride on each bar...
 *  but do not become categorical axis ticks"). Applied by AUGMENTING the
 *  records with a new field rather than a function channel, so `channels`
 *  stays plain field names — JSON-safe end to end (this file's own
 *  `Charts3dSource` doc). */
function categoryIndexField(records: readonly TabularRow[], col: string, field: string): readonly TabularRow[] {
  const indexOf = new Map<string, number>();
  return records.map((r) => {
    const key = String(r[col]);
    if (!indexOf.has(key)) indexOf.set(key, indexOf.size);
    return { ...r, [field]: indexOf.get(key)! };
  });
}
export function chartsBars3dFitFromRecords(records: readonly TabularRow[], title: string): Charts3dFit {
  const profile = profileRows(records);
  const numericCols = profile.columns.filter((c) => c.type === "number" || c.type === "integer").map((c) => c.name);
  const categoricalCols = profile.columns
    .filter((c) => c.type === "category" && c.distinctCount >= 2 && c.distinctCount <= 30)
    .map((c) => c.name);
  if (numericCols.length === 0) return { fits: false, reason: CHARTS_BARS3D_NEEDS };
  const zCol = [...numericCols].sort(
    (a, b) => variance(numericColumnValues(records, b)) - variance(numericColumnValues(records, a)),
  )[0]!;
  const positions = [...categoricalCols, ...numericCols].filter((c) => c !== zCol);
  if (positions.length < 2) return { fits: false, reason: CHARTS_BARS3D_NEEDS };
  const [xCol, yCol] = positions as [string, string];
  const xIsCategory = categoricalCols.includes(xCol);
  const yIsCategory = categoricalCols.includes(yCol);
  let shaped = records;
  if (xIsCategory) shaped = categoryIndexField(shaped, xCol, "__x3d");
  if (yIsCategory) shaped = categoryIndexField(shaped, yCol, "__y3d");
  const channels: GlyphChart3dBarsChannels = {
    x: xIsCategory ? "__x3d" : xCol,
    y: yIsCategory ? "__y3d" : yCol,
    z: zCol,
    ...(xIsCategory ? { xLabel: xCol } : {}),
    ...(yIsCategory ? { yLabel: yCol } : {}),
  };
  try {
    glyphChartBars3d(shaped, channels);
  } catch {
    return { fits: false, reason: CHARTS_BARS3D_NEEDS };
  }
  return {
    fits: true,
    source: {
      kind: "inline",
      markType: "bars3d",
      title,
      rows: shaped,
      channels: {
        x: channels.x as string,
        y: channels.y as string,
        z: zCol,
        ...(xIsCategory ? { xLabel: xCol } : {}),
        ...(yIsCategory ? { yLabel: yCol } : {}),
      },
    },
  };
}
export function chartsBars3dFitFromRows(
  data: ChartsWorkbenchDataState,
  marks: readonly ChartsWorkbenchMark[],
): Charts3dFit {
  const mark = marks[0];
  if (!mark) return { fits: false, reason: CHARTS_BARS3D_NEEDS };
  const records = recordRows(chartsMarkTypeBase(data, mark).rows);
  if (!records) return { fits: false, reason: CHARTS_BARS3D_NEEDS };
  return chartsBars3dFitFromRecords(records, "Custom columns");
}

/** Line 3D needs 3+ numeric columns, taken in ROW ORDER (never gridded,
 *  never reordered) — the first three in profiled order, mirroring the
 *  surface fit's own "first three" rule; each row becomes one trajectory
 *  point. */
export function chartsLine3dFitFromRecords(records: readonly TabularRow[], title: string): Charts3dFit {
  if (records.length < 2) return { fits: false, reason: CHARTS_LINE3D_NEEDS };
  const numericCols = profileRows(records)
    .columns.filter((c) => c.type === "number" || c.type === "integer")
    .map((c) => c.name);
  if (numericCols.length < 3) return { fits: false, reason: CHARTS_LINE3D_NEEDS };
  const [x, y, z] = numericCols as [string, string, string];
  const points = records
    .map((r): readonly [unknown, unknown, unknown] => [r[x], r[y], r[z]])
    .filter((p): p is readonly [number, number, number] => p.every((v) => typeof v === "number" && Number.isFinite(v)));
  if (points.length < 2) return { fits: false, reason: CHARTS_LINE3D_NEEDS };
  try {
    glyphChartLine3d(points);
  } catch {
    return { fits: false, reason: CHARTS_LINE3D_NEEDS };
  }
  return { fits: true, source: { kind: "inline", markType: "line3d", title, rows: records, channels: { x, y, z } } };
}
export function chartsLine3dFitFromRows(
  data: ChartsWorkbenchDataState,
  marks: readonly ChartsWorkbenchMark[],
): Charts3dFit {
  const mark = marks[0];
  if (!mark) return { fits: false, reason: CHARTS_LINE3D_NEEDS };
  const records = recordRows(chartsMarkTypeBase(data, mark).rows);
  if (!records) return { fits: false, reason: CHARTS_LINE3D_NEEDS };
  return chartsLine3dFitFromRecords(records, "Custom line");
}

/** The mark card's own per-type fit table — one entry per
 *  `CHARTS_3D_MARK_TYPES`, mirroring 2D's `ChartsMarkTypeFitTable` idiom
 *  exactly. `parametric3d` never fits arbitrary data (this file's own
 *  `Charts3dSource` doc). */
export function chartsFitTableFromRows(
  data: ChartsWorkbenchDataState,
  marks: readonly ChartsWorkbenchMark[],
): Charts3dFitTable {
  return {
    surface: chartsSurfaceFitFromRows(data, marks),
    scatter3d: chartsScatter3dFitFromRows(data, marks),
    bars3d: chartsBars3dFitFromRows(data, marks),
    line3d: chartsLine3dFitFromRows(data, marks),
    parametric3d: { fits: false, reason: CHARTS_PARAMETRIC3D_NEEDS },
  };
}

/**
 * The best 3D fit for a freshly loaded (Hugging Face) table — tried in
 * order from most-structured to most-general: a complete `(x, y)` grid
 * (rare on real tabular data, but the most informative reading when it
 * genuinely holds), then a genuinely CATEGORICAL x/y plus numeric z (a real
 * "small table" shape — bars3d is tried here ONLY when the table actually
 * has a qualifying low-cardinality categorical column; `chartsBars3dFitFromRecords`
 * itself is more permissive and also accepts two arbitrary numeric position
 * columns for the mark card's own manual Type-toggle case, which would
 * otherwise make bars3d "fit" almost any 3+-numeric-column table and starve
 * scatter3d of ever being the auto-pick), then the general
 * 3+-numeric-columns scatter fallback every one of the curated 3D datasets
 * (`chart3dRemoteIndex.ts`) is chosen to satisfy. `null` when nothing fits
 * at all.
 */
export function chartsBest3dFitFromRows(records: readonly TabularRow[], title: string): Charts3dFit | null {
  const surface = chartsSurfaceFitFromRecords(records, title);
  if (surface.fits) return surface;
  if (lowCardinalityCategoricalColumn(profileRows(records).columns) !== undefined) {
    const bars = chartsBars3dFitFromRecords(records, title);
    if (bars.fits) return bars;
  }
  const scatter = chartsScatter3dFitFromRecords(records, title);
  return scatter.fits ? scatter : null;
}
