/**
 * ALPHA-AWARE occlusion claims (`computeOcclusionIds` + `textureSamplers`).
 *
 * A textured polygon must claim id-map cells only where its sampled texel is
 * actually opaque — the same `a > TEXEL_COVERAGE_ALPHA_MIN` coverage test the
 * paint rasterizer applies — instead of its whole triangle footprint. Without
 * this, a sprite quad's transparent margin blanks the layer beneath it, which
 * reads as a black halo around the artwork.
 *
 * Contract pinned here:
 *  - omitting `textureSamplers` keeps the pure-geometry claims (old callers
 *    byte-identical);
 *  - a fully transparent texture claims NOTHING;
 *  - a fully opaque texture claims exactly what geometry claims (and skips
 *    per-cell sampling via the once-per-sampler transparency scan);
 *  - the threshold is the paint path's: alpha == TEXEL_COVERAGE_ALPHA_MIN (8)
 *    does not cover, alpha 9 does;
 *  - a higher `occlusionPriority` group's transparent texels do NOT steal
 *    cells from the lower-priority group beneath (weapon-over-world).
 */
import { describe, expect, it } from "vitest";
import type { Polygon, TextureSampler } from "@glyphcss/core";
import { createGlyphOrthographicCamera } from "../api/createGlyphCamera";
import { computeOcclusionIds } from "./rasterize";

const COLS = 32;
const ROWS = 24;

const TEX_URL = "sampler://sprite";

function quad(z: number, x0 = -1, x1 = 1): Polygon {
  return {
    vertices: [[x0, -1, z], [x0, 1, z], [x1, 1, z], [x1, -1, z]],
    uvs: [[0, 0], [0, 1], [1, 1], [1, 0]],
    texture: TEX_URL,
    color: "#ffffff",
  };
}

function rgbaSampler(alphas: number[], width: number, height: number): TextureSampler {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = 255; data[i * 4 + 1] = 255; data[i * 4 + 2] = 255;
    data[i * 4 + 3] = alphas[i]!;
  }
  return { width, height, data, lowDetail: false };
}

function samplers(s: TextureSampler): Map<string, TextureSampler> {
  return new Map([[TEX_URL, s]]);
}

const camera = () => createGlyphOrthographicCamera({ rotX: 0, rotY: 0, zoom: 160 });

function claimedCount(ids: Int32Array, id: number): number {
  let n = 0;
  for (let i = 0; i < ids.length; i++) if (ids[i] === id) n++;
  return n;
}

describe("computeOcclusionIds alpha-aware claims", () => {
  it("without textureSamplers, geometry claims are unchanged (old-caller baseline)", () => {
    const ids = computeOcclusionIds([{ polygons: [quad(0)], id: 7 }], camera(), COLS, ROWS, 2);
    expect(claimedCount(ids, 7)).toBeGreaterThan(0);
  });

  it("a fully transparent texture claims nothing", () => {
    const ids = computeOcclusionIds(
      [{ polygons: [quad(0)], id: 7 }],
      camera(), COLS, ROWS, 2, 1, undefined,
      samplers(rgbaSampler([0], 1, 1)),
    );
    expect(claimedCount(ids, 7)).toBe(0);
  });

  it("a fully opaque texture claims exactly the geometry footprint", () => {
    const baseline = computeOcclusionIds([{ polygons: [quad(0)], id: 7 }], camera(), COLS, ROWS, 2);
    const ids = computeOcclusionIds(
      [{ polygons: [quad(0)], id: 7 }],
      camera(), COLS, ROWS, 2, 1, undefined,
      samplers(rgbaSampler([255], 1, 1)),
    );
    expect(Array.from(ids)).toEqual(Array.from(baseline));
  });

  it("a half-transparent texture claims only its opaque half (the halo case)", () => {
    const baseline = computeOcclusionIds([{ polygons: [quad(0)], id: 7 }], camera(), COLS, ROWS, 2);
    const full = claimedCount(baseline, 7);
    // Left texel opaque, right transparent — the sprite's "art + margin".
    const ids = computeOcclusionIds(
      [{ polygons: [quad(0)], id: 7 }],
      camera(), COLS, ROWS, 2, 1, undefined,
      samplers(rgbaSampler([255, 0], 2, 1)),
    );
    const claimed = claimedCount(ids, 7);
    expect(claimed).toBeGreaterThan(0);
    expect(claimed).toBeLessThan(full);
    // Roughly half: the claim boundary tracks the texture, not the quad.
    expect(claimed).toBeGreaterThan(full * 0.3);
    expect(claimed).toBeLessThan(full * 0.7);
  });

  it("threshold matches the paint path: alpha 8 does not cover, alpha 9 does", () => {
    const baseline = computeOcclusionIds([{ polygons: [quad(0)], id: 7 }], camera(), COLS, ROWS, 2);
    const at8 = computeOcclusionIds(
      [{ polygons: [quad(0)], id: 7 }],
      camera(), COLS, ROWS, 2, 1, undefined,
      samplers(rgbaSampler([8], 1, 1)),
    );
    expect(claimedCount(at8, 7)).toBe(0);
    const at9 = computeOcclusionIds(
      [{ polygons: [quad(0)], id: 7 }],
      camera(), COLS, ROWS, 2, 1, undefined,
      samplers(rgbaSampler([9], 1, 1)),
    );
    expect(Array.from(at9)).toEqual(Array.from(baseline));
  });

  it("a priority group's transparent texels do not steal cells from the group beneath", () => {
    // Far "world" under a nearer priority-1 foreground layer whose texture is
    // fully transparent: the world must keep every cell.
    const ids = computeOcclusionIds(
      [
        { polygons: [{ ...quad(0), texture: undefined, uvs: undefined }], id: 0 },
        { polygons: [quad(1)], id: 7, occlusionPriority: 1 },
      ],
      camera(), COLS, ROWS, 2, 1, undefined,
      samplers(rgbaSampler([0], 1, 1)),
    );
    expect(claimedCount(ids, 7)).toBe(0);
    expect(claimedCount(ids, 0)).toBeGreaterThan(0);
  });
});
