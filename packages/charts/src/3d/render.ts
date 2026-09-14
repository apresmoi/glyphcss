/**
 * `renderGlyphChart3d`/`renderGlyphChart3dJson` — the C2 static-frame exit
 * for `@glyphcss/charts/3d` (PLAN-3d.md §11's C2 row, AGENTS.md's "Charts
 * 3D"). The user-approved export boundary (PLAN-3d.md §3): terminal, chat,
 * Copy ASCII and the CLI get a STATIC FRAME at the current camera — there is
 * no live orbit here, that is `/charts`' own web viewport (C3) — and
 * effects are out of scope for this packet.
 *
 * The frame is built with NO scene, NO DOM and NO `compileScene` object
 * support (that contract, PLAN-3d.md's F5, hasn't landed on this branch
 * yet) — instead this drives `glyphcss`'s own `buildRasterizeContext` +
 * `rasterize` directly, with a `transformCells` hook that runs the chart
 * object's OWN overlays (through the exact `GlyphOverlayFrame`/
 * `GlyphLabelArbiter` contract `createGlyphScene`'s own overlay registry
 * uses, AGENTS.md's "Scene objects") before capturing the resulting
 * `CellGrid` — so this is byte-identical to what a real scene would
 * produce for the SAME camera and object (`render.test.ts`'s own gate).
 * `GLYPH_CHART_TARGET_DEFAULTS`/`glyphChartColorEnabled` are reused
 * directly from the root package (relative import — this file is the ONE
 * direction PLAN-3d.md's root/3d isolation allows: 3D sharing the 2D
 * vocabulary, never the reverse, `rootIsolation.test.ts`).
 */
import { format as d3format } from "d3-format";
import {
  buildCellGrid, buildRasterizeContext, createGlyphCanvas, createGlyphLabelArbiter, createGlyphOrthographicCamera,
  encodeGlyphCanvasAnsi, encodeGlyphCanvasHtml, encodeGlyphCanvasText, rasterize,
} from "glyphcss";
import type { CellGrid, GlyphCanvas, GlyphOverlayFrame, GlyphSceneOverlay, Polygon, TextureSampler, Vec3 } from "glyphcss";
import { GLYPH_CHART_TARGET_DEFAULTS } from "../render";
import { glyphChartColorEnabled } from "../regionFill";
import type { GlyphChartCharset, GlyphChartColorMode, GlyphChartTarget } from "../types";
import { GLYPH_CHART_3D_DEFAULT_CAMERA, glyphChart3dFitCamera } from "./camera";
import { glyphChart3dBandColor } from "./colorscale";
import { ledgerCharset3dBrailleUnsupported, ledgerColorbarOmitted } from "./ledger";
import { glyphChartObject } from "./object";
import { glyphChartSurface } from "./surface";
import { chart3dError, glyphChart3dRepairHint } from "./validate";
import type {
  GlyphChart3dLedgerEntry, GlyphChart3dMark, GlyphChart3dSurfaceChannels, GlyphChart3dSurfaceData, GlyphChart3dSurfaceMark, GlyphChart3dSurfaceOptions,
} from "./types";

export interface GlyphChart3dCameraOptions {
  readonly rotX?: number;
  readonly rotY?: number;
  /** Omit for AUTO-FIT (the default — fits the whole object + its axis labels on screen, PLAN-3d.md's C2 acceptance). An explicit value opts out of auto-fit for THIS render's zoom only; `target` still auto-fits. */
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
 * Charset -> `RasterizeContextOptions.charMode` (PLAN-3d.md's "Charset
 * mapping for 3D"): `ascii`/`box` share the default ASCII solid ramp (there
 * is no distinct box-drawing SOLID mode in glyphcss — that vocabulary is the
 * 2D cell canvas's own tier system); `blocks` gets the two-colour-per-cell
 * `halfblock` encoder; `braille` is wireframe-only in glyphcss (AGENTS.md's
 * "Render modes"), so a 3D (always-solid) chart DOWNGRADES it to the
 * default ramp with a ledger entry rather than silently ignoring the
 * request or throwing.
 */
function resolveCharMode3d(charset: GlyphChartCharset, ledger: GlyphChart3dLedgerEntry[]): "halfblock" | undefined {
  if (charset === "blocks") return "halfblock";
  if (charset === "braille") { ledger.push(ledgerCharset3dBrailleUnsupported()); return undefined; }
  return undefined;
}

/** The canvas CHROME (title/colorbar) tier — independent of the solid rasterizer's own `charMode`; `braille` downgrades to `box` here too (no braille glyphs in the 3D frame at all). */
function chromeTier(charset: GlyphChartCharset): (typeof CANVAS_TIERS)[number] {
  return charset === "braille" ? "box" : charset;
}

function cloneCellGridFields(g: CellGrid): CellGrid {
  return buildCellGrid(
    g.char, g.color, g.depth, g.cols, g.rows,
    g.surfaceUv ?? null, g.shade ?? null, g.worldPosition ?? null, g.normal ?? null,
    g.winnerPolygon ?? null, g.albedoRgb ?? null, g.targetRgb ?? null, g.weight ?? null,
    g.objectPosition ?? null, g.objectExit ?? null, g.winnerMesh ?? null, g.objectNormal ?? null,
  );
}

interface RasterizeSurfaceOptions {
  readonly polygons: readonly Polygon[];
  readonly overlays: readonly GlyphSceneOverlay[];
  readonly textureSamplers?: ReadonlyMap<string, TextureSampler>;
  readonly camera: ReturnType<typeof createGlyphOrthographicCamera>;
  readonly cols: number;
  readonly rows: number;
  readonly cellAspect: number;
  readonly useColors: boolean;
  readonly charMode?: "halfblock";
  readonly directionalLight?: { readonly direction: Vec3; readonly intensity: number };
  readonly ambientLight?: { readonly intensity: number };
}

/**
 * Renders `polygons` + `overlays` to a `CellGrid`, with the overlays run
 * through the SAME `GlyphOverlayFrame`/`GlyphLabelArbiter` contract
 * `createGlyphScene`'s own overlay registry drives (`applyGlyphSceneObjectOverlays`,
 * AGENTS.md's "Scene objects") — no scene, no DOM. Mirrors `rasterizeToCells`'s
 * own capture-and-clone technique (`glyphcss`'s `render/rasterize.ts`), with
 * the object's overlays chained AHEAD of the capture rather than after it.
 */
function rasterizeSurfaceToCells(opts: RasterizeSurfaceOptions): CellGrid {
  const arbiter = createGlyphLabelArbiter();
  const overlays = [...opts.overlays].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  let captured: CellGrid | null = null;
  const ctx = buildRasterizeContext({
    camera: opts.camera,
    grid: { cols: opts.cols, rows: opts.rows, cellAspect: opts.cellAspect },
    polygons: [...opts.polygons],
    mode: "solid",
    useColors: opts.useColors,
    charMode: opts.charMode,
    ...(opts.directionalLight ? { directionalLight: opts.directionalLight } : {}),
    ...(opts.ambientLight ? { ambientLight: opts.ambientLight } : {}),
    ...(opts.textureSamplers ? { textureSamplers: opts.textureSamplers } : {}),
    transformCells: (grid) => {
      const frame: GlyphOverlayFrame = {
        camera: opts.camera,
        cols: grid.cols,
        rows: grid.rows,
        cellAspect: opts.cellAspect,
        layer: undefined,
        toWorld: (p) => p,
        // A single mounted object with a single mesh never hides behind a
        // FOREIGN mesh (there is none) — no `retainWinnerMesh` request, so
        // `grid.winnerMesh` never exists and the arbiter's own occlusion
        // check is inert regardless of this set's contents.
        ownMeshIds: new Set<number>(),
        labels: arbiter,
      };
      for (const overlay of overlays) overlay.stamp(grid, frame);
      arbiter.resolve(grid);
      captured = cloneCellGridFields(grid);
      return grid;
    },
  });
  rasterize(ctx);
  if (captured) return captured;
  const n = opts.cols * opts.rows;
  return buildCellGrid(new Array(n).fill(" "), null, null, opts.cols, opts.rows);
}

function pasteCellGrid(canvas: GlyphCanvas, src: CellGrid, x0: number, y0: number): void {
  for (let r = 0; r < src.rows; r++) {
    for (let c = 0; c < src.cols; c++) {
      const srcIdx = r * src.cols + c;
      const dstCol = x0 + c, dstRow = y0 + r;
      if (dstCol < 0 || dstCol >= canvas.cols || dstRow < 0 || dstRow >= canvas.rows) continue;
      const dstIdx = dstRow * canvas.cols + dstCol;
      const ch = src.char[srcIdx] ?? " ";
      canvas.grid.char[dstIdx] = ch;
      canvas.grid.color[dstIdx] = src.color[srcIdx] ?? null;
      if (ch !== " ") canvas.ink[dstIdx] = 1;
    }
  }
}

/** A vertical value-scale swatch strip at the canvas's own right edge — z max at the top, z min at the bottom, each row's shade AND colour reading its own band (monotone even with colour off, matching `shading: "value"`'s own discipline). */
function paintColorbar(canvas: GlyphCanvas, mark: GlyphChart3dSurfaceMark, y0: number, rowsAvailable: number, colorEnabled: boolean): void {
  const swatchCol = canvas.cols - 1;
  const labelCol = swatchCol - 1;
  const bands = mark.bands;
  const rows = Math.max(1, Math.min(bands, rowsAvailable));
  const anchors = mark.colorAnchors;
  for (let i = 0; i < rows; i++) {
    const row = y0 + i;
    const bandIdx = rows === 1 ? bands - 1 : Math.round(((rows - 1 - i) * (bands - 1)) / (rows - 1));
    const shade = bands <= 1 ? 1 : bandIdx / (bands - 1);
    const swatchColor = anchors ? glyphChart3dBandColor(anchors, bandIdx, bands) : null;
    canvas.fillRect(swatchCol, row, swatchCol, row, { fill: { shade }, color: colorEnabled ? swatchColor : null });
  }
  const [zLo, zHi] = mark.axes.z.domain;
  canvas.text(labelCol, y0, [zFormat(zHi)], { align: "right", color: colorEnabled ? COLORBAR_TITLE_COLOR : undefined });
  canvas.text(labelCol, y0 + rows - 1, [zFormat(zLo)], { align: "right", color: colorEnabled ? COLORBAR_TITLE_COLOR : undefined });
}

function objectBoundsCenter(bounds: { readonly min: Vec3; readonly max: Vec3 }): Vec3 {
  return [(bounds.min[0] + bounds.max[0]) / 2, (bounds.min[1] + bounds.max[1]) / 2, (bounds.min[2] + bounds.max[2]) / 2];
}

/**
 * `renderGlyphChart3d(mark, options)` — a static frame of `mark` (a
 * `glyphChartSurface` result, mirroring `glyphChartObject`'s own `(mark,
 * options)` shape) at the resolved target/charset/color/camera, through the
 * same `text`/`html` exits the 2D entry uses. Auto-fits the default camera
 * to the object's own bounds (`glyphChart3dFitCamera`) so the whole surface
 * and all three axis labels are on screen with no explicit camera.
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
  const charMode = resolveCharMode3d(charset, ledger);
  const colorEnabled = glyphChartColorEnabled(color, options.env);

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

  const object = glyphChartObject(mark);

  let zoom = cameraOption.zoom;
  let cameraTarget: Vec3;
  if (zoom === undefined) {
    const fit = glyphChart3dFitCamera({ bounds: object.bounds, rotX, rotY, cols: plotCols, rows: plotRows, cellAspect });
    zoom = fit.zoom;
    cameraTarget = fit.target;
  } else {
    cameraTarget = objectBoundsCenter(object.bounds);
  }
  const camera = createGlyphOrthographicCamera({ rotX, rotY, zoom });
  camera.target = cameraTarget;

  const lighting = mark.shading === "value"
    ? { directionalLight: { direction: [0.5, 0.7, 0.5] as Vec3, intensity: 0 }, ambientLight: { intensity: 1 } }
    : {};

  const surfaceGrid = rasterizeSurfaceToCells({
    polygons: object.meshes[0]!.polygons,
    overlays: object.overlays ?? [],
    textureSamplers: object.textureSamplers,
    camera,
    cols: plotCols,
    rows: plotRows,
    cellAspect,
    useColors: colorEnabled,
    charMode,
    ...lighting,
  });

  const canvas = createGlyphCanvas({ cols: width, rows: height, tier: chromeTier(charset), cellAspect });
  pasteCellGrid(canvas, surfaceGrid, 0, plotY0);

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
 * html?, resolved, report }` on success, `{ error, code, hint }` on a
 * validation failure.
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
    return JSON.stringify(renderGlyphChart3d(mark, options));
  } catch (e) {
    const error = e as Error & { code?: string };
    const code = error.code ?? null;
    return JSON.stringify({ error: error.message, code, hint: (code ? glyphChart3dRepairHint(code) : undefined) ?? null });
  }
}
