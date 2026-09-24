/**
 * `renderGlyphDiagram3d`/`renderGlyphDiagram3dJson` (PLAN-3d.md §11, packet
 * D2; fixed round 1 per the codex review) — a STATIC FRAME through the same
 * scene rasterizer `createGlyphScene` uses, at a caller-given (or
 * auto-fit) camera. This is the export boundary the user approved for
 * terminal/chat/Copy ASCII/the CLI: no live orbit, no turntable (that stays
 * web-only, D3's own page), no effects (preview-only everywhere).
 *
 * P2-3 (fix round 1): routes through `compileScene({ objects })` (glyphcss,
 * packet F5b) instead of hand-rolling the overlay-flatten-arbiter pipeline
 * this module used to duplicate — `compileScene` composes an object's
 * overlays with the LIVE runtime's own exact semantics (contract 3,
 * AGENTS.md's "Compilation"), so this module has nothing of its own left to
 * drift from that contract. Only the PUBLIC `compileScene`
 * `{ objects, textureSamplers, grid, hotspots }` surface is used here — no
 * `compileScene` internals — per the fix round's own instruction, and a
 * `null` grid (a future charMode this module never requests) is handled
 * explicitly rather than assumed away.
 */
import {
  compileScene, createGlyphOrthographicCamera, createGlyphCanvas,
  encodeGlyphCanvasText, encodeGlyphCanvasAnsi, encodeGlyphCanvasHtml, foldGlyphOverlayLabelToAscii,
  type GlyphCamera, type GlyphSceneObject, type GlyphSceneOverlay, type Vec3, type RenderMode, type CellGrid,
  type GlyphDirectionalLight, type GlyphAmbientLight,
} from "glyphcss";
import { glyphGraphFromMermaid } from "../mermaid";
import { glyphGraphFromJson } from "../adapters";
import { glyphDiagramError, glyphDiagramRepairHint, parseGlyphDiagramJson } from "../validate";
import type { GlyphGraph } from "../types";
import type { GlyphDiagramLedgerEntry } from "../ledger";
import {
  glyphDiagramObject, glyphDiagram3dNodeSilhouettes, pickGlyphDiagram3dLabelPlacements,
  type GlyphDiagramObjectOptions, type GlyphDiagram3dScreenBox,
} from "./glyphDiagramObject";
import { layout3d, GLYPH_DIAGRAM_3D_CAMERA_ROT_X, GLYPH_DIAGRAM_3D_CAMERA_ROT_Y, type GlyphDiagram3dNode, type GlyphDiagram3dLayoutKind } from "./layout3d";
import {
  ledger3dArrowheadsSuppressed, ledger3dBlocksAnsiUnsupported, ledger3dCharsetDegraded, ledger3dLabelDropped, ledger3dLabelsSuppressed,
  ledger3dLabelUnfittable, ledger3dLayoutAutoForce,
} from "./ledger3d";

// D2 fix round 3, P1-2 (codex): the karate-club fixture (34 nodes, 78
// edges) at the default 96x32 is unreadable under the layered layout's
// dagre X/Y placement (designed for a shallow agent pipeline, not a dense
// social-network graph) and, even under force layout, drops several
// labels to genuine on-screen collisions. These three thresholds are the
// adaptive large-graph policy `renderGlyphDiagram3d` applies when the
// caller left the matching option unset — each is independently
// overridable (`layout`, `maxLabels`, `arrowheads`) and each automatic
// choice is reported in the ledger exactly once (`ledger3d.ts`'s own
// doc comments carry the per-choice rationale). Measured at 96x32: the
// karate-club fixture (34 nodes / 78 edges) crosses all three; the
// 4-node agent-supervisor reference graph crosses none, so this round's
// existing gates (byte-identity, the 4-node frame, seed-42) are
// unaffected by these defaults.
const GLYPH_DIAGRAM_3D_LARGE_GRAPH_NODE_THRESHOLD = 16;
const GLYPH_DIAGRAM_3D_MAX_AUTO_LABELS = 16;
const GLYPH_DIAGRAM_3D_EDGE_DENSITY_THRESHOLD = 40;

/**
 * Lighting for a static 3D diagram frame — LOWER ambient than a generic
 * scene default (D2 review P1-1: a flat-lit thin plate loses the contrast
 * between its top and side faces) — not exposed on
 * `GlyphDiagram3dRenderOptions` (the task's own input is graph + camera +
 * layout), but exported so a caller reproducing this frame in a live
 * `createGlyphScene` (or a byte-identity test) can pass the exact same
 * values.
 */
export const GLYPH_DIAGRAM_3D_LIGHT: GlyphDirectionalLight = { direction: [0.5, 0.8, 0.4], intensity: 0.95 };
export const GLYPH_DIAGRAM_3D_AMBIENT_LIGHT: GlyphAmbientLight = { intensity: 0.2 };

export type GlyphDiagram3dTarget = "chat" | "terminal" | "web";
export type GlyphDiagram3dCharset = "ascii" | "box" | "blocks" | "braille";
export type GlyphDiagram3dColorMode = "none" | "ansi16" | "ansi256" | "truecolor" | "css";

/**
 * `rotX`/`rotY` (degrees) or a trackball `mat` (AGENTS.md's numeric
 * conventions / orbit `pitchRange`+trackball contract) — never both; `mat`
 * wins when both are given. `zoom` omitted (the common case) triggers
 * auto-fit (see `fitDiagramCamera` below); an explicit `zoom` is used as-is,
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
  /**
   * D2 fix round 3, P1-2 (large-graph legibility): cap on how many node
   * labels are shown, ranked by degree (ties by id) — the same priority
   * a node's own label-arbiter candidate already uses. `undefined` (the
   * default) is ADAPTIVE: every label shows up to
   * `GLYPH_DIAGRAM_3D_MAX_AUTO_LABELS` nodes, and past that the choice
   * (and count) is reported via `3d-labels-suppressed`. An explicit
   * number always overrides the adaptive policy with no ledger entry
   * (the caller asked for exactly this); pass `Infinity` to force every
   * label on regardless of node count, or `0` to hide all of them.
   */
  readonly maxLabels?: number;
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

// D2 round 7 (user, verbatim: "we need to use braille and blocks for 3d
// diagrams") — the ONLY two 3D diagram charsets now. `web`/`terminal`
// default to `braille`; `chat` defaults to `blocks` (a chat client's own
// fenced-code font carries the Block Elements range but essentially never
// braille, AGENTS.md's "Targets and page"). Deliberately its OWN table,
// not `GLYPH_DIAGRAM_TARGET_DEFAULTS` (2D), since 2D's own hand-painted
// box-drawing canvas has a genuinely different default set.
const GLYPH_DIAGRAM_3D_TARGET_DEFAULTS: Readonly<Record<GlyphDiagram3dTarget, { width: number; height: number; charset: GlyphDiagram3dCharset; color: GlyphDiagram3dColorMode }>> = Object.freeze({
  chat: { width: 72, height: 24, charset: "blocks", color: "none" },
  terminal: { width: 80, height: 24, charset: "braille", color: "truecolor" },
  web: { width: 96, height: 32, charset: "braille", color: "css" },
});

/**
 * Exported so `/diagrams`' own live 3D viewport can derive the SAME
 * `mode`/`charMode` a static `renderGlyphDiagram3d` frame uses for a given
 * charset, rather than re-deriving (and risking drifting from) this table
 * on the page.
 */
export interface ResolvedCharset {
  readonly mode: RenderMode;
  readonly charMode: "braille" | "halfblock" | "quadrant";
  readonly hiddenLines: "show" | "hide";
  readonly ledger: GlyphDiagramLedgerEntry[];
}

/**
 * D2 round 7 — box-drawing/bar glyphs can't trace an edge or a box face at
 * an angle (the user's own reason for dropping them from 3D diagrams
 * entirely), so this function no longer resolves to `ascii`/`box` at all:
 * `"braille"` -> a real depth-tested WIREFRAME (`mode: "wireframe"` +
 * `charMode: "braille"`, 2x4 sub-cell dots at any angle), `hiddenLines:
 * "hide"` so an occluded object or back edge disappears rather than
 * drawing through it; `"blocks"` -> solid-shaded halfblock (`mode: "solid"`
 * + `charMode: "halfblock"`), where a box's own edges read from
 * FACE-CONTRAST Lambert shading rather than a drawn outline (D2 round 7's
 * own "box outlines come from the encoder itself" instruction — no more
 * hand-drawn box-outline overlay anywhere in this pipeline,
 * `glyphDiagramObject.ts`'s own top-of-file doc). An `"ascii"`/`"box"`
 * request DEGRADES to whichever of the two `target` actually supports
 * (`ledger3dCharsetDegraded`'s own doc has the exact destination table),
 * logged once.
 */
export function resolveCharset(charset: GlyphDiagram3dCharset, target: GlyphDiagram3dTarget): ResolvedCharset {
  if (charset === "braille") return { mode: "wireframe", charMode: "braille", hiddenLines: "hide", ledger: [] };
  if (charset === "blocks") return { mode: "solid", charMode: "halfblock", hiddenLines: "hide", ledger: [] };
  const renderedAs = target === "chat" ? "blocks" : "braille";
  const entry = ledger3dCharsetDegraded({ charset, target, renderedAs });
  return renderedAs === "blocks"
    ? { mode: "solid", charMode: "halfblock", hiddenLines: "hide", ledger: [entry] }
    : { mode: "wireframe", charMode: "braille", hiddenLines: "hide", ledger: [entry] };
}

function boundsCentroid(bounds: GlyphSceneObject["bounds"]): Vec3 {
  return [(bounds.min[0] + bounds.max[0]) / 2, (bounds.min[1] + bounds.max[1]) / 2, (bounds.min[2] + bounds.max[2]) / 2];
}

function boundsCorners(bounds: GlyphSceneObject["bounds"]): Vec3[] {
  const { min, max } = bounds;
  const pts: Vec3[] = [];
  for (const x of [min[0], max[0]]) for (const y of [min[1], max[1]]) for (const z of [min[2], max[2]]) pts.push([x, y, z]);
  return pts;
}

/**
 * Chrome-only object (no meshes): registers the title through the SAME
 * shared `GlyphLabelArbiter` `glyphDiagramObject`'s own overlay uses —
 * `compileScene({ objects })` composes every mounted object's overlays into
 * ONE ordered registry sharing one arbiter (AGENTS.md's "Scene objects"),
 * so a title mounted as its own tiny object competes fairly (and always
 * wins, `priority: Infinity`, matching 2D `paint.ts`'s own title candidate)
 * without this module reaching into the arbiter directly.
 */
function titleChromeObject(title: string): GlyphSceneObject {
  return {
    id: "glyph-diagram-3d-title",
    meshes: [],
    overlays: [{
      id: "title",
      stamp(grid, frame): void {
        frame.labels.place({ id: "title", priority: Number.POSITIVE_INFINITY, col: Math.max(0, Math.floor((frame.cols - title.length) / 2)), row: 0, text: title });
      },
    } satisfies GlyphSceneOverlay],
    bounds: { min: [0, 0, 0], max: [0, 0, 0] },
  };
}

interface RenderedFrame { readonly grid: CellGrid; }

function renderObjectFrame(objects: readonly GlyphSceneObject[], opts: { camera: GlyphCamera; cols: number; rows: number; cellAspect: number; mode: RenderMode; charMode: "braille" | "halfblock" | "quadrant"; hiddenLines: "show" | "hide" }): RenderedFrame {
  const result = compileScene({
    polygons: [], objects: objects as GlyphSceneObject[], camera: opts.camera, cols: opts.cols, rows: opts.rows, cellAspect: opts.cellAspect,
    mode: opts.mode, charMode: opts.charMode, hiddenLines: opts.hiddenLines, directionalLight: GLYPH_DIAGRAM_3D_LIGHT, ambientLight: GLYPH_DIAGRAM_3D_AMBIENT_LIGHT,
    glyphPalette: "default", useColors: true, smoothShading: false, creaseAngle: 60, doubleSided: false, supersample: 1,
  });
  // D2 round 7 — `halfblock` WITH this object's own label overlay mounted
  // now returns a real `grid` (glyphcss's own fix, AGENTS.md's "Render
  // modes"), so this used to guard against a `null` grid for exactly that
  // combination; `null` is unreachable here now (this module never
  // requests `quadrant`, the other charMode still allowed to return one),
  // kept as a defensive check rather than a silent `grid!`.
  if (!result.grid) glyphDiagramError("bad-options", "glyphcss: compileScene returned no grid for this render (unsupported charMode).");
  return { grid: result.grid };
}

interface FitLabel { readonly node: GlyphDiagram3dNode; readonly text: string; readonly anchor: Vec3; }

/**
 * The node's own front-face LEFT/RIGHT edge points (WORLD space, world Y
 * = the depth/extrusion axis every node box always uses now — D2 round
 * 7's own top-of-file doc in `glyphDiagramObject.ts`) — the SAME face
 * `resolveGlyphDiagram3dLabelPlacement`'s `"inside"` anchor sits on.
 */
function frontFaceEdges(node: GlyphDiagram3dNode): { readonly left: Vec3; readonly right: Vec3 } {
  const [hx, hy] = node.half;
  const y = node.center[1] - hy;
  return { left: [node.center[0] - hx, y, node.center[2]], right: [node.center[0] + hx, y, node.center[2]] };
}

/**
 * D2 round 6 — the node's own front-face REAL PROJECTED SCREEN WIDTH
 * (columns) at `zoom`, from a `zoom: 1` reference camera scaled linearly
 * (`resolveGlyphDiagram3dLabelPlacement`'s own doc has the "why this is
 * exact" derivation, reused here for a column DIFFERENCE rather than a
 * single point — the additive `center`/`centerCol` terms cancel in a
 * difference, so this is exact for ANY `center` the reference camera used).
 */
function frontFaceWidthCols(reference: GlyphCamera, node: GlyphDiagram3dNode, cols: number, rows: number, cellAspect: number, zoom: number): number {
  const { left, right } = frontFaceEdges(node);
  const [colL] = reference.project(left, cols, rows, cellAspect);
  const [colR] = reference.project(right, cols, rows, cellAspect);
  return Math.abs(colR - colL) * zoom;
}

/**
 * D2 review P1-2 (codex): auto-fit must work from PROJECTED geometry PLUS
 * FULL label extents BEFORE any clipping/arbitration — never from measuring
 * a rendered probe's painted cells, which can't distinguish "off-frame" from
 * "collided and dropped by the arbiter" (both read as simply absent).
 *
 * This is closed-form, not iterative: for an orthographic camera,
 * `col(zoom) = centerCol + (col1 - centerCol) * zoom` is EXACTLY linear in
 * `zoom` for a fixed rotation/target/center (`col1` = the projection at a
 * reference `zoom = 1`), so every "this point/label must land within
 * `[lo, hi]`" constraint reduces to one linear inequality in `zoom`. Taking
 * the tightest (`min`) upper bound across every one of the object's 8
 * bounds corners AND every node's own label anchor+text-width gives the
 * LARGEST zoom that keeps everything on screen with margin — computed once,
 * with no render, no probe, and therefore nothing an arbiter collision can
 * hide from it. A label whose own text is wider than the frame itself
 * (`text.length > availCols`) can never fit at ANY zoom — excluded from the
 * constraint set (so it can't force every other label toward zoom zero) and
 * reported via `ledger3dLabelUnfittable` instead.
 *
 * **D2 round 6 — a THREE-PASS solve, not one, to close the "labels overflow
 * their block" defect** (`resolveGlyphDiagram3dLabelPlacement`'s own doc has
 * the root cause: a node's WORLD-unit width is not its SCREEN-column width,
 * and the two only coincide at `zoom === cellPxW`, never guaranteed by an
 * auto-fit that typically zooms OUT to fit a whole multi-node layout).
 * PASS 1 solves with the OLD world-unit inside/side decision, purely to get
 * a reasonable zoom ESTIMATE. PASS 2 re-decides every node's placement from
 * its REAL projected screen width AT THAT ESTIMATE (a node whose world-unit
 * budget looked wide enough can genuinely be too narrow on screen, and now
 * falls back to `"side"` instead of silently overflowing) and re-solves —
 * this is the FINAL zoom, since PASS 2's constraint set is the true one an
 * "auto" mode should have used from the start. A FINAL re-clip pass then
 * re-derives every kept `"inside"` label's text against THAT true final
 * zoom (never pass 1's estimate) — pass 2's zoom can only be <= pass 1's
 * (a demoted node's `"side"` placement needs MORE margin, never less), so a
 * label clipped against the pass-1 estimate could still be a hair too wide
 * for the true final box; re-clipping against the real final zoom is what
 * makes "no inside-label glyph lands outside its node's projected front
 * face" an actual guarantee rather than a usual case. `glyphDiagramObject`'s
 * own overlay independently re-derives this SAME real screen width from the
 * frame's ACTUAL camera at stamp time (so it also stays correct under a
 * live-orbited view, where no auto-fit ran at all) — the two are proven to
 * compute the identical linear quantity (this file's own `frontFaceWidthCols`
 * doc), so they cannot predict a different landing cell for the same node.
 */
function fitDiagramCamera(object: GlyphSceneObject, nodes: readonly GlyphDiagram3dNode[], opts: {
  readonly cols: number; readonly rows: number; readonly cellAspect: number;
  readonly rotX?: number; readonly rotY?: number; readonly mat?: readonly number[];
  readonly explicitZoom?: number; readonly title?: string; readonly labelMode?: "inside" | "side" | "auto";
  readonly direction?: GlyphGraph["direction"]; readonly layoutKind?: GlyphDiagram3dLayoutKind;
}): { readonly camera: GlyphCamera; readonly fitLabels: readonly FitLabel[]; readonly unfittable: readonly FitLabel[]; readonly droppedBySide: readonly FitLabel[] } {
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

  const labelMode = opts.labelMode ?? "auto";
  const cols = opts.cols, rows = opts.rows;
  const reference = makeCamera(1, [0.5, 0.5]);
  // D2 round 8 — every node's own projected silhouette at the REFERENCE
  // camera (`zoom: 1`); the collision VERDICT `pickGlyphDiagram3dLabel
  // Placements` derives from it is invariant to the eventual real zoom
  // (`glyphDiagram3dNodeSilhouettes`' own doc), so this stays valid across
  // every `solve`/`resolveAll` pass below with no re-projection.
  const referenceSilhouettes = glyphDiagram3dNodeSilhouettes(nodes, reference, cols, rows, opts.cellAspect);

  if (opts.explicitZoom !== undefined) {
    const camera = makeCamera(opts.explicitZoom, [0.5, 0.5]);
    const explicitSilhouettes = glyphDiagram3dNodeSilhouettes(nodes, camera, cols, rows, opts.cellAspect);
    const picks = pickGlyphDiagram3dLabelPlacements(
      nodes, (node) => foldGlyphOverlayLabelToAscii(node.label.split("\n")[0] ?? node.id),
      labelMode, opts.direction, opts.layoutKind, camera, cols, rows, opts.cellAspect, explicitSilhouettes,
      (node) => frontFaceWidthCols(reference, node, cols, rows, opts.cellAspect, opts.explicitZoom!),
    );
    const fitLabels: FitLabel[] = [], droppedBySide: FitLabel[] = [];
    for (const node of nodes) {
      const pick = picks.get(node.id);
      if (!pick || pick.placement.text.length === 0) continue;
      const entry: FitLabel = { node, text: pick.placement.text, anchor: pick.placement.anchor };
      if (pick.dropped) droppedBySide.push(entry);
      else fitLabels.push(entry);
    }
    return { camera, fitLabels, unfittable: [], droppedBySide };
  }

  const marginCols = 1;
  const marginRowTop = opts.title ? 2 : 1, marginRowBottom = 1;
  const availCols = Math.max(1, cols - 2 * marginCols);
  const centerCol = cols / 2, centerRow = rows / 2;

  interface ColPoint { readonly col1: number; readonly widthRight: number; }
  interface RowPoint { readonly row1: number; }

  // Shared closed-form solve — bounds corners plus a resolved label set
  // (anchor + already-clipped text) — reused verbatim by every pass below,
  // never re-derived per pass.
  function solve(labels: readonly FitLabel[]): { readonly zoom: number; readonly center: [number, number] } {
    const colPoints: ColPoint[] = [], rowPoints: RowPoint[] = [];
    for (const corner of boundsCorners(object.bounds)) {
      const [col1, row1] = reference.project(corner, cols, rows, opts.cellAspect);
      colPoints.push({ col1, widthRight: 0 });
      rowPoints.push({ row1 });
    }
    for (const label of labels) {
      const [col1, row1] = reference.project(label.anchor, cols, rows, opts.cellAspect);
      colPoints.push({ col1, widthRight: label.text.length });
      rowPoints.push({ row1 });
    }
    let zUpper = Infinity;
    const EPS = 1e-9;
    for (const p of colPoints) {
      const offset = p.col1 - centerCol;
      if (offset > EPS) zUpper = Math.min(zUpper, (cols - marginCols - p.widthRight - centerCol) / offset);
      else if (offset < -EPS) zUpper = Math.min(zUpper, (marginCols - centerCol) / offset);
    }
    for (const p of rowPoints) {
      const offset = p.row1 - centerRow;
      if (offset > EPS) zUpper = Math.min(zUpper, (rows - marginRowBottom - centerRow) / offset);
      else if (offset < -EPS) zUpper = Math.min(zUpper, (marginRowTop - centerRow) / offset);
    }
    if (!Number.isFinite(zUpper) || zUpper <= 0) zUpper = 1; // degenerate (no geometry/labels at all) — any positive zoom is equally arbitrary
    const finalZoom = zUpper * 0.96; // rounding safety margin (labels/corners round to the nearest cell when stamped)

    // Recentre via `camera.center`, not `camera.target`: `col = centerCol +
    // r[0]*zoom/cellPxW` and `centerCol = cols*center[0]` is a pure ADDITIVE
    // offset in the already-rotated projection, so shifting `center` shifts
    // every projected column by the SAME amount with no rotation to invert —
    // shifting `target` instead moves the PRE-rotation input, which would
    // need the camera's own inverse rotation to solve for. Recentring after
    // `zUpper` is computed cannot break the fit it just proved: every point's
    // span already sat inside `[margin, size-margin]` at the ORIGINAL centre,
    // so its (unchanged) SPAN still fits once the whole content is shifted to
    // sit symmetrically within the same interval.
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
    const center: [number, number] = [0.5 - dCol / cols, 0.5 - dRow / rows];
    return { zoom: finalZoom, center };
  }

  /**
   * Resolve every node's label at a given (possibly zero, meaning "no
   * screen-width known yet") zoom, splitting into kept-vs-unfittable
   * against the frame's own `availCols` — plus, D2 round 8, dropped-by-
   * side (`pickGlyphDiagram3dLabelPlacements`' own verdict: no candidate
   * direction cleared every node's own silhouette AND every
   * higher-priority label already placed). Runs at `camera`/`silhouettes`
   * (default: the REFERENCE camera, for the fixed-point loop below, which
   * only needs a stable ESTIMATE) — see the loop's own doc for why the
   * FINAL call swaps in the real, final camera instead.
   */
  function resolveAll(
    zoomForWidth: number | undefined, camera: GlyphCamera = reference, silhouettes: ReadonlyMap<string, GlyphDiagram3dScreenBox> = referenceSilhouettes,
  ): { readonly kept: FitLabel[]; readonly unfittable: FitLabel[]; readonly droppedBySide: FitLabel[] } {
    const kept: FitLabel[] = [], unfittable: FitLabel[] = [], droppedBySide: FitLabel[] = [];
    const picks = pickGlyphDiagram3dLabelPlacements(
      nodes, (node) => foldGlyphOverlayLabelToAscii(node.label.split("\n")[0] ?? node.id),
      labelMode, opts.direction, opts.layoutKind, camera, cols, rows, opts.cellAspect, silhouettes,
      zoomForWidth === undefined ? undefined : (node) => frontFaceWidthCols(reference, node, cols, rows, opts.cellAspect, zoomForWidth),
    );
    for (const node of nodes) {
      const pick = picks.get(node.id);
      if (!pick || pick.placement.text.length === 0) continue;
      const fitEntry: FitLabel = { node, text: pick.placement.text, anchor: pick.placement.anchor };
      if (pick.dropped) droppedBySide.push(fitEntry);
      else if (pick.placement.text.length > availCols) unfittable.push(fitEntry);
      else kept.push(fitEntry);
    }
    return { kept, unfittable, droppedBySide };
  }

  // Bounded fixed-point loop, not a single 2-pass estimate: re-deciding a
  // node's placement from its REAL screen width can only ever DEMOTE it
  // (inside -> side, never the reverse) as the estimate's own zoom shrinks
  // across iterations — a demoted node's `"side"` placement needs MORE
  // margin than `"inside"` would have, so each iteration's solved zoom is
  // monotonically <= the previous one, and the sequence converges (bounded
  // below by the frame's own geometry-only fit).
  //
  // D2 round 8 — iterations 1+ re-derive `resolveAll`'s OWN picks at the
  // EXACT camera the CURRENT zoom/centre estimate implies — not the
  // zoom=1 REFERENCE camera iteration 0 bootstraps from — and the LAST
  // iteration's `solve` runs again after that exact-camera pass, so the
  // reported zoom/centre are fitted to the picks that will ACTUALLY render,
  // not to an estimate. The picker's collision verdict is invariant to
  // zoom/centre in EXACT real arithmetic (`glyphDiagram3dNodeSilhouettes`'s
  // own doc), but `pickGlyphDiagram3dLabelPlacements` rounds every
  // candidate to an INTEGER cell before testing it, and rounding is not
  // affine-invariant — two boundary values a hair apart in continuous
  // space can round to different cells at a different zoom/centre, and the
  // greedy reservation loop cascades that one flip through every
  // LOWER-priority node after it, changing which candidate side several
  // nodes land on. Bootstrapping from the reference camera alone (this
  // round's first cut) got the zoom close but not exact: a label's own
  // candidate could still differ between the reference-camera estimate
  // that fitted the zoom and the real-camera pass that rendered it,
  // occasionally pushing that one label's own text past the frame edge —
  // measured on the real LeNet-5 fixture (`"input 32x32x1"` at 96x32,
  //). Re-solving against the
  // EXACT camera's own picks removes the estimate entirely.
  let solved = solve(resolveAll(undefined).kept);
  let resolved = resolveAll(solved.zoom);
  for (let i = 0; i < 4; i++) {
    const camera = makeCamera(solved.zoom, solved.center);
    const silhouettes = glyphDiagram3dNodeSilhouettes(nodes, camera, cols, rows, opts.cellAspect);
    resolved = resolveAll(solved.zoom, camera, silhouettes);
    solved = solve(resolved.kept);
  }
  // One final pass at the LATEST solved zoom/centre (the loop's last
  // action was `solve`, so `resolved` still reflects the PREVIOUS
  // camera) — this is what actually ships.
  const finalCamera = makeCamera(solved.zoom, solved.center);
  const finalSilhouettes = glyphDiagram3dNodeSilhouettes(nodes, finalCamera, cols, rows, opts.cellAspect);
  resolved = resolveAll(solved.zoom, finalCamera, finalSilhouettes);

  return { camera: finalCamera, fitLabels: resolved.kept, unfittable: resolved.unfittable, droppedBySide: resolved.droppedBySide };
}

/**
 * D2 review P1-2's own repro ("Orchestrator vanished... with an empty
 * ledger"): the analytic fit proves every label's PREDICTED position
 * clears the margin, but the shared `GlyphLabelArbiter` can still refuse
 * one at render time — two labels genuinely colliding on screen from THIS
 * rotation, or a foreign mesh's `winnerMesh` covering one of its cells — a
 * real case no amount of geometry alone rules out in advance. Verify what
 * ACTUALLY landed against what was predicted and name every miss, rather
 * than trusting the fit's own prediction blindly. Shared by both charMode
 * branches below (braille reads a real `CellGrid`; blocks reads the
 * unescaped rendered LINES directly, `verifyLabelsLandedInLines`) so
 * neither branch re-derives its own verification logic.
 */
function verifyLabelsLanded(
  char: readonly string[], cols: number, rows: number, camera: GlyphCamera,
  resolved: { readonly width: number; readonly height: number }, cellAspect: number,
  fitLabels: readonly FitLabel[], ledger: GlyphDiagramLedgerEntry[],
): void {
  for (const label of fitLabels) {
    const [colF, rowF] = camera.project(label.anchor, resolved.width, resolved.height, cellAspect);
    const col = Math.round(colF), row = Math.round(rowF);
    let landed = col >= 0 && row >= 0 && row < rows && col + label.text.length <= cols;
    if (landed) {
      for (let i = 0; i < label.text.length; i++) {
        if (char[row * cols + col + i] !== label.text[i]) { landed = false; break; }
      }
    }
    if (!landed) ledger.push(ledger3dLabelDropped({ nodeId: label.node.id, label: label.text }));
  }
}

/** Same check as `verifyLabelsLanded`, reading fixed-width text LINES (the `blocks` charset's own exit — no `CellGrid` to read, `CompileSceneResult.grid`'s own doc) instead of a `char` array. */
function verifyLabelsLandedInLines(
  lines: readonly string[], cols: number, rows: number, camera: GlyphCamera,
  resolved: { readonly width: number; readonly height: number }, cellAspect: number,
  fitLabels: readonly FitLabel[], ledger: GlyphDiagramLedgerEntry[],
): void {
  for (const label of fitLabels) {
    const [colF, rowF] = camera.project(label.anchor, resolved.width, resolved.height, cellAspect);
    const col = Math.round(colF), row = Math.round(rowF);
    const landed = col >= 0 && row >= 0 && row < rows && col + label.text.length <= cols
      && lines[row] !== undefined && lines[row]!.slice(col, col + label.text.length) === label.text;
    if (!landed) ledger.push(ledger3dLabelDropped({ nodeId: label.node.id, label: label.text }));
  }
}

/** `compileScene`'s own `inner` is ALWAYS HTML-escaped (`escapeHtml(output)` even in the colourless case, since it's meant for embedding in a `<pre>`) — undo that for a plain-text exit (Copy ASCII, terminal paste), in entity-decode order (`&amp;` last, so `&amp;lt;` never double-unescapes into `<`). */
function unescapeHtmlText(s: string): string {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
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
  const { mode, charMode, hiddenLines, ledger: charsetLedger } = resolveCharset(resolved.charset, resolved.target);

  const camOpts = options.camera ?? {};
  if (camOpts.mat !== undefined && (camOpts.rotX !== undefined || camOpts.rotY !== undefined)) {
    glyphDiagramError("bad-options", "camera: pass either mat (trackball) or rotX/rotY (Euler), not both.");
  }
  // D2 round 7 — ONE fixed "3/4 isometric" camera for every graph,
  // regardless of its own 2D direction (TB/LR/BT/RL): `layout3d.ts`'s own
  // stage-by-stage triangulated layout picks the FLOW axis (world X for
  // LR/RL, world Z for TB/BT) and the two in-plane cross-section axes from
  // the direction itself, so the camera no longer needs to be analytically
  // solved against a shared plane's yaw (round 5/6's own derivation) —
  // `GLYPH_DIAGRAM_3D_CAMERA_ROT_X`/`_ROT_Y` are `layout3d.ts`'s own fixed,
  // empirically tuned constants (never a second, drifting copy).
  const rotX = camOpts.rotX ?? (camOpts.mat === undefined ? GLYPH_DIAGRAM_3D_CAMERA_ROT_X : undefined);
  const rotY = camOpts.rotY ?? (camOpts.mat === undefined ? GLYPH_DIAGRAM_3D_CAMERA_ROT_Y : undefined);
  const effectiveDirection = options.direction ?? graph.direction;

  const ledger: GlyphDiagramLedgerEntry[] = [...charsetLedger];

  // Adaptive large-graph policy (D2 fix round 3, P1-2) — decided from the
  // RAW input graph, before any layout runs: node/edge counts and degree
  // are topology, not layout output, so this never depends on (and never
  // needs to re-derive) which layout kind ends up chosen.
  const nodeCount = graph.nodes.length, edgeCount = graph.edges.length;
  const resolvedLayoutKind = options.layout ?? (nodeCount > GLYPH_DIAGRAM_3D_LARGE_GRAPH_NODE_THRESHOLD ? "force" : "layered");
  if (options.layout === undefined && resolvedLayoutKind === "force") {
    ledger.push(ledger3dLayoutAutoForce({ nodeCount, threshold: GLYPH_DIAGRAM_3D_LARGE_GRAPH_NODE_THRESHOLD }));
  }

  const degree = new Map<string, number>();
  for (const edge of graph.edges) {
    degree.set(edge.from, (degree.get(edge.from) ?? 0) + 1);
    degree.set(edge.to, (degree.get(edge.to) ?? 0) + 1);
  }
  const maxLabelsOption = options.maxLabels;
  let labelNodeIds: ReadonlySet<string> | undefined;
  if (maxLabelsOption === undefined) {
    if (nodeCount > GLYPH_DIAGRAM_3D_MAX_AUTO_LABELS) {
      const ranked = [...graph.nodes].sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      labelNodeIds = new Set(ranked.slice(0, GLYPH_DIAGRAM_3D_MAX_AUTO_LABELS).map((n) => n.id));
      ledger.push(ledger3dLabelsSuppressed({ total: nodeCount, kept: GLYPH_DIAGRAM_3D_MAX_AUTO_LABELS, threshold: GLYPH_DIAGRAM_3D_MAX_AUTO_LABELS }));
    }
  } else if (Number.isFinite(maxLabelsOption) && maxLabelsOption < nodeCount) {
    const cap = Math.max(0, Math.floor(maxLabelsOption));
    const ranked = [...graph.nodes].sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    labelNodeIds = new Set(ranked.slice(0, cap).map((n) => n.id));
  }
  const arrowheadsOption = options.arrowheads;
  const resolvedArrowheads = arrowheadsOption ?? edgeCount <= GLYPH_DIAGRAM_3D_EDGE_DENSITY_THRESHOLD;
  if (arrowheadsOption === undefined && !resolvedArrowheads) {
    ledger.push(ledger3dArrowheadsSuppressed({ edgeCount, threshold: GLYPH_DIAGRAM_3D_EDGE_DENSITY_THRESHOLD }));
  }
  const resolvedOptions: GlyphDiagram3dRenderOptions = { ...options, layout: resolvedLayoutKind };

  // The layout is computed ONCE here (for the auto-fit's own label/bounds
  // data) and AGAIN inside `glyphDiagramObject` (for its meshes/overlay) —
  // a deliberate duplication, not an oversight: `layout3d` is pure and
  // SEEDED (never `Date.now()`/`Math.random()`, AGENTS.md's Diagrams 3D
  // contract), so the two calls with the identical `graph`/`options`
  // produce a byte-identical layout, and keeping the fit's own "what
  // SHOULD render" data independent of the object-building path is what
  // makes the fit's own guarantee (every declared node/label fits) hold
  // regardless of how the object happens to be built. Both calls share
  // `resolvedOptions` — the SAME resolved `layout` kind the adaptive
  // policy above just decided, never each re-deriving it independently.
  const [object, layout] = await Promise.all([
    // `edgeRender` follows the RESOLVED mode: a wireframe traces lines, so
    // one degenerate face per segment is a real line there; a solid mode
    // has no area to shade from one and keeps the ribbon. An EXPLICIT
    // caller value wins — `"none"` (a conv-net slab stack, which has no
    // connectors at all) has no mode-derived equivalent to fall back to.
    glyphDiagramObject(graph, {
      ...resolvedOptions, labelNodeIds, arrowheads: resolvedArrowheads,
      edgeRender: resolvedOptions.edgeRender ?? (mode === "wireframe" ? "thin" : "ribbon"),
    }),
    layout3d(graph, resolvedOptions),
  ]);
  // D2 round 7 — every edge is now a straight 3D segment (no more 2D A*
  // routing at all, `layout3d.ts`'s own top-of-file doc), so this layout
  // can never report an `unroutable` edge; `layout.ledger` still carries
  // the 2D pipeline's own label-folding/group-membership entries, surfaced
  // here rather than silently dropped.
  ledger.push(...layout.ledger);

  // Auto-fit's own label constraint set is the SAME suppressed subset
  // (D2 fix round 3, P1-2) — a label `glyphDiagramObject` never places
  // must not consume any of the fit's own zoom budget, or the adaptive
  // suppression would buy nothing.
  const fitNodes = labelNodeIds ? layout.nodes.filter((n) => labelNodeIds.has(n.id)) : layout.nodes;
  const { camera, fitLabels, unfittable, droppedBySide } = fitDiagramCamera(object, fitNodes, {
    cols: resolved.width, rows: resolved.height, cellAspect, rotX, rotY, mat: camOpts.mat,
    explicitZoom: camOpts.zoom, title: options.title, labelMode: options.labels, direction: effectiveDirection,
    layoutKind: resolvedLayoutKind,
  });
  for (const label of unfittable) ledger.push(ledger3dLabelUnfittable({ nodeId: label.node.id, label: label.text, cols: resolved.width }));
  // D2 round 8 — no candidate side cleared every node's own silhouette at
  // ANY rotation this fit tried (`pickGlyphDiagram3dSidePlacement`'s own
  // doc); `glyphDiagramObject.ts`'s own overlay independently reaches the
  // identical verdict at render time and skips placing it, so this is
  // reported here rather than relying on `verifyLabelsLanded`'s own
  // after-the-fact diff (a label that was never a `fitLabel` is never
  // compared against the rendered grid at all).
  for (const label of droppedBySide) ledger.push(ledger3dLabelDropped({ nodeId: label.node.id, label: label.text }));

  const objects: GlyphSceneObject[] = options.title ? [object, titleChromeObject(options.title)] : [object];
  const colorMode = resolved.color;

  let text: string, html: string | undefined;
  if (charMode === "braille") {
    // Braille always returns a real `CellGrid` (an ordinary single-colour
    // wireframe pass, untouched by the D2 round 7 halfblock/quadrant merge
    // — AGENTS.md's "Render modes") — three exits over a real `GlyphCanvas`
    // reconstructed from it, so `encodeGlyphCanvasText`/`Ansi`/`Html` (the
    // tested, NO_COLOR/FORCE_COLOR-aware, HTML-escaping exits AGENTS.md's
    // "Targets and page" documents) apply, rather than `compileScene`'s own
    // `html`/`inner`, a browser-only exit with no ANSI/NO_COLOR concept.
    const { grid } = renderObjectFrame(objects, { camera, cols: resolved.width, rows: resolved.height, cellAspect, mode, charMode, hiddenLines });
    if (camOpts.zoom === undefined) verifyLabelsLanded(grid.char, grid.cols, grid.rows, camera, resolved, cellAspect, fitLabels, ledger);
    const canvas = createGlyphCanvas({ cols: resolved.width, rows: resolved.height, cellAspect, tier: "braille" });
    const colored = colorMode !== "none";
    for (let row = 0; row < grid.rows; row++) {
      for (let col = 0; col < grid.cols; col++) {
        const idx = row * grid.cols + col;
        const ch = grid.char[idx]!;
        if (ch === " ") continue;
        canvas.text(col, row, [ch], { color: colored ? (grid.color[idx] ?? null) : null });
      }
    }
    text = colorMode === "none" || colorMode === "css" ? encodeGlyphCanvasText(canvas) : encodeGlyphCanvasAnsi(canvas, { colors: colorMode === "ansi16" ? "16" : colorMode === "ansi256" ? "256" : "truecolor", env: options.env });
    html = colorMode === "css" ? encodeGlyphCanvasHtml(canvas) : undefined;
  } else {
    // `halfblock` (D2 round 7's "blocks" charset) paints TWO colours per
    // cell (fg+bg) — `compileScene`'s own `grid` is `null` for it (no
    // honest single-`CellGrid` representation, `CompileSceneResult.grid`'s
    // own doc), so there is no `CellGrid` to reconstruct a `GlyphCanvas`
    // from here. This exits through `compileScene`'s own `inner`/`html`
    // STRING output directly instead — the actual dual-colour render,
    // unescaped back to plain text for Copy ASCII/terminal paste (`inner`
    // is always HTML-escaped, even the colourless case, since it's meant
    // for embedding in a `<pre>`). The dual-colour encoder has NO ANSI
    // form (`AGENTS.md`'s own "Render modes" — `encodeGlyphBuffersDual`
    // emits `<span>` markup only), so an ANSI colour mode DEGRADES to
    // plain text for this charset, logged once.
    if (colorMode !== "none" && colorMode !== "css") ledger.push(ledger3dBlocksAnsiUnsupported({ color: colorMode }));
    const plain = compileScene({
      polygons: [], objects: objects as GlyphSceneObject[], camera, cols: resolved.width, rows: resolved.height, cellAspect,
      mode, charMode, hiddenLines, directionalLight: GLYPH_DIAGRAM_3D_LIGHT, ambientLight: GLYPH_DIAGRAM_3D_AMBIENT_LIGHT,
      glyphPalette: "default", useColors: false, smoothShading: false, creaseAngle: 60, doubleSided: false, supersample: 1,
    });
    const plainLines = unescapeHtmlText(plain.inner).split("\n");
    text = plainLines.join("\n");
    if (camOpts.zoom === undefined) verifyLabelsLandedInLines(plainLines, resolved.width, resolved.height, camera, resolved, cellAspect, fitLabels, ledger);
    if (colorMode === "css") {
      const colored = compileScene({
        polygons: [], objects: objects as GlyphSceneObject[], camera, cols: resolved.width, rows: resolved.height, cellAspect,
        mode, charMode, hiddenLines, directionalLight: GLYPH_DIAGRAM_3D_LIGHT, ambientLight: GLYPH_DIAGRAM_3D_AMBIENT_LIGHT,
        glyphPalette: "default", useColors: true, smoothShading: false, creaseAngle: 60, doubleSided: false, supersample: 1,
      });
      html = colored.html;
    }
  }

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
