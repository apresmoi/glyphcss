// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { GLYPH_FONT_ATLAS } from "glyphcss";
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
    expect(result.atlasPalette).toBeUndefined();
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
    expect(result.atlasPalette).toBeUndefined();
  });

  it("is unavailable for an empty pre", () => {
    const result = computeGlyphAtlasAvailability(preOf(""), BASE_GATE);
    expect(result.reason).not.toBeNull();
  });
});

describe("computeGlyphAtlasAvailability — content-level gate (real isGlyphAtlasEncodable check)", () => {
  it("is available for a small, uniform-glyph, single-color render and returns the exact rendered palette", () => {
    const pre = preOf('<span style="color:#336699">####</span>\n<span style="color:#336699">####</span>');
    const result = computeGlyphAtlasAvailability(pre, BASE_GATE);
    expect(result.reason).toBeNull();
    expect(result.atlasPalette).toEqual(["#336699"]);
  });

  it("is available with multiple distinct colors, all captured in the derived palette (first-seen order)", () => {
    const pre = preOf('<span style="color:#111111">##</span><span style="color:#222222">@@</span>');
    const result = computeGlyphAtlasAvailability(pre, BASE_GATE);
    expect(result.reason).toBeNull();
    expect(result.atlasPalette).toEqual(["#111111", "#222222"]);
  });

  it("is unavailable when a rendered glyph is outside the universal atlas set", () => {
    // U+1F600 (an emoji) is never in the checked-in universal glyph set.
    const pre = preOf('<span style="color:#336699">\u{1F600}</span>');
    const result = computeGlyphAtlasAvailability(pre, BASE_GATE);
    expect(result.reason).not.toBeNull();
    expect(result.reason).toContain("glyph");
    expect(result.atlasPalette).toBeUndefined();
  });

  it("is unavailable when the render exceeds the atlas's maxPaletteSize distinct colors", () => {
    let html = "";
    for (let i = 0; i < GLYPH_FONT_ATLAS.maxPaletteSize + 1; i++) {
      const hex = `#${i.toString(16).padStart(6, "0")}`;
      html += `<span style="color:${hex}">#</span>`;
    }
    const result = computeGlyphAtlasAvailability(preOf(html), BASE_GATE);
    expect(result.reason).not.toBeNull();
    expect(result.reason).toContain("palette budget");
    expect(result.atlasPalette).toBeUndefined();
  });

  it("is unavailable when there is no color to encode (plain text, no spans)", () => {
    const result = computeGlyphAtlasAvailability(preOf("####"), BASE_GATE);
    expect(result.reason).toContain("no color");
  });

  it("blank cells never force unavailability and never enter the derived palette", () => {
    const pre = preOf('<span style="color:#336699">#  #</span>');
    const result = computeGlyphAtlasAvailability(pre, BASE_GATE);
    expect(result.reason).toBeNull();
    expect(result.atlasPalette).toEqual(["#336699"]);
  });
});
