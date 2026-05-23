/**
 * Geometry for a disdyakis dodecahedron — 48 scalene-triangle faces.
 * The dual of the truncated cuboctahedron.
 */
import type { Polygon, Vec3 } from "../types";
import { truncatedCuboctahedronPolygons } from "./truncatedCuboctahedronPolygons";
import { polyhedronDual } from "./_dualPolyhedron";

export interface DisdyakisDodecahedronPolygonsOptions {
  center: Vec3;
  size: number;
  color?: string;
}

export function disdyakisDodecahedronPolygons(options: DisdyakisDodecahedronPolygonsOptions): Polygon[] {
  const { center, size, color = "#ffffff" } = options;
  const primal = truncatedCuboctahedronPolygons({ center: [0, 0, 0], size });
  const dual = polyhedronDual(primal);
  return dual.map((p) => ({
    vertices: p.vertices.map(([x, y, z]) => [x + center[0], y + center[1], z + center[2]] as Vec3),
    color,
  }));
}
