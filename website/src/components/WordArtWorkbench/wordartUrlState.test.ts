// @vitest-environment happy-dom
//
// happy-dom (rather than the file-default `node` environment) is needed for
// the legacy-link regression block below, which exercises the REAL
// entry-point functions (`readInitialWordArtState`/
// `wordArtEffectStateFromUrlState`) through an actual `window.location` —
// same reasoning as synthUrlState.e2e.test.ts. Every other test in this
// file is a pure `wordArtCodec` call with no `window` dependency, so the
// environment switch doesn't change their behavior.
import { describe, expect, it } from "vitest";
import {
  WORD_ART_DEFAULTS,
  wordArtCodec,
  readInitialWordArtState,
  wordArtEffectStateFromUrlState,
  type WordArtUrlState,
} from "./wordartUrlState";
import {
  createUrlCodec,
  decodeEffectParamsPacked,
  encodeEffectParamsPacked,
  encodeEffectParamsPackedLegacy,
} from "../../lib/urlState";
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
    expect(wordArtCodec.encode(WORD_ART_DEFAULTS)).toBe("p2");
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

// ── Compact codec rewrite: WORD_ART_SCHEMA_VERSION 1 -> 2 (website/src/lib/
//    urlState.ts's run/list token grammar, same shared change as /synth's
//    v4 -> v5 and gallery's fx v1 -> v2) ────────────────────────────────────
// Every other field is unchanged; only the nested `effectParams` field's
// wire format changed, so a "1"-tagged `?w=` link's `effectParams` must
// decode through the LEGACY pair (`decodeEffectParamsPackedLegacy`) even
// though its outer field list is identical — see
// `wordArtEffectStateFromUrlState`'s `raw[1] === "1"` dispatch.
describe("wordArtCodec — v1 legacy decode (compact codec rewrite)", () => {
  it("a genuinely v1-tagged link decodes identically to the equivalent v2 link", () => {
    // Same representative state, but the OUTER codec is forced to encode at
    // version "1" the way the pre-bump write path once did, and the nested
    // `effectParams` is packed with the legacy escape grammar.
    const state = representativeState();
    const legacyCodec = createUrlCodec<WordArtUrlState>("1", wordArtCodec.fields);
    const definition = galleryEffectDefinition("matrix-rain")!;
    const defaults = galleryEffectDefaultParams(definition);
    const overrides = decodeEffectParamsPacked(definition.parameterSchema, state.effectParams);
    const legacyEffectParams = encodeEffectParamsPackedLegacy(definition.parameterSchema, defaults, overrides);
    const legacyPacked = legacyCodec.encode({ ...state, effectParams: legacyEffectParams });
    expect(legacyPacked[1]).toBe("1");

    window.history.replaceState(null, "", `/wordart?w=${encodeURIComponent(legacyPacked)}`);
    const decodedState = readInitialWordArtState();
    const decodedEffect = wordArtEffectStateFromUrlState(decodedState);

    const currentPacked = wordArtCodec.encode(state);
    window.history.replaceState(null, "", `/wordart?w=${encodeURIComponent(currentPacked)}`);
    const currentState = readInitialWordArtState();
    const currentEffect = wordArtEffectStateFromUrlState(currentState);

    expect(decodedState).toEqual(currentState);
    expect(decodedEffect).toEqual(currentEffect);
  });

  // Captured from THIS repo's code BEFORE the v2 compact-codec change landed
  // (a real `wordArtCodec.encode(representativeState())` output on the
  // then-current v1 codec, not hand-built) — the strongest available proof
  // that an already-shared /wordart link keeps decoding to exactly the
  // state it always did.
  const REAL_V1_LINK = "p1p0d1kk15bneK0le00b0le00j16L269D1ph1c1r1V3jagR17.17.GLYPH0151l622t7219822g928ia1b015c9c7ao5y";

  it("decodes the real captured v1 link to exactly its pre-change state", () => {
    expect(REAL_V1_LINK[1]).toBe("1");
    window.history.replaceState(null, "", `/wordart?w=${encodeURIComponent(REAL_V1_LINK)}`);
    const decoded = readInitialWordArtState();
    const expected = representativeState();
    expect(decoded).toEqual(expected);
    const effectState = wordArtEffectStateFromUrlState(decoded);
    expect(effectState.effectId).toBe("matrix-rain");
    expect(effectState.params.glyphs).toBe("GLYPH01");
    expect(effectState.params.speedMin).toBeCloseTo(5.25, 3);
    expect(effectState.params.speedMax).toBeCloseTo(25.25, 3);
    expect(effectState.params.trail).toBeCloseTo(45, 3);
    expect(effectState.params.density).toBeCloseTo(0.88, 3);
    expect(effectState.params.seed).toBeCloseTo(306, 3);
    expect(effectState.params.colorMode).toBe("monochrome");
    expect(effectState.params.color).toBe("#00d149");
    expect(effectState.params.headColor).toBe("#baffd6");
  });

  it("shows the real win on a richer applied effect (field-synth, a shipped preset's full override set)", async () => {
    // matrix-rain's small schema (above) is a worst case for these levers —
    // field-synth's 208-key schema and its typically-repeated per-voice
    // values is the realistic case they're aimed at (a user picking a
    // richer effect on /wordart, not just adjusting text controls).
    const { GlyphCssGraphicsMengerPreset, GlyphFieldSynthEffect: fieldSynthEffect, defaultGlyphEffectParams: defaultParams } = await import("@glyphcss/effects");
    const defaults = defaultParams(fieldSynthEffect) as Record<string, unknown>;
    const overrides = GlyphCssGraphicsMengerPreset.params as Record<string, unknown>;
    const legacyEffectParams = encodeEffectParamsPackedLegacy(fieldSynthEffect.parameterSchema, defaults, overrides);
    const newEffectParams = encodeEffectParamsPacked(fieldSynthEffect.parameterSchema, defaults, overrides);
    const state = { ...WORD_ART_DEFAULTS, text: "Glyph\nCSS", effectId: "field-synth", effectBlend: "over" as const, effectTimeScale: 1 };
    const legacyCodec = createUrlCodec<WordArtUrlState>("1", wordArtCodec.fields);
    const legacyPacked = legacyCodec.encode({ ...state, effectParams: legacyEffectParams });
    const newPacked = wordArtCodec.encode({ ...state, effectParams: newEffectParams });
    expect(newPacked.length).toBeLessThan(legacyPacked.length);
    // eslint-disable-next-line no-console
    console.log(`wordart ?w= (field-synth, Menger cssGraphics overrides): v1 ${legacyPacked.length} chars -> v2 ${newPacked.length} chars`);
  });

  it("re-encodes the representative state at least as short as the captured v1 length", () => {
    // matrix-rain's own parameterSchema is small (well under the compact
    // codec's 58-key direct-index range) and this representative state's 9
    // effect-param overrides share no repeated values, so neither the
    // cheaper index escape nor the run/list tokens have anything to bite on
    // here — an exact tie is the CORRECT outcome for this specific patch,
    // not a regression. The real win shows up on a payload with either a
    // large schema (field-synth, 208 keys — see synthUrlState.test.ts) or
    // genuinely repeated override values.
    const packed = wordArtCodec.encode(representativeState());
    expect(packed[1]).toBe("2");
    expect(packed.length).toBeLessThanOrEqual(REAL_V1_LINK.length);
    // eslint-disable-next-line no-console
    console.log(`wordart representative: v1 ${REAL_V1_LINK.length} chars -> v2 ${packed.length} chars`);
  });
});
