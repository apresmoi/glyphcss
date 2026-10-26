// Speed-reader rules: pure and renderer-agnostic, with no fluid (or DOM) imports, so this
// folder can move to its own package unchanged when a second consumer appears.
export { glyphReaderOrp, tokenizeGlyphReaderText, glyphReaderWordDelay } from "./words";
export type { GlyphReaderToken } from "./words";
export { createGlyphReaderClock } from "./clock";
export type { GlyphReaderClock, GlyphReaderClockEvent, GlyphReaderClockOptions, GlyphReaderScheduler } from "./clock";
