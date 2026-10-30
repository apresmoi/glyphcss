// The reader's word target: the speed-text target (TextTarget)
// over the fluid's host box, in both of its looks:
//   "plain" (website default): the fluid pools into a band under the word, and
//     real letters (`letters.ts`, DOM text over the <pre>) condense out of it once
//     enough ink has arrived under each one; the sim blanks the cells under shown letters.
//   "glyph": each word is rasterised as large as it fits (sized per word: a sentence-wide
//     size leaves short words a few cells wide) in a heavy face stretched ×1.9 in y (cells
//     are ~1.6× taller than wide), and the fluid itself takes the letter shapes.
// Both pivot the ORP letter on the centre column and paint it into the accent channel.
// Around the word, streak lines stream past and bow away from it (the meniscus).
import { noise3 } from "../sim/noise";
import { mergeGlyphFluidCells } from "../targets/raster";
import { elementRect, resolveTargetOptions, type GlyphFluidCellBox, type GlyphFluidLayout, type GlyphFluidTargetImpl } from "../targets/types";
import type { GlyphFluidTargetFrame } from "../targets/frame";
import type { GlyphReaderToken } from "./rules/words";
import { GLYPH_FLUID_PROBE_IN } from "../cells/probes";
import { GLYPH_FLUID_READER_SHOW_INK, GlyphFluidReaderLetters, type GlyphFluidReaderLetter, type GlyphFluidReaderLetterSet } from "./letters";

/** How the reader draws a word. */
export type GlyphFluidReaderLook = "plain" | "glyph";

/** the reference's panel size: font constants below are in its 412 px units. */
const PANEL = 412;
const STRETCH_Y = 1.9;
/** Share of the host's half-width a word half may use (room for the circle's rim). */
const FIT = 0.86;
const FONT = `"Arial Black", "Helvetica Neue", Arial, sans-serif`;
/** Plain look: ink under each letter (the reference's 0.62) and how long a melt runs before the letters go. */
const PLAIN_INK = 0.62;
const MELT_END = 0.8;
/** The meniscus tint (the reference's wv = 0 colour); the word itself is `color` (wv = 1). */
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

/** Plain look: one type size for a whole sentence (the reference's setSentence), in its 412 px panel units. */
export function glyphFluidReaderPlainFontPx(tokens: readonly GlyphReaderToken[]): number {
  let ext = 1;
  for (const t of tokens) ext = Math.max(ext, glyphFluidReaderExtent(t));
  return Math.max(18, Math.min(40, 330 / (2 * ext) / 0.6));
}

/**
 * Plain look: a word's letters by code point (an astral character is one letter) and
 * which of them holds the ORP code unit.
 */
export function glyphFluidReaderLetterSlots(token: GlyphReaderToken): { chars: string[]; orp: number } {
  const chars: string[] = [];
  let orp = 0, unit = 0;
  for (const c of token.word) {
    if (token.orp >= unit && token.orp < unit + c.length) orp = chars.length;
    chars.push(c);
    unit += c.length;
  }
  return { chars, orp };
}

// separable box blur (radius rx × ry), plain loops, as the reference's target does
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
  /** the reference's text state: the shape holds 0.2 s after a change and firms up within 0.4 s, so a word condenses inside its own time. */
  readonly hold = { delay: 0.2, ramp: 0.4 };
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
  private cw = 1;
  private ch = 1;
  /** Plain look: font px of the sentence in the reference's panel units, the letters and their cell boxes. */
  private plainPx = 30;
  private plainExt = 1;
  private letters: GlyphFluidReaderLetter[] = [];
  private boxes: number[] = [];
  /** px of wave displacement per reference panel px (the host's scale over the reference 412 px panel). */
  private wave = 1;
  /** Bumped when the letters are cleared after a melt: older probe results are dropped. */
  private generation = 0;
  private melting = false;
  private meltT = 0;
  private overlay: GlyphFluidReaderLetters | null;

  constructor(
    private host: HTMLElement,
    private color: [number, number, number],
    readonly look: GlyphFluidReaderLook = "glyph",
    font = "",
    reduced = false,
  ) {
    this.overlay = look === "plain" ? new GlyphFluidReaderLetters(host, font, color, reduced) : null;
  }

  /** Plain look: fix the type size for a whole sentence so it doesn't jump between words. */
  setSentence(tokens: readonly GlyphReaderToken[]): void {
    this.plainPx = glyphFluidReaderPlainFontPx(tokens);
    this.plainExt = tokens.reduce((e, t) => Math.max(e, glyphFluidReaderExtent(t)), 1);
    this.raster();
  }

  /** Rasterise the next word (an event, not per frame). */
  setWord(token: GlyphReaderToken): void {
    this.token = token;
    this.melting = false;
    this.meltT = 0;
    this.raster();
  }

  /** The text was left: plain letters decode back into ramp glyphs and go (the reference's melt). */
  melt(): void {
    if (this.melting) return;
    this.melting = true;
    this.meltT = 0;
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
    this.cw = cw;
    this.ch = ch;
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

  /** Font px for `token`: the reference's glyph-look formula in its 412 px panel, scaled to the host box. */
  fontPx(token: GlyphReaderToken): number {
    const sw = this.pw / PANEL, sh = this.ph / PANEL;
    return Math.max(40 * sh, Math.min(150 * sh, (380 * sw) / (2 * glyphFluidReaderExtent(token)) / 0.62));
  }

  private raster(): void {
    const box = this.cellBox, tok = this.token;
    if (!box || !tok) return;
    if (this.look === "plain") this.rasterPlain(box, tok);
    else this.rasterGlyph(box, tok);
    this.shapeMeniscus(box);
    this.dirty = true;
  }

  /**
   * the reference's plain setWord: a row of letter slots 0.6 em apart with the ORP slot centred,
   * ink PLAIN_INK in every cell whose centre falls inside a slot, accent under the ORP one.
   * The row is a line of text, so it scales with the host's WIDTH (the reference's panel is
   * square), capped to fit its height; and each letter always inks the cell under its own
   * centre, so a slot thinner than a cell (a short banner host) still pools. The frame's
   * border rows are never written, so a host under 3 rows (about 40 px at the default
   * grid) has no interior to pool in.
   */
  private rasterPlain(box: GlyphFluidCellBox, tok: GlyphReaderToken): void {
    const { w, h } = box, { pw, ph, cw, ch } = this;
    const scale = pw / PANEL;
    // the reference's size floor (18) lets a very long word overrun the panel: shrink the sentence
    // until its longest half around the ORP fits inside FIT of the half-width
    const fit = ((pw / 2) * FIT) / (this.plainExt * 0.6);
    const fs = Math.min(this.plainPx * scale, (ph * 0.8) / 1.05, fit), adv = fs * 0.6, lh = fs * 1.05;
    const { chars, orp } = glyphFluidReaderLetterSlots(tok);
    const x0 = pw / 2 - (orp + 0.5) * adv, y0 = ph / 2 - lh / 2;
    this.overlay?.setFontPx(fs);
    this.letters = chars.map((c, i) => ({ ch: c, x: x0 + (i + 0.5) * adv, y: y0 + lh / 2 + fs * 0.05, orp: i === orp }));
    // render.js's skip box: the cells a letter covers
    this.boxes = chars.flatMap((_, i) => {
      const x = x0 + i * adv;
      return [Math.floor(x / cw), Math.floor(y0 / ch), Math.floor((x + adv) / cw - 0.001), Math.floor((y0 + lh) / ch - 0.001)];
    });
    const { cov, orp: acc } = this;
    for (let j = 0; j < h; j++)
      for (let i = 0; i < w; i++) {
        const k = j * w + i, px = (i + 0.5) * cw, py = (j + 0.5) * ch;
        let inL = 0, isO = 0;
        if (py > y0 && py < y0 + lh) {
          const li = Math.floor((px - x0) / adv);
          if (li >= 0 && li < chars.length && chars[li] !== " ") ((inL = 1), (isO = li === orp ? 1 : 0));
        }
        cov[k] = inL * PLAIN_INK;
        acc[k] = isO;
      }
    const jc = Math.min(h - 1, Math.floor(ph / 2 / ch));
    this.letters.forEach((L, n) => {
      if (L.ch === " ") return;
      const k = jc * w + Math.min(w - 1, Math.max(0, Math.floor(L.x / cw)));
      cov[k] = PLAIN_INK;
      acc[k] = n === orp ? 1 : acc[k]!;
    });
    this.wave = fs / this.plainPx;
  }

  private rasterGlyph(box: GlyphFluidCellBox, tok: GlyphReaderToken): void {
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
      // the reference's formula assumes 0.62 em per letter; heavy faces run wider, so shrink until
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
  }

  // 'near' (wide, normalised) shapes the meniscus around the word; 'dark' (tight) is the
  // softer falloff right at the letters. Radii are the reference's, scaled from its 52 × 32 grid.
  private shapeMeniscus(box: GlyphFluidCellBox): void {
    const { w, h } = box;
    const { near, dark, cov } = this, tmp = new Float32Array(w * h);
    blur(cov, near, tmp, w, h, Math.max(1, Math.round((9 * w) / 52)), Math.max(1, Math.round((4 * h) / 32)));
    let mx = 1e-6;
    for (let k = 0; k < near.length; k++) mx = Math.max(mx, near[k]!);
    for (let k = 0; k < near.length; k++) near[k] = Math.min(1, (near[k]! / mx) * 1.15);
    blur(cov, dark, tmp, w, h, Math.max(1, Math.round((2 * w) / 52)), 1);
    for (let k = 0; k < dark.length; k++) dark[k] = Math.min(1, dark[k]! * 2.2);
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
    const plain = this.look === "plain";
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
        // plain: the letter slots hold exactly their pool, the field everywhere else
        ink[k] = plain ? (cov[k]! > 0 ? cov[k]! : field) : Math.max(cov[k]!, field);
        acc[k] = orp[k]!;
        const wv = cov[k]! > 0 ? 1 : 0.35 + 0.5 * nr;
        cr[k] = TINT[0] + (color[0] - TINT[0]) * wv;
        cg[k] = TINT[1] + (color[1] - TINT[1]) * wv;
        cb[k] = TINT[2] + (color[2] - TINT[2]) * wv;
      }
    mergeGlyphFluidCells(frame, box, r0, 0, ink, cr, cg, cb, undefined, acc);
  }

  probes(r0: number, dt: number): { data: Float64Array; key: unknown } | null {
    const box = this.cellBox;
    if (!this.overlay || !box || !this.letters.length) return null;
    if (this.melting) {
      this.meltT += dt;
      if (this.meltT > MELT_END) {
        this.letters = [];
        // results still in flight (the worker answers a frame late) must not redraw them
        this.generation++;
        this.overlay.draw(null, null);
        return null;
      }
    }
    const { letters, boxes, cw, ch } = this, melt = this.melting ? this.meltT : 0;
    const data = new Float64Array(letters.length * GLYPH_FLUID_PROBE_IN);
    for (let n = 0; n < letters.length; n++) {
      const L = letters[n]!, q = n * GLYPH_FLUID_PROBE_IN, b = n * 4;
      data[q] = box.i0 + L.x / cw;
      // the probe sits at the slot's centre, not the drawn baseline offset
      data[q + 1] = box.j0 - r0 + (L.y - (this.plainPx * this.wave) * 0.05) / ch;
      data[q + 2] = box.i0 + boxes[b]!;
      data[q + 3] = box.j0 - r0 + boxes[b + 1]!;
      data[q + 4] = box.i0 + boxes[b + 2]!;
      data[q + 5] = box.j0 - r0 + boxes[b + 3]!;
      data[q + 6] = GLYPH_FLUID_READER_SHOW_INK + melt;
    }
    const set: GlyphFluidReaderLetterSet = { letters, melt, wave: this.wave };
    return { data, key: { set, generation: this.generation } };
  }

  readProbes(values: Float64Array, key: unknown): void {
    const k = key as { set: GlyphFluidReaderLetterSet; generation: number };
    if (k.generation === this.generation) this.overlay?.draw(k.set, values);
  }

  dispose(): void {
    this.overlay?.dispose();
  }
}
