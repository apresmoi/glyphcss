/**
 * The COLR paint probe inside `ensureGlyphAtlasFontFaceStyles`.
 *
 * Every atlas base glyph has a deliberately empty outline, so an engine that
 * loads the font but doesn't paint COLR renders a BLANK grid, and an engine
 * that never applied the font renders tofu. Neither is visible to
 * `CSS.supports("font-palette", "--x")`, and neither can be produced in a
 * headless test by any means other than substituting the canvas — hence the
 * stubbing here. Without these, the probe could be deleted wholesale and the
 * suite would stay green.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { ensureGlyphAtlasFontFaceStyles, resetGlyphAtlasFontFaceStylesForTests } from "./styles";
import { setGlyphAtlasFontPayloadImportForTests } from "../render/fontAtlas";

const FONT_FACE_STYLE_ID = "glyph-atlas-font-face";
const SIZE = 24;

/** Substitute a 2D context whose readback returns one fixed RGB for every pixel. */
function stubCanvas(pixel: [number, number, number] | null): void {
  const realCreate = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation(((tag: string, ...rest: unknown[]) => {
    const el = realCreate(tag as "div", ...(rest as []));
    if (tag !== "canvas") return el;
    (el as HTMLCanvasElement).getContext = (() => {
      if (pixel === null) return null;
      const data = new Uint8ClampedArray(SIZE * SIZE * 4);
      for (let i = 0; i < data.length; i += 4) {
        data[i] = pixel[0];
        data[i + 1] = pixel[1];
        data[i + 2] = pixel[2];
        data[i + 3] = 255;
      }
      return {
        fillStyle: "",
        font: "",
        textBaseline: "",
        fillRect: () => {},
        fillText: () => {},
        getImageData: () => ({ data }),
      };
    }) as HTMLCanvasElement["getContext"];
    return el;
  }) as typeof document.createElement);
}

afterEach(() => {
  vi.restoreAllMocks();
  setGlyphAtlasFontPayloadImportForTests(null);
  resetGlyphAtlasFontFaceStylesForTests();
  document.head.querySelectorAll(`#${FONT_FACE_STYLE_ID}`).forEach((el) => el.remove());
});

describe("ensureGlyphAtlasFontFaceStyles — COLR paint probe", () => {
  it("is ready when the probe paints a chromatic pixel (the colour came from CPAL, not fillStyle)", async () => {
    stubCanvas([26, 242, 89]); // palette slot 0's baked hue
    expect(await ensureGlyphAtlasFontFaceStyles(document)).toBe(true);
    expect(document.getElementById(FONT_FACE_STYLE_ID)).not.toBeNull();
  });

  it("is NOT ready on a COLR-blind engine, where the empty base outlines leave the canvas blank", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    stubCanvas([255, 255, 255]);
    expect(await ensureGlyphAtlasFontFaceStyles(document)).toBe(false);
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/does not paint the colour-font atlas's COLR layers/);
  });

  it("is NOT ready when the font never applied and the probe drew tofu in fillStyle black", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    stubCanvas([0, 0, 0]);
    expect(await ensureGlyphAtlasFontFaceStyles(document)).toBe(false);
  });

  it("stays ready when it cannot conclude (no 2D context) rather than demoting an unmeasurable browser", async () => {
    stubCanvas(null);
    expect(await ensureGlyphAtlasFontFaceStyles(document)).toBe(true);
  });
});

/**
 * The capability the COLR probe structurally CANNOT see.
 *
 * The atlas's baked CPAL palette is itself chromatic (slot 0 is a saturated
 * ramp colour), so an engine that renders COLRv0 but ignores `font-palette` —
 * Chrome 71-100, Firefox 26-106, Safari 12-15.3 — paints a genuinely chromatic
 * glyph and PASSES the canvas probe, then renders the whole scene in the
 * checked-in rainbow instead of the scene's own colours. Canvas cannot observe
 * `font-palette` at all, so no amount of probe tuning closes this; the website
 * had a `CSS.supports` gate for its own default and a library consumer setting
 * `colorEncoding: "atlas"` directly had nothing.
 */
describe("ensureGlyphAtlasFontFaceStyles — the font-palette support gate", () => {
  function stubCssSupports(result: boolean | undefined): string[] {
    const seen: string[] = [];
    const view = document.defaultView!;
    const css = result === undefined
      ? undefined
      : {
          supports: (property: string, value: string) => {
            seen.push(`${property}:${value}`);
            return result;
          },
        };
    Object.defineProperty(view, "CSS", { value: css, configurable: true, writable: true });
    return seen;
  }

  afterEach(() => {
    Object.defineProperty(document.defaultView!, "CSS", { value: undefined, configurable: true, writable: true });
  });

  it("refuses — before importing the payload — on an engine without custom-ident font-palette", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let payloadImports = 0;
    setGlyphAtlasFontPayloadImportForTests(async () => {
      payloadImports++;
      return { GLYPH_FONT_ATLAS_WOFF2_BASE64: "AAAA" };
    });
    stubCanvas([26, 242, 89]); // a real COLR paint: the COLR probe would pass
    const queries = stubCssSupports(false);

    expect(await ensureGlyphAtlasFontFaceStyles(document)).toBe(false);
    expect(document.getElementById(FONT_FACE_STYLE_ID)).toBeNull();
    // The 44KB chunk is never fetched for a browser that could only render the
    // atlas in its baked CPAL rainbow.
    expect(payloadImports).toBe(0);
    // The DASHED-IDENT form specifically: `font-palette: normal|light|dark`
    // alone would still leave every cell on the font's own baked ramp.
    expect(queries).toContain("font-palette:--x");
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/does not support "font-palette" with a custom ident/);
  });

  it("is ready on an engine that does support it", async () => {
    stubCanvas([26, 242, 89]);
    stubCssSupports(true);
    expect(await ensureGlyphAtlasFontFaceStyles(document)).toBe(true);
    expect(document.getElementById(FONT_FACE_STYLE_ID)).not.toBeNull();
  });

  it("stays ready when it cannot conclude (no CSS.supports) rather than demoting an unmeasurable browser", async () => {
    stubCanvas([26, 242, 89]);
    stubCssSupports(undefined);
    expect(await ensureGlyphAtlasFontFaceStyles(document)).toBe(true);
  });
});
