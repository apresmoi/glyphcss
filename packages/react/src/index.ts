// @polycss/react — React bindings for the polycss CSS-based polygon mesh
// rendering engine.
//
// Public surface follows §API freeze in POLYCSS_MIGRATION.md
// (`@polycss/react — full surface`). Anything not exported here is an
// implementation detail.

// ── Components & hooks ─────────────────────────────────────────────
export {
  PolyCamera,
  useCamera,
  PolyCameraContext,
  useCameraContext,
} from "./camera";
export type {
  PolyCameraProps,
  UseCameraOptions,
  UseCameraResult,
  PolyCameraContextValue,
} from "./camera";

export { PolyScene, PolyMesh, useSceneContext, useMesh } from "./scene";
export type {
  PolySceneProps,
  PolyMeshProps,
  UseSceneContextOptions,
  UseSceneContextResult,
  UseMeshResult,
  UseMeshOptions,
} from "./scene";

export { Poly } from "./shapes";
export type { PolyProps, TransformProps, DOMPassthroughProps } from "./shapes";

export { injectBaseStyles } from "./styles";

// ── Re-exports from @polycss/core for convenience ──────────────────
export type {
  Vec2,
  Vec3,
  Polygon,
  DirectionalLight,
  TextureLightingMode,
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
