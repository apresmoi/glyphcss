import type { CubeFace, GridContext, Voxel, WallsMask } from "../types";
import { CUBE_FACES } from "../types";
import { getVoxelBounds, getVoxelZBounds } from "./context";
import { shapeCoversFullyFace, oppositeFace } from "../shape/coverage";

/**
 * Compute which cube faces of a voxel are visible (not occluded by neighbors
 * and not hidden by the global wall mask).
 *
 * Span-aware: a voxel may extend across multiple cells in X, Y and/or Z (via
 * x2/y2/z2). Occlusion is checked against the full footprint or strip of
 * cells adjacent to each face (Policy A — see Z2_REFACTOR.md §2.5).
 */
export function computeVisibleFaces(voxel: Voxel, context: GridContext): CubeFace[] {
  const faces: CubeFace[] = [];
  for (const face of CUBE_FACES) {
    if (isFaceOccluded(voxel, context, face)) continue;
    if (isWallFaceHidden(context.walls, face)) continue;
    faces.push(face);
  }
  return faces;
}

/**
 * Debug helper: return every cube face along with whether it would be occlusion-
 * culled. Wall-mask-hidden faces are still excluded (those genuinely shouldn't
 * render). Used by renderers in debug mode to outline culled faces in the DOM.
 */
export function computeFacesWithOcclusion(
  voxel: Voxel,
  context: GridContext
): Array<{ face: CubeFace; occluded: boolean }> {
  const result: Array<{ face: CubeFace; occluded: boolean }> = [];
  for (const face of CUBE_FACES) {
    if (isWallFaceHidden(context.walls, face)) continue;
    result.push({ face, occluded: isFaceOccluded(voxel, context, face) });
  }
  return result;
}

function isFaceOccluded(voxel: Voxel, context: GridContext, face: CubeFace): boolean {
  const offsets = context.offsets[face];
  if (!offsets) return false;
  const [dx, dy, dz] = offsets;
  // If the offset vector is zero we can't probe a neighbor cell — treat as not occluded.
  if (dx === 0 && dy === 0 && dz === 0) return false;

  const { x2, y2 } = getVoxelBounds(voxel);
  const { z, z2 } = getVoxelZBounds(voxel);

  // Shape-aware: a face is occluded only if every adjacent neighbor exists
  // AND its corresponding (opposite) face fully covers ours. A spike's
  // partial-coverage side face does NOT cull a neighbor's cube face — only
  // truly opaque coverage does.
  const neighborFace = oppositeFace(face);
  const covers = (neighbor: Voxel | null) =>
    !!neighbor && shapeCoversFullyFace(neighbor, neighborFace);

  if (dx !== 0) {
    const targetX = dx > 0 ? x2 : voxel.x - 1;
    for (let yi = voxel.y; yi < y2; yi += 1) {
      for (let zi = z; zi < z2; zi += 1) {
        if (!covers(context.getVoxel(targetX, yi, zi))) return false;
      }
    }
    return true;
  }

  if (dy !== 0) {
    const targetY = dy > 0 ? y2 : voxel.y - 1;
    for (let xi = voxel.x; xi < x2; xi += 1) {
      for (let zi = z; zi < z2; zi += 1) {
        if (!covers(context.getVoxel(xi, targetY, zi))) return false;
      }
    }
    return true;
  }

  // dz !== 0: top or bottom face.
  const targetZ = dz > 0 ? z2 : z - 1;
  for (let xi = voxel.x; xi < x2; xi += 1) {
    for (let yi = voxel.y; yi < y2; yi += 1) {
      if (!covers(context.getVoxel(xi, yi, targetZ))) return false;
    }
  }
  return true;
}

function isWallFaceHidden(walls: WallsMask, face: CubeFace): boolean {
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
