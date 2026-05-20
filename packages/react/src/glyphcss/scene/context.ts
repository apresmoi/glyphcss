import { createContext, useContext } from "react";
import type { GlyphSceneHandle, GlyphHotspotHandle, GlyphHotspotOptions, GlyphMeshHandle, GlyphMeshTransform } from "glyphcss";

export interface GlyphSceneContextValue {
  sceneRef: React.MutableRefObject<GlyphSceneHandle | null>;
}

export const GlyphSceneContext = createContext<GlyphSceneContextValue | null>(null);

export function useGlyphSceneContext(): GlyphSceneContextValue {
  const ctx = useContext(GlyphSceneContext);
  if (!ctx) {
    throw new Error("glyphcss: component must be used inside a GlyphScene.");
  }
  return ctx;
}

export interface GlyphMeshContextValue {
  meshRef: React.MutableRefObject<GlyphMeshHandle | null>;
}

export const GlyphMeshContext = createContext<GlyphMeshContextValue | null>(null);

export type { GlyphSceneHandle, GlyphHotspotHandle, GlyphHotspotOptions, GlyphMeshHandle, GlyphMeshTransform };
