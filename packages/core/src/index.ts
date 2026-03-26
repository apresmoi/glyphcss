// @layoutit/voxcss-core — Pure-math voxel rendering engine (zero browser globals)

export type {
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

export { buildSceneContext, getVoxelBounds, wallMasksEqual } from "./scene/context";
export { computeVisibleFaces } from "./scene/visibility";

export { createIsometricCamera, normalizeInvertMultiplier } from "./camera/camera";
export type { CameraState, AutoRotateOption } from "./camera/camera";

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
export {
  normalizeMergeVoxelsOption,
  is2dMerge,
  is3dMerge
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
