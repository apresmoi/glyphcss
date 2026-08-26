/**
 * The feature-detected site default, and the rule that must survive it:
 * **an explicit URL value always wins.**
 *
 * These run in vitest's `node` environment, where there is no `CSS` global at
 * all — so every case here has to install its own stub. That is the point: a
 * test that just called `defaultGlyphColorEncoding()` and asserted `"spans"`
 * would pass for the wrong reason (no `CSS`), and would keep passing if the
 * detection were deleted.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  defaultGlyphColorEncoding,
  resetGlyphFontPaletteSupportForTests,
  supportsGlyphFontPalette,
} from "./glyphColorEncodingDefault";
import { decodeSynthUrlState, encodeSynthUrlState, SYNTH_PARAM_DEFAULTS, SYNTH_URL_DEFAULTS } from "../components/SynthWorkbench/synthUrlState";
import { WORD_ART_DEFAULTS, wordArtCodec } from "../components/WordArtWorkbench/wordartUrlState";

type SupportsFn = (property: string, value: string) => boolean;

function stubCssSupports(supports: SupportsFn | null): { calls: [string, string][] } {
  const calls: [string, string][] = [];
  if (supports === null) {
    delete (globalThis as { CSS?: unknown }).CSS;
  } else {
    (globalThis as { CSS?: unknown }).CSS = {
      supports: (property: string, value: string) => {
        calls.push([property, value]);
        return supports(property, value);
      },
    };
  }
  resetGlyphFontPaletteSupportForTests();
  return { calls };
}

afterEach(() => {
  delete (globalThis as { CSS?: unknown }).CSS;
  resetGlyphFontPaletteSupportForTests();
  vi.restoreAllMocks();
});

describe("defaultGlyphColorEncoding — feature detection", () => {
  it("defaults to atlas when the engine parses font-palette: <dashed-ident>", () => {
    const { calls } = stubCssSupports((property, value) => property === "font-palette" && value === "--x");
    expect(supportsGlyphFontPalette()).toBe(true);
    expect(defaultGlyphColorEncoding()).toBe("atlas");
    // The dashed-ident form specifically: `font-palette: normal|light|dark`
    // alone would leave every cell in the font's baked CPAL hue ramp, since
    // `override-colors` is reached through a custom palette identifier.
    expect(calls).toContainEqual(["font-palette", "--x"]);
  });

  it("defaults to spans when font-palette is unsupported", () => {
    stubCssSupports(() => false);
    expect(defaultGlyphColorEncoding()).toBe("spans");
  });

  it("defaults to spans when there is no CSS.supports at all (uncertain, not assumed)", () => {
    stubCssSupports(null);
    expect(defaultGlyphColorEncoding()).toBe("spans");
  });

  it("never reads a user agent string", () => {
    const nav = { get userAgent(): string { throw new Error("user-agent sniffed"); } };
    vi.stubGlobal("navigator", nav);
    stubCssSupports(() => true);
    expect(() => defaultGlyphColorEncoding()).not.toThrow();
    vi.unstubAllGlobals();
  });

  it("memoizes — pages call it during render", () => {
    const { calls } = stubCssSupports(() => true);
    defaultGlyphColorEncoding();
    defaultGlyphColorEncoding();
    defaultGlyphColorEncoding();
    expect(calls.length).toBe(1);
  });
});

describe("URL codecs — an explicit value still beats the detected default", () => {
  it("/synth: the codec's own default stays \"spans\" so links stay portable across engines", () => {
    // The codec default is the OMISSION sentinel. If it followed the browser,
    // a link shared from a supporting engine would omit "atlas" and decode to
    // "spans" on a non-supporting one — the value would silently change hands.
    expect(SYNTH_URL_DEFAULTS.colorEncoding).toBe("spans");
    stubCssSupports(() => true);
    const packed = encodeSynthUrlState({ ...representativeSynthState(), colorEncoding: "atlas" });
    expect(packed).toContain("E1"); // token "E", enum index 1 = "atlas"
  });

  it("/synth: a link that OMITS the token reads as \"no preference\", not as pinned spans", () => {
    stubCssSupports(() => true);
    const packed = encodeSynthUrlState({ ...representativeSynthState(), colorEncoding: "spans" });
    // "spans" IS the codec default, so it is omitted from the packed string
    // and this link carries no choice at all — which is precisely the case the
    // detected default is supposed to fill in. Documented, not asserted away:
    // a link shared from a spans-era page reads as "no preference", and there
    // is no token that could distinguish it from one saved today.
    expect(decodeSynthUrlState(packed).colorEncoding).toBe("atlas");
  });

  it("/synth: an explicit \"atlas\" in the link survives a NON-atlas browser", () => {
    stubCssSupports(() => true);
    const packed = encodeSynthUrlState({ ...representativeSynthState(), colorEncoding: "atlas" });
    stubCssSupports(() => false);
    expect(decodeSynthUrlState(packed).colorEncoding).toBe("atlas");
  });

  it("/synth: a link with no encoding token takes the DETECTED default, not a hardcoded one", () => {
    const packed = encodeSynthUrlState({ ...representativeSynthState(), colorEncoding: "spans" });
    stubCssSupports(() => true);
    expect(decodeSynthUrlState(packed).colorEncoding).toBe("atlas");
    stubCssSupports(() => false);
    expect(decodeSynthUrlState(packed).colorEncoding).toBe("spans");
  });

  it("/wordart: the codec default stays \"spans\" and an explicit value round-trips", () => {
    expect(WORD_ART_DEFAULTS.colorEncoding).toBe("spans");
    stubCssSupports(() => true);
    const packed = wordArtCodec.encode({ ...WORD_ART_DEFAULTS, colorEncoding: "atlas" });
    stubCssSupports(() => false);
    expect(wordArtCodec.decode(packed).colorEncoding).toBe("atlas");
  });
});

/** Minimum shape `encodeSynthUrlState` accepts — it packs `params` and `lighting` itself. */
function representativeSynthState() {
  return {
    shape: SYNTH_URL_DEFAULTS.shape,
    params: { ...SYNTH_PARAM_DEFAULTS },
    timeScale: SYNTH_URL_DEFAULTS.timeScale,
    density: SYNTH_URL_DEFAULTS.density,
    colorTolerance: SYNTH_URL_DEFAULTS.colorTolerance,
    colorEncoding: SYNTH_URL_DEFAULTS.colorEncoding,
    lighting: {
      azimuth: SYNTH_URL_DEFAULTS.lightAzimuth,
      elevation: SYNTH_URL_DEFAULTS.lightElevation,
      keyIntensity: SYNTH_URL_DEFAULTS.lightKeyIntensity,
      keyColor: SYNTH_URL_DEFAULTS.lightKeyColor,
      ambient: SYNTH_URL_DEFAULTS.lightAmbient,
    },
    voiceSlots: [1],
  };
}
