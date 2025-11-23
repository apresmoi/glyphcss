/* Barrel exports for the voxcss runtime modules. */
export type {
  Voxel,
  VoxelGrid,
  SceneDimensions,
  WallsMask,
  OffsetMap,
  GridContext,
  ShapeRenderer,
  SceneOptions,
  CreateVoxcssOptions,
  VoxcssInstance,
  VoxIllustrationOptions,
  VoxIllustrationHandle,
  ProjectionMode,
  VoxelLookup,
  VoxelLookupBuildResult,
  SceneAnalysisPayload
} from "./types";
export type { SceneContextBuildArgs, SceneContextBuildResult } from "./context";
export { BASE_TILE, DEFAULT_PROJECTION } from "./types";

export {
  buildSceneContext,
  buildVoxelLookups,
  inferGridDimensions,
  computeWallMask,
  wallMasksEqual,
  getVoxelFromLookup,
  getVoxelBounds,
  makeVoxelKey
} from "./context";

export {
  cubeShapeRenderer,
  rampShapeRenderer,
  wedgeShapeRenderer,
  spikeShapeRenderer
} from "./shapes";
export {
  shadeColor,
  shadeCubeFace,
  parseColor,
  computeShapeLighting
} from "./lighting";
export type { ShapeType, ShapeSurfaceLighting } from "./lighting";
export type { SceneSnapshot } from "./state";
export { diffScenes } from "./diff";
export type { SceneDiffResult } from "./diff";
export type {
  RendererFactory,
  RendererHandle,
  RendererMountOptions,
  ScenePatch,
  AddVoxelPatch,
  UpdateVoxelPatch,
  RemoveVoxelPatch
} from "./renderer";

export * from "./camera";
export { createCamera, renderScene } from "./headless";
export type {
  HeadlessCameraOptions,
  HeadlessCameraHandle,
  HeadlessSceneOptions,
  HeadlessRenderOptions,
  HeadlessRenderHandle
} from "./headless";
