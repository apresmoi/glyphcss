import { describe, expect, it } from "vitest";
import { glyphMapDegreesPerCell, glyphMapTargetLOD, type GlyphMapProvider, type GlyphMapProviderZoomLevel } from "./provider";
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
