// Register DOM-based color resolver for named CSS colors
import { setColorResolver } from "@layoutit/voxcss-core";
import { resolveColor } from "./styles";
setColorResolver(resolveColor);

export { VoxCamera } from "./camera";
export { useCamera } from "./camera";
export type { UseCameraOptions, UseCameraResult } from "./camera";
export { VoxCameraContextKey } from "./camera";
export type { VoxCameraContextValue } from "./camera";

export { VoxScene, VoxLayer, useSceneContext } from "./scene";
export type { UseSceneContextOptions } from "./scene";

export { VoxCube, VoxShape } from "./shapes";

export { useSliceBrushes, SliceZBrushes, SliceAxisHost } from "./slice";

export { injectBaseStyles } from "./styles";

// Re-export commonly used core types for convenience
export type {
  Voxel,
  VoxelGrid,
  CubeFace,
  GridContext,
  ProjectionMode,
  WallsMask,
} from "@layoutit/voxcss-core";
export type { CameraState, AutoRotateOption } from "@layoutit/voxcss-core";
export type { MergeVoxelsOption } from "@layoutit/voxcss-core";
