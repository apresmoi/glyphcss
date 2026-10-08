import { calibrateGlyphRamp, GlyphRamps, measureGlyphInkCoverage } from "@glyphcss/effects";
import { useEffect, useState } from "react";
import { CALIBRATED_RAMP_NAME } from "../features/synth/model/parameters";

export const RAMP_CALIBRATION_STEPS = 10;

export interface RampCalibrationState {
  /** Font-calibrated ramp, darkest → densest. `null` until measured. */
  ramp: string | null;
  /** Per-glyph measured ink coverage (0..1) for every ramp option, keyed by
   *  its `RAMP_OPTS` name (authored ramps AND `CALIBRATED_RAMP_NAME`). Empty
   *  until the font is ready and measurement completes. */
  coverageByOption: Record<string, number[]>;
}

// Measures the PAGE's actual resolved render font (read live off the mounted
// `<pre class="glyph-output">`, not a hardcoded guess) and produces both a
// calibrated ramp and a density table for every ramp option, for the density
// bars in the picker. `document.fonts.ready` is awaited FIRST — canvas glyph
// measurement races webfont loading, so measuring before it resolves can
// silently measure a fallback font's metrics instead of the real one.
export function useRampCalibration(hostRef: { current: HTMLElement | null }): RampCalibrationState {
  const [state, setState] = useState<RampCalibrationState>({ ramp: null, coverageByOption: {} });
  useEffect(() => {
    if (typeof document === "undefined") return;
    let cancelled = false;
    document.fonts.ready.then(() => {
      if (cancelled) return;
      const font = getRenderFont(hostRef.current);
      const calibrated = calibrateGlyphRamp({ font, steps: RAMP_CALIBRATION_STEPS });
      const coverageByOption: Record<string, number[]> = {
        [CALIBRATED_RAMP_NAME]: calibrated.steps.map((step) => step.coverage),
      };
      for (const [name, glyphs] of Object.entries(GlyphRamps)) {
        coverageByOption[name] = glyphs.split("").map((glyph) => measureGlyphInkCoverage(glyph, { font }));
      }
      if (!cancelled) setState({ ramp: calibrated.ramp, coverageByOption });
    });
    return () => {
      cancelled = true;
    };
  }, [hostRef]);
  return state;
}

// Reads the page's actual resolved render font off the mounted
// `<pre class="glyph-output">` (not a hardcoded guess) — shared by ramp
// calibration and the live "Custom" swatch measurement below.
export function getRenderFont(host: HTMLElement | null): { family: string; size: number; weight?: string } {
  const pre = host?.querySelector("pre.glyph-output") as HTMLElement | null;
  const cs = pre ? getComputedStyle(pre) : null;
  return {
    family: cs?.fontFamily || "monospace",
    size: cs ? parseFloat(cs.fontSize) || 16 : 16,
    weight: cs?.fontWeight,
  };
}

// Measures the CURRENTLY TYPED `glyphs` string (not a preset) so the density
// illustration keeps describing what's actually rendering when the ramp
// doesn't match any `GlyphRamps` preset. Debounced 250ms: canvas glyph
// measurement runs per character, so re-measuring on every keystroke would
// paint a fresh <canvas> per key while the user is mid-edit — 250ms lands
// after a typing pause without reading as laggy.
export const CUSTOM_RAMP_MEASURE_DEBOUNCE_MS = 250;

export function useCustomRampCoverage(hostRef: { current: HTMLElement | null }, glyphs: string): number[] {
  const [coverage, setCoverage] = useState<number[]>([]);
  useEffect(() => {
    if (typeof document === "undefined") return;
    let cancelled = false;
    const chars = Array.from(glyphs);
    if (chars.length === 0) {
      setCoverage([]);
      return;
    }
    const timer = window.setTimeout(() => {
      document.fonts.ready.then(() => {
        if (cancelled) return;
        const font = getRenderFont(hostRef.current);
        setCoverage(chars.map((glyph) => measureGlyphInkCoverage(glyph, { font })));
      });
    }, CUSTOM_RAMP_MEASURE_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [hostRef, glyphs]);
  return coverage;
}
