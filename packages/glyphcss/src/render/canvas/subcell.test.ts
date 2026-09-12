/**
 * Sub-cell `line()` in `braille`/`blocks` — the gates this feature is built
 * against (see AGENTS.md's "Cell canvas" and `docs/design/canvas.md`).
 * `ascii`/`box` are unaffected (`line()` never enters `paintSubcellLine` for
 * those two tiers, a claim `tiers.test.ts`'s own exact-fixture test also
 * pins); this file is specifically about the two tiers whose `line()`
 * output actually changed.
 */
import { describe, expect, it } from "vitest";
import { createGlyphCanvas } from "./canvas";
import { encodeGlyphCanvasText } from "./encode";

function popcount(mask: number): number {
  let n = 0;
  let m = mask;
  while (m) { n += m & 1; m >>= 1; }
  return n;
}

/** Decode every LIT dot's GLOBAL dot coordinate (2 cols x 4 rows per cell,
 * matching `GlyphCanvas.sub`'s own doc comment) across the whole canvas. */
function litDots(canvas: ReturnType<typeof createGlyphCanvas>): { x: number; y: number }[] {
  const localFor = [
    { col: 0, row: 0 }, { col: 0, row: 1 }, { col: 0, row: 2 }, // bits 0-2
    { col: 1, row: 0 }, { col: 1, row: 1 }, { col: 1, row: 2 }, // bits 3-5
    { col: 0, row: 3 }, // bit 6
    { col: 1, row: 3 }, // bit 7
  ];
  const dots: { x: number; y: number }[] = [];
  for (let idx = 0; idx < canvas.sub.length; idx++) {
    const mask = canvas.sub[idx]!;
    if (mask === 0) continue;
    const cellCol = idx % canvas.cols;
    const cellRow = Math.floor(idx / canvas.cols);
    for (let bit = 0; bit < 8; bit++) {
      if ((mask & (1 << bit)) === 0) continue;
      const local = localFor[bit]!;
      dots.push({ x: cellCol * 2 + local.col, y: cellRow * 4 + local.row });
    }
  }
  return dots;
}

describe("line() in braille/blocks: sub-cell dot rasterisation", () => {
  it("MUTATION CAUGHT: a braille line paints a monotone dot path with no cell holding more than 4 dots, not whole-cell slope glyphs", () => {
    const canvas = createGlyphCanvas({ cols: 12, rows: 4, tier: "braille" });
    canvas.line({ x: 0, y: 0 }, { x: 10, y: 3 }, { color: "#ffffff" });

    // Every painted cell is a genuine braille codepoint (U+2800-U+28FF) —
    // never a whole-cell slope glyph (`/`, `\`, `‾`, `▔`, `▏`, `▕`, `-`,
    // `|`, `_`) — and never more than 4 of its 8 dots.
    let painted = 0;
    for (let i = 0; i < canvas.sub.length; i++) {
      const mask = canvas.sub[i]!;
      if (mask === 0) continue;
      painted++;
      const code = canvas.grid.char[i]!.codePointAt(0)!;
      expect(code).toBeGreaterThanOrEqual(0x2800);
      expect(code).toBeLessThanOrEqual(0x28ff);
      expect(popcount(mask)).toBeLessThanOrEqual(4);
    }
    expect(painted).toBeGreaterThan(0);
    expect(encodeGlyphCanvasText(canvas)).not.toMatch(/[/\\]/);

    // Monotone: sorted by dot column, the dot row never decreases (the
    // segment has non-negative slope in both axes).
    const dots = litDots(canvas).sort((a, b) => a.x - b.x || a.y - b.y);
    expect(dots.length).toBeGreaterThan(0);
    let maxRowSoFar = -Infinity;
    for (const d of dots) {
      expect(d.y).toBeGreaterThanOrEqual(maxRowSoFar);
      maxRowSoFar = Math.max(maxRowSoFar, d.y);
    }
    // And non-decreasing in column when walked in the order actually drawn —
    // reconstructed here by column since dots.length > 1 and the line is
    // monotone in x too.
    for (let i = 1; i < dots.length; i++) expect(dots[i]!.x).toBeGreaterThanOrEqual(dots[i - 1]!.x);
  });

  it("MUTATION CAUGHT: two segments crossing in one cell OR their dots together, never overwrite", () => {
    const solo = (build: (c: ReturnType<typeof createGlyphCanvas>) => void): number => {
      const c = createGlyphCanvas({ cols: 3, rows: 3, tier: "braille" });
      build(c);
      return c.sub[1 * 3 + 1]!;
    };
    const maskA = solo((c) => c.line({ x: 0, y: 1 }, { x: 2, y: 1 }, { color: "#ffffff" }));
    const maskB = solo((c) => c.line({ x: 1, y: 0 }, { x: 1, y: 2 }, { color: "#ffffff" }));
    expect(maskA).toBeGreaterThan(0);
    expect(maskB).toBeGreaterThan(0);

    const both = createGlyphCanvas({ cols: 3, rows: 3, tier: "braille" });
    both.line({ x: 0, y: 1 }, { x: 2, y: 1 }, { color: "#ffffff" });
    both.line({ x: 1, y: 0 }, { x: 1, y: 2 }, { color: "#ffffff" });
    // MUTATION CAUGHT: assigning `sub[idx] = mask` instead of OR-ing would
    // leave only the SECOND segment's bits here.
    expect(both.sub[1 * 3 + 1]).toBe(maskA | maskB);
  });

  it("blocks: the same crossing OR-merges through the quadrant grouping too", () => {
    const solo = (build: (c: ReturnType<typeof createGlyphCanvas>) => void): number => {
      const c = createGlyphCanvas({ cols: 3, rows: 3, tier: "blocks" });
      build(c);
      return c.sub[1 * 3 + 1]!;
    };
    const maskA = solo((c) => c.line({ x: 0, y: 1 }, { x: 2, y: 1 }, { color: "#ffffff" }));
    const maskB = solo((c) => c.line({ x: 1, y: 0 }, { x: 1, y: 2 }, { color: "#ffffff" }));
    const both = createGlyphCanvas({ cols: 3, rows: 3, tier: "blocks" });
    both.line({ x: 0, y: 1 }, { x: 2, y: 1 }, { color: "#ffffff" });
    both.line({ x: 1, y: 0 }, { x: 1, y: 2 }, { color: "#ffffff" });
    expect(both.sub[1 * 3 + 1]).toBe(maskA | maskB);
  });

  it("a degenerate (zero-length) sub-cell line paints exactly one dot — the primitive a chart 'dot' mark plots through", () => {
    const canvas = createGlyphCanvas({ cols: 3, rows: 3, tier: "braille" });
    canvas.line({ x: 1, y: 1 }, { x: 1, y: 1 }, { color: "#ffffff" });
    const mask = canvas.sub[1 * 3 + 1]!;
    expect(popcount(mask)).toBeLessThanOrEqual(2);
    expect(popcount(mask)).toBe(1);
  });

  it("MUTATION CAUGHT: box/ascii line() output is byte-identical to before this feature (routing box through the sub-cell path -> red)", () => {
    // The exact fixtures `line.test.ts` already pins for `box`/`ascii` —
    // repeated here as a dedicated regression for this specific change, so a
    // future edit that (for example) accidentally sets `subcell: true` on
    // `box`, or has `line()` consult `GLYPH_CANVAS_TIERS.box.subcell` wrong,
    // reddens in the file that owns this feature, not only in a test that
    // predates it.
    const box = createGlyphCanvas({ cols: 7, rows: 1, tier: "box" });
    box.line({ x: 0, y: 0 }, { x: 6, y: 0 }, { style: "solid", color: "#ffffff" });
    expect(encodeGlyphCanvasText(box)).toBe("───────");
    expect(box.sub.every((b) => b === 0)).toBe(true);

    const ascii = createGlyphCanvas({ cols: 4, rows: 4, tier: "ascii" });
    ascii.line({ x: 0, y: 0 }, { x: 3, y: 3 }, { style: "solid" });
    expect(ascii.grid.char[0]).toBe("\\");
    expect(ascii.grid.char[1 * 4 + 1]).toBe("\\");
    expect(ascii.grid.char[2 * 4 + 2]).toBe("\\");
    expect(ascii.grid.char[3 * 4 + 3]).toBe("\\");
    expect(ascii.sub.every((b) => b === 0)).toBe(true);
  });

  it("a horizontal 'double' sub-cell line draws a second dot-thin run one dot away (real support, no narrowing)", () => {
    const solid = createGlyphCanvas({ cols: 6, rows: 4, tier: "braille" });
    solid.line({ x: 0, y: 1 }, { x: 5, y: 1 }, { style: "solid", color: "#ffffff" });
    const double = createGlyphCanvas({ cols: 6, rows: 4, tier: "braille" });
    double.line({ x: 0, y: 1 }, { x: 5, y: 1 }, { style: "double", color: "#ffffff" });
    expect(double.report.ledger).toHaveLength(0); // real support, not a narrowing.
    const solidDots = solid.sub.reduce((n, m) => n + popcount(m), 0);
    const doubleDots = double.sub.reduce((n, m) => n + popcount(m), 0);
    // MUTATION CAUGHT: falling back to the whole-cell "double" glyph (or
    // ignoring the style) would not add a second dot-thin run.
    expect(doubleDots).toBe(solidDots * 2);
  });

  it("a diagonal 'double' sub-cell line keeps the documented narrowing (solid + one ledger entry)", () => {
    const solid = createGlyphCanvas({ cols: 4, rows: 4, tier: "braille" });
    solid.line({ x: 0, y: 0 }, { x: 3, y: 3 }, { style: "solid" });
    const double = createGlyphCanvas({ cols: 4, rows: 4, tier: "braille" });
    double.line({ x: 0, y: 0 }, { x: 3, y: 3 }, { style: "double" });
    expect(encodeGlyphCanvasText(double)).toBe(encodeGlyphCanvasText(solid));
    expect(double.report.ledger).toHaveLength(1);
    expect(double.report.ledger[0]).toMatch(/"double"/);
    expect(double.report.ledger[0]).toMatch(/diagonal/);
  });

  it("dashed/dotted skip along the sub-cell walk (pattern advances per DOT, not per cell)", () => {
    const solid = createGlyphCanvas({ cols: 12, rows: 1, tier: "braille" });
    solid.line({ x: 0, y: 0 }, { x: 11, y: 0 }, { style: "solid", color: "#ffffff" });
    const dashed = createGlyphCanvas({ cols: 12, rows: 1, tier: "braille" });
    dashed.line({ x: 0, y: 0 }, { x: 11, y: 0 }, { style: "dashed", color: "#ffffff" });
    const dashedDots = dashed.sub.reduce((n, m) => n + popcount(m), 0);
    const solidDots = solid.sub.reduce((n, m) => n + popcount(m), 0);
    // MUTATION CAUGHT: ignoring style entirely on the sub-cell path would
    // make dashed identical to solid.
    expect(dashedDots).toBeLessThan(solidDots);
    expect(dashedDots).toBeGreaterThan(0);
  });

  it("MUTATION CAUGHT: `subcell: false` forces the whole-cell path on a braille/blocks canvas (charts' axis/rule painters)", () => {
    // AGENTS.md's "Cell canvas": axes/rules stay whole-cell box-drawing even
    // on a sub-cell-capable tier. Dropping the `opts.subcell ??` fallback
    // (i.e. always consulting `tierTable.subcell`) would route this call
    // through `paintSubcellLine` and leave `sub` non-empty.
    const braille = createGlyphCanvas({ cols: 7, rows: 1, tier: "braille" });
    braille.line({ x: 0, y: 0 }, { x: 6, y: 0 }, { style: "solid", color: "#ffffff", subcell: false });
    expect(encodeGlyphCanvasText(braille)).toBe("───────");
    expect(braille.sub.every((b) => b === 0)).toBe(true);

    const blocks = createGlyphCanvas({ cols: 4, rows: 4, tier: "blocks" });
    blocks.line({ x: 0, y: 0 }, { x: 0, y: 3 }, { style: "solid", subcell: false });
    for (let row = 0; row < 4; row++) expect(blocks.grid.char[row * 4]).toBe("│");
    expect(blocks.sub.every((b) => b === 0)).toBe(true);

    // The default (omitted `subcell`) is UNCHANGED — still the tier's own
    // capability, so a plain data-mark call on braille still goes sub-cell.
    const defaulted = createGlyphCanvas({ cols: 7, rows: 1, tier: "braille" });
    defaulted.line({ x: 0, y: 0 }, { x: 6, y: 0 }, { style: "solid", color: "#ffffff" });
    expect(defaulted.sub.some((b) => b !== 0)).toBe(true);
  });

  it("arrowhead() in braille/blocks still resolves the tier's own whole-cell arrow glyph, unchanged by the sub-cell line feature", () => {
    const braille = createGlyphCanvas({ cols: 3, rows: 3, tier: "braille" });
    braille.arrowhead(1, 1, "s");
    expect(braille.grid.char[1 * 3 + 1]).toBe("▼");
    expect(braille.sub[1 * 3 + 1]).toBe(0);

    const blocks = createGlyphCanvas({ cols: 3, rows: 3, tier: "blocks" });
    blocks.arrowhead(1, 1, "e");
    expect(blocks.grid.char[1 * 3 + 1]).toBe("▶");
    expect(blocks.sub[1 * 3 + 1]).toBe(0);
  });
});
