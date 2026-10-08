import { useEffect, useRef } from "react";
import type { GlyphSceneObject, GlyphSceneObjectHandle, GlyphSceneObjectTransform } from "glyphcss";
import { useGlyphSceneContext } from "./context";

export interface UseGlyphObjectOptions {
  transform?: GlyphSceneObjectTransform;
}

export interface UseGlyphObjectResult {
  objectRef: React.MutableRefObject<GlyphSceneObjectHandle | null>;
}

/**
 * useGlyphObject — imperative mount of a `GlyphSceneObject` into the parent
 * GlyphScene. Mirrors `useGlyphMesh` for the composition primitive.
 */
export function useGlyphObject(
  object: GlyphSceneObject,
  options?: UseGlyphObjectOptions,
): UseGlyphObjectResult {
  const { sceneRef } = useGlyphSceneContext();
  const objectRef = useRef<GlyphSceneObjectHandle | null>(null);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const handle = scene.addObject(object, options?.transform);
    objectRef.current = handle;
    return () => {
      handle.remove();
      objectRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneRef, object]);

  useEffect(() => {
    const handle = objectRef.current;
    if (!handle) return;
    if (options?.transform) {
      handle.setTransform(options.transform);
      sceneRef.current?.rerender();
    }
  }, [sceneRef, options?.transform]);

  return { objectRef };
}
