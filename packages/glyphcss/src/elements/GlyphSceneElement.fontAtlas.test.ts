import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// `fontAtlas` is fixed at scene creation, so it never appears in
// `getScene().getOptions()` the way every reactive option does — the only place
// it is observable is the options object `<glyph-scene>` hands to
// `createGlyphScene`. Mirrors the React/Vue packages' own
// `GlyphScene.fontAtlas` tests, which capture the same object.
const created: Record<string, unknown>[] = [];
vi.mock("../api/createGlyphScene", async () => {
  const actual = await vi.importActual<typeof import("../api/createGlyphScene")>("../api/createGlyphScene");
  return {
    ...actual,
    createGlyphScene: (host: HTMLElement, opts: Record<string, unknown>) => {
      created.push(opts);
      return actual.createGlyphScene(host, opts as never);
    },
  };
});

const { GLYPH_FONT_ATLAS_ASCII } = await import("../render/fontAtlas");
const { GlyphSceneElement } = await import("./GlyphSceneElement");
const { GlyphPerspectiveCameraElement } = await import("./GlyphPerspectiveCameraElement");

if (!customElements.get("glyph-scene")) customElements.define("glyph-scene", GlyphSceneElement);
if (!customElements.get("glyph-perspective-camera")) customElements.define("glyph-perspective-camera", GlyphPerspectiveCameraElement);

describe("<glyph-scene> — fontAtlas property", () => {
  let camEl: HTMLElement;
  let host: InstanceType<typeof GlyphSceneElement>;

  beforeEach(() => {
    camEl = document.createElement("glyph-perspective-camera");
    host = document.createElement("glyph-scene") as InstanceType<typeof GlyphSceneElement>;
    host.setAttribute("cols", "20");
    host.setAttribute("rows", "5");
    camEl.appendChild(host);
  });

  afterEach(() => {
    if (camEl.isConnected) camEl.remove();
    created.length = 0;
  });

  it("reads the fontAtlas property set before connect into the scene options", () => {
    host.fontAtlas = GLYPH_FONT_ATLAS_ASCII;
    document.body.appendChild(camEl);
    expect(created[created.length - 1]!.fontAtlas).toBe(GLYPH_FONT_ATLAS_ASCII);
  });

  it("omits fontAtlas when never set, so the library default applies", () => {
    document.body.appendChild(camEl);
    expect(created[created.length - 1]!.fontAtlas).toBeUndefined();
  });

  it("round-trips through the getter and is picked up by a later reconnect", () => {
    document.body.appendChild(camEl);
    // Assigning on a live scene records the value; the atlas is fixed for a
    // scene's lifetime, so only the NEXT scene created from this element uses it.
    host.fontAtlas = GLYPH_FONT_ATLAS_ASCII;
    expect(host.fontAtlas).toBe(GLYPH_FONT_ATLAS_ASCII);
    expect(created[0]!.fontAtlas).toBeUndefined();
    camEl.remove();
    document.body.appendChild(camEl);
    expect(created[created.length - 1]!.fontAtlas).toBe(GLYPH_FONT_ATLAS_ASCII);
  });
});
