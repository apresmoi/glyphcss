/**
 * Precomputed camera-direction occlusion — conservative "definitely hidden"
 * test. For each of 8 camera-direction octants, mark a cell occluded only if
 * ALL THREE of its camera-facing axis neighbors are cubes (full occluders).
 * This is the simplest possible occlusion check: cheap, scales linearly, and
 * never produces false positives — visible cells are never wrongly hidden.
 *
 * Pure CSS at runtime: voxels get `data-occluded-dirs="3 7"` listing the
 * octants in which they're definitely hidden. CSS rule
 * `.voxcss-cull-dir-N [data-occluded-dirs~="N"] { display: none }` hides them
 * when the scene root has the matching `voxcss-cull-dir-N` class (toggled by
 * the camera controller on rotation).
 *
 * Doesn't cull as aggressively as a true z-buffer — only fully-buried cells
 * get hidden — but keeps interior surface cells visible without artifacts.
 */
import type { Voxel, VoxelGrid } from "../types";
import { OCCLUSION_DIR_BINS, directionVectorFromBin } from "./occlusionDirection";
import { getVoxelZBounds } from "./context";

export interface OcclusionMap {
  /** key "x:y:z" → space-separated direction-bin indices where voxel is occluded. */
  byKey: Map<string, string>;
}

/** Build the per-voxel occlusion direction list. */
export function precomputeOcclusion(grid: VoxelGrid): OcclusionMap {
  const voxels: Voxel[] = (grid ?? []).filter((v): v is Voxel => !!v);
  if (voxels.length === 0) return { byKey: new Map() };

  // Build a fast lookup of cube cells (only cubes can occlude — sloped shapes
  // don't fully fill their cell). Non-cube voxels can still BE occluded.
  const cubeAt = new Set<string>();
  for (const v of voxels) {
    const shape = v.shape ?? "cube";
    if (shape === "cube") {
      const { z } = getVoxelZBounds(v);
      cubeAt.add(`${v.x}:${v.y}:${z}`);
    }
  }

  const occludedDirsByKey = new Map<string, number[]>();

  for (let dirBin = 0; dirBin < OCCLUSION_DIR_BINS; dirBin++) {
    const [cx, cy, cz] = directionVectorFromBin(dirBin);
    // Sign per axis: which direction along this axis points toward the camera.
    // Components near zero are treated as "doesn't matter" (skip the check).
    const EPS = 0.3;
    const sx = cx > EPS ? 1 : cx < -EPS ? -1 : 0;
    const sy = cy > EPS ? 1 : cy < -EPS ? -1 : 0;
    const sz = cz > EPS ? 1 : cz < -EPS ? -1 : 0;

    for (const v of voxels) {
      const { z } = getVoxelZBounds(v);
      // Definitely hidden: every meaningful camera-facing axis neighbor is a
      // cube. If any neighbor is missing (or a non-cube shape), the cell may
      // be visible — leave it un-marked (eager render).
      if (sx !== 0 && !cubeAt.has(`${v.x + sx}:${v.y}:${z}`)) continue;
      if (sy !== 0 && !cubeAt.has(`${v.x}:${v.y + sy}:${z}`)) continue;
      if (sz !== 0 && !cubeAt.has(`${v.x}:${v.y}:${z + sz}`)) continue;

      const key = `${v.x}:${v.y}:${z}`;
      let list = occludedDirsByKey.get(key);
      if (!list) {
        list = [];
        occludedDirsByKey.set(key, list);
      }
      list.push(dirBin);
    }
  }

  // Encode as space-separated string per voxel.
  const byKey = new Map<string, string>();
  for (const [key, dirs] of occludedDirsByKey) {
    byKey.set(key, dirs.join(" "));
  }
  return { byKey };
}
