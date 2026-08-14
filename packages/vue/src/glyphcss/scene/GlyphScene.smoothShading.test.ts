import { describe, it, expect, vi, afterEach } from "vitest";
import { createApp, h, nextTick } from "vue";

// Scoped to this file: capture the options the component hands to the library.
// A prop can be declared and still never reach `createGlyphScene` — smooth
// shading renders identically on most geometry, so nothing observable in the
// DOM would catch that. This asserts the plumbing directly.
const created: Record<string, unknown>[] = [];
vi.mock("glyphcss", async () => {
  const actual = await vi.importActual<typeof import("glyphcss")>("glyphcss");
  return {
    ...actual,
    createGlyphScene: (host: HTMLElement, opts: Record<string, unknown>) => {
      created.push(opts);
      return actual.createGlyphScene(host, opts as never);
    },
  };
});

const { GlyphScene } = await import("./GlyphScene");
const { GlyphPerspectiveCamera } = await import("../camera/GlyphPerspectiveCamera");

describe("GlyphScene (Vue) — smoothShading/creaseAngle reach the scene", () => {
  afterEach(() => {
    created.length = 0;
    document.body.innerHTML = "";
  });

  it("forwards both props into createGlyphScene options", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    createApp({
      setup: () => () => h(GlyphPerspectiveCamera, {}, {
        default: () => h(GlyphScene, { smoothShading: true, creaseAngle: 25 }),
      }),
    }).mount(container);
    await nextTick();

    expect(created.length).toBeGreaterThan(0);
    const opts = created[created.length - 1]!;
    expect(opts.smoothShading).toBe(true);
    expect(opts.creaseAngle).toBe(25);
  });

  it("omits them when unset, so library defaults apply", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    createApp({
      setup: () => () => h(GlyphPerspectiveCamera, {}, { default: () => h(GlyphScene, {}) }),
    }).mount(container);
    await nextTick();

    const opts = created[created.length - 1]!;
    expect(opts.smoothShading).toBeUndefined();
    expect(opts.creaseAngle).toBeUndefined();
  });
});
