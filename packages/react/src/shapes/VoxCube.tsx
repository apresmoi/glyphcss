import { memo } from "react";
import type { CubeFace, GridContext, Voxel } from "@layoutit/voxcss-core";
import {
  computeVisibleFaces,
  computeFacesWithOcclusion,
  getVoxelBounds,
  getVoxelZBounds,
  computeShapeStyle,
} from "@layoutit/voxcss-core";
import { computeCubeFaceAppearance } from "@layoutit/voxcss-core";

interface VoxCubeProps {
  voxel: Voxel;
  context: GridContext;
}

function VoxCubeInner({ voxel, context }: VoxCubeProps) {
  // In debug mode, render every face (visible AND occluded) so we can outline
  // the occluded ones. Outside debug mode, the normal occlusion-culled list.
  const facesWithMeta = context.debugShowOccluded
    ? computeFacesWithOcclusion(voxel, context)
    : computeVisibleFaces(voxel, context).map((face) => ({ face, occluded: false }));
  if (facesWithMeta.length === 0) return null;

  const { x2, y2 } = getVoxelBounds(voxel);
  const { z, z2 } = getVoxelZBounds(voxel);
  const tileSize = context.tileSize;
  const halfTile = tileSize / 2;
  const spanX = x2 - voxel.x;
  const spanY = y2 - voxel.y;
  const spanZ = z2 - z;

  // When spanZ > 1, override --voxcss-layer-elevation so the single element
  // visually extends across all the z layers it spans (layer-as-anchor model).
  const spanStyle = spanZ > 1 ? computeShapeStyle(voxel, context) : undefined;

  // When debugShowLabels is on, expose voxel identity in a single readable
  // string so the user can copy-paste it to refer to a specific element.
  // Format: `cube (x,y,z)→(x2,y2,z2)`.
  const debugAttrs = context.debugShowLabels
    ? { "data-debug": `cube (${voxel.x},${voxel.y},${z})→(${x2},${y2},${z2})` }
    : null;

  // Camera-direction occlusion: precomputed list of direction bins where this
  // voxel is hidden behind a closer one. CSS rule
  // `.voxcss-cull-dir-N [data-occluded-dirs~="N"]` hides it when the scene root
  // toggles the matching dir class.
  const occlDirs = context.occlusionMap?.get(`${voxel.x}:${voxel.y}:${z}`);

  return (
    <div
      className="voxcss-cube"
      data-occluded-dirs={occlDirs}
      style={
        {
          gridArea: `${voxel.x} / ${voxel.y} / ${x2} / ${y2}`,
          "--voxcss-side-offset-x": `${spanX * halfTile}px`,
          "--voxcss-side-offset-y": `${spanY * halfTile}px`,
          "--voxcss-fr-offset": `${spanY * tileSize}px`,
          ...spanStyle,
        } as React.CSSProperties
      }
      {...debugAttrs}
    >
      {facesWithMeta.map(({ face, occluded }) => (
        <CubeFaceDiv key={face} voxel={voxel} face={face} context={context} occluded={occluded} />
      ))}
    </div>
  );
}

export const VoxCube = memo(VoxCubeInner);

interface CubeFaceDivProps {
  voxel: Voxel;
  face: CubeFace;
  context: GridContext;
  occluded?: boolean;
}

function CubeFaceDivInner({ voxel, face, context, occluded }: CubeFaceDivProps) {
  const appearance = computeCubeFaceAppearance(voxel, face, context);
  const className = `voxcss-cube-face voxcss-cube-face--${face}${occluded ? " voxcss-debug-occluded" : ""}`;
  return (
    <div
      className={className}
      style={{
        backgroundColor: appearance.backgroundColor || undefined,
        backgroundImage: appearance.backgroundImage || undefined,
        filter: appearance.filter || undefined,
      }}
    />
  );
}

const CubeFaceDiv = memo(CubeFaceDivInner);
