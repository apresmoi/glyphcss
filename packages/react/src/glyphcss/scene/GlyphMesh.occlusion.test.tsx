import { describe, it, expect, vi, afterEach } from "vitest";

// The per-mesh ramp/ambient/occlusion transform fields either change which
// `<pre>` a mesh lands in or how the shared occlusion id-map resolves — nothing
// a single mesh's rendered text distinguishes reliably. Assert they reach
// `scene.add`'s transform, the same way the Vue mirror
// (`GlyphMesh.occlusion.test.ts`) and `<glyph-mesh>`'s own element tests do.
const addCalls: Record<string, unknown>[] = [];
const setTransformCalls: Record<string, unknown>[] = [];
vi.mock("glyphcss", async () => {
  const actual = await vi.importActual<typeof import("glyphcss")>("glyphcss");
  return {
    ...actual,
    createGlyphScene: (host: HTMLElement, opts: Record<string, unknown>) => {
      const handle = actual.createGlyphScene(host, opts as never);
      const originalAdd = handle.add.bind(handle);
      return {
        ...handle,
        add: (polygons: never, transform: Record<string, unknown>) => {
          addCalls.push(transform);
          const mesh = originalAdd(polygons, transform as never);
          const originalSetTransform = mesh.setTransform.bind(mesh);
          return {
            ...mesh,
            setTransform: (next: Record<string, unknown>) => {
              setTransformCalls.push(next);
              return originalSetTransform(next as never);
            },
          };
        },
      };
    },
  };
});

const React = await import("react");
const { act } = React;
const { createRoot } = await import("react-dom/client");
const { GlyphScene } = await import("./GlyphScene");
const { GlyphMesh } = await import("./GlyphMesh");
const { GlyphPerspectiveCamera } = await import("../camera/GlyphPerspectiveCamera");

function renderMesh(meshProps: Record<string, unknown>): { container: HTMLElement; root: ReturnType<typeof createRoot> } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      React.createElement(GlyphPerspectiveCamera, {},
        React.createElement(GlyphScene, { cols: 20, rows: 5 },
          React.createElement(GlyphMesh, { geometry: "cube", ...meshProps }))),
    );
  });
  return { container, root };
}

describe("GlyphMesh (React) — per-mesh ramp / ambient / occlusion props", () => {
  afterEach(() => {
    addCalls.length = 0;
    setTransformCalls.length = 0;
    document.body.innerHTML = "";
  });

  it("forwards every per-mesh option onto the registered transform", () => {
    const { container } = renderMesh({
      glyphPalette: "dense",
      ambientIntensity: 0.75,
      occlusionPriority: 1,
      occlusionClaim: "geometry",
      occlusionContourPx: 3,
    });
    expect(addCalls[0]).toMatchObject({
      glyphPalette: "dense",
      ambientIntensity: 0.75,
      occlusionPriority: 1,
      occlusionClaim: "geometry",
      occlusionContourPx: 3,
    });
    container.remove();
  });

  it("leaves every per-mesh option undefined when unset", () => {
    const { container } = renderMesh({});
    const t = addCalls[0]!;
    expect(t.glyphPalette).toBeUndefined();
    expect(t.ambientIntensity).toBeUndefined();
    expect(t.occlusionPriority).toBeUndefined();
    expect(t.occlusionClaim).toBeUndefined();
    expect(t.occlusionContourPx).toBeUndefined();
    container.remove();
  });

  it("forwards a per-mesh option change through setTransform", () => {
    const { root, container } = renderMesh({ occlusionPriority: 0 });
    setTransformCalls.length = 0;
    act(() => {
      root.render(
        React.createElement(GlyphPerspectiveCamera, {},
          React.createElement(GlyphScene, { cols: 20, rows: 5 },
            React.createElement(GlyphMesh, { geometry: "cube", occlusionPriority: 2 }))),
      );
    });
    const forwarded = setTransformCalls.find((t) => t.occlusionPriority === 2);
    expect(forwarded).toBeDefined();
    container.remove();
  });

  it("a per-mesh glyphPalette alone pops the mesh into its own <pre>", () => {
    const { container } = renderMesh({ glyphPalette: "dense" });
    // Two `<pre>`s: the shared base grid plus this mesh's own detail layer.
    expect(container.querySelectorAll("pre.glyph-output").length).toBe(2);
    container.remove();
  });

  it("a mesh with no per-mesh option stays in the shared <pre>", () => {
    const { container } = renderMesh({});
    expect(container.querySelectorAll("pre.glyph-output").length).toBe(1);
    container.remove();
  });
});
