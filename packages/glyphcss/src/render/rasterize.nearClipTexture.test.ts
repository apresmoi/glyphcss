import { describe, it, expect } from "vitest";
import { buildRasterizeContext } from "../api/rasterizeContext";
import { rasterize } from "./rasterize";
import {
  createGlyphOrthographicCamera,
  createGlyphPerspectiveCamera,
} from "../api/createGlyphCamera";
import type { Polygon, TextureSampler, Vec2, Vec3 } from "@glyphcss/core";

// A 2x2 texture: red / green / blue / white quadrants — the same fixture
// `textureSampling.test.ts` uses, so a texel colour in the output can only have
// come from the per-cell sampler and never from a polygon `color`.
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
 * The three CHROMATIC texels. A grey polygon `color` can never produce any of
 * them, so seeing one is proof the per-cell sampler ran. Their exact tone is the
 * scene's own light multiplier, which is why the reference render below derives
 * it rather than this file hard-coding it.
 */
const CHROMATIC = ["#800000", "#008000", "#000080"];

/**
 * The road you are standing on: one ground quad running from BEHIND the eye
 * out to the horizon, so it straddles the near plane and takes the rasterizer's
 * clipping branch. Its whole face is UV-mapped 0..1.
 */
const roadQuad: Polygon = {
  vertices: [
    [-6, -20, 0], [6, -20, 0], [6, 120, 0], [-6, 120, 0],
  ] as Vec3[],
  // Mid grey: a texel MODULATES the base colour, so a white texel lands back on
  // this exact tone while the three chromatic ones cannot.
  color: "#808080",
  texture: "tex",
  uvs: [[0, 0], [1, 0], [1, 1], [0, 1]] as Vec2[],
};

const PERSPECTIVE = 2500;

/** Eye at 1.7 m looking level along +Y (the harness's own pose convention). */
function streetCamera() {
  const rotX = 90, rotY = -90;
  const d = Math.PI / 180;
  const n: Vec3 = [
    Math.sin(rotX * d) * Math.cos(rotY * d),
    Math.sin(rotX * d) * Math.sin(rotY * d),
    Math.cos(rotX * d),
  ];
  const back = PERSPECTIVE / 50;
  const camera = createGlyphPerspectiveCamera({
    rotX, rotY, perspective: PERSPECTIVE, zoom: 43,
  });
  camera.target = [0 - n[0] * back, 0 - n[1] * back, 1.7 - n[2] * back];
  return camera;
}

function render(camera: ReturnType<typeof streetCamera> | ReturnType<typeof createGlyphOrthographicCamera>, withSamplers: boolean, polygons: Polygon[] = [roadQuad]): string {
  const ctx = buildRasterizeContext({
    camera,
    grid: { cols: 60, rows: 24, cellAspect: 2 },
    polygons,
    mode: "solid",
    useColors: true,
    doubleSided: true,
    // Full ambient, no key → a texel passes through unshaded and its colour is
    // exactly the texel's own.
    directionalLight: { direction: [0, 0, 1], intensity: 0 },
    ambientLight: { intensity: 1 },
  });
  if (withSamplers) ctx.textureSamplers = new Map([["tex", sampler]]);
  return rasterize(ctx);
}

function distinctColors(html: string): string[] {
  return [...new Set([...html.matchAll(/color:(#[0-9a-f]{6})/g)].map((m) => m[1]!))];
}

describe("near-plane-clipped textured triangles", () => {
  it("the ground quad under the eye really does straddle the near plane", () => {
    // If it did not, the assertion below would pass through the unclipped fast
    // path and prove nothing.
    const camera = streetCamera();
    const depths = roadQuad.vertices.map((v) => camera.eyeDepth(v as Vec3));
    expect(depths.some((d) => d > 0)).toBe(true);
    expect(depths.some((d) => d <= 0)).toBe(true);
  });

  it("keeps sampling the texture across the near-plane crossing", () => {
    const colors = distinctColors(render(streetCamera(), true));
    // The defect painted the whole quad in one flat tone (`#101010` shaded)
    // because the clipped branch handed `scanFillTriangle` a null texture ctx.
    expect(colors).toEqual(expect.arrayContaining(CHROMATIC));
  });

  it("a clipped sub-triangle shades a texel exactly as the unclipped path does", () => {
    // Self-calibrating: the same texture under the same lighting, once through
    // the clipping branch and once through the fast path. The clip interpolates
    // positions and UVs; it must not change what a texel LOOKS like, so every
    // chromatic tone the fast path produces has to be reachable through the clip.
    const ortho = createGlyphOrthographicCamera({ rotX: 65, rotY: 45, zoom: 6 });
    const unclipped = distinctColors(render(ortho, true));
    expect(unclipped).toEqual(expect.arrayContaining(CHROMATIC));
    expect(distinctColors(render(streetCamera(), true)))
      .toEqual(expect.arrayContaining(CHROMATIC));
  });

  it("without a sampler the same straddling quad still renders flat", () => {
    const colors = distinctColors(render(streetCamera(), false));
    for (const c of CHROMATIC) expect(colors).not.toContain(c);
  });

  it("an orthographic camera never clips, so its render is byte-identical", () => {
    const ortho = createGlyphOrthographicCamera({ rotX: 65, rotY: 45, zoom: 6 });
    // Recorded from the pre-fix build: the clipping branch is unreachable under
    // an orthographic camera (`eyeDepth` is +Infinity), so this must not move.
    expect(render(ortho, true)).toMatchSnapshot();
  });
});
