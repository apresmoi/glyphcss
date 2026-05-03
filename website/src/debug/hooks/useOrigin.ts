import { useMemo } from "react";
import type { Voxel } from "@layoutit/voxcss/react";

type Vec3 = [number, number, number];

/**
 * Compute the canvas-projection origin from voxel bboxes — center of the
 * mesh's xy footprint, z=0 to match voxcss's pivot. Returns a memoized Vec3
 * so consumers can pass it stably to <DebugScene> / <PolygonCanvas>.
 */
export function useOrigin(voxels: Voxel[]): Vec3 {
  return useMemo(() => {
    let xMax = 0, yMax = 0;
    for (const v of voxels) {
      const x2 = v.x2 ?? v.x + 1;
      const y2 = v.y2 ?? v.y + 1;
      if (x2 > xMax) xMax = x2;
      if (y2 > yMax) yMax = y2;
    }
    return [(xMax + 1) / 2, (yMax + 1) / 2, 0];
  }, [voxels]);
}
