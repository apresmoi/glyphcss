// Draw the fluid as monospace glyphs on a black round panel.
// glyph   = ramp[round(view · (len−1))]; fast-moving ink shows a STREAMLINE stroke
//           (- \ | /) along its velocity instead, so flow is visible as flow
// colour  = palette ramp by brightness (mono) or the advected creature colour (pastel),
//           mixed toward the accent by the advected accent channel (ORP letter)

import { strokeAlong, strokeFor } from './synth.js';

export const PALETTES = {
  green: { lo: [10, 60, 28], hi: [150, 255, 175], acc: [255, 214, 90], mono: true },
  amber: { lo: [70, 30, 0], hi: [255, 190, 90], acc: [255, 255, 245], mono: true },
  pastel: { lo: [0, 0, 0], hi: [255, 255, 255], acc: [255, 140, 60], mono: false },
};

const PANEL = 412;

// ---- tunables (the firmware port reads these as #defines) ----
const R = {
  EDGE_RANGE: 0.16,   // sub-sample spread that makes a cell a contour cell
  EDGE_MIN: 0.3,      // …but only where something solid is there (faint field stays dithered)
  DITHER_GAMMA: 1.0,  // value^γ before dithering: lifts the faint end so fades are long and soft
  DITHER_GAIN: 0.97,
  DIM_FLOOR: 0.16,    // brightness of a 1-dot cell; brightness rises with the cell's mean value
  SHIMMER_HZ: 24,     // how often the per-dot jitter re-rolls
  DOT_W: 0.26, DOT_H: 0.15, // dot size as a fraction of the cell
};
// 4×4 Bayer matrix over the GLOBAL sub-dot lattice (2W × 4H): the threshold pattern
// tiles across cells (a cell's 2 columns are half a tile), so fill order is spatially
// varied and a smooth gradient never bands at cell boundaries. 0…8 dots per cell.
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
const hashU = (a, b) => { const h = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453; return h - Math.floor(h); };

export class GlyphRenderer {
  constructor(canvas) { this.cv = canvas; this.g = canvas.getContext('2d'); this.zoom = 1; this.cache = new Map(); this.skip = null; }
  resize(zoom) {
    this.zoom = zoom; const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.scale = zoom * dpr;
    this.cv.width = PANEL * this.scale; this.cv.height = PANEL * this.scale;
    this.cv.style.width = this.cv.style.height = `${PANEL * zoom}px`;
  }
  _style(r, g, b) {
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    let s = this.cache.get(key);
    if (!s) { s = `rgb(${(r >> 3) << 3},${(g >> 3) << 3},${(b >> 3) << 3})`; this.cache.set(key, s); }
    return s;
  }
  draw(sim, opt) {
    const { g } = this, { W, H, view, mask } = sim;
    const pal = PALETTES[opt.palette] || PALETTES.green, ramp = opt.ramp, rmax = ramp.length - 1;
    const cw = PANEL / W, ch = PANEL / H;
    g.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    g.fillStyle = '#000'; g.fillRect(0, 0, PANEL, PANEL);
    g.save(); g.beginPath(); g.arc(PANEL / 2, PANEL / 2, PANEL / 2, 0, Math.PI * 2); g.clip();
    const fs = Math.min(ch * 1.02, cw / 0.6);
    g.font = `bold ${fs.toFixed(2)}px ui-monospace, Menlo, Consolas, monospace`; g.textAlign = 'center'; g.textBaseline = 'middle';

    // large-letter overlay (plain text mode): which letters have condensed, and which cells they cover
    const letters = opt.letters || [];
    const skip = this.skip && this.skip.length === sim.N ? this.skip.fill(0) : (this.skip = new Uint8Array(sim.N));
    const shown = [];
    for (const L of letters) {
      if (L.ch === ' ') continue;
      const sx = ((L.x + L.w / 2) / PANEL) * 2 - 1, sy = ((L.y + L.h / 2) / PANEL) * 2 - 1;
      const ink = sim.sampleAt(sim.ink, sx, sy), hh = sim.sampleAt(sim.h, sx, sy);
      const fade = opt.melt || 0; // seconds since the text was left
      if (ink < 0.14 + fade) continue;
      shown.push({ L, ink, hh, acc: sim.sampleAt(sim.acc, sx, sy) });
      const i0 = Math.max(0, Math.floor(L.x / cw)), i1 = Math.min(W - 1, Math.floor((L.x + L.w) / cw - 0.001));
      const j0 = Math.max(0, Math.floor(L.y / ch)), j1 = Math.min(H - 1, Math.floor((L.y + L.h) / ch - 0.001));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) skip[j * W + i] = 1;
    }

    const eW = (opt.edges ?? 1) * sim.edgeW * sim.p.hold, eThr = opt.edgeThr ?? 0.32;
    // no contour ring around the condensed letters: cells next to a letter only dither
    const nearSkip = (k) => skip[k - 1] || skip[k + 1] || skip[k - W] || skip[k + W] || skip[k - W - 1] || skip[k - W + 1] || skip[k + W - 1] || skip[k + W + 1];
    const sThr = opt.streamThr ?? 15, lo = pal.lo, hi = pal.hi, ac = pal.acc;
    let drawn = 0;
    // braille: 2×4 sub-dots per cell, drawn as our own dots (no font → no fallback-advance
    // desync, and it is exactly what a device atlas would do). Sub-samples are bilinear
    // reads of the view field at the 8 dot centres.
    const bmode = opt.braille || 'off'; // 'off' (ASCII strokes) | 'contours' | 'all'
    const sub = this.sub || (this.sub = new Float32Array(8));
    const dotW = Math.max(1.5, cw * R.DOT_W), dotH = Math.max(1.5, ch * R.DOT_H);
    const shimmer = opt.shimmer || 0, frame = Math.floor((opt.time || 0) * R.SHIMMER_HZ);
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const k = j * W + i;
      if (!mask[k] || skip[k]) continue;
      const v = view[k];
      const feat = eW > 0.5 && sim.TF[k] > 0.5;
      let dots = -1, smin = 1, smax = 0, cellMean = -1;
      if (bmode !== 'off' && !feat) {
        for (let q = 0; q < 8; q++) {
          // dot q: column q>>2 (0 left, 1 right), row q&3 (top→bottom)
          let x = i + ((q >> 2) ? 0.25 : -0.25), y = j + ((q & 3) - 1.5) * 0.25;
          x = x < 0 ? 0 : x > W - 1.001 ? W - 1.001 : x; y = y < 0 ? 0 : y > H - 1.001 ? H - 1.001 : y;
          const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0, kk = y0 * W + x0;
          const sv = (view[kk] * (1 - fx) + view[kk + 1] * fx) * (1 - fy) + (view[kk + W] * (1 - fx) + view[kk + W + 1] * fx) * fy;
          sub[q] = sv; if (sv < smin) smin = sv; if (sv > smax) smax = sv;
        }
        let smean = 0; for (let q = 0; q < 8; q++) smean += sub[q]; smean *= 0.125;
        if (smax - smin > R.EDGE_RANGE && smax >= R.EDGE_MIN && !nearSkip(k)) {
          // contour: the cell straddles an edge → dots on the dense side of its own mid-level
          const mid = (smin + smax) * 0.5; dots = 0;
          for (let q = 0; q < 8; q++) if (sub[q] > mid) dots |= 1 << q;
        } else if (bmode === 'all' || smax < 0.3) {
          // tonal fill: ordered dither of the sub-samples on the global Bayer lattice
          // (+ a tiny per-dot jitter = the living shimmer of the dim field) → 0…8 dots
          dots = 0;
          for (let q = 0; q < 8; q++) {
            const sx = i * 2 + (q >> 2), sy = j * 4 + (q & 3);
            let thr = BAYER4[((sy & 3) << 2) | (sx & 3)];
            if (shimmer > 0) thr += shimmer * (hashU(sx + frame * 7.1, sy - frame * 3.7) - 0.5);
            if (R.DITHER_GAIN * Math.pow(sub[q], R.DITHER_GAMMA) > thr) dots |= 1 << q;
          }
          cellMean = smean;
        }
        if (dots === 0) continue;
      }
      let ch1 = null;
      if (feat && bmode !== 'off') dots = 255; // eyes/mouth: a solid 2×4 dot block
      if (dots < 0) {
        const idx = Math.round(v * rmax);
        if (idx <= 0 && !feat) continue;
        ch1 = ramp[Math.max(idx, 1)];
        const sp = sim.speed[k];
        if (feat) ch1 = sim.TF[k - 1] > 0.5 && sim.TF[k + 1] > 0.5 ? '@' : 'o';
        else if (bmode === 'off' && sp > sThr && v > 0.15 && v < 0.7) ch1 = strokeAlong(sim.fu[k], sim.fv[k]);
        else if (bmode === 'off' && eW > 0 && sim.TE[k] * eW > eThr && Math.abs(sim.ink[k] - sim.T[k]) < 0.25) ch1 = strokeFor(sim.TEX[k], sim.TEY[k]);
      }
      const vb = cellMean >= 0 ? R.DIM_FLOOR + (1 - R.DIM_FLOOR) * Math.min(1, cellMean * 1.6) : dots >= 0 ? Math.max(v, smax) : v;
      const b = cellMean >= 0 ? vb : 0.25 + 0.75 * vb, a = sim.acc[k];
      let r, gg, bb;
      if (pal.mono) { r = lo[0] + (hi[0] - lo[0]) * b; gg = lo[1] + (hi[1] - lo[1]) * b; bb = lo[2] + (hi[2] - lo[2]) * b; }
      else { const bt = cellMean >= 0 ? vb * 1.1 : 0.3 + 0.85 * vb; r = sim.r[k] * 255 * bt; gg = sim.g[k] * 255 * bt; bb = sim.b[k] * 255 * bt; }
      if (feat) { if (pal.mono) { r = hi[0]; gg = hi[1]; bb = hi[2]; } else { r = 250; gg = 246; bb = 255; } }
      if (a > 0.02) { r += (ac[0] - r) * a; gg += (ac[1] - gg) * a; bb += (ac[2] - bb) * a; }
      g.fillStyle = this._style(Math.min(255, r) | 0, Math.min(255, gg) | 0, Math.min(255, bb) | 0);
      if (dots >= 0) {
        const x0 = i * cw, y0 = j * ch;
        for (let q = 0; q < 8; q++) if (dots & (1 << q)) g.fillRect(x0 + ((q >> 2) ? 0.7 : 0.3) * cw - dotW / 2, y0 + (0.14 + 0.24 * (q & 3)) * ch - dotH / 2, dotW, dotH);
      } else g.fillText(ch1, (i + 0.5) * cw, (j + 0.5) * ch + fs * 0.04);
      drawn++;
    }

    // condensed letters ride the surface (y follows the wave height) and decode from
    // ramp glyphs into the real letter as ink arrives
    for (const { L, ink, hh, acc } of shown) {
      g.font = `bold ${L.fs.toFixed(1)}px ui-monospace, Menlo, Consolas, monospace`;
      const ch2 = ink > 0.36 + (opt.melt || 0) * 1.5 ? L.ch : ramp[Math.max(1, Math.round(Math.max(0, ink - (opt.melt || 0)) * rmax))];
      const b = Math.min(1, 0.55 + ink);
      let r, gg, bb;
      if (pal.mono) { r = lo[0] + (hi[0] - lo[0]) * b; gg = lo[1] + (hi[1] - lo[1]) * b; bb = lo[2] + (hi[2] - lo[2]) * b; }
      else { r = gg = bb = 255 * b; }
      const a = L.acc ? Math.max(acc, 0.85) : 0;
      if (a) { r += (ac[0] - r) * a; gg += (ac[1] - gg) * a; bb += (ac[2] - bb) * a; }
      g.fillStyle = this._style(r | 0, gg | 0, bb | 0);
      g.fillText(ch2, L.x + L.w / 2, L.y + L.h / 2 + L.fs * 0.05 - Math.max(-3, Math.min(3, hh * 7)));
      drawn++;
    }
    g.restore();
    return drawn;
  }
}
