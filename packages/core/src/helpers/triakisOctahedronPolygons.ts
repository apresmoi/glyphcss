/**
 * Geometry for a triakis octahedron — 24 isosceles-triangle faces.
 * The dual of the truncated cube.
 */
import type { Polygon, Vec3 } from "../types";
import { truncatedCubePolygons } from "./truncatedCubePolygons";
import { polyhedronDual } from "./_dualPolyhedron";

export interface TriakisOctahedronPolygonsOptions {
  center: Vec3;
  size: number;
  color?: string;
}

export function triakisOctahedronPolygons(options: TriakisOctahedronPolygonsOptions): Polygon[] {
  const { center, size, color = "#ffffff" } = options;
  const primal = truncatedCubePolygons({ center: [0, 0, 0], size });
  const dual = polyhedronDual(primal);
  return dual.map((p) => ({
    vertices: p.vertices.map(([x, y, z]) => [x + center[0], y + center[1], z + center[2]] as Vec3),
    color,
  }));
}
