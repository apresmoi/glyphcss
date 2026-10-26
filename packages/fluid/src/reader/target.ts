// The reader's word target: molty's speed-text target (`creatures/js/fluid/targets.js`,
// TextTarget, 'glyph' look) over the fluid's host box. Each word is rasterised as large as
// it fits (sized per word, as molty's glyph look does: a sentence-wide size leaves short
// words a few cells wide) in a heavy face stretched ×1.9 in y (cells are ~1.6× taller
// than wide, so unstretched letters would be only a few rows tall), with the ORP letter pivoted on the centre column and
// painted into the accent channel. Around the word, streak lines stream past and bow away
// from it (the meniscus).
//
// molty's website reader uses the 'plain' look instead: real font letters drawn over the
// canvas. Here that would be a second DOM layer written per frame, which the one-<pre>
// contract rules out, so the fluid itself takes the letter shapes.
import { noise3 } from "../sim/noise";
import { mergeGlyphFluidCells } from "../targets/raster";
import { elementRect, resolveTargetOptions, type GlyphFluidCellBox, type GlyphFluidLayout, type GlyphFluidTargetImpl } from "../targets/types";
import type { GlyphFluidTargetFrame } from "../targets/frame";
import type { GlyphReaderToken } from "./rules/words";

/** molty's panel size: font constants below are in its 412 px units. */
const PANEL = 412;
const STRETCH_Y = 1.9;
/** Share of the host's half-width a word half may use (room for the circle's rim). */
const FIT = 0.86;
const FONT = `"Arial Black", "Helvetica Neue", Arial, sans-serif`;
/** The meniscus tint (molty's wv = 0 colour); the word itself is `color` (wv = 1). */
const TINT: [number, number, number] = [0.6, 0.68, 0.92];

/** Per-cell ink and ORP share of a rasterised word. */
export interface GlyphFluidReaderWordCells {
  /** Ink 0..1 (mean alpha of the cell's pixels). */
  cov: Float32Array;
  /** Share of that ink belonging to the ORP letter, 0..1. */
  orp: Float32Array;
}

/**
 * Area-average an RGBA word raster onto `w × h` cells. The ORP letter is drawn in green,
 * the rest in red, so each pixel's alpha is ink and green-over-red says whose.
 */
export function glyphFluidReaderWordCells(data: ArrayLike<number>, pw: number, ph: number, w: number, h: number): GlyphFluidReaderWordCells {
  const cov = new Float32Array(w * h), orp = new Float32Array(w * h);
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      const xa = Math.floor((i * pw) / w), xb = Math.max(xa + 1, Math.floor(((i + 1) * pw) / w));
      const ya = Math.floor((j * ph) / h), yb = Math.max(ya + 1, Math.floor(((j + 1) * ph) / h));
      let a = 0, o = 0, n = 0;
      for (let y = ya; y < Math.min(ph, yb); y++)
        for (let x = xa; x < Math.min(pw, xb); x++) {
          const q = (y * pw + x) * 4, al = data[q + 3]! / 255;
          a += al;
          if (data[q + 1]! > data[q]!) o += al;
          n++;
        }
      const k = j * w + i;
      cov[k] = n ? Math.min(1, a / n) : 0;
      orp[k] = a > 0 ? o / a : 0;
    }
  return { cov, orp };
}

/** A word's type size factor: its longer half around the ORP letter, in letters. */
export function glyphFluidReaderExtent(token: GlyphReaderToken): number {
  return Math.max(1, token.orp + 0.5, token.word.length - token.orp - 0.5);
}

// separable box blur (radius rx × ry), plain loops, as molty's target does
function blur(src: Float32Array, dst: Float32Array, tmp: Float32Array, W: number, H: number, rx: number, ry: number): void {
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++) {
      let s = 0, n = 0;
      for (let d = -rx; d <= rx; d++) {
        const x = i + d;
        if (x >= 0 && x < W) ((s += src[j * W + x]!), n++);
      }
      tmp[j * W + i] = s / n;
    }
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++) {
      let s = 0, n = 0;
      for (let d = -ry; d <= ry; d++) {
        const y = j + d;
        if (y >= 0 && y < H) ((s += tmp[y * W + i]!), n++);
      }
      dst[j * W + i] = s / n;
    }
}

export class GlyphFluidReaderTarget implements GlyphFluidTargetImpl {
  readonly options = resolveTargetOptions({});
  readonly strengthOn = 0.6;
  readonly strengthOff = 0.6;
  private cellBox: GlyphFluidCellBox | null = null;
  private pw = 0;
  private ph = 0;
  private token: GlyphReaderToken | null = null;
  private dirty = false;
  private t = 0;
  private cov = new Float32Array(0);
  private orp = new Float32Array(0);
  private near = new Float32Array(0);
  private nearS = new Float32Array(0);
  private dark = new Float32Array(0);
  private ink = new Float32Array(0);
  private cr = new Float32Array(0);
  private cg = new Float32Array(0);
  private cb = new Float32Array(0);
  private acc = new Float32Array(0);

  constructor(private host: HTMLElement, private color: [number, number, number]) {}

  /** Rasterise the next word (an event, not per frame). */
  setWord(token: GlyphReaderToken): void {
    this.token = token;
    this.raster();
  }

  changed(): boolean {
    const d = this.dirty;
    this.dirty = false;
    return d;
  }

  measure(layout: GlyphFluidLayout): void {
    const { cw, ch } = layout;
    const r = elementRect(this.host, layout);
    const i0 = Math.floor(r.x / cw), j0 = Math.floor(r.y / ch);
    const w = Math.max(1, Math.round(r.width / cw)), h = Math.max(1, Math.round(r.height / ch));
    this.cellBox = { i0, j0, w, h };
    this.pw = Math.max(1, Math.round(w * cw));
    this.ph = Math.max(1, Math.round(h * ch));
    const N = w * h;
    if (this.cov.length !== N) {
      const F = () => new Float32Array(N);
      this.cov = F(); this.orp = F(); this.near = F(); this.nearS = F(); this.dark = F();
      this.ink = F(); this.cr = F(); this.cg = F(); this.cb = F(); this.acc = F();
    }
    this.raster();
  }

  /** Font px for `token`: molty's glyph-look formula in its 412 px panel, scaled to the host box. */
  fontPx(token: GlyphReaderToken): number {
    const sw = this.pw / PANEL, sh = this.ph / PANEL;
    return Math.max(40 * sh, Math.min(150 * sh, (380 * sw) / (2 * glyphFluidReaderExtent(token)) / 0.62));
  }

  private raster(): void {
    const box = this.cellBox, tok = this.token;
    if (!box || !tok) return;
    const { w, h } = box, { pw, ph } = this;
    let cells: GlyphFluidReaderWordCells = { cov: new Float32Array(w * h), orp: new Float32Array(w * h) };
    const cv = document.createElement("canvas");
    cv.width = pw;
    cv.height = ph;
    const g = cv.getContext("2d", { willReadFrequently: true });
    if (g) {
      const word = tok.word, o = tok.orp;
      // The rules index UTF-16 code units, so the focal unit can be either half of an
      // astral character: widen the drawn focal slice to the whole pair.
      const start = /[\uDC00-\uDFFF]/.test(word[o] ?? "") && /[\uD800-\uDBFF]/.test(word[o - 1] ?? "") ? o - 1 : o;
      const end = start + (/[\uD800-\uDBFF]/.test(word[start] ?? "") ? 2 : 1);
      const before = word.slice(0, start), focal = word.slice(start, end), after = word.slice(end);
      let fs = this.fontPx(tok);
      g.font = `900 ${fs}px ${FONT}`;
      g.textBaseline = "middle";
      // molty's formula assumes 0.62 em per letter; heavy faces run wider, so shrink until
      // the longer half around the pivot fits inside FIT of the host's half-width
      const half = () => {
        const p = g.measureText(before).width, w = g.measureText(focal).width;
        return Math.max(p + w / 2, g.measureText(after).width + w / 2);
      };
      const h0 = half();
      if (h0 > (pw / 2) * FIT) {
        fs *= ((pw / 2) * FIT) / h0;
        g.font = `900 ${fs}px ${FONT}`;
      }
      const pre = g.measureText(before).width, ow = g.measureText(focal).width;
      const x0 = pw / 2 - pre - ow / 2;
      g.save();
      g.translate(0, ph / 2);
      g.scale(1, STRETCH_Y);
      g.fillStyle = "#f00";
      g.fillText(before, x0, fs * 0.04);
      g.fillText(after, x0 + pre + ow, fs * 0.04);
      g.fillStyle = "#0f0";
      g.fillText(focal, x0 + pre, fs * 0.04);
      g.restore();
      cells = glyphFluidReaderWordCells(g.getImageData(0, 0, pw, ph).data, pw, ph, w, h);
    }
    this.cov.set(cells.cov);
    this.orp.set(cells.orp);
    // 'near' (wide, normalised) shapes the meniscus around the word; 'dark' (tight) is the
    // softer falloff right at the letters. Radii are molty's, scaled from its 52 × 32 grid.
    const { near, dark, cov } = this, tmp = new Float32Array(w * h);
    blur(cov, near, tmp, w, h, Math.max(1, Math.round((9 * w) / 52)), Math.max(1, Math.round((4 * h) / 32)));
    let mx = 1e-6;
    for (let k = 0; k < near.length; k++) mx = Math.max(mx, near[k]!);
    for (let k = 0; k < near.length; k++) near[k] = Math.min(1, (near[k]! / mx) * 1.15);
    blur(cov, dark, tmp, w, h, Math.max(1, Math.round((2 * w) / 52)), 1);
    for (let k = 0; k < dark.length; k++) dark[k] = Math.min(1, dark[k]! * 2.2);
    this.dirty = true;
  }

  box(): GlyphFluidCellBox | null {
    return this.cellBox;
  }

  update(dt: number): void {
    this.t += dt;
  }

  write(frame: GlyphFluidTargetFrame, r0: number): void {
    const box = this.cellBox;
    if (!box) return;
    const { w, h } = box, { near, nearS, dark, cov, orp, ink, cr, cg, cb, acc, t, color } = this;
    for (let j = 0; j < h; j++)
      for (let i = 0; i < w; i++) {
        const k = j * w + i;
        const X = ((i + 0.5) / w) * 2 - 1, Y = ((j + 0.5) / h) * 2 - 1;
        nearS[k]! += (near[k]! - nearS[k]!) * 0.2; // the meniscus re-shapes smoothly between words
        const nr = nearS[k]!, dk = Math.max(0, dark[k]! - cov[k]!);
        const ys = Y - 0.2 * nr * Math.sign(Y + 1e-3);
        const n = noise3((X - t * 0.32) * 2.2, ys * 3.2, t * 0.35);
        const streak = 0.5 + 0.5 * Math.sin(ys * 30 + n * 5);
        const field = Math.pow(nr, 1.3) * (0.14 + 0.4 * streak * (0.6 + 0.4 * n)) * (1 - 0.5 * dk);
        ink[k] = Math.max(cov[k]!, field);
        acc[k] = orp[k]!;
        const wv = cov[k]! > 0 ? 1 : 0.35 + 0.5 * nr;
        cr[k] = TINT[0] + (color[0] - TINT[0]) * wv;
        cg[k] = TINT[1] + (color[1] - TINT[1]) * wv;
        cb[k] = TINT[2] + (color[2] - TINT[2]) * wv;
      }
    mergeGlyphFluidCells(frame, box, r0, 0, ink, cr, cg, cb, undefined, acc);
  }

  dispose(): void {}
}
