import type { InjectionKey, ShallowRef } from "vue";
import type { GlyphcssCamera } from "glyphcss";

export interface GlyphcssCameraContextValue {
  cameraRef: ShallowRef<GlyphcssCamera | null>;
  rerender: () => void;
}

export const GlyphcssCameraContextKey: InjectionKey<GlyphcssCameraContextValue> =
  Symbol("glyphcss-camera");

export type { GlyphcssCamera };
