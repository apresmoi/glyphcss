export {
  AmbientLight,
  Camera,
  DirectionalLight,
  Euler,
  Object3D,
  OrthographicCamera,
  PerspectiveCamera,
  Vector3,
  glyphToThreeDirection,
  glyphToThreePoint,
  threeToGlyphDirection,
  threeToGlyphPoint,
  transformPointToGlyph,
  transformPolygonsToGlyph,
} from "@glyphcss/core/three";
export type {
  GlyphProjectionMetrics,
  ThreeGlyphCamera,
  Vector3Tuple,
} from "@glyphcss/core/three";

export { compileScene } from "./api/compileScene";
export type { CompileSceneOptions, CompileSceneResult } from "./api/compileScene";

export {
  cubePolygons,
  loadMesh,
  planePolygons,
  resolveGeometry,
} from "@glyphcss/core";
export type {
  GlyphAmbientLight,
  GlyphDirectionalLight,
  GlyphGeometryName,
  GlyphGeometryOptions,
  LoadMeshOptions,
  Polygon,
  Vec3,
} from "@glyphcss/core";
