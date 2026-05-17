/**
 * useGlyphcssAnimation — wraps createGlyphcssAnimationMixer from @glyphcss/core.
 * The animation system is paint-backend-agnostic: it mutates polygon arrays
 * and calls setPolygons on the target, which is independent of whether the
 * output is ASCII text or any other backend.
 *
 * For the ASCII backend, the animation target should be a GlyphcssMesh handle
 * or any object that implements GlyphcssAnimationTarget (setPolygons).
 */
export { useGlyphcssAnimation } from "../../animation/useGlyphcssAnimation";
export type { UseGlyphcssAnimationResult } from "../../animation/useGlyphcssAnimation";
