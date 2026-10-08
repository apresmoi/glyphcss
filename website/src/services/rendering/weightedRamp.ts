/**
 * Gallery "Weighted shading" toggle — a font-and-weight-calibrated solid ramp
 * (B7). Mirrors `calibratedPalette.ts`'s pattern exactly, but crosses the
 * glyph pool against candidate CSS `font-weight` values via
 * `@glyphcss/effects`'s `calibrateWeightedGlyphRamp` instead of glyph shape
 * alone — the SECOND density axis this feature adds. Measured payoff (Menlo,
 * 10-glyph pool): glyph-only reaches 10 steps / coverage 0.3295; weighted
 * reaches 15 steps / coverage 0.4508. Computed lazily (browser-only, needs a
 * canvas) and cached — the Dock's "Weighted shading" toggle just reads it
 * once it exists.
 */
import { calibrateWeightedGlyphRamp } from "@glyphcss/effects";
import type { GlyphSolidWeightRampStep } from "glyphcss";

// Matches `.glyph-output`'s font-family in glyph-demo.css — same stack
// `calibratedPalette.ts` measures against, and the same stack the B7
// advance-width measurement (AGENTS.md) confirmed is weight-stable.
const GALLERY_FONT_STACK = 'ui-monospace, "JetBrains Mono", "SF Mono", "Menlo", monospace';

let cached: GlyphSolidWeightRampStep[] | null = null;

/**
 * Compute the weighted ramp once (idempotent) and cache it. Returns `null`
 * off the DOM (SSR) — the gallery is `client:only="react"`, so this always
 * resolves to real data in practice; callers treat `null` as "not ready yet"
 * and leave `solidWeightRamp` unset (byte-identical fallback).
 */
export function getSolidWeightRamp(): GlyphSolidWeightRampStep[] | null {
  if (cached) return cached;
  if (typeof document === "undefined") return null;

  const { steps } = calibrateWeightedGlyphRamp({
    font: { family: GALLERY_FONT_STACK, size: 32 },
    steps: 24,
    weights: [400, 700],
  });
  cached = steps.map((step) => ({ glyph: step.glyph, weight: Number(step.weight) }));
  return cached;
}
