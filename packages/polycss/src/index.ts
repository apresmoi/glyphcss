// @layoutit/voxcss-html — CSS-based voxel rendering engine for the browser

// Register DOM-based color resolver for named CSS colors
import { setColorResolver } from "@layoutit/voxcss-core";
import { resolveColor } from "./colorResolver";
setColorResolver(resolveColor);

// Re-export core types and utilities for convenience
export type {
  Voxel,
  VoxelGrid,
  CubeFace,
  GridContext,
  ProjectionMode,
  AutoRotateOption,
  MergeVoxelsOption,
  MagicaVoxelParseResult,
  SceneController,
  SceneControllerOptions
} from "@layoutit/voxcss-core";
export {
  parseMagicaVoxel,
  mergeVoxels,
  normalizeMergeVoxelsOption,
  is2dMerge,
  is3dMerge,
  sceneController,
  createIsometricCamera
} from "@layoutit/voxcss-core";

// HTML-specific exports
export {
  createCamera,
  createScene,
  renderScene
} from "./headless";
export type {
  HeadlessCameraOptions,
  HeadlessCameraHandle,
  HeadlessCameraConfig,
  HeadlessSceneOptions,
  HeadlessSceneConfig,
  HeadlessRenderOptions,
  HeadlessRenderHandle
} from "./headless";

export {
  mountScene,
  normalizeSceneState,
  SCENE_HOST_CLASS
} from "./bindings/sceneBindings";
export type { SceneState, SceneComponentProps } from "./bindings/sceneBindings";

export {
  mountCameraBinding,
  ensureCameraController,
  CAMERA_HOST_CLASS
} from "./bindings/domBindings";
export type {
  CameraComponentProps,
  CameraSlotProps,
  CameraBindingSnapshot
} from "./bindings/domBindings";

export { rgbaToPngBlob, rgbToPngBlob } from "./pngBlob";
export { resolveColor } from "./colorResolver";

export type {
  ShapeRenderer,
  RenderState,
  LayerRecord,
  SceneOptions,
  CreateVoxcssOptions,
  VoxcssInstance,
  VoxIllustrationOptions,
  VoxIllustrationHandle
} from "./types";
