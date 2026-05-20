import { useCallback, useEffect, useMemo, useRef } from "react";
import type { GlyphCamera, GlyphPerspectiveCameraOptions } from "glyphcss";
import { createGlyphPerspectiveCamera } from "glyphcss";
import { useGlyphSceneContext } from "../scene/context";

export interface UseGlyphCameraOptions extends GlyphPerspectiveCameraOptions {}

export interface UseGlyphCameraResult {
  cameraRef: React.MutableRefObject<GlyphCamera | null>;
  rerender: () => void;
}

export function useGlyphCameraHook(options: UseGlyphCameraOptions): UseGlyphCameraResult {
  const cameraRef = useRef<GlyphCamera | null>(null);
  if (!cameraRef.current) {
    cameraRef.current = createGlyphPerspectiveCamera(options);
  }

  const { sceneRef } = useGlyphSceneContext();

  const rerender = useCallback(() => {
    const scene = sceneRef.current;
    if (scene) scene.rerender();
  }, [sceneRef]);

  // Sync camera props to the scene
  useEffect(() => {
    const camera = cameraRef.current;
    if (!camera) return;
    if (options.rotX !== undefined) camera.rotX = options.rotX;
    if (options.rotY !== undefined) camera.rotY = options.rotY;
    if (options.distance !== undefined) camera.distance = options.distance;
    if (options.zoom !== undefined) camera.zoom = options.zoom;
    if (options.stretch !== undefined) camera.stretch = options.stretch;

    // Set the camera on the scene
    const scene = sceneRef.current;
    if (scene) {
      scene.setOptions({ camera });
      scene.rerender();
    }
  });

  return { cameraRef, rerender };
}

export { useGlyphCamera } from "./context";
