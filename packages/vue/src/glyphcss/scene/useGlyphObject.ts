import { isRef, onBeforeUnmount, shallowRef, watch, type Ref } from "vue";
import type { GlyphSceneObject, GlyphSceneObjectHandle, GlyphSceneObjectTransform } from "glyphcss";
import { useGlyphSceneContext } from "./useGlyphSceneContext";

export interface UseGlyphObjectOptions {
  transform?: GlyphSceneObjectTransform;
}

export interface UseGlyphObjectResult {
  objectRef: Ref<GlyphSceneObjectHandle | null>;
}

/**
 * useGlyphObject — Vue mirror of the React hook of the same name. Imperative
 * mount of a `GlyphSceneObject` into the parent GlyphScene.
 */
export function useGlyphObject(
  object: GlyphSceneObject | Ref<GlyphSceneObject>,
  options?: UseGlyphObjectOptions,
): UseGlyphObjectResult {
  const { sceneRef } = useGlyphSceneContext();
  const objectRef = shallowRef<GlyphSceneObjectHandle | null>(null);

  const read = (): GlyphSceneObject => (isRef(object) ? object.value : object);

  const mount = (): void => {
    const scene = sceneRef.value;
    if (!scene) return;
    objectRef.value?.remove();
    objectRef.value = scene.addObject(read(), options?.transform);
  };

  watch(
    () => [sceneRef.value, read()] as const,
    mount,
    { immediate: true },
  );

  watch(
    () => options?.transform,
    (transform) => {
      if (!objectRef.value || !transform) return;
      objectRef.value.setTransform(transform);
      sceneRef.value?.rerender();
    },
  );

  onBeforeUnmount(() => {
    objectRef.value?.remove();
    objectRef.value = null;
  });

  return { objectRef };
}
