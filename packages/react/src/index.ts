// @layoutit/polycss-react — React bindings for the polycss CSS-based polygon mesh
// rendering engine.
//
// Public surface follows §API freeze in POLYCSS_MIGRATION.md
// (`@layoutit/polycss-react — full surface`). Anything not exported here is an
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

export { PolyScene, PolyMesh, useSceneContext, useMesh, findMeshHandle } from "./scene";
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

export { PolyControls, TransformControls } from "./controls";
export type {
  PolyControlsProps,
  PolyControlsAnimateOptions,
  TransformControlsProps,
  TransformControlsObject,
  TransformControlsObjectChangeEvent,
} from "./controls";

export { Select, useSelect, useSelectionApi } from "./select";
export type { SelectProps, SelectionApi } from "./select";

export { PolyAxesHelper, PolyDirectionalLightHelper } from "./helpers";
export type {
  PolyAxesHelperProps,
  PolyDirectionalLightHelperProps,
} from "./helpers";

export { injectBaseStyles } from "./styles";

// ── Re-exports from @layoutit/polycss-core for convenience ──────────────────
export type {
  Vec2,
  Vec3,
  Polygon,
  DirectionalLight,
  AmbientLight,
  TextureLightingMode,
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
  cullInteriorPolygons,
  parseObj,
  parseMtl,
  parseGltf,
  loadMesh,
  createIsometricCamera,
} from "@layoutit/polycss-core";
