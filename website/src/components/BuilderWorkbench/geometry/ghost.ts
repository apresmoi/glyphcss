/**
 * Ghost bounding-box helpers for placement mode.
 *
 * Builds the 6 face quads of the bbox cuboid directly in WORLD coords —
 * the caller passes the world XY center + half-extents + height, and the
 * faces come out positioned exactly where they should appear. The
 * resulting PolyMesh is rendered with NO `position` / `scale` props —
 * same pattern as PolyTransformControls' planar handles (which we know
 * render correctly in all three planes).
 *
 * Earlier attempts passed polygons in model-local coords and let
 * PolyMesh's `scale` + `position` transform place them. That kept
 * collapsing the box to the floor — most likely because the scale+
 * position-around-bbox-center wrapping interacts with polycss's
 * basis chooser in a way I can't easily debug. Direct world coords
 * sidestep all of that.
 */

import type { Polygon } from "@layoutit/polycss-react";

export interface Bbox {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

export interface GhostWorldRect {
  /** Center of the bbox footprint on the floor. */
  worldX: number;
  worldY: number;
  /** Half-extents on each axis, in WORLD units. */
  hx: number;
  hy: number;
  /** Total height of the bbox in WORLD units. Bottom sits at baseZ. */
  height: number;
  /** Base elevation in world units. Wireframe spans `baseZ` →
   *  `baseZ + height`. 0 for the flat floor. Used to lift the ghost
   *  onto an elevated terrain cell. Default 0. */
  baseZ?: number;
}

/** Solid cyan wireframe edge color. Alpha must live in the COLOR (rgba)
 *  if we ever want transparency — never set CSS `opacity` on the ghost
 *  wrapper because it would flatten the 3D context. See
 *  builder-workbench.css for the long-form warning. */
export const GHOST_COLOR = "#00d9ff";

/** Edge half-thickness in world units. ~0.06 world units ≈ 3 CSS px at
 *  BASE_TILE=50 — readable as a wireframe dot at typical zoom. */
const EDGE_HALF = 0.06;

/** Approx length of a single dot in world units. */
const DOT_LENGTH = 0.5;
/** Approx gap between consecutive dots. */
const GAP_LENGTH = 0.5;

/** Build the 6 axis-aligned face quads of an arbitrary cuboid using
 *  axisBox's vertex labelling + CCW-from-outside winding. Each face's
 *  surface normal points OUTWARD so polycss's basis chooser keeps the
 *  matrix3d determinant positive (negative determinants flatten). */
function cuboidFaces(
  x0: number, x1: number,
  y0: number, y1: number,
  z0: number, z1: number,
  color: string,
): Polygon[] {
  const c0: [number, number, number] = [x0, y0, z0];
  const c1: [number, number, number] = [x1, y0, z0];
  const c2: [number, number, number] = [x1, y1, z0];
  const c3: [number, number, number] = [x0, y1, z0];
  const c4: [number, number, number] = [x0, y0, z1];
  const c5: [number, number, number] = [x1, y0, z1];
  const c6: [number, number, number] = [x1, y1, z1];
  const c7: [number, number, number] = [x0, y1, z1];
  return [
    { vertices: [c0, c1, c2, c3], color }, // -Z
    { vertices: [c4, c5, c6, c7], color }, // +Z
    { vertices: [c0, c1, c5, c4], color }, // -Y
    { vertices: [c1, c2, c6, c5], color }, // +X
    { vertices: [c2, c3, c7, c6], color }, // +Y
    { vertices: [c3, c0, c4, c7], color }, // -X
  ];
}

/** Compute the (start, end) pairs of dots along a 1D edge of `length`
 *  world units. Dot count adapts to length so dot SIZE stays uniform
 *  across edges of different lengths — short edges get fewer dots.
 *  Dots always include both endpoints (so corners of the bbox always
 *  have visible markers). */
function dotSpans(length: number): Array<[number, number]> {
  const pattern = DOT_LENGTH + GAP_LENGTH;
  const count = Math.max(2, Math.round(length / pattern));
  // Distribute evenly: the centres of `count` dots sit at fractions
  // i/(count-1) of the edge for i=0..count-1.
  const halfDot = DOT_LENGTH / 2;
  const spans: Array<[number, number]> = [];
  for (let i = 0; i < count; i++) {
    const centre = (i / (count - 1)) * length;
    const a = Math.max(0, centre - halfDot);
    const b = Math.min(length, centre + halfDot);
    spans.push([a, b]);
  }
  return spans;
}

/** Build a dotted 12-edge wireframe of the bbox. Each edge becomes a
 *  run of short cuboid "dots" instead of one continuous stick, so the
 *  outline reads as a dashed bbox at the placement cursor. Closed
 *  cuboids (not flat slabs) so each dot stays 3D regardless of the
 *  camera angle, with axisBox winding for stable rendering. */
export function buildGhostWireframePolygons(rect: GhostWorldRect, color: string = GHOST_COLOR): Polygon[] {
  const { worldX, worldY, hx, hy, height } = rect;
  const x0 = worldX - hx;
  const x1 = worldX + hx;
  const y0 = worldY - hy;
  const y1 = worldY + hy;
  const z0 = rect.baseZ ?? 0;
  const z1 = z0 + height;
  const t = EDGE_HALF;

  const polys: Polygon[] = [];

  // 4 X-direction edges — dot spans run along X.
  const xSpans = dotSpans(x1 - x0);
  for (const y of [y0, y1]) {
    for (const z of [z0, z1]) {
      for (const [a, b] of xSpans) {
        polys.push(...cuboidFaces(x0 + a, x0 + b, y - t, y + t, z - t, z + t, color));
      }
    }
  }
  // 4 Y-direction edges — dot spans run along Y.
  const ySpans = dotSpans(y1 - y0);
  for (const x of [x0, x1]) {
    for (const z of [z0, z1]) {
      for (const [a, b] of ySpans) {
        polys.push(...cuboidFaces(x - t, x + t, y0 + a, y0 + b, z - t, z + t, color));
      }
    }
  }
  // 4 Z-direction edges — dot spans run along Z.
  const zSpans = dotSpans(z1 - z0);
  for (const x of [x0, x1]) {
    for (const y of [y0, y1]) {
      for (const [a, b] of zSpans) {
        polys.push(...cuboidFaces(x - t, x + t, y - t, y + t, z0 + a, z0 + b, color));
      }
    }
  }

  return polys;
}

/**
 * Rotate every vertex of every polygon around `pivot` so that the
 * resulting world-coord polygons, once rendered through `cssPoints`'
 * world→CSS axis swap, look identical to a `PolyMesh` with
 * `rotation = [rotXDeg, rotYDeg, 0]`. PolyMesh's CSS transform is
 * `rotateX(α) rotateY(β)` (rotateY applied to vectors first), so we
 * mirror that ordering here.
 *
 * Because `cssPoints` swaps world-X and world-Y axes, CSS rotateX
 * (which preserves CSS-X) corresponds to a world-frame rotation that
 * preserves world-Y, and CSS rotateY (preserves CSS-Y) corresponds to
 * a world rotation that preserves world-X — that's why the world math
 * below preserves the "opposite" axis to what the CSS name suggests.
 */
export function rotatePolygonsAroundPivot(
  polygons: Polygon[],
  pivot: [number, number, number],
  rotXDeg: number,
  rotYDeg: number,
): Polygon[] {
  if (rotXDeg === 0 && rotYDeg === 0) return polygons;
  const rx = (rotXDeg * Math.PI) / 180;
  const ry = (rotYDeg * Math.PI) / 180;
  const cx = Math.cos(rx);
  const sx = Math.sin(rx);
  const cy = Math.cos(ry);
  const sy = Math.sin(ry);

  const rotateVertex = (v: [number, number, number]): [number, number, number] => {
    let x = v[0] - pivot[0];
    let y = v[1] - pivot[1];
    let z = v[2] - pivot[2];
    // CSS rotateY first (applied to vectors first). In world coords:
    // preserves x, transforms (y, z).
    const y1 =  y * cy + z * sy;
    const z1 = -y * sy + z * cy;
    y = y1; z = z1;
    // CSS rotateX next. In world coords: preserves y, transforms (x, z).
    const x2 = x * cx - z * sx;
    const z2 = x * sx + z * cx;
    x = x2; z = z2;
    return [x + pivot[0], y + pivot[1], z + pivot[2]];
  };

  return polygons.map((p) => ({
    ...p,
    vertices: p.vertices.map(rotateVertex),
  }));
}

/**
 * Build the 6 faces of a bounding box positioned at (worldX, worldY)
 * on the floor with the given half-extents and height. Vertex order
 * mirrors `axisBox` in core/helpers/axesPolygons.ts — the same helper
 * `<PolyAxesHelper>` uses to render its thin cuboids in 3D. Each face's
 * winding is CCW from the OUTWARD-facing side so the surface normal
 * points outward and polycss's basis chooser keeps the matrix3d
 * determinant positive (negative determinants get treated as
 * back-facing and silently flatten).
 *
 * All vertices are in WORLD coords; caller passes the list to a
 * `<PolyMesh>` with no `position` or `scale` prop.
 */
export function buildGhostBoxPolygons(rect: GhostWorldRect, color: string = GHOST_COLOR): Polygon[] {
  const { worldX, worldY, hx, hy, height } = rect;
  const x0 = worldX - hx;
  const x1 = worldX + hx;
  const y0 = worldY - hy;
  const y1 = worldY + hy;
  const z0 = 0;
  const z1 = height;

  // 8 corners in axisBox naming convention: c0-c3 ring around the bottom
  // CCW from +Z, c4-c7 directly above them.
  const c0: [number, number, number] = [x0, y0, z0];
  const c1: [number, number, number] = [x1, y0, z0];
  const c2: [number, number, number] = [x1, y1, z0];
  const c3: [number, number, number] = [x0, y1, z0];
  const c4: [number, number, number] = [x0, y0, z1];
  const c5: [number, number, number] = [x1, y0, z1];
  const c6: [number, number, number] = [x1, y1, z1];
  const c7: [number, number, number] = [x0, y1, z1];

  return [
    { vertices: [c0, c1, c2, c3], color }, // bottom (XY at z0) — normal -Z
    { vertices: [c4, c5, c6, c7], color }, // top    (XY at z1) — normal +Z
    { vertices: [c0, c1, c5, c4], color }, // front  (XZ at y0) — normal -Y
    { vertices: [c1, c2, c6, c5], color }, // right  (YZ at x1) — normal +X
    { vertices: [c2, c3, c7, c6], color }, // back   (XZ at y1) — normal +Y
    { vertices: [c3, c0, c4, c7], color }, // left   (YZ at x0) — normal -X
  ];
}

/** Compute a `GhostWorldRect` for placing a model at (worldX, worldY)
 *  given its model-local bbox and the auto-fit scale. `baseZ` lifts
 *  the wireframe off the floor for placements on elevated terrain. */
export function ghostRectFromBbox(
  bbox: Bbox,
  worldX: number,
  worldY: number,
  fitScale: number,
  baseZ: number = 0,
): GhostWorldRect {
  return {
    worldX,
    worldY,
    hx: ((bbox.maxX - bbox.minX) * fitScale) / 2,
    hy: ((bbox.maxY - bbox.minY) * fitScale) / 2,
    height: (bbox.maxZ - bbox.minZ) * fitScale,
    baseZ,
  };
}

