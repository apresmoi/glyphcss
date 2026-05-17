import type { InjectionKey, ShallowRef } from "vue";
import type { GlyphcssSceneHandle } from "glyphcss";

export interface GlyphcssSceneContextValue {
  sceneRef: ShallowRef<GlyphcssSceneHandle | null>;
}

export const GlyphcssSceneContextKey: InjectionKey<GlyphcssSceneContextValue> =
  Symbol("glyphcss-scene");

export type { GlyphcssSceneHandle };
