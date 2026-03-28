import type { GridContext, Voxel } from "@layoutit/voxcss-core";
import type { ShapeSurfaceLighting } from "@layoutit/voxcss-core";

export interface ShapeInnerProps {
  voxel: Voxel;
  context: GridContext;
  baseColor: string;
  lighting: ShapeSurfaceLighting[];
  showBottom: boolean;
}
