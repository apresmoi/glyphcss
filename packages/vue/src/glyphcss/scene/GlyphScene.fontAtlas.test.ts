import { describe, it, expect, vi, afterEach } from "vitest";
import { createApp, h, nextTick, ref } from "vue";

// Mirrors `GlyphScene.colorEncoding.test.ts` and the React package's
// `GlyphScene.fontAtlas.test.tsx`. `fontAtlas` picks which PUA glyph modulus an
// atlas-encoded frame uses and `trackOpaqueCoverage` only changes whether an
// id-map is built, so neither is visible in the rendered DOM on an arbitrary
// fixture — this asserts the plumbing directly instead.
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

const { GLYPH_FONT_ATLAS, GLYPH_FONT_ATLAS_ASCII } = await import("glyphcss");
const { GlyphScene } = await import("./GlyphScene");
const { GlyphPerspectiveCamera } = await import("../camera/GlyphPerspectiveCamera");

function mountScene(props: Record<string, unknown>): void {
  const container = document.createElement("div");
  document.body.appendChild(container);
  createApp({
    setup: () => () => h(GlyphPerspectiveCamera, {}, { default: () => h(GlyphScene, props) }),
  }).mount(container);
}

describe("GlyphScene (Vue) — fontAtlas/trackOpaqueCoverage reach the scene", () => {
  afterEach(() => {
    created.length = 0;
    setOptionsCalls.length = 0;
    document.body.innerHTML = "";
  });

  it("forwards fontAtlas into createGlyphScene options at mount", async () => {
    mountScene({ colorEncoding: "atlas", fontAtlas: GLYPH_FONT_ATLAS_ASCII });
    await nextTick();
    const opts = created[created.length - 1]!;
    expect(opts.fontAtlas).toBe(GLYPH_FONT_ATLAS_ASCII);
  });

  it("omits fontAtlas when unset, so the library default (the universal atlas) applies", async () => {
    mountScene({});
    await nextTick();
    const opts = created[created.length - 1]!;
    expect(opts.fontAtlas).toBeUndefined();
  });

  it("does NOT forward a fontAtlas prop change — the vanilla option is fixed at creation", async () => {
    const atlas = ref(GLYPH_FONT_ATLAS);
    const container = document.createElement("div");
    document.body.appendChild(container);
    createApp({
      setup: () => () => h(GlyphPerspectiveCamera, {}, {
        default: () => h(GlyphScene, { fontAtlas: atlas.value }),
      }),
    }).mount(container);
    await nextTick();
    setOptionsCalls.length = 0;
    atlas.value = GLYPH_FONT_ATLAS_ASCII;
    await nextTick();
    expect(setOptionsCalls.some((c) => "fontAtlas" in c)).toBe(false);
  });

  it("forwards trackOpaqueCoverage into createGlyphScene options at mount", async () => {
    mountScene({ trackOpaqueCoverage: true });
    await nextTick();
    const opts = created[created.length - 1]!;
    expect(opts.trackOpaqueCoverage).toBe(true);
  });

  it("forwards a trackOpaqueCoverage prop update through setOptions", async () => {
    const track = ref(false);
    const container = document.createElement("div");
    document.body.appendChild(container);
    createApp({
      setup: () => () => h(GlyphPerspectiveCamera, {}, {
        default: () => h(GlyphScene, { trackOpaqueCoverage: track.value }),
      }),
    }).mount(container);
    await nextTick();
    setOptionsCalls.length = 0;
    track.value = true;
    await nextTick();
    const forwarded = setOptionsCalls.find((c) => c.trackOpaqueCoverage !== undefined);
    expect(forwarded?.trackOpaqueCoverage).toBe(true);
  });
});
