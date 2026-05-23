import type { InjectionKey, ShallowRef } from "vue";
import type { GlyphSceneHandle } from "glyphcss";

export interface GlyphSceneContextValue {
  sceneRef: ShallowRef<GlyphSceneHandle | null>;
}

export const GlyphSceneContextKey: InjectionKey<GlyphSceneContextValue> =
  Symbol("glyph-scene");

export type { GlyphSceneHandle };
