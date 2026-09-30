import { GlyphFieldSynthEffect as fieldSynth } from "@glyphcss/effects";

// ── Voice card (left rail) ────────────────────────────────────────────────────
/**
 * Frequency taper. `freq` is linear 0..24 in the schema, but every authored
 * preset in this repo lives between 0.5 and 14 and the loaders never exceed 6.7
 * — on a linear dial the whole useful range is squeezed into the bottom third
 * while half the travel is spent above 12. A cubic taper spends travel by RATIO
 * instead of by unit, so 0..1 gets ~35% of the dial and 0..10 gets ~75%, and
 * unlike a true log it represents 0 exactly (log(0) is undefined and `freq: 0`
 * is a legal, meaningful value — a voice with no spatial variation).
 */
const FREQ_TAPER = 3;

/** Read from the schema rather than repeated here: the dial and the parameter
 *  must agree, and a hardcoded copy silently clamps the control the moment the
 *  effect's range changes. */
export const FREQ_MAX = Number(
  (fieldSynth.parameterSchema as unknown as Record<string, { max?: number }>).freq1?.max ?? 24,
);

/** A colour voice's own `cfreqN` runs 0..96 (packages/effects/src/stock.ts) —
 *  4x the geometry `freqN` ceiling, so it needs its own schema-read max
 *  rather than sharing `FREQ_MAX`; `freqFromSlider`/`freqToSlider` below
 *  already take `max` as a parameter, so the SAME taper functions serve both. */
export const CFREQ_MAX = Number(
  (fieldSynth.parameterSchema as unknown as Record<string, { max?: number }>).cfreq1?.max ?? 96,
);

export const freqFromSlider = (pos: number, max: number): number => {
  const v = max * Math.pow(Math.min(1, Math.max(0, pos)), FREQ_TAPER);
  // Finer quantization down low, where the taper hands you the resolution: a
  // flat 0.1 step would throw that resolution away exactly where it was bought.
  return v < 2 ? Math.round(v * 100) / 100 : Math.round(v * 10) / 10;
};

export const freqToSlider = (value: number, max: number): number =>
  Math.pow(Math.min(1, Math.max(0, value / max)), 1 / FREQ_TAPER);
