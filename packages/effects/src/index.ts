export {
  GlyphEffectCatalog,
  GlyphEffectNoColor,
  GlyphEffects,
  GlyphRamps,
  combineSynth,
  defaultGlyphEffectParams,
  getGlyphEffect,
  glyphEffectHasColor,
  synthWave,
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

// Font-calibrated ramps — measure real per-glyph ink coverage in a live font
// and generate a perceptually-linear solid-mode ramp for THAT font, instead
// of an authored guess (`GlyphRamps` above). Browser-only by default; see the
// module doc for how to measure off the DOM (tests, SSR).
export { calibrateGlyphRamp, calibrateWeightedGlyphRamp, measureGlyphInkCoverage } from "./calibrateRamp";
export type {
  GlyphCoverageCanvas2D,
  GlyphCoverageCanvasFactory,
  GlyphCoverageFont,
  GlyphMeasureGlyphCoverageOptions,
  GlyphRampCalibrationOptions,
  GlyphRampCalibrationResult,
  GlyphRampCalibrationStep,
  GlyphWeightedRampCalibrationOptions,
  GlyphWeightedRampCalibrationResult,
  GlyphWeightedRampCalibrationStep,
} from "./calibrateRamp";

// Static effect export — bake an effect-only, static-camera scene into a
// self-contained pen (inlined vanilla-JS evaluator, zero glyphcss at runtime).
// Field-synth only for now; see the module doc for what generalizing needs.
export { buildGlyphFieldSynthStaticExport } from "./staticExport";
export type {
  GlyphFieldSynthStaticExportEffect,
  GlyphFieldSynthStaticExportOptions,
  GlyphFieldSynthStaticExportResult,
} from "./staticExport";
