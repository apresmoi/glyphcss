import { describe, it, expect, vi, afterEach } from "vitest";

// Mirrors `GlyphScene.colorEncoding.test.tsx` and the Vue package's
// `GlyphScene.fontAtlas.test.ts`. `fontAtlas` picks which PUA glyph modulus an
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

const React = await import("react");
const { act } = React;
const { createRoot } = await import("react-dom/client");
const { GLYPH_FONT_ATLAS, GLYPH_FONT_ATLAS_ASCII } = await import("glyphcss");
const { GlyphScene } = await import("./GlyphScene");
const { GlyphPerspectiveCamera } = await import("../camera/GlyphPerspectiveCamera");

function renderScene(props: Record<string, unknown>): { container: HTMLElement; root: ReturnType<typeof createRoot> } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      React.createElement(GlyphPerspectiveCamera, {}, React.createElement(GlyphScene, props)),
    );
  });
  return { container, root };
}

describe("GlyphScene (React) — fontAtlas/trackOpaqueCoverage reach the scene", () => {
  afterEach(() => {
    created.length = 0;
    setOptionsCalls.length = 0;
    document.body.innerHTML = "";
  });

  it("forwards fontAtlas into createGlyphScene options at mount", () => {
    renderScene({ colorEncoding: "atlas", fontAtlas: GLYPH_FONT_ATLAS_ASCII });
    const opts = created[created.length - 1]!;
    expect(opts.fontAtlas).toBe(GLYPH_FONT_ATLAS_ASCII);
  });

  it("omits fontAtlas when unset, so the library default (the universal atlas) applies", () => {
    renderScene({});
    const opts = created[created.length - 1]!;
    expect(opts.fontAtlas).toBeUndefined();
  });

  it("does NOT forward a fontAtlas prop change — the vanilla option is fixed at creation", () => {
    const { root, container } = renderScene({ fontAtlas: GLYPH_FONT_ATLAS });
    setOptionsCalls.length = 0;
    act(() => {
      root.render(
        React.createElement(GlyphPerspectiveCamera, {}, React.createElement(GlyphScene, { fontAtlas: GLYPH_FONT_ATLAS_ASCII })),
      );
    });
    expect(setOptionsCalls.some((c) => "fontAtlas" in c)).toBe(false);
    container.remove();
  });

  it("forwards trackOpaqueCoverage into createGlyphScene options at mount", () => {
    renderScene({ trackOpaqueCoverage: true });
    const opts = created[created.length - 1]!;
    expect(opts.trackOpaqueCoverage).toBe(true);
  });

  it("forwards a trackOpaqueCoverage prop update through setOptions", () => {
    const { root, container } = renderScene({ trackOpaqueCoverage: false });
    setOptionsCalls.length = 0;
    act(() => {
      root.render(
        React.createElement(GlyphPerspectiveCamera, {}, React.createElement(GlyphScene, { trackOpaqueCoverage: true })),
      );
    });
    const forwarded = setOptionsCalls.find((c) => c.trackOpaqueCoverage !== undefined);
    expect(forwarded?.trackOpaqueCoverage).toBe(true);
    container.remove();
  });
});
