// CHARTS-RESEARCH `DIAGNOSIS-target-matrix.md` C5: the box tier's diagonal
// table can paint `‾` (U+203E), which the shipped "Glyph Mono" subset used
// to lack — falling back to a system font whose different advance width
// misaligned the rest of that row (AGENTS.md's "Charts" font paragraph).
// This walks EVERY glyph `GLYPH_CANVAS_TIERS` can actually emit (straight
// runs, junctions, hops, dots, doubles, arrows, diagonals, shading ramps,
// and the `subGlyph`/`fillSubGlyph` sub-cell tables) and asserts each one's
// codepoint is present in the font's own cmap — a static guarantee that
// would have caught U+203E's absence directly, rather than only on a
// specific chart/size/target combination that happened to reach it (the
// diagnosis's own caveat: "data- and size-dependent... latent on every
// frame that pins Glyph Mono").
import { describe, expect, it } from "vitest";
import { GLYPH_CANVAS_TIERS, GLYPH_CANVAS_QUADRANT_GLYPHS, type GlyphCanvasTier } from "glyphcss";
import cmapData from "./glyphMonoCmap.json";

/** Every glyph a single `GlyphCanvasTier` can put in a cell, as an array of
 *  single Unicode-codepoint strings (grapheme-by-grapheme — every entry in
 *  these tables is a single codepoint in practice, verified below rather
 *  than assumed, so a multi-codepoint entry would fail loudly instead of
 *  silently checking the wrong thing). */
function tierGlyphs(tier: GlyphCanvasTier): string[] {
  const glyphs: string[] = [
    tier.straight.h, tier.straight.v,
    tier.hop.h, tier.hop.v,
    tier.dot,
    tier.double.h, tier.double.v,
    tier.arrow.n, tier.arrow.e, tier.arrow.s, tier.arrow.w,
    ...Object.values(tier.junction),
    ...Object.values(tier.diagonal),
    ...tier.shadeRamp,
  ];
  if (tier.subGlyph) {
    // `blocks`' mask space is the 4-bit quadrant table (0-15, the same
    // range `GLYPH_CANVAS_QUADRANT_GLYPHS` is indexed over); `braille`'s is
    // the full 8-bit dot mask (0-255, `String.fromCodePoint(0x2800 + mask)`
    // — walking it exhaustively is what actually proves all 256 braille
    // cells are covered, not just a sample).
    const range = tier === GLYPH_CANVAS_TIERS.braille ? 256 : GLYPH_CANVAS_QUADRANT_GLYPHS.length;
    for (let mask = 0; mask < range; mask++) glyphs.push(tier.subGlyph(mask));
  }
  if (tier.fillSubGlyph) {
    const range = tier === GLYPH_CANVAS_TIERS.braille ? 256 : GLYPH_CANVAS_QUADRANT_GLYPHS.length;
    for (let mask = 0; mask < range; mask++) glyphs.push(tier.fillSubGlyph(mask));
  }
  return glyphs;
}

/** Every codepoint every tier in `GLYPH_CANVAS_TIERS` can emit — walked
 *  programmatically off the real table (never a hand-written list, so a
 *  future tier/table addition is covered automatically). */
export function glyphCanvasEmittableCodepoints(): Set<number> {
  const codepoints = new Set<number>();
  for (const tier of Object.values(GLYPH_CANVAS_TIERS)) {
    for (const glyph of tierGlyphs(tier)) {
      expect(Array.from(glyph)).toHaveLength(1); // single codepoint, see tierGlyphs' own doc
      codepoints.add(glyph.codePointAt(0)!);
    }
  }
  return codepoints;
}

/** Pure check, exported so the mutation test below can drive it directly
 *  against a hand-mutated cmap without touching the real JSON file. */
export function glyphMonoCmapMissingGlyphs(required: ReadonlySet<number>, available: ReadonlySet<number>): number[] {
  return Array.from(required).filter((cp) => !available.has(cp)).sort((a, b) => a - b);
}

describe("Glyph Mono cmap covers every glyph the canvas tiers can emit", () => {
  const availableCodepoints = new Set<number>((cmapData as { codepoints: number[] }).codepoints);
  const requiredCodepoints = glyphCanvasEmittableCodepoints();

  it("has real content to check (guards against an empty table silently passing)", () => {
    expect(requiredCodepoints.size).toBeGreaterThan(50);
    expect(availableCodepoints.size).toBeGreaterThan(50);
  });

  it("the shipped font's cmap contains every emittable glyph", () => {
    const missing = glyphMonoCmapMissingGlyphs(requiredCodepoints, availableCodepoints);
    expect(missing.map((cp) => `U+${cp.toString(16).toUpperCase().padStart(4, "0")}`)).toEqual([]);
  });

  // Regression pin for CHARTS-RESEARCH C5 specifically — U+203E is a member
  // of `requiredCodepoints` (the box tier's diagonal table) and of the
  // shipped font's own cmap now that it was added.
  it("U+203E (box tier's shallow-diagonal glyph) is covered", () => {
    expect(requiredCodepoints.has(0x203e)).toBe(true);
    expect(availableCodepoints.has(0x203e)).toBe(true);
  });

  // Mutation: remove a glyph from the shipped font's own range -> this
  // reddens. Proves the coverage check above is load-bearing rather than a
  // guarantee with no failing test (this repo's own "Tests & build" rule).
  it("flags a codepoint that is required but not in the font (mutation check)", () => {
    const mutatedAvailable = new Set(availableCodepoints);
    expect(mutatedAvailable.delete(0x203e)).toBe(true); // sanity: it really was present
    const missing = glyphMonoCmapMissingGlyphs(requiredCodepoints, mutatedAvailable);
    expect(missing).toContain(0x203e);
  });
});
