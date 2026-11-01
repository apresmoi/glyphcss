/**
 * Ink mode remembers last frame's line glyphs (`RasterizeContext.inkLineMemory`)
 * so a line drifting across a glyph-bin edge holds its glyph through sub-pixel
 * motion. That memory is scene state, so it must follow the same rule as the
 * shade cache: a frame that throws before it publishes leaves it untouched.
 */
import { describe, it, expect } from "vitest";
import { createGlyphScene } from "./createGlyphScene";
import { createGlyphOrthographicCamera } from "./createGlyphCamera";
import type { Polygon } from "@glyphcss/core";

// Screen-vertical placement is the mesh's world x here (rotX = rotY = 0, zoom 50
// = one row per world unit). A quad's top edge then sits in row 2: '-' until
// the offset passes a quarter cell (x = 0.25), '_' beyond, and the hold keeps
// a drawn '-' until 0.33.
const QUAD: Polygon = { vertices: [[-3, -1, 0], [3, -1, 0], [3, 1, 0], [-3, 1, 0]], color: "#ffffff" };

function setup() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const scene = createGlyphScene(host, {
    camera: createGlyphOrthographicCamera({ rotX: 0, rotY: 0, zoom: 50 }),
    cols: 21, rows: 11, cellAspect: 2, mode: "ink", useColors: false,
  });
  const mesh = scene.add([QUAD]);
  const edgeGlyph = () => (scene.output.textContent ?? "").split("\n")[2]![10]!;
  const frame = (x: number) => {
    mesh.setTransform({ position: [x, 0, 0] });
    scene.rerender();
  };
  return { scene, frame, edgeGlyph };
}

describe("createGlyphScene — ink line memory is staged until a frame publishes", () => {
  it("holds a glyph across published frames (sanity: the memory is live)", () => {
    const { scene, frame, edgeGlyph } = setup();
    frame(0.2);
    expect(edgeGlyph()).toBe("-");
    frame(0.28);
    expect(edgeGlyph()).toBe("-");
    scene.destroy();

    const fresh = setup();
    fresh.frame(0.28);
    expect(fresh.edgeGlyph()).toBe("_");
    fresh.scene.destroy();
  });

  it("a frame that throws after rasterize does not advance the memory", () => {
    const { scene, frame, edgeGlyph } = setup();
    frame(0.2);
    expect(edgeGlyph()).toBe("-");

    // This frame rasterizes the edge as '_' (0.07 past the hold, outside
    // the hold), then fails in the cell hook before anything is published.
    scene.setOptions({ transformCells: () => { throw new Error("boom"); } });
    expect(() => frame(0.4)).toThrow("boom");
    scene.setOptions({ transformCells: undefined });

    // Had the failed frame's '_' been remembered, this would hold '_'.
    frame(0.28);
    expect(edgeGlyph()).toBe("-");
    scene.destroy();
  });
});
