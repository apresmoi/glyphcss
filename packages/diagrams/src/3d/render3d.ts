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
  type GlyphCamera, type GlyphSceneObject, type GlyphSceneOverlay, type Vec3, type RenderMode,
  type GlyphDirectionalLight, type GlyphAmbientLight, type GlyphCanvasTierName, type CellGrid,
} from "glyphcss";
import { glyphGraphFromMermaid } from "../mermaid";
import { glyphGraphFromJson } from "../adapters";
import { glyphDiagramError, glyphDiagramRepairHint, parseGlyphDiagramJson } from "../validate";
import type { GlyphGraph } from "../types";
import type { GlyphDiagramLedgerEntry } from "../ledger";
import { glyphDiagramObject, resolveGlyphDiagram3dLabelPlacement, glyphDiagram3dLabelSideDirection, type GlyphDiagramObjectOptions } from "./glyphDiagramObject";
import { layout3d, GLYPH_DIAGRAM_3D_CAMERA_ROT_X, GLYPH_DIAGRAM_3D_CAMERA_ROT_Y, type GlyphDiagram3dNode } from "./layout3d";
import {
  ledger3dArrowheadsSuppressed, ledger3dCharsetDegraded, ledger3dLabelDropped, ledger3dLabelsSuppressed,
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
 * D2 round 3, requirement 4: an explicit override of the automatic
 * charset->mode mapping below. `"ink"` (the default, undocumented as a
 * literal default so a bare `style` field reads as opt-in) is crisp
 * silhouette+crease line art; `"wireframe"` forces plain wireframe (what
 * `braille` already gets automatically); `"solid"` is the OLD Lambert-shaded
 * box render from D1/D2 fix rounds 1-2, kept reachable for a caller who
 * wants shaded slabs back rather than line art.
 */
export type GlyphDiagram3dStyle = "ink" | "wireframe" | "solid";

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
  /** D2 round 3, requirement 4: override the automatic charset->render-mode mapping (see `GlyphDiagram3dStyle`'s own doc). Default: automatic (`"ink"` for `ascii`/`box`/`blocks`, wireframe+braille for `braille`). */
  readonly style?: GlyphDiagram3dStyle;
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

/**
 * Exported (D3 fix round 1, P1-1) so `/diagrams`' own live 3D viewport can
 * derive the SAME `mode`/`charMode` a static `renderGlyphDiagram3d` frame
 * uses for a given charset, rather than re-deriving (and risking drifting
 * from) this table on the page. Zero behaviour change from the D2 fix
 * round's own version of this function — only its visibility moved.
 */
export interface ResolvedCharset {
  readonly mode: RenderMode;
  readonly charMode: "ascii" | "braille";
  /** The `GLYPH_CANVAS_TIERS` table `glyphDiagramObject`'s overlay reads for its box-outline/edge/arrowhead glyphs — independent of `charMode` (the RASTERIZER's own vocabulary), since `blocks` degrades the render to ascii but the overlay can still draw box-tier line art. */
  readonly canvasTier: GlyphCanvasTierName;
  /**
   * Skip the box-outline overlay when the render MODE already draws every
   * polygon edge itself (D2 round 3: this is now `ink` and `wireframe`
   * alike, not only `wireframe` — message 2's own "REUSE the renderer's
   * modes. Do not hand-draw outlines with overlays where a render mode
   * already does it"). Only the `"solid"` style override still wants the
   * hand-drawn crisp outline, since a flat-lit Lambert fill draws no edges
   * of its own at all (D2 review P1-1's original reason for the overlay).
   */
  readonly boxOutline: boolean;
  readonly hiddenLines: "show" | "hide";
  readonly ledger: GlyphDiagramLedgerEntry[];
}

/**
 * D2 round 3 (default: `style` undefined or `"ink"`) — crisp line art via
 * the renderer's OWN modes: `braille` -> `wireframe` + `charMode: "braille"`
 * (2x4 sub-cell dots); `box`/`ascii` -> `ink` (silhouette + crease outline);
 * `blocks` -> `ink` too, ASCII-downgraded (its sub-cell dual-color encoder
 * bypasses the stamped overlay path this renderer depends on, same as
 * before this round). `hiddenLines: "hide"` throughout, so a back edge or
 * an object standing behind another disappears rather than drawing through
 * it (message 2, requirement 4). `style: "wireframe"` forces wireframe for
 * every charset; `style: "solid"` reaches the OLD Lambert-shaded box render.
 */
export function resolveCharset(charset: GlyphDiagram3dCharset, style?: GlyphDiagram3dStyle): ResolvedCharset {
  if (style === "solid") {
    if (charset === "braille") return { mode: "wireframe", charMode: "braille", canvasTier: "braille", boxOutline: false, hiddenLines: "hide", ledger: [ledger3dCharsetDegraded({ charset: "braille", renderedAs: "wireframe" })] };
    if (charset === "blocks") return { mode: "solid", charMode: "ascii", canvasTier: "box", boxOutline: true, hiddenLines: "hide", ledger: [ledger3dCharsetDegraded({ charset: "blocks", renderedAs: "ascii" })] };
    return { mode: "solid", charMode: "ascii", canvasTier: charset, boxOutline: true, hiddenLines: "hide", ledger: [] };
  }
  if (style === "wireframe") {
    if (charset === "braille") return { mode: "wireframe", charMode: "braille", canvasTier: "braille", boxOutline: false, hiddenLines: "hide", ledger: [] };
    const canvasTier = charset === "blocks" ? "box" : charset;
    return { mode: "wireframe", charMode: "ascii", canvasTier, boxOutline: false, hiddenLines: "hide", ledger: [] };
  }
  // `style === "ink"` or unset (the default). Braille here is the INTENDED
  // look (message 2's own "render those with good detail using braille or
  // ink mode") — wireframe + 2x4 sub-cell dots is what a braille request
  // asks for, not a fallback from something else, so no ledger entry: a
  // reader who picked braille gets exactly it. `blocks` still genuinely
  // degrades (its sub-cell dual-color encoder can't carry the stamped
  // overlay path this renderer depends on), so it keeps its entry.
  if (charset === "braille") return { mode: "wireframe", charMode: "braille", canvasTier: "braille", boxOutline: false, hiddenLines: "hide", ledger: [] };
  if (charset === "blocks") return { mode: "ink", charMode: "ascii", canvasTier: "box", boxOutline: false, hiddenLines: "hide", ledger: [ledger3dCharsetDegraded({ charset: "blocks", renderedAs: "ascii ink" })] };
  return { mode: "ink", charMode: "ascii", canvasTier: charset, boxOutline: false, hiddenLines: "hide", ledger: [] };
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

function renderObjectFrame(objects: readonly GlyphSceneObject[], opts: { camera: GlyphCamera; cols: number; rows: number; cellAspect: number; mode: RenderMode; charMode: "ascii" | "braille"; hiddenLines: "show" | "hide" }): RenderedFrame {
  const result = compileScene({
    polygons: [], objects: objects as GlyphSceneObject[], camera: opts.camera, cols: opts.cols, rows: opts.rows, cellAspect: opts.cellAspect,
    mode: opts.mode, charMode: opts.charMode, hiddenLines: opts.hiddenLines, directionalLight: GLYPH_DIAGRAM_3D_LIGHT, ambientLight: GLYPH_DIAGRAM_3D_AMBIENT_LIGHT,
    glyphPalette: "default", useColors: true, smoothShading: false, creaseAngle: 60, doubleSided: false, supersample: 1,
  });
  // P2-3's own instruction: handle a `null` grid explicitly (an in-flight
  // `compileScene` change may return one for a charMode this module never
  // requests — `ascii`/`braille` only, never `halfblock`/`quadrant`) rather
  // than assume the field is always populated.
  if (!result.grid) glyphDiagramError("bad-options", "glyphcss: compileScene returned no grid for this render (unsupported charMode).");
  return { grid: result.grid };
}

interface FitLabel { readonly node: GlyphDiagram3dNode; readonly text: string; readonly anchor: Vec3; }

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
 */
function fitDiagramCamera(object: GlyphSceneObject, nodes: readonly GlyphDiagram3dNode[], opts: {
  readonly cols: number; readonly rows: number; readonly cellAspect: number;
  readonly rotX?: number; readonly rotY?: number; readonly mat?: readonly number[];
  readonly explicitZoom?: number; readonly title?: string; readonly labelMode?: "inside" | "side" | "auto";
  readonly direction?: GlyphGraph["direction"];
}): { readonly camera: GlyphCamera; readonly fitLabels: readonly FitLabel[]; readonly unfittable: readonly FitLabel[] } {
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
  const labelSideDirection = glyphDiagram3dLabelSideDirection(opts.direction);
  const fitLabels: FitLabel[] = [], unfittable: FitLabel[] = [];
  for (const node of nodes) {
    const rawText = foldGlyphOverlayLabelToAscii(node.label.split("\n")[0] ?? node.id);
    if (rawText.length === 0) continue;
    // Resolve through the SAME pure function `glyphDiagramObject`'s overlay
    // uses, so the fit's own `text`/anchor NEVER drifts from what actually
    // gets stamped (an `inside` label's clip, or a `side` label's shifted
    // anchor, both need to be visible to the fit or it would reserve zoom
    // for text that was never drawn, or too little for text that was).
    const placed = resolveGlyphDiagram3dLabelPlacement(node, rawText, labelMode, labelSideDirection);
    if (placed.text.length > 0) fitLabels.push({ node, text: placed.text, anchor: placed.anchor });
  }

  if (opts.explicitZoom !== undefined) return { camera: makeCamera(opts.explicitZoom, [0.5, 0.5]), fitLabels, unfittable: [] };

  const marginCols = 1;
  const marginRowTop = opts.title ? 2 : 1, marginRowBottom = 1;
  const cols = opts.cols, rows = opts.rows;
  const availCols = Math.max(1, cols - 2 * marginCols);
  const centerCol = cols / 2, centerRow = rows / 2;
  const reference = makeCamera(1, [0.5, 0.5]);

  interface ColPoint { readonly col1: number; readonly widthRight: number; }
  interface RowPoint { readonly row1: number; }
  const colPoints: ColPoint[] = [], rowPoints: RowPoint[] = [];
  for (const corner of boundsCorners(object.bounds)) {
    const [col1, row1] = reference.project(corner, cols, rows, opts.cellAspect);
    colPoints.push({ col1, widthRight: 0 });
    rowPoints.push({ row1 });
  }
  const keptLabels: (FitLabel & { readonly col1: number; readonly row1: number })[] = [];
  for (const label of fitLabels) {
    if (label.text.length > availCols) { unfittable.push(label); continue; }
    const [col1, row1] = reference.project(label.anchor, cols, rows, opts.cellAspect);
    keptLabels.push({ ...label, col1, row1 });
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

  return { camera: makeCamera(finalZoom, center), fitLabels, unfittable };
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
  const { mode, charMode, canvasTier, boxOutline, hiddenLines, ledger: charsetLedger } = resolveCharset(resolved.charset, options.style);

  const camOpts = options.camera ?? {};
  if (camOpts.mat !== undefined && (camOpts.rotX !== undefined || camOpts.rotY !== undefined)) {
    glyphDiagramError("bad-options", "camera: pass either mat (trackball) or rotX/rotY (Euler), not both.");
  }
  // D2 round 5 — ONE fixed "architecture view" camera for every graph,
  // regardless of its own 2D direction (TB/LR/BT/RL): `layout3d.ts`'s
  // `glyphDiagram3dPlaneAxes` embeds the 2D layout's own x axis into a
  // ground direction analytically SOLVED to project with zero screen-row
  // component at THIS exact `rotY` — the flow never drifts, by
  // construction, for any direction or chain length, so there is no more
  // per-direction rotX/rotY special case to pick (the OLD system's own
  // `rotY: -90` LR/RL exemption is gone: that was needed only because ITS
  // geometry was built world-axis-aligned regardless of camera, so a
  // diagonal flow had to be cancelled by camera angle instead of being
  // solved away at the geometry layer, as it is now). `GLYPH_DIAGRAM_3D_CAMERA_ROT_X`/
  // `_ROT_Y` are `layout3d.ts`'s own constants (never a second, drifting
  // copy) — the object's own mesh geometry is BAKED assuming exactly this
  // yaw, so a caller overriding `camera.rotY` sees the object from an
  // angle its own geometry wasn't built for (an ordinary "orbit away from
  // the default" case, not a defect — D3's own live viewport orbits this
  // exact object).
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
    glyphDiagramObject(graph, { ...resolvedOptions, tier: canvasTier, boxOutline, labelNodeIds, arrowheads: resolvedArrowheads }),
    layout3d(graph, resolvedOptions),
  ]);
  // D2 round 5 — the layered path routes edges through the SAME 2D A*
  // router `/diagrams` 2D uses (`route.ts`), which can genuinely fail to
  // find a path (an unroutable edge, a folded label) where the OLD
  // per-direction system's free 3D diagonals never could. `layout.ledger`
  // carries those entries (plus label-folding/group-membership ones from
  // the 2D pipeline itself) — surfaced here rather than silently dropped.
  ledger.push(...layout.ledger);

  // Auto-fit's own label constraint set is the SAME suppressed subset
  // (D2 fix round 3, P1-2) — a label `glyphDiagramObject` never places
  // must not consume any of the fit's own zoom budget, or the adaptive
  // suppression would buy nothing.
  const fitNodes = labelNodeIds ? layout.nodes.filter((n) => labelNodeIds.has(n.id)) : layout.nodes;
  const { camera, fitLabels, unfittable } = fitDiagramCamera(object, fitNodes, {
    cols: resolved.width, rows: resolved.height, cellAspect, rotX, rotY, mat: camOpts.mat,
    explicitZoom: camOpts.zoom, title: options.title, labelMode: options.labels, direction: effectiveDirection,
  });
  for (const label of unfittable) ledger.push(ledger3dLabelUnfittable({ nodeId: label.node.id, label: label.text, cols: resolved.width }));

  const objects: GlyphSceneObject[] = options.title ? [object, titleChromeObject(options.title)] : [object];
  const { grid } = renderObjectFrame(objects, { camera, cols: resolved.width, rows: resolved.height, cellAspect, mode, charMode, hiddenLines });

  // D2 review P1-2's own repro ("Orchestrator vanished... with an empty
  // ledger"): the analytic fit above proves every label's PREDICTED
  // position clears the margin, but the shared `GlyphLabelArbiter` can
  // still refuse one at render time — two labels genuinely colliding on
  // screen from THIS rotation, or a foreign mesh's `winnerMesh` covering
  // one of its cells — a real case no amount of geometry alone rules out
  // in advance. Verify what ACTUALLY landed against what was predicted and
  // name every miss, rather than trusting the fit's own prediction blindly.
  if (camOpts.zoom === undefined) {
    for (const label of fitLabels) {
      const [colF, rowF] = camera.project(label.anchor, resolved.width, resolved.height, cellAspect);
      const col = Math.round(colF), row = Math.round(rowF);
      let landed = col >= 0 && row >= 0 && row < grid.rows && col + label.text.length <= grid.cols;
      if (landed) {
        for (let i = 0; i < label.text.length; i++) {
          if (grid.char[row * grid.cols + col + i] !== label.text[i]) { landed = false; break; }
        }
      }
      if (!landed) ledger.push(ledger3dLabelDropped({ nodeId: label.node.id, label: label.text }));
    }
  }

  // Three exits, over a real `GlyphCanvas` instead of a bare `CellGrid` —
  // `encodeGlyphCanvasText`/`Ansi`/`Html` are the tested, NO_COLOR/
  // FORCE_COLOR-aware, HTML-escaping exits AGENTS.md's "Targets and page"
  // documents; a bare `CellGrid` string has neither (see this file's own
  // top-of-file doc for why this renders through them instead of
  // `compileScene`'s own `html`/`inner`, which is a browser-only exit with
  // no ANSI/NO_COLOR concept at all).
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
