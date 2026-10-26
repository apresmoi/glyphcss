/**
 * The braille-dots payload module is EVALUATED only once a caller names its atlas: not
 * when glyphcss loads, not when the universal atlas loads, not for a default atlas scene.
 * Load-state bookkeeping alone cannot see an eager `import()` that bypasses the registry;
 * this counts real evaluations of the module.
 */
import { describe, expect, it, vi } from "vitest";

const evaluated = vi.hoisted(() => ({ count: 0 }));
vi.mock("./fontAtlasBrailleDotsPayload", () => {
  evaluated.count++;
  return { GLYPH_FONT_ATLAS_WOFF2_BASE64: "DOTS" };
});

describe("braille-dots payload module — evaluated only when named", () => {
  it("is not evaluated by glyphcss, the universal atlas or a default atlas scene; once named, exactly once", async () => {
    const glyphcss = await import("../index");
    await glyphcss.loadGlyphAtlasFontPayload(glyphcss.GLYPH_FONT_ATLAS);
    await glyphcss.loadGlyphAtlasFontPayload(glyphcss.GLYPH_FONT_ATLAS_ASCII);
    const host = document.createElement("div");
    document.body.appendChild(host);
    const scene = glyphcss.createGlyphScene(host, {
      cols: 8, rows: 4, useColors: true, colorEncoding: "atlas",
      camera: glyphcss.createGlyphOrthographicCamera({ zoom: 10 }),
    });
    await glyphcss.ensureGlyphAtlasFontFaceStyles(document);
    await Promise.resolve();
    scene.rerender();
    scene.destroy();
    host.remove();
    expect(evaluated.count).toBe(0);

    expect(await glyphcss.loadGlyphAtlasFontPayload(glyphcss.GLYPH_FONT_ATLAS_BRAILLE_DOTS)).toBe("DOTS");
    await glyphcss.loadGlyphAtlasFontPayload(glyphcss.GLYPH_FONT_ATLAS_BRAILLE_DOTS);
    expect(evaluated.count).toBe(1);
  });
});
