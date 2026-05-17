import { createContext, useContext } from "react";
import type { GlyphcssCamera } from "glyphcss";

export interface GlyphcssCameraContextValue {
  cameraRef: React.MutableRefObject<GlyphcssCamera | null>;
  /** Notify the scene to re-render after camera changes. */
  rerender: () => void;
}

export const GlyphcssCameraContext = createContext<GlyphcssCameraContextValue | null>(null);

export function useGlyphcssCamera(): GlyphcssCameraContextValue {
  const ctx = useContext(GlyphcssCameraContext);
  if (!ctx) {
    throw new Error("glyphcss: camera hook must be used inside a GlyphcssCamera.");
  }
  return ctx;
}
