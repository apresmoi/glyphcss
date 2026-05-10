import { computed } from "vue";
import type { Ref } from "vue";
import type { Polygon, PolyDirectionalLight, Vec3 } from "@layoutit/polycss-core";
import { buildSceneContext, mergePolygons } from "@layoutit/polycss-core";

export interface UseSceneContextOptions {
  directionalLight?: PolyDirectionalLight;
}

export interface UseSceneContextResult {
  polygons: Polygon[];
  sceneBbox: { min: Vec3; max: Vec3 };
}

/**
 * Vue 3 composable that runs the polycss scene-context pipeline:
 *   normalizePolygons → mergePolygons by default → bbox compute.
 *
 * Returns a Ref to the processed polygons + the scene-wide axis-aligned bbox.
 * Recomputes when `polygons` or relevant options change.
 */
export function usePolySceneContext(
  polygons: Ref<Polygon[]>,
  options: Ref<UseSceneContextOptions>
): Ref<UseSceneContextResult> {
  return computed(() => {
    const { directionalLight: _directionalLight } = options.value;

    const built = buildSceneContext({ polygons: polygons.value });
    const finalPolygons = mergePolygons(built.context.polygons);

    return {
      polygons: finalPolygons,
      sceneBbox: built.context.sceneBbox,
    };
  });
}
