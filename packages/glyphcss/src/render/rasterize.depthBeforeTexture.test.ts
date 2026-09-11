/**
 * `scanFillTriangle` decides DEPTH first, ALPHA second, and only then writes.
 *
 * A fragment that loses the depth test never needs a texel, so the lookup for
 * it is waste — `fillDepthTri` has always decided first and sampled after.
 * What must NOT move with it is the alpha rejection, which stays ahead of the
 * depth WRITE: a fully transparent texel does not cover its cell, so it must
 * not occlude what is behind it.
 *
 * Both halves are pinned here because each has its own mutant. Sampling before
 * the depth test again is invisible (byte-identical, just slower); sampling
 * AFTER the depth write is the sprite-with-a-solid-black-margin bug, and
 * dropping the alpha test altogether is the same bug in its loudest form.
 */
import { describe, expect, it } from "vitest";
import type { Polygon, TextureSampler } from "@glyphcss/core";
import { buildRasterizeContext } from "../api/rasterizeContext";
import { createGlyphOrthographicCamera } from "../api/createGlyphCamera";
import { rasterize } from "./rasterize";

const TEX = "sampler://half-transparent";

/** Left half fully transparent, right half fully opaque red. */
const sampler: TextureSampler = {
  width: 2, height: 1, lowDetail: false,
  data: new Uint8ClampedArray([0, 0, 0, 0, /**/ 255, 0, 0, 255]),
};

function quad(z: number, textured: boolean, color: string): Polygon {
  const p: Polygon = {
    vertices: [[-1, -1, z], [-1, 1, z], [1, 1, z], [1, -1, z]],
    color,
  };
  if (textured) {
    p.texture = TEX;
    p.uvs = [[0, 1], [0, 0], [1, 0], [1, 1]];
  }
  return p;
}

/** Distinct colours found in the rendered spans, in document order. */
function colors(polygons: Polygon[]): string[] {
  const ctx = buildRasterizeContext({
    camera: createGlyphOrthographicCamera({ rotX: 0, rotY: 0, zoom: 300 }),
    grid: { cols: 40, rows: 20, cellAspect: 2 },
    polygons,
    mode: "solid",
    useColors: true,
    doubleSided: true,
    directionalLight: { direction: [0, 0, 1], intensity: 0 },
    ambientLight: { intensity: 1 },
  });
  ctx.textureSamplers = new Map([[TEX, sampler]]);
  return [...new Set([...rasterize(ctx).matchAll(/color:(#[0-9a-f]{6})/g)].map((m) => m[1]!))];
}

describe("scanFillTriangle: depth first, alpha before the write", () => {
  it("a nearer transparent texel does not occlude the surface behind it", () => {
    // Green backing plane, textured plane in FRONT of it. The texture's
    // transparent half must leave the green showing through — not the
    // textured polygon's own flat base colour, and not a blank cell.
    const out = colors([quad(0, false, "#00ff00"), quad(1, true, "#ffffff")]);
    expect(out).toEqual(expect.arrayContaining(["#00ff00", "#ff0000"]));
    // `#ffffff` is the textured quad's flat base colour; a cell painted with it
    // is a cell that claimed coverage its texel does not have.
    expect(out).not.toContain("#ffffff");
  });

  it("a farther textured polygon paints nothing through an opaque one", () => {
    // Same two planes, opposite order in depth: the textured one is BEHIND, so
    // every one of its fragments loses the depth test and neither its texel nor
    // its base colour reaches a cell.
    const out = colors([quad(1, false, "#00ff00"), quad(0, true, "#ffffff")]);
    expect(out).toEqual(["#00ff00"]);
  });

  it("the draw order of the pair does not change the answer", () => {
    // Depth, not submission order, decides — so submitting the textured plane
    // first gives the same picture as submitting it last.
    expect(colors([quad(1, true, "#ffffff"), quad(0, false, "#00ff00")]).sort())
      .toEqual(colors([quad(0, false, "#00ff00"), quad(1, true, "#ffffff")]).sort());
  });
});
