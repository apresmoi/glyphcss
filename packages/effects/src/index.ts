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

// The field program IR — public per VOLUMETRIC.md's "The field program IR"
// ("the IR evaluator and the marcher are public"). `evaluateGlyphFieldProgram`
// and `marchGlyphField` are the steering seam a future field-authoritative
// primitive or the spectral track's analysis mode plugs into; the types are
// what a caller needs to build or consume a `GlyphFieldProgram` by hand
// (`fieldSynth`'s own params→IR compile in `stock.ts` is one such caller).
export {
  evaluateFieldProgram as evaluateGlyphFieldProgram,
  fieldStepCount as glyphFieldStepCount,
  integrateField as integrateGlyphField,
  marchField as marchGlyphField,
} from "./fieldProgram";
export type {
  FieldEvalResult as GlyphFieldEvalResult,
  FieldIntegrateResult as GlyphFieldIntegrateResult,
  FieldLayer as GlyphFieldLayer,
  FieldMarchHit as GlyphFieldMarchHit,
  FieldMarchMiss as GlyphFieldMarchMiss,
  FieldMarchOptions as GlyphFieldMarchOptions,
  FieldMarchResult as GlyphFieldMarchResult,
  FieldProgram as GlyphFieldProgram,
  FieldSampler as GlyphFieldSampler,
  FieldVoice as GlyphFieldVoice,
} from "./fieldProgram";

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
export { buildGlyphFieldSynthStaticExport, isGlyphFieldSynthStaticExportSupported } from "./staticExport";
export type {
  GlyphFieldSynthStaticExportEffect,
  GlyphFieldSynthStaticExportOptions,
  GlyphFieldSynthStaticExportResult,
} from "./staticExport";
