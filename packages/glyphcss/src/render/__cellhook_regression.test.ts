import { describe, it, expect } from "vitest";
import { createGlyphOrthographicCamera, createGlyphPerspectiveCamera } from "../api/createGlyphCamera";
import { buildRasterizeContext } from "../api/rasterizeContext";
import { rasterize, rasterizeToCells } from "./rasterize";
import { encodeGlyphBuffers } from "./cells";
import type { CellGrid } from "./cells";
import type { Polygon } from "@glyphcss/core";

// A fixed, deterministic solid scene — the exact code path the creature (VIEW)
// renders through (rasterizeSolid, Bayer dither, no Math.random). Hashing its
// rasterize() output pins byte-for-byte output so the additive cell hook can be
// proven no-op when no transformCells is supplied.
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

function buildScene() {
  // An octahedron-ish set of colored triangles around the origin.
  const polys: Polygon[] = [
    { vertices: [[0, 1, 0], [1, 0, 0], [0, 0, 1]], color: "#c04030" },
    { vertices: [[0, 1, 0], [0, 0, 1], [-1, 0, 0]], color: "#30c040" },
    { vertices: [[0, 1, 0], [-1, 0, 0], [0, 0, -1]], color: "#3040c0" },
    { vertices: [[0, 1, 0], [0, 0, -1], [1, 0, 0]], color: "#c0c030" },
    { vertices: [[0, -1, 0], [0, 0, 1], [1, 0, 0]], color: "#c030c0" },
    { vertices: [[0, -1, 0], [-1, 0, 0], [0, 0, 1]], color: "#30c0c0" },
    { vertices: [[0, -1, 0], [0, 0, -1], [-1, 0, 0]], color: "#a0a0a0" },
    { vertices: [[0, -1, 0], [1, 0, 0], [0, 0, -1]], color: "#804020" },
  ] as unknown as Polygon[];
  const camera = createGlyphPerspectiveCamera({ rotX: 32, rotY: 41, distance: 4, perspective: 800, zoom: 1500 });
  return buildRasterizeContext({
    camera,
    grid: { cols: 70, rows: 40, cellAspect: 2 },
    polygons: polys,
    mode: "solid",
    useColors: true,
    smoothShading: true,
    creaseAngle: 40,
  });
}

function buildUvWinnerScene(supersample = 1) {
  const polygons: Polygon[] = [
    {
      vertices: [[-2, -2, 0], [-2, 2, 0], [2, 0, 0]],
      color: "#ffffff",
      uvs: [[8, 8], [8, 8], [8, 8]],
    },
    {
      vertices: [[-2, -2, 1], [-2, 2, 1], [2, 0, 1]],
      color: "#ffffff",
      uvs: [[0, 0], [1, 0], [0.5, 1]],
    },
  ];
  return buildRasterizeContext({
    camera: createGlyphOrthographicCamera({ rotX: 0, rotY: 0, zoom: 200 }),
    grid: { cols: 40, rows: 40, cellAspect: 2 },
    polygons,
    mode: "solid",
    useColors: false,
    doubleSided: true,
    supersample,
    directionalLight: { direction: [0, 0, 1], intensity: 0 },
    ambientLight: { intensity: 1 },
  });
}

describe("cell-hook regression — solid rasterize is byte-stable", () => {
  it("rejects glyphs that cannot occupy exactly one monospace cell", () => {
    expect(() => encodeGlyphBuffers(["\u0301"], [null], 1, 1, false)).toThrow(/one printable glyph/);
    expect(() => encodeGlyphBuffers(["漢"], [null], 1, 1, false)).toThrow(/one printable glyph/);
    expect(() => encodeGlyphBuffers(["🙂"], [null], 1, 1, false)).toThrow(/one printable glyph/);
    expect(encodeGlyphBuffers(["⣿"], [null], 1, 1, false)).toBe("⣿");
  });

  it("produces the pinned hash (no transformCells)", () => {
    const ctx = buildScene();
    const out = rasterize(ctx);
    const hash = fnv1a(out);
    // eslint-disable-next-line no-console
    console.log(`RASTERIZE_HASH=${hash} LEN=${out.length}`);
    expect(hash).toBe("b4dffcb6");
    expect(out.length).toBe(6269);
  });

  it("an identity transformCells hook reproduces the exact string", () => {
    const ctx = buildScene();
    const baseline = rasterize(ctx);
    let surfaceUv: Float32Array | undefined;
    const withIdentity = rasterize({
      ...ctx,
      transformCells: (g) => {
        surfaceUv = g.surfaceUv;
        return g;
      },
    });
    expect(withIdentity).toBe(baseline);
    expect(surfaceUv).toBeUndefined();
  });

  it("rasterizeToCells returns a grid consistent with the string", () => {
    const ctx = buildScene();
    const grid = rasterizeToCells(ctx);
    expect(grid.cols).toBe(70);
    expect(grid.rows).toBe(40);
    expect(grid.char.length).toBe(70 * 40);
    expect(grid.color.length).toBe(70 * 40);
    expect(grid.depth.length).toBe(70 * 40);
    // Some cells are covered (the octahedron is on-screen).
    const covered = grid.char.filter((c) => c !== " ").length;
    expect(covered).toBeGreaterThan(50);
    // screenX/screenY are the row-major cell coords.
    expect(grid.screenX[71]).toBe(1);
    expect(grid.screenY[71]).toBe(1);
    // Blanking every cell via the hook yields an all-space output.
    const blanked = rasterize({
      ...ctx,
      transformCells: (g: CellGrid) => {
        for (let i = 0; i < g.char.length; i++) { g.char[i] = " "; g.color[i] = null; }
      },
    });
    expect(blanked.replace(/\n/g, "").trim()).toBe("");
  });

  it("exposes finite UVs from the depth-winning authored surface", () => {
    const grid = rasterizeToCells(buildUvWinnerScene());
    expect(grid.surfaceUv).toBeDefined();

    const uv = grid.surfaceUv!;
    const covered = Array.from(grid.depth, (depth, i) => depth > -Infinity ? i : -1)
      .filter((i) => i >= 0);
    expect(covered.length).toBeGreaterThan(100);
    for (const i of covered) {
      expect(Number.isFinite(uv[i * 2])).toBe(true);
      expect(Number.isFinite(uv[i * 2 + 1])).toBe(true);
      expect(uv[i * 2]).toBeGreaterThanOrEqual(0);
      expect(uv[i * 2]).toBeLessThanOrEqual(1);
      expect(uv[i * 2 + 1]).toBeGreaterThanOrEqual(0);
      expect(uv[i * 2 + 1]).toBeLessThanOrEqual(1);
    }

    const center = 20 * grid.cols + 20;
    expect(grid.depth[center]).toBe(1);
    expect(uv[center * 2]).toBeCloseTo(0.5, 5);
    expect(uv[center * 2 + 1]).toBeCloseTo(0.5, 5);
  });

  it("interpolates surface UVs perspective-correctly", () => {
    const camera = createGlyphPerspectiveCamera({
      rotX: 0,
      rotY: 0,
      perspective: 500,
      zoom: 100,
    });
    const vertices: Polygon["vertices"] = [
      [-2, -2, -2],
      [-2, 2, 2],
      [2, 0, 0],
    ];
    const grid = rasterizeToCells(buildRasterizeContext({
      camera,
      grid: { cols: 60, rows: 60, cellAspect: 2 },
      polygons: [{ vertices, color: "#ffffff", uvs: [[0, 0], [1, 0], [0, 1]] }],
      mode: "solid",
      useColors: false,
      doubleSided: true,
      directionalLight: { direction: [0, 0, 1], intensity: 0 },
      ambientLight: { intensity: 1 },
    }));
    const projected = vertices.map((vertex) => camera.project(vertex, 60, 60, 2));
    const [a, b, c] = projected;
    const area = (b![0] - a![0]) * (c![1] - a![1]) - (b![1] - a![1]) * (c![0] - a![0]);
    let checked = false;

    for (let i = 0; i < grid.char.length; i++) {
      const actualU = grid.surfaceUv?.[i * 2];
      if (!Number.isFinite(actualU)) continue;
      const x = i % grid.cols;
      const y = (i / grid.cols) | 0;
      const wA = (b![0] - x) * (c![1] - y) - (b![1] - y) * (c![0] - x);
      const wB = (c![0] - x) * (a![1] - y) - (c![1] - y) * (a![0] - x);
      const wC = area - wA - wB;
      const affineU = wB / area;
      const qDenom = wA * a![3]! + wB * b![3]! + wC * c![3]!;
      const expectedU = wB * b![3]! / qDenom;
      if (Math.abs(expectedU - affineU) < 0.03) continue;
      expect(actualU).toBeCloseTo(expectedU, 5);
      expect(actualU).not.toBeCloseTo(affineU, 2);
      checked = true;
      break;
    }

    expect(checked).toBe(true);
  });

  it("preserves finite authored UVs through solid supersampling", () => {
    const grid = rasterizeToCells(buildUvWinnerScene(2));
    expect(grid.surfaceUv).toBeDefined();

    const uv = grid.surfaceUv!;
    const finitePairs = Array.from({ length: grid.cols * grid.rows }, (_, i) => i)
      .filter((i) => Number.isFinite(uv[i * 2]) && Number.isFinite(uv[i * 2 + 1]));
    expect(finitePairs.length).toBeGreaterThan(100);

    const center = 20 * grid.cols + 20;
    expect(uv[center * 2]).toBeCloseTo(0.5, 5);
    expect(uv[center * 2 + 1]).toBeCloseTo(0.5, 5);
  });
});
