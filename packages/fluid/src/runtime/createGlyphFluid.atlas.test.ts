// The atlas path of the runtime, with the font load stubbed as ready so the test does not
// depend on how the environment loads fonts.
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
    expect(pre.style.fontPalette).toMatch(/^--glyph-fluid-\d+-[a-z0-9]+$/);
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

describe("createGlyphFluid worker fallback", () => {
  it("re-emits the palette after falling back, because the new encoder restarts its generations", async () => {
    const { handleGlyphFluidWorkerMessage } = await import("./protocol");
    vi.stubGlobal("Worker", class {});
    const state = { core: null, gen: -1 };
    type Fake = { onerror: ((e: unknown) => void) | null; onmessage: ((e: MessageEvent) => void) | null; terminate(): void; postMessage(m: never): void };
    let fake: Fake | null = null;
    const host = document.createElement("div");
    Object.defineProperty(host, "clientWidth", { value: 300 });
    Object.defineProperty(host, "clientHeight", { value: 200 });
    document.body.append(host);
    const fluid = createGlyphFluid(host, {
      clock: "manual",
      worker: () => (fake = {
        onerror: null, onmessage: null, terminate() {},
        postMessage(m: never) {
          handleGlyphFluidWorkerMessage(state, structuredClone(m), (r) => queueMicrotask(() => fake!.onmessage?.({ data: r } as MessageEvent)));
        },
      }) as unknown as Worker,
    });
    await fluid.ready;
    const style = host.querySelector("style")!;
    for (let i = 0; i < 4; i++) {
      fluid.step(1 / 60);
      await Promise.resolve();
      await Promise.resolve();
    }
    expect(fluid.stats().pipeline).toBe("worker");
    expect(style.textContent).toContain("@font-palette-values");
    let writes = 0;
    const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Object.getPrototypeOf(style)), "textContent")
      ?? Object.getOwnPropertyDescriptor(Node.prototype, "textContent")!;
    Object.defineProperty(style, "textContent", { get() { return desc.get!.call(this); }, set(v) { writes++; desc.set!.call(this, v); } });
    fake!.onerror!(new Event("error"));
    expect(fluid.stats().pipeline).toBe("main");
    fluid.step(1 / 60);
    expect(writes).toBe(1);
    fluid.destroy();
    vi.unstubAllGlobals();
  });
});
