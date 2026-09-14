// `/charts` 3D (packet C3, AGENTS.md's "Charts 3D"): the state, fit-table
// and resolve helpers a `ChartsWorkbenchState` needs to host a live
// `glyphChartSurface` mark alongside its existing 2D marks. Mirrors
// `chartsMarkTypeFit.ts`'s own "a type fits iff the built mark DRAWS" idiom
// (here: "iff it validates"), never a restated rule of its own — the
// library's own `glyphChartSurface` decides.
import {
  GLYPH_CHART_3D_DEFAULT_CAMERA, glyphChartSurface,
  type GlyphChart3dColorscaleName, type GlyphChart3dStyle, type GlyphChart3dSurfaceChannels, type GlyphChart3dSurfaceMark, type GlyphChart3dSurfaceOptions,
} from "@glyphcss/charts/3d";
import type { GlyphChartCharset, GlyphChartColorMode } from "@glyphcss/charts";
import type { TabularRow } from "../../lib/tabularParse";
import { profileRows } from "../../lib/dataProfile";
import { chartsMarkTypeBase } from "./chartsMarkTypeFit";
import type { ChartsWorkbenchDataState, ChartsWorkbenchMark } from "./chartsWorkbenchState";
import { CHARTS_3D_DATASETS, findCharts3dDataset } from "./datasets/chart3d";

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
 *  `"value"` are an explicit reader override from the View folder. */
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
}

/** A vendored `datasets/chart3d/` entry, or an INLINE grid resolved from the
 *  reader's own currently-loaded 2D table (`chartsSurfaceFitFromRows`,
 *  below) — the mark-card "Surface" type's own binding, mirroring a 2D
 *  mark's `dataText`: real data, just not one of the two named presets. */
export type Charts3dSource =
  | { readonly kind: "dataset"; readonly id: string }
  | { readonly kind: "inline"; readonly title: string; readonly rows: readonly TabularRow[]; readonly channels: GlyphChart3dSurfaceChannels };

export interface Charts3dViewState {
  readonly source: Charts3dSource;
  readonly camera: Charts3dCamera;
  readonly orbitMode: Charts3dOrbitMode;
  readonly shading: Charts3dShading;
  readonly colorscale: GlyphChart3dColorscaleName;
  /** `"auto"` (the default) resolves per charset (`resolveCharts3dStyle`'s
   *  own doc) on BOTH exits; an explicit `"solid"`/`"wireframe"`/`"ink"`
   *  always wins, independent of charset, on both too. */
  readonly style: Charts3dStyleOption;
  /** Guide-overlay overrides (packet C4, item 1) — an EMPTY object (the
   *  default) means every guide follows the library's own defaults; only a
   *  field a reader has actually toggled is present here, so a future
   *  library default change reaches this page automatically for every
   *  untouched field. Always populated (never `undefined`), mirroring
   *  `effect3d`'s own "never a null check" rule. */
  readonly guides: Charts3dGuideOptions;
}

/** Read straight off the library (`GLYPH_CHART_3D_DEFAULT_CAMERA`) — never
 *  a page-side `{ rotX: 65, rotY: 45 }` copy that could drift from it. */
export const CHARTS_3D_DEFAULT_CAMERA: Charts3dCamera = { ...GLYPH_CHART_3D_DEFAULT_CAMERA };

export function createCharts3dViewState(datasetId: string = CHARTS_3D_DATASETS[0]!.id): Charts3dViewState {
  return { source: { kind: "dataset", id: datasetId }, camera: { ...CHARTS_3D_DEFAULT_CAMERA }, orbitMode: "turntable", shading: "auto", colorscale: "viridis", style: "auto", guides: {} };
}

export interface Charts3dResolved {
  readonly mark: GlyphChart3dSurfaceMark;
  readonly title: string;
  readonly description: string;
  readonly source: { readonly name: string; readonly url: string; readonly licence: string } | null;
}
export type Charts3dResolveResult = { readonly ok: true; readonly resolved: Charts3dResolved } | { readonly ok: false; readonly error: string };

/**
 * Builds the `GlyphChart3dSurfaceMark` a `Charts3dViewState` describes —
 * the ONE place `view.source`/`view.colorscale` become a mark, read by the
 * static (Copy/terminal/chat) exit and the tray thumbnails.
 *
 * `shading: "auto"` leaves `options.shading` OMITTED (`undefined`), on
 * purpose: `renderGlyphChart3d` itself now resolves an undefined mark
 * shading from ITS OWN render-time colour mode (`"value"` under `color:
 * "none"`/NO_COLOR, `"relief"` otherwise, C2 fix round 1's P1-3) — the ONE
 * place that actually knows it, since the SAME mark can be rendered at
 * different colour modes (terminal vs. chat, NO_COLOR toggled) without
 * rebuilding it. An explicit `"relief"`/`"value"` override always wins,
 * unconditionally, on every exit.
 *
 * The LIVE viewport does NOT use this function's own "auto" resolution —
 * see `resolveCharts3dViewForLiveScene`, below, for why a live
 * `glyphChartObject` mount needs its own colour-aware pre-resolution.
 */
export function resolveCharts3dView(view: Charts3dViewState): Charts3dResolveResult {
  const shadingOption = view.shading === "auto" ? {} : { shading: view.shading };
  try {
    if (view.source.kind === "dataset") {
      const dataset = findCharts3dDataset(view.source.id);
      if (!dataset) return { ok: false, error: `Unknown 3D dataset "${view.source.id}".` };
      const mark = glyphChartSurface(dataset.data, dataset.channels, { ...dataset.options, ...shadingOption, colorscale: view.colorscale, guides: view.guides });
      return { ok: true, resolved: { mark, title: dataset.title, description: dataset.description, source: dataset.source } };
    }
    const mark = glyphChartSurface(view.source.rows, view.source.channels, { ...shadingOption, colorscale: view.colorscale, guides: view.guides });
    return { ok: true, resolved: { mark, title: view.source.title, description: "", source: null } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
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
 * for the same colour mode.
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
export function chartsWorkbench3dSceneOptions(charset: GlyphChartCharset, color: GlyphChartColorMode, style: Charts3dStyleOption): Charts3dSceneOptions {
  const resolvedStyle = resolveCharts3dStyle(charset, style);
  return {
    useColors: color !== "none",
    mode: resolvedStyle,
    charMode: resolvedStyle === "wireframe" && charset === "braille" ? "braille" : undefined,
    hiddenLines: resolvedStyle === "wireframe" ? "hide" : undefined,
  };
}

// ── The mark card's "Surface" type fit ──────────────────────────────────

export type Charts3dSurfaceFit =
  | { readonly fits: true; readonly source: Extract<Charts3dSource, { kind: "inline" }> }
  | { readonly fits: false; readonly reason: string };

export const CHARTS_SURFACE_NEEDS = "Surface needs a complete x × y grid of z values (three number columns, one x/y pair per row, no repeats and no gaps).";

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
 * reader who wants a different triple picks one of the two vendored 3D
 * presets, or a future column picker.
 */
export function chartsSurfaceFitFromRows(data: ChartsWorkbenchDataState, marks: readonly ChartsWorkbenchMark[]): Charts3dSurfaceFit {
  const mark = marks[0];
  if (!mark) return { fits: false, reason: CHARTS_SURFACE_NEEDS };
  const base = chartsMarkTypeBase(data, mark);
  const rows = base.rows;
  if (rows === null || rows.length === 0 || rows.some((row) => typeof row === "number")) return { fits: false, reason: CHARTS_SURFACE_NEEDS };
  const records = rows as readonly TabularRow[];
  // `ColumnProfile.type` distinguishes `"integer"` from `"number"`
  // (`lib/dataProfile.ts`) — a grid's x/y position columns are routinely
  // integers (row/column indices), so both count here.
  const numericCols = profileRows(records).columns.filter((c) => c.type === "number" || c.type === "integer").map((c) => c.name);
  if (numericCols.length < 3) return { fits: false, reason: CHARTS_SURFACE_NEEDS };
  const channels: GlyphChart3dSurfaceChannels = { x: numericCols[0]!, y: numericCols[1]!, z: numericCols[2]! };
  try {
    glyphChartSurface(records, channels);
  } catch {
    return { fits: false, reason: CHARTS_SURFACE_NEEDS };
  }
  return { fits: true, source: { kind: "inline", title: "Custom surface", rows: records, channels } };
}
