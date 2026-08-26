/**
 * The lazy-payload contract, driven through the test-only import seam
 * (`setGlyphAtlasFontPayloadImportForTests`). Every branch here is otherwise
 * unreachable in a passing run — the real payload is a bundled local module
 * that cannot fail to resolve, and the "spans until the font arrives" window
 * closes in a microtask — so these are exactly the assertions that would rot
 * silently. See `bundle.atlas.test.ts` for the built-output half of the
 * contract (that the payload really is a separate chunk).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGlyphScene } from "../api/createGlyphScene";
import { createGlyphOrthographicCamera } from "../api/createGlyphCamera";
import {
  GLYPH_FONT_ATLAS,
  glyphAtlasFontLoadState,
  glyphAtlasFontPayload,
  loadGlyphAtlasFontFaceCss,
  loadGlyphAtlasFontPayload,
  setGlyphAtlasFontPayloadImportForTests,
} from "./fontAtlas";
import { ensureGlyphAtlasFontFaceStyles, resetGlyphAtlasFontFaceStylesForTests } from "../styles/styles";
import type { Polygon } from "@glyphcss/core";

const FONT_FACE_STYLE_ID = "glyph-atlas-font-face";

const FLAT_LIGHTING = {
  directionalLight: { direction: [0, 0, 1] as [number, number, number], intensity: 0 },
  ambientLight: { intensity: 1 },
};

function flatQuad(color: string): Polygon[] {
  return [{ vertices: [[-3, -3, 0], [-3, 3, 0], [3, 3, 0], [3, -3, 0]], color }];
}

function makeDiv(): HTMLElement {
  const div = document.createElement("div");
  document.body.appendChild(div);
  return div;
}

async function flushRenders(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function hasPua(text: string): boolean {
  for (const ch of text) if (ch.codePointAt(0)! >= GLYPH_FONT_ATLAS.puaStart) return true;
  return false;
}

afterEach(() => {
  setGlyphAtlasFontPayloadImportForTests(null);
  resetGlyphAtlasFontFaceStylesForTests();
  document.head.querySelectorAll("style").forEach((el) => {
    if (el.id === FONT_FACE_STYLE_ID || (el.textContent ?? "").includes("@font-palette-values")) el.remove();
  });
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("fontAtlas — lazy payload loading", () => {
  it("does not touch the payload until something asks for it", () => {
    setGlyphAtlasFontPayloadImportForTests(null);
    expect(glyphAtlasFontLoadState()).toBe("idle");
    expect(glyphAtlasFontPayload()).toBeUndefined();
  });

  it("shares one import across concurrent callers instead of one per scene", async () => {
    let imports = 0;
    setGlyphAtlasFontPayloadImportForTests(async () => {
      imports++;
      return { GLYPH_FONT_ATLAS_WOFF2_BASE64: "AAAA" };
    });
    const results = await Promise.all(Array.from({ length: 10 }, () => loadGlyphAtlasFontPayload()));
    expect(imports).toBe(1);
    expect(new Set(results)).toEqual(new Set(["AAAA"]));
    // And a call AFTER the first settled still doesn't re-import.
    await loadGlyphAtlasFontPayload();
    expect(imports).toBe(1);
    expect(glyphAtlasFontLoadState()).toBe("ready");
  });

  it("degrades to spans permanently after a failed load, with exactly one warning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let imports = 0;
    setGlyphAtlasFontPayloadImportForTests(async () => {
      imports++;
      throw new Error("chunk 404");
    });
    expect(await loadGlyphAtlasFontPayload()).toBeNull();
    expect(await loadGlyphAtlasFontPayload()).toBeNull();
    expect(await loadGlyphAtlasFontPayload()).toBeNull();
    // Terminal for the session: no retry storm, and one warning, not three.
    expect(imports).toBe(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toMatch(/render as "spans" for the rest of this session/);
    expect(glyphAtlasFontLoadState()).toBe("failed");
    expect(glyphAtlasFontPayload()).toBeUndefined();
  });

  it("loadGlyphAtlasFontFaceCss REJECTS on a failed load rather than emitting an empty src", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    setGlyphAtlasFontPayloadImportForTests(async () => {
      throw new Error("chunk 404");
    });
    // The static/CodePen export path: a silently empty `@font-face` would look
    // correct in review and render tofu in the browser.
    await expect(loadGlyphAtlasFontFaceCss()).rejects.toThrow(/could not be loaded/);
  });

  it("ensureGlyphAtlasFontFaceStyles injects nothing when the payload fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    setGlyphAtlasFontPayloadImportForTests(async () => {
      throw new Error("chunk 404");
    });
    expect(await ensureGlyphAtlasFontFaceStyles(document)).toBe(false);
    expect(document.getElementById(FONT_FACE_STYLE_ID)).toBeNull();
  });
});

describe("createGlyphScene — the spans-until-loaded transition", () => {
  const sceneOptions = {
    cols: 40,
    rows: 16,
    useColors: true,
    mode: "solid" as const,
    doubleSided: true,
    ...FLAT_LIGHTING,
  };

  it("renders SPANS — never PUA in a fallback font — for every frame before the payload arrives", async () => {
    // Hold the payload open so the pre-load window is observable rather than a
    // one-microtask blur. This is the frame that would show tofu boxes if the
    // encoder emitted PUA against a font-family that doesn't exist yet.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    setGlyphAtlasFontPayloadImportForTests(async () => {
      await gate;
      return { GLYPH_FONT_ATLAS_WOFF2_BASE64: "AAAA" };
    });

    const host = makeDiv();
    const scene = createGlyphScene(host, {
      ...sceneOptions,
      camera: createGlyphOrthographicCamera({ zoom: 50 }),
      colorEncoding: "atlas",
      atlasPalette: ["#336699"],
    });
    scene.add(flatQuad("#336699"));

    for (let frame = 0; frame < 5; frame++) {
      await flushRenders();
      const html = scene.output.innerHTML;
      expect(html.trim().length).toBeGreaterThan(0);
      expect(hasPua(scene.output.textContent ?? "")).toBe(false);
      expect(html).toContain("<span");
      // Nothing may claim the font is available while it demonstrably isn't.
      expect(document.getElementById(FONT_FACE_STYLE_ID)).toBeNull();
      scene.rerender();
    }

    release();
    await ensureGlyphAtlasFontFaceStyles(document);
    await flushRenders();
    await flushRenders();

    // ...and then it flips, on its own, with no further caller action.
    expect(scene.output.innerHTML).not.toContain("<span");
    expect(hasPua(scene.output.textContent ?? "")).toBe(true);
    expect(document.getElementById(FONT_FACE_STYLE_ID)).not.toBeNull();

    scene.destroy();
    host.remove();
  });

  it("stays on spans forever — no PUA, no throw — when the payload never loads", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    setGlyphAtlasFontPayloadImportForTests(async () => {
      throw new Error("chunk 404");
    });

    const host = makeDiv();
    const scene = createGlyphScene(host, {
      ...sceneOptions,
      camera: createGlyphOrthographicCamera({ zoom: 50 }),
      colorEncoding: "atlas",
      atlasPalette: ["#336699"],
    });
    scene.add(flatQuad("#336699"));
    await ensureGlyphAtlasFontFaceStyles(document);
    await flushRenders();
    await flushRenders();

    const html = scene.output.innerHTML;
    expect(html).toContain("<span");
    expect(hasPua(scene.output.textContent ?? "")).toBe(false);
    // The option is unchanged — the scene reports what the caller asked for;
    // only the ENCODING degrades. And because the frame degraded, the atlas
    // font family must NOT be pinned: the atlas cmap covers U+0020, so a
    // pinned family on a spans frame resolves this text's SPACES from the
    // atlas and everything else from `monospace`, at two different advances.
    expect(scene.output.style.fontFamily).not.toContain(GLYPH_FONT_ATLAS.family);

    scene.destroy();
    host.remove();
  });
});
