import { describe, it, expect } from "vitest";
import { rasterize } from "./rasterize";
import { buildRasterizeContext } from "../api/rasterizeContext";
import { createGlyphPerspectiveCamera } from "../api/createGlyphCamera";
import { computeShapeLighting } from "@glyphcss/core";
import type { Polygon } from "@glyphcss/core";

/** Simple unit cube — 12 triangular polygons (2 per face × 6 faces). */
function makeCubePolygons(): Polygon[] {
  const out: Polygon[] = [];
  const faces: Array<[number, number, number, number, number, number, number, number, number, string]> = [
    // front face  (z = 1)
    [-1, -1, 1,  1, -1, 1,  1,  1, 1, "#ff4444"],
    [-1, -1, 1,  1,  1, 1, -1,  1, 1, "#ff4444"],
    // back  (z = -1)
    [ 1, -1,-1, -1, -1,-1, -1,  1,-1, "#44ff44"],
    [ 1, -1,-1, -1,  1,-1,  1,  1,-1, "#44ff44"],
    // top   (y = 1)
    [-1,  1, 1,  1,  1, 1,  1,  1,-1, "#4444ff"],
    [-1,  1, 1,  1,  1,-1, -1,  1,-1, "#4444ff"],
    // bottom (y = -1)
    [-1, -1,-1,  1, -1,-1,  1, -1, 1, "#ffff44"],
    [-1, -1,-1,  1, -1, 1, -1, -1, 1, "#ffff44"],
    // right  (x = 1)
    [ 1, -1, 1,  1, -1,-1,  1,  1,-1, "#44ffff"],
    [ 1, -1, 1,  1,  1,-1,  1,  1, 1, "#44ffff"],
    // left   (x = -1)
    [-1, -1,-1, -1, -1, 1, -1,  1, 1, "#ff44ff"],
    [-1, -1,-1, -1,  1, 1, -1,  1,-1, "#ff44ff"],
  ];
  for (const [x0,y0,z0, x1,y1,z1, x2,y2,z2, color] of faces) {
    out.push({ vertices: [[x0,y0,z0],[x1,y1,z1],[x2,y2,z2]], color });
  }
  return out;
}

describe("rasterize", () => {
  it("renders a solid cube to non-empty text", () => {
    // rotX/rotY in degrees; zoom=300 with distance=20 produces a clearly visible cube
    const camera = createGlyphPerspectiveCamera({ rotX: 25, rotY: 30, zoom: 300, distance: 20 });
    const ctx = buildRasterizeContext({
      camera,
      grid: { cols: 40, rows: 20, cellAspect: 2.0 },
      polygons: makeCubePolygons(),
      mode: "solid",
      useColors: false,
    });
    const output = rasterize(ctx);
    expect(typeof output).toBe("string");
    // Must have newlines (multi-row grid)
    expect(output).toContain("\n");
    // Must have at least some non-space content (cube is visible)
    expect(output.replace(/\s/g, "").length).toBeGreaterThan(0);
  });

  it("renders wireframe mode to non-empty text", () => {
    const camera = createGlyphPerspectiveCamera({ zoom: 250, distance: 20 });
    const ctx = buildRasterizeContext({
      camera,
      grid: { cols: 30, rows: 15, cellAspect: 2.0 },
      polygons: makeCubePolygons(),
      mode: "wireframe",
      useColors: false,
    });
    const output = rasterize(ctx);
    expect(output.replace(/\s/g, "").length).toBeGreaterThan(0);
  });

  it("renders with colors producing html spans", () => {
    const camera = createGlyphPerspectiveCamera({ zoom: 300, distance: 20 });
    const ctx = buildRasterizeContext({
      camera,
      grid: { cols: 40, rows: 20, cellAspect: 2.0 },
      polygons: makeCubePolygons(),
      mode: "solid",
      useColors: true,
    });
    const output = rasterize(ctx);
    // Color-enabled solid mode should produce span elements
    expect(output).toContain("<span");
  });

  it("produces exactly (rows - 1) newlines for a non-empty render", () => {
    const rows = 10;
    const camera = createGlyphPerspectiveCamera({ zoom: 250, distance: 20 });
    const ctx = buildRasterizeContext({
      camera,
      grid: { cols: 20, rows, cellAspect: 2.0 },
      polygons: makeCubePolygons(),
      mode: "solid",
      useColors: false,
    });
    const output = rasterize(ctx);
    const newlineCount = (output.match(/\n/g) ?? []).length;
    expect(newlineCount).toBe(rows - 1);
  });

  /**
   * Lambert sign convention parity test (voxcss §10 alignment).
   *
   * `GlyphDirectionalLight.direction` = direction light shines TOWARD
   * (mirrors three.js / voxcss `PolyDirectionalLight`).
   * Both `computeShapeLighting` (core) and the rasterizer's inline Lambert
   * must agree: a face whose outward normal opposes the light direction
   * (i.e. faces BACK toward the source) is lit; a face whose normal aligns
   * with the direction (faces AWAY from the source) is unlit.
   *
   * Concretely: light shines toward [0,0,-1] (downward in world space).
   *   • A top face (normal ≈ [0,0,+1]) opposes the direction → lit (lambert = 1).
   *   • A bottom face (normal ≈ [0,0,-1]) aligns with the direction → unlit (lambert = 0).
   *
   * `computeShapeLighting` is the reference implementation (identical to voxcss):
   *   lambert = max(0, -dot(n, dir))
   *
   * Verify the rasterizer's output for the top face is brighter than for the
   * bottom face using a camera aligned with +Z (looking down) and ambient=0
   * so only directional light contributes to glyph brightness.
   */
  it("Lambert sign: direction=[0,0,-1] lights the +Z-normal face, not the -Z face (voxcss parity)", () => {
    // Single large triangle filling most of the screen, facing +Z.
    // camera.rotX=90 looks straight down so the +Z face is visible head-on.
    // High zoom to fill the grid, distance small to keep perspective tight.
    const topFace: Polygon = {
      vertices: [[-5, -5, 0], [5, -5, 0], [0, 5, 0]],
      color: "#ffffff",
    };
    const bottomFace: Polygon = {
      vertices: [[-5, -5, 0], [0, 5, 0], [5, -5, 0]], // reversed winding → normal [0,0,-1]
      color: "#ffffff",
    };

    // Verify computeShapeLighting (core reference, identical to voxcss) agrees:
    // top face (+Z normal) fully lit by direction [0,0,-1]
    const topLit = computeShapeLighting(
      [0, 0, 1], "#ffffff",
      { direction: [0, 0, -1], color: "#ffffff", intensity: 1 },
      { color: "#ffffff", intensity: 0 },
    );
    const bottomLit = computeShapeLighting(
      [0, 0, -1], "#ffffff",
      { direction: [0, 0, -1], color: "#ffffff", intensity: 1 },
      { color: "#ffffff", intensity: 0 },
    );
    // top face lambert=1 → max brightness; bottom face lambert=0 → dark (ambient=0 → black)
    expect(topLit).toBe("rgb(255, 255, 255)");
    expect(bottomLit).toBe("rgb(0, 0, 0)");

    // Now verify the rasterizer matches: render each face in isolation and
    // compare non-space character counts (brighter glyph → more visible).
    // rotX=90 looks straight down (camera aligned with -Z world axis).
    const camera = createGlyphPerspectiveCamera({ rotX: 90, rotY: 0, zoom: 400, distance: 20 });
    const lightToward = { direction: [0, 0, -1] as [number, number, number], color: "#ffffff", intensity: 1 };
    const noAmbient = { color: "#ffffff", intensity: 0 };

    const ctxTop = buildRasterizeContext({
      camera,
      grid: { cols: 40, rows: 20, cellAspect: 2.0 },
      polygons: [topFace],
      mode: "solid",
      useColors: false,
      directionalLight: lightToward,
      ambientLight: noAmbient,
    });
    const ctxBottom = buildRasterizeContext({
      camera,
      grid: { cols: 40, rows: 20, cellAspect: 2.0 },
      polygons: [bottomFace],
      mode: "solid",
      useColors: false,
      directionalLight: lightToward,
      ambientLight: noAmbient,
    });

    const outTop = rasterize(ctxTop);
    const outBottom = rasterize(ctxBottom);

    const topNonSpace = outTop.replace(/[\s\n]/g, "").length;
    const bottomNonSpace = outBottom.replace(/[\s\n]/g, "").length;

    // With ambient=0, the bottom face (unlit) should render as all spaces (invisible).
    // The top face (fully lit) should render with visible glyphs.
    expect(bottomNonSpace).toBe(0);
    expect(topNonSpace).toBeGreaterThan(0);
  });
});
