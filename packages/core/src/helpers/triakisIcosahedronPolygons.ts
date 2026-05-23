/**
 * Geometry for a triakis icosahedron — 60 isosceles-triangle faces.
 * The dual of the truncated dodecahedron.
 */
import type { Polygon, Vec3 } from "../types";
import { truncatedDodecahedronPolygons } from "./truncatedDodecahedronPolygons";
import { polyhedronDual } from "./_dualPolyhedron";

export interface TriakisIcosahedronPolygonsOptions {
  center: Vec3;
  size: number;
  color?: string;
}

export function triakisIcosahedronPolygons(options: TriakisIcosahedronPolygonsOptions): Polygon[] {
  const { center, size, color = "#ffffff" } = options;
  const primal = truncatedDodecahedronPolygons({ center: [0, 0, 0], size });
  const dual = polyhedronDual(primal);
  return dual.map((p) => ({
    vertices: p.vertices.map(([x, y, z]) => [x + center[0], y + center[1], z + center[2]] as Vec3),
    color,
  }));
}
