/* Barrel exports for the voxcss runtime modules. */
export type {
  Voxel,
  VoxelGrid,
  SceneDimensions,
  WallsMask,
  OffsetMap,
  GridContext,
  PointerEventPayload,
  ShapeRenderer,
  VoxcssHooks,
  CreateVoxcssOptions,
  VoxcssInstance,
  VoxIllustrationOptions,
  VoxIllustrationHandle,
  ProjectionMode
} from "./types";
export { BASE_TILE, DEFAULT_PROJECTION } from "./types";

export {
  buildContext,
  buildVoxelLookups,
  inferGridDimensions,
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
  flatShapeRenderer,
  rampShapeRenderer,
  wedgeShapeRenderer,
  spikeShapeRenderer,
  dimetricShapes
} from "./shapes";
export {
  shadeColor,
  shadeCubeFace,
  parseColor,
  computeDimetricLighting
} from "./lighting";
export type { DimetricShapeType, DimetricSurfaceLighting } from "./lighting";
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
  LayerMetaPatch,
  WallsMetaPatch,
  FloorMetaPatch,
  PointerRegionPatch
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
