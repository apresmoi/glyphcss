/**
 * Span-aware coverage helpers used by shape and cube renderers to decide
 * whether a voxel is fully hidden by a neighbor above (`isCovered`) or below
 * (`isBottomOccluded`), and whether the bottom face should be rendered at all
 * (`shouldRenderBottom`).
 *
 * Canonical implementation in core; renderer packages re-export these.
 */
import type { GridContext, Voxel } from "../types";
import { getVoxelBounds, getVoxelZBounds } from "./context";

/**
 * True iff *any* cell in the X/Y footprint at z = z2 (the layer immediately
 * above the voxel's upper extent) is occupied. For a 1-cell-tall voxel this
 * probes z + 1; for taller voxels it probes z2 — never inside the voxel itself.
 *
 * The "any cell" semantics matches the existing renderer behavior: a shape
 * voxel hides itself if anything sits directly above any part of it, since
 * the renderer can't partially occlude a single sloped face.
 */
export function isCovered(voxel: Voxel, context: GridContext): boolean {
  const { x2, y2 } = getVoxelBounds(voxel);
  const { z2 } = getVoxelZBounds(voxel);
  const layerAbove = Math.max(0, z2);
  for (let row = voxel.x; row < x2; row += 1) {
    for (let col = voxel.y; col < y2; col += 1) {
      if (context.getVoxel(row, col, layerAbove)) return true;
    }
  }
  return false;
}

/**
 * True iff every cell in the X/Y footprint at z - 1 is occupied.
 * Returns false if z - 1 is below the floor.
 */
export function isBottomOccluded(voxel: Voxel, context: GridContext): boolean {
  const { z } = getVoxelZBounds(voxel);
  const targetZ = z - 1;
  if (targetZ < 0) return false;
  const { x2, y2 } = getVoxelBounds(voxel);
  for (let x = voxel.x; x < x2; x += 1) {
    for (let y = voxel.y; y < y2; y += 1) {
      if (!context.getVoxel(x, y, targetZ)) return false;
    }
  }
  return true;
}

/**
 * Whether the renderer should emit the bottom face for this voxel:
 * not hidden by the global wall mask AND not occluded by a neighbor below.
 */
export function shouldRenderBottom(voxel: Voxel, context: GridContext): boolean {
  if (context.walls?.b) return false;
  return !isBottomOccluded(voxel, context);
}
