/**
 * Geometry for a triakis tetrahedron — 12 isosceles-triangle faces.
 * The dual of the truncated tetrahedron.
 */
import type { Polygon, Vec3 } from "../types";
import { truncatedTetrahedronPolygons } from "./truncatedTetrahedronPolygons";
import { polyhedronDual } from "./_dualPolyhedron";

export interface TriakisTetrahedronPolygonsOptions {
  center: Vec3;
  size: number;
  color?: string;
}

export function triakisTetrahedronPolygons(options: TriakisTetrahedronPolygonsOptions): Polygon[] {
  const { center, size, color = "#ffffff" } = options;
  const primal = truncatedTetrahedronPolygons({ center: [0, 0, 0], size });
  const dual = polyhedronDual(primal);
  return dual.map((p) => ({
    vertices: p.vertices.map(([x, y, z]) => [x + center[0], y + center[1], z + center[2]] as Vec3),
    color,
  }));
}
