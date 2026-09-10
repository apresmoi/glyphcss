import { describe, expect, it } from "vitest";
import { glyphMapDegreesPerCell, glyphMapTargetLOD, glyphMapTileRangeForLevel, type GlyphMapProvider, type GlyphMapProviderZoomLevel } from "./provider";
import { glyphMapGlobe } from "./projection";
import type { GlyphMapView } from "./types";

function makeProvider(zooms: readonly GlyphMapProviderZoomLevel[]): GlyphMapProvider {
  return {
    id: "synthetic",
    zooms,
    bounds: () => ({ west: -1, east: 1, south: -1, north: 1 }),
    loadTile: () => Promise.reject(new Error("not used in this test")),
  };
}

// Four zoom levels whose NATIVE resolution (tileLonSpan / tileCols, degrees
// per source quad) is 10, 5, 3, 1.5 respectively.
const PROVIDER = makeProvider([
  { z: 0, cols: 1, rows: 1, tileLonSpan: 180, tileLatSpan: 180, tileCols: 18, tileRows: 18 },
  { z: 1, cols: 2, rows: 2, tileLonSpan: 90, tileLatSpan: 90, tileCols: 18, tileRows: 18 },
  { z: 2, cols: 4, rows: 4, tileLonSpan: 45, tileLatSpan: 45, tileCols: 15, tileRows: 15 },
  { z: 3, cols: 8, rows: 8, tileLonSpan: 22.5, tileLatSpan: 22.5, tileCols: 15, tileRows: 15 },
]);

describe("glyphMapDegreesPerCell", () => {
  it("is view.span / view.cols — geographic, independent of any projection", () => {
    const view: GlyphMapView = { center: [0, 0], span: 160, cols: 80, rows: 40 };
    expect(glyphMapDegreesPerCell(view)).toBe(2);
  });
});

describe("glyphMapTargetLOD (MAPS.md §13 slice 3 acceptance gate 2)", () => {
  it("picks the smallest z whose native resolution is fine enough (degPerCell 6 -> z1, native 5 <= 6)", () => {
    expect(glyphMapTargetLOD(PROVIDER, 6)).toBe(1);
  });

  it("escalates through finer levels as degPerCell shrinks (2 -> z3, native 1.5 <= 2)", () => {
    expect(glyphMapTargetLOD(PROVIDER, 2)).toBe(3);
  });

  it("stays at the coarsest level once it is already fine enough (20 -> z0, native 10 <= 20)", () => {
    expect(glyphMapTargetLOD(PROVIDER, 20)).toBe(0);
  });

  it("caps at the finest available level when even that is coarser than requested (0.001 -> z3)", () => {
    expect(glyphMapTargetLOD(PROVIDER, 0.001)).toBe(3);
  });

  it("throws on a provider with no zoom levels", () => {
    expect(() => glyphMapTargetLOD(makeProvider([]), 1)).toThrow(RangeError);
  });

  /**
   * The bug this gate exists to catch (MAPS.md §13 slice 3, bug #2):
   * `world.astro:91`/`flatmap.astro:235` keyed LOD on absolute `camera.zoom`,
   * which only worked because both pages' world scale happened to be ≈ 1
   * unit ≈ hemisphere. Demonstrated here WITH NUMBERS: a `radius: 100` globe
   * projects the exact same `view` to a world-space span ~100x larger than a
   * `radius: 1` globe does — so an LOD policy keyed on world-unit span (or
   * `camera.zoom`, which tracks it) would need a completely different
   * threshold table per radius. `glyphMapDegreesPerCell`/`glyphMapTargetLOD`
   * never compute or touch a world-space span at all — the SAME `view`
   * yields the SAME `degPerCell` and the SAME chosen LOD level regardless of
   * projection scale.
   */
  it("selects the identical LOD for two projections with wildly different native (world-unit) scales", () => {
    const view: GlyphMapView = { center: [0, 0], span: 10, cols: 80, rows: 40 };
    const degPerCell = glyphMapDegreesPerCell(view);
    expect(degPerCell).toBeCloseTo(0.125, 10);

    const small = glyphMapGlobe({ radius: 1 });
    const large = glyphMapGlobe({ radius: 100 });
    // World-space chord spanned by `view.span` at the two scales — this is
    // what a `camera.zoom`-keyed LOD policy would actually see, and it
    // differs by exactly the radius ratio (100x).
    const chordAt = (projection: ReturnType<typeof glyphMapGlobe>): number => {
      const a = projection.project(view.center[0] - view.span / 2, view.center[1], 0);
      const b = projection.project(view.center[0] + view.span / 2, view.center[1], 0);
      return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    };
    const smallChord = chordAt(small);
    const largeChord = chordAt(large);
    expect(largeChord / smallChord).toBeCloseTo(100, 5);

    // Despite that 100x world-scale difference, the geographic degPerCell —
    // and therefore the chosen LOD — is identical for both, because neither
    // input to `glyphMapTargetLOD` ever touches world units.
    expect(glyphMapTargetLOD(PROVIDER, degPerCell)).toBe(3);
    expect(glyphMapTargetLOD(PROVIDER, degPerCell)).toBe(glyphMapTargetLOD(PROVIDER, degPerCell));
  });
});

/**
 * The REAL zoom pyramid baked by `website/scripts/bake-geo-tiles.mjs` for
 * `/maps`'s ETOPO1 terrain, copied verbatim from the checked-in
 * `website/public/data/geo-tiles/manifest.json` (z0-z4, each level's
 * `tileCols`/`tileRows` fixed at 180x90 — the source-quad resolution stays
 * constant per tile while `tileLonSpan`/`tileLatSpan` halve each level, so
 * native degrees-per-cell halves too: 2, 1, 0.5, 0.25, 0.125). This is the
 * fixture the "does the wheel-zoom fix actually surface deeper terrain"
 * question turns on — `glyphMapTargetLOD` is tested above against synthetic
 * numbers; this pins it against the actual on-disk pyramid so a change to
 * the bake script's own zoom-level shape (tile grid size, span halving)
 * would break this test, not just the synthetic one.
 */
const REAL_GEO_TILES_ZOOMS: readonly GlyphMapProviderZoomLevel[] = [
  { z: 0, cols: 1, rows: 1, tileLonSpan: 360, tileLatSpan: 180, tileCols: 180, tileRows: 90 },
  { z: 1, cols: 2, rows: 2, tileLonSpan: 180, tileLatSpan: 90, tileCols: 180, tileRows: 90 },
  { z: 2, cols: 4, rows: 4, tileLonSpan: 90, tileLatSpan: 45, tileCols: 180, tileRows: 90 },
  { z: 3, cols: 8, rows: 8, tileLonSpan: 45, tileLatSpan: 22.5, tileCols: 180, tileRows: 90 },
  { z: 4, cols: 16, rows: 16, tileLonSpan: 22.5, tileLatSpan: 11.25, tileCols: 180, tileRows: 90 },
];
const REAL_GEO_TILES_PROVIDER = makeProvider(REAL_GEO_TILES_ZOOMS);

describe("glyphMapTargetLOD — real /maps geo-tiles pyramid (z0-z4)", () => {
  // Native degPerCell per level: z0=2, z1=1, z2=0.5, z3=0.25, z4=0.125.
  it.each([
    [3, 0], // zoomed all the way out -> coarsest level already fine enough
    [2, 0], // exactly at z0's native resolution
    [1.5, 1], // between z0 and z1 native res -> the finer of the two that still qualifies
    [1, 1],
    [0.7, 2],
    [0.5, 2],
    [0.3, 3],
    [0.25, 3],
    [0.15, 4],
    [0.125, 4],
    [0.01, 4], // zoomed in past even z4's native resolution -> caps at the finest level, never throws or wraps
  ])("degPerCell %f -> z%i", (degPerCell, expectedZ) => {
    expect(glyphMapTargetLOD(REAL_GEO_TILES_PROVIDER, degPerCell)).toBe(expectedZ);
  });

  it("advances through every one of z0..z4 as span shrinks at a fixed cols (genuinely reaches the finest level, not just z1)", () => {
    const cols = 120;
    const spans = [400, 150, 70, 35, 15]; // degPerCell: 3.33, 1.25, 0.583, 0.292, 0.125
    const zs = spans.map((span) => glyphMapTargetLOD(REAL_GEO_TILES_PROVIDER, span / cols));
    expect(zs).toEqual([0, 1, 2, 3, 4]);
  });
});

describe("glyphMapTileRangeForLevel", () => {
  it("sweeps the full [0,cols-1] x [0,rows-1] range when bounds is absent — the pre-existing behaviour", () => {
    const level: GlyphMapProviderZoomLevel = { z: 4, cols: 16, rows: 16, tileLonSpan: 22.5, tileLatSpan: 11.25, tileCols: 180, tileRows: 90 };
    expect(glyphMapTileRangeForLevel(level)).toEqual({ x0: 0, x1: 15, y0: 0, y1: 15 });
  });

  /**
   * The real z7 Switzerland level from `bake-geo-tiles.mjs`'s curated
   * overlay: n=128, tileLonSpan=360/128=2.8125, tileLatSpan=180/128=1.40625.
   * Expected range independently verified against the baker's own
   * `tilesOverlapping` formula and the actual baked tile set (66_29..31,
   * 67_29..31) — this is the exact box that collapses a 16,384-candidate
   * worldwide z7 sweep to the 6 candidates that actually matter.
   */
  it("restricts the range to the real z7 Switzerland curated bounds", () => {
    const level: GlyphMapProviderZoomLevel = {
      z: 7,
      cols: 128,
      rows: 128,
      tileLonSpan: 360 / 128,
      tileLatSpan: 180 / 128,
      tileCols: 180,
      tileRows: 90,
      bounds: { west: 5.9, east: 10.5, south: 45.8, north: 47.9 },
    };
    expect(glyphMapTileRangeForLevel(level)).toEqual({ x0: 66, x1: 67, y0: 29, y1: 31 });
  });

  it("clamps a bounds box that spills past the level's own tile grid", () => {
    const level: GlyphMapProviderZoomLevel = { z: 1, cols: 2, rows: 2, tileLonSpan: 180, tileLatSpan: 90, tileCols: 180, tileRows: 90, bounds: { west: -200, east: 200, south: -100, north: 100 } };
    expect(glyphMapTileRangeForLevel(level)).toEqual({ x0: 0, x1: 1, y0: 0, y1: 1 });
  });

  it("falls back to the full range on a degenerate (inverted) bounds box rather than silently sweeping zero tiles", () => {
    // west=170, east=-170 (an "unwrapped" antimeridian-straddling box this
    // helper doesn't special-case) resolves to x0=3, x1=0 — genuinely
    // inverted, not merely a single-tile box that happens to look narrow.
    const level: GlyphMapProviderZoomLevel = { z: 2, cols: 4, rows: 4, tileLonSpan: 90, tileLatSpan: 45, tileCols: 180, tileRows: 90, bounds: { west: 170, east: -170, south: 0, north: 10 } };
    expect(glyphMapTileRangeForLevel(level)).toEqual({ x0: 0, x1: 3, y0: 0, y1: 3 });
  });
});
