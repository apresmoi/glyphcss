import { useCallback, useEffect, useMemo, useRef } from "react";
import type { GlyphcssCamera, GlyphcssPerspectiveCameraOptions } from "glyphcss";
import { createGlyphcssPerspectiveCamera } from "glyphcss";
import { useGlyphcssSceneContext } from "../scene/context";

export interface UseGlyphcssCameraOptions extends GlyphcssPerspectiveCameraOptions {}

export interface UseGlyphcssCameraResult {
  cameraRef: React.MutableRefObject<GlyphcssCamera | null>;
  rerender: () => void;
}

export function useGlyphcssCameraHook(options: UseGlyphcssCameraOptions): UseGlyphcssCameraResult {
  const cameraRef = useRef<GlyphcssCamera | null>(null);
  if (!cameraRef.current) {
    cameraRef.current = createGlyphcssPerspectiveCamera(options);
  }

  const { sceneRef } = useGlyphcssSceneContext();

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
    if (options.scale !== undefined) camera.scale = options.scale;
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

export { useGlyphcssCamera } from "./context";
