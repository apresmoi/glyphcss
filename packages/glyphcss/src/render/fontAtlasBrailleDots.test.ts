/**
 * The braille-dots atlas (`GLYPH_FONT_ATLAS_BRAILLE_DOTS`): a third shipped
 * family, opt-in, for `@glyphcss/fluid`. Covers its glyph axis and mapping,
 * family resolution, that its payload loads only when named, the COLR probe
 * glyph it needs, and that adding it left the two existing atlas artifacts
 * byte-identical.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGlyphScene } from "../api/createGlyphScene";
import { createGlyphOrthographicCamera } from "../api/createGlyphCamera";
import { ensureGlyphAtlasFontFaceStyles, resetGlyphAtlasFontFaceStylesForTests } from "../styles/styles";
import { encodeGlyphAtlas, isGlyphAtlasEncodable } from "./cells";
import {
  decodeGlyphAtlasCodePoint,
  decodeGlyphAtlasText,
  glyphAtlasCodePoint,
  glyphAtlasForFamily,
  glyphAtlasFontLoadState,
  isGlyphInFontAtlas,
  loadGlyphAtlasFontFaceCss,
  loadGlyphAtlasFontPayload,
  setGlyphAtlasFontPayloadImportForTests,
  GLYPH_FONT_ATLAS,
  GLYPH_FONT_ATLAS_ASCII,
  GLYPH_FONT_ATLAS_BRAILLE_DOTS as DOTS,
} from "./fontAtlas";

const BRAILLE = Array.from({ length: 256 }, (_, m) => String.fromCharCode(0x2800 + m));
const ASSETS = join(resolve(process.cwd()), "assets/glyph-atlas");

afterEach(() => {
  setGlyphAtlasFontPayloadImportForTests(null);
  resetGlyphAtlasFontFaceStylesForTests();
  document.head.querySelectorAll("style").forEach((el) => el.remove());
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("braille-dots atlas — glyph axis and mapping", () => {
  it("covers exactly the 256 braille patterns (glyph index = mask) plus space", () => {
    expect(DOTS.glyphs).toEqual(BRAILLE);
    expect(DOTS.glyphCount).toBe(256);
    expect(DOTS.extension).toBeUndefined();
    for (const glyph of BRAILLE) expect(isGlyphInFontAtlas(glyph, DOTS)).toBe(true);
    expect(isGlyphInFontAtlas(" ", DOTS)).toBe(true);
    for (const glyph of ["@", "A", "#", "█", "·"]) expect(isGlyphInFontAtlas(glyph, DOTS)).toBe(false);
  });

  it("keeps the universal atlas's 30 slots, wholly in Supplementary PUA-A", () => {
    expect(DOTS.maxPaletteSize).toBe(GLYPH_FONT_ATLAS.maxPaletteSize);
    expect(DOTS.puaStart).toBe(0xf0000);
    for (const slot of [0, 7, 29]) {
      for (const mask of [0, 1, 0x47, 0xff]) {
        const cp = glyphAtlasCodePoint(BRAILLE[mask]!, slot, DOTS)!;
        expect(cp).toBe(0xf0000 + slot * 256 + mask);
        expect(decodeGlyphAtlasCodePoint(cp, DOTS)).toEqual({ glyph: BRAILLE[mask], paletteSlot: slot });
      }
    }
    expect(glyphAtlasCodePoint("⣿", 30, DOTS)).toBeUndefined();
    expect(glyphAtlasCodePoint(" ", 3, DOTS)).toBe(0x20);
  });

  it("carries the dot geometry its outlines are built from (one 1000 x 1600 cell)", () => {
    const g = DOTS.dotGeometry!;
    expect(g.unitsPerEm / g.advance).toBe(1.6);
    expect(g.dots).toHaveLength(8);
    expect(GLYPH_FONT_ATLAS.dotGeometry).toBeUndefined();
    expect(GLYPH_FONT_ATLAS_ASCII.dotGeometry).toBeUndefined();
  });

  it("encodes a braille grid unchanged through encodeGlyphAtlas, and refuses non-braille", () => {
    const char = [...BRAILLE.slice(1), " "];
    const color = char.map((c) => (c === " " ? null : "#3ccf96"));
    expect(isGlyphAtlasEncodable(char, color, 16, 16, ["#3ccf96"], DOTS)).toBe(true);
    const text = encodeGlyphAtlas(char, color, 16, 16, ["#3ccf96"], DOTS);
    expect(text).not.toContain("<span");
    expect(decodeGlyphAtlasText(text, DOTS).replace(/\n/g, "")).toBe(char.join(""));
    // every lit cell is one PUA-A code point (a surrogate pair), blanks are U+0020
    for (const ch of text.replace(/\n/g, "")) expect(ch === " " || ch.codePointAt(0)! >= 0xf0000).toBe(true);

    const withAt = [...char];
    withAt[0] = "@";
    expect(isGlyphAtlasEncodable(withAt, color, 16, 16, ["#3ccf96"], DOTS)).toBe(false);
  });
});

describe("braille-dots atlas — family resolution", () => {
  it("glyphAtlasForFamily resolves its family, not the universal one its name extends", () => {
    expect(DOTS.family).toBe("GlyphCssAtlasBrailleDots");
    expect(DOTS.family.startsWith(GLYPH_FONT_ATLAS.family)).toBe(true);
    expect(glyphAtlasForFamily(`"${DOTS.family}"`)).toBe(DOTS);
    expect(glyphAtlasForFamily(DOTS.family)).toBe(DOTS);
    expect(glyphAtlasForFamily(`monospace, '${DOTS.family}'`)).toBe(DOTS);
    expect(glyphAtlasForFamily(`"${GLYPH_FONT_ATLAS.family}", monospace`)).toBe(GLYPH_FONT_ATLAS);
  });

  it("is the key a correct decode needs: its code points collide with the universal extension block", () => {
    const cp = glyphAtlasCodePoint("⣿", 2, DOTS)!;
    const text = String.fromCodePoint(cp);
    expect(decodeGlyphAtlasText(text, DOTS)).toBe("⣿");
    expect(decodeGlyphAtlasText(text, GLYPH_FONT_ATLAS)).not.toBe("⣿");
    expect(decodeGlyphAtlasText(text, glyphAtlasForFamily(`"${DOTS.family}"`)!)).toBe("⣿");
  });
});

describe("braille-dots atlas — lazy payload, loaded only when named", () => {
  it("stays idle while the universal atlas loads, and through a default atlas scene", async () => {
    await loadGlyphAtlasFontPayload(GLYPH_FONT_ATLAS);
    await ensureGlyphAtlasFontFaceStyles(document, GLYPH_FONT_ATLAS);
    const host = document.createElement("div");
    document.body.appendChild(host);
    const scene = createGlyphScene(host, {
      cols: 8, rows: 4, useColors: true, colorEncoding: "atlas",
      camera: createGlyphOrthographicCamera({ zoom: 10 }),
    });
    await Promise.resolve();
    scene.rerender();
    scene.destroy();
    expect(glyphAtlasFontLoadState(GLYPH_FONT_ATLAS)).toBe("ready");
    expect(glyphAtlasFontLoadState(DOTS)).toBe("idle");
    expect(document.getElementById(`glyph-atlas-font-face--${DOTS.family}`)).toBeNull();
  });

  it("loads its OWN payload under its own family when named", async () => {
    expect(await ensureGlyphAtlasFontFaceStyles(document, DOTS)).toBe(true);
    expect(glyphAtlasFontLoadState(DOTS)).toBe("ready");
    const style = document.getElementById(`glyph-atlas-font-face--${DOTS.family}`);
    expect(style?.textContent).toContain(`font-family:"${DOTS.family}"`);
    const own = JSON.parse(readFileSync(join(ASSETS, "braille-dots-atlas-font.json"), "utf8")).woff2Base64 as string;
    expect(style?.textContent).toContain(own);
    const universal = await loadGlyphAtlasFontFaceCss(GLYPH_FONT_ATLAS);
    expect(universal).not.toContain(own.slice(0, 128));
  });

  it("probes COLR painting with a dense pattern, never its inkless glyph 0", async () => {
    // A canvas that paints chromatic pixels only for the glyph it was asked to draw
    // when that glyph has ink: U+2800 (glyph 0, the probe's old fallback) has none.
    const drawn: number[] = [];
    const real = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation(((tag: string, opts?: ElementCreationOptions) => {
      if (tag !== "canvas") return real(tag, opts);
      let inked = false;
      return {
        width: 0, height: 0,
        getContext: () => ({
          fillStyle: "", font: "", textBaseline: "",
          fillRect() {},
          fillText(text: string) {
            const cp = text.codePointAt(0)!;
            drawn.push(cp);
            inked = (cp - DOTS.puaStart) % DOTS.glyphCount !== 0;
          },
          getImageData: () => ({ data: new Uint8ClampedArray(inked ? [255, 0, 0, 255] : [255, 255, 255, 255]) }),
        }),
      } as unknown as HTMLElement;
    }) as typeof document.createElement);
    expect(await ensureGlyphAtlasFontFaceStyles(document, DOTS)).toBe(true);
    expect(drawn).toEqual([glyphAtlasCodePoint("⣿", 0, DOTS)]);
  });
});

describe("existing atlas artifacts — byte-identical", () => {
  // Pinned SHA-256 of the checked-in universal and ASCII artifacts. Adding a family
  // must not touch them: their bytes are every existing atlas render's font.
  it.each([
    ["atlas.json", "d289dc6deb9b1df2d9ba7117b7cda20d53253dc0a40e9d869acbf067568a037a"],
    ["atlas-font.json", "3d76149ae638f0dbdafe58a6f081a63157f276e62c1866c4391f06c0b1d6db71"],
    ["ascii-atlas.json", "30bb7d78a49eb5090e81ddbbb0c3373d62830b87e64a5767f7f23ca51f52947c"],
    ["ascii-atlas-font.json", "0454cca8843db3e9a040acd499324b2695ad44a8f44d9c0b85593e4183fa87f9"],
  ])("%s is unchanged", (file, sha) => {
    expect(createHash("sha256").update(readFileSync(join(ASSETS, file))).digest("hex")).toBe(sha);
  });
});
