import { describe, it, expect } from "vitest";
import { createGlyphPerspectiveCamera } from "../api/createGlyphCamera";
import { buildRasterizeContext } from "../api/rasterizeContext";
import { rasterize, rasterizeToCells } from "./rasterize";
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

describe("cell-hook regression — solid rasterize is byte-stable", () => {
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
    const withIdentity = rasterize({ ...ctx, transformCells: (g) => g });
    expect(withIdentity).toBe(baseline);
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
});
