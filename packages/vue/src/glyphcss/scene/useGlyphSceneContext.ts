import { inject } from "vue";
import { GlyphSceneContextKey } from "./context";
import type { GlyphSceneContextValue } from "./context";

export function useGlyphSceneContext(): GlyphSceneContextValue {
  const ctx = inject(GlyphSceneContextKey);
  if (!ctx) {
    throw new Error("glyphcss: must be used inside a GlyphScene.");
  }
  return ctx;
}

export type { GlyphSceneContextValue };
