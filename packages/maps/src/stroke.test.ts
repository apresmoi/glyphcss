import { describe, expect, it } from "vitest";
import { stampGlyphMapContour, stampGlyphMapPolyline, type GlyphMapStrokeVertex } from "./stroke";
import type { CellGrid } from "glyphcss";

function makeGrid(cols: number, rows: number, depthAt: (col: number, row: number) => number): CellGrid {
  const n = cols * rows;
  const depth = new Float64Array(n);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) depth[row * cols + col] = depthAt(col, row);
  }
  return {
    cols,
    rows,
    char: new Array(n).fill(" "),
    color: new Array(n).fill(null),
    depth,
    screenX: new Int32Array(n),
    screenY: new Int32Array(n),
  };
}

function nonEmptyCells(grid: CellGrid): number {
  return grid.char.filter((c) => c !== " ").length;
}

describe("stampGlyphMapPolyline — gate 1: a border behind terrain is occluded mid-segment, visible on both flanks", () => {
  it("draws through empty (no-surface) cells unconditionally", () => {
    const grid = makeGrid(20, 10, () => -Infinity);
    const points: GlyphMapStrokeVertex[] = [
      { col: 2, row: 5, depth: 0 },
      { col: 17, row: 5, depth: 0 },
    ];
    stampGlyphMapPolyline(grid, points, { color: "#ff0000" });
    expect(nonEmptyCells(grid)).toBeGreaterThan(10);
  });

  it("a straight horizontal line crossing a raised ridge is occluded ONLY under the ridge, and visible again past it", () => {
    // Terrain: flat plain at depth 0, a "ridge" (nearer = larger depth,
    // glyphcss convention) spanning columns 8..11 at depth 5.
    const grid = makeGrid(20, 10, (col) => (col >= 8 && col <= 11 ? 5 : 0));
    const points: GlyphMapStrokeVertex[] = [
      { col: 1, row: 5, depth: 0 }, // the line runs at the PLAIN's own depth
      { col: 18, row: 5, depth: 0 },
    ];
    stampGlyphMapPolyline(grid, points, { color: "#00ff00" });

    const rowChars = (row: number) => Array.from({ length: grid.cols }, (_, c) => grid.char[row * grid.cols + c]);
    const chars = rowChars(5);

    // West flank (before the ridge): line drawn.
    expect(chars.slice(2, 7).some((c) => c !== " ")).toBe(true);
    // Under the ridge: occluded — no stroke glyph written there.
    expect(chars.slice(8, 12).every((c) => c === " ")).toBe(true);
    // East flank (past the ridge): visible again.
    expect(chars.slice(13, 18).some((c) => c !== " ")).toBe(true);
  });

  it("a line ON the surface it's drawn over (same depth) is NOT occluded by that surface (bias tolerates coincident depth)", () => {
    const grid = makeGrid(10, 5, () => 1);
    const points: GlyphMapStrokeVertex[] = [
      { col: 1, row: 2, depth: 1 },
      { col: 8, row: 2, depth: 1 },
    ];
    stampGlyphMapPolyline(grid, points, { color: "#fff" });
    expect(nonEmptyCells(grid)).toBeGreaterThan(4);
  });
});

describe("stampGlyphMapPolyline — no special-casing at a cut endpoint (cross-tile-seam continuity)", () => {
  it("stamping a polyline in two pieces (simulating a tile-clipped cut) produces the SAME glyphs at every shared cell as stamping it whole", () => {
    const whole: GlyphMapStrokeVertex[] = [
      { col: 2, row: 3, depth: 0 },
      { col: 6, row: 3, depth: 0 },
      { col: 10, row: 7, depth: 0 },
      { col: 14, row: 7, depth: 0 },
    ];
    const gridWhole = makeGrid(20, 12, () => -Infinity);
    stampGlyphMapPolyline(gridWhole, whole, { color: "#abc" });

    // Cut exactly at the middle vertex (col:10,row:7) — as a tile boundary
    // clip would: two independent stamp calls, each retaining the REAL
    // neighboring geometry on its own side (never a synthetic single-point
    // fragment), which is what `clip.ts`'s design guarantees in practice.
    const gridCut = makeGrid(20, 12, () => -Infinity);
    stampGlyphMapPolyline(gridCut, whole.slice(0, 3), { color: "#abc" });
    stampGlyphMapPolyline(gridCut, whole.slice(2), { color: "#abc" });

    expect(gridCut.char).toEqual(gridWhole.char);
  });
});

describe("stampGlyphMapPolyline — tangent orientation", () => {
  it("a horizontal line stamps a horizontal-family glyph, a vertical line a vertical-family glyph", () => {
    const gridH = makeGrid(10, 5, () => -Infinity);
    stampGlyphMapPolyline(gridH, [{ col: 1, row: 2, depth: 0 }, { col: 8, row: 2, depth: 0 }]);
    const hChar = gridH.char.find((c) => c !== " ")!;
    expect(["‾", "▔", "-", "_"]).toContain(hChar);

    const gridV = makeGrid(10, 10, () => -Infinity);
    stampGlyphMapPolyline(gridV, [{ col: 4, row: 1, depth: 0 }, { col: 4, row: 8, depth: 0 }]);
    const vChar = gridV.char.find((c) => c !== " ")!;
    expect(["▏", "|", "▕"]).toContain(vChar);
  });
});

describe("stampGlyphMapContour — gate 3: contour lines close and do not scatter", () => {
  it("inked cells trace a level's circle on a radial (Gaussian-bump) field, within a tight radius band — no scattered outliers", () => {
    const cols = 60;
    const rows = 60;
    const cx = cols / 2;
    const cy = rows / 2;
    const peak = 1000;
    const sigma = 15;
    const elevationAt = (col: number, row: number): number => {
      const dx = col - cx;
      const dy = row - cy;
      return peak * Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma));
    };
    const grid: CellGrid = {
      cols,
      rows,
      char: new Array(cols * rows).fill(" "),
      color: new Array(cols * rows).fill(null),
      depth: new Float64Array(cols * rows).fill(0), // fully covered surface everywhere
      screenX: new Int32Array(cols * rows),
      screenY: new Int32Array(cols * rows),
    };
    const level = peak * Math.exp(-1 / 2); // the level at radius = sigma
    stampGlyphMapContour(grid, elevationAt, { levels: [level], color: "#0af" });

    const inkedRadii: number[] = [];
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        if (grid.char[row * cols + col] !== " ") inkedRadii.push(Math.hypot(col - cx, row - cy));
      }
    }
    expect(inkedRadii.length).toBeGreaterThan(20); // a real ring, not a handful of stray marks
    // Every inked cell sits within one cell of the analytic level radius (sigma) —
    // "does not scatter" means no ink far from the true level set.
    for (const r of inkedRadii) expect(Math.abs(r - sigma)).toBeLessThan(2);
  });

  it("closes: the ring of inked cells has no large angular gaps", () => {
    const cols = 50;
    const rows = 50;
    const cx = 25;
    const cy = 25;
    const sigma = 12;
    const elevationAt = (col: number, row: number): number => {
      const dx = col - cx;
      const dy = row - cy;
      return 1000 * Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma));
    };
    const grid: CellGrid = {
      cols,
      rows,
      char: new Array(cols * rows).fill(" "),
      color: new Array(cols * rows).fill(null),
      depth: new Float64Array(cols * rows).fill(0),
      screenX: new Int32Array(cols * rows),
      screenY: new Int32Array(cols * rows),
    };
    const level = 1000 * Math.exp(-1 / 2);
    stampGlyphMapContour(grid, elevationAt, { levels: [level] });

    const angleBuckets = new Array(36).fill(false); // 10-degree buckets
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        if (grid.char[row * cols + col] === " ") continue;
        const angle = Math.atan2(row - cy, col - cx);
        const bucket = Math.floor(((angle + Math.PI) / (2 * Math.PI)) * 36) % 36;
        angleBuckets[bucket] = true;
      }
    }
    const coveredBuckets = angleBuckets.filter(Boolean).length;
    // A closed ring hits nearly every angular bucket (36 total, 1-cell
    // resolution per ~10deg at this radius); a scattered/broken result
    // would leave large gaps.
    expect(coveredBuckets).toBeGreaterThan(30);
  });

  it("a flat field (no crossing anywhere) inks nothing", () => {
    const grid: CellGrid = {
      cols: 10,
      rows: 10,
      char: new Array(100).fill(" "),
      color: new Array(100).fill(null),
      depth: new Float64Array(100).fill(0),
      screenX: new Int32Array(100),
      screenY: new Int32Array(100),
    };
    stampGlyphMapContour(grid, () => 500, { levels: [100, 200, 300] });
    expect(grid.char.every((c) => c === " ")).toBe(true);
  });

  it("skips cells with no rendered surface (depth -Infinity) even if the field value crosses a level there", () => {
    const grid: CellGrid = {
      cols: 5,
      rows: 1,
      char: new Array(5).fill(" "),
      color: new Array(5).fill(null),
      depth: Float64Array.from([-Infinity, -Infinity, -Infinity, -Infinity, -Infinity]),
      screenX: new Int32Array(5),
      screenY: new Int32Array(5),
    };
    stampGlyphMapContour(grid, (col) => col, { levels: [2] });
    expect(grid.char.every((c) => c === " ")).toBe(true);
  });
});

describe("stampGlyphMapContour — requireSurface (hidden-terrain degrade)", () => {
  function radialField(cols: number, rows: number) {
    const cx = cols / 2, cy = rows / 2, sigma = 6;
    return (col: number, row: number) => {
      const dx = col - cx, dy = row - cy;
      return 1000 * Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma));
    };
  }

  it("requireSurface: true (default) inks nothing when every cell has non-finite depth (no base surface)", () => {
    const cols = 20, rows = 20;
    const grid: CellGrid = {
      cols, rows,
      char: new Array(cols * rows).fill(" "),
      color: new Array(cols * rows).fill(null),
      depth: new Float64Array(cols * rows).fill(-Infinity),
      screenX: new Int32Array(cols * rows),
      screenY: new Int32Array(cols * rows),
    };
    stampGlyphMapContour(grid, radialField(cols, rows), { levels: [500] });
    expect(grid.char.every((c) => c === " ")).toBe(true);
  });

  it("requireSurface: false draws the contour even with no base surface — the hidden-terrain gate", () => {
    const cols = 20, rows = 20;
    const grid: CellGrid = {
      cols, rows,
      char: new Array(cols * rows).fill(" "),
      color: new Array(cols * rows).fill(null),
      depth: new Float64Array(cols * rows).fill(-Infinity),
      screenX: new Int32Array(cols * rows),
      screenY: new Int32Array(cols * rows),
    };
    stampGlyphMapContour(grid, radialField(cols, rows), { levels: [500], requireSurface: false });
    expect(grid.char.some((c) => c !== " ")).toBe(true);
  });

  it("requireSurface: true still respects a PARTIAL surface (some finite, some not) — only draws where covered", () => {
    const cols = 20, rows = 20;
    const depth = new Float64Array(cols * rows).fill(-Infinity);
    for (let row = 0; row < rows; row++) for (let col = 0; col < 10; col++) depth[row * cols + col] = 0; // left half covered
    const grid: CellGrid = {
      cols, rows,
      char: new Array(cols * rows).fill(" "),
      color: new Array(cols * rows).fill(null),
      depth,
      screenX: new Int32Array(cols * rows),
      screenY: new Int32Array(cols * rows),
    };
    stampGlyphMapContour(grid, radialField(cols, rows), { levels: [500] });
    for (let row = 0; row < rows; row++) {
      for (let col = 10; col < cols; col++) expect(grid.char[row * cols + col]).toBe(" ");
    }
  });
});
