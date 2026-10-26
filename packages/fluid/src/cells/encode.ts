// Cells → one atlas text frame through glyphcss core: the braille glyphs and colours go
// to `encodeGlyphAtlas` against a palette from the pooled `createGlyphAtlasPaletteQuantizer`,
// so slots stay put between repools and the palette CSS changes only when it repools.
import {
  GLYPH_FONT_ATLAS,
  buildGlyphAtlasFontPaletteValuesCss,
  createGlyphAtlasPaletteQuantizer,
  encodeGlyphAtlas,
  type GlyphAtlasPaletteQuantizer,
} from "glyphcss";
import type { GlyphFluidCells } from "./cells";

/**
 * How cells become text: `"atlas"` = per-cell colour through the pooled palette, `"mono"`
 * = the atlas in one colour. `"plain"` is the runtime's fallback when the atlas font is
 * unavailable: real braille code points, one CSS colour.
 */
export type GlyphFluidEncoding = "atlas" | "mono" | "plain";

/** One encoded frame, ready for one `textContent` write. */
export interface GlyphFluidFrame {
  /** Atlas PUA text, rows joined by `"\n"`. */
  text: string;
  /** `#rrggbb` per palette slot. */
  palette: readonly string[];
  /** Bumped whenever `palette` changes; the writer re-emits the palette CSS only then. */
  paletteGeneration: number;
  /** Lit cells. */
  drawn: number;
}

const BRAILLE: string[] = Array.from({ length: 256 }, (_, m) => (m ? String.fromCharCode(0x2800 + m) : " "));
const HEX = new Map<number, string>();
const hexOf = (rgb: number) => {
  let s = HEX.get(rgb);
  if (s === undefined) HEX.set(rgb, (s = "#" + rgb.toString(16).padStart(6, "0")));
  return s;
};

export interface GlyphFluidEncoderOptions {
  encoding: GlyphFluidEncoding;
  /** `mono`'s colour. */
  monoColor: string;
  /**
   * The quantizer's clock in ms. The runtime passes the SIM clock, not wall time, so a
   * repool lands on the same frame in the worker and on the main thread.
   */
  now: () => number;
}

/**
 * Stateful cells → frame encoder (the quantizer pools colours across frames). One per
 * fluid; the worker and the main-thread path each own one and feed it identical cells.
 */
export class GlyphFluidEncoder {
  private char: string[] = [];
  private color: (string | null)[] = [];
  private quantizer: GlyphAtlasPaletteQuantizer;
  private mono: readonly string[];

  constructor(private opts: GlyphFluidEncoderOptions) {
    this.quantizer = createGlyphAtlasPaletteQuantizer({ now: opts.now });
    this.mono = [opts.monoColor];
  }

  encode(cells: GlyphFluidCells): GlyphFluidFrame {
    if (this.opts.encoding === "plain") return plainFrame(cells, this.mono);
    const n = cells.cols * cells.rows;
    const { char, color } = this;
    char.length = n;
    color.length = n;
    const { mask, rgb } = cells;
    const mono = this.opts.encoding === "mono";
    for (let k = 0; k < n; k++) {
      const m = mask[k]!;
      char[k] = BRAILLE[m]!;
      color[k] = m ? (mono ? this.mono[0]! : hexOf(rgb[k]!)) : null;
    }
    const palette = mono ? this.mono : (this.quantizer.resolveGlyphAtlasPalette(char, color, n) ?? this.mono);
    return {
      text: encodeGlyphAtlas(char, color, cells.cols, cells.rows, palette, GLYPH_FONT_ATLAS),
      palette,
      paletteGeneration: mono ? 0 : this.quantizer.generation,
      drawn: cells.drawn,
    };
  }
}

/**
 * Without the atlas font (load failed, or no `font-palette` support): real braille
 * characters in one colour. U+2800 rather than a space for blank cells, because a space
 * comes from a different face with a different advance and would shear the grid.
 */
function plainFrame(cells: GlyphFluidCells, palette: readonly string[]): GlyphFluidFrame {
  const { cols, rows, mask } = cells;
  const units = new Uint16Array(cols * rows + rows - 1);
  let o = 0;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) units[o++] = 0x2800 + mask[j * cols + i]!;
    if (j < rows - 1) units[o++] = 10;
  }
  let text = "";
  for (let s = 0; s < units.length; s += 8192) text += String.fromCharCode(...units.subarray(s, s + 8192));
  return { text, palette, paletteGeneration: 0, drawn: cells.drawn };
}

/** The `@font-palette-values` rule a frame's `<pre>` references by `font-palette`. */
export function glyphFluidPaletteCss(name: string, palette: readonly string[]): string {
  return buildGlyphAtlasFontPaletteValuesCss(name, palette, GLYPH_FONT_ATLAS);
}
