import type { FluidReaderFont } from "../model/fluidExamples";

const FONT_TOKENS: Record<Exclude<FluidReaderFont, "system">, string> = {
  render: "--gc-font-render",
  ui: "--gc-font-ui",
  prose: "--gc-font-prose",
};
/** The package's own default (`GLYPH_FLUID_READER_FONT`). */
const SYSTEM_FONT = "ui-monospace, Menlo, Consolas, monospace";

/** The plain look's CSS font-family: one of the site's font tokens, or the system monospace stack. */
export function fluidReaderFontFamily(font: FluidReaderFont): string {
  if (font === "system") return SYSTEM_FONT;
  return getComputedStyle(document.documentElement).getPropertyValue(FONT_TOKENS[font]).trim() || SYSTEM_FONT;
}
