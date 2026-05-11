/**
 * Geometry for a small solid-color octahedron — the marker shape used by
 * `PolyDirectionalLightHelper` to indicate where a directional light is
 * shining from. Eight CCW-from-outside triangular faces, vertices at
 * `center ± (size, 0, 0)` etc.
 */
import type { Polygon, Vec3 } from "../types";

export interface OctahedronPolygonsOptions {
  /** Center of the octahedron in world space. */
  center: Vec3;
  /** Half-extent (distance from center to each pole vertex). */
  size: number;
  /** Fill color applied to all eight faces. */
  color?: string;
}

export function octahedronPolygons(options: OctahedronPolygonsOptions): Polygon[] {
  const { center, size, color = "#ffffff" } = options;
  const [cx, cy, cz] = center;

  const v: Vec3[] = [
    [cx + size, cy, cz],         // 0  +X
    [cx - size, cy, cz],         // 1  -X
    [cx, cy + size, cz],         // 2  +Y
    [cx, cy - size, cz],         // 3  -Y
    [cx, cy, cz + size],         // 4  +Z
    [cx, cy, cz - size],         // 5  -Z
  ];
  const faces: [number, number, number][] = [
    [0, 2, 4], [2, 1, 4], [1, 3, 4], [3, 0, 4],
    [2, 0, 5], [1, 2, 5], [3, 1, 5], [0, 3, 5],
  ];
  return faces.map((f) => ({
    vertices: [v[f[0]], v[f[1]], v[f[2]]],
    color,
  }));
}
