/**
 * Geometry for a tetrakis hexahedron — 24 isosceles-triangle faces.
 * The dual of the truncated octahedron.
 */
import type { Polygon, Vec3 } from "../types";
import { truncatedOctahedronPolygons } from "./truncatedOctahedronPolygons";
import { polyhedronDual } from "./_dualPolyhedron";

export interface TetrakisHexahedronPolygonsOptions {
  center: Vec3;
  size: number;
  color?: string;
}

export function tetrakisHexahedronPolygons(options: TetrakisHexahedronPolygonsOptions): Polygon[] {
  const { center, size, color = "#ffffff" } = options;
  const primal = truncatedOctahedronPolygons({ center: [0, 0, 0], size });
  const dual = polyhedronDual(primal);
  return dual.map((p) => ({
    vertices: p.vertices.map(([x, y, z]) => [x + center[0], y + center[1], z + center[2]] as Vec3),
    color,
  }));
}
