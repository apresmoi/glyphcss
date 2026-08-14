/**
 * "Calibrated" glyph palette — a font-calibrated solid ramp for the gallery's
 * demo. `@glyphcss/effects`' `calibrateGlyphRamp` measures real per-glyph ink
 * coverage in the same font stack the `.glyph-output` `<pre>` renders with
 * (see `website/src/styles/glyph-demo.css`) and sorts/dedupes it into a ramp
 * that is perceptually linear for THAT font — unlike the authored named
 * palettes (`default`, `ascii`, …), which are eyeballed guesses that only
 * read cleanly in the font they were tuned against.
 *
 * The result is plain ramp data, so registering it needs nothing beyond
 * `glyphcss`'s already-public, mutable `WIREFRAME_PALETTES` registry — the
 * same mechanism any named palette uses. Computed lazily (browser-only,
 * needs a canvas) and cached: the Dock's "Calibrated" option just selects it
 * by name once it exists.
 */
import { calibrateGlyphRamp } from "@glyphcss/effects";
import { WIREFRAME_PALETTES } from "glyphcss";

export const CALIBRATED_PALETTE_NAME = "calibrated";

// Matches `.glyph-output`'s font-family in glyph-demo.css.
const GALLERY_FONT_STACK = 'ui-monospace, "JetBrains Mono", "SF Mono", "Menlo", monospace';

let calibrated = false;

/**
 * Compute the calibrated ramp once (idempotent) and register it into
 * `WIREFRAME_PALETTES` under `CALIBRATED_PALETTE_NAME`. No-op after the
 * first call, and a no-op off the DOM (SSR) — the gallery is
 * `client:only="react"`, so this always runs in a browser in practice.
 */
export function ensureCalibratedPalette(): void {
  if (calibrated || typeof document === "undefined") return;
  calibrated = true;

  const { ramp } = calibrateGlyphRamp({
    font: { family: GALLERY_FONT_STACK, size: 32 },
    steps: 16,
  });

  // Reuse the default palette's wireframe tiers — calibration is a solid-mode
  // ink-coverage ramp; it says nothing about wireframe edge glyphs.
  const base = WIREFRAME_PALETTES.default!;
  WIREFRAME_PALETTES[CALIBRATED_PALETTE_NAME] = {
    thin: base.thin,
    normal: base.normal,
    core: base.core,
    solid: ramp.split(""),
  };
}
