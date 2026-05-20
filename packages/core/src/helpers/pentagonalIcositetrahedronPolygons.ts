/**
 * Geometry for a pentagonal icositetrahedron — 24 irregular-pentagon faces.
 * The dual of the snub cube.
 */
import type { Polygon, Vec3 } from "../types";
import { snubCubePolygons } from "./snubCubePolygons";
import { polyhedronDual } from "./_dualPolyhedron";

export interface PentagonalIcositetrahedronPolygonsOptions {
  center: Vec3;
  size: number;
  color?: string;
}

export function pentagonalIcositetrahedronPolygons(options: PentagonalIcositetrahedronPolygonsOptions): Polygon[] {
  const { center, size, color = "#ffffff" } = options;
  const primal = snubCubePolygons({ center: [0, 0, 0], size });
  const dual = polyhedronDual(primal);
  return dual.map((p) => ({
    vertices: p.vertices.map(([x, y, z]) => [x + center[0], y + center[1], z + center[2]] as Vec3),
    color,
  }));
}
