import { computed } from "vue";
import type { ComputedRef } from "vue";
import type { PolyMaterial } from "@layoutit/polycss-core";

/**
 * usePolyMaterial — Vue composable that returns a stable computed material
 * handle. Accepts either a plain options object or a reactive getter so that
 * reactive texture URLs (e.g. from a blob URL that updates) stay tracked.
 *
 * Stable computed identity means v-memo comparisons on <Poly> work correctly
 * when the inputs haven't changed.
 */
export function usePolyMaterial(
  source:
    | { texture: string; key?: string }
    | (() => { texture: string; key?: string }),
): ComputedRef<PolyMaterial> {
  if (typeof source === "function") {
    return computed(() => {
      const { texture, key } = source();
      return { texture, key };
    });
  }
  return computed(() => ({ texture: source.texture, key: source.key }));
}
