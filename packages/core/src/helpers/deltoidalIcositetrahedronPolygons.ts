/**
 * Geometry for a deltoidal icositetrahedron — 24 kite faces.
 * The dual of the rhombicuboctahedron.
 */
import type { Polygon, Vec3 } from "../types";
import { rhombicuboctahedronPolygons } from "./rhombicuboctahedronPolygons";
import { polyhedronDual } from "./_dualPolyhedron";

export interface DeltoidalIcositetrahedronPolygonsOptions {
  center: Vec3;
  size: number;
  color?: string;
}

export function deltoidalIcositetrahedronPolygons(options: DeltoidalIcositetrahedronPolygonsOptions): Polygon[] {
  const { center, size, color = "#ffffff" } = options;
  const primal = rhombicuboctahedronPolygons({ center: [0, 0, 0], size });
  const dual = polyhedronDual(primal);
  return dual.map((p) => ({
    vertices: p.vertices.map(([x, y, z]) => [x + center[0], y + center[1], z + center[2]] as Vec3),
    color,
  }));
}
