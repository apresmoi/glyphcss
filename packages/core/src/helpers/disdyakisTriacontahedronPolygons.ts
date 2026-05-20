/**
 * Geometry for a disdyakis triacontahedron — 120 scalene-triangle faces.
 * The dual of the truncated icosidodecahedron.
 */
import type { Polygon, Vec3 } from "../types";
import { truncatedIcosidodecahedronPolygons } from "./truncatedIcosidodecahedronPolygons";
import { polyhedronDual } from "./_dualPolyhedron";

export interface DisdyakisTriacontahedronPolygonsOptions {
  center: Vec3;
  size: number;
  color?: string;
}

export function disdyakisTriacontahedronPolygons(options: DisdyakisTriacontahedronPolygonsOptions): Polygon[] {
  const { center, size, color = "#ffffff" } = options;
  const primal = truncatedIcosidodecahedronPolygons({ center: [0, 0, 0], size });
  const dual = polyhedronDual(primal);
  return dual.map((p) => ({
    vertices: p.vertices.map(([x, y, z]) => [x + center[0], y + center[1], z + center[2]] as Vec3),
    color,
  }));
}
