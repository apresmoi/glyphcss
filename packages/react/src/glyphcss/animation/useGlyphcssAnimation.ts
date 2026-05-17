/**
 * useGlyphcssAnimation — wraps createPolyAnimationMixer from polycss-core,
 * the same as usePolyAnimation. The animation system is paint-backend-agnostic:
 * it mutates polygon arrays and calls setPolygons on the target, which is
 * independent of whether the output is CSS polygon leaves or ASCII text.
 *
 * For the ASCII backend, the animation target should be a GlyphcssMesh handle
 * or any object that implements PolyAnimationTarget (setPolygons).
 */
export { usePolyAnimation as useGlyphcssAnimation } from "../../animation/usePolyAnimation";
export type { UsePolyAnimationResult as UseGlyphcssAnimationResult } from "../../animation/usePolyAnimation";
