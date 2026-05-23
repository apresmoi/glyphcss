import { useCallback, useRef } from "react";
import type { GlyphCamera, GlyphPerspectiveCameraOptions } from "glyphcss";
import { createGlyphPerspectiveCamera } from "glyphcss";
import { useGlyphCamera } from "./context";

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

  const { sceneRerenderRef } = useGlyphCamera();

  const rerender = useCallback(() => {
    sceneRerenderRef.current?.();
  }, [sceneRerenderRef]);

  return { cameraRef, rerender };
}

export { useGlyphCamera } from "./context";
