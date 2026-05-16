/**
 * PolySceneContext — propagates scene-level rendering options
 * (textureLighting + lights) to descendants. PolyMesh / Poly children
 * inherit these as fallbacks when their own equivalent props are
 * undefined, so a helper rendered inside `<PolyScene textureLighting="dynamic">`
 * picks up the dynamic mode automatically (per-polygon normal vars + mask).
 */
import { createContext, useContext } from "react";
import type {
  PolyAmbientLight,
  PolyDirectionalLight,
  PolyTextureLightingMode,
  Polygon,
} from "@layoutit/polycss-core";

export interface ShadowOptions {
  color?: string;
  opacity?: number;
  lift?: number;
}

export interface PolySceneContextValue {
  textureLighting: PolyTextureLightingMode;
  directionalLight?: PolyDirectionalLight;
  ambientLight?: PolyAmbientLight;
  experimentalTextureEdgeRepair?: boolean;
  shadow?: ShadowOptions;
  /**
   * Called by PolyMesh to register/unregister itself as a shadow caster.
   * `polygons` is null when unregistering or when castShadow is false.
   */
  registerShadowCaster?: (meshId: symbol, polygons: Polygon[] | null) => void;
}

export const PolySceneContext = createContext<PolySceneContextValue | null>(null);

export function usePolySceneContext(): PolySceneContextValue | null {
  return useContext(PolySceneContext);
}
