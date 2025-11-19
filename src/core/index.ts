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
  SceneContextSnapshot,
  VoxelLookup,
  VoxelLookupBuildResult,
  SceneAnalysisPayload
} from "./types";
export type { SceneContextBuildArgs, SceneContextBuildResult } from "./context";
export { BASE_TILE, DEFAULT_PROJECTION } from "./types";

export {
  buildSceneContext,
  buildContext,
  buildVoxelLookups,
  buildSceneContextSnapshot,
  syncControllerDimensions,
  inferGridDimensions,
  computeGridChecksum,
  computeWallMask,
  wallMasksEqual,
  getVoxelFromLookup,
  getVoxelBounds,
  makeVoxelKey,
  makeCellKey
} from "./context";

export { injectBaseStyles } from "./styles";
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
export { voxScene, createVoxScene } from "./scene";
export type { VoxSceneOptions } from "./scene";
export { deriveSceneSnapshot } from "./state";
export type { SceneSnapshot, SceneSnapshotArgs } from "./state";
export { diffScenes } from "./diff";
export type { SceneDiffResult } from "./diff";
export type {
  RendererFactory,
  RendererHandle,
  RendererMountOptions,
  ScenePatch,
  AddVoxelPatch,
  UpdateVoxelPatch,
  RemoveVoxelPatch,
  WallsMetaPatch,
  FloorMetaPatch
} from "./renderer";

export * from "./camera";
export {
  createCamera,
  createScene,
  renderScene
} from "./headless";
export type {
  HeadlessCameraOptions,
  HeadlessCameraHandle,
  HeadlessSceneOptions,
  HeadlessSceneHandle,
  HeadlessRenderOptions,
  HeadlessRenderHandle
} from "./headless";
