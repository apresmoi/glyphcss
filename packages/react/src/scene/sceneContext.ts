/**
 * PolySceneContext — propagates scene-level rendering options
 * (textureLighting + lights) to descendants. PolyMesh / Poly children
 * inherit these as fallbacks when their own equivalent props are
 * undefined, so a helper rendered inside `<PolyScene textureLighting="dynamic">`
 * picks up the dynamic mode automatically (per-polygon normal vars + mask).
 */
import { createContext, useContext } from "react";
import type {
  AmbientLight,
  DirectionalLight,
  TextureLightingMode,
} from "@polycss/core";

export interface PolySceneContextValue {
  textureLighting: TextureLightingMode;
  directionalLight?: DirectionalLight;
  ambientLight?: AmbientLight;
}

export const PolySceneContext = createContext<PolySceneContextValue | null>(null);

export function usePolySceneContext(): PolySceneContextValue | null {
  return useContext(PolySceneContext);
}
