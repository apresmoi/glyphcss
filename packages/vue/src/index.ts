// ── Components & composables ─────────────────────────────────────────────────

export { PolyCamera } from "./camera";
export type { PolyCameraProps } from "./camera";
export { PolyPerspectiveCamera } from "./camera";
export type { PolyPerspectiveCameraProps } from "./camera";
export { PolyOrthographicCamera } from "./camera";
export type { PolyOrthographicCameraProps } from "./camera";
export { usePolyCamera } from "./camera";
export type { UseCameraOptions, UseCameraResult } from "./camera";
export { PolyCameraContextKey } from "./camera";
export type { PolyCameraContextValue } from "./camera";

export { PolyScene } from "./scene";
export type { PolySceneProps } from "./scene";
export { PolyMesh } from "./scene";
export type { PolyMeshProps } from "./scene";
export { usePolySceneContext } from "./scene";
export type { UseSceneContextOptions, UseSceneContextResult } from "./scene";
export { usePolyMesh } from "./scene";
export type { UseMeshOptions, UseMeshResult } from "./scene";
export { usePolyMaterial } from "./scene/usePolyMaterial";

export { Poly } from "./shapes";
export type { PolyProps } from "./shapes";

export { PolyControls, PolyOrbitControls, PolyMapControls, PolyTransformControls } from "./controls";
export type {
  PolyOrbitControlsProps,
  PolyOrbitControlsCamera,
  PolyMapControlsProps,
  PolyMapControlsCamera,
  PolyControlsAnimateOptions,
  PolyTransformControlsObject,
  PolyTransformControlsObjectChangeEvent,
} from "./controls";

export { PolySelect, usePolySelect, usePolySelectionApi, PolySelectionContextKey } from "./select";
export type { PolySelectionApi } from "./select";

export { findPolyMeshHandle, findMeshUnderPoint, pointInMeshElement } from "./scene/events";
export type {
  PolyMeshHandle,
  PolyPointerEvent,
  PolyMouseEvent,
  PolyWheelEvent,
  PolyEventHandler,
  InteractionProps,
} from "./scene/events";

export { PolyAxesHelper, PolyDirectionalLightHelper } from "./helpers";
export type {
  PolyAxesHelperProps,
  PolyDirectionalLightHelperProps,
} from "./helpers";

export { injectPolyBaseStyles } from "./styles";

// ── Re-exports from @layoutit/polycss-core ─────────────────────────────────────────────
export type {
  Polygon,
  PolyMaterial,
  Vec2,
  Vec3,
  PolyDirectionalLight,
  PolyAmbientLight,
  PolyTextureLightingMode,
  ParseResult,
  ParseAnimationClip,
  ParseAnimationController,
  ObjParseOptions,
  GltfParseOptions,
  MtlParseResult,
  NormalizeResult,
} from "@layoutit/polycss-core";
export {
  normalizePolygons,
  mergePolygons,
  cullInteriorPolygons,
  parseObj,
  parseMtl,
  parseGltf,
  loadMesh,
  createIsometricCamera,
} from "@layoutit/polycss-core";
