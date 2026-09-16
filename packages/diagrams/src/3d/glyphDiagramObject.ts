/**
 * `glyphDiagramObject` — a `GlyphGraph` (the same IR the Mermaid/JSON
 * adapters build) to a `GlyphSceneObject` any `createGlyphScene` can mount
 * via `scene.addObject()`. Stable mesh names, per PLAN-3d.md §3.1: one
 * `node:<id>` mesh per node (so a single agent's box is its own effect
 * target) — PLAIN meshes only (`castShadow`/`receiveShadow`, `depthBias`),
 * never `density`/`transparent`/a differing `mode`/`glyphPalette`/
 * `ambientIntensity`, since `render3d.ts` routes through the public
 * `compileScene({ objects })`, which REJECTS any member mesh declaring one
 * of those.
 *
 * **D2 round 7 (user, verbatim: "we need to use braille and blocks for 3d
 * diagrams" — box-drawing/bar glyphs can't represent an edge at an angle;
 * "edges as ribbon geometry and arrowheads as cone/pyramid geometry, not
 * stamped glyphs").** Edges, arrowheads, and group outlines are now real
 * MESH GEOMETRY (`orientedRibbonPolygons`/`orientedPyramidPolygons`/
 * `groupOutlinePolygons` below) — never a `stampGlyphOverlayLine`
 * box-drawing/bar glyph, which staircases the instant the segment it
 * traces isn't screen-axis-aligned (and under `layout3d.ts`'s own D2
 * round 7 triangulated-ring layout, most edges genuinely aren't). A node's
 * own box OUTLINE is no longer drawn by this module AT ALL — it comes from
 * the RENDER MODE itself now: `braille` is a real depth-tested wireframe
 * (every polygon edge traced as sub-cell dots at any angle), and `blocks`
 * is solid-shaded halfblock/quadrant, where a box's own edges read from
 * FACE-CONTRAST SHADING (adjacent faces catch the light differently), not
 * a drawn line. Only node LABELS remain a stamped overlay (`frame.labels
 * .place`, through the SAME shared `GlyphLabelArbiter` a chart's ticks or
 * another diagram's own labels use, so two diagrams mounted in one scene
 * never overwrite each other's text) — everything else in this file is
 * geometry the rasterizer draws (and depth-tests, for free) exactly like a
 * node's own box.
 *
 * Every node's box is a PLAIN, world-axis-aligned box — width always world
 * X, depth (extrusion) always world Y, height always world Z
 * (`boxPolygons`'s own convention, `@glyphcss/core`) — for BOTH layouts.
 * `layout3d.ts`'s own top-of-file doc has the full rationale: this round
 * drops round 5/6's shared-plane embedding (`u`/`n` ground vectors solved
 * from camera yaw) entirely, so there is no more per-graph basis to place a
 * box's local geometry through — `nodePolygons` below just adds a node's
 * own `center` to its LOCAL (origin-centred) shape verbatim.
 *
 * **D2 round 8** (user, verbatim: "I think that the labels should be like
 * on the side of the nodes and not over the nodes") — the label default
 * (`GlyphDiagramObjectOptions.labels`, `"auto"`) now ALWAYS resolves to
 * `"side"`; the old "sits inside if the text happens to fit the front
 * face" fallback is gone (`"inside"` stays reachable as an explicit
 * opt-in). Each node's own side is chosen from a small ORDERED set of
 * candidate WORLD directions — its own RADIAL direction first (away from
 * its own rank's ring centre, `glyphDiagram3dLabelSideCandidates`'s own
 * doc below), then the rank's own 4 in-plane axis directions — and
 * `pickGlyphDiagram3dSidePlacement` (this module, camera-aware) keeps the
 * FIRST candidate whose anchor clears every node's own projected
 * silhouette, dropping the label (with a ledger entry) only when none do.
 * This is genuinely necessary, not belt-and-suspenders: this module's own
 * FIXED camera does not project every world axis onto a "moves away from
 * the box on screen" direction (measured on the shipped chain fixtures —
 *),
 * so a single fixed direction per node is not enough on its own. The SAME
 * round widened `layout3d.ts`'s own ring spacing to leave room for a
 * sibling's own label text (`layout3d.ts`'s own "D2 round 8" doc).
 */
import type { GlyphGraph, GlyphGraphDirection } from "../types";
import type { GlyphCamera, GlyphOverlayFrame, GlyphSceneObject, GlyphSceneObjectMesh, GlyphSceneOverlay, Polygon, Vec3 } from "glyphcss";
import { boxPolygons, spherePolygons, cylinderPolygons, orientedRibbonPolygons, orientedPyramidPolygons, stampGlyphOverlayLine } from "glyphcss";
import { layout3d, type GlyphDiagram3dGroup, type GlyphDiagram3dLayout, type GlyphDiagram3dLayoutKind, type GlyphDiagram3dLayoutOptions, type GlyphDiagram3dNode } from "./layout3d";

/**
 * Shape-aware node geometry, checked against core FIRST: `cylinderPolygons`
 * already exists (`@glyphcss/core`) but is Y-AXIS-ALIGNED (height runs
 * along Y), while glyphcss's world is Z-up throughout (AGENTS.md's
 * "Numeric conventions"). This wraps it with the axis remap
 * `toZUp(v) = [v[0], -v[2], v[1]]` — a proper (determinant +1) rotation —
 * converting the INPUT center via the inverse `fromZUp(w) = [w[0], w[2], -w[1]]` first.
 */
function fromZUp(w: Vec3): Vec3 { return [w[0], w[2], -w[1]]; }
function toZUp(v: Vec3): Vec3 { return [v[0], -v[2], v[1]]; }

/** 8 is the fewest cylinder sides that still reads unambiguously as round rather than a hexagon/octagon in line art, while roughly halving the crease count a 16-sided default would trace. */
const GLYPH_DIAGRAM_3D_CYLINDER_SIDES = 8;

function zUpCylinderPolygons(opts: { readonly center: Vec3; readonly radius: number; readonly height: number; readonly color: string }): Polygon[] {
  const raw = cylinderPolygons({ center: fromZUp(opts.center), radius: opts.radius, height: opts.height, sides: GLYPH_DIAGRAM_3D_CYLINDER_SIDES, color: opts.color });
  return raw.map((poly) => ({ ...poly, vertices: poly.vertices.map(toZUp) }));
}

/** Rotate a point 45 degrees about `center`'s own Z axis — operates on LOCAL (pre-placement) coordinates for a node's own shape. */
function rotateZ45(p: Vec3, center: Vec3): Vec3 {
  const dx = p[0] - center[0], dy = p[1] - center[1];
  const c = Math.SQRT1_2; // cos(45deg) === sin(45deg)
  return [center[0] + dx * c - dy * c, center[1] + dx * c + dy * c, p[2]];
}

/** The "decision object" for a `diamond`/rhombus Mermaid node — a rotated box rather than an octahedron. Built and rotated in LOCAL coordinates (`opts.center` is `[0, 0, 0]` at every call site). */
function decisionPolygons(opts: { readonly center: Vec3; readonly width: number; readonly depth: number; readonly height: number; readonly color: string }): Polygon[] {
  const box = boxPolygons({ center: opts.center, width: opts.width, depth: opts.depth, height: opts.height, color: opts.color });
  return box.map((poly) => ({ ...poly, vertices: poly.vertices.map((v) => rotateZ45(v, opts.center)) }));
}

/**
 * Shape follows Mermaid node shape: box/rect (and every other box-ish shape)
 * -> box; `cylinder` (Mermaid `[( )]`, a datastore) -> the Z-up cylinder
 * wrapper above; `circle` -> sphere; `diamond` -> the rotated-box decision
 * object above. Built LOCALLY (`center: [0,0,0]`) then simply translated by
 * `node.center` — no basis to map through any more (D2 round 7's own doc).
 */
function nodePolygons(node: GlyphDiagram3dNode, color: string): Polygon[] {
  const [hx, hy, hz] = node.half;
  const local: Polygon[] = (() => {
    switch (node.shape) {
      case "circle":
        return spherePolygons({ center: [0, 0, 0], size: Math.max(hx, hy, hz), color });
      case "cylinder":
        return zUpCylinderPolygons({ center: [0, 0, 0], radius: Math.max(hx, hy), height: hz * 2, color });
      case "diamond":
        return decisionPolygons({ center: [0, 0, 0], width: hx * 2, depth: hy * 2, height: hz * 2, color });
      default:
        return boxPolygons({ center: [0, 0, 0], width: hx * 2, depth: hy * 2, height: hz * 2, color });
    }
  })();
  const [cx, cy, cz] = node.center;
  return local.map((poly) => ({ ...poly, vertices: poly.vertices.map((v): Vec3 => [v[0] + cx, v[1] + cy, v[2] + cz]) }));
}

export type GlyphDiagram3dLabelMode = "inside" | "side" | "auto";

export interface GlyphDiagram3dLabelPlacement {
  /** Where the label's own first character lands (world space). */
  readonly anchor: Vec3;
  /** The (possibly clipped, for `inside`) text actually placed. */
  readonly text: string;
  readonly isSide: boolean;
  /** `side` only: the node's own surface point the leader line starts from — always exactly ON the node's projected edge, never floating. */
  readonly leaderFrom?: Vec3;
}

/**
 * A PURE, camera-independent function shared verbatim by this module's own
 * overlay `stamp()` AND `render3d.ts`'s analytic camera fit, so the two can
 * never predict a different landing cell for the same node under the same
 * options.
 *
 * **D2 round 8** (user, verbatim: "I think that the labels should be like
 * on the side of the nodes and not over the nodes") — `"auto"` no longer
 * falls back to `"inside"` when the label happens to fit the front face:
 * it ALWAYS resolves to `"side"` now, so a node's own block stays fully
 * visible with no label cell on its own silhouette. `"inside"` survives
 * only as an explicit opt-in, unchanged from D2 round 6 (front-face
 * `"top"` anchor, clipped verbatim to `faceWidthCells`, no ellipsis).
 *
 * `"side"`'s own anchor pushes OUT from the node's own box surface along
 * `sideDirection` — the exit point is wherever that ray leaves the box
 * (never a fixed corner), and `leaderFrom` is that exact exit point, so
 * the leader always touches the node's own real edge in whatever direction
 * it was pushed. Two legacy string values, `"right"`/`"below"`, keep their
 * ORIGINAL D2 round 6/7 geometry byte-for-byte (a front-top-right edge / a
 * bottom-centre edge — deliberately not the generic box-exit formula,
 * which would shift both); anything else is read as a raw WORLD direction
 * vector (`Vec3`, not necessarily unit-length) — this module's own
 * `pickGlyphDiagram3dSidePlacement` is the production caller, choosing
 * from `glyphDiagram3dLabelSideCandidates`' own ordered per-node list
 * (round 8's own doc on both).
 *
 * `screenWidthCols`, when given, is the node's own front face's REAL
 * PROJECTED SCREEN WIDTH (columns) and REPLACES `node.half[0] * 2` (world
 * units) as the `"inside"` clip budget — a node's own front-face width
 * in WORLD units maps to screen columns at `worldWidth * zoom / cellPxW`,
 * so at any auto-fit `zoom` below `cellPxW` a box's SCREEN width is
 * narrower than its own WORLD-unit label budget (D2 round 6's own root
 * cause for labels overflowing their block). Padding: `screenWidthCols`
 * reserves >= 1 column on EACH side by budgeting `floor(screenWidthCols) - 2`
 * cells for text, never the raw width. Omitted, it falls back to the old
 * world-unit heuristic (byte-identical for a caller/unit test with no
 * camera/zoom to derive it from). Unused outside `"inside"` mode.
 */
export function resolveGlyphDiagram3dLabelPlacement(
  node: GlyphDiagram3dNode, rawText: string, mode: GlyphDiagram3dLabelMode = "auto",
  sideDirection: "right" | "below" | Vec3 = "right", screenWidthCols?: number,
): GlyphDiagram3dLabelPlacement {
  if (mode === "inside") {
    const faceWidthCells = screenWidthCols !== undefined
      ? Math.max(1, Math.floor(screenWidthCols) - 2)
      : Math.max(1, Math.floor(node.half[0] * 2));
    const front: Vec3 = [node.center[0], node.center[1] - node.half[1], node.center[2]];
    const top: Vec3 = [front[0], front[1], node.center[2] + node.half[2]];
    const text = rawText.length > faceWidthCells ? rawText.slice(0, faceWidthCells) : rawText;
    return { anchor: top, text, isSide: false };
  }
  if (sideDirection === "below") {
    const bottom: Vec3 = [node.center[0], node.center[1], node.center[2] - node.half[2]];
    const gap = Math.max(GLYPH_DIAGRAM_3D_LABEL_GAP_MIN, node.half[2] * GLYPH_DIAGRAM_3D_LABEL_GAP_FRACTION);
    const anchor: Vec3 = [node.center[0], node.center[1], node.center[2] - node.half[2] - gap];
    return { anchor, text: rawText, isSide: true, leaderFrom: bottom };
  }
  if (sideDirection === "right") {
    const front: Vec3 = [node.center[0], node.center[1] - node.half[1], node.center[2]];
    const top: Vec3 = [front[0], front[1], node.center[2] + node.half[2]];
    const rightEdge: Vec3 = [node.center[0] + node.half[0], node.center[1] - node.half[1], top[2]];
    const gap = Math.max(GLYPH_DIAGRAM_3D_LABEL_GAP_MIN, node.half[0] * GLYPH_DIAGRAM_3D_LABEL_GAP_FRACTION);
    const anchor: Vec3 = [rightEdge[0] + gap, rightEdge[1], top[2]];
    return { anchor, text: rawText, isSide: true, leaderFrom: rightEdge };
  }
  // A generic WORLD direction vector — exits the box surface along `u`
  // (whichever axis its own half-extent is reached FIRST along, the same
  // "box exit" rule `layout3d.ts`'s own `nodeSurfaceAnchor` uses for edge
  // endpoints) and pushes the anchor a FURTHER `t * GLYPH_DIAGRAM_3D_LABEL_
  // GAP_FRACTION` beyond it — proportional to the exit distance itself
  // (round 8: a FLAT world-unit gap, correct at D2 round 6/7's own
  // "labels sit inside, occasionally spill to the side" scale, left every
  // multi-rank chain's own gap sub-cell at its auto-fit zoom — measured on
  // the real LeNet-5/transformer fixtures, a flat `gap: 1` anchor still
  // rounded to a row/column INSIDE the node's own silhouette, because the
  // box's own half-extent the exit point sits on is many world units while
  // the push past it was one. Scaling the push by the SAME half-extent
  // that put the exit there keeps the anchor's own screen displacement in
  // the same order of magnitude as the box's own visible size, regardless
  // of auto-fit zoom).
  const raw = sideDirection;
  const len = Math.hypot(raw[0], raw[1], raw[2]) || 1;
  const u: Vec3 = [raw[0] / len, raw[1] / len, raw[2] / len];
  let t = Infinity;
  for (let i = 0; i < 3; i++) if (Math.abs(u[i]) > 1e-9) t = Math.min(t, node.half[i] / Math.abs(u[i]));
  if (!Number.isFinite(t)) t = 0;
  const gap = Math.max(GLYPH_DIAGRAM_3D_LABEL_GAP_MIN, t * GLYPH_DIAGRAM_3D_LABEL_GAP_FRACTION);
  const exit: Vec3 = [node.center[0] + u[0] * t, node.center[1] + u[1] * t, node.center[2] + u[2] * t];
  const anchor: Vec3 = [exit[0] + u[0] * gap, exit[1] + u[1] * gap, exit[2] + u[2] * gap];
  return { anchor, text: rawText, isSide: true, leaderFrom: exit };
}

/** LR/RL -> `"below"`, everything else (TB/BT/unset) -> `"right"`. Kept as the FIRST of `glyphDiagram3dLabelSideCandidates`' own 4 in-plane axis directions, and reachable directly by any caller wanting that OLD global-direction behaviour verbatim. */
export function glyphDiagram3dLabelSideDirection(direction: GlyphGraphDirection | undefined): "right" | "below" {
  return direction === "LR" || direction === "RL" ? "below" : "right";
}

/**
 * **D2 round 8** — the ORDERED set of candidate WORLD directions a node's
 * `"side"` label tries, all within its own rank's cross-section plane
 * (perpendicular to flow, `layout3d.ts`'s own top-of-file doc): its own
 * RADIAL direction first — away from the ring's own centre, since every
 * node's cross-axis coordinates ARE its own offset from that centre, so
 * this direction points into open space and, by construction, away from
 * every OTHER sibling on the SAME ring (a single-member rank, radius 0,
 * has none, and neither does `"force"` layout, which has no ring at all)
 * — then the plane's own 4 axis directions, `glyphDiagram3dLabelSide
 * Direction`'s pair included as the first of the four, as a fallback set
 * `pickGlyphDiagram3dSidePlacement` below tries in order. Plain WORLD
 * directions, not yet screen-tested — the CALLER (camera-aware) decides
 * which one actually clears the frame.
 */
export function glyphDiagram3dLabelSideCandidates(
  node: GlyphDiagram3dNode, direction: GlyphGraphDirection | undefined, layoutKind: GlyphDiagram3dLayoutKind | undefined,
): readonly Vec3[] {
  const horizontalFlow = direction === "LR" || direction === "RL";
  // The 4 axis directions first, THEN the 4 diagonals — a diagonal reaches
  // both silhouettes an axis push runs parallel to at once, so it is the
  // fallback of last resort, tried only once every axis-aligned option is
  // exhausted.
  const inPlane: Vec3[] = horizontalFlow
    ? [[0, 0, -1], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 1, 1], [0, 1, -1], [0, -1, 1], [0, -1, -1]]
    : [[1, 0, 0], [0, 1, 0], [0, -1, 0], [-1, 0, 0], [1, 1, 0], [1, -1, 0], [-1, 1, 0], [-1, -1, 0]];
  if (layoutKind === "force") return inPlane;
  const outward: Vec3 = horizontalFlow ? [0, node.center[1], node.center[2]] : [node.center[0], node.center[1], 0];
  const len = Math.hypot(outward[0], outward[1], outward[2]);
  return len > 1e-6 ? [outward, ...inPlane] : inPlane;
}

/** A node's own projected screen AABB — used only to keep a `"side"` label off any node's silhouette, never for drawing. */
export interface GlyphDiagram3dScreenBox { readonly minCol: number; readonly maxCol: number; readonly minRow: number; readonly maxRow: number; }

const IDENTITY_TO_WORLD = (p: Vec3): Vec3 => p;

function projectBoxSilhouette(camera: GlyphCamera, center: Vec3, half: Vec3, cols: number, rows: number, cellAspect: number, toWorld: (p: Vec3) => Vec3): GlyphDiagram3dScreenBox {
  let minCol = Infinity, maxCol = -Infinity, minRow = Infinity, maxRow = -Infinity;
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    const local: Vec3 = [center[0] + sx * half[0], center[1] + sy * half[1], center[2] + sz * half[2]];
    const [col, row] = camera.project(toWorld(local), cols, rows, cellAspect);
    minCol = Math.min(minCol, col); maxCol = Math.max(maxCol, col);
    minRow = Math.min(minRow, row); maxRow = Math.max(maxRow, row);
  }
  return { minCol, maxCol, minRow, maxRow };
}

/**
 * D2 round 8 — every node's own projected silhouette, computed ONCE per
 * render (never per label) and reused by `pickGlyphDiagram3dSidePlacement`
 * for every node's own candidate test. The collision VERDICT (does anchor
 * X clear box Y) is invariant to the camera's own `zoom` under a FIXED
 * rotation — `zoom` is one uniform scale from a fixed centre applied to
 * both the label and every box alike, which preserves every pairwise
 * col/row ORDERING — so a caller mid auto-fit (zoom not yet known) can
 * pass a cheap `zoom: 1` reference camera and get the identical verdict a
 * later pass would get from the real, final camera. `toWorld` (default
 * identity, `render3d.ts`'s own static exit mounts objects at the
 * identity transform) is `GlyphOverlayFrame.toWorld` for a live-mounted
 * object — this module's own `stamp()` below is the caller that needs it.
 */
export function glyphDiagram3dNodeSilhouettes(
  nodes: readonly GlyphDiagram3dNode[], camera: GlyphCamera, cols: number, rows: number, cellAspect: number,
  toWorld: (p: Vec3) => Vec3 = IDENTITY_TO_WORLD,
): ReadonlyMap<string, GlyphDiagram3dScreenBox> {
  const m = new Map<string, GlyphDiagram3dScreenBox>();
  for (const n of nodes) m.set(n.id, projectBoxSilhouette(camera, n.center, n.half, cols, rows, cellAspect, toWorld));
  return m;
}

function boxesOverlap(a: GlyphDiagram3dScreenBox, b: GlyphDiagram3dScreenBox): boolean {
  return a.maxCol >= b.minCol && a.minCol <= b.maxCol && a.maxRow >= b.minRow && a.minRow <= b.maxRow;
}

function labelClearsEverySilhouette(col: number, row: number, textLength: number, silhouettes: ReadonlyMap<string, GlyphDiagram3dScreenBox>): boolean {
  const box: GlyphDiagram3dScreenBox = { minCol: col, maxCol: col + textLength - 1, minRow: row, maxRow: row };
  for (const other of silhouettes.values()) if (boxesOverlap(box, other)) return false;
  return true;
}

export interface GlyphDiagram3dLabelPick { readonly placement: GlyphDiagram3dLabelPlacement; readonly dropped: boolean; }

/**
 * D2 round 8 — the camera-aware ARBITER over every node's own `"side"`
 * placement, run ONCE per render for the WHOLE node set (never per node in
 * isolation): each node tries `glyphDiagram3dLabelSideCandidates`' own
 * ordered list and keeps the FIRST whose anchor clears BOTH every node's
 * own projected silhouette ("the block itself stays fully visible" — its
 * own box included, so a label never lands on the box it names) AND every
 * label ALREADY accepted for a higher-priority node this same pass. Nodes
 * are visited in PRIORITY order — degree descending, id ascending — the
 * SAME order the shared `GlyphLabelArbiter` itself resolves conflicts in
 * (AGENTS.md's "Scene objects" Declutter clause) — and an accepted
 * label's own occupied cells are reserved before the next node's own
 * search runs.
 *
 * This reservation step is genuinely necessary, not a refinement: a
 * per-node-independent search (this file's FIRST round-8 cut) checked a
 * candidate only against node silhouettes, so nothing stopped two
 * DIFFERENT nodes' labels from landing on the SAME cells whenever both
 * pushed in a similar direction — the routine case for a plain CHAIN,
 * whose single-member ranks all fall back to the identical fixed axis
 * (`glyphDiagram3dLabelSideCandidates`'s own doc). The shared arbiter
 * still caught every such collision at render time (`render3d.ts`'s own
 * `verifyLabelsLanded`) and dropped one — correctly, but SILENTLY and by
 * the dozen on a real chain fixture
 * round 8" section has the swept counts before this fix). Reserving
 * cells here closes that gap for the vast majority of real graphs; a
 * genuine residual remains — the arbiter's own tie-break (a FOREIGN
 * mesh's `winnerMesh`, or a rotation this module didn't anticipate) can
 * still refuse a cell this pre-check missed, which is exactly why
 * `verifyLabelsLanded` stays the final, render-time truth rather than
 * being replaced by this pre-check.
 */
export function pickGlyphDiagram3dLabelPlacements(
  nodes: readonly GlyphDiagram3dNode[],
  labelTextOf: (node: GlyphDiagram3dNode) => string,
  mode: GlyphDiagram3dLabelMode, direction: GlyphGraphDirection | undefined, layoutKind: GlyphDiagram3dLayoutKind | undefined,
  camera: GlyphCamera, cols: number, rows: number, cellAspect: number,
  silhouettes: ReadonlyMap<string, GlyphDiagram3dScreenBox>,
  screenWidthColsOf?: (node: GlyphDiagram3dNode) => number | undefined,
  toWorld: (p: Vec3) => Vec3 = IDENTITY_TO_WORLD,
): ReadonlyMap<string, GlyphDiagram3dLabelPick> {
  const ordered = [...nodes].sort((a, b) => b.degree - a.degree || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const claimed: GlyphDiagram3dScreenBox[] = [];
  const result = new Map<string, GlyphDiagram3dLabelPick>();
  for (const node of ordered) {
    const rawText = labelTextOf(node);
    const screenWidthCols = screenWidthColsOf?.(node);
    if (mode === "inside") {
      result.set(node.id, { placement: resolveGlyphDiagram3dLabelPlacement(node, rawText, "inside", "right", screenWidthCols), dropped: false });
      continue;
    }
    if (rawText.length === 0) {
      result.set(node.id, { placement: resolveGlyphDiagram3dLabelPlacement(node, rawText, "side", "right", screenWidthCols), dropped: false });
      continue;
    }
    const candidates = glyphDiagram3dLabelSideCandidates(node, direction, layoutKind);
    let picked: GlyphDiagram3dLabelPlacement | undefined;
    let pickedBox: GlyphDiagram3dScreenBox | undefined;
    let dropped = true;
    for (const candidate of candidates) {
      const placement = resolveGlyphDiagram3dLabelPlacement(node, rawText, "side", candidate, screenWidthCols);
      const [colF, rowF] = camera.project(toWorld(placement.anchor), cols, rows, cellAspect);
      const col = Math.round(colF), row = Math.round(rowF);
      const box: GlyphDiagram3dScreenBox = { minCol: col, maxCol: col + placement.text.length - 1, minRow: row, maxRow: row };
      if (labelClearsEverySilhouette(col, row, placement.text.length, silhouettes) && !claimed.some((c) => boxesOverlap(box, c))) {
        picked = placement; pickedBox = box; dropped = false; break;
      }
      picked ??= placement;
    }
    if (!dropped && pickedBox) claimed.push(pickedBox);
    result.set(node.id, { placement: picked!, dropped });
  }
  return result;
}

const DEFAULT_NODE_COLOR = "#8fb4ff";
const DEFAULT_EDGE_COLOR = "#cbd5e1";
const DEFAULT_GROUP_COLOR = "#64748b";
const DEFAULT_LABEL_COLOR = "#f8fafc";
/**
 * D2 round 8 (user, verbatim: "a short leader connecting label and block
 * when it isn't flush against the block's edge") — a plain dot, stamped
 * via `stampGlyphOverlayLine` between a side label's own `leaderFrom` (the
 * exact box-surface exit point, never a corner) and its anchor, so a
 * label pushed a full `GLYPH_DIAGRAM_3D_LABEL_GAP_FRACTION` past its own
 * node still reads as belonging to it. Never a box-drawing/bar glyph
 * (this file's own D2 round 7 doc, "no stamped line traces at any angle
 * without staircasing") — a repeated single character has no direction to
 * stair-case, unlike `─│/\`. Skipped entirely under `GLYPH_DIAGRAM_3D_
 * LEADER_MIN_CELLS` (so a label sitting flush against its own edge draws
 * no redundant dot on top of it).
 */
const GLYPH_DIAGRAM_3D_LEADER_CHAR = ".";
const GLYPH_DIAGRAM_3D_LEADER_MIN_CELLS = 1.5;

/** Edge ribbon half-width, arrowhead half-width/length, group outline half-width — all world units, tuned by direct rendering at this module's own default node scale (a single-line label's box is roughly 5-12 units wide). */
const GLYPH_DIAGRAM_3D_EDGE_RIBBON_HALF_WIDTH = 0.45;
const GLYPH_DIAGRAM_3D_ARROWHEAD_HALF_WIDTH = 1.1;
const GLYPH_DIAGRAM_3D_ARROWHEAD_LENGTH = 2.2;
const GLYPH_DIAGRAM_3D_GROUP_OUTLINE_HALF_WIDTH = 0.3;
/**
 * D2 round 8 — `resolveGlyphDiagram3dLabelPlacement`'s own `"side"` push,
 * PAST the box's own surface exit point, as a FRACTION of the exit
 * distance itself (the box's own relevant half-extent) — never a flat
 * world-unit constant, which measured sub-cell at a multi-rank chain's own
 * auto-fit zoom (this function's own doc has the exact repro). Tuned by
 * direct rendering against the real fixtures, sweeping `0.5` to `2.0` and
 * counting `3d-label-dropped` ledger entries at the ACTUAL render (not a
 * standalone silhouette check, which undercounts — a candidate can clear
 * every node's own box yet still land on ANOTHER label's own text, the
 * defect `pickGlyphDiagram3dLabelPlacements`'s own reservation pass
 * exists to catch): `1` cleared a node's own box but too tightly to leave
 * every OTHER candidate room too, `1.5`-`2` pushed labels far enough to
 * start colliding with EACH OTHER instead. `1.25` sits in the middle of
 * the swept range that clears every label on every one of this round's
 * own 5 fixtures at all 3 required sizes with zero drops
 *). `_MIN` is
 * the floor for a near-zero half-extent (a degenerate box).
 */
const GLYPH_DIAGRAM_3D_LABEL_GAP_FRACTION = 1.25;
const GLYPH_DIAGRAM_3D_LABEL_GAP_MIN = 1;

export interface GlyphDiagramObjectOptions extends GlyphDiagram3dLayoutOptions {
  /** Object id — must be unique among objects mounted in the same scene. Default `"diagram"`. */
  readonly id?: string;
  readonly nodeColor?: string | ((node: GlyphDiagram3dLayout["nodes"][number]) => string);
  readonly edgeColor?: string;
  readonly groupColor?: string;
  readonly labelColor?: string;
  /**
   * When given, ONLY nodes whose id is in this set get a placed label —
   * every other node's box still renders (and still occludes/gets
   * occluded normally), just with no label candidate registered at all.
   * `render3d.ts`'s own adaptive policy computes this set (highest-degree
   * nodes first) past a node-count threshold; `undefined` (the default)
   * shows every node's label.
   */
  readonly labelNodeIds?: ReadonlySet<string>;
  /**
   * Draw a real arrowhead PYRAMID on each edge's final segment. Default
   * `true`. `render3d.ts` passes `false` past an edge-count density
   * budget — the ribbon still marks the edge itself, just without the
   * extra geometry past a threshold where arrowheads read as noise
   * rather than direction.
   */
  readonly arrowheads?: boolean;
  /** `"inside"` | `"side"` | `"auto"` (default) — see `resolveGlyphDiagram3dLabelPlacement`'s own doc. */
  readonly labels?: GlyphDiagram3dLabelMode;
}

function resolveNodeColor(option: GlyphDiagramObjectOptions["nodeColor"], node: GlyphDiagram3dLayout["nodes"][number]): string {
  if (typeof option === "function") return option(node);
  return option ?? DEFAULT_NODE_COLOR;
}

/** A group's own 12-edge AABB, traced as thin ribbons — a plain outline tier, never a filled/recessed panel (D2 round 7: "a translucent-free outline tier around member blocks, drawn as geometry"). */
const GROUP_OUTLINE_EDGE_PAIRS: readonly (readonly [number, number])[] = [
  [0, 1], [1, 2], [2, 3], [3, 0],
  [4, 5], [5, 6], [6, 7], [7, 4],
  [0, 4], [1, 5], [2, 6], [3, 7],
];
function groupOutlinePolygons(min: Vec3, max: Vec3, halfWidth: number, color: string): Polygon[] {
  const corners: readonly Vec3[] = [
    [min[0], min[1], min[2]], [max[0], min[1], min[2]], [max[0], max[1], min[2]], [min[0], max[1], min[2]],
    [min[0], min[1], max[2]], [max[0], min[1], max[2]], [max[0], max[1], max[2]], [min[0], max[1], max[2]],
  ];
  return GROUP_OUTLINE_EDGE_PAIRS.flatMap(([ia, ib]) => orientedRibbonPolygons(corners[ia]!, corners[ib]!, halfWidth, color));
}

/** A node's own 8 WORLD corners — used only for this object's own `bounds` (the auto-fit's AABB), never for drawing (no more hand-drawn box outline). */
function boxCorners(node: GlyphDiagram3dNode): readonly Vec3[] {
  const [hx, hy, hz] = node.half;
  const local: Vec3[] = [
    [-hx, -hy, -hz], [hx, -hy, -hz], [hx, hy, -hz], [-hx, hy, -hz],
    [-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz],
  ];
  const rotated = node.shape === "diamond" ? local.map((p) => rotateZ45(p, [0, 0, 0])) : local;
  const [cx, cy, cz] = node.center;
  return rotated.map((p): Vec3 => [p[0] + cx, p[1] + cy, p[2] + cz]);
}

interface ProjectedPoint { readonly col: number; readonly row: number; readonly depth: number; }
function project(frame: GlyphOverlayFrame, p: Vec3): ProjectedPoint {
  const [col, row, depth] = frame.camera.project(frame.toWorld(p), frame.cols, frame.rows, frame.cellAspect);
  return { col, row, depth };
}

export async function glyphDiagramObject(graph: GlyphGraph, options: GlyphDiagramObjectOptions = {}): Promise<GlyphSceneObject> {
  const layout = await layout3d(graph, options);
  const edgeColor = options.edgeColor ?? DEFAULT_EDGE_COLOR;
  const groupColor = options.groupColor ?? DEFAULT_GROUP_COLOR;
  const labelColor = options.labelColor ?? DEFAULT_LABEL_COLOR;
  const labelNodeIds = options.labelNodeIds;
  const arrowheads = options.arrowheads ?? true;
  const labelMode = options.labels ?? "auto";
  const labelDirection = options.direction ?? graph.direction;
  // D2 round 8 — the resolved layout kind, mirroring `layout3d`'s own
  // default (`options.layout ?? "layered"`); `render3d.ts` always passes
  // its own already-resolved `layout` through `options` (never leaves it
  // undefined for THIS module), so this only ever re-derives the default
  // for a direct caller that left it unset too.
  const layoutKind = options.layout ?? "layered";

  const meshes: GlyphSceneObjectMesh[] = [];
  for (const node of layout.nodes) {
    const color = resolveNodeColor(options.nodeColor, node);
    meshes.push({ name: `node:${node.id}`, polygons: nodePolygons(node, color), options: { castShadow: true, receiveShadow: true } });
  }

  layout.edges.forEach((edge, i) => {
    const polygons: Polygon[] = [];
    for (let s = 0; s < edge.points.length - 1; s++) {
      polygons.push(...orientedRibbonPolygons(edge.points[s]!, edge.points[s + 1]!, GLYPH_DIAGRAM_3D_EDGE_RIBBON_HALF_WIDTH, edgeColor));
    }
    if (arrowheads && edge.points.length >= 2) {
      const tip = edge.points[edge.points.length - 1]!;
      const source = edge.points[edge.points.length - 2]!;
      polygons.push(...orientedPyramidPolygons(source, tip, GLYPH_DIAGRAM_3D_ARROWHEAD_HALF_WIDTH, GLYPH_DIAGRAM_3D_ARROWHEAD_LENGTH, edgeColor));
    }
    meshes.push({ name: `edge:${edge.id}:${i}`, polygons });
  });

  for (const group of layout.groups) {
    meshes.push({ name: `group:${group.id}`, polygons: groupOutlinePolygons(group.min, group.max, GLYPH_DIAGRAM_3D_GROUP_OUTLINE_HALF_WIDTH, groupColor) });
  }

  const overlay: GlyphSceneOverlay = {
    id: "glyph-diagram-3d",
    stamp(grid, frame): void {
      const labeledNodes = labelNodeIds ? layout.nodes.filter((n) => labelNodeIds.has(n.id)) : layout.nodes;
      // D2 round 8 — every node's own projected silhouette, computed ONCE
      // for this frame (`glyphDiagram3dNodeSilhouettes`'s own doc), so
      // `pickGlyphDiagram3dLabelPlacements` can pick every node's own side
      // together, reserving cells as it goes.
      const silhouettes = glyphDiagram3dNodeSilhouettes(layout.nodes, frame.camera, frame.cols, frame.rows, frame.cellAspect, frame.toWorld);
      const picks = pickGlyphDiagram3dLabelPlacements(
        labeledNodes,
        (node) => node.label.split("\n")[0] ?? node.id,
        labelMode, labelDirection, layoutKind, frame.camera, frame.cols, frame.rows, frame.cellAspect, silhouettes,
        (node) => {
          // The node's own REAL projected front-face screen width, from
          // the frame's ACTUAL camera (never an estimate) — see this
          // file's own `resolveGlyphDiagram3dLabelPlacement` doc.
          const leftEdge: Vec3 = [node.center[0] - node.half[0], node.center[1] - node.half[1], node.center[2]];
          const rightEdge: Vec3 = [node.center[0] + node.half[0], node.center[1] - node.half[1], node.center[2]];
          return Math.abs(project(frame, rightEdge).col - project(frame, leftEdge).col);
        },
        frame.toWorld,
      );
      for (const node of labeledNodes) {
        const pick = picks.get(node.id);
        if (!pick) continue;
        const { placement, dropped } = pick;
        // Dropped (no candidate side cleared every silhouette or every
        // already-claimed label) — this module has no ledger to report
        // into (that lives in `render3d.ts`, which independently reaches
        // the SAME verdict from its own reference-camera silhouettes and
        // logs it there, this function's own doc); skip placing it rather
        // than showing it over geometry regardless.
        if (dropped || placement.text.length === 0) continue;
        const { col: colF, row: rowF, depth: anchorDepth } = project(frame, placement.anchor);
        // D2 round 8 — a short LEADER dot from the node's own real edge
        // (`leaderFrom`) to the label, when it isn't flush against that
        // edge (`GLYPH_DIAGRAM_3D_LEADER_MIN_CELLS`). Stamped directly
        // (never through the label arbiter — a leader has no text
        // collision to arbitrate), so it paints regardless of whether the
        // arbiter goes on to accept or refuse the label text itself at
        // this exact cell (a documented, rare residual: this module's own
        // pre-check already keeps that mismatch at zero across every one
        // of this round's own fixtures,
        // round 8").
        if (placement.isSide && placement.leaderFrom) {
          const from = project(frame, placement.leaderFrom);
          if (Math.hypot(colF - from.col, rowF - from.row) > GLYPH_DIAGRAM_3D_LEADER_MIN_CELLS) {
            stampGlyphOverlayLine(
              grid, { col: Math.round(from.col), row: Math.round(from.row), depth: from.depth },
              { col: Math.round(colF), row: Math.round(rowF), depth: anchorDepth }, GLYPH_DIAGRAM_3D_LEADER_CHAR, labelColor,
            );
          }
        }
        // No `depth` here on purpose: occlusion by a FOREIGN mesh is
        // already the `ownMeshIds`/`winnerMesh` check the shared arbiter
        // performs (AGENTS.md's "Scene objects" Declutter clause).
        frame.labels.place({
          id: `node:${node.id}`, priority: node.degree, col: Math.round(colF), row: Math.round(rowF),
          text: placement.text, color: labelColor, ownMeshIds: frame.ownMeshIds,
        });
      }
    },
  };

  const nodeCorners = layout.nodes.flatMap((n) => boxCorners(n));
  const edgeCorners = layout.edges.flatMap((e) => e.points);
  const groupCorners = layout.groups.flatMap((g): Vec3[] => [g.min, g.max]);
  const allPoints = [...nodeCorners, ...edgeCorners, ...groupCorners];
  const bounds = allPoints.length === 0
    ? { min: [0, 0, 0] as Vec3, max: [0, 0, 0] as Vec3 }
    : {
      min: [Math.min(...allPoints.map((p) => p[0])), Math.min(...allPoints.map((p) => p[1])), Math.min(...allPoints.map((p) => p[2]))] as Vec3,
      max: [Math.max(...allPoints.map((p) => p[0])), Math.max(...allPoints.map((p) => p[1])), Math.max(...allPoints.map((p) => p[2]))] as Vec3,
    };

  return {
    id: options.id ?? "diagram",
    meshes,
    overlays: [overlay],
    bounds,
  };
}

// Re-export the group type for `render3d.ts`'s own bounds/fit computations.
export type { GlyphDiagram3dGroup };
