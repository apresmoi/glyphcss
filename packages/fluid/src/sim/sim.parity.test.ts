// The TS port must step bit-identically to molty's vendored sim.js (the firmware runs the
// same algorithm as C). Seeded inputs exercise every branch: targets with colour and
// accent, impulses, pushes, swirl kicks, rotation, the osc/vibe/sheet forcings, hold.
import { describe, expect, it } from "vitest";
import { FluidSim } from "../../reference/molty-fluid/sim.js";
import { GlyphFluidSim } from "./sim";
import { applyGlyphFluidOp, configureGlyphFluidRect, type GlyphFluidOp } from "./ops";

function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

const FIELDS = [
  "h", "hp", "hn", "ink", "r", "g", "b", "acc", "u", "v", "T", "TR", "TG", "TB", "TA",
  "D", "phi", "su", "sv", "view", "speed", "fu", "fv", "BGM",
] as const;

type AnySim = GlyphFluidSim | InstanceType<typeof FluidSim>;

/** Count Float32 fields that differ BITWISE (NaN-safe, −0-safe). */
function diff(a: AnySim, b: AnySim): number {
  let n = 0;
  for (const f of FIELDS) {
    const x = new Uint32Array((a as Record<string, Float32Array>)[f]!.buffer);
    const y = new Uint32Array((b as Record<string, Float32Array>)[f]!.buffer);
    for (let k = 0; k < x.length; k++) if (x[k] !== y[k]) n++;
  }
  for (const s of ["t", "err", "energy", "swirlKick"] as const) if (!Object.is(a[s], b[s])) n++;
  return n;
}

function drive(port: AnySim, ref: AnySim, seed: number, frames: number, mutate?: (s: AnySim, f: number) => void): number {
  const rand = rng(seed);
  let worst = 0;
  for (const s of [port, ref]) {
    s.osc.amp = 0.6; s.osc.x = 0.1; s.osc.y = -0.2;
    s.vibe.amp = 0.4;
    s.sheet.amp = 0.8;
    s.rotate = 0.3;
  }
  for (let f = 0; f < frames; f++) {
    // one shared draw of this frame's inputs, applied identically to both
    const ops: GlyphFluidOp[] = [];
    if (rand() < 0.5) ops.push(["impulse", rand() * 2 - 1, rand() * 2 - 1, rand() * 2, 0.02 + rand() * 0.1]);
    if (rand() < 0.5) ops.push(["push", rand() * 2 - 1, rand() * 2 - 1, rand() * 8 - 4, rand() * 8 - 4, 0.05 + rand() * 0.2]);
    if (rand() < 0.1) ops.push(["kick", rand() * 3]);
    const N = port.N;
    const T = new Float32Array(N), TR = new Float32Array(N), TA = new Float32Array(N);
    const cx = rand() * 2 - 1, cy = rand() * 2 - 1;
    for (let k = 0; k < N; k++) {
      const d = Math.hypot(port.X[k]! - cx, port.Y[k]! - cy);
      T[k] = d < 0.4 ? 1 - d * 2 : 0;
      TR[k] = rand();
      TA[k] = d < 0.1 ? rand() : 0;
    }
    const breath = rand(), dt = 1 / 60 + rand() * 0.03, hold = Math.min(1, f / (frames / 2));
    for (const s of [port, ref]) {
      for (const op of ops) applyGlyphFluidOp(s as GlyphFluidSim, op);
      s.T.set(T); s.TR.set(TR); s.TG.set(TR.map((v) => 1 - v)); s.TB.set(TR); s.TA.set(TA);
      s.p.hold = hold;
      s.p.tintRate = 3 + 9 * hold;
      s.applyBackground(f * dt, breath);
      s.step(dt);
      s.computeView(null);
    }
    mutate?.(port, f);
    worst = Math.max(worst, diff(port, ref));
  }
  return worst;
}

describe("GlyphFluidSim parity with molty's sim.js", () => {
  it("steps the disc fluid bit for bit", () => {
    const port = new GlyphFluidSim(48, 30, 10, 16);
    const ref = new FluidSim(48, 30, 10, 16);
    expect(diff(port, ref)).toBe(0);
    expect(drive(port, ref, 1, 80)).toBe(0);
  });

  it("steps the page (rect) fluid bit for bit, including row scrolls", () => {
    const opts = { fieldColor: [0.43, 0.56, 0.51] as [number, number, number], fieldLevel: 0.18 };
    const port = configureGlyphFluidRect(new GlyphFluidSim(64, 40, 7.5, 12), 7.5, opts);
    const ref = configureGlyphFluidRect(new FluidSim(64, 40, 7.5, 12) as unknown as GlyphFluidSim, 7.5, opts);
    expect(drive(port, ref, 7, 60, (s, f) => {
      if (f % 9 === 4) {
        applyGlyphFluidOp(s as GlyphFluidSim, ["scroll", f % 2 ? 3 : -2]);
        applyGlyphFluidOp(ref, ["scroll", f % 2 ? 3 : -2]);
      }
    })).toBe(0);
  });

  it("the parity check is not vacuous: a 1e-6 relative tuning change goes red", () => {
    const port = new GlyphFluidSim(48, 30, 10, 16);
    const ref = new FluidSim(48, 30, 10, 16);
    // (one double ulp is lost to Float32 storage; 1e-6 is about the smallest change it keeps)
    port.p.damp = 0.975 * (1 + 1e-6);
    expect(drive(port, ref, 1, 20)).toBeGreaterThan(0);
  });
});
