import type { GlyphEffectBlend } from "glyphcss";

/** One loader = a stock effect id plus the params that make it read as a
 *  looping progress/wait indicator on a flat plane. Nothing here is a new
 *  engine feature — every loader is authored purely out of `@glyphcss/effects`
 *  stock definitions, which is the point of the page. */
export interface LoaderPreset {
  id: string;
  label: string;
  /** What the shape communicates — shown under the stage, not on the tile. */
  note: string;
  effectId: string;
  params: Record<string, string | number | boolean>;
  blend: GlyphEffectBlend;
  /** Seconds of effect `time` per wall-clock second. */
  timeScale: number;
}

// The plane carries a 0..1 UV, so every loader below is authored in UV space and
// re-reads correctly at any cols×rows — that invariance is exactly what the
// stage's size-ratio grid demonstrates.
const RAMP_SOFT = " .:-=+*#%@";
const RAMP_BLOCK = " ░▒▓█";
const RAMP_DOTS = " ·:∙•●";

/** field-synth with every voice silenced — presets opt voices back in, so a
 *  preset only ever states the oscillators it actually uses. */
const SYNTH_SILENT = {
  amp1: 0, amp2: 0, amp3: 0, amp4: 0, amp5: 0, amp6: 0,
  combine: "add",
  gain: 1,
  bias: 0.5,
  space: "auto",
  lit: 0,
} as const;

export const LOADERS: LoaderPreset[] = [
  {
    id: "pulse",
    label: "Pulse",
    note: "A radial sine breathing out from the centre — the plainest 'working' beat.",
    effectId: "field-synth",
    blend: "replace",
    timeScale: 1,
    params: {
      ...SYNTH_SILENT,
      scale: 1.6,
      field1: "radial", wave1: "sin", freq1: 1.6, speed1: 0.9, amp1: 1,
      glyphs: RAMP_SOFT,
      color: "#7df9ff", colorB: "#2a6cff", gradient: 0.6,
    },
  },
  {
    id: "spinner",
    label: "Spinner",
    note: "An angular saw multiplied by a radial falloff — a sweep that rotates around the centre, the classic spinner read.",
    effectId: "field-synth",
    blend: "replace",
    timeScale: 1,
    params: {
      ...SYNTH_SILENT,
      combine: "multiply",
      scale: 2,
      field1: "angular", wave1: "saw", freq1: 1, speed1: 0.8, amp1: 1,
      field2: "radial", wave2: "triangle", freq2: 0.9, speed2: 0, amp2: 1,
      glyphs: RAMP_SOFT,
      gain: 1.5,
      color: "#8affc1", colorB: "#0f6b4a", gradient: 0.8,
    },
  },
  {
    id: "bars",
    label: "Bars",
    note: "A square wave marching along U — indeterminate progress, the barber-pole family.",
    effectId: "field-synth",
    blend: "replace",
    timeScale: 1,
    params: {
      ...SYNTH_SILENT,
      scale: 1,
      field1: "linearX", wave1: "square", freq1: 5, speed1: 0.7, amp1: 1,
      glyphs: RAMP_BLOCK,
      color: "#ffcf5a", colorB: "#7a4a00", gradient: 0.5,
    },
  },
  {
    id: "wave",
    label: "Wave",
    note: "Two perpendicular sines added — a travelling swell that stays legible when the box gets very wide.",
    effectId: "field-synth",
    blend: "replace",
    timeScale: 1,
    params: {
      ...SYNTH_SILENT,
      combine: "add",
      scale: 1.4,
      field1: "linearX", wave1: "sin", freq1: 2.4, speed1: 0.9, amp1: 1,
      field2: "linearY", wave2: "sin", freq2: 1.2, speed2: 0.35, amp2: 0.5,
      glyphs: RAMP_SOFT,
      color: "#7df9ff", colorB: "#ff4fa3", gradient: 0.7,
    },
  },
  {
    id: "rings",
    label: "Rings",
    note: "A radial triangle running inward — concentric rings collapsing toward the centre.",
    effectId: "field-synth",
    blend: "replace",
    timeScale: 1,
    params: {
      ...SYNTH_SILENT,
      scale: 2.4,
      field1: "radial", wave1: "triangle", freq1: 4, speed1: -0.8, amp1: 1,
      glyphs: RAMP_DOTS,
      gain: 1.3,
      color: "#c8b5ff", colorB: "#3a1f7a", gradient: 0.6,
    },
  },
  {
    id: "orbit",
    label: "Orbit",
    note: "A spiral field — angular and radial motion at once, so it reads as rotation even in a squat box.",
    effectId: "field-synth",
    blend: "replace",
    timeScale: 1,
    params: {
      ...SYNTH_SILENT,
      scale: 2,
      field1: "spiral", wave1: "sin", freq1: 3, speed1: 0.9, amp1: 1,
      glyphs: RAMP_SOFT,
      color: "#ff8f5a", colorB: "#5a1400", gradient: 0.7,
    },
  },
  {
    id: "barber",
    label: "Barber",
    note: "A diagonal saw — stripes sliding corner to corner, the loader that most obviously changes character with aspect.",
    effectId: "field-synth",
    blend: "replace",
    timeScale: 1,
    params: {
      ...SYNTH_SILENT,
      scale: 1.2,
      field1: "diagonal", wave1: "saw", freq1: 4, speed1: 0.8, amp1: 1,
      glyphs: RAMP_BLOCK,
      color: "#38bdf8", colorB: "#08304a", gradient: 0.5,
    },
  },
  {
    id: "moire",
    label: "Moiré",
    note: "Two close radial frequencies multiplied — interference that never visibly repeats.",
    effectId: "field-synth",
    blend: "replace",
    timeScale: 1,
    params: {
      ...SYNTH_SILENT,
      combine: "multiply",
      scale: 3,
      field1: "radial", wave1: "sin", freq1: 6, speed1: 0.4, amp1: 1,
      field2: "radial", wave2: "sin", freq2: 6.7, speed2: -0.3, amp2: 1,
      originU: 0.35, originV: 0.5,
      glyphs: RAMP_SOFT,
      gain: 1.4,
      color: "#7df9ff", colorB: "#ff4fa3", gradient: 1,
    },
  },
  {
    id: "static",
    label: "Static",
    note: "A drifting noise field — the 'still connecting' loader, with no directional promise.",
    effectId: "field-synth",
    blend: "replace",
    timeScale: 1,
    params: {
      ...SYNTH_SILENT,
      scale: 5,
      field1: "noise", wave1: "sin", freq1: 3, speed1: 1.2, amp1: 1,
      glyphs: RAMP_SOFT,
      gain: 1.2,
      color: "#9fb2c9", colorB: "#1b2530", gradient: 0.4,
    },
  },
  {
    id: "braille-pulse",
    label: "Braille",
    note: "The Pulse field at 2×4 subcell resolution — four times the vertical detail per cell, so it stays smooth in a 3-row strip.",
    effectId: "field-synth",
    blend: "replace",
    timeScale: 1,
    params: {
      ...SYNTH_SILENT,
      scale: 1.8,
      field1: "radial", wave1: "sin", freq1: 2, speed1: 0.9, amp1: 1,
      subcellRes: "2x4",
      glyphs: RAMP_SOFT,
      color: "#8affc1", colorB: "#0b3b2a", gradient: 0.6,
    },
  },
  {
    id: "scan",
    label: "Scan",
    note: "The stock `scan` effect — a hard sweep line, tied to cell rows rather than UV, so it keeps its thickness at every size.",
    effectId: "scan",
    blend: "over",
    timeScale: 1,
    params: { speed: 10, width: 2, spacing: 14, color: "#7df9ff" },
  },
  {
    id: "ripple",
    label: "Ripple",
    note: "The stock `ripple` effect — expanding rings from a point, good as a one-shot 'received' confirmation.",
    effectId: "ripple",
    blend: "over",
    timeScale: 1,
    params: { glyphs: "*+·", speed: 4, frequency: 0.8, width: 0.16, amount: 0.9, color: "#ffcf5a" },
  },
];

export const DEFAULT_LOADER = LOADERS[0]!.id;

export function findLoader(id: string | null): LoaderPreset {
  return LOADERS.find((l) => l.id === id) ?? LOADERS[0]!;
}

/** Box shapes a loader realistically has to survive, from an inline badge to a
 *  full-width banner. Each is rendered from the SAME params — differences on
 *  screen are the pattern re-reading at that aspect, not a re-tuned preset. */
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
