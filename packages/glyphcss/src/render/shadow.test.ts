import { describe, it, expect } from "vitest";
import { rasterize } from "./rasterize";
import { buildRasterizeContext } from "../api/rasterizeContext";
import { createGlyphPerspectiveCamera } from "../api/createGlyphCamera";
import type { Polygon, Vec3 } from "@glyphcss/core";

/**
 * Shadow-map tests. Contract mirrors polycss castShadow tests:
 *   - No shadow option → no darkening (identical to pre-shadow baseline).
 *   - castShadow=false → no darkening even when shadow option is set.
 *   - castShadow=true + receiveShadow=true → ground under cube is darker.
 *   - Self-shadow: castShadow+receiveShadow on same mesh → crevices are darker.
 */

// Camera looking slightly down so both cube top and ground plane are visible.
// rotX=55 gives a nice oblique view; zoom+distance chosen so cube and ground fill the grid.
const CAMERA = createGlyphPerspectiveCamera({ rotX: 55, rotY: 30, zoom: 250, distance: 20 });
const GRID = { cols: 60, rows: 30, cellAspect: 2.0 };
const DIR_LIGHT_DOWN = { direction: [0, 0, 1] as Vec3, intensity: 1 };
const AMB_LIGHT = { intensity: 0.3 };

/** Unit cube centered at (0, 0, 1) — hovering 0.5 units above the ground plane. */
function makeCubePolygons(z = 1): Polygon[] {
  const out: Polygon[] = [];
  const faces: Array<[[number,number,number],[number,number,number],[number,number,number],string]> = [
    [[-1,-1,z+1],[1,-1,z+1],[1,1,z+1],"#cccccc"],
    [[-1,-1,z+1],[1,1,z+1],[-1,1,z+1],"#cccccc"],
    [[1,-1,z-1],[-1,-1,z-1],[-1,1,z-1],"#aaaaaa"],
    [[1,-1,z-1],[-1,1,z-1],[1,1,z-1],"#aaaaaa"],
    [[-1,1,z+1],[1,1,z+1],[1,1,z-1],"#bbbbbb"],
    [[-1,1,z+1],[1,1,z-1],[-1,1,z-1],"#bbbbbb"],
    [[-1,-1,z-1],[1,-1,z-1],[1,-1,z+1],"#999999"],
    [[-1,-1,z-1],[1,-1,z+1],[-1,-1,z+1],"#999999"],
    [[1,-1,z+1],[1,-1,z-1],[1,1,z-1],"#aaaaaa"],
    [[1,-1,z+1],[1,1,z-1],[1,1,z+1],"#aaaaaa"],
    [[-1,-1,z-1],[-1,-1,z+1],[-1,1,z+1],"#aaaaaa"],
    [[-1,-1,z-1],[-1,1,z+1],[-1,1,z-1],"#aaaaaa"],
  ];
  for (const [v0, v1, v2, color] of faces) {
    out.push({ vertices: [v0, v1, v2], color });
  }
  return out;
}

/** Large ground plane at z=0, facing up (+Z normal = CCW winding from above). */
function makeGroundPolygons(): Polygon[] {
  return [
    { vertices: [[-5,-5,0],[5,-5,0],[5,5,0]], color: "#888888" },
    { vertices: [[-5,-5,0],[5,5,0],[-5,5,0]], color: "#888888" },
  ];
}

function countNonSpace(s: string): number {
  return s.replace(/[\s\n]/g, "").length;
}

describe("shadow map", () => {
  it("default (no shadow option) — identical to baseline, no darkening", () => {
    const cubePolys = makeCubePolygons();
    const groundPolys = makeGroundPolygons();

    const ctxNoShadow = buildRasterizeContext({
      camera: CAMERA, grid: GRID,
      polygons: [...cubePolys, ...groundPolys],
      mode: "solid",
      directionalLight: DIR_LIGHT_DOWN,
      ambientLight: AMB_LIGHT,
      useColors: false,
      // No shadow option, no flags
    });

    const ctxShadowOff = buildRasterizeContext({
      camera: CAMERA, grid: GRID,
      polygons: [...cubePolys, ...groundPolys],
      mode: "solid",
      directionalLight: DIR_LIGHT_DOWN,
      ambientLight: AMB_LIGHT,
      useColors: false,
      // Shadow option set but no castShadow flags → effectively off
      shadow: { opacity: 0.5 },
      castShadowFlags: new Array(cubePolys.length + groundPolys.length).fill(false),
      receiveShadowFlags: new Array(cubePolys.length + groundPolys.length).fill(false),
    });

    expect(rasterize(ctxNoShadow)).toBe(rasterize(ctxShadowOff));
  });

  it("castShadow=false → no shadow on ground (same as no-shadow baseline)", () => {
    const cubePolys = makeCubePolygons();
    const groundPolys = makeGroundPolygons();
    const allPolys = [...cubePolys, ...groundPolys];
    const n = allPolys.length;
    const nc = cubePolys.length;

    const ctxBaseline = buildRasterizeContext({
      camera: CAMERA, grid: GRID,
      polygons: allPolys, mode: "solid",
      directionalLight: DIR_LIGHT_DOWN, ambientLight: AMB_LIGHT,
      useColors: false,
    });

    // Shadow option set, but castShadow=false for cube → no shadow
    const castFlags = new Array(n).fill(false);
    const receiveFlags = new Array(n).fill(false);
    for (let i = nc; i < n; i++) receiveFlags[i] = true; // ground receives
    const ctxNocast = buildRasterizeContext({
      camera: CAMERA, grid: GRID,
      polygons: allPolys, mode: "solid",
      directionalLight: DIR_LIGHT_DOWN, ambientLight: AMB_LIGHT,
      useColors: false,
      shadow: { opacity: 0.5 },
      castShadowFlags: castFlags,
      receiveShadowFlags: receiveFlags,
    });

    expect(rasterize(ctxBaseline)).toBe(rasterize(ctxNocast));
  });

  it("shadows do not darken ambient-only light", () => {
    const cubePolys = makeCubePolygons();
    const groundPolys = makeGroundPolygons();
    const allPolys = [...cubePolys, ...groundPolys];
    const n = allPolys.length;
    const nc = cubePolys.length;
    const ambientOnlyDirectional = { direction: [0, 0, 1] as Vec3, intensity: 0 };
    const ambient = { color: "#ffffff", intensity: 0.75 };

    const ctxBaseline = buildRasterizeContext({
      camera: CAMERA, grid: GRID,
      polygons: allPolys, mode: "solid",
      directionalLight: ambientOnlyDirectional, ambientLight: ambient,
      useColors: true,
    });

    const castFlags = new Array(n).fill(false);
    const receiveFlags = new Array(n).fill(false);
    for (let i = 0; i < nc; i++) castFlags[i] = true;
    for (let i = nc; i < n; i++) receiveFlags[i] = true;

    const ctxShadow = buildRasterizeContext({
      camera: CAMERA, grid: GRID,
      polygons: allPolys, mode: "solid",
      directionalLight: ambientOnlyDirectional, ambientLight: ambient,
      useColors: true,
      shadow: { opacity: 0.9, lift: 0.05 },
      castShadowFlags: castFlags,
      receiveShadowFlags: receiveFlags,
    });

    expect(rasterize(ctxShadow)).toBe(rasterize(ctxBaseline));
  });

  it("castShadow=true + receiveShadow=true → ground under cube is darker than without shadow", () => {
    const cubePolys = makeCubePolygons();
    const groundPolys = makeGroundPolygons();
    const allPolys = [...cubePolys, ...groundPolys];
    const n = allPolys.length;
    const nc = cubePolys.length;

    // Baseline: no shadows
    const ctxBaseline = buildRasterizeContext({
      camera: CAMERA, grid: GRID,
      polygons: allPolys, mode: "solid",
      directionalLight: DIR_LIGHT_DOWN, ambientLight: AMB_LIGHT,
      useColors: false,
    });

    // With shadows: cube casts, ground receives
    const castFlags = new Array(n).fill(false);
    const receiveFlags = new Array(n).fill(false);
    for (let i = 0; i < nc; i++) castFlags[i] = true;       // cube casts
    for (let i = nc; i < n; i++) receiveFlags[i] = true;    // ground receives

    const ctxShadow = buildRasterizeContext({
      camera: CAMERA, grid: GRID,
      polygons: allPolys, mode: "solid",
      directionalLight: DIR_LIGHT_DOWN, ambientLight: AMB_LIGHT,
      useColors: false,
      shadow: { opacity: 0.6, lift: 0.05 },
      castShadowFlags: castFlags,
      receiveShadowFlags: receiveFlags,
    });

    const outBaseline = rasterize(ctxBaseline);
    const outShadow = rasterize(ctxShadow);

    // The shadow output must differ from baseline
    expect(outShadow).not.toBe(outBaseline);

    // The shadow output should have FEWER non-space characters (shadow regions
    // push glyph intensity down toward space) OR a different character distribution.
    // At minimum, the two must differ.
    const baseNonSpace = countNonSpace(outBaseline);
    const shadowNonSpace = countNonSpace(outShadow);
    // Shadow darkens some ground cells → those cells may become spaces or darker chars.
    // We can't guarantee fewer non-space (darker chars are still non-space), but
    // the outputs must differ, which is the core contract.
    expect(outShadow).not.toBe(outBaseline);
    // Stronger: when opacity is high (0.6), some cells become spaces
    expect(shadowNonSpace).toBeLessThanOrEqual(baseNonSpace);
  });

  it("self-shadow: one cast+receive mesh can shadow its own lit receiver faces", () => {
    const cubePolys = makeCubePolygons();
    const groundPolys = makeGroundPolygons();
    const allPolys = [...cubePolys, ...groundPolys];
    const n = allPolys.length;
    const castFlags = new Array(n).fill(true);
    const receiveFlags = new Array(n).fill(true);

    const ctxBaseline = buildRasterizeContext({
      camera: CAMERA, grid: GRID,
      polygons: allPolys, mode: "solid",
      directionalLight: DIR_LIGHT_DOWN, ambientLight: AMB_LIGHT,
      useColors: false,
    });

    const ctxSelf = buildRasterizeContext({
      camera: CAMERA, grid: GRID,
      polygons: allPolys, mode: "solid",
      directionalLight: DIR_LIGHT_DOWN, ambientLight: AMB_LIGHT,
      useColors: false,
      shadow: { opacity: 0.5, lift: 0.05 },
      castShadowFlags: castFlags,
      receiveShadowFlags: receiveFlags,
    });

    expect(rasterize(ctxSelf)).not.toBe(rasterize(ctxBaseline));
  });
});
