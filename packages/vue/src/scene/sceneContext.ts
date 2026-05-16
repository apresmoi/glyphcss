/**
 * PolySceneContext — propagates scene-level rendering options
 * (textureLighting + lights) to descendants. PolyMesh / Poly children
 * inherit these as fallbacks when their own equivalent props are
 * undefined, so a helper rendered inside `<PolyScene texture-lighting="dynamic">`
 * picks up the dynamic mode automatically (per-polygon normal vars + mask).
 */
import { inject, type ComputedRef, type InjectionKey, type Ref } from "vue";
import type {
  PolyAmbientLight,
  PolyDirectionalLight,
  PolyTextureLightingMode,
  Polygon,
} from "@layoutit/polycss-core";

export interface PolyShadowOptions {
  color?: string;
  opacity?: number;
  lift?: number;
}

export interface PolyShadowRegistry {
  /** Register a casting mesh's polygon getter (called when castShadow=true). */
  register(id: symbol, getPolygons: () => Polygon[]): void;
  /** Unregister a casting mesh on unmount or castShadow toggle. */
  unregister(id: symbol): void;
  /** Reactive signal that increments whenever the registry changes. */
  version: Ref<number>;
  /** Snapshot of all registered polygon getters. */
  getEntries(): Array<() => Polygon[]>;
}

export interface PolySceneContextValue {
  textureLighting: PolyTextureLightingMode;
  directionalLight?: PolyDirectionalLight;
  ambientLight?: PolyAmbientLight;
  experimentalTextureEdgeRepair?: boolean;
  shadow?: PolyShadowOptions;
  shadowRegistry?: PolyShadowRegistry;
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
