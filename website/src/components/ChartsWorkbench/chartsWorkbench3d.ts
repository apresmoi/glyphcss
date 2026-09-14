// `/charts` 3D (packet C3, AGENTS.md's "Charts 3D"): the state, fit-table
// and resolve helpers a `ChartsWorkbenchState` needs to host a live
// `glyphChartSurface` mark alongside its existing 2D marks. Mirrors
// `chartsMarkTypeFit.ts`'s own "a type fits iff the built mark DRAWS" idiom
// (here: "iff it validates"), never a restated rule of its own — the
// library's own `glyphChartSurface` decides.
import {
  GLYPH_CHART_3D_DEFAULT_CAMERA, glyphChart3dCharsetDegrades, glyphChartSurface,
  type GlyphChart3dColorscaleName, type GlyphChart3dSurfaceChannels, type GlyphChart3dSurfaceMark,
} from "@glyphcss/charts/3d";
import type { GlyphChartCharset, GlyphChartColorMode } from "@glyphcss/charts";
import type { TabularRow } from "../../lib/tabularParse";
import { profileRows } from "../../lib/dataProfile";
import { chartsMarkTypeBase } from "./chartsMarkTypeFit";
import type { ChartsWorkbenchDataState, ChartsWorkbenchMark } from "./chartsWorkbenchState";
import { CHARTS_3D_DATASETS, findCharts3dDataset } from "./datasets/chart3d";

export type Charts3dOrbitMode = "turntable" | "trackball";
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
   *  KNOWN GAP (coordination note from the C2 fix round): `renderGlyphChart3d`'s
   *  own `camera` option doesn't accept `mat` yet — only `{ rotX, rotY, zoom
   *  }`. Until it does, the static exit (terminal/chat/Copy ASCII/ANSI)
   *  cannot reproduce a trackball pose exactly; `chartsWorkbench3dRender.ts`
   *  still THREADS `mat`/`useMat` through (never silently dropped, never
   *  decomposed to a lossy Euler approximation) so this starts working the
   *  moment the library accepts it. */
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
}

/** Read straight off the library (`GLYPH_CHART_3D_DEFAULT_CAMERA`) — never
 *  a page-side `{ rotX: 65, rotY: 45 }` copy that could drift from it. */
export const CHARTS_3D_DEFAULT_CAMERA: Charts3dCamera = { ...GLYPH_CHART_3D_DEFAULT_CAMERA };

export function createCharts3dViewState(datasetId: string = CHARTS_3D_DATASETS[0]!.id): Charts3dViewState {
  return { source: { kind: "dataset", id: datasetId }, camera: { ...CHARTS_3D_DEFAULT_CAMERA }, orbitMode: "turntable", shading: "auto", colorscale: "viridis" };
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
      const mark = glyphChartSurface(dataset.data, dataset.channels, { ...dataset.options, ...shadingOption, colorscale: view.colorscale });
      return { ok: true, resolved: { mark, title: dataset.title, description: dataset.description, source: dataset.source } };
    }
    const mark = glyphChartSurface(view.source.rows, view.source.channels, { ...shadingOption, colorscale: view.colorscale });
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

// ── Live scene options (target x charset x colour, honoured live) ──────

export interface Charts3dSceneOptions {
  readonly useColors: boolean;
  /** A visible downgrade note for the viewport's OWN chrome (mirroring
   *  `TargetPreview`'s "downgrades silently, never" rule, AGENTS.md's
   *  "Charts" — "TargetPreview") — set exactly when a requested charset
   *  can't be honoured live and had to fall back. `null` otherwise. */
  readonly downgradeNote: string | null;
}

/**
 * The live `createGlyphScene` options a resolved target/charset/colour
 * choice maps to (packet C3's own gate: "the live viewport must honour the
 * resolved target x charset x colour choices" — `color: none` must be
 * `useColors: false`, and charset must be the SAME mapping the static
 * `renderGlyphChart3d` exit uses, never a duplicate of it). No `charMode`
 * here at all (unlike the 2D live scene) — `glyphChart3dCharsetDegrades`
 * (C2 fix round 1) is now `true` for BOTH `blocks` and `braille`: the
 * always-mounted axis/tick overlay disables glyphcss's halfblock/quadrant
 * encoders (they self-disable under any `transformCells` hook), so a 3D
 * chart's geometry can never actually paint in `blocks` either — the scene
 * mounts at its default `charMode` regardless of charset, and `ascii`/`box`
 * are the only two charsets with nothing to report. Target itself doesn't
 * enter this — the live scene only ever mounts for `target === "web"`
 * (`ChartsWorkbench.tsx`'s own dimension/target branch); `chat`/`terminal`
 * show `renderGlyphChart3d`'s own static frame instead, which already
 * honours charset/colour through the library's own path.
 */
export function chartsWorkbench3dSceneOptions(charset: GlyphChartCharset, color: GlyphChartColorMode): Charts3dSceneOptions {
  const downgradeNote = glyphChart3dCharsetDegrades(charset)
    ? `${charset === "braille" ? "Braille is wireframe-only in glyphcss" : "3D charts always mount an axis box/tick overlay, which disables the halfblock encoder"} — this 3D scene (always solid) falls back to the default ramp.`
    : null;
  return { useColors: color !== "none", downgradeNote };
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
