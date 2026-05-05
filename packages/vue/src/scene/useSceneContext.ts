import { computed } from "vue";
import type { Ref } from "vue";
import type { Polygon, DirectionalLight, Vec3 } from "@polycss/core";
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
 * Vue 3 composable that runs the polycss scene-context pipeline:
 *   normalizePolygons → (optional) mergePolygons → bbox compute.
 *
 * Returns a Ref to the processed polygons + the scene-wide axis-aligned bbox.
 * Recomputes when `polygons` or relevant options change.
 */
export function useSceneContext(
  polygons: Ref<Polygon[]>,
  options: Ref<UseSceneContextOptions>
): Ref<UseSceneContextResult> {
  return computed(() => {
    const opts = options.value;

    const built = buildSceneContext({ polygons: polygons.value });

    const finalPolygons =
      opts.merge === "auto"
        ? mergePolygons(built.context.polygons)
        : built.context.polygons;

    return {
      polygons: finalPolygons,
      sceneBbox: built.context.sceneBbox,
    };
  });
}
