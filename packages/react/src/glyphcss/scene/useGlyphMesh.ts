import { useEffect, useRef, useState } from "react";
import type { Polygon } from "@glyphcss/core";
import type { GlyphMeshHandle, GlyphMeshTransform } from "glyphcss";
import { useGlyphSceneContext } from "./context";

export interface UseGlyphMeshOptions {
  transform?: GlyphMeshTransform;
}

export interface UseGlyphMeshResult {
  meshRef: React.MutableRefObject<GlyphMeshHandle | null>;
  loading: boolean;
}

/**
 * useGlyphMesh — register a polygon list with the parent GlyphScene.
 * Mirrors usePolyMesh but for the ASCII paint backend.
 */
export function useGlyphMesh(
  polygons: Polygon[],
  options?: UseGlyphMeshOptions,
): UseGlyphMeshResult {
  const { sceneRef } = useGlyphSceneContext();
  const meshRef = useRef<GlyphMeshHandle | null>(null);
  const [loading] = useState(false);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const handle = scene.add(polygons, options?.transform);
    meshRef.current = handle;
    return () => {
      handle.dispose();
      meshRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneRef, polygons]);

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
