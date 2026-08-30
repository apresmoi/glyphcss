import { describe, expect, it } from "vitest";
import { createGlyphOrthographicCamera } from "glyphcss";
import { glyphMapEquirectangular, glyphMapFromD3Raw, glyphMapGlobe, glyphMapMercator, glyphMapOrthographic } from "./projection";
import type { GlyphMapProjection } from "./projection";

/**
 * Acceptance gate 1 (MAPS.md §7, §13 slice 2): the frame test, ANCHORED
 * OUTSIDE the code under test.
 *
 * "Lands where the globe's own geometry puts it" is circular — a
 * Y-flipped projection mirrors its geometry and its points together and
 * still passes a self-referential check. This test instead pins CHIRALITY
 * against `glyphcss`'s own, independently-authored camera math
 * (`createGlyphOrthographicCamera`, `packages/glyphcss/src/api/
 * createGlyphCamera.ts`), which this package does not own and cannot tune
 * to make the assertion pass.
 *
 * Camera: `rotY: 0`, facing Greenwich, north up. Concretely, `rotY: 0`
 * forces `col` to depend on world `Y` ALONE — `createGlyphOrthographicCamera`
 * applies `rotateZ(rotY)` before `rotateX(rotX)`, and at `rotY: 0` that
 * first stage is the identity on the axis-swapped (X, Y) pair, so `col`'s
 * dependence on `Y` holds for ANY `rotX`. `rotX: 90` is the camera that
 * additionally makes world `Z` (north) read as screen-up (`row` decreasing
 * with `Z`) and world `X` the forward/depth axis (the Greenwich/equator
 * point, at world `[radius, 0, 0]`, gets the LARGEST depth of the three
 * test points) — the same "view from the front" pinning
 * `website/src/components/WordArtWorkbench/wordartSnippets.ts` documents
 * for a Z-up mesh (`rotX: 90, rotY: 0`).
 *
 * A sign flip on either axis fails this — verified by mutation: negating
 * `Y` in {@link glyphMapGlobe}'s `project` (`website/scripts/bake-globe.mjs`'s
 * own `latLonToXYZ` convention — see the "known deviation" note in
 * `parity.test.ts`) turns the first assertion red; negating `Z` turns the
 * second red.
 */
describe("chirality (acceptance gate 1, frame test anchored outside the code under test)", () => {
  const camera = createGlyphOrthographicCamera({ rotX: 90, rotY: 0, zoom: 1 });
  const cols = 100;
  const rows = 100;
  const cellAspect = 1;

  function screenOf(lon: number, lat: number): { col: number; row: number; depth: number } {
    const globe = glyphMapGlobe({ radius: 1, exaggeration: 0 });
    const [x, y, z] = globe.project(lon, lat, 0);
    const [col, row, depth] = camera.project([x, y, z], cols, rows, cellAspect);
    return { col, row, depth };
  }

  it("faces Greenwich: the equator/prime-meridian point is nearest (largest depth) of the three", () => {
    const greenwich = screenOf(0, 0);
    const east30 = screenOf(30, 0);
    const north30 = screenOf(0, 30);
    expect(greenwich.depth).toBeGreaterThan(east30.depth);
    expect(greenwich.depth).toBeGreaterThan(north30.depth);
  });

  it("30°E projects to a GREATER col than 0°E (east reads rightward, north up)", () => {
    const greenwich = screenOf(0, 0);
    const east30 = screenOf(30, 0);
    expect(east30.col).toBeGreaterThan(greenwich.col);
  });

  it("30°N projects to a LESSER row than 0°N (north reads upward)", () => {
    const greenwich = screenOf(0, 0);
    const north30 = screenOf(0, 30);
    expect(north30.row).toBeLessThan(greenwich.row);
  });
});

/**
 * Acceptance gate 1, EXTENDED to every projection this package ships — the
 * gap that let bugs 1 (`glyphMapEquirectangular`), 2 (`glyphMapMercator`)
 * and a 4th, later-reported one (`glyphMapOrthographic`) ship: the block
 * above pinned chirality for {@link glyphMapGlobe} alone, so nothing here
 * caught three of four flat/near-flat projections rendering north at the
 * BOTTOM. `glyphMapFromD3Raw` is covered too, on the same reasoning —
 * untested code sharing the same axis-swap convention as the three
 * broken-then-fixed ones is guilty until this gate proves otherwise.
 *
 * Camera: `rotX: 0, rotY: 0` — the same camera the live bug reports were
 * diagnosed against. Unlike the globe block's `rotY: 0` derivation (which
 * holds for ANY `rotX` because `rotateZ` precedes `rotateX`), a flat
 * projection's relief lives on world `Z`, off both screen axes at this
 * camera, so `rotX` is free to also be `0` — the simplest camera that still
 * makes `col` depend on world `Y` alone and `row` depend on world `X` alone,
 * matching every flat projection's own `X` = north/south, `Y` = east/west
 * frame (see `projection.ts`'s doc comments).
 *
 * Expectations are geographic facts (north is up, east is right, London is
 * west of India) — never derived from the projection under test, so a
 * projection that mirrors its own geometry and its own output together
 * still fails this the same way the globe block's design already prevents.
 */
describe("chirality — every flat/near-flat projection (acceptance gate 1, extended)", () => {
  const camera = createGlyphOrthographicCamera({ rotX: 0, rotY: 0, zoom: 1 });
  const cols = 100;
  const rows = 100;
  const cellAspect = 1;

  function screenOf(projection: GlyphMapProjection, lon: number, lat: number): { col: number; row: number } {
    const [x, y, z] = projection.project(lon, lat, 0);
    const [col, row] = camera.project([x, y, z], cols, rows, cellAspect);
    return { col, row };
  }

  function pinsChirality(name: string, projection: GlyphMapProjection, northLat: number, southLat: number, eastLon: number): void {
    describe(name, () => {
      it(`${eastLon}°E projects to a GREATER col than 0°E (east reads rightward)`, () => {
        const zero = screenOf(projection, 0, 0);
        const east = screenOf(projection, eastLon, 0);
        expect(east.col).toBeGreaterThan(zero.col);
      });

      it(`${northLat}°N projects to a LESSER row than ${Math.abs(southLat)}°S (north reads upward)`, () => {
        const north = screenOf(projection, 0, northLat);
        const south = screenOf(projection, 0, southLat);
        expect(north.row).toBeLessThan(south.row);
      });
    });
  }

  pinsChirality("glyphMapEquirectangular", glyphMapEquirectangular(), 40, -20, 30);
  pinsChirality("glyphMapMercator", glyphMapMercator(), 40, -20, 30);
  pinsChirality("glyphMapOrthographic", glyphMapOrthographic(), 40, -20, 30);

  describe("glyphMapFromD3Raw (Mollweide, a raw projection this package does not own)", () => {
    it("30°E projects to a GREATER col than 0°E, and 40°N projects to a LESSER row than 20°S", async () => {
      // devDependency only, as in projection.test.ts's own d3 gate.
      const { geoMollweideRaw } = await import("d3-geo-projection");
      const mollweide = glyphMapFromD3Raw(geoMollweideRaw, { id: "mollweide" });
      const zero = screenOf(mollweide, 0, 0);
      const east = screenOf(mollweide, 30, 0);
      expect(east.col).toBeGreaterThan(zero.col);
      const north = screenOf(mollweide, 0, 40);
      const south = screenOf(mollweide, 0, -20);
      expect(north.row).toBeLessThan(south.row);
    });
  });
});
