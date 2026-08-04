import type { GlyphEffectBlend } from "glyphcss";

/** One mounted effect layer. A loader is a *stack* because the interesting
 *  determinate ones are a texture masked by a progress mask — two stock effects,
 *  neither of which needs a new engine feature. */
export interface LoaderLayer {
  effectId: string;
  params: Record<string, string | number | boolean>;
  blend: GlyphEffectBlend;
  /** Seconds of effect `time` per wall-clock second. Omit for a static layer. */
  timeScale?: number;
  /** Drive a 0..1 param (`progress`) from the clock — what makes a loader
   *  determinate. `cycle` is one full loop; `hold` is the fraction of it spent
   *  resting at 1.0 before restarting. Without a hold the sweep snaps from full
   *  straight back to empty, which reads as "resetting too soon" rather than as
   *  a bar that completed. */
  progress?: { param: string; cycle: number; hold?: number };
}

export type LoaderKind = "spinner" | "progress";

export interface LoaderPreset {
  id: string;
  label: string;
  kind: LoaderKind;
  layers: LoaderLayer[];
}

// Every loader is authored in the plane's 0..1 UV, so it re-reads correctly at
// any cols×rows — the invariance the stage's size grid demonstrates.
const RAMP_SOFT = " .:-=+*#%@";
const RAMP_BLOCK = " ░▒▓█";
const RAMP_DOTS = " ·:∙•●";
const RAMP_HARD = " █";

/** field-synth with every voice silenced — a preset then states only the
 *  oscillators it actually uses. */
const SILENT = {
  amp1: 0, amp2: 0, amp3: 0, amp4: 0, amp5: 0, amp6: 0,
  combine: "add", gain: 1, bias: 0.5, space: "auto", lit: 0,
} as const;

/** field-synth layer shorthand. */
const synth = (
  params: Record<string, string | number | boolean>,
  timeScale = 1,
): LoaderLayer => ({ effectId: "field-synth", params: { ...SILENT, ...params }, blend: "replace", timeScale });

/** A `wipe` mask driven from the clock — the determinate half of the page.
 *  Defaults to resting a quarter of each loop at 100%. */
const progressMask = (
  params: Record<string, string | number | boolean>,
  cycle: number,
  hold = 0.25,
): LoaderLayer => ({
  effectId: "wipe",
  params: { softness: 0.02, invert: false, progress: 0, ...params },
  // A mask writes coverage ONLY. Under `over` the compositor keeps
  // `input × (1 - emitted)`, so the track would stay lit and nothing would
  // appear to fill; `replace` zeroes the input weight, which is what makes the
  // uncovered part of the bar actually empty (and why `wipe`'s own
  // `defaultBlend` is `replace`).
  blend: "replace",
  progress: { param: "progress", cycle, hold },
});

export const LOADERS: LoaderPreset[] = [
  // ── Indeterminate: "still working", no end in sight ──────────────────────
  {
    id: "pulse", label: "Pulse", kind: "spinner",
    layers: [synth({ scale: 1.6, field1: "radial", wave1: "sin", freq1: 1.6, speed1: 0.9, amp1: 1, glyphs: RAMP_SOFT, color: "#7df9ff", colorB: "#2a6cff", gradient: 0.6 })],
  },
  {
    id: "spinner", label: "Spinner", kind: "spinner",
    layers: [synth({ combine: "multiply", scale: 2, field1: "angular", wave1: "saw", freq1: 1, speed1: 0.8, amp1: 1, field2: "radial", wave2: "triangle", freq2: 0.9, speed2: 0, amp2: 1, glyphs: RAMP_SOFT, gain: 1.5, color: "#8affc1", colorB: "#0f6b4a", gradient: 0.8 })],
  },
  {
    id: "comet", label: "Comet", kind: "spinner",
    layers: [synth({ combine: "multiply", scale: 2, field1: "angular", wave1: "saw", freq1: 1, speed1: 1.1, amp1: 1, field2: "radial", wave2: "sin", freq2: 1.6, speed2: 0, amp2: 1, glyphs: RAMP_DOTS, gain: 2.6, bias: 0.1, color: "#ffd280", colorB: "#7a2d00", gradient: 1 })],
  },
  {
    id: "bars", label: "Bars", kind: "spinner",
    layers: [synth({ scale: 1, field1: "linearX", wave1: "square", freq1: 5, speed1: 0.7, amp1: 1, glyphs: RAMP_BLOCK, color: "#ffcf5a", colorB: "#7a4a00", gradient: 0.5 })],
  },
  {
    id: "wave", label: "Wave", kind: "spinner",
    layers: [synth({ scale: 1.4, field1: "linearX", wave1: "sin", freq1: 2.4, speed1: 0.9, amp1: 1, field2: "linearY", wave2: "sin", freq2: 1.2, speed2: 0.35, amp2: 0.5, glyphs: RAMP_SOFT, color: "#7df9ff", colorB: "#ff4fa3", gradient: 0.7 })],
  },
  {
    id: "rings", label: "Rings", kind: "spinner",
    layers: [synth({ scale: 2.4, field1: "radial", wave1: "triangle", freq1: 4, speed1: -0.8, amp1: 1, glyphs: RAMP_DOTS, gain: 1.3, color: "#c8b5ff", colorB: "#3a1f7a", gradient: 0.6 })],
  },
  {
    id: "orbit", label: "Orbit", kind: "spinner",
    layers: [synth({ scale: 2, field1: "spiral", wave1: "sin", freq1: 3, speed1: 0.9, amp1: 1, glyphs: RAMP_SOFT, color: "#ff8f5a", colorB: "#5a1400", gradient: 0.7 })],
  },
  {
    id: "barber", label: "Barber", kind: "spinner",
    layers: [synth({ scale: 1.2, field1: "diagonal", wave1: "saw", freq1: 4, speed1: 0.8, amp1: 1, glyphs: RAMP_BLOCK, color: "#38bdf8", colorB: "#08304a", gradient: 0.5 })],
  },
  {
    id: "sweep", label: "Sweep", kind: "spinner",
    layers: [synth({ scale: 1, field1: "linearX", wave1: "sin", freq1: 1, speed1: 0.9, amp1: 1, glyphs: RAMP_SOFT, gain: 2.2, bias: 0.15, color: "#e8f4ff", colorB: "#12324a", gradient: 0.9 })],
  },
  {
    id: "breathe", label: "Breathe", kind: "spinner",
    layers: [synth({ scale: 0.6, field1: "radial", wave1: "sin", freq1: 0.5, speed1: 0.35, amp1: 1, glyphs: RAMP_SOFT, color: "#a5b4fc", colorB: "#1e1b4b", gradient: 0.5 })],
  },
  {
    id: "moire", label: "Moiré", kind: "spinner",
    layers: [synth({ combine: "multiply", scale: 3, field1: "radial", wave1: "sin", freq1: 6, speed1: 0.4, amp1: 1, field2: "radial", wave2: "sin", freq2: 6.7, speed2: -0.3, amp2: 1, originU: 0.35, originV: 0.5, glyphs: RAMP_SOFT, gain: 1.4, color: "#7df9ff", colorB: "#ff4fa3", gradient: 1 })],
  },
  {
    id: "grid", label: "Grid", kind: "spinner",
    layers: [synth({ combine: "multiply", scale: 1, field1: "linearX", wave1: "square", freq1: 4, speed1: 0.5, amp1: 1, field2: "linearY", wave2: "square", freq2: 3, speed2: -0.4, amp2: 1, glyphs: RAMP_BLOCK, color: "#5eead4", colorB: "#134e4a", gradient: 0.6 })],
  },
  {
    id: "static", label: "Static", kind: "spinner",
    layers: [synth({ scale: 5, field1: "noise", wave1: "sin", freq1: 3, speed1: 1.2, amp1: 1, glyphs: RAMP_SOFT, gain: 1.2, color: "#9fb2c9", colorB: "#1b2530", gradient: 0.4 })],
  },
  {
    id: "braille", label: "Braille", kind: "spinner",
    layers: [synth({ scale: 1.8, field1: "radial", wave1: "sin", freq1: 2, speed1: 0.9, amp1: 1, subcellRes: "2x4", glyphs: RAMP_SOFT, color: "#8affc1", colorB: "#0b3b2a", gradient: 0.6 })],
  },
  {
    id: "scan", label: "Scan", kind: "spinner",
    layers: [{ effectId: "scan", params: { direction: "down", space: "auto", scale: 1, speed: 9, width: 3, spacing: 12, color: "#5ad1ff" }, blend: "over", timeScale: 1 }],
  },
  {
    id: "ripple", label: "Ripple", kind: "spinner",
    layers: [{ effectId: "ripple", params: { glyphs: "*+·", speed: 4, frequency: 0.8, width: 0.16, amount: 0.9, color: "#ffcf5a" }, blend: "over", timeScale: 1 }],
  },
  {
    id: "flow", label: "Flow text", kind: "spinner",
    layers: [
      synth({ scale: 2, field1: "linearX", wave1: "sin", freq1: 1, speed1: 0.3, amp1: 1, glyphs: " .", color: "#1f3350", colorB: "#0b1626", gradient: 0.4 }),
      { effectId: "flow-text", params: { glyphs: "LOADING ", direction: "right", speed: 7, space: "auto", scale: 1 }, blend: "over", timeScale: 1 },
    ],
  },
  {
    id: "matrix", label: "Matrix", kind: "spinner",
    layers: [{ effectId: "matrix-rain", params: { glyphs: "01LOAD", direction: "down", space: "auto", scale: 1, speedMin: 6, speedMax: 18, trail: 12, density: 0.7, seed: 4, colorMode: "monochrome", color: "#00d149", headColor: "#baffd6" }, blend: "over", timeScale: 1 }],
  },
  {
    id: "scramble", label: "Scramble", kind: "spinner",
    layers: [
      synth({ scale: 2, field1: "linearY", wave1: "sin", freq1: 1, speed1: 0.4, amp1: 1, glyphs: RAMP_SOFT, color: "#4b5f7a", colorB: "#0d1622", gradient: 0.5 }),
      { effectId: "scramble", params: { glyphs: "@#$%&*+=?", amount: 0.55, rate: 14, seed: 3 }, blend: "over", timeScale: 1 },
    ],
  },
  {
    id: "glitch", label: "Glitch", kind: "spinner",
    layers: [
      synth({ scale: 1.6, field1: "linearX", wave1: "saw", freq1: 2, speed1: 0.5, amp1: 1, glyphs: RAMP_BLOCK, color: "#334155", colorB: "#0b1220", gradient: 0.5 }),
      { effectId: "glitch", params: { glyphs: "#%/=+!?", amount: 0.4, rate: 10, bandSize: 3, seed: 7, color: "#ff4fd8" }, blend: "over", timeScale: 1 },
    ],
  },

  // ── Determinate: a real 0→100% sweep, driven by a `progress` param ────────
  {
    id: "progress-bar", label: "Progress", kind: "progress",
    layers: [
      synth({ scale: 1, field1: "linearX", wave1: "sin", freq1: 0.5, speed1: 0, amp1: 1, glyphs: RAMP_HARD, gain: 3, bias: 0.9, color: "#38bdf8", colorB: "#0ea5e9", gradient: 0.4 }),
      progressMask({ direction: "right", softness: 0.01 }, 7),
    ],
  },
  {
    id: "progress-soft", label: "Soft fill", kind: "progress",
    layers: [
      synth({ scale: 1, field1: "linearX", wave1: "sin", freq1: 0.5, speed1: 0, amp1: 1, glyphs: RAMP_SOFT, gain: 3, bias: 0.9, color: "#a78bfa", colorB: "#4c1d95", gradient: 0.5 }),
      progressMask({ direction: "right", softness: 0.14 }, 7),
    ],
  },
  {
    id: "progress-stripes", label: "Striped bar", kind: "progress",
    layers: [
      synth({ scale: 1.2, field1: "diagonal", wave1: "saw", freq1: 5, speed1: 0.9, amp1: 1, glyphs: RAMP_BLOCK, color: "#ffcf5a", colorB: "#7a4a00", gradient: 0.6 }),
      progressMask({ direction: "right", softness: 0.01 }, 8),
    ],
  },
  {
    id: "progress-gauge", label: "Gauge", kind: "progress",
    layers: [
      synth({ scale: 1, field1: "linearY", wave1: "sin", freq1: 0.5, speed1: 0, amp1: 1, glyphs: RAMP_BLOCK, gain: 3, bias: 0.9, color: "#4ade80", colorB: "#14532d", gradient: 0.5 }),
      progressMask({ direction: "up", softness: 0.02 }, 8),
    ],
  },
  {
    // No mask layer at all: a linearX field with speed 0 is a STATIC gradient
    // across U, so sweeping `bias` walks a hard threshold along it. The voices
    // alone make the bar — `gain` is what sharpens the fill edge.
    id: "progress-voices", label: "Voice bar", kind: "progress",
    layers: [{
      effectId: "field-synth",
      params: { ...SILENT, scale: 1, field1: "linearX", wave1: "saw", freq1: 1, speed1: 0, amp1: 1, glyphs: RAMP_BLOCK, gain: 8, bias: 0, color: "#7df9ff", colorB: "#0b3b52", gradient: 0.7 },
      blend: "replace",
      progress: { param: "bias", cycle: 7, hold: 0.25 },
    }],
  },
  {
    id: "progress-ring", label: "Ring", kind: "progress",
    layers: [{
      effectId: "field-synth",
      params: { ...SILENT, combine: "multiply", scale: 2, field1: "angular", wave1: "saw", freq1: 1, speed1: 0, amp1: 1, field2: "radial", wave2: "triangle", freq2: 0.9, speed2: 0, amp2: 1, glyphs: RAMP_BLOCK, gain: 6, bias: 0, color: "#f472b6", colorB: "#831843", gradient: 0.6 },
      blend: "replace",
      progress: { param: "bias", cycle: 7, hold: 0.25 },
    }],
  },
  {
    id: "progress-dissolve", label: "Dissolve", kind: "progress",
    layers: [
      synth({ scale: 2.5, field1: "noise", wave1: "sin", freq1: 2, speed1: 0.25, amp1: 1, glyphs: RAMP_BLOCK, color: "#22d3ee", colorB: "#083344", gradient: 0.6 }),
      { effectId: "noise-dissolve", params: { progress: 0, softness: 0.12, scale: 0.3, seed: 2 }, blend: "replace", progress: { param: "progress", cycle: 7, hold: 0.25 } },
    ],
  },
];

export const DEFAULT_LOADER = LOADERS[0]!.id;

export function findLoader(id: string | null): LoaderPreset {
  return LOADERS.find((l) => l.id === id) ?? LOADERS[0]!;
}

/** Box shapes a loader realistically has to survive, from an inline badge to a
 *  full-width banner. Each renders the SAME params — differences on screen are
 *  the pattern re-reading at that aspect, not a re-tuned preset. */
export interface LoaderSize {
  cols: number;
  rows: number;
  label: string;
}

export const LOADER_SIZES: LoaderSize[] = [
  { cols: 6, rows: 2, label: "inline" },
  { cols: 12, rows: 3, label: "badge" },
  { cols: 24, rows: 3, label: "bar" },
  { cols: 48, rows: 3, label: "wide bar" },
  { cols: 10, rows: 10, label: "square" },
  { cols: 16, rows: 8, label: "card" },
  { cols: 6, rows: 14, label: "column" },
  { cols: 32, rows: 12, label: "panel" },
  { cols: 64, rows: 6, label: "banner" },
];
