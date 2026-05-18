/**
 * Geometry for a solid-color cube — 6 square faces, one Polygon per face.
 * Vertices sit at `center ± (size/2)` on each axis so the edge length equals
 * `size` and the solid fits in a bounding box of `size × size × size`.
 */
import type { Polygon, Vec3 } from "../types";

export interface CubePolygonsOptions {
  /** Center of the cube in world space. */
  center: Vec3;
  /** Edge length of the cube. */
  size: number;
  /** Fill color applied to all six faces. */
  color?: string;
}

export function cubePolygons(options: CubePolygonsOptions): Polygon[] {
  const { center, size, color = "#ffffff" } = options;
  const [cx, cy, cz] = center;
  const h = size / 2;

  // 8 corners, labelled by (±x, ±y, ±z) sign.
  const v: Vec3[] = [
    [cx - h, cy - h, cz - h],  // 0  ---
    [cx + h, cy - h, cz - h],  // 1  +--
    [cx + h, cy + h, cz - h],  // 2  ++-
    [cx - h, cy + h, cz - h],  // 3  -+-
    [cx - h, cy - h, cz + h],  // 4  --+
    [cx + h, cy - h, cz + h],  // 5  +-+
    [cx + h, cy + h, cz + h],  // 6  +++
    [cx - h, cy + h, cz + h],  // 7  -++
  ];

  // 6 faces, each a CCW quad when viewed from outside.
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
