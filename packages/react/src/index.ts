// @layoutit/polycss-react — React bindings for the polycss CSS-based polygon mesh
// rendering engine.
//
// Public surface follows §API freeze in POLYCSS_MIGRATION.md
// (`@layoutit/polycss-react — full surface`). Anything not exported here is an
// implementation detail.

// ── Components & hooks ─────────────────────────────────────────────────
export {
  PolyPerspectiveCamera,
  PolyOrthographicCamera,
  PolyCamera,
  usePolyCamera,
  PolyCameraContext,
  useCameraContext,
} from "./camera";
export type {
  PolyPerspectiveCameraProps,
  PolyOrthographicCameraProps,
  PolyCameraProps,
  UseCameraOptions,
  UseCameraResult,
  PolyCameraContextValue,
} from "./camera";

export { PolyScene, PolyMesh, usePolySceneContext, usePolyMesh, findPolyMeshHandle, usePolyMaterial } from "./scene";
export type {
  PolySceneProps,
  PolyMeshProps,
  UseSceneContextOptions,
  UseSceneContextResult,
  UseMeshResult,
  UseMeshOptions,
  PolyMeshHandle,
  PolyPointerEvent,
  PolyMouseEvent,
  PolyWheelEvent,
  PolyEventHandler,
  InteractionProps,
} from "./scene";

export { Poly } from "./shapes";
export type { PolyProps, TransformProps, DOMPassthroughProps } from "./shapes";

export { PolyControls, PolyOrbitControls, PolyMapControls, PolyTransformControls } from "./controls";
export type {
  PolyOrbitControlsProps,
  PolyOrbitControlsCamera,
  PolyMapControlsProps,
  PolyMapControlsCamera,
  PolyControlsAnimateOptions,
  PolyControlsCamera,
  SharedControlsProps,
  PolyTransformControlsProps,
  PolyTransformControlsObject,
  PolyTransformControlsObjectChangeEvent,
} from "./controls";

export { PolySelect, usePolySelect, usePolySelectionApi } from "./select";
export type { PolySelectProps, PolySelectionApi } from "./select";

export { PolyAxesHelper, PolyDirectionalLightHelper } from "./helpers";
export type {
  PolyAxesHelperProps,
  PolyDirectionalLightHelperProps,
} from "./helpers";

export { injectPolyBaseStyles } from "./styles";

// ── Re-exports from @layoutit/polycss-core for convenience ──────────────────
export type {
  Vec2,
  Vec3,
  Polygon,
  PolyMaterial,
  PolyDirectionalLight,
  PolyAmbientLight,
  PolyTextureLightingMode,
  ParseAnimationClip,
  ParseAnimationController,
  ParseResult,
  ObjParseOptions,
  GltfParseOptions,
  MtlParseResult,
  NormalizeResult,
} from "@layoutit/polycss-core";
export {
  normalizePolygons,
  mergePolygons,
  coverPlanarPolygons,
  cullInteriorPolygons,
  parseObj,
  parseMtl,
  parseGltf,
  loadMesh,
  createIsometricCamera,
} from "@layoutit/polycss-core";
