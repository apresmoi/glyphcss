import { combineSynth, synthWave } from "@glyphcss/effects";
import { type Params } from "./parameters";
import { MAX_VOICES } from "./urlState";

// A field-synth patch's output depends on `time` ONLY through each active
// voice's own `speed` (see fieldProgram.ts's `synthWave`/SDF-oracle `c =
// phase - speed*time` derivation — no other param reads raw time). So a
// patch where every voice with `amp > 0` also has `speed === 0` renders the
// SAME output at every `time` value: driving `time` forward for such a
// patch buys nothing and only pays for a wasted effect recompute every
// frame (perf packet: a static SDF/carve patch with every `speedN` left at
// its schema default of `0` is exactly this case). Layers have no
// time-varying knob of their own, so checking every voice slot regardless
// of layer assignment is sufficient.
export function isTimeInvariantPatch(params: Params): boolean {
  for (let k = 1; k <= MAX_VOICES; k++) {
    if (Number(params[`amp${k}`] ?? 0) > 0 && Number(params[`speed${k}`] ?? 0) !== 0) return false;
  }
  return true;
}

// A preset's `STAGE_HINTS.loopSeconds` (for a one-way animation arc, like a
// `wave: "step"` SDF voice's erosion) wraps the monotonically-accumulated
// tick clock back into a repeating cycle instead of letting the driven
// `time` grow forever — see `SynthStageHint.loopSeconds`'s own doc.
// `((t % p) + p) % p`, not a bare
// `t % p`: JS `%` is remainder (sign-preserving), not mathematical modulo,
// so a bare `t % p` would return a negative value for negative `t` — `t`
// only grows in practice (the tick loop's own accumulator), but this stays
// correct regardless. `loopSeconds` absent/undefined/non-positive is a
// no-op (today's plain monotonic `time`, byte-identical).
export function wrapDrivenTime(t: number, loopSeconds: number | null | undefined): number {
  if (!loopSeconds || loopSeconds <= 0) return t;
  return ((t % loopSeconds) + loopSeconds) % loopSeconds;
}

/**
 * SynthWorkbench's per-frame tick has two independent jobs: advance/push the
 * field-synth `time` param (mesh spin — gated by `paused`/`timeScale` and,
 * since `isTimeInvariantPatch` above, by whether the current patch actually
 * reads time), and step the camera auto-orbit (gated by `orbitAuto`, a flat
 * stage having no orbit, and an in-progress drag). These two must stay
 * decidable independently: orbiting rotates the CAMERA, which forces
 * `scene.rerender()` to re-rasterize and re-evaluate the effect regardless of
 * `time`, so a time-invariant patch (e.g. the shipped "Sierpinski pyramid"
 * preset, every `speedN: 0`) still needs to visibly orbit even though its own `time`
 * advance is skipped for perf. Folding both branches under one shared guard
 * — e.g. nesting the orbit step inside the `!isTimeInvariantPatch` check —
 * would silently freeze auto-orbit for every time-invariant preset. Kept as
 * one pure function (not two inline `if`s in the tick loop) specifically so
 * that coupling is a change to THIS function's shape, not something a future
 * tick-loop edit can reintroduce unnoticed; `SynthWorkbench.tsx`'s tick calls
 * this once per frame and reads both fields off the single returned plan.
 */
export function computeSynthTickPlan(input: {
  paused: boolean;
  timeScale: number;
  params: Params;
  flat: boolean;
  orbitAuto: boolean;
  orbitDragging: boolean;
}): { advanceTime: boolean; orbit: boolean } {
  return {
    advanceTime: !input.paused && input.timeScale !== 0 && !isTimeInvariantPatch(input.params),
    orbit: !input.flat && input.orbitAuto && !input.orbitDragging,
  };
}

// ── Waveform trendlines (per-voice + combined) ────────────────────────────────
// Read the voice params as a literal 1D read of the same shape+phase math the
// field synth evaluates spatially: `raw*freq - time*speed` fed through
// `synthWave`, with `raw` swept 0..1 across the plot (a "linearX"-style read —
// `field` itself only has meaning in 2D, so it isn't part of this projection).
export const WAVE_SAMPLES = 72;

// `step` (VOLUMETRIC-2.md §2) is non-periodic: its argument sweep must not
// scale with `freq` the way every periodic wave's does (`raw * freq`, which
// shows exactly `freq` cycles across the plot). A `0..1` sweep puts the
// argument's zero crossing — the only place a non-periodic wave's edge is
// visible at all — at `raw = -(-time*speed+phase)/freq`, which sits AT or
// OUTSIDE the window's edge for every default (time 0, phase 0, freq > 0:
// crossing at raw 0 exactly), previewing as a constant line rather than a
// step. A symmetric window centered on 0 keeps the crossing near the middle
// of the plot for the common case instead.
function isNonPeriodicWave(wave: string): boolean {
  return wave === "step";
}

export function buildWavePathD(
  wave: string,
  freq: number,
  speed: number,
  amp: number,
  time: number,
  width: number,
  height: number,
  duty = 0.5,
  phase = 0,
): string {
  const midY = height / 2;
  const halfH = midY - 2;
  const nonPeriodic = isNonPeriodicWave(wave);
  let d = "";
  for (let i = 0; i < WAVE_SAMPLES; i++) {
    const t = i / (WAVE_SAMPLES - 1); // 0..1, always the ON-SCREEN sweep fraction
    const raw = nonPeriodic ? t - 0.5 : t; // symmetric -0.5..0.5 window for non-periodic waves
    const value = amp * synthWave(wave, raw * freq - time * speed + phase, duty);
    const x = t * width;
    const y = midY - value * halfH;
    d += `${i === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)} `;
  }
  return d;
}

export interface CombinedVoice {
  readonly wave: string;
  readonly freq: number;
  readonly speed: number;
  readonly amp: number;
  /** Default 0.5/0 — byte-identical to a voice that never set them. */
  readonly duty?: number;
  readonly phase?: number;
}

// Folds active voices exactly like `fieldSynth`'s evaluate loop: each oscillator
// samples at amp=1 (`synthOsc`'s own amp is fixed to 1 there), the first active
// voice enters at its mix weight, and every later voice blends the running result
// toward `combineSynth(mode, result, voice)` by its weight — so two close
// frequencies visibly beat instead of just averaging out.
export function buildCombinedPathD(
  voices: readonly CombinedVoice[],
  combineMode: string,
  time: number,
  width: number,
  height: number,
): string {
  const midY = height / 2;
  const halfH = midY - 3;
  const range = 1.5; // headroom past ±1 for `add`/`difference` without clipping the common multiply/max/min case
  let d = "";
  for (let i = 0; i < WAVE_SAMPLES; i++) {
    const raw = i / (WAVE_SAMPLES - 1);
    let combined = 0;
    let active = 0;
    for (const voice of voices) {
      const o = synthWave(voice.wave, raw * voice.freq - time * voice.speed + (voice.phase ?? 0), voice.duty ?? 0.5);
      if (active === 0) combined = voice.amp * o;
      else combined += voice.amp * (combineSynth(combineMode, combined, o) - combined);
      active++;
    }
    const clamped = Math.max(-range, Math.min(range, combined));
    const x = raw * width;
    const y = midY - (clamped / range) * halfH;
    d += `${i === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)} `;
  }
  return d;
}
