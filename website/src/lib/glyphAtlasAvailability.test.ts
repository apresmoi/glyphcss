// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { GLYPH_FONT_ATLAS, glyphAtlasCodePoint } from "glyphcss";
import { computeGlyphAtlasAvailability, type GlyphAtlasGateInputs } from "./glyphAtlasAvailability";

const BASE_GATE: GlyphAtlasGateInputs = { useColors: true, charMode: "ascii" };

function preOf(html: string): HTMLElement {
  const pre = document.createElement("pre");
  pre.innerHTML = html;
  return pre;
}

describe("computeGlyphAtlasAvailability — structural (config-level) gates", () => {
  it("is unavailable when useColors is off", () => {
    const result = computeGlyphAtlasAvailability(preOf("##"), { ...BASE_GATE, useColors: false });
    expect(result.reason).not.toBeNull();
    expect(result.reason).toContain("colors");
  });

  it("is unavailable for a non-ascii charMode", () => {
    const result = computeGlyphAtlasAvailability(preOf("##"), { ...BASE_GATE, charMode: "braille" });
    expect(result.reason).toContain("braille");
  });

  it("is unavailable for semantic glyph output", () => {
    const result = computeGlyphAtlasAvailability(preOf("##"), { ...BASE_GATE, glyphOutput: "semantic" });
    expect(result.reason).toContain("semantic");
  });

  it("is unavailable when a solid weight ramp is active", () => {
    const result = computeGlyphAtlasAvailability(preOf("##"), { ...BASE_GATE, solidWeightRampActive: true });
    expect(result.reason).toContain("weight ramp");
  });

  it("is unavailable (not thrown) for a null pre", () => {
    const result = computeGlyphAtlasAvailability(null, BASE_GATE);
    expect(result.reason).not.toBeNull();
  });

  it("is unavailable for an empty pre", () => {
    const result = computeGlyphAtlasAvailability(preOf(""), BASE_GATE);
    expect(result.reason).not.toBeNull();
  });
});

describe("computeGlyphAtlasAvailability — content-level gate (real isGlyphInFontAtlas check)", () => {
  it("is available for a small, uniform-glyph, single-color render", () => {
    const pre = preOf('<span style="color:#336699">####</span>\n<span style="color:#336699">####</span>');
    expect(computeGlyphAtlasAvailability(pre, BASE_GATE).reason).toBeNull();
  });

  it("is available with multiple distinct colors", () => {
    const pre = preOf('<span style="color:#111111">##</span><span style="color:#222222">@@</span>');
    expect(computeGlyphAtlasAvailability(pre, BASE_GATE).reason).toBeNull();
  });

  it("is unavailable when a rendered glyph is outside the universal atlas set", () => {
    // U+1F600 (an emoji) is never in the checked-in universal glyph set.
    const pre = preOf('<span style="color:#336699">\u{1F600}</span>');
    const result = computeGlyphAtlasAvailability(pre, BASE_GATE);
    expect(result.reason).not.toBeNull();
    expect(result.reason).toContain("glyph");
  });

  it("stays available far past the atlas's maxPaletteSize distinct colors — glyphcss quantizes", () => {
    let html = "";
    for (let i = 0; i < GLYPH_FONT_ATLAS.maxPaletteSize * 4; i++) {
      const hex = `#${i.toString(16).padStart(6, "0")}`;
      html += `<span style="color:${hex}">#</span>`;
    }
    expect(computeGlyphAtlasAvailability(preOf(html), BASE_GATE).reason).toBeNull();
  });

  it("is available for plain text with no spans — the check never looks at color", () => {
    expect(computeGlyphAtlasAvailability(preOf("####"), BASE_GATE).reason).toBeNull();
  });

  it("is available for an already-atlas-encoded pre (zero spans, PUA code points)", () => {
    // Regression guard for the removed "freeze once atlas-encoded" hack: the
    // predicate decodes PUA back to plain glyphs, so an atlas render must not
    // read as "not covered by the atlas" and flap the control back to spans.
    const encoded = ([["#", 0], ["@", 3], [".", 7]] as const).map(([glyph, slot]) => {
      const codePoint = glyphAtlasCodePoint(glyph, slot);
      expect(codePoint).toBeDefined();
      return String.fromCodePoint(codePoint!);
    }).join("");
    const pre = document.createElement("pre");
    pre.textContent = encoded;
    expect(pre.querySelector("span")).toBeNull();
    expect(computeGlyphAtlasAvailability(pre, BASE_GATE).reason).toBeNull();
  });

  it("blank cells never force unavailability", () => {
    const pre = preOf('<span style="color:#336699">#  #</span>');
    expect(computeGlyphAtlasAvailability(pre, BASE_GATE).reason).toBeNull();
  });
});
