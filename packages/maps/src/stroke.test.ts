import { describe, expect, it } from "vitest";
import { stampGlyphMapContour, stampGlyphMapContourLabels, stampGlyphMapPolyline, type GlyphMapStrokeVertex } from "./stroke";
import { glyphMapDeclutterLabels, GLYPH_MAP_LABEL_WRAP_CELLS } from "./layers";
import { GLYPH_MAP_CONTOUR_LABEL_PAD_X, GLYPH_MAP_CONTOUR_LABEL_PAD_Y } from "./widget";
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

/**
 * A draped stroke is compared against the surface RECONSTRUCTED at its own
 * sub-cell position, and only the surface's own CURVATURE is then forgiven.
 * These are the gates that go red without each half.
 *
 * A `line` is draped on the ground field (`widget.ts`, bilinear over a tile's
 * full vertex grid) while the terrain under it is rasterized from a COARSENED
 * quad mesh, whose chord cuts under every rise inside a quad. The two are
 * therefore near-coplanar, not exactly coplanar, and the stroke reads a
 * little BEHIND the surface on a real fraction of its cells — measured on a
 * real relief pyramid at `/maps`' own pitch, 154 of 650 samples
 * (`widget.strokeDrape.test.ts`'s ridge fixture).
 *
 * But most of that gap was never faceting at all: `grid.depth` is sampled at
 * the cell CENTRE and the stroke sits wherever inside the cell its geometry
 * puts it, so on a tilted view a stroke lying FLUSH on the surface reads up
 * to half a cell of depth away from it for that reason alone. Paying for it
 * with a SLOPE-scaled allowance made the allowance a fraction of the depth
 * one cell spans, which on flat ground under a tilt is metres — and so a road
 * drew straight through every building shorter than that
 * (`widget.strokeOcclusion.test.ts`). Reconstructing the surface where the
 * stroke actually is removes that term instead of forgiving it, and what
 * remains is proportional to the surface's roughness, which is its SECOND
 * difference: a plane has none however steeply it is foreshortened.
 */
describe("stampGlyphMapPolyline — the reconstruction, the curvature allowance, and its bound", () => {
  const GRADIENT = 1e-2;
  /** A plane tilting away at `GRADIENT` per column. No curvature anywhere, so it grants no allowance at all. */
  const plane = () => makeGrid(10, 5, (col) => col * GRADIENT);
  /**
   * The same plane with a one-cell zig-zag on it — the shortest wavelength a
   * coarsened quad mesh cannot represent, and the only component that makes a
   * draped stroke read behind the surface once the sampling offset is gone.
   */
  const rough = (amp: number) => makeGrid(10, 5, (col) => col * GRADIENT + (col % 2 ? amp : 0));
  const line = (depthAt: (col: number) => number): GlyphMapStrokeVertex[] => [
    { col: 1, row: 2, depth: depthAt(1) },
    { col: 8, row: 2, depth: depthAt(8) },
  ];

  it("draws a stroke lying exactly ON a steep plane, at a sub-cell position half a cell from where the surface was sampled", () => {
    // `grid.depth[c]` is the plane's depth at cell `c`'s CENTRE, so the same
    // plane at this stroke's own position — the cell's left edge, half a cell
    // back — is `GRADIENT / 2` further away, and that is exactly the stroke's
    // depth here. It is FLUSH on the surface and every cell of it must draw.
    // The plane has no curvature, so no allowance is available to cover the
    // half cell: only reconstructing the surface where the stroke actually is
    // can, and with that reconstruction dropped all eight cells go dark.
    const grid = plane();
    stampGlyphMapPolyline(grid, line((col) => (col - 0.5) * GRADIENT), { color: "#fff" });
    expect(nonEmptyCells(grid)).toBe(8);
  });

  it("draws a stroke behind the RIDGES of a rough surface — the faceting a coarsened relief mesh always has", () => {
    // The stroke follows the smooth trend the coarse mesh would carry while
    // the surface carries the roughness, so it reads behind at every ridge
    // cell, by 0.1x the local gradient against an allowance of 0.2x. That is
    // the whole job of the curvature term: with the scale at 0 the four ridge
    // cells go dark and this drops to 4.
    const grid = rough(0.4 * GRADIENT);
    stampGlyphMapPolyline(grid, line((col) => col * GRADIENT), { color: "#fff" });
    expect(nonEmptyCells(grid)).toBe(8);
  });

  it("still occludes a stroke genuinely behind that same surface — the allowance is bounded, not a licence", () => {
    // Twice the local gradient behind it: past the reconstruction and past
    // the allowance, and the surface is really in front. A margin large
    // enough to swallow this is the defect the flat 0.03 constant was.
    const grid = plane();
    stampGlyphMapPolyline(grid, line((col) => col * GRADIENT - 2 * GRADIENT), { color: "#fff" });
    expect(nonEmptyCells(grid)).toBe(0);
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

describe("stampGlyphMapContour — elevation window (minElevation/maxElevation)", () => {
  /** One row of five cells with an explicit per-cell elevation, all covered. */
  function rowGrid(values: readonly number[]): CellGrid {
    return makeGrid(values.length, 1, () => 0);
  }

  it("does not ink a cell below the floor, even when a level crosses between it and its neighbour", () => {
    // A sea cliff: cell 1 is 4 km under water, cell 2 is 2 km up. The 1,000 m
    // level crosses BETWEEN them, and the crossing scan reads a cell's RIGHT
    // neighbour — so the ink lands on the ocean cell unless the window gates
    // it. Filtering the level list alone cannot catch this: 1,000 is itself
    // legitimately inside the window.
    const values = [-5000, -4000, 2000, 3000, 4000];
    const elevationAt = (col: number) => values[col];

    const unwindowed = rowGrid(values);
    stampGlyphMapContour(unwindowed, elevationAt, { levels: [1000] });
    expect(unwindowed.char[1]).not.toBe(" ");

    const windowed = rowGrid(values);
    stampGlyphMapContour(windowed, elevationAt, { levels: [1000], minElevation: 0 });
    expect(windowed.char.every((c) => c === " ")).toBe(true);
  });

  it("does not ink a cell above the ceiling, and leaves the in-window side of the same crossing alone", () => {
    // Ascending ramp: the 2,500 m level crosses between cells 2 (2,000) and 3
    // (3,000), and the ink lands on cell 2 — inside a 2,600 m ceiling, so it
    // stays. Cell 3's own crossing (3,500, between 3,000 and 4,000) is above
    // the ceiling and goes.
    const values = [0, 1000, 2000, 3000, 4000];
    const grid = rowGrid(values);
    stampGlyphMapContour(grid, (col) => values[col], { levels: [2500, 3500], maxElevation: 2600 });
    expect(grid.char[2]).not.toBe(" ");
    expect(grid.char[3]).toBe(" ");
  });

  it("omitting both bounds is byte-identical to the pre-window stamp", () => {
    const values = [-5000, -4000, 2000, 3000, 4000];
    const a = rowGrid(values);
    const b = rowGrid(values);
    stampGlyphMapContour(a, (col) => values[col], { levels: [1000, 3500], color: "#0af" });
    stampGlyphMapContour(b, (col) => values[col], { levels: [1000, 3500], color: "#0af", minElevation: undefined, maxElevation: undefined });
    expect(b.char).toEqual(a.char);
    expect(b.color).toEqual(a.color);
  });
});

/**
 * Contour labels do NOT wrap, and the wrap never reaches them.
 *
 * The two label paths share one arbiter (`glyphMapDeclutterLabels`), and a
 * contour label is a number stamped INTO A GAP IN ITS OWN LINE with the
 * terrain glyph restored either side — a second row of it would punch a hole
 * in the relief the first row exists to preserve. So the gate is driven with
 * a deliberately absurd `format` (31 characters, longer than
 * `GLYPH_MAP_LABEL_WRAP_CELLS`) through the widget's own
 * plan -> declutter -> stamp sequence: it must still land as ONE contiguous
 * run on ONE row. A wrap moved into the arbiter, or into the stamp, goes red
 * here.
 */
describe("contour labels are inert under symbol-label wrapping", () => {
  const TEXT = "Elevation One Hundred Metres AB"; // 31 characters

  it("stamps a 31-character contour label as one run on one row, with nothing on the rows either side", () => {
    // Elevation ramps with ROW only, so every contour is a horizontal line
    // and is exactly the near-horizontal run a label may lie along.
    const cols = 80;
    const rows = 21;
    const grid = makeGrid(cols, rows, () => 1);
    const elevationAt = (_col: number, row: number) => row * 10;
    const plan = stampGlyphMapContour(grid, elevationAt, {
      levels: [100],
      requireSurface: false,
      labels: { levels: [100], format: () => TEXT },
    });
    expect(plan).not.toBeNull();
    expect(plan!.candidates.length).toBeGreaterThan(0);
    expect(TEXT.length).toBeGreaterThan(GLYPH_MAP_LABEL_WRAP_CELLS);

    const placed = glyphMapDeclutterLabels(
      plan!.candidates.map((candidate, index) => ({ id: String(index), col: candidate.col, row: candidate.row, label: candidate.text, priority: candidate.priority })),
      1,
      1,
      GLYPH_MAP_CONTOUR_LABEL_PAD_X,
      GLYPH_MAP_CONTOUR_LABEL_PAD_Y,
    );
    expect(placed.length).toBeGreaterThan(0);
    stampGlyphMapContourLabels(grid, placed.map((p) => plan!.candidates[Number(p.id)]), plan!, "#ffffff");

    const rowText = (row: number) => Array.from({ length: cols }, (_, c) => grid.char[row * cols + c]).join("");
    const labelRow = placed[0].row;
    // The whole text, unbroken, on the label's own row.
    expect(rowText(labelRow)).toContain(TEXT);
    // And no fragment of it on the neighbouring rows — the only way a
    // second line of a wrapped contour label could ever appear.
    const words = TEXT.split(" ");
    for (const row of [labelRow - 1, labelRow + 1]) {
      if (row < 0 || row >= rows) continue;
      for (const word of words) expect(rowText(row)).not.toContain(word);
    }
  });
});
