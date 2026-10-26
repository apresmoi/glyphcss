// Pure raster helpers shared by the DOM targets: area-averaging a pixel buffer onto the
// cell lattice, and merging a target's local cells into the frame.
import type { GlyphFluidTargetFrame } from "./frame";
import type { GlyphFluidCellBox } from "./types";

/**
 * Text coverage per cell from an RGBA buffer rasterised at `scale` device px per CSS px:
 * the mean alpha over the cell's pixel block, lifted ×1.35 and clamped (thin strokes
 * would otherwise read as half-ink).
 */
export function glyphFluidCoverageFromAlpha(
  data: ArrayLike<number>, pw: number, ph: number, w: number, h: number, cw: number, ch: number, scale: number,
): Float32Array {
  const cov = new Float32Array(w * h);
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      const xa = Math.floor(i * cw * scale),
        xb = Math.min(pw, Math.floor((i + 1) * cw * scale));
      const ya = Math.floor(j * ch * scale),
        yb = Math.min(ph, Math.floor((j + 1) * ch * scale));
      let s = 0,
        n = 0;
      for (let y = ya; y < yb; y++) for (let x = xa; x < xb; x++) ((s += data[(y * pw + x) * 4 + 3]!), n++);
      cov[j * w + i] = Math.min(1, (s / Math.max(1, n * 255)) * 1.35);
    }
  return cov;
}

/** Per-cell image samples: coverage (mean alpha), straight colour and luminance, 0..1. */
export interface GlyphFluidImageCells {
  w: number;
  h: number;
  cov: Float32Array;
  r: Float32Array;
  g: Float32Array;
  b: Float32Array;
  lum: Float32Array;
}

/** Area-average an RGBA buffer of `pw × ph` px onto a `w × h` cell grid. */
export function glyphFluidImageCells(data: ArrayLike<number>, pw: number, ph: number, w: number, h: number): GlyphFluidImageCells {
  const F = () => new Float32Array(w * h);
  const out: GlyphFluidImageCells = { w, h, cov: F(), r: F(), g: F(), b: F(), lum: F() };
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      const xa = Math.floor((i * pw) / w), xb = Math.max(xa + 1, Math.floor(((i + 1) * pw) / w));
      const ya = Math.floor((j * ph) / h), yb = Math.max(ya + 1, Math.floor(((j + 1) * ph) / h));
      let a = 0, r = 0, g = 0, b = 0, n = 0;
      for (let y = ya; y < Math.min(ph, yb); y++)
        for (let x = xa; x < Math.min(pw, xb); x++) {
          const q = (y * pw + x) * 4, al = data[q + 3]! / 255;
          a += al;
          r += (data[q]! / 255) * al;
          g += (data[q + 1]! / 255) * al;
          b += (data[q + 2]! / 255) * al;
          n++;
        }
      const k = j * w + i;
      out.cov[k] = n ? a / n : 0;
      if (a > 0) {
        out.r[k] = r / a;
        out.g[k] = g / a;
        out.b[k] = b / a;
      }
      out.lum[k] = 0.2126 * out.r[k]! + 0.7152 * out.g[k]! + 0.0722 * out.b[k]!;
    }
  return out;
}

/** Ink for a covered, shaded cell: coverage × a floor-lifted luminance curve (molty's creature target). */
export const glyphFluidShadeInk = (cov: number, lum: number) => cov * (0.06 + 0.94 * Math.pow(lum, 1.3));

/**
 * Max-merge local cells into the frame: a cell is taken where its ink beats what is
 * already there (and `minInk`). Frame border cells stay untouched — the sim never
 * draws them.
 */
export function mergeGlyphFluidCells(
  frame: GlyphFluidTargetFrame, box: GlyphFluidCellBox, r0: number, minInk: number,
  ink: ArrayLike<number>, r: ArrayLike<number> | number, g: ArrayLike<number> | number, b: ArrayLike<number> | number,
  feature?: ArrayLike<number>,
): void {
  const { cols: W, rows: H, T, TR, TG, TB, TF } = frame;
  for (let jj = 0; jj < box.h; jj++) {
    const j = box.j0 + jj - r0;
    if (j < 1 || j >= H - 1) continue;
    for (let ii = 0; ii < box.w; ii++) {
      const i = box.i0 + ii;
      if (i < 1 || i >= W - 1) continue;
      const q = jj * box.w + ii,
        v = ink[q]!,
        k = j * W + i;
      if (v <= minInk || v <= T[k]!) continue;
      T[k] = v;
      TR[k] = typeof r === "number" ? r : r[q]!;
      TG[k] = typeof g === "number" ? g : g[q]!;
      TB[k] = typeof b === "number" ? b : b[q]!;
      // the winner owns the cell: a featureless winner clears a loser's feature flag
      TF[k] = feature ? feature[q]! : 0;
    }
  }
}
