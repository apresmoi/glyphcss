import { describe, it, expect } from "vitest";
import { buildRasterizeContext } from "../api/rasterizeContext";
import { rasterize } from "./rasterize";
import { createGlyphOrthographicCamera } from "../api/createGlyphCamera";
import type { Polygon, PolyTextureWrap, TextureSampler, Vec2, Vec3 } from "@glyphcss/core";

// A 2x2 texture: red / green / blue / white quadrants.
const sampler: TextureSampler = {
  width: 2,
  height: 2,
  lowDetail: false,
  data: new Uint8ClampedArray([
    255, 0, 0, 255, /**/ 0, 255, 0, 255,
    0, 0, 255, 255, /**/ 255, 255, 255, 255,
  ]),
};

/**
 * One flat quad whose UVs span `tiles` copies of the texture on each axis. With
 * `clamp-to-edge` (the default) every UV past 1 collapses onto the edge texel,
 * so the face shows one 2x2 pattern stretched over it; with `repeat` it shows a
 * `tiles x tiles` grid of them.
 */
function quad(tiles: number, textureWrap?: PolyTextureWrap): Polygon {
  return {
    vertices: [[-1, -1, 0], [-1, 1, 0], [1, 1, 0], [1, -1, 0]] as Vec3[],
    color: "#ffffff",
    texture: "tex",
    uvs: [[0, tiles], [tiles, tiles], [tiles, 0], [0, 0]] as Vec2[],
    ...(textureWrap ? { textureWrap } : {}),
  };
}

function render(poly: Polygon): string {
  const ctx = buildRasterizeContext({
    camera: createGlyphOrthographicCamera({ rotX: 0, rotY: 0, zoom: 400 }),
    grid: { cols: 40, rows: 40, cellAspect: 2 },
    polygons: [poly],
    mode: "solid",
    useColors: true,
    doubleSided: true,
    directionalLight: { direction: [0, 0, 1], intensity: 0 },
    ambientLight: { intensity: 1 },
  });
  ctx.textureSamplers = new Map([["tex", sampler]]);
  return rasterize(ctx);
}

/** How many times the frame switches between the red and the green texel along a row — the tile count, doubled per tile. */
function colorRuns(html: string): number {
  const colors = [...html.matchAll(/color:(#[0-9a-f]{6})/g)].map((m) => m[1]!);
  let runs = 0;
  for (let i = 1; i < colors.length; i++) if (colors[i] !== colors[i - 1]) runs++;
  return runs;
}

describe("Polygon.textureWrap in the per-cell sampler", () => {
  it("repeat tiles one image across UVs beyond [0,1]", () => {
    const clamped = render(quad(4));
    const repeated = render(quad(4, { s: "repeat", t: "repeat" }));
    // Same geometry, same texture, same UVs — only the wrap mode differs, and
    // 4x4 tiles produce far more colour runs than one stretched copy.
    expect(colorRuns(repeated)).toBeGreaterThan(colorRuns(clamped) * 3);
  });

  it("UVs strictly inside [0,1) render identically under repeat and clamp", () => {
    // Nothing inside the unit square ever reaches the wrap, so honouring it is a
    // no-op for every conventionally-mapped face. (A UV of exactly `1.0` is the
    // deliberate exception: under `repeat` it is the START of the next tile and
    // wraps to 0, which is what a GPU sampler does and what makes a `bays`-wide
    // wall tile seamlessly.)
    expect(render(quad(0.5, { s: "repeat", t: "repeat" }))).toBe(render(quad(0.5)));
  });

  it("omitting textureWrap keeps clamp-to-edge", () => {
    expect(render(quad(4))).toBe(render(quad(4, { s: "clamp-to-edge", t: "clamp-to-edge" })));
  });

  it("mirrored-repeat reflects on odd tiles", () => {
    // A 2-tile mirror is symmetric about the seam; a 2-tile repeat is not.
    const mirrored = render(quad(2, { s: "mirrored-repeat", t: "mirrored-repeat" }));
    const repeated = render(quad(2, { s: "repeat", t: "repeat" }));
    expect(mirrored).not.toBe(repeated);
  });
});
