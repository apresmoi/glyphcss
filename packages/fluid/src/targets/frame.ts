// The target frame: what the main thread composes from DOM targets each frame and hands
// to the sim, packed into ONE Float32Array so the worker path moves it by transfer.
import type { GlyphFluidSim } from "../sim/sim";

/** Packed field order. Each field is `cols × rows` floats. */
export const GLYPH_FLUID_TARGET_FIELDS = ["T", "TR", "TG", "TB", "TF", "BGM", "TA"] as const;
export type GlyphFluidTargetField = (typeof GLYPH_FLUID_TARGET_FIELDS)[number];

/** A composed target frame: views into one packed buffer. */
export interface GlyphFluidTargetFrame {
  cols: number;
  rows: number;
  packed: Float32Array;
  /** Target ink 0..1. */
  T: Float32Array;
  TR: Float32Array;
  TG: Float32Array;
  TB: Float32Array;
  /** Feature cells (e.g. eyes/mouth): drawn as a solid 8-dot block once the shape holds. */
  TF: Float32Array;
  /** Background-floor multiplier (zones). */
  BGM: Float32Array;
  /** Accent 0..1: mixes the cell toward the accent colour (the reader's ORP letter). */
  TA: Float32Array;
}

export function createGlyphFluidTargetFrame(cols: number, rows: number, packed?: Float32Array): GlyphFluidTargetFrame {
  const N = cols * rows;
  const buf = packed ?? new Float32Array(GLYPH_FLUID_TARGET_FIELDS.length * N);
  const at = (n: number) => buf.subarray(n * N, (n + 1) * N);
  return { cols, rows, packed: buf, T: at(0), TR: at(1), TG: at(2), TB: at(3), TF: at(4), BGM: at(5), TA: at(6) };
}

/**
 * Adopt a target frame into the sim. TR/TG/TB persist in the sim between frames
 * (`applyBackground` blends them in place), and a composer writes them only where it
 * also writes T > 0, so they are adopted only there: a cell no target touched keeps its
 * blended colour, exactly as if the targets had been written into the sim directly.
 */
export function unpackGlyphFluidTargets(sim: GlyphFluidSim, packed: Float32Array): void {
  const N = sim.N;
  const at = (n: number) => packed.subarray(n * N, (n + 1) * N);
  const T = at(0);
  sim.T.set(T);
  sim.TF.set(at(4));
  sim.BGM.set(at(5));
  sim.TA.set(at(6));
  const TR = at(1), TG = at(2), TB = at(3);
  for (let k = 0; k < N; k++)
    if (T[k]! > 0) {
      sim.TR[k] = TR[k]!;
      sim.TG[k] = TG[k]!;
      sim.TB[k] = TB[k]!;
    }
}
