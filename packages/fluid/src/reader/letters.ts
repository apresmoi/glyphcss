// The reader's plain look as DOM: the reference's `letters` overlay (render.js), real letters over
// the fluid <pre>. Each letter is one positioned <span>. Per frame a letter gets at most
// ONE inline-style assignment (transform, colour, opacity as one cssText), and only when
// that string changed; its textContent is written only when its displayed character
// changes (a ramp glyph decoding into the letter). Static presentation lives in one
// <style> written at creation and a font-size written per sentence, never per frame.
import { GLYPH_FLUID_PROBE_OUT } from "../cells/probes";

/** the reference's 'Fade' ramp: what a letter shows while it is still condensing (or melting). */
export const GLYPH_FLUID_READER_RAMP = " .:-=+*#%@";
/** the reference's letter face: bold, its UI monospace. */
export const GLYPH_FLUID_READER_FONT = "ui-monospace, Menlo, Consolas, monospace";
/** Ink a letter needs before it shows at all, and before it decodes (render.js). */
export const GLYPH_FLUID_READER_SHOW_INK = 0.14;
export const GLYPH_FLUID_READER_DECODE_INK = 0.36;
const ACC = [255, 140, 60];

/** One letter of the showing word, in host px. */
export interface GlyphFluidReaderLetter {
  ch: string;
  /** Centre, at rest. */
  x: number;
  y: number;
  /** The ORP letter. */
  orp: boolean;
}

/** What one probe set drew: its letters and how far into the melt it was. */
export interface GlyphFluidReaderLetterSet {
  letters: readonly GlyphFluidReaderLetter[];
  /** Seconds since the text was left (0 while reading). */
  melt: number;
  /** px the wave height moves a letter per unit (reference: 7 panel px, clamped to ±3). */
  wave: number;
}

/** The character a letter shows at `ink`: the real letter once decoded, else a ramp glyph. */
export function glyphFluidReaderGlyph(ch: string, ink: number, melt: number, ramp = GLYPH_FLUID_READER_RAMP): string {
  if (ink > GLYPH_FLUID_READER_DECODE_INK + melt * 1.5) return ch;
  const rmax = ramp.length - 1;
  return ramp[Math.max(1, Math.round(Math.max(0, ink - melt) * rmax))]!;
}

/** A letter's colour: brightness 0.55 + ink over `rgb` (0..1), the ORP letter mixed toward the reference's accent. */
export function glyphFluidReaderLetterColor(rgb: readonly number[], ink: number, acc: number, orp: boolean): string {
  const b = Math.min(1, 0.55 + ink);
  let r = 255 * rgb[0]! * b, g = 255 * rgb[1]! * b, bl = 255 * rgb[2]! * b;
  const a = orp ? Math.max(acc, 0.85) : 0;
  if (a) {
    r += (ACC[0]! - r) * a;
    g += (ACC[1]! - g) * a;
    bl += (ACC[2]! - bl) * a;
  }
  // 5-bit channels like render.js's fill styles: fewer distinct strings, fewer writes
  const q = (v: number) => (((Math.min(255, v) | 0) >> 3) << 3).toString(16).padStart(2, "0");
  return `#${q(r)}${q(g)}${q(bl)}`;
}

let sheets = 0;

export class GlyphFluidReaderLetters {
  readonly root: HTMLDivElement;
  private spans: HTMLSpanElement[] = [];
  private chars: string[] = [];
  private styles: string[] = [];
  private cls: string;

  constructor(host: HTMLElement, font: string, private rgb: readonly number[], private reduced: boolean) {
    this.cls = `glyph-fluid-letters-${++sheets}-${Math.random().toString(36).slice(2, 7)}`;
    const root = document.createElement("div");
    root.className = this.cls;
    root.setAttribute("aria-hidden", "true");
    const style = document.createElement("style");
    style.textContent =
      `.${this.cls}{position:absolute;inset:0;pointer-events:none;overflow:hidden;font-family:${font};font-weight:700;line-height:1;}` +
      `.${this.cls}>span{position:absolute;left:0;top:0;white-space:pre;opacity:0;will-change:transform;}`;
    root.append(style);
    host.append(root);
    this.root = root;
  }

  /** Type size for a sentence (an event, not per frame). */
  setFontPx(px: number): void {
    this.root.style.fontSize = `${px.toFixed(2)}px`;
  }

  /**
   * Draw one probe set's results (`GLYPH_FLUID_PROBE_OUT` per letter: ink, wave height,
   * accent, shown). `null` hides every letter.
   */
  draw(set: GlyphFluidReaderLetterSet | null, values: Float64Array | null): void {
    const letters = set?.letters ?? [];
    while (this.spans.length < letters.length) {
      const s = document.createElement("span");
      this.root.append(s);
      this.spans.push(s);
      this.chars.push("");
      this.styles.push("");
    }
    for (let i = 0; i < this.spans.length; i++) {
      const L = letters[i];
      const o = i * GLYPH_FLUID_PROBE_OUT;
      let css = "opacity:0", ch = this.chars[i]!;
      if (L && set && values && values[o + 3]) {
        const ink = values[o]!, hh = values[o + 1]!, acc = values[o + 2]!;
        // reduced motion: settled letters, no wave, no scramble
        ch = this.reduced ? L.ch : glyphFluidReaderGlyph(L.ch, ink, set.melt);
        const dy = this.reduced ? 0 : -Math.max(-3, Math.min(3, hh * 7)) * set.wave;
        css =
          `transform:translate3d(${L.x.toFixed(1)}px,${(L.y + dy).toFixed(1)}px,0) translate(-50%,-50%);` +
          `color:${glyphFluidReaderLetterColor(this.rgb, ink, acc, L.orp)};opacity:1`;
      }
      if (ch !== this.chars[i]) {
        this.chars[i] = ch;
        this.spans[i]!.textContent = ch;
      }
      if (css !== this.styles[i]) {
        this.styles[i] = css;
        this.spans[i]!.style.cssText = css;
      }
    }
  }

  dispose(): void {
    this.root.remove();
  }
}
