import { expect, it } from "vitest";
import { createGlyphOrthographicCamera } from "./createGlyphCamera";
import { buildRasterizeContext } from "./rasterizeContext";
import { rasterize } from "../render/rasterize";
import { createGlyphAtlasPaletteQuantizer, resolveGlyphAtlasHistogramResolver } from "../render/paletteQuantize";

it("preserves complete output, fallback and pooled palettes against the separate-pass source", () => {
  let now = 0;
  const fused = createGlyphAtlasPaletteQuantizer({ now: () => now, maxSize: 3 });
  const reference = createGlyphAtlasPaletteQuantizer({ now: () => now, maxSize: 3 });
  const wrapped = { resolveGlyphAtlasPalette: reference.resolveGlyphAtlasPalette.bind(reference) };
  expect(resolveGlyphAtlasHistogramResolver(fused)).toBeTypeOf("function");
  expect(resolveGlyphAtlasHistogramResolver(wrapped)).toBeUndefined();
  for (let frame = 0; frame < 20; frame++) {
    now += 130;
    fused.beginTransaction(); reference.beginTransaction();
    for (let layer = 0; layer < 2; layer++) {
      const render = (atlasPalette: typeof fused | typeof wrapped) => {
        const ctx = buildRasterizeContext({
          camera: createGlyphOrthographicCamera({ zoom: 100 }),
          grid: { cols: 16, rows: 10, cellAspect: 2 }, mode: "solid", useColors: true,
          colorEncoding: "atlas", atlasPalette,
          transformCells(grid) {
            for (let i = 0; i < 160; i++) {
              grid.char[i] = frame % 6 === 0 ? " " : "@";
              grid.color[i] = `#${((i * 173 + frame * 19379 + layer * 8911) & 0xffffff).toString(16).padStart(6, "0")}`;
            }
            if (frame % 6 === 1) grid.char[159] = "ᚡ";
            if (frame % 6 === 2) grid.color[159] = "red";
            if (frame % 6 === 3) grid.color[159] = null;
          },
        });
        try {
          const text = rasterize(ctx);
          return { text, atlas: ctx.atlasEncoded, fallback: ctx.atlasGlyphFallback };
        } catch (error) {
          return { error: (error as Error).message, atlas: ctx.atlasEncoded, fallback: ctx.atlasGlyphFallback };
        }
      };
      expect(render(fused)).toEqual(render(wrapped));
      expect(fused.palette).toEqual(reference.palette);
      expect(fused.generation).toBe(reference.generation);
      expect(fused.repoolDeferredMs()).toBe(reference.repoolDeferredMs());
    }
    fused.endTransaction(); reference.endTransaction();
  }
  fused.resolveGlyphAtlasPalette = wrapped.resolveGlyphAtlasPalette;
  expect(resolveGlyphAtlasHistogramResolver(fused)).toBeUndefined();
});
