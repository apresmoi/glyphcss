import { useMemo } from "react";
import type {
  Polygon,
  DirectionalLight,
  Vec3,
} from "@polycss/core";
import { buildSceneContext, mergePolygons } from "@polycss/core";

export interface UseSceneContextOptions {
  /** `"auto"` runs `mergePolygons`; `"off"` passes through unchanged. */
  merge?: "off" | "auto";
  directionalLight?: DirectionalLight;
}

export interface UseSceneContextResult {
  polygons: Polygon[];
  sceneBbox: { min: Vec3; max: Vec3 };
}

/**
 * React hook that runs the polycss scene-context pipeline:
 *   normalizePolygons → (optional) mergePolygons → bbox compute.
 *
 * Returns the processed polygons + the scene-wide axis-aligned bbox. Memoized
 * on input identity + the few options that affect output. Per §Design.6.
 */
export function useSceneContext(
  polygons: Polygon[],
  options: UseSceneContextOptions
): UseSceneContextResult {
  const { merge, directionalLight: _directionalLight } = options;

  return useMemo(() => {
    // Normalize first via buildSceneContext (it runs normalizePolygons),
    // then optionally merge. Merge runs AFTER normalize so it sees a
    // clean polygon list (no degenerates, valid UVs).
    const built = buildSceneContext({ polygons });

    const finalPolygons =
      merge === "auto" ? mergePolygons(built.context.polygons) : built.context.polygons;

    return {
      polygons: finalPolygons,
      sceneBbox: built.context.sceneBbox,
    };
  }, [polygons, merge]);
}
