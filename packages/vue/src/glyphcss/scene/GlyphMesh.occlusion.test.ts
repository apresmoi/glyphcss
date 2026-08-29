import { describe, it, expect, vi, afterEach } from "vitest";
import { createApp, h, nextTick, ref } from "vue";

// The per-mesh ramp/ambient/occlusion transform fields either change which
// `<pre>` a mesh lands in or how the shared occlusion id-map resolves — nothing
// a single mesh's rendered text distinguishes reliably. Assert they reach
// `scene.add`'s transform, mirroring the React package's
// `GlyphMesh.occlusion.test.tsx`.
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

const { GlyphScene } = await import("./GlyphScene");
const { GlyphMesh } = await import("./GlyphMesh");
const { GlyphPerspectiveCamera } = await import("../camera/GlyphPerspectiveCamera");

async function mountMesh(meshProps: Record<string, unknown>): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  createApp({
    setup: () => () => h(GlyphPerspectiveCamera, {}, {
      default: () => h(GlyphScene, { cols: 20, rows: 5 }, {
        default: () => h(GlyphMesh, { geometry: "cube", ...meshProps }),
      }),
    }),
  }).mount(container);
  await nextTick();
  await nextTick();
  return container;
}

describe("GlyphMesh (Vue) — per-mesh ramp / ambient / occlusion props", () => {
  afterEach(() => {
    addCalls.length = 0;
    setTransformCalls.length = 0;
    document.body.innerHTML = "";
  });

  it("forwards every per-mesh option onto the registered transform", async () => {
    await mountMesh({
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
  });

  it("leaves every per-mesh option undefined when unset", async () => {
    await mountMesh({});
    const t = addCalls[0]!;
    expect(t.glyphPalette).toBeUndefined();
    expect(t.ambientIntensity).toBeUndefined();
    expect(t.occlusionPriority).toBeUndefined();
    expect(t.occlusionClaim).toBeUndefined();
    expect(t.occlusionContourPx).toBeUndefined();
  });

  it("forwards a per-mesh option change through setTransform", async () => {
    const priority = ref(0);
    const container = document.createElement("div");
    document.body.appendChild(container);
    createApp({
      setup: () => () => h(GlyphPerspectiveCamera, {}, {
        default: () => h(GlyphScene, { cols: 20, rows: 5 }, {
          default: () => h(GlyphMesh, { geometry: "cube", occlusionPriority: priority.value }),
        }),
      }),
    }).mount(container);
    await nextTick();
    await nextTick();
    setTransformCalls.length = 0;
    priority.value = 2;
    await nextTick();
    expect(setTransformCalls.find((t) => t.occlusionPriority === 2)).toBeDefined();
  });

  it("a per-mesh glyphPalette alone pops the mesh into its own <pre>", async () => {
    const container = await mountMesh({ glyphPalette: "dense" });
    // Two `<pre>`s: the shared base grid plus this mesh's own detail layer.
    expect(container.querySelectorAll("pre.glyph-output").length).toBe(2);
  });

  it("a mesh with no per-mesh option stays in the shared <pre>", async () => {
    const container = await mountMesh({});
    expect(container.querySelectorAll("pre.glyph-output").length).toBe(1);
  });
});
