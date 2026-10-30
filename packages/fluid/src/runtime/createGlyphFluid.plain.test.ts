// The no-atlas fallback (font payload failed, or no font-palette support), forced here by
// stubbing the font loader to report "unavailable".
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("glyphcss", async (orig) => ({
  ...(await orig<typeof import("glyphcss")>()),
  ensureGlyphAtlasFontFaceStyles: () => Promise.resolve(false),
}));

const { createGlyphFluid } = await import("./createGlyphFluid");

afterEach(() => document.body.replaceChildren());

describe("createGlyphFluid plain fallback", () => {
  it("draws real braille in the field colour, not the host's", async () => {
    const host = document.createElement("div");
    Object.defineProperty(host, "clientWidth", { value: 300 });
    Object.defineProperty(host, "clientHeight", { value: 200 });
    host.style.color = "transparent";
    document.body.append(host);
    const fluid = createGlyphFluid(host, { clock: "manual", worker: false, field: { color: "#123456" } });
    await fluid.ready;
    fluid.step(1 / 60);
    const pre = host.querySelector("pre")!;
    expect(fluid.stats().encoding).toBe("plain");
    expect(pre.style.color).toMatch(/#123456|rgb\(18, 52, 86\)/);
    expect(pre.style.fontPalette).toBe("");
    expect(/^[\u2800-\u28ff\n]+$/.test(pre.textContent!)).toBe(true);
    expect(host.querySelector("style")!.textContent).toBe("");
    fluid.destroy();
  });
});
