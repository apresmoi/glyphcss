import { describe, it, expect } from "vitest";
import { rasterize, inkGlyphForTangent } from "./rasterize";
import { buildRasterizeContext } from "../api/rasterizeContext";
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

describe("inkGlyphForTangent — direction quantization", () => {
  it("picks a horizontal glyph for a horizontal tangent, keyed by sub-row position", () => {
    expect(inkGlyphForTangent(1, 0, 0.1)).toBe("‾");
    expect(inkGlyphForTangent(1, 0, 0.5)).toBe("-");
    expect(inkGlyphForTangent(1, 0, 0.9)).toBe("_");
    // A tangent and its negation trace the same line.
    expect(inkGlyphForTangent(-1, 0, 0.1)).toBe("‾");
  });

  it("picks '▔' for a horizontal tangent in the finer sub-row band between '‾' and '-'", () => {
    // Measured (14-subcell-quantization-census.mjs): "▔" (UPPER ONE EIGHTH
    // BLOCK) sits at row-centroid .28, between "‾" (.16) and "-" (.68), at
    // the same ~2.5-4.3% coverage / ~0.9 eccentricity as the existing three
    // glyphs — a real, weight-consistent finer level, not a new one.
    expect(inkGlyphForTangent(1, 0, 0.25)).toBe("▔");
    expect(inkGlyphForTangent(-1, 0, 0.25)).toBe("▔");
  });

  it("a horizontal stroke's glyph is monotonic as it sweeps top to bottom across a cell", () => {
    const atSubRow = (subRow: number) => inkGlyphForTangent(1, 0, subRow);
    const order = ["‾", "▔", "-", "_"];
    let lastIdx = -1;
    for (let subRow = 0; subRow <= 1; subRow += 0.05) {
      const idx = order.indexOf(atSubRow(subRow));
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeGreaterThanOrEqual(lastIdx);
      lastIdx = idx;
    }
  });

  it("picks '|' for a vertical tangent at the default (centre) sub-column, independent of sub-row", () => {
    expect(inkGlyphForTangent(0, 1, 0.1)).toBe("|");
    expect(inkGlyphForTangent(0, -1, 0.9)).toBe("|");
  });

  it("picks a vertical glyph for a vertical tangent, keyed by sub-column position", () => {
    // Mirrors the horizontal sub-row test above, onto the column axis.
    expect(inkGlyphForTangent(0, 1, 0.5, 0.1)).toBe("▏"); // left edge
    expect(inkGlyphForTangent(0, 1, 0.5, 0.5)).toBe("|"); // centre
    expect(inkGlyphForTangent(0, 1, 0.5, 0.9)).toBe("▕"); // right edge
    // A tangent and its negation trace the same line.
    expect(inkGlyphForTangent(0, -1, 0.5, 0.1)).toBe("▏");
    // Sub-row is irrelevant to the vertical bucket's glyph choice.
    expect(inkGlyphForTangent(0, 1, 0.9, 0.1)).toBe("▏");
  });

  it("a vertical stroke near a cell's left edge picks a different glyph than one at centre-right, and the choice tracks the stroke as it moves across the cell", () => {
    // Vertical stays at three levels (unchanged from db5703c): a finer "▎"
    // level was tried and measured plausible by coverage alone, but the
    // rendered visual proof on real extruded-text geometry showed it
    // replacing "▏" almost everywhere rather than adding occasional finer
    // positioning — see the `inkGlyphForTangent` doc comment.
    const atSubCol = (subCol: number) => inkGlyphForTangent(0, 1, 0.5, subCol);
    const left = atSubCol(0.05);
    const centreRight = atSubCol(0.7);
    expect(left).not.toBe(centreRight);
    // Sweep sub-column left to right across a cell: the glyph choice is
    // monotonically non-decreasing through the left -> centre -> right
    // ordering (never regresses to an earlier bucket), so a stroke sliding
    // across the cell reads as continuous motion instead of jitter.
    const order = ["▏", "|", "▕"];
    let lastIdx = -1;
    for (let subCol = 0; subCol <= 1; subCol += 0.05) {
      const idx = order.indexOf(atSubCol(subCol));
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeGreaterThanOrEqual(lastIdx);
      lastIdx = idx;
    }
  });

  it("picks '\\\\' for a down-right/up-left 45° tangent, independent of sub-cell position", () => {
    expect(inkGlyphForTangent(1, 1)).toBe("\\");
    expect(inkGlyphForTangent(-1, -1)).toBe("\\");
    // No sub-cell-shifted "\\" variant exists in monospace fonts, so a
    // diagonal tangent renders the same glyph regardless of where within
    // the cell it sits.
    expect(inkGlyphForTangent(1, 1, 0.1, 0.1)).toBe("\\");
    expect(inkGlyphForTangent(1, 1, 0.9, 0.9)).toBe("\\");
  });

  it("picks '/' for an up-right/down-left 45° tangent, independent of sub-cell position", () => {
    expect(inkGlyphForTangent(1, -1)).toBe("/");
    expect(inkGlyphForTangent(-1, 1)).toBe("/");
    expect(inkGlyphForTangent(1, -1, 0.1, 0.9)).toBe("/");
    expect(inkGlyphForTangent(1, -1, 0.9, 0.1)).toBe("/");
  });
});

describe("rasterize — ink mode oriented silhouette outline", () => {
  it("renders a horizontal silhouette chain as horizontal glyphs", () => {
    const polygons = chainSilhouettePolygons([[-1, 5, 0], [2, 5, 0], [8, 5, 0], [11, 5, 0]], [0, -3, 0]);
    const out = inkRasterize(polygons);
    for (let col = 2; col <= 8; col++) {
      expect(["‾", "-", "_"]).toContain(cellAt(out, col, 5));
    }
    // The whole chain is exactly horizontal (y === 5 throughout, zero
    // sub-row offset) — deterministically the top-third glyph.
    expect(cellAt(out, 5, 5)).toBe("‾");
  });

  it("renders a vertical silhouette chain keyed by sub-column position, mirroring the horizontal case", () => {
    // The whole chain sits at exactly x === 5 (integer, zero sub-column
    // offset within cell 5) — deterministically the left-third glyph,
    // exactly mirroring the horizontal chain test above landing on the
    // top-third glyph at zero sub-row offset.
    const polygons = chainSilhouettePolygons([[5, -1, 0], [5, 2, 0], [5, 8, 0], [5, 11, 0]], [3, 0, 0]);
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
    for (let i = 2; i <= 8; i++) {
      expect(cellAt(out, i, 10 - i)).toBe("/");
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

  it("renders an isolated straight segment along its own slope at 0/45/90/135 degrees", () => {
    // The cube test above is the real-geometry proof that a >=3-edge junction
    // no longer hijacks an edge's orientation. This one pins the simpler
    // invariant underneath it: a lone segment always draws its own slope.
    // (An earlier version of this test tried to synthesise junction
    // contamination from extra branch edges, but those branches are
    // themselves drawn silhouettes that overwrite the segment's own cells,
    // so it was asserting draw order rather than tangent choice.)
    const cases: { a: Vec3; b: Vec3; expected: string[] }[] = [
      { a: [4, 10, 0], b: [16, 10, 0], expected: ["\u203e", "-", "_"] },
      // x === 10 throughout (integer, zero sub-column offset) selects the
      // left-third vertical glyph, mirroring the horizontal case's zero
      // sub-row offset selecting the top-third glyph above.
      { a: [10, 4, 0], b: [10, 16, 0], expected: ["\u258f"] },
      { a: [4, 4, 0], b: [16, 16, 0], expected: ["\\"] },
      { a: [4, 16, 0], b: [16, 4, 0], expected: ["/"] },
    ];
    for (const { a, b, expected } of cases) {
      // Perpendicular to THIS segment, or the apex is collinear with the edge
      // and both triangles are culled as zero-area.
      const perp: [number, number, number] = [-(b[1] - a[1]) / 4, (b[0] - a[0]) / 4, 1];
      const out = inkRasterizeWide(silhouetteEdge(a, b, perp), 21);
      const dx = b[0] - a[0], dy = b[1] - a[1];
      for (const t of [0.4, 0.5, 0.6]) {
        const glyph = cellAt(out, Math.round(a[0] + dx * t), Math.round(a[1] + dy * t));
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
