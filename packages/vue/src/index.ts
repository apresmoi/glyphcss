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

export { PolyControls, TransformControls } from "./controls";
export type {
  PolyControlsProps,
  PolyControlsAnimateOptions,
  PolyControlsCamera,
  TransformControlsObject,
  TransformControlsObjectChangeEvent,
} from "./controls";

export { Select, useSelect, useSelectionApi, SelectionContextKey } from "./select";
export type { SelectionApi } from "./select";

export { findMeshHandle, findMeshUnderPoint, pointInMeshElement } from "./scene/events";
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

export { injectBaseStyles } from "./styles";

// ── Re-exports from @layoutit/polycss-core ─────────────────────────────────────────────
export type {
  Polygon,
  Vec2,
  Vec3,
  DirectionalLight,
  AmbientLight,
  TextureLightingMode,
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
