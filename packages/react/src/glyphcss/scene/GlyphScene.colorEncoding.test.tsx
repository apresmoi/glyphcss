import { describe, it, expect, vi, afterEach } from "vitest";

// Mirrors `GlyphScene.colorTolerance.test.tsx` and the Vue package's
// `GlyphScene.colorEncoding.test.ts`. `colorEncoding`/`atlasPalette` render
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

const React = await import("react");
const { act } = React;
const { createRoot } = await import("react-dom/client");
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

describe("GlyphScene (React) — colorEncoding/atlasPalette reach the scene", () => {
  afterEach(() => {
    created.length = 0;
    setOptionsCalls.length = 0;
    document.body.innerHTML = "";
  });

  it("forwards colorEncoding into createGlyphScene options at mount", () => {
    renderScene({ colorEncoding: "atlas" });
    const opts = created[created.length - 1]!;
    expect(opts.colorEncoding).toBe("atlas");
  });

  it("forwards atlasPalette into createGlyphScene options at mount", () => {
    const palette = ["#ff0000", "#00ff00"];
    renderScene({ atlasPalette: palette });
    const opts = created[created.length - 1]!;
    expect(opts.atlasPalette).toBe(palette);
  });

  it("omits colorEncoding when unset, so the library default (\"spans\") applies", () => {
    renderScene({});
    const opts = created[created.length - 1]!;
    expect(opts.colorEncoding).toBeUndefined();
    expect(opts.atlasPalette).toBeUndefined();
  });

  it("forwards a colorEncoding prop update through setOptions", () => {
    const { root, container } = renderScene({ colorEncoding: "spans" });
    setOptionsCalls.length = 0; // clear the initial no-op cycle noise
    act(() => {
      root.render(
        React.createElement(GlyphPerspectiveCamera, {}, React.createElement(GlyphScene, { colorEncoding: "atlas" })),
      );
    });
    const forwarded = setOptionsCalls.find((c) => c.colorEncoding !== undefined);
    expect(forwarded?.colorEncoding).toBe("atlas");
    container.remove();
  });

  it("forwards an atlasPalette removal through setOptions (undefined clears it)", () => {
    const palette = ["#ff0000"];
    const { root, container } = renderScene({ atlasPalette: palette });
    setOptionsCalls.length = 0;
    act(() => {
      root.render(
        React.createElement(GlyphPerspectiveCamera, {}, React.createElement(GlyphScene, {})),
      );
    });
    const forwarded = setOptionsCalls.find((c) => "atlasPalette" in c);
    expect(forwarded).toBeDefined();
    expect(forwarded!.atlasPalette).toBeUndefined();
    container.remove();
  });
});
