import { describe, it, expect, vi, afterEach } from "vitest";
import { createApp, h, nextTick, ref } from "vue";

// Mirrors `GlyphScene.colorTolerance.test.ts` and the React package's
// `GlyphScene.colorEncoding.test.tsx`. `colorEncoding`/`atlasPalette` render
// identically to spans output unless the whole scene actually fits the
// atlas, so nothing observable in the DOM reliably catches a dropped prop on
// an arbitrary fixture — this asserts the plumbing directly instead.
const created: Record<string, unknown>[] = [];
const setOptionsCalls: Record<string, unknown>[] = [];
vi.mock("glyphcss", async () => {
  const actual = await vi.importActual<typeof import("glyphcss")>("glyphcss");
  return {
    ...actual,
    createGlyphScene: (host: HTMLElement, opts: Record<string, unknown>) => {
      created.push(opts);
      const handle = actual.createGlyphScene(host, opts as never);
      const originalSetOptions = handle.setOptions.bind(handle);
      return {
        ...handle,
        setOptions: (partial: Record<string, unknown>) => {
          setOptionsCalls.push(partial);
          return originalSetOptions(partial as never);
        },
      };
    },
  };
});

const { GlyphScene } = await import("./GlyphScene");
const { GlyphPerspectiveCamera } = await import("../camera/GlyphPerspectiveCamera");

describe("GlyphScene (Vue) — colorEncoding/atlasPalette reach the scene", () => {
  afterEach(() => {
    created.length = 0;
    setOptionsCalls.length = 0;
    document.body.innerHTML = "";
  });

  it("forwards colorEncoding into createGlyphScene options at mount", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    createApp({
      setup: () => () => h(GlyphPerspectiveCamera, {}, {
        default: () => h(GlyphScene, { colorEncoding: "atlas" }),
      }),
    }).mount(container);
    await nextTick();

    const opts = created[created.length - 1]!;
    expect(opts.colorEncoding).toBe("atlas");
  });

  it("forwards atlasPalette into createGlyphScene options at mount", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const palette = ["#ff0000", "#00ff00"];
    createApp({
      setup: () => () => h(GlyphPerspectiveCamera, {}, {
        default: () => h(GlyphScene, { atlasPalette: palette }),
      }),
    }).mount(container);
    await nextTick();

    const opts = created[created.length - 1]!;
    expect(opts.atlasPalette).toBe(palette);
  });

  it("omits colorEncoding when unset, so the library default (\"spans\") applies", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    createApp({
      setup: () => () => h(GlyphPerspectiveCamera, {}, { default: () => h(GlyphScene, {}) }),
    }).mount(container);
    await nextTick();

    const opts = created[created.length - 1]!;
    expect(opts.colorEncoding).toBeUndefined();
    expect(opts.atlasPalette).toBeUndefined();
  });

  it("forwards a colorEncoding prop update through setOptions", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const colorEncoding = ref<"spans" | "atlas">("spans");
    const app = createApp({
      setup: () => () => h(GlyphPerspectiveCamera, {}, {
        default: () => h(GlyphScene, { colorEncoding: colorEncoding.value }),
      }),
    });
    app.mount(container);
    await nextTick();
    setOptionsCalls.length = 0;

    colorEncoding.value = "atlas";
    await nextTick();

    const forwarded = setOptionsCalls.find((c) => c.colorEncoding !== undefined);
    expect(forwarded?.colorEncoding).toBe("atlas");
    app.unmount();
  });
});
