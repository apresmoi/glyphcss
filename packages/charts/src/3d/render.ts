/**
 * `renderGlyphChart3d`/`renderGlyphChart3dJson` — the C2 static-frame exit
 * for `@glyphcss/charts/3d` (PLAN-3d.md §11's C2 row, AGENTS.md's "Charts
 * 3D"). The user-approved export boundary (PLAN-3d.md §3): terminal, chat,
 * Copy ASCII and the CLI get a STATIC FRAME at the current camera — there is
 * no live orbit here, that is `/charts`' own web viewport (C3) — and
 * effects are out of scope for this packet.
 *
 * C2 fix round 1 (P2-6): routes through `glyphcss`'s public `compileScene({
 * objects })` (F5b's own contract, AGENTS.md's "Compilation") instead of a
 * hand-rolled `buildRasterizeContext`/`rasterize` call — `compileScene`
 * already merges an object's `textureSamplers` under its own namespaced
 * key, runs its overlays through the shared label arbiter, and captures the
 * resulting `CellGrid` from the SAME single rasterize pass, all through the
 * canonical `scene.addObject()` composition path (this file previously
 * duplicated all three by hand, which is what let P1-1's texture-key bug
 * hide: the hand-rolled renderer used the SAME raw, unnamespaced key on
 * both the sampler-map side and the polygon-authored side, so it never
 * diverged from itself — only a real `compileScene`/`scene.addObject` mount
 * exposed the mismatch). This module now differs from mounting the same
 * object in a live `createGlyphScene` at the same camera only in the ways
 * `compileScene` itself documents (no detail layers, no shadows unless a
 * mesh opts in — this object's own single mesh never does).
 */
import { format as d3format } from "d3-format";
import { compileScene, createGlyphCanvas, createGlyphOrthographicCamera, encodeGlyphCanvasAnsi, encodeGlyphCanvasHtml, encodeGlyphCanvasText, foldGlyphOverlayLabelToAscii } from "glyphcss";
import type { CellGrid, GlyphAmbientLight, GlyphCanvas, GlyphDirectionalLight, GlyphSceneObject, Vec3 } from "glyphcss";
import { GLYPH_CHART_TARGET_DEFAULTS } from "../render";
import { glyphChartColorEnabled } from "../regionFill";
import type { GlyphChartCharset, GlyphChartColorMode, GlyphChartTarget } from "../types";
import { GLYPH_CHART_3D_DEFAULT_CAMERA } from "./camera";
import { glyphChart3dBandColor } from "./colorscale";
import { ledgerCharset3dBlocksUnsupported, ledgerChart3dLabelUnfittable, ledgerChart3dValueShadingWireframeNoop, ledgerColorbarOmitted } from "./ledger";
import { glyphChart3dLabelAnchors, glyphChartObject } from "./object";
import { glyphChartSurface } from "./surface";
import { chart3dError, glyphChart3dRepairHint } from "./validate";
import type {
  GlyphChart3dAxisTriadSpec, GlyphChart3dColorLegend, GlyphChart3dLedgerEntry, GlyphChart3dMark,
  GlyphChart3dSurfaceChannels, GlyphChart3dSurfaceData, GlyphChart3dSurfaceMark, GlyphChart3dSurfaceOptions,
} from "./types";

/**
 * Euler `rotX`/`rotY` (degrees) or a trackball `mat` (a 9-element row-major
 * 3x3 rotation matrix, AGENTS.md's numeric conventions / orbit
 * `pitchRange`+trackball contract) — never both; mirrors
 * `renderGlyphDiagram3d`'s own `GlyphDiagram3dCamera` shape exactly, same
 * field names, same auto-fit-when-`zoom`-omitted behaviour (fix round 2,
 * P1: the user decided every 3D chart "rotates in any direction," and
 * `/charts`' own live viewport must let Copy ASCII reproduce the CURRENT
 * live camera — including a rolled trackball pose Euler angles cannot
 * express at all).
 */
export interface GlyphChart3dCameraOptions {
  readonly rotX?: number;
  readonly rotY?: number;
  readonly mat?: readonly number[];
  /** Omit for AUTO-FIT (the default — fits the whole object + its overlay labels on screen, PLAN-3d.md's C2 acceptance and fix round 1's P1-2). An explicit value opts out of auto-fit for THIS render's zoom only; `target` still auto-fits. */
  readonly zoom?: number;
  /**
   * The auto-fit's own additive projection offset (`createGlyphOrthographicCamera`'s
   * `center` field, identity `[0.5, 0.5]`) — meaningful only alongside an
   * explicit `zoom` (fix round 2, P1-c): pass BOTH straight from a prior
   * `resolved.camera` to reproduce that exact frame byte-for-byte. Ignored
   * (auto-fit computes its own) whenever `zoom` is omitted.
   */
  readonly center?: readonly [number, number];
}

/**
 * Mirrors `renderGlyphDiagram3d`'s own `style` option (fix round 2, USER
 * FEEDBACK: "good detail using braille or ink mode"): `"solid"` (the
 * Lambert/value-shaded fill, unchanged), `"wireframe"` (the surface's own
 * decimated quad grid as depth-tested lines — a REAL glyphcss capability,
 * `mode: "wireframe"` + `hiddenLines: "hide"`, no library change needed),
 * or `"ink"` (silhouette + crease outline, `mode: "ink"`). Omitted: AUTO by
 * `charset` — `braille` resolves to `"wireframe"` (glyphcss's braille
 * encoder is wireframe-only, AGENTS.md's "Render modes"; this is what
 * makes braille render REAL geometry now instead of downgrading), every
 * other charset resolves to `"solid"`.
 */
export type GlyphChart3dStyle = "solid" | "wireframe" | "ink";

export interface GlyphChart3dRenderOptions {
  /** Default `"web"` — mirrors `renderGlyphChart`'s own default. */
  readonly target?: GlyphChartTarget;
  readonly charset?: GlyphChartCharset;
  readonly color?: GlyphChartColorMode;
  readonly width?: number;
  readonly height?: number;
  readonly cellAspect?: number;
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Canvas chrome: a title row above the plot. Omitted = no title row (byte-identical to a chart with no chrome opinion). */
  readonly title?: string;
  readonly camera?: GlyphChart3dCameraOptions;
  /** See `GlyphChart3dStyle`'s own doc. Omitted: auto by charset. */
  readonly style?: GlyphChart3dStyle;
}

export interface GlyphChart3dResolved {
  readonly target: GlyphChartTarget;
  readonly charset: GlyphChartCharset;
  readonly color: GlyphChartColorMode;
  readonly width: number;
  readonly height: number;
  readonly cellAspect: number;
  /**
   * The RESOLVED camera (after auto-fit, when it ran) — `rotX`/`rotY` for
   * an Euler camera, or `mat` for a trackball one (never both), mirroring
   * `renderGlyphDiagram3d`'s own resolved-camera shape. `center` (fix round
   * 2, P1-c) is the auto-fit's own additive recentring offset
   * (`createGlyphOrthographicCamera`'s `center` field) — ALWAYS reported
   * (never conditionally omitted at its own `[0.5, 0.5]` identity, unlike
   * the prior cut, which dropped it entirely and left `resolved.camera`
   * alone unable to reproduce the exact auto-fitted frame — `target` is
   * always this mark's own bounds centroid, recoverable from the mark
   * itself, but the recentring is not, so reconstructing from `rotX`/
   * `rotY`/`zoom`/`mat` alone reproduced the right SIZE at the wrong
   * POSITION, measured 245-576 characters different from the original).
   * `options.camera = result.resolved.camera` round-trips byte-for-byte.
   */
  readonly camera: { readonly rotX?: number; readonly rotY?: number; readonly zoom: number; readonly mat?: readonly number[]; readonly center: readonly [number, number] };
  /** The EFFECTIVE style this frame rendered (after resolving `options.style`'s own auto-by-charset default). */
  readonly style: GlyphChart3dStyle;
}

export interface GlyphChart3dReport {
  readonly ledger: readonly GlyphChart3dLedgerEntry[];
}

export interface GlyphChart3dResult {
  readonly text: string;
  /** Present only for `color: "css"`. */
  readonly html?: string;
  readonly resolved: GlyphChart3dResolved;
  readonly report: GlyphChart3dReport;
  /**
   * The mounted `GlyphSceneObject` this frame rasterized (with its
   * `shading` resolved — see `resolveMarkShading`) — a caller can mount the
   * SAME object into a live `createGlyphScene` for an orbitable view at
   * `resolved.camera`, mirroring `@glyphcss/diagrams/3d`'s own D2/D3 split
   * (`renderGlyphDiagram3d`'s result carries `object` for exactly this
   * reason).
   */
  readonly object: GlyphSceneObject;
}

const CANVAS_TIERS = ["ascii", "box", "blocks", "braille"] as const;
const COLOR_MODES = ["none", "ansi16", "ansi256", "truecolor", "css"] as const;
const COLORBAR_MIN_PLOT_WIDTH = 24;
const COLORBAR_TITLE_COLOR = "#e5e7eb";
const zFormatRaw = d3format("~r");
/** C2 fix round 8, P1-C: `d3-format` emits U+2212 MINUS SIGN, which the ascii/box/braille chrome tiers can't paint (folds to `?`) — same fix as `axisTriadShared.ts`'s own `asciiMinus`, applied to the colorbar's own labels. */
const zFormat = (v: number) => zFormatRaw(v).replace(/−/g, "-");

function ansiColorMode(mode: GlyphChartColorMode): "16" | "256" | "truecolor" {
  if (mode === "ansi16") return "16";
  if (mode === "ansi256") return "256";
  return "truecolor";
}

/**
 * Charset -> a ledger degrade (fix round 1, P1-4): a 3D chart's overlays
 * (the box wireframe, every axis's ticks/labels — ALWAYS mounted, never
 * optional) install a `transformCells` hook on every render, and glyphcss's
 * `charMode: "halfblock"`/`"quadrant"` two-colour-per-cell encoders are
 * solid-mode-only AND disabled outright whenever a `transformCells` hook is
 * present (`rasterize.ts`'s `wantsHalfblockSolid`/`wantsQuadrantSolid`,
 * AGENTS.md's own "Render modes": "no-ops with `transformCells`"). A prior
 * cut requested `charMode: "halfblock"` for `charset: "blocks"` anyway,
 * which the hook silently defeated — `ascii` and `blocks` output were
 * byte-identical, with no signal that the request never took effect.
 * Rendering the geometry in real halfblock WITHOUT the hook was considered
 * and rejected: the hook IS the axis box/ticks/labels, so dropping it to
 * get halfblock geometry would draw a surface with no box, no ticks and no
 * axis titles at all — a bigger loss than the charset downgrade itself, and
 * "stamp the chrome separately" has no home to stamp INTO once the hook
 * that owns stamping is gone. So both unsupported charsets get the SAME
 * faithful, VISIBLE downgrade to the default solid ramp — `braille`
 * (wireframe-only in glyphcss, so a chart's own always-solid geometry could
 * never draw it) and now `blocks` too, each with its own ledger entry
 * naming exactly what happened, mirroring `@glyphcss/diagrams/3d`'s own D2
 * packet's identical `blocks -> ascii` choice (`render3d.ts`'s
 * `resolveCharset`).
 */
function resolveCharsetDegrade3d(charset: GlyphChartCharset, ledger: GlyphChart3dLedgerEntry[]): void {
  if (charset === "blocks") ledger.push(ledgerCharset3dBlocksUnsupported());
  // `braille` no longer degrades (fix round 2): `resolveGlyphChart3dStyle`
  // resolves it to `style: "wireframe"`, which genuinely renders the
  // surface's own decimated quad grid as depth-tested braille sub-cell
  // dot lines — a real glyphcss capability (`mode: "wireframe"` +
  // `charMode: "braille"` + `hiddenLines: "hide"`), not a downgrade.
}

/**
 * The SAME charset degrade `resolveCharsetDegrade3d` reports into a static
 * frame's ledger, exported as a plain predicate for a LIVE scene consumer
 * (a mounted `createGlyphScene` orbiting a `glyphChartObject`, e.g.
 * `/charts`' own 3D viewport) that needs the identical target/charset
 * contract without re-deriving WHICH charsets are unsupported (AGENTS.md's
 * "Charts 3D": "Charset mapping for 3D") — ONLY `blocks` (the always-
 * mounted axis/tick overlay disables the halfblock encoder) can never
 * render a 3D chart's geometry; `braille` no longer degrades (fix round 2:
 * it resolves to a real `style: "wireframe"` render, below) and `ascii`/
 * `box` are unaffected. A live caller that wants the exact chrome wording
 * writes its own note (a live scene has no `report.ledger` of its own to
 * push one into) — this only answers "can charset X actually render".
 */
export function glyphChart3dCharsetDegrades(charset: GlyphChartCharset): boolean {
  return charset === "blocks";
}

/**
 * Charset -> render `style` when the caller names none (fix round 2, USER
 * FEEDBACK: "good detail using braille or ink mode"). `braille` resolves to
 * `"wireframe"` — glyphcss's braille encoder is wireframe-only
 * (AGENTS.md's "Render modes"), so this is the ONLY way a braille 3D frame
 * ever shows real geometry rather than a faithful downgrade. Every other
 * charset keeps the ORIGINAL `"solid"` (Lambert/value-shaded fill)
 * default. An explicit `options.style` always wins, independent of
 * charset — a caller can ask for a `box`/`ascii` wireframe too.
 */
export function resolveGlyphChart3dStyle(charset: GlyphChartCharset, styleOption: GlyphChart3dStyle | undefined): GlyphChart3dStyle {
  if (styleOption !== undefined) return styleOption;
  return charset === "braille" ? "wireframe" : "solid";
}

/**
 * Public (round 6): the exact `createGlyphScene`/`compileScene` render
 * options a resolved `style` needs — `renderObjectFrame`'s own logic below,
 * extracted so a LIVE scene consumer (`/charts`' own orbit viewport) reads
 * the identical mapping instead of keeping its own copy that can drift from
 * this one (the page had to mirror this exact object literal before this
 * export existed). `mode` is `style` itself — glyphcss's `RenderMode` and
 * `GlyphChart3dStyle` share the same 3 string values by construction.
 */
export function glyphChart3dStyleSceneOptions(style: GlyphChart3dStyle, charset: GlyphChartCharset): { readonly mode: GlyphChart3dStyle; readonly charMode?: "braille"; readonly hiddenLines?: "hide" } {
  return {
    mode: style,
    ...(style === "wireframe" ? { charMode: charset === "braille" ? "braille" as const : undefined, hiddenLines: "hide" as const } : {}),
  };
}

/**
 * The canvas CHROME (title/colorbar) tier. `blocks` degrades to the
 * default `ascii` tier here (fix round 1, P1-4) — the geometry itself can
 * never actually render in halfblock (`resolveCharsetDegrade3d`'s own doc),
 * and letting the CHROME alone keep real half-block/quadrant swatch glyphs
 * while the geometry silently fell back would make a `blocks` frame
 * genuinely DIFFERENT bytes from an `ascii` one for a reason no ledger
 * entry explains — the matrix test's own "byte-identical to ascii" claim is
 * what makes the downgrade FAITHFUL rather than a half-measure. `braille`
 * no longer degrades here (fix round 2): the chrome (title/colorbar) now
 * shares the SAME braille tier the geometry genuinely renders under, so a
 * colorbar swatch reads sub-cell dot density too, consistent with the plot.
 */
/** Public (round 6) — was `chromeTier`, private; `/charts`' own live viewport had to mirror it before this export existed. */
export function glyphChart3dChromeTier(charset: GlyphChartCharset): (typeof CANVAS_TIERS)[number] {
  return charset === "blocks" ? "ascii" : charset;
}

/**
 * Fix round 4, Item 3: caps a WIREFRAME mesh's own quad resolution at
 * `WIREFRAME_MAX_QUADS` per axis — never below a caller's own explicit,
 * already-coarser `maxQuadsX`/`maxQuadsY` (a `Math.min`, not an
 * override) — so `style: "wireframe"` shows real mesh LINES with visible
 * gaps between them (rim/crater legible) instead of every one of a fine
 * grid's own quad edges (a solid blob at typical grid sizes). `solid`
 * style never calls this — its own full resolution is what makes its
 * shading fine-grained.
 */
const WIREFRAME_MAX_QUADS = 20;
function wireframeDecimatedMark(mark: GlyphChart3dSurfaceMark): GlyphChart3dSurfaceMark {
  const rows = mark.grid.z.length;
  const cols = mark.grid.z[0]?.length ?? 0;
  const maxQuadsY = Math.min(mark.maxQuadsY ?? (rows - 1), WIREFRAME_MAX_QUADS);
  const maxQuadsX = Math.min(mark.maxQuadsX ?? (cols - 1), WIREFRAME_MAX_QUADS);
  if (maxQuadsY === mark.maxQuadsY && maxQuadsX === mark.maxQuadsX) return mark;
  return { ...mark, maxQuadsX, maxQuadsY };
}

/**
 * `mark.shading` resolves from the render's OWN colour mode when the
 * caller never named one (fix round 1, P1-3): §5 requires `shading:
 * "value"` by default under `color: "none"`/NO_COLOR, and `glyphChartSurface`
 * (the MODEL step) has no visibility into a later render's colour mode, so
 * it now leaves `shading` `undefined` rather than baking in `"relief"`
 * itself (`surface.ts`'s own doc). This is the ONE place that default is
 * resolved — where the colour mode is actually known.
 */
function resolveMarkShading(mark: GlyphChart3dSurfaceMark, colorEnabled: boolean): "relief" | "value" {
  return mark.shading ?? (colorEnabled ? "relief" : "value");
}

const COLORBAR_MAX_LABELS = 6;
/**
 * Fix round 4, Item 5 ("the colorbar sits at the far right edge,
 * disconnected"): a fixed 2-column gap — the coordinator's own suggested
 * "2-3 cols" — between the plot's own ACTUAL projected extent (measured
 * below, `occupiedGridBounds`) and the colorbar's swatch column. Also the
 * width the initial column RESERVATION (`colorbarLabelWidth(...) + 1 +
 * COLORBAR_GAP_COLS`) budgets for, so the reservation and the real gap stay
 * the same number rather than drifting apart.
 */
const COLORBAR_GAP_COLS = 2;

interface ColorbarRow {
  readonly row: number;
  readonly bandIdx: number;
  readonly shade: number;
  readonly value: number;
  readonly label: string | undefined;
}

/** The colorbar's own row layout — bands, shades and WHICH rows get a label (endpoints always, up to `COLORBAR_MAX_LABELS` intermediates evenly spaced) — factored out of `paintColorbar` so `colorbarLabelWidth` (fix round 2, P1-a: the colorbar column reservation) can measure the SAME label set it paints, never a duplicated/driftable copy. Generic over `GlyphChart3dColorLegend` (C5) — every mark type's own colour legend shares this ONE shape now, never `surface`'s own `bands`/`colorAnchors`/`axes.z.domain` triple read directly. */
function colorbarRows(legend: GlyphChart3dColorLegend, y0: number, rowsAvailable: number): readonly ColorbarRow[] {
  const bands = legend.bands;
  const rows = Math.max(1, Math.min(bands, rowsAvailable));
  const [zLo, zHi] = legend.domain;
  const zSpan = zHi - zLo;
  const labelEvery = rows <= COLORBAR_MAX_LABELS ? 1 : Math.ceil((rows - 1) / (COLORBAR_MAX_LABELS - 1));
  const out: ColorbarRow[] = [];
  for (let i = 0; i < rows; i++) {
    const bandIdx = rows === 1 ? bands - 1 : Math.round(((rows - 1 - i) * (bands - 1)) / (rows - 1));
    const shade = bands <= 1 ? 1 : bandIdx / (bands - 1);
    const isEndpoint = i === 0 || i === rows - 1;
    const value = bands <= 1 ? zHi : zLo + (bandIdx / (bands - 1)) * zSpan;
    out.push({ row: y0 + i, bandIdx, shade, value, label: isEndpoint || i % labelEvery === 0 ? zFormat(value) : undefined });
  }
  return out;
}

/** The exact column width the colorbar's OWN labels need (fix round 2, P1-a: the prior fixed `COLORBAR_COLS = 9` reserved far more than the 2 columns `paintColorbar` ever actually painted — a 7-column dead gap between the plot and the colorbar the review's own footprint measurement fell into). Measures the SAME label set `colorbarRows` produces. */
function colorbarLabelWidth(legend: GlyphChart3dColorLegend, rowsAvailable: number): number {
  let width = 1;
  for (const r of colorbarRows(legend, 0, rowsAvailable)) {
    if (r.label !== undefined) width = Math.max(width, r.label.length);
  }
  return width;
}

/**
 * Fix round 4, Item 5: the occupied column/row bounding box of a rasterized
 * `CellGrid` (non-blank cells only) — `renderGlyphChart3d` uses this on the
 * SURFACE grid (before it's pasted onto the chrome canvas) to place the
 * colorbar relative to what the fitted camera actually painted, not the
 * nominal plot-column BUDGET the auto-fit was free to under-fill on one
 * axis (an orthographic fit maxes out whichever of cols/rows binds first —
 * leftover room on the other axis is real and the colorbar must not treat
 * it as "the plot reaches here"). `null` when the grid is entirely blank.
 */
function occupiedGridBounds(grid: CellGrid): { readonly minCol: number; readonly maxCol: number; readonly minRow: number; readonly maxRow: number } | null {
  let minCol = Infinity, maxCol = -Infinity, minRow = Infinity, maxRow = -Infinity;
  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      const ch = grid.char[r * grid.cols + c];
      if (ch === undefined || ch === " ") continue;
      if (c < minCol) minCol = c;
      if (c > maxCol) maxCol = c;
      if (r < minRow) minRow = r;
      if (r > maxRow) maxRow = r;
    }
  }
  return Number.isFinite(minCol) ? { minCol, maxCol, minRow, maxRow } : null;
}

/** A vertical value-scale swatch strip — z max at the top, z min at the bottom, each row's shade AND colour reading its own band (monotone even with colour off, matching `shading: "value"`'s own discipline). Fix round 1 (P1-2): labels every band up to a legible cap, not just the two endpoints — a one-column colorbar with no intermediate reading is close to useless as a legend. Fix round 4, Item 5: `swatchCol`/`y0` are the CALLER's own choice (placed a fixed `COLORBAR_GAP_COLS` past the plot's own actual right edge, vertically centred on its own occupied row range — `renderGlyphChart3d`'s own doc), never `canvas.cols - 1`/the plot's top row unconditionally. */
function paintColorbar(canvas: GlyphCanvas, legend: GlyphChart3dColorLegend, swatchCol: number, y0: number, rowsAvailable: number, colorEnabled: boolean): void {
  const labelCol = swatchCol - 1;
  const bands = legend.bands;
  const anchors = legend.anchors;
  for (const r of colorbarRows(legend, y0, rowsAvailable)) {
    const swatchColor = anchors ? glyphChart3dBandColor(anchors, r.bandIdx, bands) : null;
    canvas.fillRect(swatchCol, r.row, swatchCol, r.row, { fill: { shade: r.shade }, color: colorEnabled ? swatchColor : null });
    if (r.label === undefined) continue;
    canvas.text(labelCol, r.row, [r.label], { align: "right", color: colorEnabled ? COLORBAR_TITLE_COLOR : undefined });
  }
}

function objectBoundsCenter(bounds: { readonly min: Vec3; readonly max: Vec3 }): Vec3 {
  return [(bounds.min[0] + bounds.max[0]) / 2, (bounds.min[1] + bounds.max[1]) / 2, (bounds.min[2] + bounds.max[2]) / 2];
}

interface ResolvedLighting {
  readonly directionalLight?: GlyphDirectionalLight;
  readonly ambientLight?: GlyphAmbientLight;
}

function lightingForShading(shading: "relief" | "value"): ResolvedLighting {
  // `shading: "value"` renders under ambient-only light so slope contributes
  // nothing to the picture at all — glyph density alone carries z, matching
  // AGENTS.md's "Charts 3D" own doc.
  return shading === "value"
    ? { directionalLight: { direction: [0.5, 0.7, 0.5], intensity: 0 }, ambientLight: { intensity: 1 } }
    : {};
}

/**
 * `style === "wireframe"` renders the surface's OWN decimated quad grid as
 * depth-tested lines — `mode: "wireframe"` + `hiddenLines: "hide"` (a
 * slope-scaled depth-bias prepass against the surface itself, AGENTS.md's
 * "Render modes"), so a line on the FAR side of the surface is genuinely
 * hidden rather than drawn through it, exactly like `style === "solid"`'s
 * own depth-tested fill. `charMode: "braille"` only under the `braille`
 * charset — every other charset wireframes in plain ASCII/box-drawing
 * rules. `style === "ink"` is silhouette + crease outline (`mode: "ink"`),
 * which computes its own occlusion internally and needs no `hiddenLines`.
 *
 * `sceneCellAspect` (fix round 4, coordinator root-cause finding): `glyphcss`'s
 * OWN cell-aspect convention (`cellHeight / cellWidth`, `rasterize.ts`'s
 * `fallbackCellW = 50 / cellAspect` — a FIXED `cellHeight` of 50, so a
 * SMALLER value here means a WIDER cell) is the exact INVERSE of this
 * package's own public `cellAspect` (`cellWidth / cellHeight`,
 * `GLYPH_CHART_TARGET_DEFAULTS.web.cellAspect = 0.5859375`, Glyph Mono's
 * measured advance/line-height, AGENTS.md's "Arc shape"). Every call into
 * `glyphcss` (this function, `compileScene`'s own `cellAspect`, a live
 * scene's `createGlyphScene({ cellAspect })`) needs the CONVERTED value —
 * `1 / chartCellAspect` — never the raw chart one; `createGlyphCanvas`
 * (chart chrome: title/colorbar) is the ONE call in this module that keeps
 * the chart's OWN convention, since it never reaches glyphcss's projection
 * at all. Passing the un-converted value squashed every 3D projection
 * horizontally by `(1/0.586)/0.586 ≈ 2.9x` — the actual root cause behind
 * every prior round's "tiny, narrow surface," which round 2/3 both
 * misdiagnosed as a camera-pitch/footprint problem and "fixed" by
 * flattening the pitch instead.
 */
function renderObjectFrame(
  object: GlyphSceneObject,
  camera: ReturnType<typeof createGlyphOrthographicCamera>,
  cols: number,
  rows: number,
  sceneCellAspect: number,
  useColors: boolean,
  lighting: ResolvedLighting,
  style: GlyphChart3dStyle,
  charset: GlyphChartCharset,
): CellGrid {
  const result = compileScene({
    polygons: [],
    objects: [object],
    camera,
    cols,
    rows,
    cellAspect: sceneCellAspect,
    useColors,
    ...glyphChart3dStyleSceneOptions(style, charset),
    ...lighting,
  });
  // `objects` never requests `charMode: "halfblock"`/`"quadrant"` here (see
  // `resolveCharsetDegrade3d`), so `grid` is never `null`
  // (`CompileSceneResult.grid`'s own doc — `null` is exact to those two
  // charModes only).
  return result.grid!;
}

interface FitLabel { readonly text: string; readonly point: Vec3; }

const FIT_MARGIN_COLS = 1;
const FIT_ZOOM_SAFETY = 0.96;

/**
 * Auto-fit the static frame's default camera — CLOSED-FORM, not a rendered
 * probe (fix round 2, P1-b, mirroring `@glyphcss/diagrams/3d`'s own D2
 * packet's identical fix, `render3d.ts`'s `fitDiagramCamera`): a PRIOR cut
 * here rendered a probe frame and measured which glyphs survived —
 * indistinguishable from "never fit" for a label the ARBITER dropped to a
 * collision or that landed off the probe's own generous grid, so a 10°
 * Euler sweep left a FULL title missing (`Eleva+ion`, a bare `Elevati\n`)
 * at 14 of 36 rotations at 80x24 alone.
 *
 * For a fixed rotation/target/center, an orthographic camera's
 * `col(zoom) = centerCol + (col1 - centerCol) * zoom` is EXACTLY linear in
 * `zoom` (`col1` = the projection at a reference `zoom: 1`), so every "this
 * point/label must land within `[lo, hi]`" constraint reduces to ONE linear
 * inequality in `zoom`. The tightest (`min`) upper bound across every one
 * of the object's 8 bounds corners AND every tick/title's own anchor PLUS
 * its full painted text width (`glyphChart3dLabelAnchors` — computed
 * BEFORE any clipping or arbiter collision, never a rendered guess) gives
 * the LARGEST zoom that keeps everything on screen with margin — one pass,
 * no iteration, and therefore nothing an arbiter collision can hide from
 * it. A label wider than the frame itself is excluded from the constraint
 * set (so it alone can't force every other label toward zoom zero) and
 * reported via `chart3d-label-unfittable`.
 *
 * `rotation` is EITHER Euler (`rotX`/`rotY`) or a trackball `mat` (fix
 * round 2, P1-d) — the fit is rotation-representation-agnostic, since it
 * only ever asks the reference camera to `project()`.
 */
function fitStaticCamera(
  mark: GlyphChart3dAxisTriadSpec,
  object: GlyphSceneObject,
  rotation: { readonly rotX?: number; readonly rotY?: number; readonly mat?: readonly number[] },
  cols: number,
  rows: number,
  sceneCellAspect: number,
  hasTitle: boolean,
): { readonly camera: ReturnType<typeof createGlyphOrthographicCamera>; readonly zoom: number; readonly center: readonly [number, number]; readonly unfittable: readonly FitLabel[] } {
  const centroid = objectBoundsCenter(object.bounds);
  const useMat = rotation.mat !== undefined;
  const makeCamera = (zoom: number, center: readonly [number, number]) => {
    const camera = createGlyphOrthographicCamera({
      rotX: rotation.rotX, rotY: rotation.rotY, zoom, center: [center[0], center[1]],
      ...(useMat ? { mat: [...rotation.mat!], useMat: true } : {}),
    });
    camera.target = centroid;
    return camera;
  };

  const marginRowTop = hasTitle ? 2 : 1, marginRowBottom = 1;
  const centerCol = cols / 2, centerRow = rows / 2;
  const reference = makeCamera(1, [0.5, 0.5]);

  interface ColPoint { readonly col1: number; readonly widthRight: number; }
  interface RowPoint { readonly row1: number; }
  const colPoints: ColPoint[] = [], rowPoints: RowPoint[] = [];
  const { min, max } = object.bounds;
  for (const x of [min[0], max[0]]) for (const y of [min[1], max[1]]) for (const z of [min[2], max[2]]) {
    const [col1, row1] = reference.project([x, y, z], cols, rows, sceneCellAspect);
    colPoints.push({ col1, widthRight: 0 });
    rowPoints.push({ row1 });
  }

  const availCols = Math.max(1, cols - 2 * FIT_MARGIN_COLS);
  const unfittable: FitLabel[] = [];
  for (const anchor of glyphChart3dLabelAnchors(mark)) {
    const text = foldGlyphOverlayLabelToAscii(anchor.text);
    if (text.length === 0) continue;
    if (text.length > availCols) { unfittable.push(anchor); continue; }
    const [col1, row1] = reference.project(anchor.point, cols, rows, sceneCellAspect);
    // A label paints LEFT-ALIGNED from its own anchor column
    // (`labelArbiter.ts`'s `resolve()`: `stampGlyphOverlayCell({col: c.col
    // + i, ...})` for `i` in `[0, text.length)`) — never centred — so its
    // own screen span is `[col1, col1 + text.length - 1]`, and only the
    // RIGHT edge needs its own extra bound.
    colPoints.push({ col1, widthRight: text.length - 1 });
    rowPoints.push({ row1 });
  }

  let zUpper = Infinity;
  const EPS = 1e-9;
  for (const p of colPoints) {
    const offset = p.col1 - centerCol;
    if (offset > EPS) zUpper = Math.min(zUpper, (cols - FIT_MARGIN_COLS - p.widthRight - centerCol) / offset);
    else if (offset < -EPS) zUpper = Math.min(zUpper, (FIT_MARGIN_COLS - centerCol) / offset);
  }
  for (const p of rowPoints) {
    const offset = p.row1 - centerRow;
    if (offset > EPS) zUpper = Math.min(zUpper, (rows - marginRowBottom - centerRow) / offset);
    else if (offset < -EPS) zUpper = Math.min(zUpper, (marginRowTop - centerRow) / offset);
  }
  if (!Number.isFinite(zUpper) || zUpper <= 0) zUpper = 1;
  const finalZoom = zUpper * FIT_ZOOM_SAFETY;

  let minCol = Infinity, maxCol = -Infinity, minRow = Infinity, maxRow = -Infinity;
  for (const p of colPoints) {
    const c = centerCol + (p.col1 - centerCol) * finalZoom;
    if (c < minCol) minCol = c;
    if (c + p.widthRight > maxCol) maxCol = c + p.widthRight;
  }
  for (const p of rowPoints) {
    const r = centerRow + (p.row1 - centerRow) * finalZoom;
    if (r < minRow) minRow = r;
    if (r > maxRow) maxRow = r;
  }
  const dCol = (minCol + maxCol) / 2 - centerCol, dRow = (minRow + maxRow) / 2 - centerRow;

  // C2 fix round 8 (coordinator review of round 7): round 7's own EXTRA
  // column shift (`ORIGIN_COLUMN_TARGET_FRACTION`) is REMOVED. It treated
  // "off-centre corner" as a FRAMING problem to solve by shoving the whole
  // picture sideways — which left ~55% of the frame empty on one side
  // (P1-B) and did nothing about WHICH box corner the camera even put
  // there (the origin corner was still the NEAREST/front corner at
  // `rotY: 228`, not a SIDE one — P1-A, `camera.ts`'s own updated doc).
  // The actual fix is the YAW ITSELF (`GLYPH_CHART_3D_DEFAULT_CAMERA`):
  // chosen so the origin corner is the box's own LEFTMOST silhouette
  // vertex, at which point plain symmetric bbox-centering (below,
  // unchanged since before round 7) already puts it near the frame's own
  // left side — because the corner is no longer at the box's own
  // symmetric middle, centering the WHOLE content naturally leaves it
  // off-centre. No corner-specific shift is needed or applied any more.
  const center: [number, number] = [0.5 - dCol / cols, 0.5 - dRow / rows];

  return { camera: makeCamera(finalZoom, center), zoom: finalZoom, center, unfittable };
}

/**
 * `renderGlyphChart3d(mark, options)` — a static frame of `mark` (a
 * `glyphChartSurface` result, mirroring `glyphChartObject`'s own `(mark,
 * options)` shape) at the resolved target/charset/color/camera, through the
 * same `text`/`html` exits the 2D entry uses. Auto-fits the default camera
 * to the object's own geometry AND overlay labels (`fitStaticCamera`) so
 * the plot is the dominant element on screen with no explicit camera.
 */
export function renderGlyphChart3d(mark: GlyphChart3dMark, options: GlyphChart3dRenderOptions = {}): GlyphChart3dResult {
  const target: GlyphChartTarget = options.target ?? "web";
  const defaults = GLYPH_CHART_TARGET_DEFAULTS[target];
  if (!defaults) chart3dError("bad-render-options", `target must be one of chat, terminal, web, got ${JSON.stringify(options.target)}.`);

  const width = options.width ?? defaults.width;
  const height = options.height ?? defaults.height;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    chart3dError("bad-render-size", `width/height must be positive integers, got ${JSON.stringify(width)}x${JSON.stringify(height)}.`);
  }

  const charset: GlyphChartCharset = options.charset ?? defaults.charset;
  if (!CANVAS_TIERS.includes(charset)) chart3dError("bad-render-options", `charset must be one of ${CANVAS_TIERS.join(", ")}, got ${JSON.stringify(options.charset)}.`);

  const color: GlyphChartColorMode = options.color ?? defaults.color;
  if (!COLOR_MODES.includes(color)) chart3dError("bad-render-options", `color must be one of ${COLOR_MODES.join(", ")}, got ${JSON.stringify(options.color)}.`);

  // `cellAspect` (this PACKAGE's own `cellWidth / cellHeight` convention,
  // AGENTS.md's "Arc shape") stays THIS value for the chart canvas
  // (`createGlyphCanvas`, chrome only — title/colorbar) and for the public
  // `resolved.cellAspect` echo. `glyphcss` itself uses the INVERSE
  // convention (`cellHeight / cellWidth`) everywhere it projects 3D
  // geometry — `sceneCellAspect` below is that converted value, and is the
  // ONE that may ever reach `compileScene`/a camera's own `.project()`
  // (`renderObjectFrame`'s own doc has the full derivation and the fix
  // round 4 root-cause finding).
  const cellAspect = options.cellAspect ?? defaults.cellAspect;
  if (typeof cellAspect !== "number" || !Number.isFinite(cellAspect) || cellAspect <= 0) {
    chart3dError("bad-render-options", `cellAspect must be a positive finite number, got ${JSON.stringify(options.cellAspect)}.`);
  }
  const sceneCellAspect = 1 / cellAspect;

  const cameraOption = options.camera ?? {};
  if (cameraOption.mat !== undefined && (cameraOption.rotX !== undefined || cameraOption.rotY !== undefined)) {
    chart3dError("bad-camera", "camera: pass either mat (trackball) or rotX/rotY (Euler), not both.");
  }
  const useMat = cameraOption.mat !== undefined;
  const rotX = useMat ? undefined : (cameraOption.rotX ?? GLYPH_CHART_3D_DEFAULT_CAMERA.rotX);
  const rotY = useMat ? undefined : (cameraOption.rotY ?? GLYPH_CHART_3D_DEFAULT_CAMERA.rotY);
  if (!useMat && (!Number.isFinite(rotX) || !Number.isFinite(rotY))) {
    chart3dError("bad-camera", `camera.rotX/rotY must be finite numbers, got ${JSON.stringify(cameraOption)}.`);
  }
  if (cameraOption.zoom !== undefined && (!Number.isFinite(cameraOption.zoom) || cameraOption.zoom <= 0)) {
    chart3dError("bad-camera", `camera.zoom must be a positive finite number, got ${JSON.stringify(cameraOption.zoom)}.`);
  }
  if (cameraOption.center !== undefined && (cameraOption.center.length !== 2 || !cameraOption.center.every((v) => Number.isFinite(v)))) {
    chart3dError("bad-camera", `camera.center must be a [number, number] pair, got ${JSON.stringify(cameraOption.center)}.`);
  }

  if (options.style !== undefined && options.style !== "solid" && options.style !== "wireframe" && options.style !== "ink") {
    chart3dError("bad-render-options", `style must be one of solid, wireframe, ink, got ${JSON.stringify(options.style)}.`);
  }
  const style = resolveGlyphChart3dStyle(charset, options.style);

  const ledger: GlyphChart3dLedgerEntry[] = [...mark.report.ledger];
  resolveCharsetDegrade3d(charset, ledger);
  const colorEnabled = glyphChartColorEnabled(color, options.env);
  // `shading: "value"` (the texture-density monochrome discipline) is a
  // SURFACE-only concept — a scatter marker/bar/line has no fill FACE for
  // slope to shade in the first place, so every other mark type just keeps
  // the scene's own default Lambert lighting; `scatter3d`'s own monochrome
  // answer is marker SHAPE (`glyphChartObject`'s `monochrome` option),
  // resolved right below instead.
  let lighting: ResolvedLighting = {};
  let surfaceShading: "relief" | "value" = "relief";
  if (mark.type === "surface") {
    // `shading: "value"` has no analogue under wireframe (a line has no fill
    // face to texture) — colour stays the surface's own per-quad band colour
    // per line, so the effective shading is always `"relief"` there
    // regardless of `mark.shading`/colour mode, and an explicit
    // `shading: "value"` request is ledgered as a no-op rather than silently
    // ignored.
    if (style === "wireframe" && mark.shading === "value") ledger.push(ledgerChart3dValueShadingWireframeNoop());
    surfaceShading = style === "wireframe" ? "relief" : resolveMarkShading(mark, colorEnabled);
    lighting = lightingForShading(surfaceShading);
  }

  // C5: every mark type's own colour legend, generic — `surface`'s own
  // `colorAnchors`/`bands`/`axes.z.domain` triple is folded into the SAME
  // `GlyphChart3dColorLegend` shape every other mark type already carries
  // directly on `mark.colorLegend`, so the colorbar chrome below (and
  // `colorbarRows`/`colorbarLabelWidth`/`paintColorbar`) reads ONE field
  // regardless of mark type. `line3d` never carries a legend at all — a
  // trajectory's own colour is per-SERIES, not a continuous scalar.
  const colorLegend: GlyphChart3dColorLegend | null = mark.type === "surface"
    ? (mark.colorAnchors === null ? null : { anchors: mark.colorAnchors, bands: mark.bands, domain: mark.axes.z.domain })
    : mark.type === "line3d" ? null : mark.colorLegend;

  const titleRows = options.title ? 1 : 0;
  const plotRows = Math.max(1, height - titleRows);
  const plotY0 = titleRows;

  // Fix round 2, P1-a: reserve EXACTLY the columns the colorbar's own
  // labels need (`colorbarLabelWidth`) plus its swatch column plus a
  // 1-column gap — never a fixed budget wider than what `paintColorbar`
  // actually paints, which left a dead gap between the plot and the
  // colorbar the review's own footprint measurement fell straight into.
  let colorbarCols = 0;
  if (colorLegend !== null) {
    const needed = colorbarLabelWidth(colorLegend, plotRows) + 1 + COLORBAR_GAP_COLS;
    if (width - needed >= COLORBAR_MIN_PLOT_WIDTH) colorbarCols = needed;
    else ledger.push(ledgerColorbarOmitted({ width, minWidth: COLORBAR_MIN_PLOT_WIDTH + needed }));
  }
  const plotCols = Math.max(1, width - colorbarCols);

  // `glyphChart3dChromeTier(charset)` (never the raw `charset`) so a `blocks` request —
  // which already downgrades to ascii-identical rendering for this chart's
  // ALWAYS-overlaid box/tick geometry — gets the ascii grid glyph, not a
  // box-drawing one the rest of the frame will never otherwise show.
  const objectCharset = glyphChart3dChromeTier(charset);
  // Fix round 4, Item 3: `style: "wireframe"` draws EVERY quad edge of the
  // surface mesh — at the fixture's own 40x40 grid resolution that is
  // ~1,600 quads, so a braille wireframe reads as one solid blob with no
  // rim or crater visible, never real mesh lines with gaps. `solid` keeps
  // its own full resolution (fine-grained shading is what a solid render
  // wants); only the WIREFRAME mesh is decimated here, to
  // `WIREFRAME_MAX_QUADS` per axis (16-24, the coordinator's own range) —
  // reusing `gridSurfacePolygons`' own decimation (`mark.maxQuadsX`/`Y`,
  // `object.ts`'s own doc: ALWAYS keeps the peak/trough row+column, never
  // just a blind stride) rather than a second mesh-thinning pass. Never
  // decimates BELOW a caller's own explicit, already-smaller request.
  let object: GlyphSceneObject;
  if (mark.type === "surface") {
    const meshMark = style === "wireframe" ? wireframeDecimatedMark(mark) : mark;
    object = meshMark.shading === surfaceShading
      ? glyphChartObject(meshMark, { charset: objectCharset })
      : glyphChartObject({ ...meshMark, shading: surfaceShading }, { charset: objectCharset });
  } else {
    object = glyphChartObject(mark, {
      charset: objectCharset,
      ...(mark.type === "scatter3d" ? { monochrome: !colorEnabled } : {}),
    });
  }

  let camera: ReturnType<typeof createGlyphOrthographicCamera>;
  let zoom: number;
  let center: readonly [number, number] | undefined;
  if (cameraOption.zoom === undefined) {
    const fit = fitStaticCamera(mark, object, { rotX, rotY, mat: cameraOption.mat }, plotCols, plotRows, sceneCellAspect, Boolean(options.title));
    camera = fit.camera;
    zoom = fit.zoom;
    center = fit.center;
    for (const label of fit.unfittable) ledger.push(ledgerChart3dLabelUnfittable({ text: label.text, cols: plotCols }));
  } else {
    zoom = cameraOption.zoom;
    // P1-c: accept `center` on input (the SAME additive `camera.center`
    // offset `resolved.camera` reports) so a caller re-rendering from
    // `resolved.camera` verbatim reproduces the exact fitted frame — the
    // prior cut discarded it entirely (`resolved.camera` carried only
    // `rotX`/`rotY`/`zoom`), so re-rendering from the reported camera
    // reconstructed the right SIZE at the wrong POSITION (measured:
    // 245-576 characters different from the original frame).
    center = cameraOption.center ?? [0.5, 0.5];
    camera = createGlyphOrthographicCamera({
      rotX, rotY, zoom, center: [center[0], center[1]],
      ...(useMat ? { mat: [...cameraOption.mat!], useMat: true } : {}),
    });
    camera.target = objectBoundsCenter(object.bounds);
  }

  const surfaceGrid = renderObjectFrame(object, camera, plotCols, plotRows, sceneCellAspect, colorEnabled, lighting, style, charset);

  const canvas = createGlyphCanvas({ cols: width, rows: height, tier: glyphChart3dChromeTier(charset), cellAspect });
  for (let r = 0; r < surfaceGrid.rows; r++) {
    for (let c = 0; c < surfaceGrid.cols; c++) {
      const srcIdx = r * surfaceGrid.cols + c;
      const dstCol = c, dstRow = plotY0 + r;
      if (dstCol < 0 || dstCol >= canvas.cols || dstRow < 0 || dstRow >= canvas.rows) continue;
      const dstIdx = dstRow * canvas.cols + dstCol;
      const ch = surfaceGrid.char[srcIdx] ?? " ";
      canvas.grid.char[dstIdx] = ch;
      canvas.grid.color[dstIdx] = surfaceGrid.color[srcIdx] ?? null;
      if (ch !== " ") canvas.ink[dstIdx] = 1;
    }
  }

  if (options.title) {
    canvas.text(Math.floor(width / 2), 0, [options.title], { align: "center", color: colorEnabled ? COLORBAR_TITLE_COLOR : undefined });
  }
  if (colorbarCols > 0) {
    // Fix round 4, Item 5 ("the colorbar sits at the far right edge,
    // disconnected"): place it relative to the surface's own ACTUAL
    // projected extent (`occupiedGridBounds`, measured on `surfaceGrid`
    // before chrome is pasted around it), not the nominal `plotCols`/
    // `plotRows` BUDGET — an orthographic fit maxes out whichever of
    // cols/rows binds first, so the OTHER axis routinely has real leftover
    // room the plot never uses (measured directly: the Maunga Whau fixture
    // at 96x32 left a 22-column gap between its own rightmost ink and a
    // colorbar pinned to the canvas's far edge). `swatchCol` sits exactly
    // `COLORBAR_GAP_COLS` past the surface's own rightmost occupied column;
    // the bar's own row band is vertically centred on the surface's own
    // occupied ROW range, not merely started at the plot's own top row.
    // Falls back to the OLD far-edge/top-row placement when the surface
    // painted nothing at all (an all-blank frame has no "actual extent" to
    // measure from).
    const bounds = occupiedGridBounds(surfaceGrid);
    const barRowsCount = Math.max(1, Math.min(colorLegend!.bands, plotRows));
    const labelWidth = colorbarLabelWidth(colorLegend!, plotRows);
    let swatchCol = width - 1;
    let colorbarY0 = plotY0;
    if (bounds) {
      // The LABEL right-aligns ENDING at `swatchCol - 1` and so spans
      // BACKWARD across its own full `labelWidth` — placing the gap only
      // before `labelCol` itself (the pre-fix version of this code) let a
      // wide label's own LEFT edge land ON or before the surface's own
      // rightmost occupied column whenever `labelWidth > COLORBAR_GAP_COLS`
      // (measured: a 4-character label at a 2-column gap overlapped the
      // surface's own max column by 1, printing colorbar digits into the
      // surface's own ink — caught by `render.test.ts`'s "byte-identical
      // PLOT REGION" test going red end-to-end, not merely at the tail).
      // The gap must clear the label's FULL width, not just its right edge.
      swatchCol = Math.min(width - 1, bounds.maxCol + COLORBAR_GAP_COLS + labelWidth + 1);
      const occupiedRowSpan = bounds.maxRow - bounds.minRow + 1;
      const idealY0 = plotY0 + bounds.minRow + Math.round((occupiedRowSpan - barRowsCount) / 2);
      colorbarY0 = Math.max(plotY0, Math.min(plotY0 + plotRows - barRowsCount, idealY0));
    }
    paintColorbar(canvas, colorLegend!, swatchCol, colorbarY0, plotRows, colorEnabled);
  }

  const text = color === "none" || color === "css"
    ? encodeGlyphCanvasText(canvas)
    : encodeGlyphCanvasAnsi(canvas, { colors: ansiColorMode(color), env: options.env });
  // `html` mirrors the 2D entry's simpler half only: present for `color:
  // "css"`. The 2D entry ALSO emits `html` for an ANSI mode once `textScale
  // > 1` (a web-only Density affordance, AGENTS.md's "Charts" "Density") —
  // 3D has no `textScale`, so that half of the rule never applies here.
  const html = color === "css" ? encodeGlyphCanvasHtml(canvas) : undefined;

  return {
    text,
    ...(html !== undefined ? { html } : {}),
    resolved: {
      target, charset, color, width, height, cellAspect,
      // Fix round 2, P1-c: `center` is ALWAYS reported (never conditionally
      // omitted at its own `[0.5, 0.5]` identity) — the whole point is that
      // `options.camera = result.resolved.camera` round-trips to the exact
      // same frame with no guessing about whether an omission meant
      // "default" or "forgotten."
      camera: {
        rotX, rotY, zoom, center,
        ...(useMat ? { mat: cameraOption.mat } : {}),
      },
      style,
    },
    report: { ledger },
    object,
  };
}

export interface GlyphChart3dJsonInput {
  readonly data: GlyphChart3dSurfaceData;
  /** Field-name channels only — an accessor function isn't JSON-representable. */
  readonly channels?: GlyphChart3dSurfaceChannels;
  readonly options?: GlyphChart3dSurfaceOptions;
}

/**
 * String-in/string-out entry mirroring `renderGlyphChartJson` (root
 * `json.ts`): `json` is a `GlyphChart3dJsonInput` (`{ data, channels?,
 * options? }` — the exact arguments `glyphChartSurface` itself takes,
 * packaged as one object for a caller with only a string to hand around),
 * `options` is the SAME `GlyphChart3dRenderOptions` the JS entry takes
 * (never embedded in the JSON — mirrors the root split). Returns `{ text,
 * html?, resolved, report }` on success (`object` — a `GlyphSceneObject`
 * carrying function-valued overlays — is NOT JSON-serializable and is
 * therefore omitted from this string exit, unlike the JS entry's own
 * result), `{ error, code, hint }` on a validation failure.
 */
export function renderGlyphChart3dJson(json: string, options: GlyphChart3dRenderOptions = {}): string {
  let input: GlyphChart3dJsonInput;
  try {
    input = JSON.parse(json) as GlyphChart3dJsonInput;
  } catch (e) {
    return JSON.stringify({ error: `invalid JSON: ${(e as Error).message}`, code: null, hint: "Pass a JSON-encoded { data, channels?, options? } surface input." });
  }
  try {
    const mark = glyphChartSurface(input.data, input.channels, input.options);
    const { object: _object, ...rest } = renderGlyphChart3d(mark, options);
    return JSON.stringify(rest);
  } catch (e) {
    const error = e as Error & { code?: string };
    const code = error.code ?? null;
    return JSON.stringify({ error: error.message, code, hint: (code ? glyphChart3dRepairHint(code) : undefined) ?? null });
  }
}
