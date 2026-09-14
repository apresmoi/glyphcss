/**
 * `glyphDiagramObject` (PLAN-3d.md §6, packet D1; readability fixed in D2's
 * review round, P1-1; groups moved off a mesh in D2 fix round 2, P-groups)
 * — a `GlyphGraph` (the same IR the Mermaid/JSON adapters build) to a
 * `GlyphSceneObject` any `createGlyphScene` can mount via
 * `scene.addObject()`. Stable mesh names, per PLAN-3d.md §3.1: one
 * `node:<id>` mesh per node (so a single agent's box is its own effect
 * target) — PLAIN meshes only (`castShadow`/`receiveShadow`, `depthBias`),
 * never `density`/`transparent`/a differing `mode`/`glyphPalette`/
 * `ambientIntensity`, since `render3d.ts` now routes through the public
 * `compileScene({ objects })` (packet F5b), which REJECTS any member mesh
 * declaring one of those — AGENTS.md's own "Static compile takes a flat
 * polygon list and cannot represent detail layers" is no longer a residual
 * this object can quietly violate, it is an enforced contract.
 *
 * Edges are NOT meshes — AGENTS.md's "Scene objects" and this packet's own
 * scope keep them as depth-tested, in-grid OVERLAY stamps (`stampGlyphOverlayLine`),
 * so they stay one cell wide and legible at every zoom, the same reason
 * `@glyphcss/maps`' `line`/`contour` layers are stamps rather than tube
 * meshes. Node labels go through the SAME shared `GlyphLabelArbiter` a
 * chart's ticks or another diagram's own labels use, so two diagrams (or a
 * diagram and a chart) mounted in one scene never overwrite each other's
 * text — AGENTS.md's "Scene objects" "Declutter" clause.
 *
 * D2 review P1-1 (codex): at 80x24/96x32 a node's box rasterized to a
 * uniform `@` slab with no visible face/edge boundary and edges carried no
 * direction. Fixed at THIS layer (not render3d.ts, which only picks the
 * camera) with two additions, both tier-aware via `GLYPH_CANVAS_TIERS` (the
 * SAME glyph tables the 2D canvas painters use, per the review's own
 * instruction — never a parallel table): a depth-tested 12-edge BOX
 * OUTLINE overlay per node (so faces read as distinct planes even where
 * their Lambert intensities are close), and a real ARROWHEAD
 * (`tier.arrow.n/e/s/w`) stamped on each edge's final projected cell,
 * snapped to the nearest cardinal screen direction of travel, replacing the
 * plain slope glyph there. `GLYPH_DIAGRAM_3D_NODE_HEIGHT` itself also
 * shrank (`layout3d.ts`) so a box reads as a thin plate rather than a thick
 * block in the first place.
 *
 * D2 fix round 2 (codex, F5b lands): a `groups` mesh used to carry
 * `transparent: true` (layered floor plates) or `mode: "wireframe"` (force
 * volumes) so it separated into its own detail layer in a LIVE scene — but
 * `compileScene({ objects })`'s new `assertCompileMeshOptionsRepresentable`
 * rejects exactly those two fields with a `RangeError`, since a flat
 * static compile has no detail-layer pass to represent them with. Every
 * grouped diagram would throw the instant `renderGlyphDiagram3d` routed
 * through it. Fixed at THIS layer, not by working around the throw in
 * `render3d.ts`: groups are drawn as a depth-tested OVERLAY OUTLINE
 * (`stampGlyphOverlayLine`, the SAME tier-aware segment glyphs the node box
 * outline uses) instead of a mesh — a projected rectangle for a layered
 * floor plate (4 edges at the group's own `z`), a projected 12-edge box for
 * a force volume, both through the same `boxCornersFromMinMax`/
 * `BOX_OUTLINE_EDGES` machinery the node outline already uses. This is
 * HONEST, not a lesser stand-in: an overlay renders IDENTICALLY through
 * `compileScene` and a live `createGlyphScene` (both run the SAME
 * `stamp()`), so it also closes D2's own documented residual that static
 * and live diverge for a grouped graph — there is no longer a
 * detail-layer distinction for either path to diverge on. What IS lost,
 * stated rather than hidden: a layered floor plate's translucent FILL
 * (`transparent: true`'s whole visual point) has no overlay equivalent —
 * `stampGlyphOverlayLine`/`Cell` write opaque glyphs, not a blended tint —
 * so a group now reads as an outlined footprint, never a shaded plane.
 */
import type { GlyphGraph, GlyphGraphDirection } from "../types";
import type { GlyphCanvasTier, GlyphCanvasTierName, GlyphOverlayFrame, GlyphSceneObject, GlyphSceneObjectMesh, GlyphSceneOverlay, Polygon, Vec3 } from "glyphcss";
import { boxPolygons, spherePolygons, cylinderPolygons, stampGlyphOverlayCell, stampGlyphOverlayLine, GLYPH_CANVAS_TIERS } from "glyphcss";
import { layout3d, type GlyphDiagram3dGroup, type GlyphDiagram3dLayout, type GlyphDiagram3dLayoutOptions, type GlyphDiagram3dNode } from "./layout3d";

/**
 * D2 round 3 ("architecture objects" — verbatim user feedback: "make them
 * vertical 3d boxes and objects with labels either to the side or inside").
 * Shape-aware node geometry, checked against core FIRST per the task's own
 * instruction: `cylinderPolygons` already exists (`@glyphcss/core`) but is
 * Y-AXIS-ALIGNED (height runs along Y), while glyphcss's world is Z-up
 * throughout (AGENTS.md's "Numeric conventions"). This wraps it with the
 * axis remap `toZUp(v) = [v[0], -v[2], v[1]]` — a proper (determinant +1)
 * rotation, verified both algebraically and numerically, so winding/normals
 * need no extra reversal — converting the INPUT center via the inverse
 * `fromZUp(w) = [w[0], w[2], -w[1]]` first. No new core geometry primitive:
 * this is the smallest correct bridge over what already exists.
 */
function fromZUp(w: Vec3): Vec3 { return [w[0], w[2], -w[1]]; }
function toZUp(v: Vec3): Vec3 { return [v[0], -v[2], v[1]]; }

/**
 * D2 round 4 (visual review, this round's own frame captures): core's
 * `cylinderPolygons` default of 16 `sides` reads fine as a SOLID-shaded
 * mesh but traces one crease per side under `ink`/`wireframe` line art —
 * at diagram scale (a handful of screen cells across) that is FAR more
 * linework than a 6-face box gets, and it read as visual noise rather than
 * "a cylinder." 8 is the fewest sides that still reads unambiguously as
 * round rather than a hexagon/octagon in box-drawing/braille line art,
 * while roughly halving the crease count.
 */
const GLYPH_DIAGRAM_3D_CYLINDER_SIDES = 8;

function zUpCylinderPolygons(opts: { readonly center: Vec3; readonly radius: number; readonly height: number; readonly color: string }): Polygon[] {
  const raw = cylinderPolygons({ center: fromZUp(opts.center), radius: opts.radius, height: opts.height, sides: GLYPH_DIAGRAM_3D_CYLINDER_SIDES, color: opts.color });
  return raw.map((poly) => ({ ...poly, vertices: poly.vertices.map(toZUp) }));
}

/** Rotate a point 45 degrees about `center`'s own Z axis — glyphcss's world is Z-up, so this is a plain 2D rotation in the X/Y plane holding Z fixed. */
function rotateZ45(p: Vec3, center: Vec3): Vec3 {
  const dx = p[0] - center[0], dy = p[1] - center[1];
  // cos(45deg) === sin(45deg)
  const c = Math.SQRT1_2;
  return [center[0] + dx * c - dy * c, center[1] + dx * c + dy * c, p[2]];
}

/**
 * The "decision object" for a `diamond`/rhombus Mermaid node (message 2,
 * requirement 1: "pick something that reads"). A rotated box rather than an
 * octahedron (core has one, `octahedronPolygons`, but it reads as a
 * generic gem in isometric — a box rotated 45 degrees about its own vertical
 * axis reads immediately as "the diamond shape" from the same 3/4 camera a
 * flowchart diamond already uses in 2D, and it is the lower-risk of the two:
 * `boxPolygons`' own output rotated about `center`, no new geometry math).
 */
function decisionPolygons(opts: { readonly center: Vec3; readonly width: number; readonly depth: number; readonly height: number; readonly color: string }): Polygon[] {
  const box = boxPolygons({ center: opts.center, width: opts.width, depth: opts.depth, height: opts.height, color: opts.color });
  return box.map((poly) => ({ ...poly, vertices: poly.vertices.map((v) => rotateZ45(v, opts.center)) }));
}

/**
 * Shape follows Mermaid node shape (message 2, requirement 1): box/rect
 * (and every other box-ish shape — rounded/subroutine/asymmetric/stadium,
 * which have no distinct 3D read of their own) -> box; `cylinder` (Mermaid
 * `[( )]`, a datastore) -> the Z-up cylinder wrapper above; `circle` ->
 * sphere (unchanged from D1); `diamond` -> the rotated-box decision object
 * above.
 */
function nodePolygons(node: GlyphDiagram3dNode, color: string): Polygon[] {
  const [hx, hy, hz] = node.half;
  switch (node.shape) {
    case "circle":
      return spherePolygons({ center: node.center, size: Math.max(hx, hy, hz), color });
    case "cylinder":
      return zUpCylinderPolygons({ center: node.center, radius: Math.max(hx, hy), height: hz * 2, color });
    case "diamond":
      return decisionPolygons({ center: node.center, width: hx * 2, depth: hy * 2, height: hz * 2, color });
    default:
      return boxPolygons({ center: node.center, width: hx * 2, depth: hy * 2, height: hz * 2, color });
  }
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
 * `stamp()` AND `render3d.ts`'s analytic camera fit (`fitDiagramCamera`), so
 * the two can never predict a different landing cell for the same node
 * under the same options (the exact "synchronized change" risk flagged
 * while this was being designed). Kept ANCHOR-PLUS-RIGHTWARD-RUN shaped
 * (never centered) on purpose: the existing closed-form fit solves one
 * linear inequality per candidate assuming exactly this shape, and every
 * DEFAULT-sized node (no explicit `size`) already has a footprint at least
 * as wide as its own label (`layout3d.ts`'s `resolveNodeSize` sizes it that
 * way when no custom `size` is given) — so `"auto"` degrades to `"inside"`
 * with THIS EXACT anchor for every fixture that predates this option,
 * byte-identical. A node given an explicit, label-narrower `size` (the CNN
 * fixture's conv/pool layers) is where `"auto"` first falls through to
 * `"side"`.
 *
 * `"inside"`: the label never spills — text past the node's own footprint
 * width (in cells, `half[0] * 2`) is CLIPPED, never elided (message 2's own
 * "labels are last, disjoint... a label never floats unattached, never
 * spills across another object", generalized from 2D to a 3D face).
 * `"side"`: a callout in the free space beside the node, with `leaderFrom`
 * exactly on the node's own right-edge cell so the drawn leader line always
 * touches its object.
 */
export function resolveGlyphDiagram3dLabelPlacement(
  node: GlyphDiagram3dNode, rawText: string, mode: GlyphDiagram3dLabelMode = "auto",
  // D2 round 4, requirement 5: ONE consistent side direction per flow
  // direction — "below" for LR/RL (the CNN convention: dims sit under each
  // block, not floating to its right where the NEXT object already stands),
  // "right" (unchanged from round 3) for TB/BT, where the flow itself is
  // vertical so a side callout to the right never competes with it.
  sideDirection: "right" | "below" = "right",
): GlyphDiagram3dLabelPlacement {
  const faceWidthCells = Math.max(1, Math.floor(node.half[0] * 2));
  const fitsInside = rawText.length <= faceWidthCells;
  const top: Vec3 = [node.center[0], node.center[1], node.center[2] + node.half[2]];
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
  const leaderFrom: Vec3 = [node.center[0] + node.half[0], node.center[1], top[2]];
  const anchor: Vec3 = [node.center[0] + node.half[0] + gap, node.center[1], top[2]];
  return { anchor, text: rawText, isSide: true, leaderFrom };
}

/** LR/RL -> `"below"`, everything else (TB/BT/unset) -> `"right"` (D2 round 4, requirement 5). Shared by this module's overlay and `render3d.ts`'s analytic fit so both pick the identical side. */
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
  /** Depth-tested box-edge outline colour (D2 review P1-1). Default a dark slate for contrast against `nodeColor`'s default light fill. */
  readonly boxOutlineColor?: string;
  /**
   * Draw the depth-tested 12-edge box outline (D2 review P1-1). Default
   * `true`. `render3d.ts` passes `false` when the resolved render `mode` is
   * `"wireframe"` (the `braille` charset) — wireframe already rasterizes
   * every polygon EDGE itself, so a box's own 12 edges are already drawn by
   * the base render; a redundant overlay outline there would double-stamp
   * the same cells with a possibly different glyph for no visual gain.
   */
  readonly boxOutline?: boolean;
  /**
   * Which `GLYPH_CANVAS_TIERS` glyph table the edge/arrowhead/box-outline
   * overlay reads from — `render3d.ts`'s D2 charset resolution passes the
   * target's resolved tier; default `"ascii"` keeps a bare
   * `glyphDiagramObject(graph)` call (no `render3d` involved, e.g. this
   * package's own unit tests) byte-identical to before this option existed.
   */
  readonly tier?: GlyphCanvasTierName;
  /**
   * D2 fix round 3, P1-2 (large-graph legibility): when given, ONLY nodes
   * whose id is in this set get a placed label — every other node's box
   * still renders (and still occludes/gets occluded normally), just with
   * no label candidate registered at all. `render3d.ts`'s own adaptive
   * policy computes this set (highest-degree nodes first) past a
   * node-count threshold; `undefined` (the default, and every bare
   * `glyphDiagramObject(graph)` call with no `render3d` involved) shows
   * every node's label, byte-identical to before this option existed.
   */
  readonly labelNodeIds?: ReadonlySet<string>;
  /**
   * D2 fix round 3, P1-2 (large-graph legibility): draw a real arrowhead
   * on each edge's final cell (D2 review P1-1). Default `true`, byte-
   * identical to before this option existed. `render3d.ts` passes `false`
   * past an edge-count density budget — the plain slope glyph still marks
   * the edge itself, just without the extra glyph write past a threshold
   * where arrowheads read as noise rather than direction.
   */
  readonly arrowheads?: boolean;
  /**
   * D2 round 3, requirement 3: `"inside"` | `"side"` | `"auto"` (default).
   * See `resolveGlyphDiagram3dLabelPlacement`'s own doc for the exact rule;
   * `render3d.ts` reads this SAME option so its analytic camera fit predicts
   * the identical anchor this overlay actually draws at.
   */
  readonly labels?: GlyphDiagram3dLabelMode;
}

function resolveNodeColor(option: GlyphDiagramObjectOptions["nodeColor"], node: GlyphDiagram3dLayout["nodes"][number]): string {
  if (typeof option === "function") return option(node);
  return option ?? DEFAULT_NODE_COLOR;
}

type GlyphCanvasDiagonalRawKey = "-" | "|" | "/" | "\\";

/** Screen-space slope of a projected segment, snapped to `stampGlyphOverlayLine`'s own raw diagonal-key vocabulary — the SAME classification `inkGlyphForTangent` uses, so `tier.diagonal[key]` always resolves. */
function diagonalKey(dCol: number, dRow: number): GlyphCanvasDiagonalRawKey {
  const adx = Math.abs(dCol), ady = Math.abs(dRow);
  if (adx > ady * 2) return "-";
  if (ady > adx * 2) return "|";
  return (dCol > 0) === (dRow > 0) ? "\\" : "/";
}

/**
 * The tier's own glyph for a segment: `tier.straight.h`/`.v` for a
 * near-axis-aligned run (the CRISP box-drawing `─`/`│` on `box`/`blocks`/
 * `braille` — D2 review P1-1's own box-outline fix depends on this: reading
 * every segment through `tier.diagonal` alone, even a near-axis one, always
 * resolves to that table's plain-ASCII-shaped entries, since box-drawing has
 * no diagonal glyph to begin with — `tier.diagonal[...]` ONLY for a genuine
 * diagonal, and `tier.dot` for a degenerate (zero-length) one, the same
 * fallback D1's own plain-ASCII `edgeGlyph` used for its `"."` case.
 */
function segmentGlyph(tier: GlyphCanvasTier, dCol: number, dRow: number): string {
  if (dCol === 0 && dRow === 0) return tier.dot;
  const key = diagonalKey(dCol, dRow);
  if (key === "-") return tier.straight.h;
  if (key === "|") return tier.straight.v;
  return tier.diagonal[key];
}

/** Nearest of the tier's 4 arrowhead glyphs (N/E/S/W — `GLYPH_CANVAS_TIERS` carries no diagonal arrow) to the screen-space DIRECTION OF TRAVEL of an edge's final segment, so the arrow visually points into the target it just entered. */
function arrowGlyph(tier: GlyphCanvasTier, dCol: number, dRow: number): string {
  if (Math.abs(dCol) >= Math.abs(dRow)) return dCol >= 0 ? tier.arrow.e : tier.arrow.w;
  return dRow >= 0 ? tier.arrow.s : tier.arrow.n;
}

interface ProjectedPoint { readonly col: number; readonly row: number; readonly depth: number; }

function project(frame: GlyphOverlayFrame, p: Vec3): ProjectedPoint {
  const [col, row, depth] = frame.camera.project(frame.toWorld(p), frame.cols, frame.rows, frame.cellAspect);
  return { col, row, depth };
}

/**
 * A box's 8 corners in the SAME (±x,±y,±z) order `boxPolygons`/`cubePolygons`
 * use, and its 12 edges (4 bottom, 4 top, 4 vertical) — shared by a node's
 * own box outline AND a force-layout group's wireframe-volume overlay
 * outline (D2 fix round 2).
 */
const BOX_OUTLINE_EDGES: readonly (readonly [number, number])[] = [
  [0, 1], [1, 2], [2, 3], [3, 0],
  [4, 5], [5, 6], [6, 7], [7, 4],
  [0, 4], [1, 5], [2, 6], [3, 7],
];

/** A flat rectangle's 4 corners, in the SAME winding `BOX_OUTLINE_EDGES`'s first 4 entries (`[0,1],[1,2],[2,3],[3,0]`) walk — a layered group's floor-plate overlay outline reuses just that first quarter of the table. */
const FLOOR_OUTLINE_EDGES: readonly (readonly [number, number])[] = [[0, 1], [1, 2], [2, 3], [3, 0]];

function boxCornersFromMinMax(min: Vec3, max: Vec3): readonly Vec3[] {
  return [
    [min[0], min[1], min[2]], [max[0], min[1], min[2]], [max[0], max[1], min[2]], [min[0], max[1], min[2]],
    [min[0], min[1], max[2]], [max[0], min[1], max[2]], [max[0], max[1], max[2]], [min[0], max[1], max[2]],
  ];
}

function boxCorners(node: GlyphDiagram3dNode): readonly Vec3[] {
  const [cx, cy, cz] = node.center, [hx, hy, hz] = node.half;
  const corners = boxCornersFromMinMax([cx - hx, cy - hy, cz - hz], [cx + hx, cy + hy, cz + hz]);
  // A `diamond` node's mesh (`decisionPolygons`) is a box rotated 45 degrees
  // about its own center — its OUTLINE corners must rotate identically, or
  // the crisp outline would trace a box the mesh underneath it doesn't own.
  return node.shape === "diamond" ? corners.map((p) => rotateZ45(p, node.center)) : corners;
}

/** A layered group's floor-plate footprint, 4 corners at its own `z` — D2 fix round 2's overlay replacement for the old translucent-quad mesh. */
function groupFloorCorners(group: GlyphDiagram3dGroup): readonly Vec3[] {
  const z = group.z;
  return [[group.min[0], group.min[1], z], [group.max[0], group.min[1], z], [group.max[0], group.max[1], z], [group.min[0], group.max[1], z]];
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
  // The EFFECTIVE direction is `options.direction ?? graph.direction` — the
  // same fallback `pipeline.ts`'s `measureGlyphGraph` resolves internally
  // (`options.direction ?? canonical.direction`), so this reads the SAME
  // direction the layout itself actually used, not just an override.
  const labelSideDirection = glyphDiagram3dLabelSideDirection(options.direction ?? graph.direction);
  const wireframeGroups = (options.layout ?? "layered") === "force";

  const meshes: GlyphSceneObjectMesh[] = [];
  // Node id -> this mesh's own POSITION in `meshes` (declaration order) —
  // D2 fix round 3, P1-1. Both `compileScene({ objects })` and a live
  // `createGlyphScene.addObject()` assign each object's mesh ids by
  // walking `object.meshes` in exactly this array order and inserting
  // into `ownMeshIds` (a `Set`, so insertion order is preserved) in that
  // same order — `winnerPolygon`/`winnerMesh`'s own doc calls the id
  // "opaque" and says a caller "resolves it through their own immutable
  // scene lineage", which is precisely this: `Array.from(frame.ownMeshIds)
  // [nodeMeshIndex.get(id)]` recovers THIS node's own global mesh id with
  // no dependence on the numbering scheme itself, only on mesh order,
  // which this closure controls.
  const nodeMeshIndex = new Map<string, number>();
  for (const node of layout.nodes) {
    const color = resolveNodeColor(options.nodeColor, node);
    const polygons = nodePolygons(node, color);
    nodeMeshIndex.set(node.id, meshes.length);
    meshes.push({ name: `node:${node.id}`, polygons, options: { castShadow: true, receiveShadow: true } });
  }
  // Groups are NOT a mesh (D2 fix round 2) — `compileScene({ objects })`
  // rejects a member declaring `transparent`/a differing `mode` (this
  // module's own top-of-file doc), which the old floor-plate/wireframe-volume
  // mesh always did. Drawn as a depth-tested overlay outline instead, in the
  // SAME `stamp()` below that already draws node box outlines.

  const overlay: GlyphSceneOverlay = {
    id: "glyph-diagram-3d",
    stamp(grid, frame): void {
      const tier = GLYPH_CANVAS_TIERS[tierName];
      // D2 fix round 3, P1-1: `Array.from` preserves `Set` insertion order,
      // so `ownMeshIdsArray[nodeMeshIndex.get(id)]` is this render's own
      // global mesh id for that node — see `nodeMeshIndex`'s own doc above.
      const ownMeshIdsArray = Array.from(frame.ownMeshIds);
      const meshIdForNode = (id: string): number | undefined => {
        const index = nodeMeshIndex.get(id);
        return index === undefined ? undefined : ownMeshIdsArray[index];
      };
      // Box outlines FIRST (D2 review P1-1): every corner is an exact box
      // vertex, so depth along a straight edge between two of them is exact
      // (not an approximation), and `stampGlyphOverlayCell`'s depth rule
      // (equal wins the write) lets the outline paint exactly on the solid
      // fill's own surface rather than floating above/below it.
      if (boxOutline) {
        for (const node of layout.nodes) {
          // No box edges on a sphere or a cylinder (D2 round 3) — `ink`/
          // `wireframe` render modes already trace THEIR OWN silhouette from
          // the real geometry (message 2: "REUSE the renderer's modes"), so
          // this overlay only ever needs to draw the box-ish shapes at all.
          if (node.shape === "circle" || node.shape === "cylinder") continue;
          const corners = boxCorners(node).map((p) => project(frame, p));
          for (const [ia, ib] of BOX_OUTLINE_EDGES) {
            const a = corners[ia]!, b = corners[ib]!;
            stampGlyphOverlayLine(grid, a, b, segmentGlyph(tier, b.col - a.col, b.row - a.row), boxOutlineColor);
          }
        }
      }
      // Group outlines (D2 fix round 2) — unconditional, unlike the node
      // box outline above: with NO backing polygon mesh any more, this
      // overlay is the ONLY representation of a group's boundary in every
      // charset/mode, including wireframe, so it can't be skipped there the
      // way the node outline is (which skips only because wireframe mode
      // already rasterizes that SAME boundary from real geometry).
      for (const group of layout.groups) {
        const edges = wireframeGroups ? BOX_OUTLINE_EDGES : FLOOR_OUTLINE_EDGES;
        const corners = (wireframeGroups ? boxCornersFromMinMax(group.min, group.max) : groupFloorCorners(group)).map((p) => project(frame, p));
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
            // The final segment's own arrowhead — D2 review P1-1: a plain
            // slope glyph carried no direction at all. NOT depth-tested via
            // `stampGlyphOverlayCell`'s own `depth` field against the RAW
            // winning depth — the arrow's anchor is, by definition, ON the
            // TARGET node's own surface, so a flat depth test loses it to
            // that SAME node's own nearer top face (measured, D2 fix round
            // 1: 0 of 4 arrowheads painted in the reference graph).
            //
            // D2 fix round 3, P1-1 (codex): that exemption was too WIDE — it
            // let the arrowhead paint through a genuinely FOREIGN node
            // sitting nearer at that exact cell too, since no depth test ran
            // at all. Narrowed here: look up the depth-winning mesh
            // (`CellGrid.winnerMesh`, solid-mode-only) and refuse the write
            // ONLY when the winner is neither this edge's own source nor
            // target node AND it is nearer than the arrowhead's own point —
            // any OTHER node (a sibling in this same diagram, or a genuinely
            // foreign mesh) still occludes exactly like the line segment
            // above it already does.
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
        // D2 fix round 3, P1-2: `labelNodeIds` (default undefined = every
        // node) is `render3d.ts`'s own large-graph label-suppression
        // policy — the node's BOX still renders and still participates in
        // occlusion either way, only the label candidate is skipped.
        if (labelNodeIds && !labelNodeIds.has(node.id)) continue;
        const rawText = node.label.split("\n")[0] ?? node.id;
        const placement = resolveGlyphDiagram3dLabelPlacement(node, rawText, labelMode, labelSideDirection);
        const { col: colF, row: rowF } = project(frame, placement.anchor);
        // `side` mode's leader always starts exactly on the node's own
        // surface (`leaderFrom`, computed by the SAME pure function) — this
        // is what "a side label must have its leader touching its object"
        // means, stamped through the identical depth-tested overlay line
        // primitive the box outline and edges already use.
        if (placement.isSide && placement.leaderFrom) {
          const from = project(frame, placement.leaderFrom), to = project(frame, placement.anchor);
          stampGlyphOverlayLine(grid, from, to, segmentGlyph(tier, to.col - from.col, to.row - from.row), labelColor);
        }
        // No `depth` here on purpose: occlusion by a FOREIGN mesh is already
        // the `ownMeshIds`/`winnerMesh` check below (AGENTS.md's "Scene
        // objects" Occlusion clause), and a node's own label sitting just
        // above its own box has no reason to depth-test against its own
        // geometry, or against an edge stamp whose per-segment interpolated
        // depth can read fractionally nearer at the exact anchor cell.
        frame.labels.place({
          id: `node:${node.id}`, priority: node.degree, col: Math.round(colF), row: Math.round(rowF),
          text: placement.text, color: labelColor, ownMeshIds: frame.ownMeshIds,
        });
      }
    },
  };

  const allX = [...layout.nodes.flatMap((n) => [n.center[0] - n.half[0], n.center[0] + n.half[0]]), ...layout.groups.flatMap((g) => [g.min[0], g.max[0]])];
  const allY = [...layout.nodes.flatMap((n) => [n.center[1] - n.half[1], n.center[1] + n.half[1]]), ...layout.groups.flatMap((g) => [g.min[1], g.max[1]])];
  const allZ = [...layout.nodes.flatMap((n) => [n.center[2] - n.half[2], n.center[2] + n.half[2]]), ...layout.groups.flatMap((g) => [g.min[2], g.max[2]])];
  const bounds = allX.length === 0
    ? { min: [0, 0, 0] as Vec3, max: [0, 0, 0] as Vec3 }
    : { min: [Math.min(...allX), Math.min(...allY), Math.min(...allZ)] as Vec3, max: [Math.max(...allX), Math.max(...allY), Math.max(...allZ)] as Vec3 };

  return {
    id: options.id ?? "diagram",
    meshes,
    overlays: [overlay],
    bounds,
  };
}
