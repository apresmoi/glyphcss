// Register DOM-based color resolver for named CSS colors
import { setColorResolver } from "@layoutit/voxcss-core";
import { resolveColor } from "./styles";
setColorResolver(resolveColor);

export { VoxCamera, useCamera, VoxCameraContext, useCameraContext } from "./camera";
export type { VoxCameraProps, UseCameraOptions, UseCameraResult, VoxCameraContextValue } from "./camera";

export { VoxScene, VoxLayer, useSceneContext } from "./scene";
export type { VoxSceneProps, UseSceneContextOptions } from "./scene";

export { VoxCube, VoxShape } from "./shapes";

export { useSliceBrushes, SliceZBrushes, SliceAxisHost } from "./slice";
export type { VoxSliceRendererProps, SliceBrushData } from "./slice";

export { injectBaseStyles } from "./styles";

// Re-export commonly used core types for convenience
export type {
  Voxel,
  VoxelGrid,
  CubeFace,
  GridContext,
  ProjectionMode,
  AutoRotateOption,
  MergeVoxelsOption,
} from "@layoutit/voxcss-core";
