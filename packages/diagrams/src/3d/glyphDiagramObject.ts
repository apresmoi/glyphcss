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
 */
import type { GlyphGraph, GlyphGraphDirection } from "../types";
import type { GlyphOverlayFrame, GlyphSceneObject, GlyphSceneObjectMesh, GlyphSceneOverlay, Polygon, Vec3 } from "glyphcss";
import { boxPolygons, spherePolygons, cylinderPolygons, orientedRibbonPolygons, orientedPyramidPolygons } from "glyphcss";
import { layout3d, type GlyphDiagram3dGroup, type GlyphDiagram3dLayout, type GlyphDiagram3dLayoutOptions, type GlyphDiagram3dNode } from "./layout3d";

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
 * options. `"inside"`'s own anchor sits on the node's own FRONT face
 * (world `-Y`, `center - half[1]` along Y — the depth/extrusion axis every
 * node's box always uses, D2 round 7's own top-of-file doc); `"side"`
 * anchors in the free space past the node's own right edge (world `+X`,
 * the box's own width axis) or below it (world `-Z`), with a leader-from
 * point exactly on the node's own projected edge.
 *
 * `screenWidthCols`, when given, is the node's own front face's REAL
 * PROJECTED SCREEN WIDTH (columns) and REPLACES `node.half[0] * 2` (world
 * units) as the "does it fit" / clip budget — a node's own front-face width
 * in WORLD units maps to screen columns at `worldWidth * zoom / cellPxW`,
 * so at any auto-fit `zoom` below `cellPxW` a box's SCREEN width is
 * narrower than its own WORLD-unit label budget (D2 round 6's own root
 * cause for labels overflowing their block). Padding: `screenWidthCols`
 * reserves >= 1 column on EACH side by budgeting `floor(screenWidthCols) - 2`
 * cells for text, never the raw width. Omitted, it falls back to the old
 * world-unit heuristic (byte-identical for a caller/unit test with no
 * camera/zoom to derive it from).
 */
export function resolveGlyphDiagram3dLabelPlacement(
  node: GlyphDiagram3dNode, rawText: string, mode: GlyphDiagram3dLabelMode = "auto",
  sideDirection: "right" | "below" = "right", screenWidthCols?: number,
): GlyphDiagram3dLabelPlacement {
  const faceWidthCells = screenWidthCols !== undefined
    ? Math.max(1, Math.floor(screenWidthCols) - 2)
    : Math.max(1, Math.floor(node.half[0] * 2));
  const fitsInside = rawText.length <= faceWidthCells;
  const front: Vec3 = [node.center[0], node.center[1] - node.half[1], node.center[2]];
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
  const rightEdge: Vec3 = [node.center[0] + node.half[0], node.center[1] - node.half[1], top[2]];
  const anchor: Vec3 = [rightEdge[0] + gap, rightEdge[1], top[2]];
  return { anchor, text: rawText, isSide: true, leaderFrom: rightEdge };
}

/** LR/RL -> `"below"`, everything else (TB/BT/unset) -> `"right"`. Shared by this module's overlay and `render3d.ts`'s analytic fit so both pick the identical side. */
export function glyphDiagram3dLabelSideDirection(direction: GlyphGraphDirection | undefined): "right" | "below" {
  return direction === "LR" || direction === "RL" ? "below" : "right";
}

const DEFAULT_NODE_COLOR = "#8fb4ff";
const DEFAULT_EDGE_COLOR = "#cbd5e1";
const DEFAULT_GROUP_COLOR = "#64748b";
const DEFAULT_LABEL_COLOR = "#f8fafc";

/** Edge ribbon half-width, arrowhead half-width/length, group outline half-width — all world units, tuned by direct rendering at this module's own default node scale (a single-line label's box is roughly 5-12 units wide). */
const GLYPH_DIAGRAM_3D_EDGE_RIBBON_HALF_WIDTH = 0.45;
const GLYPH_DIAGRAM_3D_ARROWHEAD_HALF_WIDTH = 1.1;
const GLYPH_DIAGRAM_3D_ARROWHEAD_LENGTH = 2.2;
const GLYPH_DIAGRAM_3D_GROUP_OUTLINE_HALF_WIDTH = 0.3;

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
  const labelSideDirection = glyphDiagram3dLabelSideDirection(options.direction ?? graph.direction);

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
      for (const node of layout.nodes) {
        if (labelNodeIds && !labelNodeIds.has(node.id)) continue;
        const rawText = node.label.split("\n")[0] ?? node.id;
        // The node's own REAL projected front-face screen width, from the
        // frame's ACTUAL camera (never an estimate) — see this file's own
        // `resolveGlyphDiagram3dLabelPlacement` doc.
        const leftEdge: Vec3 = [node.center[0] - node.half[0], node.center[1] - node.half[1], node.center[2]];
        const rightEdge: Vec3 = [node.center[0] + node.half[0], node.center[1] - node.half[1], node.center[2]];
        const screenWidthCols = Math.abs(project(frame, rightEdge).col - project(frame, leftEdge).col);
        const placement = resolveGlyphDiagram3dLabelPlacement(node, rawText, labelMode, labelSideDirection, screenWidthCols);
        const { col: colF, row: rowF } = project(frame, placement.anchor);
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
