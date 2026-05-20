/**
 * Geometry for a pentagonal hexecontahedron — 60 irregular-pentagon faces.
 * The dual of the snub dodecahedron.
 */
import type { Polygon, Vec3 } from "../types";
import { snubDodecahedronPolygons } from "./snubDodecahedronPolygons";
import { polyhedronDual } from "./_dualPolyhedron";

export interface PentagonalHexecontahedronPolygonsOptions {
  center: Vec3;
  size: number;
  color?: string;
}

export function pentagonalHexecontahedronPolygons(options: PentagonalHexecontahedronPolygonsOptions): Polygon[] {
  const { center, size, color = "#ffffff" } = options;
  const primal = snubDodecahedronPolygons({ center: [0, 0, 0], size });
  const dual = polyhedronDual(primal);
  return dual.map((p) => ({
    vertices: p.vertices.map(([x, y, z]) => [x + center[0], y + center[1], z + center[2]] as Vec3),
    color,
  }));
}
