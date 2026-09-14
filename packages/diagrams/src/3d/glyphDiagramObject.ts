/**
 * `glyphDiagramObject` (PLAN-3d.md §6, packet D1; readability fixed in D2's
 * review round; group meshes retired for overlay outlines in D2 fix round
 * 2; the whole layered path rebuilt on a plane embedding in D2 round 5) —
 * a `GlyphGraph` (the same IR the Mermaid/JSON adapters build) to a
 * `GlyphSceneObject` any `createGlyphScene` can mount via
 * `scene.addObject()`. Stable mesh names, per PLAN-3d.md §3.1: one
 * `node:<id>` mesh per node (so a single agent's box is its own effect
 * target) — PLAIN meshes only (`castShadow`/`receiveShadow`, `depthBias`),
 * never `density`/`transparent`/a differing `mode`/`glyphPalette`/
 * `ambientIntensity`, since `render3d.ts` routes through the public
 * `compileScene({ objects })` (packet F5b), which REJECTS any member mesh
 * declaring one of those.
 *
 * Edges are NOT meshes — they stay depth-tested, in-grid OVERLAY stamps
 * (`stampGlyphOverlayLine`), the same reason `@glyphcss/maps`' `line`/
 * `contour` layers are stamps rather than tube meshes. Node labels go
 * through the SAME shared `GlyphLabelArbiter` a chart's ticks or another
 * diagram's own labels use, so two diagrams (or a diagram and a chart)
 * mounted in one scene never overwrite each other's text.
 *
 * **D2 round 5 — every node's mesh, and every edge/group/label point this
 * overlay stamps, is built in the LOCAL plane frame `layout3d.ts`'s
 * `glyphDiagram3dPlaneAxes()` defines and then mapped to WORLD through the
 * SAME `u`/`n` ground-plane basis vectors that module already used to
 * compute `layout3d`'s own `node.center`/edge `points`.** For a LAYERED
 * layout, `layout3d.ts` already hands this module WORLD-space `center`/
 * `points` — the only thing genuinely LOCAL to a single node is its own
 * BOX GEOMETRY (built axis-aligned at the origin via the EXISTING
 * `boxPolygons`/`zUpCylinderPolygons`/`decisionPolygons` helpers, entirely
 * unchanged) and then placed via `toWorldFrame`, so a box's own width axis
 * is always exactly `u` (the flow-preserving ground direction) and its
 * depth axis is always exactly `n` (`u`'s ground-plane perpendicular) —
 * never re-derived, never independently rotated. A FORCE layout has no
 * shared plane at all (every node's own center/axes are literal world
 * X/Y/Z, unchanged from before this round), so `toWorldFrame` degenerates
 * there to a plain identity-frame placement (`u = X̂`, `n = Ŷ`).
 */
import type { GlyphGraph, GlyphGraphDirection } from "../types";
import type { GlyphCanvasTier, GlyphCanvasTierName, GlyphOverlayFrame, GlyphSceneObject, GlyphSceneObjectMesh, GlyphSceneOverlay, Polygon, Vec3 } from "glyphcss";
import { boxPolygons, spherePolygons, cylinderPolygons, stampGlyphOverlayCell, stampGlyphOverlayLine, GLYPH_CANVAS_TIERS } from "glyphcss";
import { layout3d, glyphDiagram3dPlaneAxes, GLYPH_DIAGRAM_3D_CAMERA_ROT_Y, type GlyphDiagram3dGroup, type GlyphDiagram3dLayout, type GlyphDiagram3dLayoutOptions, type GlyphDiagram3dNode } from "./layout3d";

/**
 * D2 round 3 ("architecture objects" — verbatim user feedback: "make them
 * vertical 3d boxes and objects with labels either to the side or inside").
 * Shape-aware node geometry, checked against core FIRST: `cylinderPolygons`
 * already exists (`@glyphcss/core`) but is Y-AXIS-ALIGNED (height runs
 * along Y), while glyphcss's world is Z-up throughout (AGENTS.md's
 * "Numeric conventions"). This wraps it with the axis remap
 * `toZUp(v) = [v[0], -v[2], v[1]]` — a proper (determinant +1) rotation,
 * verified both algebraically and numerically, so winding/normals need no
 * extra reversal — converting the INPUT center via the inverse
 * `fromZUp(w) = [w[0], w[2], -w[1]]` first.
 */
function fromZUp(w: Vec3): Vec3 { return [w[0], w[2], -w[1]]; }
function toZUp(v: Vec3): Vec3 { return [v[0], -v[2], v[1]]; }

/**
 * D2 round 4 (visual review): core's `cylinderPolygons` default of 16
 * `sides` reads fine as a SOLID-shaded mesh but traces one crease per side
 * under `ink`/`wireframe` line art — at diagram scale that is FAR more
 * linework than a 6-face box gets. 8 is the fewest sides that still reads
 * unambiguously as round rather than a hexagon/octagon in box-drawing/
 * braille line art, while roughly halving the crease count.
 */
const GLYPH_DIAGRAM_3D_CYLINDER_SIDES = 8;

function zUpCylinderPolygons(opts: { readonly center: Vec3; readonly radius: number; readonly height: number; readonly color: string }): Polygon[] {
  const raw = cylinderPolygons({ center: fromZUp(opts.center), radius: opts.radius, height: opts.height, sides: GLYPH_DIAGRAM_3D_CYLINDER_SIDES, color: opts.color });
  return raw.map((poly) => ({ ...poly, vertices: poly.vertices.map(toZUp) }));
}

/** Rotate a point 45 degrees about `center`'s own Z axis. Operates on LOCAL (pre-`toWorldFrame`) coordinates for a node's own shape, so a "45 degrees about Z" rotation here means "45 degrees within the box's own footprint plane" (whatever `u`/`n` that later maps to) — never a rotation about WORLD X/Y, which would only coincide with the footprint plane when `u`/`n` happen to equal literal world X/Y. */
function rotateZ45(p: Vec3, center: Vec3): Vec3 {
  const dx = p[0] - center[0], dy = p[1] - center[1];
  const c = Math.SQRT1_2; // cos(45deg) === sin(45deg)
  return [center[0] + dx * c - dy * c, center[1] + dx * c + dy * c, p[2]];
}

/**
 * The "decision object" for a `diamond`/rhombus Mermaid node — a rotated
 * box rather than an octahedron (reads immediately as "the diamond shape"
 * from a 3/4 camera, matching the 2D flowchart diamond it replaces). Built
 * and rotated in LOCAL coordinates (`opts.center` is `[0, 0, 0]` at every
 * call site — `toWorldFrame` places it afterward), so the 45-degree turn
 * always happens within the node's own footprint plane.
 */
function decisionPolygons(opts: { readonly center: Vec3; readonly width: number; readonly depth: number; readonly height: number; readonly color: string }): Polygon[] {
  const box = boxPolygons({ center: opts.center, width: opts.width, depth: opts.depth, height: opts.height, color: opts.color });
  return box.map((poly) => ({ ...poly, vertices: poly.vertices.map((v) => rotateZ45(v, opts.center)) }));
}

/**
 * `local = [along-u, along-n, along-Z]` (the same axis order `half`/
 * `boxPolygons`'s own width/depth/height already use) → WORLD, via the
 * plane's own `u`/`n` ground vectors — the ONE place every node's own
 * local shape geometry (built axis-aligned at the origin) is placed into
 * the scene. `u`/`n` degenerate to literal world X/Y for a FORCE layout
 * (`glyphDiagram3dPlaneAxes` is never called there — its caller always
 * passes the identity pair), so this is a no-op translation in that case,
 * byte-identical to before this round.
 */
function toWorldFrame(local: Vec3, center: Vec3, u: Vec3, n: Vec3): Vec3 {
  return [center[0] + local[0] * u[0] + local[1] * n[0], center[1] + local[0] * u[1] + local[1] * n[1], center[2] + local[2]];
}

const IDENTITY_AXES: { readonly u: Vec3; readonly n: Vec3 } = { u: [1, 0, 0], n: [0, 1, 0] };

/**
 * Shape follows Mermaid node shape: box/rect (and every other box-ish shape
 * — rounded/subroutine/asymmetric/stadium) -> box; `cylinder` (Mermaid
 * `[( )]`, a datastore) -> the Z-up cylinder wrapper above; `circle` ->
 * sphere; `diamond` -> the rotated-box decision object above. Built LOCALLY
 * (`center: [0,0,0]`) and mapped to world via `axes`/`node.center` at the
 * end — the shape-dispatch logic itself is unchanged from D2 round 3.
 */
function nodePolygons(node: GlyphDiagram3dNode, color: string, axes: { readonly u: Vec3; readonly n: Vec3 }): Polygon[] {
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
  return local.map((poly) => ({ ...poly, vertices: poly.vertices.map((v) => toWorldFrame(v, node.center, axes.u, axes.n)) }));
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
 * D2 round 3, requirement 3 (`labels: "inside" | "side" | "auto"`) — a PURE,
 * camera-independent function shared verbatim by this module's own overlay
 * `stamp()` AND `render3d.ts`'s analytic camera fit, so the two can never
 * predict a different landing cell for the same node under the same
 * options.
 *
 * **D2 round 5 fix** — `"inside"`'s own anchor now sits on the node's own
 * FRONT face explicitly (`center - half[1]*n`, i.e. local depth 0), never
 * `center` (the box's own CENTRE depth, `half[1]` behind the front
 * face): under the old per-direction system the node's own depth axis
 * genuinely WAS a literal world axis (there was no separate "front vs
 * centre" concept, and no non-axis-aligned `n` to speak of), but this
 * round's boxes are centred `half[1]` BEHIND their own visible front plane
 * by construction (so they extrude backward from it) — leaving the centre
 * in place would draw an "inside" label floating off the box's own visible
 * top edge instead of sitting on it.
 *
 * **D2 round 6 fix (labels misplaced/overflowing under a non-axis-aligned
 * plane)** — every anchor below now moves along the node's own `u`/`n`
 * GROUND VECTORS (`axes`, default the identity pair — byte-identical for
 * `force` layout, whose axes genuinely ARE world X/Y, and for a bare unit
 * test that passes no `axes` at all), never a literal `center[0]`/`center[1]`
 * COMPONENT shift. `glyphDiagram3dPlaneAxes`'s own `u`/`n` are NOT
 * axis-aligned in general (at the module's own default `rotY: 30`,
 * `u ≈ [-0.5, 0.866, 0]`) — round 5 shipped this function still doing
 * `center[0] + half[0]` (literally "move by `half[0]` along world X"),
 * which is only correct when `u === [1,0,0]` exactly (the `force` layout's
 * own case, which is why the existing pinned tests — built with an
 * arbitrary `center`/`half` and no `axes` at all — never caught it). Under
 * the real LAYERED plane this put a `"side"` label's `leaderFrom` many
 * world units from the node's own edge (measured on the transformer
 * fixture's `embed` node: the buggy point landed at `[2.3, 7.4, -0.5]`
 * against the correct `[-11.9, 15.6, -6.5]`) and an `"inside"` label's
 * anchor off the node's own front-face plane by `half[1] * (1 - |n[y]|)`
 * world units. `"below"` needed no fix — it moves along literal world Z
 * only, which has zero screen-column contribution under this camera
 * regardless of `u`/`n` (`layout3d.ts`'s own doc), so a Z-only shift was
 * already correct in every basis.
 *
 * **D2 round 6 fix (labels overflowing their own block)** — `screenWidthCols`,
 * when given, is the node's own front face's REAL PROJECTED SCREEN WIDTH
 * (columns) and REPLACES `node.half[0] * 2` (world units) as the "does it
 * fit" / clip budget. These are NOT the same quantity and conflating them
 * was the actual defect: a node's own front-face width in WORLD units maps
 * to screen columns at `worldWidth * zoom / cellPxW` (`layout3d.ts`'s own
 * width/height-scale-asymmetry doc), so at any auto-fit `zoom` below
 * `cellPxW` (25) — the ordinary case for a multi-node diagram, since the
 * auto-fit zooms OUT to fit the whole layout — a box's SCREEN width is
 * narrower than its own WORLD-unit label budget, so a label the old check
 * called "fits" (world units) genuinely overflowed on screen (measured on
 * the transformer fixture: "Input Embedding" node half-width 9.5 world
 * units passed the old `floor(19) >= 16` check, but at the auto-fit's
 * `zoom: 15.4` the box's real screen width is `~11.7` columns — 4-5
 * columns short of the 16 the label needs). `screenWidthCols` omitted
 * falls back to the old world-unit heuristic verbatim (byte-identical),
 * for a caller (or a pinned unit test) with no camera/zoom to derive it
 * from; both real call sites now supply it (`glyphDiagramObject`'s stamp
 * from the REAL `frame.camera` — correct under a live-orbited view too —
 * and `render3d.ts`'s fit from its own closed-form projected zoom).
 * Padding: `screenWidthCols` reserves >= 1 column on EACH side (the
 * brief's own requirement) by budgeting `floor(screenWidthCols) - 2` cells
 * for text, never the raw width.
 */
export function resolveGlyphDiagram3dLabelPlacement(
  node: GlyphDiagram3dNode, rawText: string, mode: GlyphDiagram3dLabelMode = "auto",
  sideDirection: "right" | "below" = "right", screenWidthCols?: number,
  axes: { readonly u: Vec3; readonly n: Vec3 } = IDENTITY_AXES,
): GlyphDiagram3dLabelPlacement {
  const faceWidthCells = screenWidthCols !== undefined
    ? Math.max(1, Math.floor(screenWidthCols) - 2)
    : Math.max(1, Math.floor(node.half[0] * 2));
  const fitsInside = rawText.length <= faceWidthCells;
  // Front face: `center - half[1]*n` (vector, along the plane's own depth
  // axis) — NOT `center[1] - half[1]` (a literal world-Y component shift,
  // wrong whenever `n` isn't `[0,1,0]`; see this function's own D2 round 6
  // doc).
  const front: Vec3 = [node.center[0] - node.half[1] * axes.n[0], node.center[1] - node.half[1] * axes.n[1], node.center[2]];
  const top: Vec3 = [front[0], front[1], node.center[2] + node.half[2]];
  if (mode === "inside" || (mode === "auto" && fitsInside)) {
    const text = rawText.length > faceWidthCells ? rawText.slice(0, faceWidthCells) : rawText;
    return { anchor: top, text, isSide: false };
  }
  const gap = 1;
  if (sideDirection === "below") {
    const bottom: Vec3 = [node.center[0], node.center[1], node.center[2] - node.half[2]];
    const anchor: Vec3 = [node.center[0], node.center[1], node.center[2] - node.half[2] - gap];
    return { anchor, text: rawText, isSide: true, leaderFrom: bottom };
  }
  // Right edge: `center + half[0]*u` (vector, along the plane's own ground
  // direction) — NOT `center[0] + half[0]` (a literal world-X component
  // shift, wrong whenever `u` isn't `[1,0,0]`).
  const rightEdge: Vec3 = [node.center[0] + node.half[0] * axes.u[0], node.center[1] + node.half[0] * axes.u[1], top[2]];
  const leaderFrom: Vec3 = rightEdge;
  const anchor: Vec3 = [rightEdge[0] + gap * axes.u[0], rightEdge[1] + gap * axes.u[1], top[2]];
  return { anchor, text: rawText, isSide: true, leaderFrom };
}

/** LR/RL -> `"below"`, everything else (TB/BT/unset) -> `"right"`. Shared by this module's overlay and `render3d.ts`'s analytic fit so both pick the identical side. */
export function glyphDiagram3dLabelSideDirection(direction: GlyphGraphDirection | undefined): "right" | "below" {
  return direction === "LR" || direction === "RL" ? "below" : "right";
}

const DEFAULT_NODE_COLOR = "#8fb4ff";
const DEFAULT_EDGE_COLOR = "#cbd5e1";
const DEFAULT_GROUP_COLOR = "#334155";
const DEFAULT_LABEL_COLOR = "#f8fafc";
/** High-contrast against the default light node fill — a border, not a shading value. */
const DEFAULT_BOX_OUTLINE_COLOR = "#0f172a";

export interface GlyphDiagramObjectOptions extends GlyphDiagram3dLayoutOptions {
  /** Object id — must be unique among objects mounted in the same scene. Default `"diagram"`. */
  readonly id?: string;
  readonly nodeColor?: string | ((node: GlyphDiagram3dLayout["nodes"][number]) => string);
  readonly edgeColor?: string;
  readonly groupColor?: string;
  readonly labelColor?: string;
  /** Depth-tested box-edge outline colour. Default a dark slate for contrast against `nodeColor`'s default light fill. */
  readonly boxOutlineColor?: string;
  /**
   * Draw the depth-tested 12-edge box outline. Default `true`. `render3d.ts`
   * passes `false` when the resolved render `mode` already draws every
   * polygon edge itself (`ink`/`wireframe`) — a redundant overlay outline
   * there would double-stamp the same cells with a possibly different
   * glyph for no visual gain.
   */
  readonly boxOutline?: boolean;
  /**
   * Which `GLYPH_CANVAS_TIERS` glyph table the edge/arrowhead/box-outline
   * overlay reads from — `render3d.ts`'s charset resolution passes the
   * target's resolved tier; default `"ascii"` keeps a bare
   * `glyphDiagramObject(graph)` call byte-identical to before this option
   * existed.
   */
  readonly tier?: GlyphCanvasTierName;
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
   * Draw a real arrowhead on each edge's final cell. Default `true`.
   * `render3d.ts` passes `false` past an edge-count density budget — the
   * plain slope glyph still marks the edge itself, just without the extra
   * glyph write past a threshold where arrowheads read as noise rather
   * than direction.
   */
  readonly arrowheads?: boolean;
  /** `"inside"` | `"side"` | `"auto"` (default) — see `resolveGlyphDiagram3dLabelPlacement`'s own doc. */
  readonly labels?: GlyphDiagram3dLabelMode;
}

function resolveNodeColor(option: GlyphDiagramObjectOptions["nodeColor"], node: GlyphDiagram3dLayout["nodes"][number]): string {
  if (typeof option === "function") return option(node);
  return option ?? DEFAULT_NODE_COLOR;
}

type GlyphCanvasDiagonalRawKey = "-" | "|" | "/" | "\\";

/** Screen-space slope of a projected segment, snapped to `stampGlyphOverlayLine`'s own raw diagonal-key vocabulary. Under the module's own DEFAULT camera every layered edge/box-outline segment resolves to `"-"`/`"|"` exactly (D2 round 5's own zero-row/zero-col guarantees) — the diagonal branch stays reachable (and correct) the moment a caller/live-orbit viewer uses a DIFFERENT camera. */
function diagonalKey(dCol: number, dRow: number): GlyphCanvasDiagonalRawKey {
  const adx = Math.abs(dCol), ady = Math.abs(dRow);
  if (adx > ady * 2) return "-";
  if (ady > adx * 2) return "|";
  return (dCol > 0) === (dRow > 0) ? "\\" : "/";
}

/** The tier's own glyph for a segment: `tier.straight.h`/`.v` for a near-axis-aligned run, `tier.diagonal[...]` only for a genuine diagonal, `tier.dot` for a degenerate (zero-length) one. */
function segmentGlyph(tier: GlyphCanvasTier, dCol: number, dRow: number): string {
  if (dCol === 0 && dRow === 0) return tier.dot;
  const key = diagonalKey(dCol, dRow);
  if (key === "-") return tier.straight.h;
  if (key === "|") return tier.straight.v;
  return tier.diagonal[key];
}

/** Nearest of the tier's 4 arrowhead glyphs (N/E/S/W) to the screen-space DIRECTION OF TRAVEL of an edge's final segment — computed from the ACTUAL projected points (never a stored 2D port side), so it reads correctly at the fixed default camera AND under a live-orbited one. */
function arrowGlyph(tier: GlyphCanvasTier, dCol: number, dRow: number): string {
  if (Math.abs(dCol) >= Math.abs(dRow)) return dCol >= 0 ? tier.arrow.e : tier.arrow.w;
  return dRow >= 0 ? tier.arrow.s : tier.arrow.n;
}

interface ProjectedPoint { readonly col: number; readonly row: number; readonly depth: number; }

function project(frame: GlyphOverlayFrame, p: Vec3): ProjectedPoint {
  const [col, row, depth] = frame.camera.project(frame.toWorld(p), frame.cols, frame.rows, frame.cellAspect);
  return { col, row, depth };
}

/** A box's 8 LOCAL corners in the SAME (±u,±n,±z) order `boxPolygons`/`cubePolygons` use, and its 12 edges — shared by a node's own box outline AND a force-layout group's wireframe-volume overlay outline. */
const BOX_OUTLINE_EDGES: readonly (readonly [number, number])[] = [
  [0, 1], [1, 2], [2, 3], [3, 0],
  [4, 5], [5, 6], [6, 7], [7, 4],
  [0, 4], [1, 5], [2, 6], [3, 7],
];

/** A flat rectangle's 4 corners, in the SAME winding `BOX_OUTLINE_EDGES`'s first 4 entries walk — a layered group's recessed-frame overlay outline reuses just that first quarter of the table. */
const FLOOR_OUTLINE_EDGES: readonly (readonly [number, number])[] = [[0, 1], [1, 2], [2, 3], [3, 0]];

function localCornersFromMinMax(min: Vec3, max: Vec3): readonly Vec3[] {
  return [
    [min[0], min[1], min[2]], [max[0], min[1], min[2]], [max[0], max[1], min[2]], [min[0], max[1], min[2]],
    [min[0], min[1], max[2]], [max[0], min[1], max[2]], [max[0], max[1], max[2]], [min[0], max[1], max[2]],
  ];
}

/** A node's own 8 WORLD corners — LOCAL axis-aligned extents (`half`) mapped through the plane's `u`/`n` (and, for a `diamond`, rotated 45 degrees IN THAT LOCAL FRAME first, matching `decisionPolygons`'s own mesh exactly). */
function boxCorners(node: GlyphDiagram3dNode, axes: { readonly u: Vec3; readonly n: Vec3 }): readonly Vec3[] {
  const [hx, hy, hz] = node.half;
  let local = localCornersFromMinMax([-hx, -hy, -hz], [hx, hy, hz]);
  if (node.shape === "diamond") local = local.map((p) => rotateZ45(p, [0, 0, 0]));
  return local.map((p) => toWorldFrame(p, node.center, axes.u, axes.n));
}

/**
 * A layered group's own 4 WORLD corners — its `min`/`max` are the
 * "minU,minZ"/"maxU,maxZ" world corners `layout3d.ts` already computed
 * (its own `planePoint` at the group's fixed depth `z`); the other two
 * corners mix `u`'s scalar range with `n`'s fixed one, recovered by
 * projecting `min`/`max` back onto the orthonormal `u` axis (a plain dot
 * product) rather than re-deriving the 2D bounds a second time.
 */
function groupFrameCorners(group: GlyphDiagram3dGroup, axes: { readonly u: Vec3; readonly n: Vec3 }): readonly Vec3[] {
  const { u, n } = axes;
  const minU = group.min[0] * u[0] + group.min[1] * u[1];
  const maxU = group.max[0] * u[0] + group.max[1] * u[1];
  const minZ = group.min[2], maxZ = group.max[2];
  const at = (uOffset: number, zOffset: number): Vec3 => [uOffset * u[0] + group.z * n[0], uOffset * u[1] + group.z * n[1], zOffset];
  return [at(minU, minZ), at(maxU, minZ), at(maxU, maxZ), at(minU, maxZ)];
}

export async function glyphDiagramObject(graph: GlyphGraph, options: GlyphDiagramObjectOptions = {}): Promise<GlyphSceneObject> {
  const layout = await layout3d(graph, options);
  const edgeColor = options.edgeColor ?? DEFAULT_EDGE_COLOR;
  const groupColor = options.groupColor ?? DEFAULT_GROUP_COLOR;
  const labelColor = options.labelColor ?? DEFAULT_LABEL_COLOR;
  const boxOutlineColor = options.boxOutlineColor ?? DEFAULT_BOX_OUTLINE_COLOR;
  const labelNodeIds = options.labelNodeIds;
  const arrowheads = options.arrowheads ?? true;
  const boxOutline = options.boxOutline ?? true;
  const tierName = options.tier ?? "ascii";
  const labelMode = options.labels ?? "auto";
  const labelSideDirection = glyphDiagram3dLabelSideDirection(options.direction ?? graph.direction);
  const layoutKind = options.layout ?? "layered";
  const wireframeGroups = layoutKind === "force";
  // A `force` layout has no shared plane at all — every node/group/edge it
  // emits is already a literal world-space point, so its own "plane axes"
  // are the identity (`u = X̂`, `n = Ŷ`), a no-op in `toWorldFrame`/
  // `boxCorners`/`groupFrameCorners` below.
  const axes = layoutKind === "force" ? IDENTITY_AXES : glyphDiagram3dPlaneAxes(GLYPH_DIAGRAM_3D_CAMERA_ROT_Y);

  const meshes: GlyphSceneObjectMesh[] = [];
  const nodeMeshIndex = new Map<string, number>();
  for (const node of layout.nodes) {
    const color = resolveNodeColor(options.nodeColor, node);
    const polygons = nodePolygons(node, color, axes);
    nodeMeshIndex.set(node.id, meshes.length);
    meshes.push({ name: `node:${node.id}`, polygons, options: { castShadow: true, receiveShadow: true } });
  }
  // Groups are NOT a mesh — drawn as a depth-tested overlay outline instead
  // (a layered group's own recessed backdrop frame, or a force group's
  // wireframe volume), in the SAME `stamp()` below that already draws node
  // box outlines.

  const overlay: GlyphSceneOverlay = {
    id: "glyph-diagram-3d",
    stamp(grid, frame): void {
      const tier = GLYPH_CANVAS_TIERS[tierName];
      const ownMeshIdsArray = Array.from(frame.ownMeshIds);
      const meshIdForNode = (id: string): number | undefined => {
        const index = nodeMeshIndex.get(id);
        return index === undefined ? undefined : ownMeshIdsArray[index];
      };
      if (boxOutline) {
        for (const node of layout.nodes) {
          // No box edges on a sphere or a cylinder — `ink`/`wireframe`
          // render modes already trace THEIR OWN silhouette from the real
          // geometry, so this overlay only ever needs the box-ish shapes.
          if (node.shape === "circle" || node.shape === "cylinder") continue;
          const corners = boxCorners(node, axes).map((p) => project(frame, p));
          for (const [ia, ib] of BOX_OUTLINE_EDGES) {
            const a = corners[ia]!, b = corners[ib]!;
            stampGlyphOverlayLine(grid, a, b, segmentGlyph(tier, b.col - a.col, b.row - a.row), boxOutlineColor);
          }
        }
      }
      // Group outlines — unconditional, unlike the node box outline above:
      // with no backing polygon mesh, this overlay is the ONLY
      // representation of a group's boundary in every charset/mode.
      for (const group of layout.groups) {
        const edges = wireframeGroups ? BOX_OUTLINE_EDGES : FLOOR_OUTLINE_EDGES;
        const corners = (wireframeGroups ? localCornersFromMinMax(group.min, group.max) : groupFrameCorners(group, axes)).map((p) => project(frame, p));
        for (const [ia, ib] of edges) {
          const a = corners[ia]!, b = corners[ib]!;
          stampGlyphOverlayLine(grid, a, b, segmentGlyph(tier, b.col - a.col, b.row - a.row), groupColor);
        }
      }
      for (const edge of layout.edges) {
        const projected = edge.points.map((p) => project(frame, p));
        for (let i = 0; i < projected.length - 1; i++) {
          const a = projected[i]!, b = projected[i + 1]!;
          const dCol = b.col - a.col, dRow = b.row - a.row;
          stampGlyphOverlayLine(grid, a, b, segmentGlyph(tier, dCol, dRow), edgeColor);
          if (i === projected.length - 2 && arrowheads) {
            // The final segment's own arrowhead. NOT depth-tested via
            // `stampGlyphOverlayCell`'s own `depth` field against the RAW
            // winning depth — the arrow's anchor is, by definition, ON the
            // TARGET node's own surface, so a flat depth test loses it to
            // that SAME node's own nearer top face. Narrowed instead: look
            // up the depth-winning mesh (`CellGrid.winnerMesh`,
            // solid-mode-only) and refuse the write ONLY when the winner
            // is neither this edge's own source nor target node AND it is
            // nearer than the arrowhead's own point.
            const col = Math.round(b.col), row = Math.round(b.row);
            let occludedByForeignNode = false;
            if (grid.winnerMesh && col >= 0 && col < grid.cols && row >= 0 && row < grid.rows) {
              const idx = row * grid.cols + col;
              const winner = grid.winnerMesh[idx];
              if (winner !== undefined && winner !== -1) {
                const sourceId = meshIdForNode(edge.from), targetId = meshIdForNode(edge.to);
                if (winner !== sourceId && winner !== targetId) {
                  const winnerDepth = grid.depth[idx];
                  if (Number.isFinite(winnerDepth) && winnerDepth > b.depth) occludedByForeignNode = true;
                }
              }
            }
            if (!occludedByForeignNode) {
              stampGlyphOverlayCell(grid, { col, row, char: arrowGlyph(tier, dCol, dRow), color: edgeColor });
            }
          }
        }
      }
      for (const node of layout.nodes) {
        if (labelNodeIds && !labelNodeIds.has(node.id)) continue;
        const rawText = node.label.split("\n")[0] ?? node.id;
        // D2 round 6 — the node's own REAL projected front-face screen
        // width, from the frame's ACTUAL camera (never an estimate): two
        // extra projections per labelled node, always correct, and correct
        // under a live-orbited camera too (the width is re-derived every
        // stamp call, never cached from the auto-fit's own camera).
        const leftEdge = toWorldFrame([-node.half[0], -node.half[1], 0], node.center, axes.u, axes.n);
        const rightEdge = toWorldFrame([node.half[0], -node.half[1], 0], node.center, axes.u, axes.n);
        const screenWidthCols = Math.abs(project(frame, rightEdge).col - project(frame, leftEdge).col);
        const placement = resolveGlyphDiagram3dLabelPlacement(node, rawText, labelMode, labelSideDirection, screenWidthCols, axes);
        const { col: colF, row: rowF } = project(frame, placement.anchor);
        if (placement.isSide && placement.leaderFrom) {
          const from = project(frame, placement.leaderFrom), to = project(frame, placement.anchor);
          stampGlyphOverlayLine(grid, from, to, segmentGlyph(tier, to.col - from.col, to.row - from.row), labelColor);
        }
        // No `depth` here on purpose: occlusion by a FOREIGN mesh is
        // already the `ownMeshIds`/`winnerMesh` check below.
        frame.labels.place({
          id: `node:${node.id}`, priority: node.degree, col: Math.round(colF), row: Math.round(rowF),
          text: placement.text, color: labelColor, ownMeshIds: frame.ownMeshIds,
        });
      }
    },
  };

  const nodeCorners = layout.nodes.flatMap((n) => boxCorners(n, axes));
  const groupCorners = layout.groups.flatMap((g) => (wireframeGroups ? localCornersFromMinMax(g.min, g.max) : groupFrameCorners(g, axes)));
  const allPoints = [...nodeCorners, ...groupCorners];
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
