/**
 * Geometry for a deltoidal hexecontahedron — 60 kite faces.
 * The dual of the rhombicosidodecahedron.
 */
import type { Polygon, Vec3 } from "../types";
import { rhombicosidodecahedronPolygons } from "./rhombicosidodecahedronPolygons";
import { polyhedronDual } from "./_dualPolyhedron";

export interface DeltoidalHexecontahedronPolygonsOptions {
  center: Vec3;
  size: number;
  color?: string;
}

export function deltoidalHexecontahedronPolygons(options: DeltoidalHexecontahedronPolygonsOptions): Polygon[] {
  const { center, size, color = "#ffffff" } = options;
  const primal = rhombicosidodecahedronPolygons({ center: [0, 0, 0], size });
  const dual = polyhedronDual(primal);
  return dual.map((p) => ({
    vertices: p.vertices.map(([x, y, z]) => [x + center[0], y + center[1], z + center[2]] as Vec3),
    color,
  }));
}
