import { memo } from "react";
import type { GridContext, Voxel } from "@layoutit/voxcss-core";
import { VoxCube } from "../shapes/VoxCube";
import { VoxShape } from "../shapes/VoxShape";

interface VoxLayerProps {
  layerIndex: number;
  voxels: Voxel[];
  context: GridContext;
}

function VoxLayerInner({ layerIndex, voxels, context }: VoxLayerProps) {
  const elevation = context.layerElevation ?? context.tileSize;
  const transform = `translateZ(${layerIndex * elevation}px)`;

  return (
    <div className="voxcss-layer" style={{ transform }}>
      {voxels.map((voxel, i) => {
        if (!voxel) return null;
        const shape = voxel.shape ?? "cube";
        if (shape === "cube") {
          return <VoxCube key={voxelKey(voxel, i)} voxel={voxel} context={context} />;
        }
        return <VoxShape key={voxelKey(voxel, i)} voxel={voxel} context={context} />;
      })}
    </div>
  );
}

function voxelKey(voxel: Voxel, index: number): string {
  return `${voxel.x}:${voxel.y}:${voxel.z}:${index}`;
}

export const VoxLayer = memo(VoxLayerInner);
