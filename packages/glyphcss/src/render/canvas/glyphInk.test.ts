import { describe, expect, it } from "vitest";
import { glyphInkDensity, glyphInkMask } from "./glyphInk";
import { GLYPH_CANVAS_QUADRANT_GLYPHS, GLYPH_CANVAS_TIERS, type GlyphCanvasTierName } from "./tiers";

const TIERS: readonly GlyphCanvasTierName[] = ["ascii", "box", "blocks", "braille"];

/** Every distinct glyph string a tier's own static tables can emit — the walk the mask/density coverage gate below runs over. */
function staticTierGlyphs(tierName: GlyphCanvasTierName): Set<string> {
  const t = GLYPH_CANVAS_TIERS[tierName];
  const out = new Set<string>();
  out.add(t.straight.h);
  out.add(t.straight.v);
  for (const g of Object.values(t.junction)) out.add(g);
  out.add(t.hop.h);
  out.add(t.hop.v);
  out.add(t.dot);
  out.add(t.double.h);
  out.add(t.double.v);
  out.add(t.arrow.n);
  out.add(t.arrow.e);
  out.add(t.arrow.s);
  out.add(t.arrow.w);
  for (const g of Object.values(t.diagonal)) out.add(g);
  for (const g of t.shadeRamp) out.add(g);
  return out;
}

/** For a subcell tier, every glyph `subGlyph`/`fillSubGlyph` can produce over the full 8-bit mask space. */
function subcellTierGlyphs(tierName: GlyphCanvasTierName): Set<string> {
  const t = GLYPH_CANVAS_TIERS[tierName];
  const out = new Set<string>();
  if (t.subGlyph) for (let m = 0; m <= 255; m++) out.add(t.subGlyph(m));
  if (t.fillSubGlyph) for (let m = 0; m <= 255; m++) out.add(t.fillSubGlyph(m));
  return out;
}

describe("glyphInkMask / glyphInkDensity — coverage walk", () => {
  // The mutation this protects: any glyph family whose branch is deleted
  // still has to fall through the resolution chain to SOME answer — this
  // walk is what would catch a family that instead throws or returns
  // `undefined`/a wrong-length array. The exactness tests below are what
  // catch a family silently falling through to the WRONG family.
  for (const tierName of TIERS) {
    it(`every glyph tier "${tierName}" can emit resolves to a valid mask and density`, () => {
      const glyphs = new Set([...staticTierGlyphs(tierName), ...subcellTierGlyphs(tierName), " "]);
      expect(glyphs.size).toBeGreaterThan(5);
      for (const glyph of glyphs) {
        const mask = glyphInkMask(glyph, tierName, [2, 4]);
        expect(mask).toBeInstanceOf(Uint8Array);
        expect(mask.length).toBe(8);
        for (const bit of mask) expect(bit === 0 || bit === 1).toBe(true);

        const density = glyphInkDensity(glyph, tierName);
        expect(Number.isFinite(density)).toBe(true);
        expect(density).toBeGreaterThanOrEqual(0);
        expect(density).toBeLessThanOrEqual(1);
      }
    });
  }

  it("dimensions are exact — no padding or truncation at arbitrary requested sizes", () => {
    for (const [cols, rows] of [[1, 1], [3, 5], [7, 2], [10, 10]] as const) {
      const mask = glyphInkMask("█", "box", [cols, rows]);
      expect(mask.length).toBe(cols * rows);
    }
  });

  it("rejects a non-positive-integer dims request", () => {
    expect(() => glyphInkMask("█", "box", [0, 4])).toThrow(RangeError);
    expect(() => glyphInkMask("█", "box", [2, 1.5])).toThrow(RangeError);
  });
});

describe("glyphInkMask — blank glyph", () => {
  it("a literal space is always fully unlit, on every tier", () => {
    for (const tierName of TIERS) {
      const mask = glyphInkMask(" ", tierName, [4, 8]);
      expect([...mask]).toEqual(new Array(32).fill(0));
      expect(glyphInkDensity(" ", tierName)).toBe(0);
    }
  });
});

describe("glyphInkMask — braille exact decode", () => {
  it("U+2800 (blank pattern) decodes to zero ink despite not being the space character", () => {
    const mask = glyphInkMask(String.fromCodePoint(0x2800), "braille", [2, 4]);
    expect([...mask]).toEqual(new Array(8).fill(0));
  });

  it("U+28FF (all 8 dots) decodes to full ink at native 2x4 resolution", () => {
    const mask = glyphInkMask(String.fromCodePoint(0x28ff), "braille", [2, 4]);
    expect([...mask]).toEqual(new Array(8).fill(1));
    expect(glyphInkDensity(String.fromCodePoint(0x28ff), "braille")).toBe(1);
  });

  it("a single dot (bit 0 = local col0,row0) decodes to exactly one lit texel at native resolution", () => {
    const mask = glyphInkMask(String.fromCodePoint(0x2800 + 1), "braille", [2, 4]);
    // Row-major [col0,row0 col1,row0 col0,row1 col1,row1 ...]
    expect([...mask]).toEqual([1, 0, 0, 0, 0, 0, 0, 0]);
    expect(glyphInkDensity(String.fromCodePoint(0x2800 + 1), "braille")).toBeCloseTo(1 / 8);
  });

  it("a braille codepoint outside the braille tier does NOT get the exact dot decode (falls through to flat density instead)", () => {
    // Bits 85 (0b01010101) is not one of braille's own eight shadeRamp
    // entries (" ⠁⠃⠇⠧⠷⠿⡿⣿"), so this is a clean discriminator: the exact
    // decode (braille tier) and the flat-default fallback (any other tier)
    // must disagree, both in lit COUNT and in which texels are lit.
    const glyph = String.fromCodePoint(0x2800 + 0b01010101);
    const brailleMask = glyphInkMask(glyph, "braille", [2, 4]);
    const asciiMask = glyphInkMask(glyph, "ascii", [2, 4]);
    expect(brailleMask.reduce((a, b) => a + b, 0)).toBe(4); // popcount(85)
    expect(glyphInkDensity(glyph, "braille")).toBeCloseTo(0.5);
    expect(glyphInkDensity(glyph, "ascii")).toBeCloseTo(0.3); // flat default
    expect([...asciiMask]).not.toEqual([...brailleMask]);
  });
});

describe("glyphInkMask — quadrant exact decode", () => {
  it("space (index 0) is unlit", () => {
    const mask = glyphInkMask(GLYPH_CANVAS_QUADRANT_GLYPHS[0]!, "blocks", [4, 4]);
    expect([...mask]).toEqual(new Array(16).fill(0));
  });

  it("▘ (top-left only) lights exactly the top-left quadrant at [4,4]", () => {
    const mask = glyphInkMask("▘", "blocks", [4, 4]);
    // rows 0-1 are top, cols 0-1 are left.
    const grid: number[][] = [];
    for (let r = 0; r < 4; r++) grid.push([...mask.slice(r * 4, r * 4 + 4)]);
    expect(grid[0]).toEqual([1, 1, 0, 0]);
    expect(grid[1]).toEqual([1, 1, 0, 0]);
    expect(grid[2]).toEqual([0, 0, 0, 0]);
    expect(grid[3]).toEqual([0, 0, 0, 0]);
    expect(glyphInkDensity("▘", "blocks")).toBeCloseTo(1 / 4);
  });

  it("█ (full block) lights every texel", () => {
    const mask = glyphInkMask("█", "blocks", [4, 4]);
    expect([...mask]).toEqual(new Array(16).fill(1));
  });

  it("braille's own fillSubGlyph (solid fills) resolves to the SAME quadrant glyph blocks' subGlyph does for the same raw dot mask", () => {
    const rawDotMask = 0b00000011; // two left-column dots -> quadrant index 1 ("▘", top-left)
    const blocksGlyph = GLYPH_CANVAS_TIERS.blocks.subGlyph!(rawDotMask);
    const brailleFillGlyph = GLYPH_CANVAS_TIERS.braille.fillSubGlyph!(rawDotMask);
    expect(brailleFillGlyph).toBe(blocksGlyph);
    const mask = glyphInkMask(brailleFillGlyph, "braille", [4, 4]);
    const grid: number[][] = [];
    for (let r = 0; r < 4; r++) grid.push([...mask.slice(r * 4, r * 4 + 4)]);
    expect(grid[0]).toEqual([1, 1, 0, 0]);
    expect(grid[1]).toEqual([1, 1, 0, 0]);
    expect(grid[2]).toEqual([0, 0, 0, 0]);
  });
});

describe("glyphInkMask — box-drawing structural strokes", () => {
  function grid5(mask: Uint8Array): number[][] {
    const out: number[][] = [];
    for (let r = 0; r < 5; r++) out.push([...mask.slice(r * 5, r * 5 + 5)]);
    return out;
  }

  it("┼ (cross) lights the full middle row and middle column, corners dark", () => {
    const g = grid5(glyphInkMask("┼", "box", [5, 5]));
    expect(g[2]).toEqual([1, 1, 1, 1, 1]);
    for (const row of g) expect(row[2]).toBe(1);
    expect(g[0]![0]).toBe(0);
    expect(g[4]![4]).toBe(0);
  });

  it("└ (bottom-left corner glyph, N|E) rises from centre to top and runs from centre to the right edge", () => {
    const g = grid5(glyphInkMask("└", "box", [5, 5]));
    // vertical stem: rows 0..2 at column 2
    expect([g[0]![2], g[1]![2], g[2]![2]]).toEqual([1, 1, 1]);
    expect(g[3]![2]).toBe(0);
    // horizontal stem: row 2, columns 2..4
    expect([g[2]![2], g[2]![3], g[2]![4]]).toEqual([1, 1, 1]);
    expect(g[2]![0]).toBe(0);
    // never lit outside the cross shape
    expect(g[0]![0]).toBe(0);
    expect(g[4]![4]).toBe(0);
  });

  it("│ is a pure vertical stroke — no horizontal spillover", () => {
    const g = grid5(glyphInkMask("│", "box", [5, 5]));
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 5; c++) {
        expect(g[r]![c]).toBe(c === 2 ? 1 : 0);
      }
    }
  });

  it("an ASCII substitute for the same stem ('|') is NOT treated structurally — falls through to flat density instead", () => {
    // Distinguishes the deliberate box-drawing-only scope: an ASCII '|' is
    // ambiguous with plain text, so it must NOT get the exact single-column
    // stroke '│' gets.
    const boxMask = glyphInkMask("│", "box", [5, 5]);
    const asciiMask = glyphInkMask("|", "box", [5, 5]);
    expect([...asciiMask]).not.toEqual([...boxMask]);
  });
});

describe("glyphInkMask — diagonal family", () => {
  it("'/' walks from the bottom-left corner to the top-right corner", () => {
    const mask = glyphInkMask("/", "box", [4, 4]);
    expect(mask[3 * 4 + 0]).toBe(1); // bottom-left
    expect(mask[0 * 4 + 3]).toBe(1); // top-right
  });

  it("'\\\\' walks from the top-left corner to the bottom-right corner", () => {
    const mask = glyphInkMask("\\", "box", [4, 4]);
    expect(mask[0 * 4 + 0]).toBe(1); // top-left
    expect(mask[3 * 4 + 3]).toBe(1); // bottom-right
  });

  it("'_' lights the bottom row only", () => {
    const mask = glyphInkMask("_", "box", [4, 4]);
    expect([...mask.slice(12, 16)]).toEqual([1, 1, 1, 1]);
    expect([...mask.slice(0, 12)]).toEqual(new Array(12).fill(0));
  });

  it("'▏' lights the left column only", () => {
    const mask = glyphInkMask("▏", "box", [4, 4]);
    for (let r = 0; r < 4; r++) expect(mask[r * 4]).toBe(1);
    for (let r = 0; r < 4; r++) expect(mask[r * 4 + 3]).toBe(0);
  });
});

describe("glyphInkMask — density dither (shading ramps)", () => {
  it("a mid-ramp box glyph ('▒', index 2 of 5) dithers to the exact requested fraction of texels", () => {
    // BOX_SHADE_RAMP = " ░▒▓█" → index 2 / (5-1) = 0.5
    const mask = glyphInkMask("▒", "box", [4, 4]);
    const lit = mask.reduce((a, b) => a + b, 0);
    expect(lit).toBe(8); // round(0.5 * 16)
    expect(glyphInkDensity("▒", "box")).toBeCloseTo(0.5);
  });

  it("a fully-blank ramp entry stays fully unlit", () => {
    // " " is index 0 → density 0.
    expect(glyphInkDensity(" ", "box")).toBe(0);
  });

  it("a full-ink ramp entry ('█', last of BOX_SHADE_RAMP) is fully lit", () => {
    expect(glyphInkDensity("█", "box")).toBe(1);
    const mask = glyphInkMask("█", "box", [4, 4]);
    expect(mask.reduce((a, b) => a + b, 0)).toBe(16);
  });
});

describe("glyphInkMask — measured fixture density for glyphs outside any ramp/line-art table", () => {
  it("'@' dithers to its measured coverage (mirrors packages/charts' glyphInkCoverage.json glyphMonoFt column)", () => {
    const density = glyphInkDensity("@", "ascii");
    expect(density).toBeCloseTo(0.34);
    const mask = glyphInkMask("@", "ascii", [10, 10]);
    expect(mask.reduce((a, b) => a + b, 0)).toBe(Math.round(0.34 * 100));
  });
});

describe("glyphInkMask — flat default fallback for arbitrary text", () => {
  it("an ordinary letter with no measured entry gets the flat default density", () => {
    const density = glyphInkDensity("A", "ascii");
    expect(density).toBeCloseTo(0.3);
    const mask = glyphInkMask("A", "ascii", [10, 10]);
    expect(mask.reduce((a, b) => a + b, 0)).toBe(Math.round(0.3 * 100));
  });
});
