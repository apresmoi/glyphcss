import type { InjectionKey, ShallowRef } from "vue";
import type { GlyphCamera } from "glyphcss";

export interface GlyphCameraContextValue {
  cameraRef: ShallowRef<GlyphCamera | null>;
  rerender: () => void;
}

export const GlyphCameraContextKey: InjectionKey<GlyphCameraContextValue> =
  Symbol("glyph-camera");

export type { GlyphCamera };
