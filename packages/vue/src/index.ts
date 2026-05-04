// ── Components & composables ─────────────────────────────────────────────────

export { PolyCamera } from "./camera";
export type { PolyCameraProps } from "./camera";
export { useCamera } from "./camera";
export type { UseCameraOptions, UseCameraResult } from "./camera";
export { PolyCameraContextKey } from "./camera";
export type { PolyCameraContextValue } from "./camera";

export { PolyScene } from "./scene";
export type { PolySceneProps } from "./scene";
export { PolyMesh } from "./scene";
export type { PolyMeshProps } from "./scene";
export { useSceneContext } from "./scene";
export type { UseSceneContextOptions, UseSceneContextResult } from "./scene";
export { useMesh } from "./scene";
export type { UseMeshOptions, UseMeshResult } from "./scene";

export { Poly } from "./shapes";
export type { PolyProps } from "./shapes";

export { injectBaseStyles } from "./styles";

// ── Re-exports from @polycss/core ─────────────────────────────────────────────
export type {
  Polygon,
  Vec2,
  Vec3,
  DirectionalLight,
  ProjectionMode,
  ParseResult,
  ObjParseOptions,
  GltfParseOptions,
  MtlParseResult,
  NormalizeResult,
} from "@polycss/core";
export {
  normalizePolygons,
  mergePolygons,
  parseObj,
  parseMtl,
  parseGltf,
  loadMesh,
  createIsometricCamera,
} from "@polycss/core";
