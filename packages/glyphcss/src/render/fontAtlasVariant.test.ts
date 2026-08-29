/**
 * The two shipped atlas variants share one PUA range with different glyph
 * moduli, so nothing downstream can decode a code point without knowing which
 * variant produced it. These cover the two places that knowledge is carried:
 * `glyphAtlasForFamily` (the `<pre>`'s pinned `font-family`) and the payload
 * registry's atlas-identity key.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  decodeGlyphAtlasText,
  glyphAtlasCodePoint,
  glyphAtlasForFamily,
  glyphAtlasFontLoadState,
  loadGlyphAtlasFontFaceCss,
  loadGlyphAtlasFontPayload,
  setGlyphAtlasFontPayloadImportForTests,
  GLYPH_FONT_ATLAS,
  GLYPH_FONT_ATLAS_ASCII,
  type GlyphFontAtlas,
} from "./fontAtlas";

describe("glyphAtlasForFamily", () => {
  it("resolves each shipped variant from the font stack the renderer pins", () => {
    expect(glyphAtlasForFamily(`"${GLYPH_FONT_ATLAS.family}", monospace`)).toBe(GLYPH_FONT_ATLAS);
    expect(glyphAtlasForFamily(`"${GLYPH_FONT_ATLAS_ASCII.family}", monospace`)).toBe(GLYPH_FONT_ATLAS_ASCII);
  });

  it("does not resolve the ASCII family to the universal atlas whose name prefixes it", () => {
    expect(GLYPH_FONT_ATLAS_ASCII.family.startsWith(GLYPH_FONT_ATLAS.family)).toBe(true);
    expect(glyphAtlasForFamily(GLYPH_FONT_ATLAS_ASCII.family)).toBe(GLYPH_FONT_ATLAS_ASCII);
  });

  it("accepts unquoted, single-quoted and later-in-the-stack entries", () => {
    expect(glyphAtlasForFamily(GLYPH_FONT_ATLAS.family)).toBe(GLYPH_FONT_ATLAS);
    expect(glyphAtlasForFamily(`'${GLYPH_FONT_ATLAS_ASCII.family}'`)).toBe(GLYPH_FONT_ATLAS_ASCII);
    expect(glyphAtlasForFamily(`Menlo, "${GLYPH_FONT_ATLAS_ASCII.family}"`)).toBe(GLYPH_FONT_ATLAS_ASCII);
  });

  it("returns undefined for a stack naming no shipped atlas", () => {
    expect(glyphAtlasForFamily("Menlo, monospace")).toBeUndefined();
    expect(glyphAtlasForFamily("")).toBeUndefined();
    expect(glyphAtlasForFamily(null)).toBeUndefined();
  });

  it("is the key a correct decode needs: the same code point means two glyphs", () => {
    const cp = glyphAtlasCodePoint("A", 1, GLYPH_FONT_ATLAS_ASCII)!;
    const text = String.fromCodePoint(cp);
    expect(decodeGlyphAtlasText(text, GLYPH_FONT_ATLAS_ASCII)).toBe("A");
    expect(decodeGlyphAtlasText(text, GLYPH_FONT_ATLAS)).not.toBe("A");
    expect(decodeGlyphAtlasText(text, glyphAtlasForFamily(`"${GLYPH_FONT_ATLAS_ASCII.family}", monospace`)!)).toBe("A");
  });
});

describe("payload registry — keyed by atlas identity, not family name", () => {
  afterEach(() => {
    setGlyphAtlasFontPayloadImportForTests(null);
    vi.restoreAllMocks();
  });

  it("refuses to hand a foreign atlas the shipped WOFF2 just because its family collides", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // A caller-built atlas reusing a shipped family name: its glyph indices are
    // its own, so the shipped font would silently paint the wrong glyphs.
    const foreign: GlyphFontAtlas = Object.freeze({
      ...GLYPH_FONT_ATLAS,
      glyphs: ["!", "?"],
      glyphCount: 2,
      maxPaletteSize: 4,
    });

    expect(await loadGlyphAtlasFontPayload(foreign)).toBeNull();
    expect(glyphAtlasFontLoadState(foreign)).toBe("failed");
    expect(warn).toHaveBeenCalled();
  });

  it("still loads each shipped variant's own payload", async () => {
    setGlyphAtlasFontPayloadImportForTests(async () => ({ GLYPH_FONT_ATLAS_WOFF2_BASE64: "UNIVERSAL" }));
    expect(await loadGlyphAtlasFontPayload(GLYPH_FONT_ATLAS)).toBe("UNIVERSAL");
  });

  // The build-time sibling of `ensureGlyphAtlasFontFaceStyles`, and the one
  // AGENTS.md points a DOM-less `compileScene`/SSR caller at. It stamps
  // `atlas.family` onto whatever payload it loaded, so loading the default
  // would emit the ASCII family over the universal font's bytes and every
  // baked PUA point would resolve against the wrong glyph indices.
  it("inlines each atlas's OWN payload under its own family", async () => {
    const universal = await loadGlyphAtlasFontFaceCss(GLYPH_FONT_ATLAS);
    const ascii = await loadGlyphAtlasFontFaceCss(GLYPH_FONT_ATLAS_ASCII);

    expect(universal).toContain(`font-family:"${GLYPH_FONT_ATLAS.family}"`);
    expect(ascii).toContain(`font-family:"${GLYPH_FONT_ATLAS_ASCII.family}"`);

    const payloadOf = (css: string) => css.split("base64,")[1]!.split(")")[0]!;
    expect(payloadOf(universal)).not.toBe(payloadOf(ascii));
  });
});
