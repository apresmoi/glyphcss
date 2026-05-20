import { createContext, useContext } from "react";
import type { GlyphCamera } from "glyphcss";

export interface GlyphCameraContextValue {
  cameraRef: React.MutableRefObject<GlyphCamera | null>;
  /** Notify the scene to re-render after camera changes. */
  rerender: () => void;
  /**
   * Set by the child GlyphScene so the camera can trigger rerenders when
   * props change after the scene is mounted.
   */
  sceneRerenderRef: React.MutableRefObject<(() => void) | null>;
}

export const GlyphCameraContext = createContext<GlyphCameraContextValue | null>(null);

export function useGlyphCamera(): GlyphCameraContextValue {
  const ctx = useContext(GlyphCameraContext);
  if (!ctx) {
    throw new Error("glyphcss: camera hook must be used inside a GlyphCamera.");
  }
  return ctx;
}

export function useGlyphCameraContext(): GlyphCameraContextValue {
  const ctx = useContext(GlyphCameraContext);
  if (!ctx) {
    throw new Error(
      "glyphcss: GlyphScene must be placed inside a GlyphPerspectiveCamera or GlyphOrthographicCamera.",
    );
  }
  return ctx;
}
