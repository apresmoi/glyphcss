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

  it("the parity check is not vacuous: a different shimmer goes red", () => {
    const { sim, t } = scene();
    expect(compare(sim, t, 0.12, 0.2).maskDiff).toBeGreaterThan(0);
  });
});
