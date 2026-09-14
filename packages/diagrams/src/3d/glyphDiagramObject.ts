/**
 * `glyphDiagramObject` (PLAN-3d.md §6, packet D1) — a `GlyphGraph` (the same
 * IR the Mermaid/JSON adapters build) to a `GlyphSceneObject` any
 * `createGlyphScene` can mount via `scene.addObject()`. Stable mesh names,
 * per PLAN-3d.md §3.1: one `node:<id>` mesh per node (so a single agent's
 * box is its own effect target) and one `groups` mesh holding every group's
 * floor plate / wireframe volume.
 *
 * Edges are NOT meshes — AGENTS.md's "Scene objects" and this packet's own
 * scope keep them as depth-tested, in-grid OVERLAY stamps (`stampGlyphOverlayLine`),
 * so they stay one cell wide and legible at every zoom, the same reason
 * `@glyphcss/maps`' `line`/`contour` layers are stamps rather than tube
 * meshes. Node labels go through the SAME shared `GlyphLabelArbiter` a
 * chart's ticks or another diagram's own labels use, so two diagrams (or a
 * diagram and a chart) mounted in one scene never overwrite each other's
 * text — AGENTS.md's "Scene objects" "Declutter" clause.
 */
import type { GlyphGraph } from "../types";
import type { GlyphSceneObject, GlyphSceneObjectMesh, GlyphSceneOverlay, Polygon, Vec3 } from "glyphcss";
import { boxPolygons, spherePolygons } from "glyphcss";
import { stampGlyphOverlayLine } from "glyphcss";
import { layout3d, type GlyphDiagram3dLayout, type GlyphDiagram3dLayoutOptions } from "./layout3d";

const DEFAULT_NODE_COLOR = "#8fb4ff";
const DEFAULT_EDGE_COLOR = "#cbd5e1";
const DEFAULT_GROUP_COLOR = "#334155";
const DEFAULT_LABEL_COLOR = "#f8fafc";

export interface GlyphDiagramObjectOptions extends GlyphDiagram3dLayoutOptions {
  /** Object id — must be unique among objects mounted in the same scene. Default `"diagram"`. */
  readonly id?: string;
  readonly nodeColor?: string | ((node: GlyphDiagram3dLayout["nodes"][number]) => string);
  readonly edgeColor?: string;
  readonly groupColor?: string;
  readonly labelColor?: string;
}

function resolveNodeColor(option: GlyphDiagramObjectOptions["nodeColor"], node: GlyphDiagram3dLayout["nodes"][number]): string {
  if (typeof option === "function") return option(node);
  return option ?? DEFAULT_NODE_COLOR;
}

/** One quad on the XY plane at `z`, spanning `[min, max]` — the group floor plate / wireframe volume footprint. Not `planePolygons` (core): that helper's own `size` is one shared half-extent for both in-plane axes, and a group's bounding box is rarely square. */
function floorQuad(min: readonly [number, number], max: readonly [number, number], z: number, color: string): Polygon {
  return {
    vertices: [
      [min[0], min[1], z],
      [max[0], min[1], z],
      [max[0], max[1], z],
      [min[0], max[1], z],
    ],
    color,
  };
}

/** Picks a slope glyph for a projected screen-space edge segment — the same "no arrowhead table, a plain slope glyph" simplification `stampGlyphOverlayLine`'s own callers already accept for a first cut (PLAN-3d.md's arrowhead table is D2/D3 scope, not D1's). */
function edgeGlyph(dCol: number, dRow: number): string {
  if (dCol === 0 && dRow === 0) return ".";
  const adx = Math.abs(dCol), ady = Math.abs(dRow);
  if (adx > ady * 2) return "-";
  if (ady > adx * 2) return "|";
  return (dCol > 0) === (dRow > 0) ? "\\" : "/";
}

export async function glyphDiagramObject(graph: GlyphGraph, options: GlyphDiagramObjectOptions = {}): Promise<GlyphSceneObject> {
  const layout = await layout3d(graph, options);
  const edgeColor = options.edgeColor ?? DEFAULT_EDGE_COLOR;
  const groupColor = options.groupColor ?? DEFAULT_GROUP_COLOR;
  const labelColor = options.labelColor ?? DEFAULT_LABEL_COLOR;
  const wireframeGroups = (options.layout ?? "layered") === "force";

  const meshes: GlyphSceneObjectMesh[] = [];
  for (const node of layout.nodes) {
    const color = resolveNodeColor(options.nodeColor, node);
    const polygons = node.shape === "circle"
      ? spherePolygons({ center: node.center, size: Math.max(node.half[0], node.half[1], node.half[2]), color })
      : boxPolygons({ center: node.center, width: node.half[0] * 2, depth: node.half[1] * 2, height: node.half[2] * 2, color });
    meshes.push({ name: `node:${node.id}`, polygons, options: { castShadow: true, receiveShadow: true } });
  }
  if (layout.groups.length > 0) {
    const groupPolygons: Polygon[] = layout.groups.flatMap((group) => {
      if (wireframeGroups) {
        const width = group.max[0] - group.min[0], depth = group.max[1] - group.min[1], height = Math.max(0.01, group.max[2] - group.min[2]);
        const center: Vec3 = [(group.min[0] + group.max[0]) / 2, (group.min[1] + group.max[1]) / 2, (group.min[2] + group.max[2]) / 2];
        return boxPolygons({ center, width, depth, height, color: groupColor });
      }
      return [floorQuad([group.min[0], group.min[1]], [group.max[0], group.max[1]], group.z, groupColor)];
    });
    meshes.push({
      name: "groups",
      polygons: groupPolygons,
      options: wireframeGroups ? { mode: "wireframe" } : { transparent: true },
    });
  }

  const overlay: GlyphSceneOverlay = {
    id: "glyph-diagram-3d",
    stamp(grid, frame): void {
      for (const edge of layout.edges) {
        const projected = edge.points.map((p) => {
          const [col, row, depth] = frame.camera.project(frame.toWorld(p), frame.cols, frame.rows, frame.cellAspect);
          return { col, row, depth };
        });
        for (let i = 0; i < projected.length - 1; i++) {
          const a = projected[i]!, b = projected[i + 1]!;
          stampGlyphOverlayLine(grid, a, b, edgeGlyph(b.col - a.col, b.row - a.row), edgeColor);
        }
      }
      for (const node of layout.nodes) {
        const anchor: Vec3 = [node.center[0], node.center[1], node.center[2] + node.half[2]];
        const [colF, rowF] = frame.camera.project(frame.toWorld(anchor), frame.cols, frame.rows, frame.cellAspect);
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
