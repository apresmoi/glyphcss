/**
 * Geometry for a rhombic dodecahedron — 12 rhombic faces (24 vertices of the dual).
 * The dual of the cuboctahedron.
 */
import type { Polygon, Vec3 } from "../types";
import { cuboctahedronPolygons } from "./cuboctahedronPolygons";
import { polyhedronDual } from "./_dualPolyhedron";

export interface RhombicDodecahedronPolygonsOptions {
  center: Vec3;
  size: number;
  color?: string;
}

export function rhombicDodecahedronPolygons(options: RhombicDodecahedronPolygonsOptions): Polygon[] {
  const { center, size, color = "#ffffff" } = options;
  const primal = cuboctahedronPolygons({ center: [0, 0, 0], size });
  const dual = polyhedronDual(primal);
  return dual.map((p) => ({
    vertices: p.vertices.map(([x, y, z]) => [x + center[0], y + center[1], z + center[2]] as Vec3),
    color,
  }));
}
