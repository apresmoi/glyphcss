// @glyphcss/core — Pure-math polygon + ASCII rendering engine (zero browser globals).
//
// Public exports define the supported core package surface. Anything not
// exported here is implementation detail.

// ── Types ─────────────────────────────────────────────────────────
export type {
  Vec2,
  Vec3,
  TextureTriangle,
  Polygon,
  GlyphcssDirectionalLight,
  GlyphcssAmbientLight,
  MeshResolution,
} from "./types";
export { DEFAULT_PROJECTION } from "./types";

// ── Scene context + normalization ────────────────────────────────
export {
  buildSceneContext,
  computeSceneBbox,
  normalizePolygons,
} from "./scene/context";
export type {
  SceneContext,
  SceneContextBuildArgs,
  SceneContextBuildResult,
  SceneBbox,
  NormalizeResult,
} from "./scene/context";

// ── Polygon geometry helper ──────────────────────────────────────
export { polygonFaces } from "./scene/polygonGeometry";
export type { PolygonFace } from "./scene/polygonGeometry";

// ── Rotation math ────────────────────────────────────────────────
export { rotateVec3, inverseRotateVec3 } from "./math/rotation";
export {
  quatFromAxisAngle,
  quatFromEulerXYZ,
  quatMultiply,
  eulerXYZFromQuat,
  QUAT_IDENTITY,
} from "./math/quaternion";
export type { Quat } from "./math/quaternion";

// ── Camera ────────────────────────────────────────────────────────
export {
  createIsometricCamera,
  normalizeInvertMultiplier,
  DEFAULT_CAMERA_STATE,
  BASE_TILE,
} from "./camera/camera";
export type {
  CameraState,
  CameraHandle,
  AutoRotateOption,
  AutoRotateConfig,
  CameraStyleInput,
} from "./camera/camera";

// ── Color & lighting ─────────────────────────────────────────────
export {
  parseColor,
  shadeColor,
  computeShapeLighting,
} from "./color/lighting";
export type { ParsedColor } from "./color/lighting";

export {
  parsePureColor,
  parseHexColor,
  parseRgbColor,
  clampChannel,
  formatColor,
} from "./color/color";

// ── Mesh post-processing ──────────────────────────────────────────
export { mergePolygons } from "./merge/mergePolygons";
export {
  dedupeOverlappingPolygons,
  findOverlappingPolygonDuplicates,
} from "./merge/dedupeOverlappingPolygons";
export type { DedupeOverlappingPolygonsOptions } from "./merge/dedupeOverlappingPolygons";
export { coverPlanarPolygons } from "./merge/coverPlanarPolygons";
export type { CoverPlanarPolygonsOptions } from "./merge/coverPlanarPolygons";
export { optimizeMeshPolygons } from "./merge/optimizePolygons";
export type {
  ApproximateMergeOptions,
  OptimizeMeshPolygonsOptions,
} from "./merge/optimizePolygons";
export { cullInteriorPolygons } from "./cull/cullInteriorPolygons";
export type { CullInteriorOptions } from "./cull/cullInteriorPolygons";
export {
  CAMERA_BACKFACE_CULL_EPS,
  VOXEL_CAMERA_CULL_AXIS_EPS,
  VOXEL_CAMERA_CULL_NORMAL_LIMIT,
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
} from "./cull/cameraBackfaceCulling";
export type {
  CameraCullNormalGroup,
  CameraCullRotation,
} from "./cull/cameraBackfaceCulling";

// ── Helper-gizmo geometry (axes, light marker, transform arrows / rings) ─
export { axesHelperPolygons, arrowPolygons, ringPolygons, ringQuadPolygons, planePolygons, octahedronPolygons, tetrahedronPolygons, cubePolygons, dodecahedronPolygons, icosahedronPolygons, spherePolygons, cylinderPolygons, conePolygons, torusPolygons, pyramidPolygons, prismPolygons, antiprismPolygons, bipyramidPolygons, trapezohedronPolygons, smallStellatedDodecahedronPolygons, greatDodecahedronPolygons, greatStellatedDodecahedronPolygons, greatIcosahedronPolygons, cuboctahedronPolygons, icosidodecahedronPolygons, truncatedTetrahedronPolygons, truncatedCubePolygons, truncatedOctahedronPolygons } from "./helpers";
export type { AxesHelperOptions, ArrowPolygonsOptions, RingPolygonsOptions, RingQuadPolygonsOptions, PlanePolygonsOptions, OctahedronPolygonsOptions, TetrahedronPolygonsOptions, CubePolygonsOptions, DodecahedronPolygonsOptions, IcosahedronPolygonsOptions, SpherePolygonsOptions, CylinderPolygonsOptions, ConePolygonsOptions, TorusPolygonsOptions, PyramidPolygonsOptions, PrismPolygonsOptions, AntiprismPolygonsOptions, BipyramidPolygonsOptions, TrapezohedronPolygonsOptions, SmallStellatedDodecahedronPolygonsOptions, GreatDodecahedronPolygonsOptions, GreatStellatedDodecahedronPolygonsOptions, GreatIcosahedronPolygonsOptions, CuboctahedronPolygonsOptions, IcosidodecahedronPolygonsOptions, TruncatedTetrahedronPolygonsOptions, TruncatedCubePolygonsOptions, TruncatedOctahedronPolygonsOptions } from "./helpers";

// ── Animation ─────────────────────────────────────────────────────
export {
  createGlyphcssAnimationMixer,
  LoopOnce,
  LoopRepeat,
  LoopPingPong,
} from "./animation";
export type {
  GlyphcssAnimationClip,
  GlyphcssAnimationAction,
  GlyphcssAnimationMixer,
  GlyphcssAnimationTarget,
  LoopMode,
} from "./animation";

// ── Parsers ───────────────────────────────────────────────────────
export type {
  ParseAnimationClip,
  ParseAnimationController,
  ParseResult,
} from "./parser/types";
export { parseObj } from "./parser/parseObj";
export type { ObjParseOptions } from "./parser/parseObj";
export { parseMtl } from "./parser/parseMtl";
export type { MtlParseResult } from "./parser/parseMtl";
export { parseGltf } from "./parser/parseGltf";
export type { GltfParseOptions } from "./parser/parseGltf";
export {
  bakeSolidTextureSamples,
  bakeSolidTextureSampledPolygons,
} from "./parser/solidTextureSamples";
export type { SolidTextureSampleOptions } from "./parser/solidTextureSamples";
export { parseVox } from "./parser/parseVox";
export type { VoxParseOptions } from "./parser/parseVox";
export { loadMesh } from "./parser/loadMesh";
export type { LoadMeshOptions } from "./parser/loadMesh";

// ── Glyphcss-specific (ASCII rendering) ─────────────────────────
export type {
  RenderMode,
  CharRamp,
  EdgeWeight,
  WireframeEdge,
  GridSize,
  Hotspot,
  HotspotCell,
} from "./types";
export { project } from "./math/projection";
export { trianglesToFeatureEdges } from "./scene/featureEdges";
