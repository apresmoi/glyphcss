import type { Polygon, Vec3 } from "../types";
import { tetrahedronPolygons } from "./tetrahedronPolygons";
import { cubePolygons } from "./cubePolygons";
import { octahedronPolygons } from "./octahedronPolygons";
import { dodecahedronPolygons } from "./dodecahedronPolygons";
import { icosahedronPolygons } from "./icosahedronPolygons";
import { smallStellatedDodecahedronPolygons } from "./smallStellatedDodecahedronPolygons";
import { greatDodecahedronPolygons } from "./greatDodecahedronPolygons";
import { greatStellatedDodecahedronPolygons } from "./greatStellatedDodecahedronPolygons";
import { greatIcosahedronPolygons } from "./greatIcosahedronPolygons";
import { cuboctahedronPolygons } from "./cuboctahedronPolygons";
import { icosidodecahedronPolygons } from "./icosidodecahedronPolygons";
import { truncatedTetrahedronPolygons } from "./truncatedTetrahedronPolygons";
import { truncatedCubePolygons } from "./truncatedCubePolygons";
import { truncatedOctahedronPolygons } from "./truncatedOctahedronPolygons";
import { truncatedDodecahedronPolygons } from "./truncatedDodecahedronPolygons";
import { truncatedIcosahedronPolygons } from "./truncatedIcosahedronPolygons";
import { truncatedCuboctahedronPolygons } from "./truncatedCuboctahedronPolygons";
import { truncatedIcosidodecahedronPolygons } from "./truncatedIcosidodecahedronPolygons";
import { rhombicuboctahedronPolygons } from "./rhombicuboctahedronPolygons";
import { rhombicosidodecahedronPolygons } from "./rhombicosidodecahedronPolygons";
import { snubCubePolygons } from "./snubCubePolygons";
import { snubDodecahedronPolygons } from "./snubDodecahedronPolygons";
import { rhombicDodecahedronPolygons } from "./rhombicDodecahedronPolygons";
import { rhombicTriacontahedronPolygons } from "./rhombicTriacontahedronPolygons";
import { triakisTetrahedronPolygons } from "./triakisTetrahedronPolygons";
import { triakisOctahedronPolygons } from "./triakisOctahedronPolygons";
import { triakisIcosahedronPolygons } from "./triakisIcosahedronPolygons";
import { tetrakisHexahedronPolygons } from "./tetrakisHexahedronPolygons";
import { pentakisDodecahedronPolygons } from "./pentakisDodecahedronPolygons";
import { disdyakisDodecahedronPolygons } from "./disdyakisDodecahedronPolygons";
import { disdyakisTriacontahedronPolygons } from "./disdyakisTriacontahedronPolygons";
import { deltoidalIcositetrahedronPolygons } from "./deltoidalIcositetrahedronPolygons";
import { deltoidalHexecontahedronPolygons } from "./deltoidalHexecontahedronPolygons";
import { pentagonalIcositetrahedronPolygons } from "./pentagonalIcositetrahedronPolygons";
import { pentagonalHexecontahedronPolygons } from "./pentagonalHexecontahedronPolygons";
import { spherePolygons } from "./spherePolygons";
import { cylinderPolygons } from "./cylinderPolygons";
import { conePolygons } from "./conePolygons";
import { torusPolygons } from "./torusPolygons";
import { pyramidPolygons } from "./pyramidPolygons";
import { prismPolygons } from "./prismPolygons";
import { antiprismPolygons } from "./antiprismPolygons";
import { bipyramidPolygons } from "./bipyramidPolygons";
import { trapezohedronPolygons } from "./trapezohedronPolygons";

export type GlyphcssGeometryName =
  | "tetrahedron"
  | "cube"
  | "octahedron"
  | "dodecahedron"
  | "icosahedron"
  | "smallStellatedDodecahedron"
  | "greatDodecahedron"
  | "greatStellatedDodecahedron"
  | "greatIcosahedron"
  | "cuboctahedron"
  | "icosidodecahedron"
  | "truncatedTetrahedron"
  | "truncatedCube"
  | "truncatedOctahedron"
  | "truncatedDodecahedron"
  | "truncatedIcosahedron"
  | "truncatedCuboctahedron"
  | "truncatedIcosidodecahedron"
  | "rhombicuboctahedron"
  | "rhombicosidodecahedron"
  | "snubCube"
  | "snubDodecahedron"
  | "rhombicDodecahedron"
  | "rhombicTriacontahedron"
  | "triakisTetrahedron"
  | "triakisOctahedron"
  | "triakisIcosahedron"
  | "tetrakisHexahedron"
  | "pentakisDodecahedron"
  | "disdyakisDodecahedron"
  | "disdyakisTriacontahedron"
  | "deltoidalIcositetrahedron"
  | "deltoidalHexecontahedron"
  | "pentagonalIcositetrahedron"
  | "pentagonalHexecontahedron"
  | "sphere"
  | "cylinder"
  | "cone"
  | "torus"
  | "pyramid"
  | "prism"
  | "antiprism"
  | "bipyramid"
  | "trapezohedron";

export interface GlyphcssGeometryOptions {
  center?: Vec3;
  size?: number;
  color?: string;
}

/**
 * Resolve a built-in geometry name to a `Polygon[]` list.
 *
 * Precedence for mesh sources: explicit `polygons` > `src` > `geometry`.
 * When both `src` and `geometry` are supplied, `src` wins silently.
 */
export function resolveGeometry(
  name: GlyphcssGeometryName,
  opts: GlyphcssGeometryOptions = {},
): Polygon[] {
  const { center = [0, 0, 0] as Vec3, size = 1, color } = opts;
  switch (name) {
    case "tetrahedron":               return tetrahedronPolygons({ center, size, color });
    case "cube":                      return cubePolygons({ center, size, color });
    case "octahedron":                return octahedronPolygons({ center, size, color });
    case "dodecahedron":              return dodecahedronPolygons({ center, size, color });
    case "icosahedron":               return icosahedronPolygons({ center, size, color });
    case "smallStellatedDodecahedron": return smallStellatedDodecahedronPolygons({ center, size, color });
    case "greatDodecahedron":         return greatDodecahedronPolygons({ center, size, color });
    case "greatStellatedDodecahedron": return greatStellatedDodecahedronPolygons({ center, size, color });
    case "greatIcosahedron":          return greatIcosahedronPolygons({ center, size, color });
    case "cuboctahedron":             return cuboctahedronPolygons({ center, size, color });
    case "icosidodecahedron":         return icosidodecahedronPolygons({ center, size, color });
    case "truncatedTetrahedron":      return truncatedTetrahedronPolygons({ center, size, color });
    case "truncatedCube":             return truncatedCubePolygons({ center, size, color });
    case "truncatedOctahedron":       return truncatedOctahedronPolygons({ center, size, color });
    case "truncatedDodecahedron":     return truncatedDodecahedronPolygons({ center, size, color });
    case "truncatedIcosahedron":      return truncatedIcosahedronPolygons({ center, size, color });
    case "truncatedCuboctahedron":    return truncatedCuboctahedronPolygons({ center, size, color });
    case "truncatedIcosidodecahedron": return truncatedIcosidodecahedronPolygons({ center, size, color });
    case "rhombicuboctahedron":       return rhombicuboctahedronPolygons({ center, size, color });
    case "rhombicosidodecahedron":    return rhombicosidodecahedronPolygons({ center, size, color });
    case "snubCube":                  return snubCubePolygons({ center, size, color });
    case "snubDodecahedron":          return snubDodecahedronPolygons({ center, size, color });
    case "rhombicDodecahedron":       return rhombicDodecahedronPolygons({ center, size, color });
    case "rhombicTriacontahedron":    return rhombicTriacontahedronPolygons({ center, size, color });
    case "triakisTetrahedron":        return triakisTetrahedronPolygons({ center, size, color });
    case "triakisOctahedron":         return triakisOctahedronPolygons({ center, size, color });
    case "triakisIcosahedron":        return triakisIcosahedronPolygons({ center, size, color });
    case "tetrakisHexahedron":        return tetrakisHexahedronPolygons({ center, size, color });
    case "pentakisDodecahedron":      return pentakisDodecahedronPolygons({ center, size, color });
    case "disdyakisDodecahedron":     return disdyakisDodecahedronPolygons({ center, size, color });
    case "disdyakisTriacontahedron":  return disdyakisTriacontahedronPolygons({ center, size, color });
    case "deltoidalIcositetrahedron": return deltoidalIcositetrahedronPolygons({ center, size, color });
    case "deltoidalHexecontahedron":  return deltoidalHexecontahedronPolygons({ center, size, color });
    case "pentagonalIcositetrahedron": return pentagonalIcositetrahedronPolygons({ center, size, color });
    case "pentagonalHexecontahedron": return pentagonalHexecontahedronPolygons({ center, size, color });
    case "sphere":      return spherePolygons({ center, size, color });
    case "cylinder":    return cylinderPolygons({ center, radius: size, height: size * 2, color });
    case "cone":        return conePolygons({ center, radius: size, height: size * 2, color });
    case "torus":       return torusPolygons({ center, majorRadius: size, minorRadius: size * 0.3, color });
    case "pyramid":     return pyramidPolygons({ center, radius: size, height: size * 2, color });
    case "prism":       return prismPolygons({ center, radius: size, height: size * 2, color });
    case "antiprism":   return antiprismPolygons({ center, radius: size, height: size * 2, color });
    case "bipyramid":   return bipyramidPolygons({ center, radius: size, halfHeight: size, color });
    case "trapezohedron": return trapezohedronPolygons({ center, radius: size, halfHeight: size, color });
    default: {
      const _exhaust: never = name;
      throw new Error(`Unknown geometry: ${String(_exhaust)}`);
    }
  }
}
