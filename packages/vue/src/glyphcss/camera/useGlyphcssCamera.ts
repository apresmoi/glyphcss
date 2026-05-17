import { inject } from "vue";
import { GlyphcssCameraContextKey } from "./context";
import type { GlyphcssCameraContextValue } from "./context";

export function useGlyphcssCamera(): GlyphcssCameraContextValue {
  const ctx = inject(GlyphcssCameraContextKey);
  if (!ctx) {
    throw new Error("glyphcss: useGlyphcssCamera must be used inside a GlyphcssCamera component.");
  }
  return ctx;
}

export type { GlyphcssCameraContextValue };
