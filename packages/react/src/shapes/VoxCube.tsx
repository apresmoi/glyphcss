import { memo } from "react";
import type { CubeFace, GridContext, Voxel } from "@layoutit/voxcss-core";
import { computeVisibleFaces } from "@layoutit/voxcss-core";
import { computeCubeFaceAppearance } from "@layoutit/voxcss-core";
import { getVoxelBounds } from "@layoutit/voxcss-core";

interface VoxCubeProps {
  voxel: Voxel;
  context: GridContext;
}

function VoxCubeInner({ voxel, context }: VoxCubeProps) {
  const faces = computeVisibleFaces(voxel, context);
  if (faces.length === 0) return null;

  const { x2, y2 } = getVoxelBounds(voxel);
  const tileSize = context.tileSize;
  const halfTile = tileSize / 2;
  const spanX = x2 - voxel.x;
  const spanY = y2 - voxel.y;

  return (
    <div
      className="voxcss-cube"
      style={
        {
          gridArea: `${voxel.x} / ${voxel.y} / ${x2} / ${y2}`,
          "--voxcss-side-offset-x": `${spanX * halfTile}px`,
          "--voxcss-side-offset-y": `${spanY * halfTile}px`,
          "--voxcss-fr-offset": `${spanY * tileSize}px`,
        } as React.CSSProperties
      }
    >
      {faces.map((face) => (
        <CubeFaceDiv key={face} voxel={voxel} face={face} context={context} />
      ))}
    </div>
  );
}

export const VoxCube = memo(VoxCubeInner);

interface CubeFaceDivProps {
  voxel: Voxel;
  face: CubeFace;
  context: GridContext;
}

function CubeFaceDivInner({ voxel, face, context }: CubeFaceDivProps) {
  const appearance = computeCubeFaceAppearance(voxel, face, context);
  return (
    <div
      className={`voxcss-cube-face voxcss-cube-face--${face}`}
      style={{
        backgroundColor: appearance.backgroundColor || undefined,
        backgroundImage: appearance.backgroundImage || undefined,
        filter: appearance.filter || undefined,
      }}
    />
  );
}

const CubeFaceDiv = memo(CubeFaceDivInner);
