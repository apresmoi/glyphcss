import { describe, it, expect, afterEach } from "vitest";
import { createGlyphScene } from "./createGlyphScene";
import { createGlyphOrthographicCamera } from "./createGlyphCamera";
import { GLYPH_FONT_ATLAS } from "../render/fontAtlas";

// Task: close the CSS-injection gap. `colorEncoding: "atlas"` used to render
// PUA garbage unless a consumer manually injected `buildGlyphAtlasFontFaceCss`/
// `buildGlyphAtlasFontPaletteValuesCss` and wired the `<pre>`'s `font-family`/
// `font-palette` themselves. `createGlyphScene` now does this automatically —
// these tests pin that contract directly against the DOM, not just the option
// plumbing `colorEncoding.test.ts` already covers.

const FONT_FACE_STYLE_ID = "glyph-atlas-font-face";

function makeDiv(): HTMLElement {
  const div = document.createElement("div");
  document.body.appendChild(div);
  return div;
}

async function flushRenders(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => {
  document.head.querySelectorAll(`#${FONT_FACE_STYLE_ID}, style`).forEach((el) => {
    // Only ever remove atlas-family style tags this suite could have created —
    // never touch unrelated `<style>` elements another test file may have left.
    if (el.id === FONT_FACE_STYLE_ID || (el.textContent ?? "").includes("@font-palette-values")) el.remove();
  });
  document.body.innerHTML = "";
});

describe("createGlyphScene — colorEncoding: \"atlas\" CSS injection", () => {
  it("a \"spans\" scene (the default) injects nothing into <head>", async () => {
    const host = makeDiv();
    const scene = createGlyphScene(host, { camera: createGlyphOrthographicCamera() });
    await flushRenders();
    expect(document.getElementById(FONT_FACE_STYLE_ID)).toBeNull();
    expect(scene.output.style.fontFamily).toBe("");
    expect(scene.output.style.getPropertyValue("font-palette")).toBe("");
    scene.destroy();
    host.remove();
  });

  it("an \"atlas\" scene with a palette injects the @font-face once and wires font-family/font-palette on the <pre>", async () => {
    const host = makeDiv();
    const palette = ["#336699"];
    const scene = createGlyphScene(host, {
      camera: createGlyphOrthographicCamera(),
      colorEncoding: "atlas",
      atlasPalette: palette,
    });
    await flushRenders();

    const fontFaceStyle = document.getElementById(FONT_FACE_STYLE_ID);
    expect(fontFaceStyle).not.toBeNull();
    expect(fontFaceStyle!.textContent).toContain(`@font-face`);
    expect(fontFaceStyle!.textContent).toContain(GLYPH_FONT_ATLAS.family);

    expect(scene.output.style.fontFamily).toContain(GLYPH_FONT_ATLAS.family);
    const paletteName = scene.output.style.getPropertyValue("font-palette").trim();
    expect(paletteName).toMatch(/^--glyph-atlas-palette-\d+$/);

    const paletteStyle = Array.from(document.head.querySelectorAll("style")).find(
      (el) => el.textContent?.includes(paletteName),
    );
    expect(paletteStyle).toBeDefined();
    expect(paletteStyle!.textContent).toContain("@font-palette-values");
    expect(paletteStyle!.textContent).toContain("#336699");

    scene.destroy();
    host.remove();
  });

  it("two concurrent atlas scenes share one @font-face but never collide on a palette name", async () => {
    const hostA = makeDiv();
    const hostB = makeDiv();
    const sceneA = createGlyphScene(hostA, {
      camera: createGlyphOrthographicCamera(),
      colorEncoding: "atlas",
      atlasPalette: ["#111111"],
    });
    const sceneB = createGlyphScene(hostB, {
      camera: createGlyphOrthographicCamera(),
      colorEncoding: "atlas",
      atlasPalette: ["#222222"],
    });
    await flushRenders();

    expect(document.querySelectorAll(`#${FONT_FACE_STYLE_ID}`).length).toBe(1);
    const nameA = sceneA.output.style.getPropertyValue("font-palette").trim();
    const nameB = sceneB.output.style.getPropertyValue("font-palette").trim();
    expect(nameA).not.toBe(nameB);

    sceneA.destroy();
    sceneB.destroy();
    hostA.remove();
    hostB.remove();
  });

  it("switching colorEncoding back to \"spans\" via setOptions clears the inline font-family/font-palette", async () => {
    const host = makeDiv();
    const scene = createGlyphScene(host, {
      camera: createGlyphOrthographicCamera(),
      colorEncoding: "atlas",
      atlasPalette: ["#336699"],
    });
    await flushRenders();
    expect(scene.output.style.fontFamily).toContain(GLYPH_FONT_ATLAS.family);

    scene.setOptions({ colorEncoding: "spans" });
    await flushRenders();
    expect(scene.output.style.fontFamily).toBe("");
    expect(scene.output.style.getPropertyValue("font-palette")).toBe("");
    // The shared @font-face stays (other scenes/documents may still need it) —
    // only this scene's own font-family/font-palette wiring reverts.
    expect(document.getElementById(FONT_FACE_STYLE_ID)).not.toBeNull();

    scene.destroy();
    host.remove();
  });

  it("destroy() removes this scene's own @font-palette-values style but leaves the shared @font-face in place", async () => {
    const host = makeDiv();
    const scene = createGlyphScene(host, {
      camera: createGlyphOrthographicCamera(),
      colorEncoding: "atlas",
      atlasPalette: ["#336699"],
    });
    await flushRenders();
    const paletteName = scene.output.style.getPropertyValue("font-palette").trim();
    expect(document.head.querySelector(`style:not(#${FONT_FACE_STYLE_ID})`)).not.toBeNull();

    scene.destroy();
    const stillThere = Array.from(document.head.querySelectorAll("style")).some(
      (el) => el.textContent?.includes(paletteName),
    );
    expect(stillThere).toBe(false);
    expect(document.getElementById(FONT_FACE_STYLE_ID)).not.toBeNull();

    host.remove();
  });

  it("a scene created with colorEncoding \"atlas\" but no atlasPalette still injects the shared @font-face (option-level gate, not per-frame encodability)", async () => {
    const host = makeDiv();
    const scene = createGlyphScene(host, {
      camera: createGlyphOrthographicCamera(),
      colorEncoding: "atlas",
    });
    await flushRenders();
    expect(document.getElementById(FONT_FACE_STYLE_ID)).not.toBeNull();
    // No palette to encode against yet, so no font-palette name is assigned.
    expect(scene.output.style.getPropertyValue("font-palette")).toBe("");
    scene.destroy();
    host.remove();
  });
});
