import { inject } from "vue";
import { GlyphCameraContextKey } from "./context";
import type { GlyphCameraContextValue } from "./context";

export function useGlyphCamera(): GlyphCameraContextValue {
  const ctx = inject(GlyphCameraContextKey);
  if (!ctx) {
    throw new Error("glyphcss: useGlyphCamera must be used inside a GlyphCamera component.");
  }
  return ctx;
}

export type { GlyphCameraContextValue };
