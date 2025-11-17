import type { CubeFace, GridContext, Voxel, WallsMask } from "./types";
import { CUBE_FACES } from "./types";
import { getVoxelBounds } from "./context";

export function computeVisibleFaces(voxel: Voxel, context: GridContext): CubeFace[] {
  const faces: CubeFace[] = [];
  for (const face of CUBE_FACES) {
    if (isFaceOccluded(voxel, context, face)) continue;
    if (isWallFaceHidden(context.showWalls, context.walls, face)) continue;
    faces.push(face);
  }
  return faces;
}

function isFaceOccluded(voxel: Voxel, context: GridContext, face: CubeFace): boolean {
  const offsets = context.offsets[face];
  if (!offsets) return false;
  const [dx, dy, dz] = offsets;
  const { x, y, z } = voxel;
  const { x2, y2 } = getVoxelBounds(voxel);

  if (dx !== 0) {
    const targetX = dx > 0 ? x2 : x - 1;
    for (let yi = y; yi < y2; yi += 1) {
      const neighbor = context.getVoxel(targetX, yi, z + dz);
      if (!neighbor) return false;
    }
    return true;
  }

  if (dy !== 0) {
    const targetY = dy > 0 ? y2 : y - 1;
    for (let xi = x; xi < x2; xi += 1) {
      const neighbor = context.getVoxel(xi, targetY, z + dz);
      if (!neighbor) return false;
    }
    return true;
  }

  if (dz !== 0) {
    const targetZ = z + dz;
    for (let xi = x; xi < x2; xi += 1) {
      for (let yi = y; yi < y2; yi += 1) {
        const neighbor = context.getVoxel(xi, yi, targetZ);
        if (!neighbor) return false;
      }
    }
    return true;
  }

  return false;
}

function isWallFaceHidden(showWalls: boolean, walls: WallsMask, face: CubeFace): boolean {
  if (!showWalls) return false;
  switch (face) {
    case "t":
    case "b":
    case "bl":
    case "br":
    case "fl":
    case "fr":
      return walls[face];
    default:
      return false;
  }
}
