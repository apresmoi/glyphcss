/**
 * PolySceneContext — propagates scene-level rendering options
 * (textureLighting + lights) to descendants. PolyMesh / Poly children
 * inherit these as fallbacks when their own equivalent props are
 * undefined, so a helper rendered inside `<PolyScene texture-lighting="dynamic">`
 * picks up the dynamic mode automatically (per-polygon normal vars + mask).
 */
import { inject, type ComputedRef, type InjectionKey } from "vue";
import type {
  AmbientLight,
  DirectionalLight,
  TextureLightingMode,
} from "@layoutit/polycss-core";

export interface PolySceneContextValue {
  textureLighting: TextureLightingMode;
  directionalLight?: DirectionalLight;
  ambientLight?: AmbientLight;
}

/**
 * The provided value is a `ComputedRef` so children stay reactive when the
 * scene's textureLighting / lights props change at runtime.
 */
export const PolySceneContextKey: InjectionKey<ComputedRef<PolySceneContextValue>> = Symbol(
  "polycss/scene-context",
);

export function usePolySceneContext(): ComputedRef<PolySceneContextValue> | null {
  return inject(PolySceneContextKey, null);
}
