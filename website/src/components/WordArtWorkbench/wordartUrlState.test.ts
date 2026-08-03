import { describe, expect, it } from "vitest";
import { WORD_ART_DEFAULTS, wordArtCodec, type WordArtUrlState } from "./wordartUrlState";
import { encodeEffectParamsPacked } from "../../lib/urlState";
import { galleryEffectDefaultParams, galleryEffectDefinition } from "../GalleryWorkbench/effects";

// The representative state from the task's own measurement: text, profile,
// depth, 3 colors, curve, tilt, density, hiddenLines, an effect id + timeScale
// + params overrides.
function representativeState(): WordArtUrlState {
  const definition = galleryEffectDefinition("matrix-rain")!;
  const defaults = galleryEffectDefaultParams(definition);
  const overrides = { glyphs: "GLYPH01", speedMin: 5.25, speedMax: 25.25, trail: 45, density: 0.88, seed: 306, colorMode: "monochrome", color: "#00d149", headColor: "#baffd6" };
  return {
    ...WORD_ART_DEFAULTS,
    text: "Glyph\nCSS",
    profile: "flat",
    depth: 20,
    color: "#1d6b3a",
    sideColor: "#0f3a20",
    backColor: "#0f3a20",
    curveSegments: 6,
    tilt: 22.5,
    density: 2.5,
    hiddenLines: "hide",
    renderMode: "solid",
    effectId: "matrix-rain",
    effectBlend: "over",
    effectTimeScale: 2.5,
    effectParams: encodeEffectParamsPacked(definition.parameterSchema, defaults, overrides),
  };
}

describe("wordArtCodec", () => {
  it("has no duplicate/invalid tokens (createUrlCodec would have thrown at import time)", () => {
    expect(wordArtCodec.fields.length).toBeGreaterThan(50);
  });

  it("omits all fields equal to default", () => {
    expect(wordArtCodec.encode(WORD_ART_DEFAULTS)).toBe("p1");
  });

  it("round-trips the representative state exactly", () => {
    const state = representativeState();
    const decoded = wordArtCodec.decode(wordArtCodec.encode(state));
    expect({ ...WORD_ART_DEFAULTS, ...decoded }).toEqual(state);
  });

  it("packs the representative state to well under 150 chars (was 419 chars verbose)", () => {
    const packed = wordArtCodec.encode(representativeState());
    expect(packed.length).toBeLessThan(150);
    // eslint-disable-next-line no-console
    console.log(`wordart representative packed length: ${packed.length}`);
  });

  it("round-trips charMode \"quadrant\" (appended enum value)", () => {
    const state = { ...WORD_ART_DEFAULTS, charMode: "quadrant" as const };
    expect(wordArtCodec.decode(wordArtCodec.encode(state)).charMode).toBe("quadrant");
  });

  it("round-trips unicode text", () => {
    const state = { ...WORD_ART_DEFAULTS, text: "héllo\n世界 🎉" };
    expect(wordArtCodec.decode(wordArtCodec.encode(state)).text).toBe(state.text);
  });

  it("round-trips the custom bezier profile", () => {
    const state: WordArtUrlState = { ...WORD_ART_DEFAULTS, profile: "custom", bezier: [0.12, 0.87, 0.33, 0.05] };
    const decoded = wordArtCodec.decode(wordArtCodec.encode(state));
    expect(decoded.bezier).toEqual(state.bezier);
    expect(decoded.profile).toBe("custom");
  });

  it("never throws on truncated or garbage input", () => {
    const full = wordArtCodec.encode(representativeState());
    for (let i = 0; i < full.length; i++) {
      expect(() => wordArtCodec.decode(full.slice(0, i))).not.toThrow();
    }
    for (const garbage of ["", "%%%invalid%%%", "p9futureversion", null, undefined]) {
      expect(() => wordArtCodec.decode(garbage as string | null)).not.toThrow();
    }
  });

  it("encode(decode(x)) === x", () => {
    const state = representativeState();
    const packed = wordArtCodec.encode(state);
    const roundTripped = wordArtCodec.encode({ ...WORD_ART_DEFAULTS, ...wordArtCodec.decode(packed) });
    expect(roundTripped).toBe(packed);
  });
});
