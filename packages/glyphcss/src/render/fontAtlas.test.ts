import { describe, expect, it } from "vitest";
import {
  GLYPH_FONT_ATLAS,
  buildGlyphAtlasFontFaceCss,
  buildGlyphAtlasFontPaletteValuesCss,
  decodeGlyphAtlasCodePoint,
  decodeGlyphAtlasText,
  glyphAtlasCodePoint,
  isGlyphInFontAtlas,
  loadGlyphAtlasFontFaceCss,
  loadGlyphAtlasFontPayload,
} from "./fontAtlas";
import { WIREFRAME_PALETTES } from "./ramps";

describe("fontAtlas — checked-in manifest", () => {
  it("loads a non-trivial universal glyph set within the BMP PUA budget", () => {
    expect(GLYPH_FONT_ATLAS.glyphCount).toBe(GLYPH_FONT_ATLAS.glyphs.length);
    expect(GLYPH_FONT_ATLAS.glyphCount).toBeGreaterThan(50);
    expect(GLYPH_FONT_ATLAS.maxPaletteSize).toBeGreaterThan(1);
    expect(GLYPH_FONT_ATLAS.maxPaletteSize).toBeLessThanOrEqual(31);
    const lastCodePoint = GLYPH_FONT_ATLAS.puaStart + GLYPH_FONT_ATLAS.maxPaletteSize * GLYPH_FONT_ATLAS.glyphCount - 1;
    expect(lastCodePoint).toBeLessThanOrEqual(0xf8ff);
    expect(GLYPH_FONT_ATLAS.puaStart).toBe(0xe000);
  });

  it("includes plain ASCII printable characters (field-synth free-form ramps)", () => {
    for (const ch of "#@*.=+") expect(isGlyphInFontAtlas(ch)).toBe(true);
  });
});

// Hand-mirrored from `render/rasterize.ts` -- neither is individually
// exported, and `build-atlas.py`'s own docstring documents mirroring these
// TypeScript sources by hand as the ONE place the universal glyph set is
// enumerated. Kept identical to `INK_GLYPHS`/`JUNCTION_GLYPHS` there.
const INK_GLYPHS = "·‾▔-_\\▏|▕/".split("");
const JUNCTION_GLYPHS = "│─└┘┌┐├┤┬┴┼".split("");
const WIREFRAME_TIER_PALETTES = ["default", "ascii"] as const;

function greekCapitals(): string[] {
  const out: string[] = [];
  for (let cp = 0x0391; cp <= 0x03a9; cp++) {
    if (cp === 0x03a2) continue; // unassigned
    out.push(String.fromCharCode(cp));
  }
  return out;
}

describe("fontAtlas — documented scope coverage (regression: build-atlas.py used to silently drop in-scope glyphs Menlo lacked)", () => {
  it("covers full printable ASCII (0x20..0x7E)", () => {
    for (let cp = 0x20; cp <= 0x7e; cp++) {
      const ch = String.fromCharCode(cp);
      expect(isGlyphInFontAtlas(ch), `U+${cp.toString(16)} ${JSON.stringify(ch)}`).toBe(true);
    }
  });

  it("covers the 24 Greek capital letters", () => {
    const capitals = greekCapitals();
    expect(capitals).toHaveLength(24);
    for (const ch of capitals) expect(isGlyphInFontAtlas(ch), `Greek ${JSON.stringify(ch)}`).toBe(true);
  });

  it("covers the SOLID ramp of every named WIREFRAME_PALETTES entry", () => {
    for (const [name, tiers] of Object.entries(WIREFRAME_PALETTES)) {
      for (const ch of tiers.solid) {
        expect(isGlyphInFontAtlas(ch), `palette ${name} solid glyph ${JSON.stringify(ch)}`).toBe(true);
      }
    }
  });

  it("covers the default/ascii wireframe thin/normal/core tiers", () => {
    for (const name of WIREFRAME_TIER_PALETTES) {
      const tiers = WIREFRAME_PALETTES[name]!;
      for (const tier of ["thin", "normal", "core"] as const) {
        for (const ch of tiers[tier]) {
          expect(isGlyphInFontAtlas(ch), `palette ${name} ${tier} glyph ${JSON.stringify(ch)}`).toBe(true);
        }
      }
    }
  });

  it("covers ink mode's fixed 10-glyph oriented set", () => {
    expect(INK_GLYPHS).toHaveLength(10);
    for (const ch of INK_GLYPHS) expect(isGlyphInFontAtlas(ch), `ink glyph ${JSON.stringify(ch)}`).toBe(true);
  });

  it("covers the wireframe-junctions 11-glyph box-drawing set", () => {
    expect(JUNCTION_GLYPHS).toHaveLength(11);
    for (const ch of JUNCTION_GLYPHS) expect(isGlyphInFontAtlas(ch), `junction glyph ${JSON.stringify(ch)}`).toBe(true);
  });
});

describe("fontAtlas — PUA mapping scheme", () => {
  it("maps space directly to U+0020 regardless of palette slot", () => {
    expect(glyphAtlasCodePoint(" ", 0)).toBe(0x20);
    expect(glyphAtlasCodePoint(" ", 5)).toBe(0x20);
  });

  it("is a pure function of (glyphIndex, paletteSlot) — the SAME glyph at the SAME slot always yields the SAME code point, independent of what color value that slot currently holds", () => {
    // This is the load-bearing property the coordinator's palette-refresh
    // message asked to confirm: a code point encodes a SLOT, never a color
    // VALUE, so swapping which concrete color a slot resolves to (a CSS
    // @font-palette-values change) never has to touch already-encoded text.
    const cpBefore = glyphAtlasCodePoint("#", 3);
    // Nothing here depends on any concrete color string — glyphAtlasCodePoint
    // doesn't even take one. Re-deriving with the identical (glyph, slot)
    // pair must be byte-identical no matter how many times a caller has
    // since re-declared what slot 3's color IS via CSS.
    const cpAfter = glyphAtlasCodePoint("#", 3);
    expect(cpAfter).toBe(cpBefore);
  });

  it("distinct glyphs at the same slot get distinct code points", () => {
    const a = glyphAtlasCodePoint("#", 2);
    const b = glyphAtlasCodePoint("@", 2);
    expect(a).not.toBe(b);
  });

  it("the same glyph at distinct slots gets distinct code points", () => {
    const a = glyphAtlasCodePoint("#", 0);
    const b = glyphAtlasCodePoint("#", 1);
    expect(a).not.toBe(b);
    expect(b! - a!).toBe(GLYPH_FONT_ATLAS.glyphCount);
  });

  it("rejects a glyph outside the universal atlas", () => {
    expect(glyphAtlasCodePoint("★★", 0)).toBeUndefined(); // multi-char, not a single glyph
    expect(glyphAtlasCodePoint("\u{1F600}", 0)).toBeUndefined(); // emoji, never in atlas
  });

  it("rejects an out-of-range palette slot", () => {
    expect(glyphAtlasCodePoint("#", -1)).toBeUndefined();
    expect(glyphAtlasCodePoint("#", GLYPH_FONT_ATLAS.maxPaletteSize)).toBeUndefined();
    expect(glyphAtlasCodePoint("#", 1.5)).toBeUndefined();
  });
});

describe("fontAtlas — PUA round-trip", () => {
  it("decodes a code point back to the exact (glyph, paletteSlot) it was encoded from, for every atlas glyph", () => {
    for (let gi = 0; gi < GLYPH_FONT_ATLAS.glyphs.length; gi++) {
      const glyph = GLYPH_FONT_ATLAS.glyphs[gi]!;
      for (const slot of [0, 1, GLYPH_FONT_ATLAS.maxPaletteSize - 1]) {
        const cp = glyphAtlasCodePoint(glyph, slot)!;
        expect(cp).toBeDefined();
        const decoded = decodeGlyphAtlasCodePoint(cp);
        expect(decoded).toEqual({ glyph, paletteSlot: slot });
      }
    }
  });

  it("round-trips space specially (paletteSlot -1, no atlas slot consumed)", () => {
    const decoded = decodeGlyphAtlasCodePoint(0x20);
    expect(decoded).toEqual({ glyph: " ", paletteSlot: -1 });
  });

  it("returns undefined for a code point before puaStart (other than space) and past the occupied range", () => {
    expect(decodeGlyphAtlasCodePoint(0x21)).toBeUndefined(); // '!' — plain ASCII, not PUA
    const pastRange = GLYPH_FONT_ATLAS.puaStart + GLYPH_FONT_ATLAS.maxPaletteSize * GLYPH_FONT_ATLAS.glyphCount;
    expect(decodeGlyphAtlasCodePoint(pastRange)).toBeUndefined();
  });

  it("decodeGlyphAtlasText recovers the original glyph string, dropping only color", () => {
    const glyph = GLYPH_FONT_ATLAS.glyphs[0]!;
    const cp = glyphAtlasCodePoint(glyph, 4)!;
    const text = `${String.fromCodePoint(cp)} ${String.fromCodePoint(cp)}\n${String.fromCodePoint(cp)}`;
    expect(decodeGlyphAtlasText(text)).toBe(`${glyph} ${glyph}\n${glyph}`);
  });

  it("decodeGlyphAtlasText is a no-op on plain text with no PUA code points", () => {
    const plain = "hello world\n  .:-=+*#%@";
    expect(decodeGlyphAtlasText(plain)).toBe(plain);
  });
});

describe("fontAtlas — @font-face / @font-palette-values CSS emission", () => {
  it("builds a self-contained @font-face with an inlined data: URI (no external request)", async () => {
    // The payload is no longer a field of the statically-imported manifest —
    // it arrives through the lazy chunk, which is exactly what keeps it out of
    // `dist/index.js` (see `bundle.atlas.test.ts`).
    const base64 = await loadGlyphAtlasFontPayload();
    expect(base64).not.toBeNull();
    const css = buildGlyphAtlasFontFaceCss(base64!);
    expect(css).toContain("@font-face");
    expect(css).toContain(GLYPH_FONT_ATLAS.family);
    expect(css).toContain("data:font/woff2;base64,");
    expect(css).toContain(base64!);
  });

  it("refuses to emit a @font-face with no payload rather than shipping an empty src", () => {
    // The failure this rules out is a static/CodePen export that looks right
    // in review and renders tofu: `@font-face{...src:url(data:font/woff2;base64,)}`.
    expect(() => buildGlyphAtlasFontFaceCss("")).toThrow(/needs the atlas WOFF2 payload/);
  });

  it("loadGlyphAtlasFontFaceCss is the awaited export path and inlines the real payload", async () => {
    const css = await loadGlyphAtlasFontFaceCss();
    expect(css).toContain(`font-family:"${GLYPH_FONT_ATLAS.family}"`);
    expect(css).toMatch(/src:url\(data:font\/woff2;base64,[A-Za-z0-9+/=]{1000,}\) format\("woff2"\)/);
  });

  it("builds an override-colors block keyed by palette POSITION", () => {
    const css = buildGlyphAtlasFontPaletteValuesCss("--my-palette", ["#ff0000", "#00ff00", "#0000ff"]);
    expect(css).toContain("@font-palette-values --my-palette");
    expect(css).toContain("override-colors:0 #ff0000, 1 #00ff00, 2 #0000ff");
  });

  it("rejects a palette name that isn't a CSS custom ident", () => {
    expect(() => buildGlyphAtlasFontPaletteValuesCss("my-palette", ["#ff0000"])).toThrow(TypeError);
  });

  it("rejects an empty palette", () => {
    expect(() => buildGlyphAtlasFontPaletteValuesCss("--p", [])).toThrow(RangeError);
  });

  it("rejects a palette larger than maxPaletteSize", () => {
    const tooMany = Array.from({ length: GLYPH_FONT_ATLAS.maxPaletteSize + 1 }, (_, i) => `#${(i % 16).toString(16).repeat(6)}`);
    expect(() => buildGlyphAtlasFontPaletteValuesCss("--p", tooMany)).toThrow(RangeError);
  });

  it("rejects a non-hex color", () => {
    expect(() => buildGlyphAtlasFontPaletteValuesCss("--p", ["red"])).toThrow(TypeError);
  });
});
