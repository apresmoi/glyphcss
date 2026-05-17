// @layoutit/polycss-react — React bindings for the polycss CSS-based polygon mesh
// rendering engine.
//
// Public exports define the supported React package surface. Anything not
// exported here is an implementation detail.

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

export { PolyScene, PolyMesh, PolyGround, usePolySceneContext, usePolyMesh, findPolyMeshHandle, pointInMeshElement, findMeshUnderPoint, usePolyMaterial } from "./scene";
export type {
  PolySceneProps,
  PolyMeshProps,
  PolyGroundProps,
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
  PolyRenderStrategy,
  PolyRenderStrategiesOption,
} from "./scene";

export { Poly } from "./shapes";
export type { PolyProps, TransformProps, DOMPassthroughProps } from "./shapes";

export { PolyFirstPersonControls, PolyOrbitControls, PolyMapControls, PolyTransformControls } from "./controls";
export type {
  PolyFirstPersonControlsProps,
  PolyFirstPersonControlsOptions,
  PolyFirstPersonControlsHandle,
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

export { usePolyAnimation } from "./animation/usePolyAnimation";
export type { UsePolyAnimationResult } from "./animation/usePolyAnimation";

// ── Re-exports from @layoutit/polycss-core for convenience ──────────────────
export type {
  Vec2,
  Vec3,
  Polygon,
  PolyMaterial,
  PolyDirectionalLight,
  PolyAmbientLight,
  PolyTextureLightingMode,
  MeshResolution,
  ParseAnimationClip,
  ParseAnimationController,
  ParseResult,
  PolyAnimationClip,
  PolyAnimationAction,
  PolyAnimationMixer,
  PolyAnimationTarget,
  LoopMode,
  ObjParseOptions,
  GltfParseOptions,
  MtlParseResult,
  NormalizeResult,
  ParsedColor,
  TextureTriangle,
  PolygonFace,
  SceneBbox,
  SceneContext,
  SceneContextBuildArgs,
  SceneContextBuildResult,
  CameraState,
  CameraHandle,
  CameraStyleInput,
  AutoRotateOption,
  AutoRotateConfig,
  AxesHelperOptions,
  ArrowPolygonsOptions,
  RingPolygonsOptions,
  OctahedronPolygonsOptions,
  LoadMeshOptions,
  VoxParseOptions,
  SolidTextureSampleOptions,
  TexturePaintMetrics,
  TexturePaintMetricsOptions,
  CoverPlanarPolygonsOptions,
  CullInteriorOptions,
  CameraCullNormalGroup,
  CameraCullRotation,
  ApproximateMergeOptions,
  OptimizeMeshPolygonsOptions,
} from "@layoutit/polycss-core";
export {
  CAMERA_BACKFACE_CULL_EPS,
  VOXEL_CAMERA_CULL_AXIS_EPS,
  VOXEL_CAMERA_CULL_NORMAL_LIMIT,
  normalizePolygons,
  mergePolygons,
  coverPlanarPolygons,
  optimizeMeshPolygons,
  cullInteriorPolygons,
  cameraCullNormalGroups,
  cameraCullNormalGroupsFromPolygons,
  cameraCullNormalKey,
  cameraCullVisibleSignature,
  cameraFacingDepth,
  isAxisAlignedSurfaceNormal,
  isVoxelCameraCullableNormalGroups,
  normalFacesCamera,
  polygonCssSurfaceNormal,
  polygonFacesCamera,
  parseObj,
  parseMtl,
  parseGltf,
  bakeSolidTextureSamples,
  bakeSolidTextureSampledPolygons,
  loadMesh,
  createIsometricCamera,
  parseVox,
  polygonFaces,
  computeTexturePaintMetrics,
  computeShapeLighting,
  parseColor,
  parsePureColor,
  parseHexColor,
  parseRgbColor,
  formatColor,
  clampChannel,
  shadeColor,
  rotateVec3,
  inverseRotateVec3,
  axesHelperPolygons,
  arrowPolygons,
  ringPolygons,
  octahedronPolygons,
  buildSceneContext,
  computeSceneBbox,
  BASE_TILE,
  DEFAULT_CAMERA_STATE,
  DEFAULT_PROJECTION,
  normalizeInvertMultiplier,
  createPolyAnimationMixer,
  LoopOnce,
  LoopRepeat,
  LoopPingPong,
} from "@layoutit/polycss-core";

// ── Glyphcss (ASCII paint backend) bindings ─────────────────────────────────
export {
  GlyphcssScene,
  GlyphcssMesh,
  GlyphcssHotspot,
  GlyphcssSceneContext,
  useGlyphcssSceneContext,
  useGlyphcssMesh,
  findGlyphcssMeshHandle,
  GlyphcssCamera,
  GlyphcssPerspectiveCamera,
  GlyphcssOrthographicCamera,
  GlyphcssCameraContext,
  useGlyphcssCamera,
  GlyphcssOrbitControls,
  GlyphcssMapControls,
  GlyphcssFirstPersonControls,
  GlyphcssAxesHelper,
  GlyphcssDirectionalLightHelper,
  injectGlyphcssBaseStyles,
  useGlyphcssAnimation,
} from "./glyphcss";
export type {
  GlyphcssSceneProps,
  GlyphcssMeshProps,
  GlyphcssHotspotProps,
  GlyphcssSceneContextValue,
  UseGlyphcssMeshResult,
  UseGlyphcssMeshOptions,
  GlyphcssCameraProps,
  GlyphcssPerspectiveCameraProps,
  GlyphcssOrthographicCameraProps,
  GlyphcssCameraContextValue,
  GlyphcssOrbitControlsProps,
  GlyphcssMapControlsProps,
  GlyphcssFirstPersonControlsProps,
  GlyphcssAxesHelperProps,
  GlyphcssDirectionalLightHelperProps,
  UseGlyphcssAnimationResult,
} from "./glyphcss";
