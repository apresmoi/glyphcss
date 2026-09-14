/**
 * `renderGlyphDiagram3d`/`renderGlyphDiagram3dJson` (PLAN-3d.md §11, packet
 * D2) — a STATIC FRAME through the same scene rasterizer `createGlyphScene`
 * uses, at a caller-given (or auto-fit) camera. This is the export boundary
 * the user approved for terminal/chat/Copy ASCII/the CLI: no live orbit, no
 * turntable (that stays web-only, D3's own page), no effects (preview-only
 * everywhere).
 *
 * There is no DOM, no `createGlyphScene` — a scene needs an `HTMLElement`
 * host and `@glyphcss/compile`'s own Node-only contract rules that out for a
 * CLI/build-time export. Instead this composes the SAME public primitives
 * `compileScene` does (`buildRasterizeContext` + `rasterizeToCells`), plus
 * the generic `GlyphSceneObject` overlay contract (`stamp(grid, frame)`,
 * `createGlyphLabelArbiter`) `scene.addObject()` itself runs on
 * (`createGlyphScene.ts`'s `applyGlyphSceneObjectOverlays`) — so a
 * `glyphDiagramObject`'s edges/labels paint identically here and in a live
 * scene. What a static frame CANNOT do (AGENTS.md's "Compilation": "Static
 * compile takes a flat polygon list and cannot represent detail layers")
 * is separate a mesh into its own `<pre>` — `glyphDiagramObject`'s own
 * `groups` mesh (`transparent: true` for a layered floor plate, `mode:
 * "wireframe"` for a force cluster volume) WOULD detail-separate in a live
 * scene. This renderer flattens every mesh into ONE pass regardless
 * (exactly compileScene's own precedent), so "static frame equals live
 * frame" holds bit-for-bit only for a graph with no `groups` — documented,
 * not silently wrong: a grouped graph still renders, just without the
 * floor plate's own translucency/wireframe treatment a live scene would
 * give it its own layer for.
 */
import {
  createGlyphOrthographicCamera, createGlyphLabelArbiter, buildRasterizeContext, rasterizeToCells,
  createGlyphCanvas, encodeGlyphCanvasText, encodeGlyphCanvasAnsi, encodeGlyphCanvasHtml,
  type GlyphCamera, type CellGrid, type GlyphSceneObject, type GlyphOverlayFrame, type GlyphLabelArbiter,
  type Polygon, type Vec3, type RenderMode, type GlyphDirectionalLight, type GlyphAmbientLight,
} from "glyphcss";
import { glyphGraphFromMermaid } from "../mermaid";
import { glyphGraphFromJson } from "../adapters";
import { glyphDiagramError, glyphDiagramRepairHint, parseGlyphDiagramJson } from "../validate";
import type { GlyphGraph } from "../types";
import type { GlyphDiagramLedgerEntry } from "../ledger";
import { glyphDiagramObject, type GlyphDiagramObjectOptions } from "./glyphDiagramObject";
import { ledger3dCharsetDegraded, ledger3dContentOverflow } from "./ledger3d";

// Mirrors `createGlyphCamera.ts`'s own `BASE_TILE` — the CSS-px-per-cell
// fallback a headless render always uses (no DOM to measure a real
// character cell from). Not importable (module-private there), but it is a
// documented public DEFAULT (`cellPxW`/`cellPxH`'s own doc comment), so
// re-stating it here is citing a contract, not guessing a constant.
const BASE_TILE = 50;

/**
 * Fixed lighting for a static 3D diagram frame — not exposed on
 * `GlyphDiagram3dRenderOptions` (the task's own input is graph + camera +
 * layout, AGENTS.md's D2 packet scope), but exported so a caller
 * reproducing this frame in a live `createGlyphScene` (or a byte-identity
 * test) can pass the exact same values.
 */
export const GLYPH_DIAGRAM_3D_LIGHT: GlyphDirectionalLight = { direction: [0.4, 0.6, 0.7], intensity: 0.8 };
export const GLYPH_DIAGRAM_3D_AMBIENT_LIGHT: GlyphAmbientLight = { intensity: 0.5 };

export type GlyphDiagram3dTarget = "chat" | "terminal" | "web";
export type GlyphDiagram3dCharset = "ascii" | "box" | "blocks" | "braille";
export type GlyphDiagram3dColorMode = "none" | "ansi16" | "ansi256" | "truecolor" | "css";

/**
 * `rotX`/`rotY` (degrees) or a trackball `mat` (AGENTS.md's numeric
 * conventions / orbit `pitchRange`+trackball contract) — never both; `mat`
 * wins when both are given. `zoom` omitted (the common case) triggers
 * auto-fit (see `fitCamera` below); an explicit `zoom` is used as-is,
 * still centred on the object's own bounds.
 */
export interface GlyphDiagram3dCamera {
  readonly rotX?: number;
  readonly rotY?: number;
  readonly zoom?: number;
  readonly mat?: readonly number[];
}

export interface GlyphDiagram3dRenderOptions extends GlyphDiagramObjectOptions {
  readonly target?: GlyphDiagram3dTarget;
  readonly charset?: GlyphDiagram3dCharset;
  readonly color?: GlyphDiagram3dColorMode;
  readonly width?: number;
  readonly height?: number;
  readonly title?: string;
  readonly camera?: GlyphDiagram3dCamera;
  readonly cellAspect?: number;
  readonly env?: Readonly<Record<string, string | undefined>>;
}

export interface GlyphDiagram3dReport { readonly ledger: readonly GlyphDiagramLedgerEntry[] }

export interface GlyphDiagram3dResult {
  readonly text: string;
  readonly html?: string;
  /** The mounted object this frame rasterized — a caller can mount the SAME object in a live `createGlyphScene` for the orbitable view (D3's own page does exactly this). */
  readonly object: GlyphSceneObject;
  /** The RESOLVED camera (after auto-fit, when it ran) — `rotX`/`rotY`/`zoom`, or `mat` for a trackball camera. Re-usable verbatim as `options.camera` to reproduce this exact frame. */
  readonly camera: { readonly rotX?: number; readonly rotY?: number; readonly zoom: number; readonly mat?: readonly number[] };
  readonly report: GlyphDiagram3dReport;
}

// `braille`/`blocks` fall back to something 3D CAN actually draw (see
// `ledger3dCharsetDegraded`'s own doc) — deliberately its OWN table, not
// `GLYPH_DIAGRAM_TARGET_DEFAULTS` (2D): a solid Lambert-shaded scene wants
// `box`/`ascii` as its natural default everywhere, where 2D's own hand-painted
// box-drawing canvas defaults to braille on terminal/web for sub-cell edges.
const GLYPH_DIAGRAM_3D_TARGET_DEFAULTS: Readonly<Record<GlyphDiagram3dTarget, { width: number; height: number; charset: GlyphDiagram3dCharset; color: GlyphDiagram3dColorMode }>> = Object.freeze({
  chat: { width: 72, height: 24, charset: "box", color: "none" },
  terminal: { width: 80, height: 24, charset: "box", color: "truecolor" },
  web: { width: 96, height: 32, charset: "box", color: "css" },
});

interface ResolvedCharset { readonly mode: RenderMode; readonly charMode: "ascii" | "braille"; readonly ledger: GlyphDiagramLedgerEntry[] }

function resolveCharset(charset: GlyphDiagram3dCharset): ResolvedCharset {
  if (charset === "braille") return { mode: "wireframe", charMode: "braille", ledger: [ledger3dCharsetDegraded({ charset: "braille", renderedAs: "wireframe" })] };
  if (charset === "blocks") return { mode: "solid", charMode: "ascii", ledger: [ledger3dCharsetDegraded({ charset: "blocks", renderedAs: "ascii" })] };
  return { mode: "solid", charMode: "ascii", ledger: [] };
}

interface FlattenedObject { readonly polygons: Polygon[]; readonly polygonMeshIds: number[]; readonly ownMeshIds: ReadonlySet<number> }

function flattenObject(object: GlyphSceneObject): FlattenedObject {
  const polygons: Polygon[] = [];
  const polygonMeshIds: number[] = [];
  object.meshes.forEach((mesh, meshId) => { for (const p of mesh.polygons) { polygons.push(p); polygonMeshIds.push(meshId); } });
  return { polygons, polygonMeshIds, ownMeshIds: new Set(object.meshes.map((_, i) => i)) };
}

/**
 * Placing candidates through the SAME two-phase `place()`-then-resolve
 * contract `scene.addObject()` runs (`labelArbiter.ts`'s own doc: "nothing
 * paints until the scene calls `resolve(grid)`") is what keeps a static
 * frame's label declutter byte-identical to the live one — `resolve` isn't
 * on the PUBLIC `GlyphLabelArbiter` type (only `place` is; `resolve` is the
 * scene's own call), so this reaches it the same way
 * `glyphDiagramObject.test.ts`'s own gate already does.
 */
function resolveLabels(grid: CellGrid, arbiter: GlyphLabelArbiter): void {
  (arbiter as unknown as { resolve(grid: CellGrid): void }).resolve(grid);
}

interface FrameOptions {
  readonly camera: GlyphCamera;
  readonly cols: number;
  readonly rows: number;
  readonly cellAspect: number;
  readonly mode: RenderMode;
  readonly charMode: "ascii" | "braille";
  readonly title?: string;
}

/** One rasterize + overlay-stamp + label-resolve pass — the primitive both the auto-fit probe and the final frame run. */
function renderObjectGrid(object: GlyphSceneObject, opts: FrameOptions): CellGrid {
  const { polygons, polygonMeshIds, ownMeshIds } = flattenObject(object);
  const ctx = buildRasterizeContext({
    camera: opts.camera, grid: { cols: opts.cols, rows: opts.rows, cellAspect: opts.cellAspect },
    polygons, mode: opts.mode, directionalLight: GLYPH_DIAGRAM_3D_LIGHT, ambientLight: GLYPH_DIAGRAM_3D_AMBIENT_LIGHT,
    glyphPalette: "default", charMode: opts.charMode, useColors: true, smoothShading: false,
    creaseAngle: 60, doubleSided: false, supersample: 1,
    polygonMeshIds, retainWinnerMesh: opts.mode === "solid",
  });
  const grid = rasterizeToCells(ctx);
  const arbiter = createGlyphLabelArbiter();
  const frame: GlyphOverlayFrame = {
    camera: opts.camera, cols: opts.cols, rows: opts.rows, cellAspect: opts.cellAspect,
    layer: undefined, toWorld: (p) => p, ownMeshIds, labels: arbiter,
  };
  for (const overlay of object.overlays ?? []) overlay.stamp(grid, frame);
  if (opts.title) {
    // Chrome, not geometry — never hidden behind a mesh (no `ownMeshIds`),
    // and it wins every collision (2D diagram's own `paint.ts`:
    // `priority: Infinity` for its title candidate).
    arbiter.place({ id: "title", priority: Number.POSITIVE_INFINITY, col: Math.max(0, Math.floor((opts.cols - opts.title.length) / 2)), row: 0, text: opts.title });
  }
  resolveLabels(grid, arbiter);
  return grid;
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

function boundsCentroid(bounds: GlyphSceneObject["bounds"]): Vec3 {
  return [(bounds.min[0] + bounds.max[0]) / 2, (bounds.min[1] + bounds.max[1]) / 2, (bounds.min[2] + bounds.max[2]) / 2];
}

const AUTO_FIT_PROBE_COLS = 220, AUTO_FIT_PROBE_ROWS = 130;
const AUTO_FIT_MARGIN_COLS = 2, AUTO_FIT_MARGIN_ROWS = 1;

interface CameraFitOptions {
  readonly cols: number; readonly rows: number; readonly cellAspect: number;
  readonly rotX?: number; readonly rotY?: number; readonly mat?: readonly number[]; readonly explicitZoom?: number;
  readonly mode: RenderMode; readonly charMode: "ascii" | "braille"; readonly title?: string;
}

/**
 * Auto-fit (§11's D2 acceptance clause: "auto-fit zoom to the object's
 * `bounds` so every node box, edge and label is on-screen"). Two real
 * renders, not an analytic estimate: a node LABEL's cell width doesn't
 * shrink with zoom the way geometry does, so the only reliable source for
 * "does this actually fit" is rendering it and measuring the painted cells
 * — the same reason `compilePolygons`' own `autoFit` (`@glyphcss/compile`)
 * probes rather than computes. Pass 1 renders at a conservative, safely-
 * small probe zoom into a generous grid and measures the occupied cell
 * box; pass 2 scales zoom by exactly the ratio needed to fill the
 * REQUESTED `cols`x`rows` (minus a fixed margin) and recentres via
 * `camera.center` (`centerCol = cols * center[0]` is additive in the
 * projection, so this needs no rotation inverse — see the derivation
 * inline below) rather than moving `camera.target`, which would need one.
 */
function fitCamera(object: GlyphSceneObject, opts: CameraFitOptions): { camera: GlyphCamera; overflowed: boolean } {
  const centroid = boundsCentroid(object.bounds);
  const useMat = opts.mat !== undefined;
  const makeCamera = (zoom: number, center: [number, number]): GlyphCamera => {
    const camera = createGlyphOrthographicCamera({
      rotX: opts.rotX, rotY: opts.rotY, zoom, center,
      ...(useMat ? { mat: [...opts.mat!], useMat: true } : {}),
    });
    camera.target = centroid;
    return camera;
  };
  if (opts.explicitZoom !== undefined) return { camera: makeCamera(opts.explicitZoom, [0.5, 0.5]), overflowed: false };

  const extentWorld = Math.max(
    object.bounds.max[0] - object.bounds.min[0],
    object.bounds.max[1] - object.bounds.min[1],
    object.bounds.max[2] - object.bounds.min[2],
    1,
  );
  // Conservative: even a diagonal worst-case view (every axis contributing)
  // fits comfortably inside the probe frame's own CSS-px footprint.
  const probeFramePx = Math.min(AUTO_FIT_PROBE_COLS * (BASE_TILE / opts.cellAspect), AUTO_FIT_PROBE_ROWS * BASE_TILE);
  const probeZoom = Math.max(0.05, probeFramePx / (6 * extentWorld * Math.SQRT2));
  const probeCamera = makeCamera(probeZoom, [0.5, 0.5]);
  const probeGrid = renderObjectGrid(object, { camera: probeCamera, cols: AUTO_FIT_PROBE_COLS, rows: AUTO_FIT_PROBE_ROWS, cellAspect: opts.cellAspect, mode: opts.mode, charMode: opts.charMode, title: opts.title });
  const box = occupiedBounds(probeGrid);
  if (!box) return { camera: makeCamera(probeZoom, [0.5, 0.5]), overflowed: false }; // nothing painted (an empty graph)

  const contentCols = box.maxCol - box.minCol + 1, contentRows = box.maxRow - box.minRow + 1;
  const availableCols = Math.max(1, opts.cols - 2 * AUTO_FIT_MARGIN_COLS), availableRows = Math.max(1, opts.rows - 2 * AUTO_FIT_MARGIN_ROWS);
  const scale = Math.min(availableCols / contentCols, availableRows / contentRows);
  const finalZoom = probeZoom * scale;

  // Recentre via `camera.center`, not `camera.target`: `col = centerCol +
  // r[0]*zoom/cellPxW` and `centerCol = cols*center[0]` is a pure ADDITIVE
  // offset, so shifting `center` shifts every projected column by the SAME
  // amount with no rotation to invert (shifting `target` instead moves the
  // pre-rotation input, which needs undoing the camera's own rotation).
  const probeCenterCol = (box.minCol + box.maxCol + 1) / 2, probeCenterRow = (box.minRow + box.maxRow + 1) / 2;
  const dCol = (probeCenterCol - AUTO_FIT_PROBE_COLS / 2) * scale, dRow = (probeCenterRow - AUTO_FIT_PROBE_ROWS / 2) * scale;
  const center: [number, number] = [0.5 - dCol / opts.cols, 0.5 - dRow / opts.rows];
  const finalCamera = makeCamera(finalZoom, center);

  const finalGrid = renderObjectGrid(object, { camera: finalCamera, cols: opts.cols, rows: opts.rows, cellAspect: opts.cellAspect, mode: opts.mode, charMode: opts.charMode, title: opts.title });
  const finalBox = occupiedBounds(finalGrid);
  const overflowed = !!finalBox && (finalBox.minCol < 0 || finalBox.maxCol >= opts.cols || finalBox.minRow < 0 || finalBox.maxRow >= opts.rows);
  return { camera: finalCamera, overflowed };
}

function resolvedTargetOptions(options: GlyphDiagram3dRenderOptions): { target: GlyphDiagram3dTarget; width: number; height: number; charset: GlyphDiagram3dCharset; color: GlyphDiagram3dColorMode } {
  const target = options.target ?? "web";
  if (!["chat", "terminal", "web"].includes(target)) glyphDiagramError("bad-options", "target must be chat, terminal, or web.");
  const defaults = GLYPH_DIAGRAM_3D_TARGET_DEFAULTS[target];
  const result = { target, width: options.width ?? defaults.width, height: options.height ?? defaults.height, charset: options.charset ?? defaults.charset, color: options.color ?? defaults.color };
  if (![result.width, result.height].every((v) => Number.isInteger(v) && v > 0)) glyphDiagramError("bad-size", "width and height must be positive integers.");
  if (!["ascii", "box", "blocks", "braille"].includes(result.charset)) glyphDiagramError("bad-options", "charset must be ascii, box, blocks, or braille.");
  if (!["none", "ansi16", "ansi256", "truecolor", "css"].includes(result.color)) glyphDiagramError("bad-options", "color must be none, ansi16, ansi256, truecolor, or css.");
  if (options.title !== undefined && typeof options.title !== "string") glyphDiagramError("bad-options", "title must be a string.");
  return result;
}

export async function renderGlyphDiagram3d(input: GlyphGraph | string, options: GlyphDiagram3dRenderOptions = {}): Promise<GlyphDiagram3dResult> {
  const resolved = resolvedTargetOptions(options);
  const cellAspect = options.cellAspect ?? 2.0;
  const graph = typeof input === "string" ? glyphGraphFromMermaid(input) : glyphGraphFromJson(input);
  const object = await glyphDiagramObject(graph, options);
  const { mode, charMode, ledger: charsetLedger } = resolveCharset(resolved.charset);

  const camOpts = options.camera ?? {};
  if (camOpts.mat !== undefined && (camOpts.rotX !== undefined || camOpts.rotY !== undefined)) {
    glyphDiagramError("bad-options", "camera: pass either mat (trackball) or rotX/rotY (Euler), not both.");
  }
  const rotX = camOpts.rotX ?? (camOpts.mat === undefined ? 55 : undefined);
  const rotY = camOpts.rotY ?? (camOpts.mat === undefined ? 35 : undefined);

  const ledger: GlyphDiagramLedgerEntry[] = [...charsetLedger];
  const { camera, overflowed } = fitCamera(object, {
    cols: resolved.width, rows: resolved.height, cellAspect, rotX, rotY, mat: camOpts.mat,
    explicitZoom: camOpts.zoom, mode, charMode, title: options.title,
  });
  if (overflowed) ledger.push(ledger3dContentOverflow({ cols: resolved.width, rows: resolved.height }));

  const grid = renderObjectGrid(object, { camera, cols: resolved.width, rows: resolved.height, cellAspect, mode, charMode, title: options.title });

  // Same three exits 2D diagrams use, over a real `GlyphCanvas` instead of a
  // bare `CellGrid` — `encodeGlyphCanvasText`/`Ansi`/`Html` are the tested,
  // NO_COLOR/FORCE_COLOR-aware, HTML-escaping exits AGENTS.md's "Targets and
  // page" documents; a bare `CellGrid` string has neither (see this file's
  // own top-of-file doc for why this renders through them instead of
  // `compileScene`'s own `rasterize()`, which returns unescaped HTML).
  const canvas = createGlyphCanvas({ cols: resolved.width, rows: resolved.height, cellAspect, tier: resolved.charset === "blocks" ? "box" : resolved.charset === "braille" ? "braille" : resolved.charset });
  const colored = resolved.color !== "none";
  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      const idx = row * grid.cols + col;
      const ch = grid.char[idx]!;
      if (ch === " ") continue;
      canvas.text(col, row, [ch], { color: colored ? (grid.color[idx] ?? null) : null });
    }
  }
  const colorMode = resolved.color;
  const text = colorMode === "none" || colorMode === "css" ? encodeGlyphCanvasText(canvas) : encodeGlyphCanvasAnsi(canvas, { colors: colorMode === "ansi16" ? "16" : colorMode === "ansi256" ? "256" : "truecolor", env: options.env });
  const html = colorMode === "css" ? encodeGlyphCanvasHtml(canvas) : undefined;

  return {
    text, ...(html === undefined ? {} : { html }), object,
    camera: { rotX: camera.useMat ? undefined : camera.rotX, rotY: camera.useMat ? undefined : camera.rotY, zoom: camera.zoom, mat: camera.useMat ? (camera.mat ?? undefined) : undefined },
    report: { ledger },
  };
}

export async function renderGlyphDiagram3dJson(json: string, options: GlyphDiagram3dRenderOptions = {}): Promise<string> {
  try {
    const result = await renderGlyphDiagram3d(glyphGraphFromJson(parseGlyphDiagramJson(json)), options);
    return JSON.stringify({ text: result.text, ...(result.html === undefined ? {} : { html: result.html }), camera: result.camera, report: result.report });
  } catch (e) {
    const error = e as Error & { code?: string };
    return JSON.stringify({ error: error.message, code: error.code ?? null, hint: error.code ? glyphDiagramRepairHint(error.code) : "Pass a JSON object with nodes and edges arrays." });
  }
}
