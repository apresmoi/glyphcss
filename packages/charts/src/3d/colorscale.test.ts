import { describe, expect, it } from "vitest";
import {
  glyphChart3dBandColor,
  glyphChart3dBandIndex,
  hexLStar,
  interpolateGlyphChart3dAnchors,
  resolveGlyphChart3dColorscaleAnchors,
} from "./colorscale";
import { GLYPH_CHART_3D_COLORSCALE_NAMES } from "./types";

describe("resolveGlyphChart3dColorscaleAnchors", () => {
  it("defaults to viridis", () => {
    expect(resolveGlyphChart3dColorscaleAnchors(undefined).length).toBeGreaterThan(1);
  });
  it("resolves every named preset", () => {
    for (const name of ["viridis", "cividis", "magma", "greys"] as const) {
      expect(resolveGlyphChart3dColorscaleAnchors(name).length).toBeGreaterThanOrEqual(2);
    }
  });
  it("accepts a custom anchor array", () => {
    expect(resolveGlyphChart3dColorscaleAnchors(["#000000", "#ffffff"])).toEqual(["#000000", "#ffffff"]);
  });
  it("rejects an unknown preset name", () => {
    expect(() => resolveGlyphChart3dColorscaleAnchors("not-a-scale" as never)).toThrow(/bad-options/);
  });
  it("rejects a custom array with a non-canonical hex", () => {
    expect(() => resolveGlyphChart3dColorscaleAnchors(["#FFFFFF", "#000000"] as never)).toThrow(/bad-options/);
  });
  it("rejects a single-anchor custom array", () => {
    expect(() => resolveGlyphChart3dColorscaleAnchors(["#000000"] as never)).toThrow(/bad-options/);
  });
  it("MUTATION (P2-7): rejects a custom colorscale whose lightness isn't monotone (white -> black -> white)", () => {
    expect(() => resolveGlyphChart3dColorscaleAnchors(["#ffffff", "#000000", "#ffffff"]))
      .toThrow(expect.objectContaining({ code: "colorscale-not-monotone" }));
  });
  it("accepts a monotone-lightness custom colorscale (black -> grey -> white)", () => {
    expect(resolveGlyphChart3dColorscaleAnchors(["#000000", "#808080", "#ffffff"])).toEqual(["#000000", "#808080", "#ffffff"]);
  });
  it("every named preset is monotone in CIELAB L* across 9 bands (P2-7)", () => {
    for (const name of GLYPH_CHART_3D_COLORSCALE_NAMES) {
      const anchors = resolveGlyphChart3dColorscaleAnchors(name);
      const bands = 9;
      const lightness = Array.from({ length: bands }, (_, i) => hexLStar(glyphChart3dBandColor(anchors, i, bands)));
      let asc = true, desc = true;
      for (let i = 1; i < lightness.length; i++) {
        if (lightness[i]! < lightness[i - 1]!) asc = false;
        if (lightness[i]! > lightness[i - 1]!) desc = false;
      }
      expect(asc || desc, `"${name}" L* sequence not monotone: ${lightness.map((v) => v.toFixed(1)).join(", ")}`).toBe(true);
    }
  });
});

describe("interpolateGlyphChart3dAnchors", () => {
  it("returns the first anchor at t=0 and the last at t=1", () => {
    const anchors = ["#000000", "#808080", "#ffffff"];
    expect(interpolateGlyphChart3dAnchors(anchors, 0)).toBe("#000000");
    expect(interpolateGlyphChart3dAnchors(anchors, 1)).toBe("#ffffff");
  });
  it("clamps outside [0, 1]", () => {
    const anchors = ["#000000", "#ffffff"];
    expect(interpolateGlyphChart3dAnchors(anchors, -5)).toBe("#000000");
    expect(interpolateGlyphChart3dAnchors(anchors, 5)).toBe("#ffffff");
  });
});

describe("glyphChart3dBandIndex", () => {
  it("quantizes t into [0, bands - 1]", () => {
    expect(glyphChart3dBandIndex(0, 4)).toBe(0);
    expect(glyphChart3dBandIndex(0.99, 4)).toBe(3);
    expect(glyphChart3dBandIndex(1, 4)).toBe(3);
  });
  it("is monotone non-decreasing in t", () => {
    let last = -1;
    for (let t = 0; t <= 1; t += 0.01) {
      const idx = glyphChart3dBandIndex(t, 9);
      expect(idx).toBeGreaterThanOrEqual(last);
      last = idx;
    }
  });
  it("collapses to band 0 when bands <= 1", () => {
    expect(glyphChart3dBandIndex(0.7, 1)).toBe(0);
  });
});

describe("glyphChart3dBandColor", () => {
  it("is deterministic for the same inputs", () => {
    const anchors = resolveGlyphChart3dColorscaleAnchors("viridis");
    expect(glyphChart3dBandColor(anchors, 3, 9)).toBe(glyphChart3dBandColor(anchors, 3, 9));
  });
  it("returns a canonical lowercase hex", () => {
    const anchors = resolveGlyphChart3dColorscaleAnchors("magma");
    for (let i = 0; i < 9; i++) expect(glyphChart3dBandColor(anchors, i, 9)).toMatch(/^#[0-9a-f]{6}$/);
  });
});
