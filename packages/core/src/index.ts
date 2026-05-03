// @layoutit/voxcss-core — Pure-math voxel rendering engine (zero browser globals)

export type {
  Vec3,
  Voxel,
  VoxelGrid,
  CubeFace,
  GridContext,
  WallsMask,
  OffsetMap,
  ProjectionMode,
  FaceAppearanceOverride
} from "./types";
export {
  CUBE_FACES, DEFAULT_WALLS, DEFAULT_OFFSETS, BASE_TILE, SCENE_CLASS,
  DEFAULT_WALL_COLOR, LAYER_CLASS, FLOOR_CLASS, FACE_CLASS, CUBE_CLASS,
  WALL_CLASS, CEILING_CLASS, STYLE_ID
} from "./types";

export { buildSceneContext, getVoxelBounds, getVoxelZBounds, wallMasksEqual, computeWallMask } from "./scene/context";
export type { SceneContextBuildResult } from "./scene/context";
export { computeVisibleFaces, computeFacesWithOcclusion } from "./scene/visibility";
export { precomputeOcclusion } from "./scene/occlusion";
export type { OcclusionMap } from "./scene/occlusion";
export { directionBinFromCamera, directionVectorFromBin, OCCLUSION_DIR_BINS, AZIMUTH_BINS, ELEVATION_BINS } from "./scene/occlusionDirection";
export { isCovered, isBottomOccluded, shouldRenderBottom } from "./scene/coverage";
export { voxelToPolygons } from "./scene/polygonModel";
export type { Polygon } from "./scene/polygonModel";
export { findGaps } from "./scene/manifoldCheck";
export type { GapReport } from "./scene/manifoldCheck";
export { extractExteriorSurface } from "./scene/exteriorSurface";
export { findGeometricDefects } from "./scene/geometricCheck";
export type { GeometricDefect } from "./scene/geometricCheck";
export { simulatedAnnealing, score as scoreVoxels } from "./scene/searchSA";
export type { SAOptions, SAResult, ScoreBreakdown } from "./scene/searchSA";
export { computeShapeStyle } from "./shape/shapeStyle";
export { shapeCoversFullyFace, oppositeFace } from "./shape/coverage";

export { createIsometricCamera, normalizeInvertMultiplier } from "./camera/camera";
export type { CameraState, CameraHandle, AutoRotateOption, AutoRotateConfig } from "./camera/camera";

export {
  parseColor,
  shadeColor,
  shadeCubeFace,
  shadeWallFace,
  getCubeFaceLightDelta,
  computeShapeLighting,
  setColorResolver
} from "./color/lighting";
export type { ParsedColor, ShapeType, ShapeSurfaceLighting, ColorResolver } from "./color/lighting";

export {
  parsePureColor,
  parseHexColor,
  parseRgbColor,
  clampChannel,
  formatColor
} from "./color/color";

export {
  computeCubeFaceAppearance,
  getCubeFaceAppearanceSignature
} from "./color/faceAppearance";
export type { CubeFaceAppearance } from "./color/faceAppearance";

export { mergeVoxels } from "./merge/mergeVoxels";
export { mergePolygons } from "./merge/mergePolygons";
export {
  normalizeMergeVoxelsOption,
  is2dMerge,
  is3dMerge,
  isPolyMerge
} from "./merge/mergeVoxelsOption";
export type { MergeVoxelsOption } from "./merge/mergeVoxelsOption";

export {
  buildSlicePlan,
  buildFaceDataFromSnapshot,
  buildSliceCacheKey,
  buffersEqual,
  holeFillVariants,
  runRects,
  mergeAlignedRects,
  verify,
  wallsToSig,
  SLICE_RENDERER_VERSION,
  AXIS_ORDER,
  FACE_ORDER,
  NEXT_LAYER_STEP
} from "./merge/slicePlanner";
export type {
  PlaneAxis,
  FaceKey,
  FaceBuffer,
  FaceData,
  Brush,
  SlicePlan
} from "./merge/slicePlanner";

export { parseMagicaVoxel } from "./parser/parseMagicaVoxel";
export type { MagicaVoxelParseResult } from "./parser/parseMagicaVoxel";
export { parseObj } from "./parser/parseObj";
export type { ObjParseOptions, ObjParseResult } from "./parser/parseObj";

export {
  encodeRgbaToPng,
  encodeRgbToPng
} from "./encoding/png";

export {
  sceneController
} from "./controller/sceneController";
export type {
  SceneController,
  SceneControllerOptions,
  PointerInput,
  SceneState,
  ControllerSnapshot
} from "./controller/sceneController";
