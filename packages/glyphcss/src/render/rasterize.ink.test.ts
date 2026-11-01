import { describe, it, expect } from "vitest";
import { rasterize, inkGlyphForTangent, inkLineCell } from "./rasterize";
import { LINE_GLYPH_TABLES } from "./lineTables";
import { buildRasterizeContext } from "../api/rasterizeContext";
import type { InkLineMemory } from "../api/rasterizeContext";
import { createGlyphOrthographicCamera } from "../api/createGlyphCamera";
import type { GlyphCamera } from "../api/createGlyphCamera";
import { cubePolygons } from "@glyphcss/core";
import type { Polygon, Vec3 } from "@glyphcss/core";

/**
 * `mode: "ink"` — oriented silhouette/crease outline rasterizer.
 *
 * A fake identity camera (`project(v) => [v[0], v[1], 0, 1]`) is used instead
 * of a real perspective/orthographic camera so every edge lands on an EXACT
 * integer cell coordinate, matching the pattern `rasterize.junctions.test.ts`
 * already uses for the same reason: these tests are about the silhouette →
 * chain → tangent → glyph pipeline, not camera projection.
 */
function identityCamera(): GlyphCamera {
  return {
    project: (v: readonly [number, number, number]) => [v[0], v[1], 0, 1],
  } as unknown as GlyphCamera;
}

const COLS = 11;
const ROWS = 11;

function cellAt(output: string, col: number, row: number): string {
  const lines = output.split("\n");
  return lines[row]![col]!;
}

function inkRasterize(polygons: Polygon[]): string {
  const ctx = buildRasterizeContext({
    camera: identityCamera(),
    grid: { cols: COLS, rows: ROWS, cellAspect: 2.0 },
    polygons,
    mode: "ink",
    useColors: false,
  });
  return rasterize(ctx);
}

/** Same as `inkRasterize` but on a larger square grid, for tests that need
 * room for a junction's contaminating branches or a many-segment curved
 * chain without them running off the edge of `inkRasterize`'s 11x11. */
function inkRasterizeWide(polygons: Polygon[], size: number): string {
  const ctx = buildRasterizeContext({
    camera: identityCamera(),
    grid: { cols: size, rows: size, cellAspect: 1.0 },
    polygons,
    mode: "ink",
    useColors: false,
  });
  return rasterize(ctx);
}

/** A single kept silhouette edge from `a` to `b`: a front-facing triangle
 * (apex offset `+perp`, forward in Z) and a back-facing triangle (apex
 * offset `-perp`, backward in Z) — the same construction `chainSilhouettePolygons`
 * uses per-segment, factored out so junction-contamination tests can attach
 * extra branches at a shared vertex. */
function silhouetteEdge(a: Vec3, b: Vec3, perp: [number, number, number]): Polygon[] {
  const apexFront: Vec3 = [a[0] + perp[0], a[1] + perp[1], a[2] + perp[2] + 1];
  const apexBack: Vec3 = [a[0] - perp[0], a[1] - perp[1], a[2] - perp[2] - 1];
  return [
    { vertices: [a, b, apexFront], color: "#ff0000" },
    { vertices: [a, b, apexBack], color: "#00ff00" },
  ];
}

/**
 * A straight 3-segment silhouette chain through `points` (4 collinear points,
 * so 3 edges): each edge gets a front-facing triangle (apex offset toward
 * `apexSign * PERP`, screen-space winding chosen so it's front-facing) and a
 * back-facing triangle (apex offset the other way) — a silhouette edge at
 * every segment, exactly like consecutive facets along a sphere/torus
 * silhouette.
 *
 * A single isolated 2-triangle silhouette edge ALSO keeps its lone
 * front-facing triangle's other two (boundary) edges — a real, correct part
 * of the algorithm (a lone front-facing triangle shows its own outline) —
 * which would contaminate a hand-derived tangent prediction at that edge's
 * own two endpoints. Chaining three collinear segments gives each of the
 * middle edge's two endpoints a second, exactly-opposite ridge neighbor;
 * `rasterizeInk`'s "most anti-parallel neighbor pair" junction rule then
 * picks that clean opposite pair (dot product exactly −1) over any
 * contaminating boundary neighbor (dot product > −1) — isolating the
 * MIDDLE segment's tangent to the pure chain direction, which is what these
 * tests assert against.
 */
function chainSilhouettePolygons(points: [Vec3, Vec3, Vec3, Vec3], perp: [number, number, number]): Polygon[] {
  const polys: Polygon[] = [];
  for (let i = 0; i < 3; i++) {
    const start = points[i]!, end = points[i + 1]!;
    const apexFront: Vec3 = [start[0] + perp[0], start[1] + perp[1], start[2] + perp[2] + 1];
    const apexBack: Vec3 = [start[0] - perp[0], start[1] - perp[1], start[2] - perp[2] - 1];
    polys.push({ vertices: [start, end, apexFront], color: "#ff0000" });
    polys.push({ vertices: [start, end, apexBack], color: "#00ff00" });
  }
  return polys;
}

/** Typical terminal cell: twice as tall as wide. */
const ASPECT = 2;
/** Binary-exact fractions, so an offset lands on a bin centre rather than a float knife-edge. */
const sweep = (n: number, f: (t: number) => string): string[] => Array.from({ length: n }, (_, i) => f(i / n));
/** Distinct glyphs of a sweep in order of first appearance. */
const runs = (glyphs: string[]): string[] => glyphs.filter((g, i) => g !== glyphs[i - 1]);

describe("inkGlyphForTangent — fitted line table", () => {
  it("a horizontal stroke's glyph is monotonic as it sweeps top to bottom across a cell: overline, then middle, then underscore", () => {
    for (const dx of [1, -1]) {
      const seq = sweep(20, (subRow) => inkGlyphForTangent(dx, 0, subRow, 0.5, ASPECT));
      expect(runs(seq)).toEqual(["‾", "-", "_"]);
    }
    expect(inkGlyphForTangent(1, 0, 0.1, 0.5, ASPECT)).toBe("‾");
    expect(inkGlyphForTangent(1, 0, 0.625, 0.5, ASPECT)).toBe("-");
    expect(inkGlyphForTangent(1, 0, 0.9, 0.5, ASPECT)).toBe("_");
  });

  it("a vertical stroke's glyph is monotonic as it sweeps left to right, independent of the row it samples", () => {
    for (const dy of [1, -1]) {
      for (const subRow of [0.1, 0.5, 0.9]) {
        const seq = sweep(20, (subCol) => inkGlyphForTangent(0, dy, subRow, subCol, ASPECT));
        expect(runs(seq)).toEqual(["▏", "|", "▕"]);
      }
    }
  });

  it("returns '' when the line only clips the cell's corner, and '·' for a zero tangent", () => {
    // 27 degrees through the cell's bottom-left corner: the extrapolated
    // offset from the centre is past the table's last inked bin.
    expect(inkGlyphForTangent(1, 0.5, 1, 0, 1)).toBe("");
    expect(inkGlyphForTangent(0, 1, 0.5, 1, ASPECT)).toBe("");
    expect(inkGlyphForTangent(0, 0, 0.5, 0.5, ASPECT)).toBe("·");
  });

  it("keys on the line's offset from the cell centre, not on the sample point: every point of one straight run inside a cell gets one glyph", () => {
    // A shallow line y = 0.45 + 0.2 (x - 0.5) sampled at ten points across the
    // cell. A sample-keyed rule would step through glyphs as the point moves.
    const glyphs = sweep(10, (t) => {
      const subCol = 0.05 + t * 0.9;
      return inkGlyphForTangent(1, 0.2, 0.45 + 0.2 * (subCol - 0.5), subCol, 1);
    });
    expect(new Set(glyphs).size).toBe(1);
    expect(glyphs[0]).not.toBe("");
    // The same holds for a steep, column-major run.
    const steep = sweep(10, (t) => {
      const subRow = 0.05 + t * 0.9;
      return inkGlyphForTangent(0.2, 1, subRow, 0.45 + 0.2 * (subRow - 0.5), 1);
    });
    expect(new Set(steep).size).toBe(1);
    expect(steep[0]).not.toBe("");
  });

  it("draws a diagonal along the cell's own diagonal with the diagonal glyph wherever on it the sample sits, and tangents are sign-blind", () => {
    for (const s of [0.25, 0.5, 0.75]) {
      expect(inkGlyphForTangent(1, 1, s, s, ASPECT)).toBe("\\");
      expect(inkGlyphForTangent(-1, -1, s, s, ASPECT)).toBe("\\");
      // The anti-diagonal runs from (subCol 0, subRow 1) to (1, 0).
      expect(inkGlyphForTangent(1, -1, 1 - s, s, ASPECT)).toBe("/");
      expect(inkGlyphForTangent(-1, 1, 1 - s, s, ASPECT)).toBe("/");
    }
  });

  it("emits only characters of the 'ink' vocabulary across the whole tangent/position space", () => {
    const allowed = new Set([...LINE_GLYPH_TABLES.ink, "·", ""]);
    for (let a = 0; a < 360; a += 7) {
      const dx = Math.cos((a * Math.PI) / 180), dy = Math.sin((a * Math.PI) / 180);
      for (const subRow of [0, 0.3, 0.7, 1]) {
        for (const subCol of [0, 0.3, 0.7, 1]) {
          expect(allowed.has(inkGlyphForTangent(dx, dy, subRow, subCol, ASPECT))).toBe(true);
        }
      }
    }
  });

  it("the 'ascii' vocabulary never leaves printable ASCII", () => {
    for (let a = 0; a < 360; a += 5) {
      const dx = Math.cos((a * Math.PI) / 180), dy = Math.sin((a * Math.PI) / 180);
      for (const sub of [0.1, 0.4, 0.6, 0.9]) {
        const g = inkGlyphForTangent(dx, dy, sub, 1 - sub, ASPECT, "ascii");
        for (const ch of g) expect(ch.charCodeAt(0)).toBeGreaterThanOrEqual(0x20);
        for (const ch of g) expect(ch.charCodeAt(0)).toBeLessThanOrEqual(0x7e);
      }
    }
  });

  describe("hysteresis (`held`)", () => {
    // A horizontal line 0.26 above the centre: the table answers '‾' there,
    // but '-' is one INK_HOLD_OFFSET (0.08) away, so a cell that drew '-'
    // last frame keeps it.
    const near = 0.24, far = 0.1;

    it("keeps a held glyph while it is still the answer for the line nudged inside the margin", () => {
      expect(inkGlyphForTangent(1, 0, near, 0.5, ASPECT)).toBe("‾");
      expect(inkGlyphForTangent(1, 0, near, 0.5, ASPECT, "ink", "-")).toBe("-");
    });

    it("drops the held glyph once the line is beyond the margin", () => {
      expect(inkGlyphForTangent(1, 0, far, 0.5, ASPECT, "ink", "-")).toBe("‾");
    });

    it("keeps a held glyph through a sub-bucket angle change, and drops it past the margin", () => {
      // Visual angles around the 39.375 degree edge between the 33.75 and
      // 45 degree buckets, on the line through the cell centre minus 0.1.
      const at = (deg: number, held: string) =>
        inkGlyphForTangent(1, -Math.tan((deg * Math.PI) / 180), 0.4, 0.5, 1, "ink", held);
      const fresh = at(40.5, "");
      expect(fresh).toBe("/");
      expect(at(40.5, "-")).toBe("-");
      expect(at(44, "-")).toBe("/");
    });

    it("a held glyph that is already the answer, or a blank hold, changes nothing", () => {
      expect(inkGlyphForTangent(1, 0, 0.1, 0.5, ASPECT, "ink", "‾")).toBe("‾");
      expect(inkGlyphForTangent(1, 0, near, 0.5, ASPECT, "ink", "")).toBe("‾");
    });
  });
});

describe("inkLineCell — one cell per major column", () => {
  const cell: [number, number, number, number] = [0, 0, 0, 0];
  /** Walks a segment the way `rasterizeInk` does and returns the cells it hits. */
  function walk(x0: number, y0: number, x1: number, y1: number, oversample = 1): [number, number, number, number][] {
    const dx = x1 - x0, dy = y1 - y0;
    const steps = oversample * Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy))));
    const out: [number, number, number, number][] = [];
    for (let i = 0; i <= steps; i++) {
      inkLineCell(x0 + (dx * i) / steps, y0 + (dy * i) / steps, dx, dy, cell);
      out.push([...cell]);
    }
    return out;
  }

  const slopes: [number, number][] = [
    [12, 0], [12, 1.3], [12, 3.7], [12, 6], [12, 11.9], [12, -2.2], [12, -7.4],
    [0, 12], [1.3, 12], [3.7, 12], [-2.2, 12], [-7.4, 12], [5, 5], [-5, 5], [-12, -4.1],
  ];

  it("visits every major-axis column exactly once with no gaps, whatever the slope", () => {
    for (const [dx, dy] of slopes) {
      for (const [ox, oy] of [[3.07, 4.93], [3.5, 4.5], [3.99, 4.01]] as const) {
        const rowMajor = Math.abs(dx) >= Math.abs(dy);
        // Three samples per major step, so a column is hit several times: one
        // cell per column must hold however the samples fall.
        const cells = walk(ox, oy, ox + dx, oy + dy, 3);
        const major = (c: number[]) => (rowMajor ? c[0]! : c[1]!);
        const minor = (c: number[]) => (rowMajor ? c[1]! : c[0]!);
        const perMajor = new Map<number, Set<number>>();
        for (const c of cells) {
          if (!perMajor.has(major(c))) perMajor.set(major(c), new Set());
          perMajor.get(major(c))!.add(minor(c));
        }
        const keys = [...perMajor.keys()].sort((a, b) => a - b);
        for (let i = 1; i < keys.length; i++) expect(keys[i]! - keys[i - 1]!).toBe(1);
        for (const set of perMajor.values()) expect(set.size).toBe(1);
        // ...and it is the cell the line truly crosses at that column's centre.
        for (const c of cells) {
          const m = major(c);
          const lineAtCentre = rowMajor ? oy + ((m + 0.5 - ox) * dy) / dx : ox + ((m + 0.5 - oy) * dx) / dy;
          expect(minor(c)).toBe(Math.floor(lineAtCentre));
        }
        // Adjacent columns' cells touch: the stroke has no hole to look through.
        const minors = keys.map((k) => [...perMajor.get(k)!][0]!);
        for (let i = 1; i < minors.length; i++) expect(Math.abs(minors[i]! - minors[i - 1]!)).toBeLessThanOrEqual(1);
      }
    }
  });

  it("places each sample in the cell the line crosses at its column centre, reporting the crossing as a fraction of that cell", () => {
    inkLineCell(4.1, 2.05, 4, 1, cell);
    // At x = 4.5 the line is at y = 2.05 + 0.4 * 0.25 = 2.15.
    expect(cell[0]).toBe(4);
    expect(cell[1]).toBe(2);
    expect(cell[2]).toBe(0.5);
    expect(cell[3]).toBeCloseTo(0.15, 10);
    // A sample whose own cell is row 1 but whose line crosses its column centre in row 2.
    inkLineCell(4.1, 1.95, 4, 2, cell);
    expect([cell[0], cell[1]]).toEqual([4, 2]);
    // Column-major mirror.
    inkLineCell(2.05, 4.1, 1, 4, cell);
    expect([cell[0], cell[1], cell[3]]).toEqual([2, 4, 0.5]);
    expect(cell[2]).toBeCloseTo(0.15, 10);
  });

  it("falls back to the sample's own cell for a zero tangent", () => {
    inkLineCell(3.25, 7.75, 0, 0, cell);
    expect(cell).toEqual([3, 7, 0.25, 0.75]);
  });
});

describe("rasterize — ink mode oriented silhouette outline", () => {
  it("scene memory holds a boundary cell's glyph through a sub-pixel move, and releases it on a real one", () => {
    const frame = (y: number, memory: InkLineMemory | null): string => {
      const ctx = buildRasterizeContext({
        camera: identityCamera(),
        grid: { cols: COLS, rows: ROWS, cellAspect: 2.0 },
        polygons: chainSilhouettePolygons([[-1, y, 0], [2, y, 0], [8, y, 0], [11, y, 0]], [0, -3, 0]),
        mode: "ink",
        useColors: false,
      });
      ctx.inkLineMemory = memory;
      return rasterize(ctx);
    };
    // 0.2 above the cell centre reads '-'; 0.01 further up crosses into the
    // overline bin by itself.
    const memory: InkLineMemory = { cols: 0, rows: 0, char: [] };
    expect(cellAt(frame(5.3, memory), 5, 5)).toBe("-");
    expect(cellAt(frame(5.24, memory), 5, 5)).toBe("-");
    // Without memory the same frame flips.
    expect(cellAt(frame(5.24, null), 5, 5)).toBe("‾");
    expect(cellAt(frame(5.24, { cols: 0, rows: 0, char: [] }), 5, 5)).toBe("‾");
    // A real move releases the hold.
    expect(cellAt(frame(5.1, memory), 5, 5)).toBe("‾");
  });

  it("renders a horizontal silhouette chain as horizontal glyphs", () => {
    // The whole chain is exactly horizontal. 0.1 below a row's top edge, the
    // line sits well inside the overline bin on every column (an integer y
    // would sit on a bin edge and flip with float noise).
    const out = inkRasterize(chainSilhouettePolygons([[-1, 5.1, 0], [2, 5.1, 0], [8, 5.1, 0], [11, 5.1, 0]], [0, -3, 0]));
    for (let col = 2; col <= 8; col++) expect(cellAt(out, col, 5)).toBe("‾");
    const low = inkRasterize(chainSilhouettePolygons([[-1, 5.9, 0], [2, 5.9, 0], [8, 5.9, 0], [11, 5.9, 0]], [0, -3, 0]));
    for (let col = 2; col <= 8; col++) expect(cellAt(low, col, 5)).toBe("_");
  });

  it("renders a vertical silhouette chain keyed by sub-column position, mirroring the horizontal case", () => {
    // The whole chain sits 0.1 into cell 5: the left-edge glyph on every row,
    // mirroring the horizontal chain landing on the overline.
    const polygons = chainSilhouettePolygons([[5.1, -1, 0], [5.1, 2, 0], [5.1, 8, 0], [5.1, 11, 0]], [3, 0, 0]);
    const out = inkRasterize(polygons);
    for (let row = 2; row <= 8; row++) {
      expect(cellAt(out, 5, row)).toBe("▏");
    }
  });

  it("a vertical stroke's glyph tracks its sub-cell position as the stroke translates within the same cell — this is the fix for reported head-on wobble", () => {
    // Same vertical chain shape, shifted by a fraction of a cell in x: this
    // is the direct regression test for the reported defect (a vertical
    // stroke wandering within a cell as geometry moves previously always
    // rendered "|" no matter where in the cell it sat; now the glyph itself
    // shifts to track it).
    const leftOut = inkRasterize(chainSilhouettePolygons([[5.05, -1, 0], [5.05, 2, 0], [5.05, 8, 0], [5.05, 11, 0]], [3, 0, 0]));
    const centreOut = inkRasterize(chainSilhouettePolygons([[5.5, -1, 0], [5.5, 2, 0], [5.5, 8, 0], [5.5, 11, 0]], [3, 0, 0]));
    const rightOut = inkRasterize(chainSilhouettePolygons([[5.95, -1, 0], [5.95, 2, 0], [5.95, 8, 0], [5.95, 11, 0]], [3, 0, 0]));
    expect(cellAt(leftOut, 5, 5)).toBe("▏");
    expect(cellAt(centreOut, 5, 5)).toBe("|");
    expect(cellAt(rightOut, 5, 5)).toBe("▕");
  });

  it("renders a down-right (positive-slope) diagonal silhouette chain as '\\\\'", () => {
    const polygons = chainSilhouettePolygons([[-1, -1, 0], [2, 2, 0], [8, 8, 0], [11, 11, 0]], [3, -3, 0]);
    const out = inkRasterize(polygons);
    for (let i = 2; i <= 8; i++) {
      expect(cellAt(out, i, i)).toBe("\\");
    }
  });

  it("renders an up-right (negative-slope) diagonal silhouette chain as '/'", () => {
    const polygons = chainSilhouettePolygons([[-1, 11, 0], [2, 8, 0], [8, 2, 0], [11, -1, 0]], [3, 3, 0]);
    const out = inkRasterize(polygons);
    // The line x + y = 10 crosses column c at its centre in row 9 - c (row
    // 10 - c would be the cell the sample's corner floors to).
    for (let i = 2; i <= 6; i++) {
      expect(cellAt(out, i, 9 - i)).toBe("/");
    }
  });

  it("interior cells away from the chain stay empty", () => {
    const polygons = chainSilhouettePolygons([[-1, 5, 0], [2, 5, 0], [8, 5, 0], [11, 5, 0]], [0, -3, 0]);
    const out = inkRasterize(polygons);
    expect(cellAt(out, 5, 0)).toBe(" ");
    expect(cellAt(out, 5, 10)).toBe(" ");
  });

  it("draws nothing when both adjacent faces face the same way (no silhouette, no crease)", () => {
    // Two coplanar triangles forming a flat quad: same normal, same facing —
    // the shared edge is neither a silhouette nor a crease, so it's dropped
    // (it's an interior edge of a single flat surface, not a contour).
    //
    // Vertex order matters here: under the identity camera's convention
    // (`area2 <= 0` = front-facing, same as `scanFillTriangle`'s backface
    // cull), [[2,2],[8,2],[8,8]] / [[8,8],[2,8],[2,2]] both compute
    // area2 = +36 — i.e. both triangles are BACK-facing, so the shared edge
    // is dropped by the `!anyFront` guard alone and the "both front-facing,
    // same normal, still dropped" comparison this test is named for is never
    // exercised. Reversing each triangle's winding flips both to
    // area2 = -36 (front-facing) while keeping the same flat quad and the
    // same shared edge (8,8)-(2,2), with parallel normals (dot = 1, no
    // crease) — so this now actually exercises "both front-facing edges of
    // one flat surface get dropped", not just "both back-facing edges get
    // dropped".
    const polygons: Polygon[] = [
      { vertices: [[2, 2, 0], [8, 8, 0], [8, 2, 0]], color: "#ff0000" },
      { vertices: [[8, 8, 0], [2, 2, 0], [2, 8, 0]], color: "#ff0000" },
    ];
    const out = inkRasterize(polygons);
    // Only the SHARED edge is dropped. Each triangle is still a front-facing
    // face whose own two boundary edges are a real outline and do draw, so
    // asserting the whole grid is blank would assert the wrong contract.
    // The shared diagonal runs (2,2)-(8,8); sample its interior, away from
    // the perimeter boundary edges.
    for (const i of [4, 5, 6]) expect(cellAt(out, i, i)).toBe(" ");
  });

  it("still drops the shared edge when its endpoints differ only by float rounding noise (~1e-12)", () => {
    // Same flat-quad setup as the test above, but the second triangle's
    // copies of the two shared-edge endpoints are perturbed by ~1e-12 — the
    // magnitude of noise a chain of transforms can leave behind on what
    // should be the same solid corner. Without a tolerant vertex key, these
    // two triangles' shared edge would key to two DIFFERENT strings and the
    // adjacency map would see two degree-1 (lone-triangle) edges instead of
    // one degree-2 (shared) edge — each front-facing lone edge is then kept
    // and drawn, so the diagonal would incorrectly appear.
    const NOISE = 1e-12;
    const polygons: Polygon[] = [
      { vertices: [[2, 2, 0], [8, 8, 0], [8, 2, 0]], color: "#ff0000" },
      { vertices: [[8 + NOISE, 8 - NOISE, 0], [2 + NOISE, 2, 0], [2, 8, 0]], color: "#ff0000" },
    ];
    const out = inkRasterize(polygons);
    for (const i of [4, 5, 6]) expect(cellAt(out, i, i)).toBe(" ");
  });
});

describe("rasterize — ink mode junction tangent (>=3-neighbor vertex)", () => {
  it("renders a cube's vertical silhouette edges as '|', not horizontal glyphs", () => {
    // The reviewer's exact repro: a plain cube's front-most vertical edge
    // meets a >=3-edge junction at each end (the vertical edge itself plus
    // two roughly-horizontal top/bottom-face edges). Real cube geometry,
    // real isometric-ish camera (rotX=65, rotY=45, the default from
    // `createGlyphOrthographicCamera` — see AGENTS.md's "classic
    // isometric-ish viewpoint").
    const camera = createGlyphOrthographicCamera({ zoom: 100 });
    const ctx = buildRasterizeContext({
      camera,
      grid: { cols: 61, rows: 61, cellAspect: 2.0 },
      polygons: cubePolygons({ center: [0, 0, 0], size: 4 }),
      mode: "ink",
      useColors: false,
    });
    const out = rasterize(ctx);
    for (let row = 30; row <= 34; row++) {
      expect(cellAt(out, 30, row)).toBe("|");
    }
  });

  it("renders a straight segment along its own slope at 0/45/90/135 degrees", () => {
    // The cube test above is the real-geometry proof that a >=3-edge junction
    // no longer hijacks an edge's orientation. This one pins the simpler
    // invariant underneath it: a straight segment draws its own slope. It is
    // the middle third of a collinear 3-segment chain, whose two clean
    // opposite neighbours at each end keep the lone triangle's boundary edges
    // out of its tangent (see `chainSilhouettePolygons`); a bare 2-triangle
    // edge is tilted by those boundary edges, which the fitted table's 11.25
    // degree buckets can see.
    const cases: { a: Vec3; b: Vec3; expected: string[] }[] = [
      { a: [4, 10.1, 0], b: [16, 10.1, 0], expected: ["\u203e"] },
      // 0.9 into the cell is the right-edge vertical glyph.
      { a: [10.9, 4, 0], b: [10.9, 16, 0], expected: ["\u2595"] },
      { a: [4, 4, 0], b: [16, 16, 0], expected: ["\\"] },
      { a: [4, 16, 0], b: [16, 4, 0], expected: ["/"] },
    ];
    for (const { a, b, expected } of cases) {
      // Perpendicular to THIS segment, or the apex is collinear with the edge
      // and both triangles are culled as zero-area.
      const perp: [number, number, number] = [-(b[1] - a[1]) / 4, (b[0] - a[0]) / 4, 1];
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const at = (k: number): Vec3 => [a[0] + (dx * k) / 3, a[1] + (dy * k) / 3, 0];
      const out = inkRasterizeWide(chainSilhouettePolygons([at(0), at(1), at(2), at(3)], perp), 21);
      for (const t of [0.4, 0.5, 0.6]) {
        // The cell the line crosses at its major-axis cell centre.
        const px = a[0] + dx * t, py = a[1] + dy * t;
        const [col, row] = Math.abs(dx) >= Math.abs(dy)
          ? [Math.floor(px), Math.floor(py + (Math.floor(px) + 0.5 - px) * (dy / dx))]
          : [Math.floor(px + (Math.floor(py) + 0.5 - py) * (dx / dy)), Math.floor(py)];
        const glyph = cellAt(out, col, row);
        expect(expected).toContain(glyph);
      }
    }
  });

  it("a genuinely curved (non-collinear) contour chain relies on tangent smoothing: this exact cell flips from '|' to '/' when both smoothing passes are removed", () => {
    // 5 points sampled every 25 degrees along a radius-15 arc (NOT
    // collinear — unlike every other chain fixture in this file, which is a
    // fixed point of sign-aligned averaging and stays green with smoothing
    // deleted). Verified directly against the implementation: with the two
    // sign-aligned neighbor-averaging passes (`rasterize.ts`, the `for (let
    // pass = 0; pass < 2; pass++)` loop) removed, the middle segment's
    // midpoint cell renders '|' instead of '/' — a real, provable
    // dependency on smoothing, not a vacuous one.
    const raw: [number, number][] = [
      [1.5679269490148018, 14.9178284305241],
      [7.725571123650815, 12.857509510531683],
      [12.435563588325625, 8.387893552061204],
      [14.815325108927066, 2.346516975603463],
      [14.418925439074783, -4.134560337254987],
    ];
    const offset = 20;
    const pts: Vec3[] = raw.map(([x, y]) => [x + offset, y + offset, 0]);
    const polygons: Polygon[] = [];
    for (let i = 0; i < pts.length - 1; i++) {
      polygons.push(...silhouetteEdge(pts[i]!, pts[i + 1]!, [3, 0, 0]));
    }
    const out = inkRasterizeWide(polygons, 41);
    const a = pts[2]!, b = pts[3]!;
    const x = Math.floor(a[0] + (b[0] - a[0]) * 0.5);
    const y = Math.floor(a[1] + (b[1] - a[1]) * 0.5);
    expect(cellAt(out, x, y)).toBe("/");
  });
});
