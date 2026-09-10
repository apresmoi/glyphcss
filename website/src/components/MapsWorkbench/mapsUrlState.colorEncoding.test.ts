// @vitest-environment happy-dom
/**
 * `/maps`'s `colorEncoding` URL persistence, mirroring the exact
 * "/synth"/"/wordart" coverage in `website/src/lib/glyphColorEncodingDefault.test.ts`
 * (see that file's own doc for why each case exists — an explicit URL value
 * must always win over the feature-detected default, and the codec's own
 * omission sentinel must stay the fixed "spans" so a shared link decodes the
 * same regardless of which engine encoded it). That shared file runs in
 * vitest's plain `node` environment because `synthUrlState.ts`/
 * `wordartUrlState.ts` are pure state modules with no DOM dependency; this
 * file needs `happy-dom` instead because `mapsUrlState.ts` imports
 * `mapsKit.tsx`, which transitively imports `../Dock` ->
 * `Dock/folders/useRenderingFolder.ts`, which calls
 * `ensureCalibratedPalette()` at IMPORT TIME (a real-browser-only canvas
 * measurement) — same stub `MapsWorkbench.atlasAvailability.test.ts` and
 * `mapsAtlasWiring.repro.test.tsx` use for the identical reason.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@glyphcss/effects", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@glyphcss/effects")>();
  return {
    ...actual,
    calibrateGlyphRamp: () => ({ ramp: " .:-=+*#%@", steps: [] }),
  };
});

import { defaultGlyphColorEncoding, resetGlyphFontPaletteSupportForTests } from "../../lib/glyphColorEncodingDefault";
import { MAPS_PARAM, MAPS_URL_DEFAULTS, mapsCodec, readInitialMapsState } from "./mapsUrlState";

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

function setUrl(search: string): void {
  window.history.replaceState(null, "", search ? `/maps?${search}` : "/maps");
}

afterEach(() => {
  delete (globalThis as { CSS?: unknown }).CSS;
  resetGlyphFontPaletteSupportForTests();
  window.history.replaceState(null, "", "/maps");
  vi.restoreAllMocks();
});

describe("/maps: colorEncoding codec — omission sentinel stays \"spans\"", () => {
  it("the codec's own default stays \"spans\" so links stay portable across engines", () => {
    // The codec default is the OMISSION sentinel. If it followed the browser,
    // a link shared from a supporting engine would omit "atlas" and decode to
    // "spans" on a non-supporting one — the value would silently change hands.
    expect(MAPS_URL_DEFAULTS.colorEncoding).toBe("spans");
    stubCssSupports(() => true);
    const packed = mapsCodec.encode({ ...MAPS_URL_DEFAULTS, colorEncoding: "atlas" });
    expect(packed).toContain("E1"); // token "E", enum index 1 = "atlas" (see COLOR_ENCODING_VALUES)
  });

  it("round-trips \"atlas\" through the raw codec", () => {
    const packed = mapsCodec.encode({ ...MAPS_URL_DEFAULTS, colorEncoding: "atlas" });
    expect(mapsCodec.decode(packed).colorEncoding).toBe("atlas");
  });

  it("a link that OMITS the token decodes (at the raw codec level) with no colorEncoding key at all — \"no preference\", not pinned spans", () => {
    stubCssSupports(() => true);
    const packed = mapsCodec.encode({ ...MAPS_URL_DEFAULTS, colorEncoding: "spans" });
    // "spans" IS the codec default, so it is omitted from the packed string.
    expect(mapsCodec.decode(packed).colorEncoding).toBeUndefined();
  });
});

describe("/maps: readInitialMapsState — the detected default applies only when the URL carries no choice", () => {
  it("a link with no encoding token takes the DETECTED default, not a hardcoded one", () => {
    const packed = mapsCodec.encode({ ...MAPS_URL_DEFAULTS, colorEncoding: "spans" });
    setUrl(`${MAPS_PARAM}=${packed}`);

    stubCssSupports(() => true);
    expect(readInitialMapsState().colorEncoding).toBe("atlas");

    stubCssSupports(() => false);
    expect(readInitialMapsState().colorEncoding).toBe("spans");
  });

  it("an explicit \"atlas\" in the link survives a NON-atlas browser", () => {
    stubCssSupports(() => true);
    const packed = mapsCodec.encode({ ...MAPS_URL_DEFAULTS, colorEncoding: "atlas" });
    setUrl(`${MAPS_PARAM}=${packed}`);

    stubCssSupports(() => false);
    expect(readInitialMapsState().colorEncoding).toBe("atlas");
  });

  it("a fresh visit (no URL param at all) picks up the detected default, same as an omitted token", () => {
    setUrl("");
    stubCssSupports(() => true);
    expect(readInitialMapsState().colorEncoding).toBe("atlas");
    stubCssSupports(() => false);
    expect(readInitialMapsState().colorEncoding).toBe("spans");
  });

  it("this module's own default fallback (MAPS_URL_DEFAULTS.colorEncoding) is never surfaced directly — readInitialMapsState always resolves either an explicit URL value or the freshly-detected default", () => {
    setUrl("");
    stubCssSupports(() => true);
    expect(readInitialMapsState().colorEncoding).not.toBe(MAPS_URL_DEFAULTS.colorEncoding);
    expect(readInitialMapsState().colorEncoding).toBe(defaultGlyphColorEncoding());
  });
});
