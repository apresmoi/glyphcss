// TypeScript port of molty's fluid (`reference/molty-fluid/sim.js`, molty-site f2a9ef9).
// The same step runs as C on molty's firmware, so this file is a transliteration, not a
// rewrite: same fields, same loop order, same arithmetic order. `sim.parity.test.ts`
// steps both on seeded inputs and requires every Float32 field to match bit for bit.
//
// Per cell (W×H, Float32Array each):
//   h, hp        wave height + previous (2D wave equation → ripples, rings, sheets)
//   ink          density 0..1
//   r, g, b      colour carried WITH the ink (advected)
//   acc          accent carried with the ink
//   u, v         inertial flow velocity (x-cell units / s)
// Per step: wave → demand potential → inertial flow + curl-noise eddies → semi-Lagrangian
// advection → relax toward the target. Every y-derivative carries the cell aspect
// A = cellH / cellW so ripples and eddies are round on screen.
import { noise3 } from "./noise";

/** Sim tunables; the firmware port reads these as `#define`s. */
export interface GlyphFluidTuning {
  /** Wave speed². */
  c2: number;
  /** Wave velocity damping. */
  damp: number;
  /** Wave height leak. */
  leak: number;
  /** Demand-flow gain. */
  attract: number;
  /** Flow drag (1/s). */
  drag: number;
  /** Speed cap (cells/s). */
  vmax: number;
  relaxUp: number;
  relaxDown: number;
  tintRate: number;
  /** Ambient eddy strength. */
  swirl: number;
  swirlFreq: number;
  /** Ripple refraction in the view. */
  refr: number;
  /** Crest highlight in the view. */
  crest: number;
  speedMul: number;
  /** 0 → 1 once a transition has had time to flow; crystallises the shape. */
  hold: number;
  /** The dim background fluid: an ink floor everywhere. */
  bgLevel: number;
  bgFreq: number;
  bgDrift: number;
  bgSpeed: number;
  bgRim: number;
  bgMob: number;
  bgColor: [number, number, number];
}

/** molty's `SIM_TUNING`, verbatim. */
export const GLYPH_FLUID_SIM_TUNING: Readonly<GlyphFluidTuning> = Object.freeze({
  c2: 0.11, damp: 0.975, leak: 0.985,
  attract: 70, drag: 2.6, vmax: 30,
  relaxUp: 1.1, relaxDown: 1.8, tintRate: 3,
  swirl: 0.7, swirlFreq: 1.6,
  refr: 1.1, crest: 0.55,
  speedMul: 1, hold: 0,
  bgLevel: 0.2, bgFreq: 2.3, bgDrift: 0.05, bgSpeed: 0.12, bgRim: 0.78, bgMob: 0.45,
  bgColor: [0.52, 0.58, 0.86] as [number, number, number],
});

/**
 * The fluid state and its fixed step. Constructed as molty's round disc (the device
 * screen); {@link configureGlyphFluidRect} reshapes it into the full-rectangle page fluid.
 */
export class GlyphFluidSim {
  readonly W: number;
  readonly H: number;
  readonly N: number;
  /** Cell aspect, cellH / cellW. */
  readonly A: number;
  h: Float32Array; hp: Float32Array; hn: Float32Array;
  ink: Float32Array; r: Float32Array; g: Float32Array; b: Float32Array; acc: Float32Array;
  u: Float32Array; v: Float32Array;
  T: Float32Array; TR: Float32Array; TG: Float32Array; TB: Float32Array; TA: Float32Array;
  TE: Float32Array; TEX: Float32Array; TEY: Float32Array; TF: Float32Array;
  D: Float32Array; phi: Float32Array; tmp: Float32Array; su: Float32Array; sv: Float32Array;
  ink2: Float32Array; r2: Float32Array; g2: Float32Array; b2: Float32Array; acc2: Float32Array;
  view: Float32Array; speed: Float32Array; fu: Float32Array; fv: Float32Array;
  X: Float32Array; Y: Float32Array; mask: Uint8Array; sponge: Float32Array; BGM: Float32Array; rim: Float32Array;
  inside: number;
  p: GlyphFluidTuning;
  /** Decaying extra eddy strength (transitions). */
  swirlKick = 0;
  /** Solid-body rotation. */
  rotate = 0;
  osc = { amp: 0, freq: 4, x: 0, y: 0, phase: 0 };
  vibe = { amp: 0, freq: 9, phase: 0 };
  sheet = { amp: 0, freq: 1.5, phase: 0 };
  /** > 0 while a target supplies feature cells (creature eyes/mouth). */
  edgeW = 0;
  t = 0;
  err = 1;
  energy = 0;

  constructor(W: number, H: number, cellW: number, cellH: number) {
    this.W = W; this.H = H; this.N = W * H; this.A = cellH / cellW;
    const N = this.N, F = () => new Float32Array(N);
    this.h = F(); this.hp = F(); this.hn = F(); this.ink = F(); this.r = F(); this.g = F(); this.b = F(); this.acc = F(); this.u = F(); this.v = F();
    this.T = F(); this.TR = F(); this.TG = F(); this.TB = F(); this.TA = F(); this.TE = F(); this.TEX = F(); this.TEY = F(); this.TF = F();
    this.D = F(); this.phi = F(); this.tmp = F(); this.su = F(); this.sv = F();
    this.ink2 = F(); this.r2 = F(); this.g2 = F(); this.b2 = F(); this.acc2 = F();
    this.view = F(); this.speed = F(); this.fu = F(); this.fv = F();
    this.X = F(); this.Y = F(); this.mask = new Uint8Array(N); this.sponge = F(); this.BGM = F(); this.rim = F();
    let inside = 0;
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const k = j * W + i, x = ((i + 0.5) / W) * 2 - 1, y = ((j + 0.5) / H) * 2 - 1;
      this.X[k] = x; this.Y[k] = y;
      this.sponge[k] = Math.max(0, (Math.hypot(x, y) - 0.86) / 0.14);
      if (x * x + y * y <= 1 && i > 0 && j > 0 && i < W - 1 && j < H - 1) { this.mask[k] = 1; inside++; }
    }
    this.inside = inside;
    this.BGM.fill(1);
    for (let k = 0; k < N; k++) {
      const rr = Math.hypot(this.X[k]!, this.Y[k]!);
      this.rim[k] = rr < GLYPH_FLUID_SIM_TUNING.bgRim ? 1 : Math.max(0, 1 - (rr - GLYPH_FLUID_SIM_TUNING.bgRim) / (1 - GLYPH_FLUID_SIM_TUNING.bgRim)) ** 2;
    }
    this.r.fill(0.6); this.g.fill(0.6); this.b.fill(0.6);
    this.p = { ...GLYPH_FLUID_SIM_TUNING, bgColor: [...GLYPH_FLUID_SIM_TUNING.bgColor] as [number, number, number] };
  }

  /** Gaussian bump in the height field. x, y in −1..1 stage space; radius in stage units. */
  impulse(x: number, y: number, strength = 1, radius = 0.12): void {
    const { W, H } = this;
    const ci = ((x + 1) / 2) * W, cj = ((y + 1) / 2) * H;
    const ri = Math.ceil(radius * W), rj = Math.ceil(radius * H);
    for (let j = Math.max(1, Math.floor(cj - rj)); j < Math.min(H - 1, Math.ceil(cj + rj)); j++) {
      for (let i = Math.max(1, Math.floor(ci - ri)); i < Math.min(W - 1, Math.ceil(ci + ri)); i++) {
        const k = j * W + i; if (!this.mask[k]) continue;
        const dx = this.X[k]! - x, dy = this.Y[k]! - y, d2 = (dx * dx + dy * dy) / (radius * radius);
        if (d2 < 4) this.h[k]! += strength * Math.exp(-d2 * 2);
      }
    }
  }

  /** Push the flow around (x, y) in stage space. */
  push(x: number, y: number, du: number, dv: number, radius = 0.18): void {
    const { N } = this;
    for (let k = 0; k < N; k++) {
      if (!this.mask[k]) continue;
      const dx = this.X[k]! - x, dy = this.Y[k]! - y, w = Math.exp(-(dx * dx + dy * dy) / (radius * radius));
      if (w > 0.02) { this.u[k]! += du * w; this.v[k]! += dv * w; }
    }
  }

  /** Raise the target to the dim background floor everywhere (call after a target fill). */
  applyBackground(t: number, breath: number): void {
    const { N, p, mask, X, Y, T, TR, TG, TB, TA, BGM, rim } = this;
    const lv = p.bgLevel * (0.6 + 0.4 * breath), f = p.bgFreq, c = p.bgColor;
    for (let k = 0; k < N; k++) {
      if (!mask[k]) continue;
      const n = noise3(X[k]! * f + t * p.bgDrift, Y[k]! * f * 1.4, t * p.bgSpeed);
      const bg = lv * (0.3 + 0.7 * n * n * 1.6) * rim[k]! * BGM[k]!;
      if (T[k]! < bg) {
        const w = T[k]! < 0.02 ? 1 : 1 - T[k]! / bg;
        T[k] = bg; TR[k]! += (c[0] - TR[k]!) * w; TG[k]! += (c[1] - TG[k]!) * w; TB[k]! += (c[2] - TB[k]!) * w; TA[k]! *= 1 - w;
      }
    }
  }

  step(dt: number): void {
    const { W, H, N, A, p, mask } = this;
    this.t += dt;
    const t = this.t, sp = p.speedMul;

    // ---- 1. wave equation (+ forcing) ----
    const h = this.h, hp = this.hp, hn = this.hn, cy = p.c2 / (A * A);
    this.osc.phase += dt * this.osc.freq; this.vibe.phase += dt * this.vibe.freq; this.sheet.phase += dt * this.sheet.freq;
    const oscV = this.osc.amp * Math.sin(this.osc.phase * 6.2832);
    const vibV = this.vibe.amp * Math.sin(this.vibe.phase * 6.2832);
    const shV = this.sheet.amp * Math.sin(this.sheet.phase * 6.2832);
    const ox = this.osc.x, oy = this.osc.y;
    for (let j = 1; j < H - 1; j++) for (let i = 1; i < W - 1; i++) {
      const k = j * W + i;
      if (!mask[k]) { hn[k] = 0; continue; }
      const c = h[k]!;
      let n = (c + (c - hp[k]!) * p.damp * (1 - 0.15 * this.sponge[k]!) + p.c2 * (h[k - 1]! + h[k + 1]! - 2 * c) + cy * (h[k - W]! + h[k + W]! - 2 * c)) * p.leak;
      if (oscV !== 0) { const dx = this.X[k]! - ox, dy = this.Y[k]! - oy; const d2 = dx * dx + dy * dy; if (d2 < 0.012) n += oscV * (1 - d2 / 0.012) * 0.35; }
      if (vibV !== 0) n += vibV * 0.02 * (this.ink[k]! + 0.15) * ((i + j) & 1 ? 1 : -1);
      if (shV !== 0 && this.Y[k]! < -0.82) n += shV * 0.25;
      hn[k] = n;
    }
    this.hp = h; this.h = hn; this.hn = hp;

    // ---- 2. demand potential φ = blur(T − ink) at two scales ----
    const D = this.D, phi = this.phi, ink = this.ink, T = this.T;
    for (let k = 0; k < N; k++) D[k] = mask[k] ? T[k]! - ink[k]! : 0;
    boxBlur(D, phi, this.tmp, W, H, 2, Math.max(1, Math.round(2 / A)));
    const big = this.su;
    boxBlur(D, big, this.tmp, W, H, 7, Math.max(1, Math.round(7 / A)));
    // mobility: where the ink already matches its target the fluid HOLDS (no advection →
    // no numerical diffusion → cell-sharp detail survives); elsewhere it flows.
    const kickMob = Math.min(1, this.swirlKick * 0.12);
    for (let k = 0; k < N; k++) {
      let m = Math.abs(phi[k]!) * 9 * (1 - 0.8 * p.hold) + kickMob;
      if (ink[k]! < 0.3 && m < p.bgMob) m = p.bgMob;
      D[k] = m > 1 ? 1 : m;
      phi[k] = 0.5 * phi[k]! + 0.9 * big[k]!;
    }

    // ---- 3+4. inertial flow toward demand + curl-noise eddies ----
    const u = this.u, v = this.v, su = this.su, sv = this.sv;
    const drag = Math.exp(-p.drag * dt), ka = p.attract * (1.6 - 0.8 * p.hold) * sp * dt;
    const swAmp = (p.swirl + this.swirlKick) * sp, f = p.swirlFreq, tz = t * 0.35;
    this.swirlKick *= Math.exp(-dt * 1.8);
    const psi = this.tmp;
    for (let k = 0; k < N; k++) psi[k] = noise3(this.X[k]! * f * 2 + 7.3, this.Y[k]! * f * 2, tz);
    let vsum = 0;
    for (let j = 1; j < H - 1; j++) for (let i = 1; i < W - 1; i++) {
      const k = j * W + i;
      if (!mask[k]) { u[k] = v[k] = su[k] = sv[k] = 0; continue; }
      const gx = (phi[k + 1]! - phi[k - 1]!) * 0.5, gy = (phi[k + W]! - phi[k - W]!) * 0.5 / A;
      let uu = (u[k]! + ka * gx * 0.5 * W) * drag, vv = (v[k]! + ka * gy * 0.5 * W) * drag;
      const m = Math.hypot(uu, vv); if (m > p.vmax) { uu *= p.vmax / m; vv *= p.vmax / m; }
      u[k] = uu; v[k] = vv;
      su[k] = (psi[k + W]! - psi[k - W]!) * 0.5 / A * swAmp * 10 + this.rotate * -this.Y[k]! * W * 0.5;
      sv[k] = -(psi[k + 1]! - psi[k - 1]!) * 0.5 * swAmp * 10 + this.rotate * this.X[k]! * W * 0.5;
      vsum += Math.abs(uu) + Math.abs(vv);
    }

    // ---- 5. semi-Lagrangian advection of ink + carried colour ----
    const r = this.r, g = this.g, b = this.b, acc = this.acc;
    const i2 = this.ink2, r2 = this.r2, g2 = this.g2, b2 = this.b2, a2 = this.acc2, fu = this.fu, fv = this.fv, spd = this.speed;
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const k = j * W + i;
      if (!mask[k]) { i2[k] = 0; spd[k] = 0; continue; }
      const mob = D[k]!, wu = (u[k]! + su[k]!) * mob, wv = (v[k]! + sv[k]!) * mob;
      fu[k] = wu; fv[k] = wv; spd[k] = Math.hypot(wu, wv);
      let x = i - wu * dt, y = j - (wv * dt) / A;
      x = x < 0 ? 0 : x > W - 1.001 ? W - 1.001 : x; y = y < 0 ? 0 : y > H - 1.001 ? H - 1.001 : y;
      const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0, k0 = y0 * W + x0;
      const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
      i2[k] = ink[k0]! * w00 + ink[k0 + 1]! * w10 + ink[k0 + W]! * w01 + ink[k0 + W + 1]! * w11;
      r2[k] = r[k0]! * w00 + r[k0 + 1]! * w10 + r[k0 + W]! * w01 + r[k0 + W + 1]! * w11;
      g2[k] = g[k0]! * w00 + g[k0 + 1]! * w10 + g[k0 + W]! * w01 + g[k0 + W + 1]! * w11;
      b2[k] = b[k0]! * w00 + b[k0 + 1]! * w10 + b[k0 + W]! * w01 + b[k0 + W + 1]! * w11;
      a2[k] = acc[k0]! * w00 + acc[k0 + 1]! * w10 + acc[k0 + W]! * w01 + acc[k0 + W + 1]! * w11;
    }

    // ---- 6. relax toward the target (what the flow did not deliver) ----
    const hm = 0.4 + 4.6 * p.hold;
    const up = 1 - Math.exp(-p.relaxUp * hm * sp * dt), down = 1 - Math.exp(-p.relaxDown * hm * sp * dt);
    const tr = 1 - Math.exp(-p.tintRate * sp * dt);
    let err = 0, hs = 0;
    for (let k = 0; k < N; k++) {
      if (!mask[k]) { ink[k] = 0; continue; }
      let d = i2[k]!; const tk = T[k]!;
      d += (tk - d) * (tk > d ? up : down);
      ink[k] = d < 0 ? 0 : d > 1 ? 1 : d;
      const wt = tr * (0.25 + tk);
      r[k] = r2[k]! + (this.TR[k]! - r2[k]!) * wt; g[k] = g2[k]! + (this.TG[k]! - g2[k]!) * wt; b[k] = b2[k]! + (this.TB[k]! - b2[k]!) * wt;
      acc[k] = a2[k]! + (this.TA[k]! - a2[k]!) * Math.min(1, wt * 1.5);
      err += Math.abs(tk - ink[k]!); hs += Math.abs(this.h[k]!);
    }
    this.err = err / this.inside;
    this.energy = Math.min(1, hs / this.inside * 3 + vsum / this.inside / 25 + this.swirlKick * 0.05);
  }

  /** What the screen shows: ink refracted by the wave slope, plus a crest highlight. */
  computeView(ambient: Float32Array | null): void {
    const { W, H, A, p, mask, ink } = this, h = this.h, view = this.view;
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const k = j * W + i;
      if (!mask[k] || i === 0 || j === 0 || i === W - 1 || j === H - 1) { view[k] = 0; continue; }
      const gx = (h[k + 1]! - h[k - 1]!) * 0.5, gy = (h[k + W]! - h[k - W]!) * 0.5;
      let x = i + gx * p.refr * 6, y = j + (gy * p.refr * 6) / A;
      x = x < 0 ? 0 : x > W - 1.001 ? W - 1.001 : x; y = y < 0 ? 0 : y > H - 1.001 ? H - 1.001 : y;
      const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0, k0 = y0 * W + x0;
      const s = (ink[k0]! * (1 - fx) + ink[k0 + 1]! * fx) * (1 - fy) + (ink[k0 + W]! * (1 - fx) + ink[k0 + W + 1]! * fx) * fy;
      const hc = h[k]!;
      const val = s * (1 + 0.9 * hc) + p.crest * Math.max(0, hc) * 0.55 + (ambient ? ambient[k]! : 0);
      view[k] = val < 0 ? 0 : val > 1 ? 1 : val;
    }
  }
}

// separable box blur, radius rx (columns) × ry (rows), running sums: O(N) per pass
function boxBlur(src: Float32Array, dst: Float32Array, tmp: Float32Array, W: number, H: number, rx: number, ry: number): void {
  for (let j = 0; j < H; j++) {
    const o = j * W; let s = 0, n = 0;
    for (let i = 0; i < Math.min(W, rx + 1); i++) { s += src[o + i]!; n++; }
    for (let i = 0; i < W; i++) {
      tmp[o + i] = s / n;
      const a = i + rx + 1, d = i - rx;
      if (a < W) { s += src[o + a]!; n++; }
      if (d >= 0) { s -= src[o + d]!; n--; }
    }
  }
  for (let i = 0; i < W; i++) {
    let s = 0, n = 0;
    for (let j = 0; j < Math.min(H, ry + 1); j++) { s += tmp[j * W + i]!; n++; }
    for (let j = 0; j < H; j++) {
      dst[j * W + i] = s / n;
      const a = j + ry + 1, d = j - ry;
      if (a < H) { s += tmp[a * W + i]!; n++; }
      if (d >= 0) { s -= tmp[d * W + i]!; n--; }
    }
  }
}
