import { inject } from "vue";
import { GlyphcssSceneContextKey } from "./context";
import type { GlyphcssSceneContextValue } from "./context";

export function useGlyphcssSceneContext(): GlyphcssSceneContextValue {
  const ctx = inject(GlyphcssSceneContextKey);
  if (!ctx) {
    throw new Error("glyphcss: must be used inside a GlyphcssScene.");
  }
  return ctx;
}

export type { GlyphcssSceneContextValue };
