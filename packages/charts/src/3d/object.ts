/**
 * `glyphChartObject` — turns a `GlyphChart3dMark` into a mounted
 * `GlyphSceneObject` (PLAN-3d.md §3.1, §5 "Axes and box"/"Labels"):
 * the surface mesh (`gridSurfacePolygons`, coloured by the area-median band
 * of the FULL-resolution grid a decimated quad stands in for) plus a 3D
 * axis box, ticks, and tick labels as overlays through the shared
 * registry/arbiter (`scene.addObject` — AGENTS.md's "Scene objects").
 *
 * `objectPosition` is DATA SPACE (contract 8): every axis is mapped from
 * its own resolved domain onto `[0, aspect[axis]]` by ONE affine function,
 * so a mesh vertex's object-space coordinate is a monotone, linear image
 * of the underlying data value on that axis — never a re-derived or
 * re-scaled quantity an effect would have to invert.
 */
import { gridSurfacePolygons, surfaceMedianOfBlock, createSurfaceMedianScratch } from "glyphcss";
import { stampGlyphOverlayCell, stampGlyphOverlayLine } from "glyphcss";
import type { GlyphOverlayFrame, GlyphSceneObject, GlyphSceneOverlay, Polygon, Vec3 } from "glyphcss";
import { glyphChart3dBandColor, glyphChart3dBandIndex } from "./colorscale";
import type { GlyphChart3dMark, GlyphChart3dObjectOptions, GlyphChart3dResolvedAxis, GlyphChart3dSurfaceMark } from "./types";

/** How far outward (as a fraction of that axis's own box extent) a tick label / axis title is pushed past the box edge. */
const TICK_LABEL_MARGIN = 0.12;
const AXIS_TITLE_MARGIN = 0.3;
/** Priorities, following AGENTS.md's "Charts" §5 "Labels": axis extremes, then zero, then interior ticks; titles always outrank ticks. */
const PRIORITY_TITLE = 1000;
const PRIORITY_TICK_EXTREME = 500;
const PRIORITY_TICK_ZERO = 480;
const PRIORITY_TICK_INTERIOR = 400;

type Bit = 0 | 1;
type Corner = readonly [Bit, Bit, Bit];
const CORNERS: readonly Corner[] = [
  [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
  [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
];
type Edge = readonly [Corner, Corner];
const BOX_EDGES: readonly Edge[] = (() => {
  const edges: Edge[] = [];
  for (let i = 0; i < CORNERS.length; i++) {
    for (let j = i + 1; j < CORNERS.length; j++) {
      const a = CORNERS[i]!, b = CORNERS[j]!;
      const diffs = (a[0] !== b[0] ? 1 : 0) + (a[1] !== b[1] ? 1 : 0) + (a[2] !== b[2] ? 1 : 0);
      if (diffs === 1) edges.push([a, b]);
    }
  }
  return edges;
})();

function cornerPoint(c: Corner, ext: readonly [number, number, number]): Vec3 {
  return [c[0] ? ext[0]! : 0, c[1] ? ext[1]! : 0, c[2] ? ext[2]! : 0];
}
function lerpVec3(a: Vec3, b: Vec3, t: number): Vec3 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

interface Projected { readonly col: number; readonly row: number; readonly depth: number; }
function projectObjectPoint(frame: GlyphOverlayFrame, p: Vec3): Projected {
  const world = frame.toWorld(p);
  const result = frame.camera.project(world, frame.cols, frame.rows, frame.cellAspect);
  const depth = result[3] ?? result[2];
  return { col: Math.round(result[0]), row: Math.round(result[1]), depth };
}

/** A straight box edge needs exactly one glyph for its whole run — the direction never changes along it. */
function edgeGlyph(from: Projected, to: Projected): string {
  const dc = to.col - from.col, dr = to.row - from.row;
  if (dc === 0 && dr === 0) return "·"; // ·
  if (dc === 0) return "│"; // │
  if (dr === 0) return "─"; // ─
  return (dc > 0) === (dr > 0) ? "\\" : "/";
}

/** The 4 edges parallel to `axis` (0=x, 1=y, 2=z) — those where only `axis`'s coordinate differs between the two corners. */
function edgesAlongAxis(axis: 0 | 1 | 2): readonly Edge[] {
  return BOX_EDGES.filter(([a, b]) => {
    for (let k = 0; k < 3; k++) {
      if (k === axis) continue;
      if (a[k as 0 | 1 | 2] !== b[k as 0 | 1 | 2]) return false;
    }
    return true;
  });
}

function boxWireframeOverlay(ext: readonly [number, number, number], color: string): GlyphSceneOverlay {
  return {
    id: "box",
    order: 0,
    stamp(grid, frame) {
      for (const [a, b] of BOX_EDGES) {
        const from = projectObjectPoint(frame, cornerPoint(a, ext));
        const to = projectObjectPoint(frame, cornerPoint(b, ext));
        stampGlyphOverlayLine(grid, from, to, edgeGlyph(from, to), color);
      }
    },
  };
}

/** Picks, for `axis`, the one of its 4 parallel edges nearest the camera THIS frame (largest projected depth at its midpoint) — Plotly's own "ticks on the near edge" rule. */
function nearestEdge(axis: 0 | 1 | 2, ext: readonly [number, number, number], frame: GlyphOverlayFrame): Edge {
  const candidates = edgesAlongAxis(axis);
  let best = candidates[0]!;
  let bestDepth = -Infinity;
  for (const edge of candidates) {
    const mid = lerpVec3(cornerPoint(edge[0], ext), cornerPoint(edge[1], ext), 0.5);
    const depth = projectObjectPoint(frame, mid).depth;
    if (depth > bestDepth) { bestDepth = depth; best = edge; }
  }
  return best;
}

/** Outward push-out point for a tick/title on `axis`'s chosen edge, at parameter `t` along it. The other two axes push away from the box using the edge's OWN fixed corner bits (0 -> push negative, 1 -> push positive). */
function outwardPoint(axis: 0 | 1 | 2, edge: Edge, t: number, ext: readonly [number, number, number], margin: number): Vec3 {
  const fixed = edge[0];
  const p: [number, number, number] = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    const axisK = k as 0 | 1 | 2;
    if (axisK === axis) { p[k] = t * ext[axis]; continue; }
    const bit = fixed[axisK];
    const push = margin * ext[axisK];
    p[k] = bit ? ext[axisK] + push : -push;
  }
  return p;
}

function axisOverlay(axisIndex: 0 | 1 | 2, name: string, axis: GlyphChart3dResolvedAxis, ext: readonly [number, number, number], color: string): GlyphSceneOverlay {
  return {
    id: `axis-${name}`,
    order: 1,
    stamp(grid, frame) {
      const edge = nearestEdge(axisIndex, ext, frame);
      const [lo, hi] = axis.domain;
      const span = hi - lo;
      for (let i = 0; i < axis.ticks.length; i++) {
        const value = axis.ticks[i]!;
        const t = span === 0 ? 0 : (value - lo) / span;
        const onEdge = outwardPoint(axisIndex, edge, t, ext, 0);
        const tickProjected = projectObjectPoint(frame, onEdge);
        stampGlyphOverlayCell(grid, { col: tickProjected.col, row: tickProjected.row, char: "+", color, depth: tickProjected.depth });
        const label = outwardPoint(axisIndex, edge, t, ext, TICK_LABEL_MARGIN);
        const labelProjected = projectObjectPoint(frame, label);
        const priority = i === 0 || i === axis.ticks.length - 1
          ? PRIORITY_TICK_EXTREME
          : value === 0
            ? PRIORITY_TICK_ZERO
            : PRIORITY_TICK_INTERIOR;
        frame.labels.place({
          id: `axis-${name}-tick-${i}`,
          priority,
          col: labelProjected.col,
          row: labelProjected.row,
          text: axis.tickLabels[i]!,
          color,
          ownMeshIds: frame.ownMeshIds,
          depth: labelProjected.depth,
        });
      }
      if (axis.title.length > 0) {
        const titlePoint = outwardPoint(axisIndex, edge, 0.5, ext, AXIS_TITLE_MARGIN);
        const titleProjected = projectObjectPoint(frame, titlePoint);
        frame.labels.place({
          id: `axis-${name}-title`,
          priority: PRIORITY_TITLE,
          col: titleProjected.col,
          row: titleProjected.row,
          text: axis.title,
          color,
          ownMeshIds: frame.ownMeshIds,
          depth: titleProjected.depth,
        });
      }
    },
  };
}

const AXIS_BOX_COLOR = "#7a7f8a";

function buildSurfaceMesh(mark: GlyphChart3dSurfaceMark): Polygon[] {
  const { grid, zDomain, aspect, bands, colorAnchors } = mark;
  const rows = grid.z.length;
  const cols = grid.z[0]!.length;
  const [xLo, xHi] = mark.axes.x.domain;
  const [yLo, yHi] = mark.axes.y.domain;
  const [zLo, zHi] = zDomain;
  const xSpan = xHi - xLo || 1;
  const ySpan = yHi - yLo || 1;
  const zSpan = zHi - zLo || 1;

  const normalizedX = grid.x.map((v) => ((v - xLo) / xSpan) * aspect[0]);
  const normalizedY = grid.y.map((v) => ((v - yLo) / ySpan) * aspect[1]);
  const normalizedZ = grid.z.map((row) => row.map((v) => ((v - zLo) / zSpan) * aspect[2]));

  const flatZ = new Float64Array(rows * cols);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) flatZ[r * cols + c] = grid.z[r]![c]!;
  const scratch = createSurfaceMedianScratch(Math.max(1, rows * cols));

  const { polygons } = gridSurfacePolygons(
    { z: normalizedZ, x: normalizedX, y: normalizedY },
    {
      maxQuadsX: mark.maxQuadsX,
      maxQuadsY: mark.maxQuadsY,
      color: colorAnchors === null
        ? undefined
        : (block) => {
          const median = surfaceMedianOfBlock({ stride: cols, values: flatZ }, scratch, block.col0, block.col1, block.row0, block.row1);
          const t = (median - zLo) / zSpan;
          const bandIdx = glyphChart3dBandIndex(t, bands);
          return glyphChart3dBandColor(colorAnchors, bandIdx, bands);
        },
    },
  );
  return polygons;
}

/** Builds the `GlyphSceneObject` for a `GlyphChart3dMark` — today, a `surface`. `scatter3d` (C5) is a later member of the same union; adding it will fail to typecheck HERE until this function grows its own branch. */
export function glyphChartObject(mark: GlyphChart3dMark, options: GlyphChart3dObjectOptions = {}): GlyphSceneObject {
  if (mark.type !== "surface") {
    throw new TypeError(`glyphcss: unknown 3D mark type ${JSON.stringify((mark as { type?: unknown }).type)}.`);
  }
  const id = options.id ?? "surface";
  const polygons = buildSurfaceMesh(mark);
  const ext = mark.aspect;
  const overlays: GlyphSceneOverlay[] = [
    boxWireframeOverlay(ext, AXIS_BOX_COLOR),
    axisOverlay(0, "x", mark.axes.x, ext, AXIS_BOX_COLOR),
    axisOverlay(1, "y", mark.axes.y, ext, AXIS_BOX_COLOR),
    axisOverlay(2, "z", mark.axes.z, ext, AXIS_BOX_COLOR),
  ];
  return {
    id,
    meshes: [{ name: "surface", polygons }],
    overlays,
    bounds: { min: [0, 0, 0], max: [ext[0], ext[1], ext[2]] },
  };
}
