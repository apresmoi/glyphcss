import { describe, expect, it } from "vitest";
import { GLYPH_CANVAS_TIERS, type GlyphCanvasTier, type GlyphCanvasTierName } from "./tiers";
import { createGlyphCanvas } from "./canvas";
import { encodeGlyphCanvasText } from "./encode";

const TIER_NAMES: GlyphCanvasTierName[] = ["ascii", "box", "blocks", "braille"];

function keysDeep(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null) return [];
  let keys: string[] = [];
  for (const [k, v] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${k}` : k;
    keys.push(path);
    if (typeof v === "object" && v !== null && !Array.isArray(v)) {
      keys = keys.concat(keysDeep(v, path));
    }
  }
  return keys.sort();
}

describe("GLYPH_CANVAS_TIERS: parity", () => {
  it("every key of box exists (at every depth) in ascii, blocks and braille", () => {
    // MUTATION CAUGHT: deleting any key from any tier's object (e.g. `hop`
    // from `ascii`) desyncs this key list and reddens the test.
    const boxKeys = keysDeep(GLYPH_CANVAS_TIERS.box);
    expect(boxKeys.length).toBeGreaterThan(0);
    for (const name of TIER_NAMES) {
      expect(keysDeep(GLYPH_CANVAS_TIERS[name])).toEqual(boxKeys);
    }
  });

  it("junction tables share the same numeric key set (1..15) across all tiers", () => {
    const boxJunctionKeys = Object.keys(GLYPH_CANVAS_TIERS.box.junction).map(Number).sort((a, b) => a - b);
    expect(boxJunctionKeys).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    for (const name of TIER_NAMES) {
      const keys = Object.keys(GLYPH_CANVAS_TIERS[name].junction).map(Number).sort((a, b) => a - b);
      expect(keys).toEqual(boxJunctionKeys);
    }
  });

  it("diagonal tables share the same nine keys across all tiers", () => {
    const boxDiagonalKeys = Object.keys(GLYPH_CANVAS_TIERS.box.diagonal).sort();
    expect(boxDiagonalKeys).toEqual(["-", "/", "\\", "_", "|", "▏", "▔", "▕", "‾"].sort());
    for (const name of TIER_NAMES) {
      expect(Object.keys(GLYPH_CANVAS_TIERS[name].diagonal).sort()).toEqual(boxDiagonalKeys);
    }
  });
});

/** Flatten every glyph a tier's table can produce, for the "differences are
 * confined to table entries" tier-swap assertion below. */
function tableGlyphs(tier: GlyphCanvasTier): Set<string> {
  const glyphs = new Set<string>();
  glyphs.add(tier.straight.h);
  glyphs.add(tier.straight.v);
  for (const g of Object.values(tier.junction)) glyphs.add(g);
  glyphs.add(tier.hop.h);
  glyphs.add(tier.hop.v);
  glyphs.add(tier.dot);
  glyphs.add(tier.double.h);
  glyphs.add(tier.double.v);
  glyphs.add(tier.arrow.n);
  glyphs.add(tier.arrow.e);
  glyphs.add(tier.arrow.s);
  glyphs.add(tier.arrow.w);
  for (const g of Object.values(tier.diagonal)) glyphs.add(g);
  for (const g of tier.shadeRamp) glyphs.add(g);
  return glyphs;
}

/** Same fixed sequence of painter calls, driven against whichever tier the
 * canvas was created with — used by both the tier-swap gate and (via the
 * exported factory) can be reused to probe a specific painter's bypass.
 * Includes a DIAGONAL line: the previous version of this fixture omitted
 * one entirely, which is exactly what let `line()`'s diagonal branch bypass
 * the tier table undetected (see the membership loop below, which no
 * longer skips cells where both tiers happen to agree). */
function paintFixture(canvas: ReturnType<typeof createGlyphCanvas>): void {
  canvas.fillRect(0, 0, 2, 1, { fill: "solid", color: "#ff0000" });
  canvas.line({ x: 4, y: 0 }, { x: 4, y: 3 }, { color: "#00ff00" });
  canvas.line({ x: 6, y: 0 }, { x: 9, y: 0 }, { color: "#0000ff" });
  canvas.line({ x: 0, y: 6 }, { x: 6, y: 0 }, { color: "#ff00ff" });
  canvas.arrowhead(4, 3, "s");
  canvas.text(0, 5, ["hi"], { color: "#333333" });
}

describe("GLYPH_CANVAS_TIERS: tier swap", () => {
  it("re-encoding the same paint script in ascii vs box: EVERY painted cell (not only differing ones) is a member of its own tier's table", () => {
    const boxCanvas = createGlyphCanvas({ cols: 12, rows: 8, tier: "box" });
    const asciiCanvas = createGlyphCanvas({ cols: 12, rows: 8, tier: "ascii" });
    paintFixture(boxCanvas);
    paintFixture(asciiCanvas);

    const boxGlyphs = tableGlyphs(GLYPH_CANVAS_TIERS.box);
    const asciiGlyphs = tableGlyphs(GLYPH_CANVAS_TIERS.ascii);

    // `text()` is documented (and separately gated below) to bypass the
    // tier table entirely — its two cells ("hi" at row 5, cols 0-1) are the
    // ONLY legitimate exception to "every painted cell is a table member".
    const textCellIndices = new Set([5 * 12 + 0, 5 * 12 + 1]);

    let sawDifference = false;
    let sawPaintedCell = false;
    for (let i = 0; i < boxCanvas.grid.char.length; i++) {
      const b = boxCanvas.grid.char[i]!;
      const a = asciiCanvas.grid.char[i]!;
      if (textCellIndices.has(i)) continue;
      // Checked for EVERY painted cell, whether or not the two tiers agree
      // here — a painter that bypasses the table identically in both tiers
      // (e.g. hardcoding an ASCII-safe glyph both tables also happen to
      // contain) would slip past a "only check where they differ" gate.
      if (b !== " ") {
        sawPaintedCell = true;
        // MUTATION CAUGHT: if a painter (e.g. `arrowhead`, or `line`'s
        // diagonal branch) stopped consulting the tier table and hardcoded
        // a glyph, that glyph would not be a member of its own tier's
        // table set here.
        expect(boxGlyphs.has(b)).toBe(true);
      }
      if (a !== " ") expect(asciiGlyphs.has(a)).toBe(true);
      if (b !== a) sawDifference = true;
    }
    expect(sawPaintedCell).toBe(true);
    expect(sawDifference).toBe(true);

    // `text()` never consults a tier table, so plain ASCII text content is
    // byte-identical across tiers regardless of which one is active.
    expect(encodeGlyphCanvasText(boxCanvas).includes("hi")).toBe(true);
    expect(encodeGlyphCanvasText(asciiCanvas).includes("hi")).toBe(true);
  });

  it("arrowhead resolves its glyph from the active tier's own arrow table", () => {
    // MUTATION CAUGHT: hardcoding `arrowhead` to always emit e.g. "^"
    // (bypassing the tier table) makes this fail for the `box` canvas,
    // whose own arrow table entry for "s" is "▼", not "^".
    const boxCanvas = createGlyphCanvas({ cols: 4, rows: 4, tier: "box" });
    boxCanvas.arrowhead(1, 1, "s");
    expect(boxCanvas.grid.char[1 * 4 + 1]).toBe(GLYPH_CANVAS_TIERS.box.arrow.s);

    const asciiCanvas = createGlyphCanvas({ cols: 4, rows: 4, tier: "ascii" });
    asciiCanvas.arrowhead(1, 1, "s");
    expect(asciiCanvas.grid.char[1 * 4 + 1]).toBe(GLYPH_CANVAS_TIERS.ascii.arrow.s);
  });

  it("a near-45-degree diagonal line's ascii output stays inside printable ASCII (mutation: bypass the tier table for diagonals -> non-ASCII output -> red)", () => {
    // A near-45-degree slope (dx=11, dy=5) lands entirely in
    // `inkGlyphForTangent`'s single "\\" branch for its whole length — every
    // raw ink glyph it can produce there already happens to be ASCII, so
    // this shape does NOT distinguish "goes through the tier table" from
    // "bypasses it": both give the same (ASCII) answer. A NEAR-HORIZONTAL
    // slope instead sweeps through the four vertically-offset near-axis
    // glyphs (`‾`/`▔`/`-`/`_`), three of which are non-ASCII in the raw
    // vocabulary, so it is the shape that actually exercises the table.
    const canvas = createGlyphCanvas({ cols: 24, rows: 6, tier: "ascii" });
    canvas.line({ x: 0, y: 2 }, { x: 23, y: 3 });
    const text = encodeGlyphCanvasText(canvas);
    expect(text).toMatch(/^[\x20-\x7e\n]*$/);
    // Confirms the fixture is non-trivial: raw box-tier ink on this exact
    // line DOES include non-ASCII glyphs (so a correct ascii table lookup
    // is actually doing something here, not passing vacuously).
    const boxCanvas = createGlyphCanvas({ cols: 24, rows: 6, tier: "box" });
    boxCanvas.line({ x: 0, y: 2 }, { x: 23, y: 3 });
    expect(encodeGlyphCanvasText(boxCanvas)).not.toMatch(/^[\x20-\x7e\n]*$/);
  });

  it("exact per-tier fixture, including a diagonal, compared cell for cell against a fixed expected string (mutation: hardcode straight-run glyphs -> red)", () => {
    // A deliberately small, fully-specified script: a horizontal run, a
    // vertical run, and a diagonal (drawn last, so it overwrites the
    // horizontal run's own glyph at the shared origin cell). Compares the
    // ENTIRE grid's exact expected string per tier, not merely table
    // membership — this is what "switching tiers is a data swap" means
    // operationally, and it compares every cell rather than skipping the
    // ones where two tiers happen to already agree (see the swap test
    // above for why that skip previously hid a real bypass).
    const cols = 6;
    const rows = 4;
    const build = (tier: GlyphCanvasTierName) => {
      const c = createGlyphCanvas({ cols, rows, tier });
      c.line({ x: 0, y: 0 }, { x: 3, y: 0 }); // horizontal
      c.line({ x: 0, y: 1 }, { x: 0, y: 3 }); // vertical
      c.line({ x: 0, y: 0 }, { x: 3, y: 3 }); // diagonal, overwrites (0,0)
      return encodeGlyphCanvasText(c);
    };

    // box, blocks and braille share ONE line-art glyph set (only FILLS
    // differ between them), so this pure line-art script renders all three
    // byte-identically.
    const boxBlocksBraille = "\\───  \n│\\    \n│ \\   \n│  \\  ";
    expect(build("box")).toBe(boxBlocksBraille);
    expect(build("blocks")).toBe(boxBlocksBraille);
    expect(build("braille")).toBe(boxBlocksBraille);

    // ascii's straight/diagonal glyphs are plain ASCII; the diagonal's
    // backslash happens to be identical in both tables, so only the
    // straight run's `─`→`-` substitution differs from the box family.
    expect(build("ascii")).toBe("\\---  \n|\\    \n| \\   \n|  \\  ");
  });
});

describe("ascii fills never read as text (mutation: reuse WIREFRAME_PALETTES.dense.solid -> red)", () => {
  it("no letter appears across the full shade range, and 'solid' paints '#'", () => {
    const letters = /[A-Za-z]/;
    for (let i = 0; i <= 8; i++) {
      const canvas = createGlyphCanvas({ cols: 1, rows: 1, tier: "ascii" });
      canvas.fillRect(0, 0, 0, 0, { fill: { shade: i / 8 }, color: "#ffffff" });
      const glyph = canvas.grid.char[0]!;
      // MUTATION CAUGHT: WIREFRAME_PALETTES.dense.solid ("%$EUKH#D80BM@N")
      // contains E, U, K, H, D, B, M, N — a bar filled from that ramp would
      // read as text at several shade levels.
      expect(glyph).not.toMatch(letters);
    }
    const solid = createGlyphCanvas({ cols: 1, rows: 1, tier: "ascii" });
    solid.fillRect(0, 0, 0, 0, { fill: "solid", color: "#ffffff" });
    expect(solid.grid.char[0]).toBe("#");
    const blank = createGlyphCanvas({ cols: 1, rows: 1, tier: "ascii" });
    blank.fillRect(0, 0, 0, 0, { fill: { shade: 0 }, color: "#ffffff" });
    expect(blank.grid.char[0]).toBe(" ");
  });
});

describe("blocks/braille fills are SUB-DERIVED, not shade-ramp (mutation: shade ramp instead of sub occupancy -> red)", () => {
  it("a half-filled (shade: 0.5) cell renders EXACTLY the top-half block, never a shade-ramp glyph", () => {
    const blocks = createGlyphCanvas({ cols: 1, rows: 1, tier: "blocks" });
    blocks.fillRect(0, 0, 0, 0, { fill: { shade: 0.5 }, color: "#ffffff" });
    // MUTATION CAUGHT: `WIREFRAME_PALETTES.blocks.solid` (" ░▒▓▌▐█▀▄■") at
    // its midpoint is nothing like "▀" — a shade-ramp substitute would
    // produce a DIFFERENT character here, not merely a differently-shaped
    // one, so this pins the sub-cell code path specifically.
    expect(blocks.grid.char[0]).toBe("▀");
    expect(blocks.grid.char[0]).not.toBe(GLYPH_CANVAS_TIERS.blocks.shadeRamp[Math.round(0.5 * (GLYPH_CANVAS_TIERS.blocks.shadeRamp.length - 1))]);
  });

  it("a half-filled (shade: 0.5) cell renders EXACTLY the top-four-dot braille pattern", () => {
    const braille = createGlyphCanvas({ cols: 1, rows: 1, tier: "braille" });
    braille.fillRect(0, 0, 0, 0, { fill: { shade: 0.5 }, color: "#ffffff" });
    // Bits {0,1,3,4} = left/right columns, rows 0-1 = the cell's top four
    // dots, exactly what "half-filled" should mean for an 8-dot glyph.
    const topFourDots = String.fromCodePoint(0x2800 + (1 | 2 | 8 | 16));
    expect(braille.grid.char[0]).toBe(topFourDots);
    expect(braille.grid.char[0]).not.toBe(GLYPH_CANVAS_TIERS.braille.shadeRamp[Math.round(0.5 * (GLYPH_CANVAS_TIERS.braille.shadeRamp.length - 1))]);
  });

  it("blocks reaches full saturation only near the top of the shade range, not at the midpoint", () => {
    const shadeToCoverage = (shade: number): number => {
      const c = createGlyphCanvas({ cols: 1, rows: 1, tier: "blocks" });
      c.fillRect(0, 0, 0, 0, { fill: { shade }, color: "#ffffff" });
      return c.grid.char[0] === "█" ? 1 : 0;
    };
    // At shade 0.5 (the classic "half full" case) blocks must NOT already
    // read as a full block — that was the un-fixed identity sub-fill
    // order's defect (saturating a quarter of the input range early).
    expect(shadeToCoverage(0.5)).toBe(0);
    expect(shadeToCoverage(1)).toBe(1);
  });
});
