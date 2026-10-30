// Everything a host does to sim STATE outside `step()`, as data. The runtime queues these
// in call order and the step applies them first, so the worker and the main-thread path
// see the same writes in the same order.
import { GlyphFluidSim } from "./sim";

export type RGB = [number, number, number];

/** A queued sim write. Coordinates are stage space (−1..1). */
export type GlyphFluidOp =
  | ["impulse", number, number, number, number]
  | ["push", number, number, number, number, number]
  | ["kick", number]
  | ["scroll", number];

export interface GlyphFluidRectOptions {
  /** Field colour, 0..1 per channel: the dim floor's hue and what scrolled-in rows start as. */
  fieldColor: RGB;
  /** Background floor level. */
  fieldLevel: number;
}

/**
 * Reshape a disc sim into a full-rectangle page fluid: every cell but the
 * one-cell border is inside, the sponge is a 3-cell edge band and there is no rim fade.
 * Noise frequencies scale with the grid's CSS width (≥ 1) so eddies keep their on-screen
 * size on wide screens, exactly as the landing page does.
 */
export function configureGlyphFluidRect(sim: GlyphFluidSim, cellW: number, opts: GlyphFluidRectOptions): GlyphFluidSim {
  const { W, H } = sim;
  let inside = 0;
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++) {
      const k = j * W + i,
        d = Math.min(i, W - 1 - i, j, H - 1 - j);
      sim.mask[k] = d > 0 ? 1 : 0;
      inside += sim.mask[k]!;
      sim.sponge[k] = Math.max(0, 1 - d / 3);
    }
  sim.rim.fill(1);
  sim.inside = inside;
  return configureGlyphFluidDisc(sim, cellW, opts);
}

/**
 * Keep the constructor's disc (a circular surface: the circle inscribed in the
 * grid in stage space, its sponge and rim fade) and give it the page fluid's field
 * colour, level, noise scale and relax rates. The rect shape applies the same field.
 */
export function configureGlyphFluidDisc(sim: GlyphFluidSim, cellW: number, opts: GlyphFluidRectOptions): GlyphFluidSim {
  const { W } = sim;
  sim.p.bgColor = [...opts.fieldColor];
  sim.p.bgLevel = opts.fieldLevel;
  const zoom = Math.max(1, ((W * cellW) / 412) * 0.6);
  sim.p.bgFreq *= zoom;
  sim.p.swirlFreq *= zoom;
  sim.p.relaxUp = 3;
  sim.p.relaxDown = 2.4;
  sim.edgeW = 1;
  sim.r.fill(opts.fieldColor[0]);
  sim.g.fill(opts.fieldColor[1]);
  sim.b.fill(opts.fieldColor[2]);
  return sim;
}

export function applyGlyphFluidOp(sim: GlyphFluidSim, op: GlyphFluidOp): void {
  switch (op[0]) {
    case "impulse":
      return sim.impulse(op[1], op[2], op[3], op[4]);
    case "push":
      return sim.push(op[1], op[2], op[3], op[4], op[5]);
    case "kick":
      sim.swirlKick = Math.max(sim.swirlKick, op[1]);
      return;
    case "scroll": {
      // Content moved by whole rows: shift the state with it; rows scrolled in start as
      // still, empty field-coloured fluid.
      const d = op[1],
        { W, H, N } = sim,
        c = sim.p.bgColor;
      const fields: Array<[Float32Array, number]> = [
        [sim.h, 0], [sim.hp, 0], [sim.ink, 0], [sim.acc, 0], [sim.u, 0], [sim.v, 0], [sim.r, c[0]], [sim.g, c[1]], [sim.b, c[2]],
      ];
      for (const [a, fill] of fields) {
        if (Math.abs(d) >= H) a.fill(fill);
        else if (d > 0) {
          a.copyWithin(0, d * W);
          a.fill(fill, (H - d) * W, N);
        } else {
          a.copyWithin(-d * W, 0, (H + d) * W);
          a.fill(fill, 0, -d * W);
        }
      }
    }
  }
}

/** Per-frame step parameters chosen by the clock owner. */
export interface GlyphFluidStepParams {
  /** Seconds since the fluid started. */
  t: number;
  /** 0..1 breathing phase of the background floor. */
  breath: number;
  dt: number;
  /** 0..1, ramps up ~0.4 s after the last target transition. */
  hold: number;
}

/** Background, step and view for one frame (the cell decision follows). */
export function stepGlyphFluidSim(sim: GlyphFluidSim, s: GlyphFluidStepParams): void {
  sim.p.hold = s.hold;
  sim.p.tintRate = 3 + 9 * s.hold;
  sim.applyBackground(s.t, s.breath);
  sim.step(Math.min(s.dt, 1 / 30));
  sim.computeView(null);
}
