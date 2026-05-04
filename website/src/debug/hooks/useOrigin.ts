import { useMemo } from "react";
import { normalizePolygons } from "@polycss/react";
import type { Polygon } from "@polycss/react";

type Vec3 = [number, number, number];

/**
 * Compute the canvas-projection origin from polygon bboxes — center of the
 * mesh's footprint. Returns a memoized Vec3 so consumers can pass it stably
 * to <DebugScene> / <PolygonCanvas>.
 */
export function useOrigin(voxels: Polygon[]): Vec3 {
  return useMemo(() => {
    if (!voxels.length) return [0, 0, 0] as Vec3;
    const normalized = normalizePolygons(voxels);
    // normalizePolygons returns NormalizeResult; extract bounds from polygons
    const polys = normalized.polygons ?? voxels;
    let xMax = 0, yMax = 0;
    for (const p of polys) {
      for (const v of p.vertices) {
        if (v[0] > xMax) xMax = v[0];
        if (v[1] > yMax) yMax = v[1];
      }
    }
    return [xMax / 2, yMax / 2, 0] as Vec3;
  }, [voxels]);
}
