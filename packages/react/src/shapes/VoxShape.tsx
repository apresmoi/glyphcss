import { memo } from "react";
import type { GridContext, Voxel } from "@layoutit/voxcss-core";
import { getVoxelBounds, computeShapeLighting } from "@layoutit/voxcss-core";
import type { ShapeType } from "@layoutit/voxcss-core";
import { Ramp, Wedge, Spike, normalizeRotation, ORIENTATION_MAP, isCovered, shouldRenderBottom } from "./index";

interface VoxShapeProps {
  voxel: Voxel;
  context: GridContext;
}

function VoxShapeInner({ voxel, context }: VoxShapeProps) {
  const shapeKey = voxel.shape ?? "cube";
  if (shapeKey === "cube") return null;
  const shape = shapeKey as ShapeType;

  if (isCovered(voxel, context)) return null;

  const { x2, y2 } = getVoxelBounds(voxel);
  const rawRotation = Number.isFinite(voxel.rot as number) ? Number(voxel.rot) : 0;
  const rotation = normalizeRotation(rawRotation);
  const orientation = ORIENTATION_MAP[rotation] ?? "east";
  const baseColor = voxel.color ?? "#cccccc";
  const lighting = computeShapeLighting(shape, rawRotation, baseColor);
  const showBottom = shouldRenderBottom(voxel, context);

  const shapeClass = shape === "ramp" ? "voxcss-ramp" : shape === "wedge" ? "voxcss-wedge" : "voxcss-spike";
  const ShapeComponent = shape === "ramp" ? Ramp : shape === "wedge" ? Wedge : Spike;

  return (
    <div
      className={`voxcss-${orientation} ${shapeClass}`}
      style={{ gridArea: `${voxel.x} / ${voxel.y} / ${x2} / ${y2}` }}
    >
      <ShapeComponent
        voxel={voxel}
        context={context}
        baseColor={baseColor}
        lighting={lighting}
        showBottom={showBottom}
      />
    </div>
  );
}

export const VoxShape = memo(VoxShapeInner);
