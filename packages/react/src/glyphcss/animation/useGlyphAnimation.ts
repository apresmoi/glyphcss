/**
 * useGlyphAnimation — wraps createGlyphAnimationMixer from @glyphcss/core.
 * The animation system is paint-backend-agnostic: it mutates polygon arrays
 * and calls setPolygons on the target, which is independent of whether the
 * output is ASCII text or any other backend.
 *
 * For the ASCII backend, the animation target should be a GlyphMesh handle
 * or any object that implements GlyphAnimationTarget (setPolygons).
 */
export { useGlyphAnimation } from "../../animation/useGlyphAnimation";
export type { UseGlyphAnimationResult } from "../../animation/useGlyphAnimation";
