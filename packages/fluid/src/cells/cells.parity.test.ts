// The cell decision must light the same dots in the same colours as molty's canvas
// renderer. The REAL GlyphRenderer.draw runs on a recording 2D context; every dot it fills
// is decoded back to (cell, dot, colour) and compared with computeGlyphFluidCells.
import { describe, expect, it } from "vitest";
import { GlyphRenderer } from "../../reference/molty-fluid/render.js";
import { GlyphFluidSim } from "../sim/sim";
import { applyGlyphFluidOp, configureGlyphFluidRect, stepGlyphFluidSim } from "../sim/ops";
import { computeGlyphFluidCells, createGlyphFluidCells, GLYPH_FLUID_DOTS_TO_BRAILLE } from "./cells";

const PANEL = 412;

function reference(sim: GlyphFluidSim, time: number, shimmer: number) {
  const { W, H } = sim;
  const cw = PANEL / W, ch = PANEL / H;
  const mask = new Uint8Array(W * H), rgb = new Uint32Array(W * H);
  let style = "";
  const rec = {
    setTransform() {}, save() {}, restore() {}, beginPath() {}, arc() {}, clip() {}, fillText() {},
    set fillStyle(s: string) { style = s; },
    get fillStyle() { return style; },
    fillRect(x: number, y: number, w: number, h: number) {
      if (w >= PANEL) return;
      const xc = x + w / 2, yc = y + h / 2;
      const i = Math.floor(xc / cw), j = Math.floor(yc / ch);
      const col = xc / cw - i > 0.5 ? 1 : 0;
      const row = Math.round((yc / ch - j - 0.14) / 0.24);
      const k = j * W + i;
      mask[k]! |= 1 << (col * 4 + row);
      const m = /rgb\((\d+),(\d+),(\d+)\)/.exec(style)!;
      rgb[k] = (+m[1]! << 16) | (+m[2]! << 8) | +m[3]!;
    },
  };
  const r = new GlyphRenderer({ getContext: () => rec });
  r.scale = 1;
  r.draw(sim, { ramp: " .:-=+*#%@", palette: "pastel", braille: "all", edges: 1, time, shimmer, letters: [], melt: 0 });
  return { mask, rgb };
}

function compare(sim: GlyphFluidSim, time: number, shimmer: number, portShimmer = shimmer) {
  const ref = reference(sim, time, shimmer);
  const port = computeGlyphFluidCells(sim, time, portShimmer, createGlyphFluidCells(sim.W, sim.H));
  let lit = 0, maskDiff = 0, rgbDiff = 0, features = 0;
  for (let k = 0; k < sim.N; k++) {
    const real = GLYPH_FLUID_DOTS_TO_BRAILLE[ref.mask[k]!]!;
    if (real || port.mask[k]) lit++;
    if (port.mask[k] === 0xff) features++;
    if (real !== port.mask[k]) maskDiff++;
    else if (real && ref.rgb[k] !== port.rgb[k]) rgbDiff++;
  }
  return { lit, maskDiff, rgbDiff, features };
}

/** A page fluid with a coloured blob, feature cells, an accent spot and ripples. */
function scene() {
  const sim = configureGlyphFluidRect(new GlyphFluidSim(60, 36, 8, 12.8), 8, { fieldColor: [0.43, 0.56, 0.51], fieldLevel: 0.18 });
  const totals = { lit: 0, maskDiff: 0, rgbDiff: 0, features: 0, accent: 0 };
  let t = 0;
  for (let f = 0; f < 90; f++) {
    const dt = 1 / 30;
    t += dt;
    sim.T.fill(0); sim.TF.fill(0); sim.TA.fill(0);
    for (let k = 0; k < sim.N; k++) {
      const d = Math.hypot(sim.X[k]! * 1.2, sim.Y[k]!);
      if (d < 0.5) {
        sim.T[k] = 0.9 - d;
        sim.TR[k] = 0.9; sim.TG[k] = 0.4; sim.TB[k] = 0.7;
        if (Math.abs(sim.X[k]! - 0.1) < 0.04 && Math.abs(sim.Y[k]!) < 0.08) sim.TF[k] = 1;
        if (Math.abs(sim.X[k]! + 0.2) < 0.05 && Math.abs(sim.Y[k]! - 0.2) < 0.08) sim.TA[k] = 0.8;
      }
    }
    if (f % 15 === 3) applyGlyphFluidOp(sim, ["impulse", -0.5, 0.3, 1.5, 0.06]);
    stepGlyphFluidSim(sim, { t, breath: 0.5 + 0.5 * Math.sin(t), dt, hold: Math.min(1, f / 40) });
    const c = compare(sim, t, 0.12);
    totals.lit += c.lit; totals.maskDiff += c.maskDiff; totals.rgbDiff += c.rgbDiff; totals.features += c.features;
    for (let k = 0; k < sim.N; k++) if (sim.acc[k]! > 0.02) totals.accent++;
  }
  return { sim, t, totals };
}

describe("computeGlyphFluidCells parity with molty's GlyphRenderer", () => {
  it("lights the same dots in the same colours on every frame", () => {
    const { totals } = scene();
    expect(totals.lit).toBeGreaterThan(20_000);
    expect(totals.features).toBeGreaterThan(0);
    expect(totals.accent).toBeGreaterThan(0);
    expect(totals.maskDiff).toBe(0);
    expect(totals.rgbDiff).toBe(0);
  });

  it("takes the dither mean over the stored Float32 samples (colours placed on 5-bit boundaries)", () => {
    // Each cell's red is set so its quantised value sits exactly on a 5-bit step when the
    // mean is taken over Float32-stored samples, as render.js does. A mean taken over
    // the unrounded doubles lands a hair either side and flips about half of them.
    const sim = configureGlyphFluidRect(new GlyphFluidSim(80, 50, 8, 12.8), 8, { fieldColor: [0.43, 0.56, 0.51], fieldLevel: 0.18 });
    let seed = 9;
    const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    const { W, H, view } = sim;
    for (let k = 0; k < sim.N; k++) view[k] = 0.35 + rand() * 0.1;
    const f32 = new Float32Array(1);
    for (let j = 1; j < H - 1; j++)
      for (let i = 1; i < W - 1; i++) {
        let mean = 0;
        for (let q = 0; q < 8; q++) {
          const x = i + (q >> 2 ? 0.25 : -0.25), y = j + ((q & 3) - 1.5) * 0.25;
          const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0, kk = y0 * W + x0;
          f32[0] = (view[kk]! * (1 - fx) + view[kk + 1]! * fx) * (1 - fy) + (view[kk + W]! * (1 - fx) + view[kk + W + 1]! * fx) * fy;
          mean += f32[0]!;
        }
        mean *= 0.125;
        const bt = (0.16 + (1 - 0.16) * Math.min(1, mean * 1.6)) * 1.1;
        const step = 8 * (4 + ((i + j) % 20));
        let r = Math.fround(step / (255 * bt));
        while (r * 255 * bt < step) r = Math.fround(r * (1 + 2 ** -23));
        sim.r[j * W + i] = r;
      }
    const c = compare(sim, 0, 0);
    expect(c.lit).toBeGreaterThan(3000);
    expect(c.maskDiff).toBe(0);
    expect(c.rgbDiff).toBe(0);
  });

  it("the parity check is not vacuous: a different shimmer goes red", () => {
    const { sim, t } = scene();
    expect(compare(sim, t, 0.12, 0.2).maskDiff).toBeGreaterThan(0);
  });
});
