/**
 * Geometry for a pentakis dodecahedron — 60 isosceles-triangle faces.
 * The dual of the truncated icosahedron.
 */
import type { Polygon, Vec3 } from "../types";
import { truncatedIcosahedronPolygons } from "./truncatedIcosahedronPolygons";
import { polyhedronDual } from "./_dualPolyhedron";

export interface PentakisDodecahedronPolygonsOptions {
  center: Vec3;
  size: number;
  color?: string;
}

export function pentakisDodecahedronPolygons(options: PentakisDodecahedronPolygonsOptions): Polygon[] {
  const { center, size, color = "#ffffff" } = options;
  const primal = truncatedIcosahedronPolygons({ center: [0, 0, 0], size });
  const dual = polyhedronDual(primal);
  return dual.map((p) => ({
    vertices: p.vertices.map(([x, y, z]) => [x + center[0], y + center[1], z + center[2]] as Vec3),
    color,
  }));
}
