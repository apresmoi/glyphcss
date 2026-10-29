// The fluid. ONE per-cell state for the whole round screen; every visible thing is a
// TARGET the state relaxes toward, so a transition is the same physics as a ripple.
//
// Per cell (W×H, Float32Array each):
//   h, hp        wave height + previous (2D wave equation → ripples, rings, sheets)
//   ink          density 0..1 — what the glyph ramp shows
//   r, g, b      colour carried WITH the ink (advected, so colours flow too)
//   acc          accent (ORP letter, eye shine) carried with the ink
//   u, v         inertial flow velocity (x-cell units / s)
//
// Per fixed step (60 Hz; the device would run the same step at 30 Hz with dt doubled):
//   1. wave:    h' = (2h − hp + c²·∇²h)·damp + forcing             (Dirichlet 0 outside the disc)
//   2. demand:  D = T − ink; φ = ½·box₂(D) + ½·box₇(D)             (two separable running-sum blurs)
//   3. flow:    (u,v) += k·∇φ·dt; (u,v) ·= drag                     (ink accelerates toward deficit,
//                                                                    carries momentum → overshoot)
//   4. swirl:   s = curl(noise3(x·f, y·f, t))·amp                   (eddies; amp spikes on transitions)
//   5. advect:  semi-Lagrangian backtrace of ink/r/g/b/acc by (u,v)+s
//   6. relax:   ink += (T − ink)·(1 − e^(−k·dt))                    (cleans up what the flow left)
//   view:       sample ink at x + refr·∇h (ripples REFRACT the image) + crest highlight
//
// Cells are not square (monospace ≈ 0.6 em wide), so every y-derivative / y-displacement
// carries the cell aspect A = cellH/cellW so ripples and eddies are round on screen.

import { noise3 } from './synth.js';

// ---- tunables (the firmware port reads these as #defines) ----
export const SIM_TUNING = {
  c2: 0.11, damp: 0.975, leak: 0.985,        // wave speed², velocity damping, height leak
  attract: 70, drag: 2.6, vmax: 30,          // demand-flow gain, flow drag (1/s), speed cap (cells/s)
  relaxUp: 1.1, relaxDown: 1.8, tintRate: 3, // per-state values are set by main.js
  swirl: 0.7, swirlFreq: 1.6,                // ambient eddies
  refr: 1.1, crest: 0.55,                    // ripple refraction + crest highlight in the view
  speedMul: 1, hold: 0,
  // the dim background fluid: an ink floor in EVERY state, so the whole disc is always fluid
  bgLevel: 0.2, bgFreq: 2.3, bgDrift: 0.05, bgSpeed: 0.12, bgRim: 0.78, bgMob: 0.45,
  bgColor: [0.52, 0.58, 0.86],
};

export class FluidSim {
  constructor(W, H, cellW, cellH) {
    this.W = W; this.H = H; this.N = W * H; this.A = cellH / cellW;
    const N = this.N, F = () => new Float32Array(N);
    Object.assign(this, {
      h: F(), hp: F(), hn: F(), ink: F(), r: F(), g: F(), b: F(), acc: F(), u: F(), v: F(),
      T: F(), TR: F(), TG: F(), TB: F(), TA: F(), TE: F(), TEX: F(), TEY: F(), TF: F(),
      D: F(), phi: F(), tmp: F(), su: F(), sv: F(),
      ink2: F(), r2: F(), g2: F(), b2: F(), acc2: F(),
      view: F(), speed: F(), fu: F(), fv: F(),
      X: F(), Y: F(), mask: new Uint8Array(N), sponge: F(), BGM: F(), rim: F(),
    });
    let inside = 0;
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const k = j * W + i, x = ((i + 0.5) / W) * 2 - 1, y = ((j + 0.5) / H) * 2 - 1;
      this.X[k] = x; this.Y[k] = y;
      this.sponge[k] = Math.max(0, (Math.hypot(x, y) - 0.86) / 0.14); // absorbing rim: ripples fade out instead of ringing
      if (x * x + y * y <= 1 && i > 0 && j > 0 && i < W - 1 && j < H - 1) { this.mask[k] = 1; inside++; }
    }
    this.inside = inside;
    this.BGM.fill(1); // per-cell background multiplier (text darkens it softly around the word)
    for (let k = 0; k < N; k++) { const rr = Math.hypot(this.X[k], this.Y[k]); this.rim[k] = rr < SIM_TUNING.bgRim ? 1 : Math.max(0, 1 - (rr - SIM_TUNING.bgRim) / (1 - SIM_TUNING.bgRim)) ** 2; }
    this.r.fill(0.6); this.g.fill(0.6); this.b.fill(0.6);
    // tunables (main.js wires the UI to these)
    this.p = { ...SIM_TUNING };
    this.swirlKick = 0;   // decaying extra eddy strength (transitions)
    this.rotate = 0;      // solid-body rotation (vortex interlude)
    this.osc = { amp: 0, freq: 4, x: 0, y: 0, phase: 0 };  // audio-driven point oscillator
    this.vibe = { amp: 0, freq: 9, phase: 0 };              // global shimmer (motor / thinking hum)
    this.sheet = { amp: 0, freq: 1.5, phase: 0 };           // plane wave from the top rim
    this.edgeW = 0;       // >0 while the target supplies an ink-contour field (creature)
    this.t = 0; this.err = 1; this.energy = 0;
  }

  /** Gaussian bump in the height field. x, y in −1..1 stage space; radius in stage units. */
  impulse(x, y, strength = 1, radius = 0.12) {
    const { W, H } = this;
    const ci = ((x + 1) / 2) * W, cj = ((y + 1) / 2) * H;
    const ri = Math.ceil(radius * W), rj = Math.ceil(radius * H);
    for (let j = Math.max(1, Math.floor(cj - rj)); j < Math.min(H - 1, Math.ceil(cj + rj)); j++) {
      for (let i = Math.max(1, Math.floor(ci - ri)); i < Math.min(W - 1, Math.ceil(ci + ri)); i++) {
        const k = j * W + i; if (!this.mask[k]) continue;
        const dx = this.X[k] - x, dy = this.Y[k] - y, d2 = (dx * dx + dy * dy) / (radius * radius);
        if (d2 < 4) this.h[k] += strength * Math.exp(-d2 * 2);
      }
    }
  }

  /** Push the flow: a swirl kick around (x, y), e.g. a drag on the stage. */
  push(x, y, du, dv, radius = 0.18) {
    const { N } = this;
    for (let k = 0; k < N; k++) {
      if (!this.mask[k]) continue;
      const dx = this.X[k] - x, dy = this.Y[k] - y, w = Math.exp(-(dx * dx + dy * dy) / (radius * radius));
      if (w > 0.02) { this.u[k] += du * w; this.v[k] += dv * w; }
    }
  }

  /** Raise the target to the dim background floor everywhere (call after a target fill).
   *  floor = level · breath · (0.4 + 0.6·noise) · rimFade · BGM; colour → bgColor where the floor wins. */
  applyBackground(t, breath) {
    const { N, p, mask, X, Y, T, TR, TG, TB, TA, BGM, rim } = this;
    const lv = p.bgLevel * (0.6 + 0.4 * breath), f = p.bgFreq, c = p.bgColor;
    for (let k = 0; k < N; k++) {
      if (!mask[k]) continue;
      const n = noise3(X[k] * f + t * p.bgDrift, Y[k] * f * 1.4, t * p.bgSpeed);
      const bg = lv * (0.3 + 0.7 * n * n * 1.6) * rim[k] * BGM[k];
      if (T[k] < bg) {
        const w = T[k] < 0.02 ? 1 : 1 - T[k] / bg;
        T[k] = bg; TR[k] += (c[0] - TR[k]) * w; TG[k] += (c[1] - TG[k]) * w; TB[k] += (c[2] - TB[k]) * w; TA[k] *= 1 - w;
      }
    }
  }

  step(dt) {
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
      const c = h[k];
      let n = (c + (c - hp[k]) * p.damp * (1 - 0.15 * this.sponge[k]) + p.c2 * (h[k - 1] + h[k + 1] - 2 * c) + cy * (h[k - W] + h[k + W] - 2 * c)) * p.leak;
      if (oscV !== 0) { const dx = this.X[k] - ox, dy = this.Y[k] - oy; const d2 = dx * dx + dy * dy; if (d2 < 0.012) n += oscV * (1 - d2 / 0.012) * 0.35; }
      if (vibV !== 0) n += vibV * 0.02 * (this.ink[k] + 0.15) * ((i + j) & 1 ? 1 : -1); // fine standing shimmer, strongest in the ink
      if (shV !== 0 && this.Y[k] < -0.82) n += shV * 0.25;
      hn[k] = n;
    }
    this.hp = h; this.h = hn; this.hn = hp;

    // ---- 2. demand potential φ = blur(T − ink) at two scales ----
    const D = this.D, phi = this.phi, ink = this.ink, T = this.T;
    for (let k = 0; k < N; k++) D[k] = mask[k] ? T[k] - ink[k] : 0;
    boxBlur(D, phi, this.tmp, W, H, 2, Math.max(1, Math.round(2 / A)));
    const big = this.su; // reuse as scratch before swirl is written
    boxBlur(D, big, this.tmp, W, H, 7, Math.max(1, Math.round(7 / A)));
    // mobility: where the ink already matches its target the fluid HOLDS (no advection →
    // no numerical diffusion → the creature keeps cell-sharp detail); where it doesn't,
    // or right after a transition kick, it flows.
    const kickMob = Math.min(1, this.swirlKick * 0.12);
    for (let k = 0; k < N; k++) {
      let m = Math.abs(phi[k]) * 9 * (1 - 0.8 * p.hold) + kickMob;
      if (ink[k] < 0.3 && m < p.bgMob) m = p.bgMob; // the dim field always drifts with the eddies
      D[k] = m > 1 ? 1 : m;
      phi[k] = 0.5 * phi[k] + 0.9 * big[k];
    }

    // ---- 3+4. inertial flow toward demand + curl-noise eddies ----
    const u = this.u, v = this.v, su = this.su, sv = this.sv;
    const drag = Math.exp(-p.drag * dt), ka = p.attract * (1.6 - 0.8 * p.hold) * sp * dt;
    const swAmp = (p.swirl + this.swirlKick) * sp, f = p.swirlFreq, tz = t * 0.35;
    this.swirlKick *= Math.exp(-dt * 1.8);
    // stream function on the cell grid (one noise3 per cell; the device would use a 1/4-res lattice)
    const psi = this.tmp;
    for (let k = 0; k < N; k++) psi[k] = noise3(this.X[k] * f * 2 + 7.3, this.Y[k] * f * 2, tz);
    let vsum = 0;
    for (let j = 1; j < H - 1; j++) for (let i = 1; i < W - 1; i++) {
      const k = j * W + i;
      if (!mask[k]) { u[k] = v[k] = su[k] = sv[k] = 0; continue; }
      const gx = (phi[k + 1] - phi[k - 1]) * 0.5, gy = (phi[k + W] - phi[k - W]) * 0.5 / A;
      let uu = (u[k] + ka * gx * 0.5 * W) * drag, vv = (v[k] + ka * gy * 0.5 * W) * drag;
      const m = Math.hypot(uu, vv); if (m > p.vmax) { uu *= p.vmax / m; vv *= p.vmax / m; }
      u[k] = uu; v[k] = vv;
      // curl of ψ: (∂ψ/∂y, −∂ψ/∂x), scaled so a unit-amp eddy moves ~amp cells/s
      su[k] = (psi[k + W] - psi[k - W]) * 0.5 / A * swAmp * 10 + this.rotate * -this.Y[k] * W * 0.5;
      sv[k] = -(psi[k + 1] - psi[k - 1]) * 0.5 * swAmp * 10 + this.rotate * this.X[k] * W * 0.5;
      vsum += Math.abs(uu) + Math.abs(vv);
    }

    // ---- 5. semi-Lagrangian advection of ink + carried colour ----
    const r = this.r, g = this.g, b = this.b, acc = this.acc;
    const i2 = this.ink2, r2 = this.r2, g2 = this.g2, b2 = this.b2, a2 = this.acc2, fu = this.fu, fv = this.fv, spd = this.speed;
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const k = j * W + i;
      if (!mask[k]) { i2[k] = 0; spd[k] = 0; continue; }
      const mob = D[k], wu = (u[k] + su[k]) * mob, wv = (v[k] + sv[k]) * mob;
      fu[k] = wu; fv[k] = wv; spd[k] = Math.hypot(wu, wv);
      let x = i - wu * dt, y = j - (wv * dt) / A;
      x = x < 0 ? 0 : x > W - 1.001 ? W - 1.001 : x; y = y < 0 ? 0 : y > H - 1.001 ? H - 1.001 : y;
      const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0, k0 = y0 * W + x0;
      const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
      i2[k] = ink[k0] * w00 + ink[k0 + 1] * w10 + ink[k0 + W] * w01 + ink[k0 + W + 1] * w11;
      r2[k] = r[k0] * w00 + r[k0 + 1] * w10 + r[k0 + W] * w01 + r[k0 + W + 1] * w11;
      g2[k] = g[k0] * w00 + g[k0 + 1] * w10 + g[k0 + W] * w01 + g[k0 + W + 1] * w11;
      b2[k] = b[k0] * w00 + b[k0 + 1] * w10 + b[k0 + W] * w01 + b[k0 + W + 1] * w11;
      a2[k] = acc[k0] * w00 + acc[k0 + 1] * w10 + acc[k0 + W] * w01 + acc[k0 + W + 1] * w11;
    }

    // ---- 6. relax toward the target (what the flow did not deliver) ----
    // 'hold' (0→1 once a transition has had time to flow) crystallises the shape: relaxation
    // speeds up so cell-scale detail (eyes, letter strokes) snaps in after the flow arrived
    const hm = 0.4 + 4.6 * p.hold; // early in a transition: almost pure transport, little creation/deletion
    const up = 1 - Math.exp(-p.relaxUp * hm * sp * dt), down = 1 - Math.exp(-p.relaxDown * hm * sp * dt);
    const tr = 1 - Math.exp(-p.tintRate * sp * dt);
    let err = 0, hs = 0;
    for (let k = 0; k < N; k++) {
      if (!mask[k]) { ink[k] = 0; continue; }
      let d = i2[k]; const tk = T[k];
      d += (tk - d) * (tk > d ? up : down);
      ink[k] = d < 0 ? 0 : d > 1 ? 1 : d;
      const wt = tr * (0.25 + tk);
      r[k] = r2[k] + (this.TR[k] - r2[k]) * wt; g[k] = g2[k] + (this.TG[k] - g2[k]) * wt; b[k] = b2[k] + (this.TB[k] - b2[k]) * wt;
      acc[k] = a2[k] + (this.TA[k] - a2[k]) * Math.min(1, wt * 1.5);
      err += Math.abs(tk - ink[k]); hs += Math.abs(this.h[k]);
    }
    this.err = err / this.inside;
    this.energy = Math.min(1, hs / this.inside * 3 + vsum / this.inside / 25 + this.swirlKick * 0.05);
  }

  /** What the screen shows: ink refracted by the wave slope, plus a crest highlight. */
  computeView(ambient) {
    const { W, H, N, A, p, mask, ink } = this, h = this.h, view = this.view;
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const k = j * W + i;
      if (!mask[k] || i === 0 || j === 0 || i === W - 1 || j === H - 1) { view[k] = 0; continue; }
      const gx = (h[k + 1] - h[k - 1]) * 0.5, gy = (h[k + W] - h[k - W]) * 0.5;
      let x = i + gx * p.refr * 6, y = j + (gy * p.refr * 6) / A;
      x = x < 0 ? 0 : x > W - 1.001 ? W - 1.001 : x; y = y < 0 ? 0 : y > H - 1.001 ? H - 1.001 : y;
      const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0, k0 = y0 * W + x0;
      const s = (ink[k0] * (1 - fx) + ink[k0 + 1] * fx) * (1 - fy) + (ink[k0 + W] * (1 - fx) + ink[k0 + W + 1] * fx) * fy;
      const hc = h[k];
      // crests brighten, troughs dim; the empty "water" shows the ripple itself
      let val = s * (1 + 0.9 * hc) + p.crest * Math.max(0, hc) * 0.55 + (ambient ? ambient[k] : 0);
      view[k] = val < 0 ? 0 : val > 1 ? 1 : val;
    }
    void N;
  }

  /** Bilinear ink / height lookup at stage coords (for the large-letter overlay). */
  sampleAt(arr, x, y) {
    const { W, H } = this;
    let fx = ((x + 1) / 2) * W - 0.5, fy = ((y + 1) / 2) * H - 0.5;
    fx = Math.max(0, Math.min(W - 1.001, fx)); fy = Math.max(0, Math.min(H - 1.001, fy));
    const x0 = fx | 0, y0 = fy | 0, ax = fx - x0, ay = fy - y0, k = y0 * W + x0;
    return (arr[k] * (1 - ax) + arr[k + 1] * ax) * (1 - ay) + (arr[k + W] * (1 - ax) + arr[k + W + 1] * ax) * ay;
  }
}

// separable box blur, radius rx (columns) × ry (rows), running sums: O(N) per pass
function boxBlur(src, dst, tmp, W, H, rx, ry) {
  for (let j = 0; j < H; j++) {
    const o = j * W; let s = 0, n = 0;
    for (let i = 0; i < Math.min(W, rx + 1); i++) { s += src[o + i]; n++; }
    for (let i = 0; i < W; i++) {
      tmp[o + i] = s / n;
      const a = i + rx + 1, d = i - rx;
      if (a < W) { s += src[o + a]; n++; }
      if (d >= 0) { s -= src[o + d]; n--; }
    }
  }
  for (let i = 0; i < W; i++) {
    let s = 0, n = 0;
    for (let j = 0; j < Math.min(H, ry + 1); j++) { s += tmp[j * W + i]; n++; }
    for (let j = 0; j < H; j++) {
      dst[j * W + i] = s / n;
      const a = j + ry + 1, d = j - ry;
      if (a < H) { s += tmp[a * W + i]; n++; }
      if (d >= 0) { s -= tmp[d * W + i]; n--; }
    }
  }
}
