export {
  GLYPH_FIELD_SYNTH_VALIDATION_RULES,
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
// Rule ids for `GlyphFieldSynthEffect`'s `validateParams` throw sites
// (VOLUMETRIC-2.md §4 P2 fix) — the website's URL hydration repair table
// keys off `GLYPH_FIELD_SYNTH_VALIDATION_RULES` instead of hand-mirroring
// stock.ts's validators, so a new validator here without a matching website
// row is a genuine cross-package test failure, not silent drift.
export type {
  GlyphFieldSynthValidationError,
  GlyphFieldSynthValidationRuleId,
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

// Program builder + validator (VOLUMETRIC-3.md §4, "program-as-data") — the
// unbounded authoring tier: `buildGlyphFieldProgram` fills IR defaults from a
// pleasant `{ domain, layers: [{ voices: [...] }] }` surface,
// `validateGlyphFieldProgram` shape-checks an arbitrary value before it ever
// reaches `evaluateFieldProgram`'s unguarded dereferences. `packages/glyphcss`
// plumbs a `program` layer option through to this validator via the
// definition's own `validateProgram` hook (see `GlyphFieldSynthEffect`
// below) rather than importing this package directly.
export { buildGlyphFieldProgram, validateGlyphFieldProgram } from "./fieldProgram";
export type {
  FieldLayerInput as GlyphFieldLayerInput,
  FieldProgramInput as GlyphFieldProgramInput,
  FieldVoiceInput as GlyphFieldVoiceInput,
} from "./fieldProgram";

// Sphere tracing for carve (VOLUMETRIC-3.md §3) — `buildGlyphFieldDistanceOracle`
// and `marchGlyphFieldSphere` already carry the `Glyph` prefix in
// `fieldProgram.ts` itself (unlike `marchField`/`evaluateFieldProgram` above,
// which get it only at this re-export boundary), so no rename here.
export {
  buildGlyphFieldDistanceOracle,
  marchGlyphFieldSphere,
  SPHERE_MARCH_MAX_STEPS as GLYPH_SPHERE_MARCH_MAX_STEPS,
  SPHERE_MARCH_OVERSHOOT_EPSILON as GLYPH_SPHERE_MARCH_OVERSHOOT_EPSILON,
  SPHERE_MARCH_SAFETY as GLYPH_SPHERE_MARCH_SAFETY,
  SPHERE_MARCH_STALL_ADVANCE as GLYPH_SPHERE_MARCH_STALL_ADVANCE,
  SPHERE_MARCH_STALL_STEPS as GLYPH_SPHERE_MARCH_STALL_STEPS,
} from "./fieldProgram";
export type {
  FieldDistanceOracleParams as GlyphFieldDistanceOracleParams,
  FieldDistanceSampler as GlyphFieldDistanceSampler,
  FieldSphereMarchOptions as GlyphFieldSphereMarchOptions,
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

// P1-B (VOLUMETRIC-2.md §3): the four field-synth presets a consumer (the
// website's `/synth` stage-hint table) needs to key off by OBJECT IDENTITY,
// not by re-deriving them via a name-string lookup into `GlyphFieldSynthEffect
// .presets` — the same array these are already the exact elements of.
export {
  breathingGyroidPreset as GlyphBreathingGyroidPreset,
  cubeTilesPreset as GlyphCubeTilesPreset,
  gyroidXrayPreset as GlyphGyroidXrayPreset,
  iridescentShellPreset as GlyphIridescentShellPreset,
  iridescentSpongePreset as GlyphIridescentSpongePreset,
  mengerFlowPreset as GlyphMengerFlowPreset,
  mengerSdfPreset as GlyphMengerSdfPreset,
  mengerSpongePreset as GlyphMengerSpongePreset,
  sdfBloomPreset as GlyphSdfBloomPreset,
  sierpinskiPyramidPreset as GlyphSierpinskiPyramidPreset,
  sierpinskiSdfPreset as GlyphSierpinskiSdfPreset,
} from "./stock";

// The flat schema's voice/layer caps (VOLUMETRIC-3.md §4 bumped
// `SYNTH_VOICES` 6 -> 9) — public so the website derives its own voice-count
// UI limits from the real cap instead of an independently hardcoded
// duplicate (see synthKit.tsx / synthUrlState.ts).
export { SYNTH_LAYERS, SYNTH_VOICES } from "./stock";

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
