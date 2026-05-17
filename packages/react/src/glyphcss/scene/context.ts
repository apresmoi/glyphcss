import { createContext, useContext } from "react";
import type { GlyphcssSceneHandle, GlyphcssHotspotHandle, GlyphcssHotspotOptions, GlyphcssMeshHandle, GlyphcssMeshTransform, GlyphcssTriangle } from "glyphcss";

export interface GlyphcssSceneContextValue {
  sceneRef: React.MutableRefObject<GlyphcssSceneHandle | null>;
}

export const GlyphcssSceneContext = createContext<GlyphcssSceneContextValue | null>(null);

export function useGlyphcssSceneContext(): GlyphcssSceneContextValue {
  const ctx = useContext(GlyphcssSceneContext);
  if (!ctx) {
    throw new Error("glyphcss: GlyphcssMesh must be used inside a GlyphcssScene.");
  }
  return ctx;
}

export interface GlyphcssMeshContextValue {
  meshRef: React.MutableRefObject<GlyphcssMeshHandle | null>;
}

export const GlyphcssMeshContext = createContext<GlyphcssMeshContextValue | null>(null);

export type { GlyphcssSceneHandle, GlyphcssHotspotHandle, GlyphcssHotspotOptions, GlyphcssMeshHandle, GlyphcssMeshTransform, GlyphcssTriangle };
