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
import type { GlyphGraph } from "../types";
import type { GlyphCanvasTier, GlyphCanvasTierName, GlyphOverlayFrame, GlyphSceneObject, GlyphSceneObjectMesh, GlyphSceneOverlay, Vec3 } from "glyphcss";
import { boxPolygons, spherePolygons, stampGlyphOverlayCell, stampGlyphOverlayLine, GLYPH_CANVAS_TIERS } from "glyphcss";
import { layout3d, type GlyphDiagram3dGroup, type GlyphDiagram3dLayout, type GlyphDiagram3dLayoutOptions, type GlyphDiagram3dNode } from "./layout3d";

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
  return boxCornersFromMinMax([cx - hx, cy - hy, cz - hz], [cx + hx, cy + hy, cz + hz]);
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
  const boxOutline = options.boxOutline ?? true;
  const tierName = options.tier ?? "ascii";
  const wireframeGroups = (options.layout ?? "layered") === "force";

  const meshes: GlyphSceneObjectMesh[] = [];
  for (const node of layout.nodes) {
    const color = resolveNodeColor(options.nodeColor, node);
    const polygons = node.shape === "circle"
      ? spherePolygons({ center: node.center, size: Math.max(node.half[0], node.half[1], node.half[2]), color })
      : boxPolygons({ center: node.center, width: node.half[0] * 2, depth: node.half[1] * 2, height: node.half[2] * 2, color });
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
      // Box outlines FIRST (D2 review P1-1): every corner is an exact box
      // vertex, so depth along a straight edge between two of them is exact
      // (not an approximation), and `stampGlyphOverlayCell`'s depth rule
      // (equal wins the write) lets the outline paint exactly on the solid
      // fill's own surface rather than floating above/below it.
      if (boxOutline) {
        for (const node of layout.nodes) {
          if (node.shape === "circle") continue; // no box edges on a sphere
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
          if (i === projected.length - 2) {
            // The final segment's own arrowhead — D2 review P1-1: a plain
            // slope glyph carried no direction at all. Deliberately NO
            // `depth` here, unlike the line segments above: the arrow's
            // anchor is, by definition, ON the TARGET node's own surface,
            // so depth-testing it against that SAME node's geometry is
            // wrong in exactly the way the label placement comment below
            // already explains for labels — measured (D2 fix round 1): the
            // anchor commonly lands on a thin box's SIDE face while that
            // same screen cell's nearer winner is the box's own TOP face
            // (a thin `GLYPH_DIAGRAM_3D_NODE_HEIGHT` slab under a steep
            // default `rotX`), so a depth-tested write silently lost every
            // arrowhead in the reference 4-node graph (0 of 4 painted).
            // Still depth-tested against a genuinely FOREIGN node by the
            // line segment immediately above it (which keeps its own
            // `depth`) — the arrow only ever overrides its own edge's last
            // line cell.
            stampGlyphOverlayCell(grid, { col: Math.round(b.col), row: Math.round(b.row), char: arrowGlyph(tier, dCol, dRow), color: edgeColor });
          }
        }
      }
      for (const node of layout.nodes) {
        const anchor: Vec3 = [node.center[0], node.center[1], node.center[2] + node.half[2]];
        const { col: colF, row: rowF } = project(frame, anchor);
        const text = node.label.split("\n")[0] ?? node.id;
        // No `depth` here on purpose: occlusion by a FOREIGN mesh is already
        // the `ownMeshIds`/`winnerMesh` check below (AGENTS.md's "Scene
        // objects" Occlusion clause), and a node's own label sitting just
        // above its own box has no reason to depth-test against its own
        // geometry, or against an edge stamp whose per-segment interpolated
        // depth can read fractionally nearer at the exact anchor cell.
        frame.labels.place({
          id: `node:${node.id}`, priority: node.degree, col: Math.round(colF), row: Math.round(rowF),
          text, color: labelColor, ownMeshIds: frame.ownMeshIds,
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
