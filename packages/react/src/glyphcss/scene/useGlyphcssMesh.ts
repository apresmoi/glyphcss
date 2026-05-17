import { useEffect, useRef, useState } from "react";
import type { GlyphcssTriangle, GlyphcssMeshHandle, GlyphcssMeshTransform } from "glyphcss";
import { useGlyphcssSceneContext } from "./context";

export interface UseGlyphcssMeshOptions {
  transform?: GlyphcssMeshTransform;
}

export interface UseGlyphcssMeshResult {
  meshRef: React.MutableRefObject<GlyphcssMeshHandle | null>;
  loading: boolean;
}

/**
 * useGlyphcssMesh — register a triangle list with the parent GlyphcssScene.
 * Mirrors usePolyMesh but for the ASCII paint backend.
 */
export function useGlyphcssMesh(
  triangles: GlyphcssTriangle[],
  options?: UseGlyphcssMeshOptions,
): UseGlyphcssMeshResult {
  const { sceneRef } = useGlyphcssSceneContext();
  const meshRef = useRef<GlyphcssMeshHandle | null>(null);
  const [loading] = useState(false);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const handle = scene.add(triangles, options?.transform);
    meshRef.current = handle;
    return () => {
      handle.dispose();
      meshRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneRef, triangles]);

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    if (options?.transform) {
      mesh.setTransform(options.transform);
      sceneRef.current?.rerender();
    }
  }, [sceneRef, options?.transform]);

  return { meshRef, loading };
}
