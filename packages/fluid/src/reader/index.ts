// @glyphcss/fluid/reader — the reference's speed reader in two layers:
//   rules (./rules): tokenizer, ORP, word delay and the word clock; pure, no fluid imports
//   rendering: `createGlyphFluidReader` draws the clock's words with the package's fluid
export { glyphReaderOrp, tokenizeGlyphReaderText, glyphReaderWordDelay, createGlyphReaderClock } from "./rules/index";
export type { GlyphReaderToken, GlyphReaderClock, GlyphReaderClockEvent, GlyphReaderClockOptions, GlyphReaderScheduler } from "./rules/index";
export { createGlyphFluidReader } from "./createGlyphFluidReader";
export type { GlyphFluidReader, GlyphFluidReaderOptions } from "./createGlyphFluidReader";
export { glyphFluidReaderWordCells, glyphFluidReaderExtent, glyphFluidReaderPlainFontPx, glyphFluidReaderLetterSlots } from "./target";
export type { GlyphFluidReaderWordCells, GlyphFluidReaderLook } from "./target";
export { glyphFluidReaderGlyph, glyphFluidReaderLetterColor, GLYPH_FLUID_READER_FONT, GLYPH_FLUID_READER_RAMP } from "./letters";
