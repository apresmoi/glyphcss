import { useMemo } from "react";
import { normalizeVoxels } from "@layoutit/voxcss";
import type { Voxel } from "@layoutit/voxcss/react";

type Vec3 = [number, number, number];

/**
 * Compute the canvas-projection origin from voxel bboxes — center of the
 * mesh's xy footprint, z=0 to match voxcss's pivot. Returns a memoized Vec3
 * so consumers can pass it stably to <DebugScene> / <PolygonCanvas>.
 *
 * Runs voxcss's `normalizeVoxels` first so triangle/polygon voxels that ship
 * only `vertices` (no bbox) get their x/y/z/x2/y2/z2 derived before we
 * measure — otherwise we'd see all-zero bounds and pick the wrong zoom.
 */
export function useOrigin(voxels: Voxel[]): Vec3 {
  return useMemo(() => {
    const normalized = normalizeVoxels(voxels);
    let xMax = 0, yMax = 0;
    for (const v of normalized) {
      const x2 = v.x2 ?? v.x + 1;
      const y2 = v.y2 ?? v.y + 1;
      if (x2 > xMax) xMax = x2;
      if (y2 > yMax) yMax = y2;
    }
    return [(xMax + 1) / 2, (yMax + 1) / 2, 0];
  }, [voxels]);
}
