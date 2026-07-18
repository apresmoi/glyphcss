export {
  GlyphEffectCatalog,
  GlyphEffectNoColor,
  GlyphEffects,
  GlyphRamps,
  defaultGlyphEffectParams,
  getGlyphEffect,
  glyphEffectHasColor,
} from "./stock";

export {
  fieldSynth as GlyphFieldSynthEffect,
  flowText as GlyphFlowTextEffect,
  glitch as GlyphGlitchEffect,
  matrixRain as GlyphMatrixRainEffect,
  noiseDissolve as GlyphNoiseDissolveEffect,
  ripple as GlyphRippleEffect,
  scan as GlyphScanEffect,
  scramble as GlyphScrambleEffect,
  wipe as GlyphWipeEffect,
} from "./stock";

export type {
  GlyphEffectId,
  GlyphEffectPreset,
  GlyphStockEffect,
  GlyphStockEffectDefinition,
} from "./stock";

// Static effect export — bake an effect-only, static-camera scene into a
// self-contained pen (inlined vanilla-JS evaluator, zero glyphcss at runtime).
// Field-synth only for now; see the module doc for what generalizing needs.
export { buildGlyphFieldSynthStaticExport } from "./staticExport";
export type {
  GlyphFieldSynthStaticExportEffect,
  GlyphFieldSynthStaticExportOptions,
  GlyphFieldSynthStaticExportResult,
} from "./staticExport";
