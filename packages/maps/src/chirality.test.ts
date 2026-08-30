import { describe, expect, it } from "vitest";
import { createGlyphOrthographicCamera } from "glyphcss";
import { glyphMapGlobe } from "./projection";

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
