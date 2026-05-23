/**
 * Geometry for a rhombic triacontahedron — 30 rhombic faces.
 * The dual of the icosidodecahedron.
 */
import type { Polygon, Vec3 } from "../types";
import { icosidodecahedronPolygons } from "./icosidodecahedronPolygons";
import { polyhedronDual } from "./_dualPolyhedron";

export interface RhombicTriacontahedronPolygonsOptions {
  center: Vec3;
  size: number;
  color?: string;
}

export function rhombicTriacontahedronPolygons(options: RhombicTriacontahedronPolygonsOptions): Polygon[] {
  const { center, size, color = "#ffffff" } = options;
  const primal = icosidodecahedronPolygons({ center: [0, 0, 0], size });
  const dual = polyhedronDual(primal);
  return dual.map((p) => ({
    vertices: p.vertices.map(([x, y, z]) => [x + center[0], y + center[1], z + center[2]] as Vec3),
    color,
  }));
}
