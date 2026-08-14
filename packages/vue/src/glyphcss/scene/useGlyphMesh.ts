import { onBeforeUnmount, shallowRef, watch, type Ref } from "vue";
import type { Polygon } from "@glyphcss/core";
import type { GlyphMeshHandle, GlyphMeshTransform } from "glyphcss";
import { useGlyphSceneContext } from "./useGlyphSceneContext";

export interface UseGlyphMeshOptions {
  transform?: GlyphMeshTransform;
}

export interface UseGlyphMeshResult {
  meshRef: Ref<GlyphMeshHandle | null>;
  loading: Ref<boolean>;
}

/**
 * useGlyphMesh — register a polygon list with the parent GlyphScene.
 *
 * Vue mirror of the React hook of the same name (see the cross-package
 * discipline note in AGENTS.md): same name, same arguments, same return shape,
 * with refs where React returns a mutable ref object and state.
 */
export function useGlyphMesh(
  polygons: Polygon[] | Ref<Polygon[]>,
  options?: UseGlyphMeshOptions,
): UseGlyphMeshResult {
  const { sceneRef } = useGlyphSceneContext();
  const meshRef = shallowRef<GlyphMeshHandle | null>(null);
  const loading = shallowRef(false);

  const read = (): Polygon[] => (Array.isArray(polygons) ? polygons : polygons.value);

  const mount = (): void => {
    const scene = sceneRef.value;
    if (!scene) return;
    meshRef.value?.dispose();
    meshRef.value = scene.add(read(), options?.transform);
  };

  watch(
    () => [sceneRef.value, Array.isArray(polygons) ? polygons : polygons.value] as const,
    mount,
    { immediate: true },
  );

  watch(
    () => options?.transform,
    (transform) => {
      if (!meshRef.value || !transform) return;
      meshRef.value.setTransform(transform);
      sceneRef.value?.rerender();
    },
  );

  onBeforeUnmount(() => {
    meshRef.value?.dispose();
    meshRef.value = null;
  });

  return { meshRef, loading };
}
