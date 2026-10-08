/**
 * Geometry for a solid-color axis-aligned box — 6 rectangular faces, one
 * Polygon per face. Unlike `cubePolygons` (uniform `size`), each axis has
 * its own extent, so a caller can build a node box whose footprint (X, Y)
 * is sized from a label while its thickness (Z, world-up) stays a fixed
 * constant — the `@glyphcss/diagrams/3d` node-mesh shape.
 */
import type { Polygon, Vec3 } from "../types";

export interface BoxPolygonsOptions {
  /** Center of the box in world space. */
  center: Vec3;
  /** Full extent along world X. */
  width: number;
  /** Full extent along world Y. */
  depth: number;
  /** Full extent along world Z (up). */
  height: number;
  /** Fill color applied to all six faces. */
  color?: string;
}

export function boxPolygons(options: BoxPolygonsOptions): Polygon[] {
  const { center, width, depth, height, color = "#ffffff" } = options;
  const [cx, cy, cz] = center;
  const hx = width / 2;
  const hy = depth / 2;
  const hz = height / 2;

  // 8 corners, labelled by (±x, ±y, ±z) sign.
  const v: Vec3[] = [
    [cx - hx, cy - hy, cz - hz],  // 0  ---
    [cx + hx, cy - hy, cz - hz],  // 1  +--
    [cx + hx, cy + hy, cz - hz],  // 2  ++-
    [cx - hx, cy + hy, cz - hz],  // 3  -+-
    [cx - hx, cy - hy, cz + hz],  // 4  --+
    [cx + hx, cy - hy, cz + hz],  // 5  +-+
    [cx + hx, cy + hy, cz + hz],  // 6  +++
    [cx - hx, cy + hy, cz + hz],  // 7  -++
  ];

  // 6 faces, each a CCW quad when viewed from outside — same face/winding
  // table as `cubePolygons` so the two stay interchangeable at `width ===
  // depth === height`.
  const faces: [number, number, number, number][] = [
    [4, 5, 6, 7],  // +Z (top)
    [1, 0, 3, 2],  // -Z (bottom)
    [5, 1, 2, 6],  // +X (right)
    [0, 4, 7, 3],  // -X (left)
    [7, 6, 2, 3],  // +Y (front)
    [0, 1, 5, 4],  // -Y (back)
  ];

  return faces.map((f) => ({
    vertices: [v[f[0]], v[f[1]], v[f[2]], v[f[3]]],
    color,
  }));
}
