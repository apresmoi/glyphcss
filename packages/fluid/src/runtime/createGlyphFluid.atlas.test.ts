// The atlas path of the runtime, with the font load stubbed as ready (happy-dom has no
// font-palette support, so the real loader reports "unsupported" and the runtime goes plain).
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("glyphcss", async (orig) => ({
  ...(await orig<typeof import("glyphcss")>()),
  ensureGlyphAtlasFontFaceStyles: () => Promise.resolve(true),
}));

const { createGlyphFluid } = await import("./createGlyphFluid");
const { decodeGlyphAtlasText, GLYPH_FONT_ATLAS } = await import("glyphcss");

afterEach(() => document.body.replaceChildren());

describe("createGlyphFluid atlas encoding", () => {
  it("writes atlas text in the atlas family and re-emits palette CSS only when the palette repools", async () => {
    const host = document.createElement("div");
    Object.defineProperty(host, "clientWidth", { value: 300 });
    Object.defineProperty(host, "clientHeight", { value: 200 });
    document.body.append(host);
    const fluid = createGlyphFluid(host, { clock: "manual", worker: false });
    await fluid.ready;
    const pre = host.querySelector("pre")!, style = host.querySelector("style")!;
    expect(fluid.stats().encoding).toBe("atlas");
    expect(pre.style.fontFamily).toContain(GLYPH_FONT_ATLAS.family);
    expect(pre.style.fontPalette).toMatch(/^--glyph-fluid-\d+$/);
    let cssWrites = 0;
    let last = "";
    for (let i = 0; i < 40; i++) {
      fluid.step(1 / 60);
      if (style.textContent !== last) (cssWrites++, (last = style.textContent!));
    }
    expect(last).toContain(`@font-palette-values ${pre.style.fontPalette}`);
    // 40 frames at 60 fps = 0.67 s of sim time: bootstrap + at most two 250 ms repools
    expect(cssWrites).toBeGreaterThanOrEqual(1);
    expect(cssWrites).toBeLessThanOrEqual(3);
    const plain = decodeGlyphAtlasText(pre.textContent!);
    expect(/^[⠀-⣿ \n]+$/.test(plain)).toBe(true);
    fluid.destroy();
  });
});
