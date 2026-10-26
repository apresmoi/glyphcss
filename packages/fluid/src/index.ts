// @glyphcss/fluid — molty.uno's braille fluid as a glyphcss text surface.
// Layers, each usable alone: sim (pure, worker-safe) → cells → atlas encode → runtime.

export { createGlyphFluid } from "./runtime/createGlyphFluid";
export type {
  GlyphFluid,
  GlyphFluidOptions,
  GlyphFluidGridOptions,
  GlyphFluidTarget,
  GlyphFluidZone,
  GlyphFluidStats,
} from "./runtime/createGlyphFluid";

export { GlyphFluidTargets } from "./targets/index";
export type { GlyphFluidTargetSpec, GlyphFluidTargetOptions, GlyphFluidRect, GlyphFluidLayout, GlyphFluidCellBox } from "./targets/types";
export type { GlyphFluidTextTargetOptions } from "./targets/text";
export type { GlyphFluidImageTargetOptions, GlyphFluidImageSource } from "./targets/image";
export type { GlyphFluidMeshTargetOptions } from "./targets/mesh";
export type { GlyphFluidZoneOptions } from "./targets/zones";
export {
  GLYPH_FLUID_TARGET_FIELDS,
  createGlyphFluidTargetFrame,
  unpackGlyphFluidTargets,
} from "./targets/frame";
export type { GlyphFluidTargetFrame, GlyphFluidTargetField } from "./targets/frame";
export { measureGlyphFluidZone, writeGlyphFluidZones } from "./targets/zones";
export type { GlyphFluidZoneBox } from "./targets/zones";
export { glyphFluidCoverageFromAlpha, glyphFluidImageCells, mergeGlyphFluidCells } from "./targets/raster";
export type { GlyphFluidImageCells } from "./targets/raster";

export { GlyphFluidSim, GLYPH_FLUID_SIM_TUNING } from "./sim/sim";
export type { GlyphFluidTuning } from "./sim/sim";
export { configureGlyphFluidRect, applyGlyphFluidOp, stepGlyphFluidSim } from "./sim/ops";
export type { GlyphFluidOp, GlyphFluidStepParams, GlyphFluidRectOptions } from "./sim/ops";

export { computeGlyphFluidCells, createGlyphFluidCells, GLYPH_FLUID_DOTS_TO_BRAILLE } from "./cells/cells";
export type { GlyphFluidCells } from "./cells/cells";
export { GlyphFluidEncoder, glyphFluidPaletteCss } from "./cells/encode";
export type { GlyphFluidEncoding, GlyphFluidFrame, GlyphFluidEncoderOptions } from "./cells/encode";

export { GlyphFluidCore } from "./runtime/core";
export type { GlyphFluidCoreInit, GlyphFluidStepInput } from "./runtime/core";
export { handleGlyphFluidWorkerMessage } from "./runtime/protocol";
export type { GlyphFluidWorkerMessage, GlyphFluidWorkerReply, GlyphFluidWorkerState } from "./runtime/protocol";
