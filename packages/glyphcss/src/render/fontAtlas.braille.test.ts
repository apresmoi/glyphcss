import { describe, expect, it, vi } from "vitest";
import { cubePolygons } from "@glyphcss/core";
import type { GlyphFontAtlas } from "./fontAtlas";
import { createGlyphScene } from "../api/createGlyphScene";
import { createGlyphOrthographicCamera } from "../api/createGlyphCamera";
import { buildRasterizeContext } from "../api/rasterizeContext";
import { ensureGlyphAtlasFontFaceStyles } from "../styles/styles";
import { encodeGlyphAtlas, isGlyphAtlasEncodable } from "./cells";
import { decodeGlyphAtlasText, GLYPH_FONT_ATLAS } from "./fontAtlas";
import { histogramGridColors } from "./paletteQuantize";
import { rasterize } from "./rasterize";

const BRAILLE = Array.from({ length: 256 }, (_, i) => String.fromCodePoint(0x2800 + i));

describe("full braille atlas integration", () => {
  it("encodes every pattern in a multi-row grid and counts histogram cells before encoding", () => {
    const colors = BRAILLE.map((_, i) => i % 2 ? "#ff0000" : "#0000ff");
    expect(isGlyphAtlasEncodable(BRAILLE, colors, 16, 16)).toBe(true);
    expect(histogramGridColors(BRAILLE, colors, 256)).toEqual(new Map([[0x0000ff, 128], [0xff0000, 128]]));
    const text = encodeGlyphAtlas(BRAILLE, colors, 16, 16, ["#0000ff", "#ff0000"]);
    expect(text).not.toContain("<span");
    expect(text.split("\n").map((row) => [...row].length)).toEqual(Array(16).fill(16));
    expect(text.length).toBe(256 + 248 + 15);
    expect(decodeGlyphAtlasText(text).replace(/\n/g, "")).toBe(BRAILLE.join(""));
  });

  it("keeps a scene stamped with all 256 braille patterns in atlas mode across rerenders", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const scene = createGlyphScene(host, {
      cols: 16, rows: 16, useColors: true, colorEncoding: "atlas",
      transformCells: (grid) => {
        for (let i = 0; i < 256; i++) { grid.char[i] = BRAILLE[i]!; grid.color[i] = "#123456"; }
      },
    });
    try {
      await ensureGlyphAtlasFontFaceStyles(document);
      await Promise.resolve();
      for (let frame = 0; frame < 3; frame++) {
        scene.rerender();
        expect(scene.output.innerHTML).not.toContain("<span");
        expect(scene.output.style.fontFamily).toContain(GLYPH_FONT_ATLAS.family);
        expect(decodeGlyphAtlasText(scene.output.textContent!).replace(/\n/g, "")).toBe(BRAILLE.join(""));
        expect(scene.output.style.getPropertyValue("font-palette")).toMatch(/^--glyph-atlas-palette-/);
      }
    } finally { scene.destroy(); host.remove(); }
  });

  it.each(["solid", "wireframe", "ink"] as const)("preserves non-braille %s scene bytes against the original atlas layout", (mode) => {
    const { extension: _, ...metadata } = GLYPH_FONT_ATLAS;
    const legacyAtlas = { ...metadata, glyphs: GLYPH_FONT_ATLAS.glyphs.slice(0, 212), glyphCount: 212 };
    const random = vi.spyOn(Math, "random").mockReturnValue(0);
    try {
      const render = (fontAtlas: GlyphFontAtlas) => {
        const ctx = buildRasterizeContext({
          camera: createGlyphOrthographicCamera({ zoom: 20 }),
          grid: { cols: 30, rows: 12, cellAspect: 2 }, mode,
          useColors: true, colorEncoding: "atlas", atlasPalette: ["#336699"], fontAtlas,
          doubleSided: true,
          polygons: cubePolygons({ center: [0, 0, 0], size: 4, color: "#336699" }),
        });
        const text = rasterize(ctx);
        expect(ctx.atlasEncoded).toBe(true);
        expect(text.replace(/\s/g, "").length).toBeGreaterThan(0);
        return text;
      };
      expect(render(GLYPH_FONT_ATLAS)).toBe(render(legacyAtlas));
    } finally { random.mockRestore(); }
  });

  it("keeps a wireframe braille scene pinned to the atlas with no span fallback", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const scene = createGlyphScene(host, {
      cols: 30, rows: 12, mode: "wireframe", charMode: "braille",
      camera: createGlyphOrthographicCamera({ zoom: 20 }),
      useColors: true, colorEncoding: "atlas", atlasPalette: ["#336699"],
    });
    try {
      scene.add([{ vertices: [[-3, -3, 0], [-3, 3, 0], [3, 3, 0], [3, -3, 0]], color: "#336699" }]);
      await ensureGlyphAtlasFontFaceStyles(document);
      scene.rerender();
      expect(scene.output.innerHTML).not.toContain("<span");
      expect(scene.output.style.fontFamily).toContain(GLYPH_FONT_ATLAS.family);
      expect(decodeGlyphAtlasText(scene.output.textContent!)).toMatch(/[\u2801-\u28ff]/);
    } finally { scene.destroy(); host.remove(); }
  });

  it.each([false, true])("wireframe charMode braille uses one colour per cell and atlas (hook=%s)", (hook) => {
    const ctx = buildRasterizeContext({
      camera: createGlyphOrthographicCamera({ zoom: 20 }),
      grid: { cols: 30, rows: 12, cellAspect: 2 },
      mode: "wireframe", charMode: "braille", useColors: true,
      colorEncoding: "atlas", atlasPalette: ["#336699"],
      wireframe: [{ from: [-4, -2, 0], to: [4, 2, 0], weight: 2, color: "#336699" }],
      ...(hook ? { transformCells: () => {} } : {}),
    });
    const encoded = rasterize(ctx);
    expect(ctx.atlasEncoded).toBe(true);
    expect(encoded).not.toContain("<span");
    const plain = decodeGlyphAtlasText(encoded);
    expect(plain).toMatch(/[\u2801-\u28ff]/);
    expect(plain.split("\n").every((row) => row.length === 30)).toBe(true);
  });
});
