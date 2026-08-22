import { describe, it, expect, vi, afterEach } from "vitest";

// COLOR-TOLERANCE.md Phase 3 — mirrors the Vue package's
// `GlyphScene.colorTolerance.test.ts`. `colorTolerance` renders identically
// on most fixtures unless colors happen to fall within the tolerance, so
// nothing observable in the DOM reliably catches a dropped prop — this
// asserts the plumbing directly instead.
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

describe("GlyphScene (React) — colorTolerance reaches the scene", () => {
  afterEach(() => {
    created.length = 0;
    setOptionsCalls.length = 0;
    document.body.innerHTML = "";
  });

  it("forwards the prop into createGlyphScene options at mount", () => {
    renderScene({ colorTolerance: 40 });
    expect(created.length).toBeGreaterThan(0);
    const opts = created[created.length - 1]!;
    expect(opts.colorTolerance).toBe(40);
  });

  it("omits it when unset, so the library default (0/off) applies", () => {
    renderScene({});
    const opts = created[created.length - 1]!;
    expect(opts.colorTolerance).toBeUndefined();
  });

  it("forwards a prop update through setOptions", () => {
    const { root, container } = renderScene({ colorTolerance: 10 });
    setOptionsCalls.length = 0; // clear the initial no-op cycle noise
    act(() => {
      root.render(
        React.createElement(GlyphPerspectiveCamera, {}, React.createElement(GlyphScene, { colorTolerance: 90 })),
      );
    });
    const forwarded = setOptionsCalls.find((c) => c.colorTolerance !== undefined);
    expect(forwarded?.colorTolerance).toBe(90);
    container.remove();
  });
});
