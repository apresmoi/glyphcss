// The per-cell decision of the reference's canvas renderer (`reference/fluid/render.js`,
// GlyphRenderer.draw with braille "all", palette "pastel", edges 1) as DATA:
// which of the 8 sub-dots a cell lights and in what colour. `cells.parity.test.ts` runs
// the real renderer on a recording 2D context and requires the same dots and colours.
import type { GlyphFluidSim } from "../sim/sim";

const R = { EDGE_RANGE: 0.16, EDGE_MIN: 0.3, DITHER_GAMMA: 1.0, DITHER_GAIN: 0.97, DIM_FLOOR: 0.16, SHIMMER_HZ: 24 };
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
const hashU = (a: number, b: number) => {
  const h = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
  return h - Math.floor(h);
};
const ACC = [255, 140, 60];

// renderer dot q (column q>>2, row q&3) → Unicode braille bit
const QBIT = [0x01, 0x02, 0x04, 0x40, 0x08, 0x10, 0x20, 0x80];
/** Renderer dot mask → Unicode braille mask. */
export const GLYPH_FLUID_DOTS_TO_BRAILLE = new Uint8Array(256);
for (let m = 0; m < 256; m++) {
  let u = 0;
  for (let q = 0; q < 8; q++) if (m & (1 << q)) u |= QBIT[q]!;
  GLYPH_FLUID_DOTS_TO_BRAILLE[m] = u;
}

/** One frame's cells: a braille dot mask and a colour per cell. */
export interface GlyphFluidCells {
  cols: number;
  rows: number;
  /** Unicode braille mask (`U+2800 + mask`); 0 = blank cell. */
  mask: Uint8Array;
  /** `0xRRGGBB`, quantised to 5 bits per channel like the canvas renderer's fill styles. */
  rgb: Uint32Array;
  /** Lit cells. */
  drawn: number;
}

export function createGlyphFluidCells(cols: number, rows: number): GlyphFluidCells {
  return { cols, rows, mask: new Uint8Array(cols * rows), rgb: new Uint32Array(cols * rows), drawn: 0 };
}

const sub = new Float32Array(8);

// render.js's 8-neighbour test; out-of-range reads are undefined (falsy) there too
const nearSkip = (s: Uint8Array, k: number, W: number) =>
  s[k - 1] || s[k + 1] || s[k - W] || s[k + W] || s[k - W - 1] || s[k - W + 1] || s[k + W - 1] || s[k + W + 1];

/**
 * Decide every cell of `sim`'s current view. `time` drives the 24 Hz dither shimmer;
 * `shimmer` is its amplitude (0 = a still dither, as the reduced-motion frame uses).
 * `skip` marks cells under condensed DOM letters (render.js's `letters` overlay): they
 * stay blank, and their neighbours only dither (no contour ring around a letter).
 */
export function computeGlyphFluidCells(
  sim: GlyphFluidSim,
  time: number,
  shimmer: number,
  out: GlyphFluidCells,
  skip: Uint8Array | null = null,
): GlyphFluidCells {
  const { W, H, view, mask } = sim;
  const om = out.mask,
    orgb = out.rgb;
  const eW = sim.edgeW * sim.p.hold;
  const frame = Math.floor(time * R.SHIMMER_HZ);
  const sr = sim.r,
    sg = sim.g,
    sb = sim.b,
    acc = sim.acc,
    TF = sim.TF;
  let drawn = 0;
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++) {
      const k = j * W + i;
      om[k] = 0;
      orgb[k] = 0;
      if (!mask[k] || (skip && skip[k])) continue;
      const v = view[k]!;
      const feat = eW > 0.5 && TF[k]! > 0.5;
      let dots = 255,
        smin = 1,
        smax = 0,
        cellMean = -1;
      if (!feat) {
        for (let q = 0; q < 8; q++) {
          let x = i + (q >> 2 ? 0.25 : -0.25),
            y = j + ((q & 3) - 1.5) * 0.25;
          x = x < 0 ? 0 : x > W - 1.001 ? W - 1.001 : x;
          y = y < 0 ? 0 : y > H - 1.001 ? H - 1.001 : y;
          const x0 = x | 0,
            y0 = y | 0,
            fx = x - x0,
            fy = y - y0,
            kk = y0 * W + x0;
          const s =
            (view[kk]! * (1 - fx) + view[kk + 1]! * fx) * (1 - fy) + (view[kk + W]! * (1 - fx) + view[kk + W + 1]! * fx) * fy;
          sub[q] = s;
          if (s < smin) smin = s;
          if (s > smax) smax = s;
        }
        // the mean is taken over the STORED (Float32) samples, as render.js does
        let smean = 0;
        for (let q = 0; q < 8; q++) smean += sub[q]!;
        smean *= 0.125;
        dots = 0;
        if (smax - smin > R.EDGE_RANGE && smax >= R.EDGE_MIN && !(skip && nearSkip(skip, k, W))) {
          const mid = (smin + smax) * 0.5;
          for (let q = 0; q < 8; q++) if (sub[q]! > mid) dots |= 1 << q;
        } else {
          for (let q = 0; q < 8; q++) {
            const sx = i * 2 + (q >> 2),
              sy = j * 4 + (q & 3);
            let thr = BAYER4[((sy & 3) << 2) | (sx & 3)]!;
            if (shimmer > 0) thr += shimmer * (hashU(sx + frame * 7.1, sy - frame * 3.7) - 0.5);
            if (R.DITHER_GAIN * Math.pow(sub[q]!, R.DITHER_GAMMA) > thr) dots |= 1 << q;
          }
          cellMean = smean;
        }
        if (dots === 0) continue;
      }
      let r: number, g: number, b: number;
      if (feat) {
        r = 250;
        g = 246;
        b = 255;
      } else {
        const vb = cellMean >= 0 ? R.DIM_FLOOR + (1 - R.DIM_FLOOR) * Math.min(1, cellMean * 1.6) : Math.max(v, smax);
        const bt = cellMean >= 0 ? vb * 1.1 : 0.3 + 0.85 * vb;
        r = sr[k]! * 255 * bt;
        g = sg[k]! * 255 * bt;
        b = sb[k]! * 255 * bt;
      }
      const a = acc[k]!;
      if (a > 0.02) {
        r += (ACC[0]! - r) * a;
        g += (ACC[1]! - g) * a;
        b += (ACC[2]! - b) * a;
      }
      const ri = Math.min(255, r) | 0,
        gi = Math.min(255, g) | 0,
        bi = Math.min(255, b) | 0;
      orgb[k] = (((ri >> 3) << 3) << 16) | (((gi >> 3) << 3) << 8) | ((bi >> 3) << 3);
      om[k] = GLYPH_FLUID_DOTS_TO_BRAILLE[dots]!;
      drawn++;
    }
  out.drawn = drawn;
  return out;
}
