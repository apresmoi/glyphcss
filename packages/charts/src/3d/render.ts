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
import { compileScene, createGlyphCanvas, createGlyphOrthographicCamera, encodeGlyphCanvasAnsi, encodeGlyphCanvasHtml, encodeGlyphCanvasText } from "glyphcss";
import type { CellGrid, GlyphAmbientLight, GlyphCanvas, GlyphDirectionalLight, GlyphSceneObject, Vec3 } from "glyphcss";
import { GLYPH_CHART_TARGET_DEFAULTS } from "../render";
import { glyphChartColorEnabled } from "../regionFill";
import type { GlyphChartCharset, GlyphChartColorMode, GlyphChartTarget } from "../types";
import { GLYPH_CHART_3D_DEFAULT_CAMERA } from "./camera";
import { glyphChart3dBandColor } from "./colorscale";
import { ledgerCharset3dBlocksUnsupported, ledgerCharset3dBrailleUnsupported, ledgerColorbarOmitted } from "./ledger";
import { glyphChartObject } from "./object";
import { glyphChartSurface } from "./surface";
import { chart3dError, glyphChart3dRepairHint } from "./validate";
import type {
  GlyphChart3dLedgerEntry, GlyphChart3dMark, GlyphChart3dSurfaceChannels, GlyphChart3dSurfaceData, GlyphChart3dSurfaceMark, GlyphChart3dSurfaceOptions,
} from "./types";

export interface GlyphChart3dCameraOptions {
  readonly rotX?: number;
  readonly rotY?: number;
  /** Omit for AUTO-FIT (the default — fits the whole object + its overlay labels on screen, PLAN-3d.md's C2 acceptance and fix round 1's P1-2). An explicit value opts out of auto-fit for THIS render's zoom only; `target` still auto-fits. */
  readonly zoom?: number;
}

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
}

export interface GlyphChart3dResolved {
  readonly target: GlyphChartTarget;
  readonly charset: GlyphChartCharset;
  readonly color: GlyphChartColorMode;
  readonly width: number;
  readonly height: number;
  readonly cellAspect: number;
  readonly camera: { readonly rotX: number; readonly rotY: number; readonly zoom: number };
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
const COLORBAR_COLS = 9;
const COLORBAR_MIN_PLOT_WIDTH = 24;
const COLORBAR_TITLE_COLOR = "#e5e7eb";
const zFormat = d3format("~r");

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
  else if (charset === "braille") ledger.push(ledgerCharset3dBrailleUnsupported());
}

/**
 * The canvas CHROME (title/colorbar) tier. `braille` degrades to `box` (no
 * braille glyphs anywhere in the 3D frame). `blocks` ALSO degrades to the
 * default `ascii` tier here (fix round 1, P1-4) — the geometry itself can
 * never actually render in halfblock (`resolveCharsetDegrade3d`'s own doc),
 * and letting the CHROME alone keep real half-block/quadrant swatch glyphs
 * while the geometry silently fell back would make a `blocks` frame
 * genuinely DIFFERENT bytes from an `ascii` one for a reason no ledger
 * entry explains — the matrix test's own "byte-identical to ascii" claim is
 * what makes the downgrade FAITHFUL rather than a half-measure.
 */
function chromeTier(charset: GlyphChartCharset): (typeof CANVAS_TIERS)[number] {
  return charset === "braille" || charset === "blocks" ? "ascii" : charset;
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

/** A vertical value-scale swatch strip at the canvas's own right edge — z max at the top, z min at the bottom, each row's shade AND colour reading its own band (monotone even with colour off, matching `shading: "value"`'s own discipline). Fix round 1 (P1-2): labels every band up to a legible cap, not just the two endpoints — a one-column colorbar with no intermediate reading is close to useless as a legend. */
function paintColorbar(canvas: GlyphCanvas, mark: GlyphChart3dSurfaceMark, y0: number, rowsAvailable: number, colorEnabled: boolean): void {
  const swatchCol = canvas.cols - 1;
  const labelCol = swatchCol - 1;
  const bands = mark.bands;
  const rows = Math.max(1, Math.min(bands, rowsAvailable));
  const anchors = mark.colorAnchors;
  const [zLo, zHi] = mark.axes.z.domain;
  const zSpan = zHi - zLo;
  const MAX_LABELS = 6;
  const labelEvery = rows <= MAX_LABELS ? 1 : Math.ceil((rows - 1) / (MAX_LABELS - 1));
  for (let i = 0; i < rows; i++) {
    const row = y0 + i;
    const bandIdx = rows === 1 ? bands - 1 : Math.round(((rows - 1 - i) * (bands - 1)) / (rows - 1));
    const shade = bands <= 1 ? 1 : bandIdx / (bands - 1);
    const swatchColor = anchors ? glyphChart3dBandColor(anchors, bandIdx, bands) : null;
    canvas.fillRect(swatchCol, row, swatchCol, row, { fill: { shade }, color: colorEnabled ? swatchColor : null });
    const isEndpoint = i === 0 || i === rows - 1;
    if (!isEndpoint && i % labelEvery !== 0) continue;
    const value = bands <= 1 ? zHi : zLo + (bandIdx / (bands - 1)) * zSpan;
    canvas.text(labelCol, row, [zFormat(value)], { align: "right", color: colorEnabled ? COLORBAR_TITLE_COLOR : undefined });
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

function renderObjectFrame(object: GlyphSceneObject, camera: ReturnType<typeof createGlyphOrthographicCamera>, cols: number, rows: number, cellAspect: number, useColors: boolean, lighting: ResolvedLighting): CellGrid {
  const result = compileScene({
    polygons: [],
    objects: [object],
    camera,
    cols,
    rows,
    cellAspect,
    mode: "solid",
    useColors,
    ...lighting,
  });
  // `objects` never requests `charMode: "halfblock"`/`"quadrant"` here (see
  // `resolveCharsetDegrade3d`), so `grid` is never `null`
  // (`CompileSceneResult.grid`'s own doc — `null` is exact to those two
  // charModes only).
  return result.grid!;
}

function occupiedBounds(grid: CellGrid): { minCol: number; maxCol: number; minRow: number; maxRow: number } | undefined {
  let minCol = Infinity, maxCol = -Infinity, minRow = Infinity, maxRow = -Infinity;
  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      if (grid.char[row * grid.cols + col] === " ") continue;
      if (col < minCol) minCol = col;
      if (col > maxCol) maxCol = col;
      if (row < minRow) minRow = row;
      if (row > maxRow) maxRow = row;
    }
  }
  return Number.isFinite(minCol) ? { minCol, maxCol, minRow, maxRow } : undefined;
}

// Mirrors `createGlyphCamera.ts`'s own `BASE_TILE` (a documented public
// default, `@glyphcss/diagrams/3d`'s `render3d.ts` cites the same constant
// for the identical reason: a headless render has no DOM to measure a real
// character cell from).
const BASE_TILE = 50;
const FIT_PROBE_COLS = 220, FIT_PROBE_ROWS = 130;
const FIT_MARGIN_COLS = 1, FIT_MARGIN_ROWS = 1;

/**
 * Auto-fit the static frame's default camera (fix round 1, P1-2): the
 * PREVIOUS cut fitted the mesh's expanded AABB only (`camera.ts`'s own
 * `glyphChart3dFitCamera`, kept unchanged below as the cheap, synchronous,
 * analytic pre-fit any scene consumer — e.g. a live orbit viewport's
 * INITIAL pose — can afford), which measured neither the projected overlay
 * labels (ticks, titles) nor the true glyph footprint those labels' own
 * TEXT occupies, so a short axis title routinely fell off-frame at several
 * rotations and the kept plot filled only ~5% of the requested cells at
 * common CLI sizes (80x24/96x32/140x40, all measured in the review).
 *
 * This renders TWICE, the same probe-then-scale technique
 * `@glyphcss/diagrams/3d`'s own D2 packet already shipped
 * (`render3d.ts`'s `fitCamera` — a node LABEL's cell width doesn't shrink
 * with zoom the way geometry does, so the only reliable source for "does
 * this actually fit" is rendering it and measuring the painted cells, not
 * an analytic estimate): pass 1 renders at a conservative, safely-small
 * probe zoom into a generous grid and measures the OCCUPIED cell box —
 * geometry AND every stamped tick/title glyph together, since they share
 * one `CellGrid`; pass 2 scales zoom by exactly the ratio needed to fill
 * `cols`x`rows` (minus a 1-cell margin) and recentres via `camera.center`
 * (an additive projection offset — `centerCol = cols * center[0]` — so no
 * rotation needs inverting, unlike moving `camera.target` would).
 */
function fitStaticCamera(object: GlyphSceneObject, rotX: number, rotY: number, cols: number, rows: number, cellAspect: number, useColors: boolean, lighting: ResolvedLighting): { readonly camera: ReturnType<typeof createGlyphOrthographicCamera>; readonly zoom: number } {
  const centroid = objectBoundsCenter(object.bounds);
  const makeCamera = (zoom: number, center: readonly [number, number]) => {
    const camera = createGlyphOrthographicCamera({ rotX, rotY, zoom, center: [center[0], center[1]] });
    camera.target = centroid;
    return camera;
  };

  const extentWorld = Math.max(
    object.bounds.max[0] - object.bounds.min[0],
    object.bounds.max[1] - object.bounds.min[1],
    object.bounds.max[2] - object.bounds.min[2],
    1,
  );
  const probeFramePx = Math.min(FIT_PROBE_COLS * (BASE_TILE / cellAspect), FIT_PROBE_ROWS * BASE_TILE);
  const probeZoom = Math.max(0.05, probeFramePx / (6 * extentWorld * Math.SQRT2));
  const probeCamera = makeCamera(probeZoom, [0.5, 0.5]);
  const probeGrid = renderObjectFrame(object, probeCamera, FIT_PROBE_COLS, FIT_PROBE_ROWS, cellAspect, useColors, lighting);
  const box = occupiedBounds(probeGrid);
  if (!box) return { camera: makeCamera(probeZoom, [0.5, 0.5]), zoom: probeZoom };

  const contentCols = box.maxCol - box.minCol + 1, contentRows = box.maxRow - box.minRow + 1;
  const availableCols = Math.max(1, cols - 2 * FIT_MARGIN_COLS), availableRows = Math.max(1, rows - 2 * FIT_MARGIN_ROWS);
  const scale = Math.min(availableCols / contentCols, availableRows / contentRows);
  const finalZoom = probeZoom * scale;

  const probeCenterCol = (box.minCol + box.maxCol + 1) / 2, probeCenterRow = (box.minRow + box.maxRow + 1) / 2;
  const dCol = (probeCenterCol - FIT_PROBE_COLS / 2) * scale, dRow = (probeCenterRow - FIT_PROBE_ROWS / 2) * scale;
  const center: [number, number] = [0.5 - dCol / cols, 0.5 - dRow / rows];
  return { camera: makeCamera(finalZoom, center), zoom: finalZoom };
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
  if (mark.type !== "surface") {
    throw new TypeError(`glyphcss: unknown 3D mark type ${JSON.stringify((mark as { type?: unknown }).type)}.`);
  }

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

  const cellAspect = options.cellAspect ?? defaults.cellAspect;
  if (typeof cellAspect !== "number" || !Number.isFinite(cellAspect) || cellAspect <= 0) {
    chart3dError("bad-render-options", `cellAspect must be a positive finite number, got ${JSON.stringify(options.cellAspect)}.`);
  }

  const cameraOption = options.camera ?? {};
  const rotX = cameraOption.rotX ?? GLYPH_CHART_3D_DEFAULT_CAMERA.rotX;
  const rotY = cameraOption.rotY ?? GLYPH_CHART_3D_DEFAULT_CAMERA.rotY;
  if (!Number.isFinite(rotX) || !Number.isFinite(rotY)) chart3dError("bad-camera", `camera.rotX/rotY must be finite numbers, got ${JSON.stringify(cameraOption)}.`);
  if (cameraOption.zoom !== undefined && (!Number.isFinite(cameraOption.zoom) || cameraOption.zoom <= 0)) {
    chart3dError("bad-camera", `camera.zoom must be a positive finite number, got ${JSON.stringify(cameraOption.zoom)}.`);
  }

  const ledger: GlyphChart3dLedgerEntry[] = [...mark.report.ledger];
  resolveCharsetDegrade3d(charset, ledger);
  const colorEnabled = glyphChartColorEnabled(color, options.env);
  const shading = resolveMarkShading(mark, colorEnabled);
  const lighting = lightingForShading(shading);

  const titleRows = options.title ? 1 : 0;
  const wantColorbar = mark.colorAnchors !== null;
  let colorbarCols = 0;
  if (wantColorbar) {
    if (width - COLORBAR_COLS >= COLORBAR_MIN_PLOT_WIDTH) colorbarCols = COLORBAR_COLS;
    else ledger.push(ledgerColorbarOmitted({ width, minWidth: COLORBAR_MIN_PLOT_WIDTH + COLORBAR_COLS }));
  }
  const plotCols = Math.max(1, width - colorbarCols);
  const plotRows = Math.max(1, height - titleRows);
  const plotY0 = titleRows;

  const object = mark.shading === shading ? glyphChartObject(mark) : glyphChartObject({ ...mark, shading });

  let camera: ReturnType<typeof createGlyphOrthographicCamera>;
  let zoom: number;
  if (cameraOption.zoom === undefined) {
    const fit = fitStaticCamera(object, rotX, rotY, plotCols, plotRows, cellAspect, colorEnabled, lighting);
    camera = fit.camera;
    zoom = fit.zoom;
  } else {
    zoom = cameraOption.zoom;
    camera = createGlyphOrthographicCamera({ rotX, rotY, zoom });
    camera.target = objectBoundsCenter(object.bounds);
  }

  const surfaceGrid = renderObjectFrame(object, camera, plotCols, plotRows, cellAspect, colorEnabled, lighting);

  const canvas = createGlyphCanvas({ cols: width, rows: height, tier: chromeTier(charset), cellAspect });
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
  if (colorbarCols > 0) paintColorbar(canvas, mark, plotY0, plotRows, colorEnabled);

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
    resolved: { target, charset, color, width, height, cellAspect, camera: { rotX, rotY, zoom } },
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
