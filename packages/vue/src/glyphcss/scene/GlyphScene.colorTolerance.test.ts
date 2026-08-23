import { describe, it, expect, vi, afterEach } from "vitest";
import { createApp, h, nextTick, ref } from "vue";

// COLOR-TOLERANCE.md Phase 3 — mirrors the `smoothShading`/`creaseAngle`
// plumbing test in this same directory. `colorTolerance` renders identically
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

const { GlyphScene } = await import("./GlyphScene");
const { GlyphPerspectiveCamera } = await import("../camera/GlyphPerspectiveCamera");

describe("GlyphScene (Vue) — colorTolerance reaches the scene", () => {
  afterEach(() => {
    created.length = 0;
    setOptionsCalls.length = 0;
    document.body.innerHTML = "";
  });

  it("forwards the prop into createGlyphScene options at mount", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    createApp({
      setup: () => () => h(GlyphPerspectiveCamera, {}, {
        default: () => h(GlyphScene, { colorTolerance: 40 }),
      }),
    }).mount(container);
    await nextTick();

    expect(created.length).toBeGreaterThan(0);
    const opts = created[created.length - 1]!;
    expect(opts.colorTolerance).toBe(40);
  });

  it("omits it when unset, so the library default (0/off) applies", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    createApp({
      setup: () => () => h(GlyphPerspectiveCamera, {}, { default: () => h(GlyphScene, {}) }),
    }).mount(container);
    await nextTick();

    const opts = created[created.length - 1]!;
    expect(opts.colorTolerance).toBeUndefined();
  });

  it("forwards a prop update through setOptions", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const colorTolerance = ref(10);
    const app = createApp({
      setup: () => () => h(GlyphPerspectiveCamera, {}, {
        default: () => h(GlyphScene, { colorTolerance: colorTolerance.value }),
      }),
    });
    app.mount(container);
    await nextTick();
    setOptionsCalls.length = 0; // clear the initial no-op cycle noise

    colorTolerance.value = 90;
    await nextTick();

    const forwarded = setOptionsCalls.find((c) => c.colorTolerance !== undefined);
    expect(forwarded?.colorTolerance).toBe(90);
    app.unmount();
  });
});
