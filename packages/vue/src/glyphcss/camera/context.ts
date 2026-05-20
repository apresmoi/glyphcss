import { inject } from "vue";
import type { InjectionKey, ShallowRef } from "vue";
import type { GlyphCamera } from "glyphcss";

export interface GlyphCameraContextValue {
  cameraRef: ShallowRef<GlyphCamera | null>;
  rerender: () => void;
  /**
   * Set by the child GlyphScene so the camera can trigger rerenders when
   * props change after the scene is mounted.
   */
  sceneRerenderRef: ShallowRef<(() => void) | null>;
}

export const GlyphCameraContextKey: InjectionKey<GlyphCameraContextValue> =
  Symbol("glyph-camera");

export function useGlyphCameraContext(): GlyphCameraContextValue {
  const ctx = inject(GlyphCameraContextKey);
  if (!ctx) {
    throw new Error(
      "glyphcss: GlyphScene must be placed inside a GlyphPerspectiveCamera or GlyphOrthographicCamera.",
    );
  }
  return ctx;
}

export type { GlyphCamera };
