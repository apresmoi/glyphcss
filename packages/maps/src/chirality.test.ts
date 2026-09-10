import { describe, expect, it } from "vitest";
import { createGlyphOrthographicCamera } from "glyphcss";
import { glyphMapEquirectangular, glyphMapFromD3Raw, glyphMapGlobe, glyphMapMercator, glyphMapOrthographic } from "./projection";
import type { GlyphMapProjection } from "./projection";
import { glyphMapProjectionTransition } from "./transition";

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

/**
 * Acceptance gate 1, extended to slice 4's `glyphMapProjectionTransition`
 * (MAPS.md §13 slice 4's normative constraint: "a blended projection must
 * satisfy the same CHIRALITY gate the real ones do... add the blend to that
 * gate at t=0, 0.5, 1"). Not a fresh assumption: `createGlyphOrthographicCamera`
 * is AFFINE in world (X, Y, Z) — no perspective divide — so `camera.project`
 * distributes over the per-vertex lerp `glyphMapProjectionTransition` builds:
 * `camera.project(lerp(worldA, worldB, t)) === lerp(camera.project(worldA),
 * camera.project(worldB), t)`. If both endpoints individually satisfy a
 * chirality inequality (a positive margin) under the SAME camera, every
 * convex combination of those two positive margins (any `t` in `[0, 1]`) is
 * itself positive — so a blend of two chirality-correct projections is
 * chirality-correct at every `t`, not just the two endpoints. These tests
 * pin exactly that, at t=0, 0.5 and 1, rather than trusting the argument
 * without a mutation-checkable assertion.
 */
describe("chirality — glyphMapProjectionTransition blend (acceptance gate 1, extended to slice 4)", () => {
  it("equirectangular -> Mercator blend: east reads right, north reads up at t=0, 0.5, 1 (flat/near-flat camera)", () => {
    const camera = createGlyphOrthographicCamera({ rotX: 0, rotY: 0, zoom: 1 });
    const cols = 100;
    const rows = 100;
    const cellAspect = 1;

    function screenOf(projection: GlyphMapProjection, lon: number, lat: number): { col: number; row: number } {
      const [x, y, z] = projection.project(lon, lat, 0);
      const [col, row] = camera.project([x, y, z], cols, rows, cellAspect);
      return { col, row };
    }

    const a = glyphMapEquirectangular();
    const b = glyphMapMercator();
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const blend = glyphMapProjectionTransition(a, b, t);
      const zero = screenOf(blend, 0, 0);
      const east = screenOf(blend, 30, 0);
      const north = screenOf(blend, 0, 30);
      const south = screenOf(blend, 0, -30);
      expect(east.col, `t=${t}`).toBeGreaterThan(zero.col);
      expect(north.row, `t=${t}`).toBeLessThan(south.row);
    }
  });

  /**
   * A flat<->globe blend gets ONLY the east/col half of the gate, on a
   * single fixed camera, and that is a deliberate, documented scope
   * boundary — not an oversight. `Y` = east/west (lon) is the one axis
   * EVERY projection in this file shares (equirect's own doc: "the same
   * 'east is +Y' chirality glyphMapGlobe pins below"), so `camera.project`'s
   * affine distribution over the lerp (this describe block's own doc
   * comment) makes the col assertion hold at every `t` under ANY fixed
   * camera that isolates `Y`. North/south is NOT shared: a flat projection
   * puts it on world `X` (needs `rotX:0`, this file's second describe
   * block's camera) while `glyphMapGlobe` puts it on world `Z` (needs
   * `rotX:90`, this file's first describe block's camera, facing
   * Greenwich) — there is no single fixed camera under which BOTH pure
   * endpoints individually pass a "row depends on north" check, so no
   * camera exists under which the LINEARITY argument (this describe
   * block's own doc) could make the BLEND pass one either. Measured, not
   * assumed: an earlier version of this test asserted the row check under
   * the `rotX:90` globe camera and failed AT t=0 — `glyphMapEquirectangular`
   * alone puts Greenwich and 30°N at the same row there, since a flat
   * sheet's world `Z` (what this camera reads as "up") carries no lat
   * signal at all.
   *
   * This is not a gap in the transition's correctness: `createGlyphMap`'s
   * `setProjection` does not hold the camera fixed across a sheet<->globe
   * transition either — it interpolates `rotX`/`rotY` FROM the sheet's own
   * baseline TOWARD `cameraForCenter`'s orbit frame (see widget.ts's
   * `applyProjectionFrame` and its own tests), which is exactly what
   * compensates for the two endpoints' different north/south axis. A
   * fixed-camera row check on the raw blended vertices would be testing a
   * viewing condition the real transition never actually renders under.
   */
  it("equirectangular -> globe blend: east reads right at t=0, 0.5, 1 (globe camera, rotX:90 facing Greenwich) — north/row is out of scope for this fixed-camera geometry gate, see doc", () => {
    // Same camera as this file's first describe block above — the one
    // `glyphMapGlobe`'s own chirality is pinned against, so the globe
    // ENDPOINT (t=1) reads identically here to that block's own assertions.
    const camera = createGlyphOrthographicCamera({ rotX: 90, rotY: 0, zoom: 1 });
    const cols = 100;
    const rows = 100;
    const cellAspect = 1;

    function screenOf(projection: GlyphMapProjection, lon: number, lat: number): { col: number; row: number } {
      const [x, y, z] = projection.project(lon, lat, 0);
      const [col, row] = camera.project([x, y, z], cols, rows, cellAspect);
      return { col, row };
    }

    const a = glyphMapEquirectangular();
    const b = glyphMapGlobe({ radius: 1, exaggeration: 0 });
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const blend = glyphMapProjectionTransition(a, b, t);
      const zero = screenOf(blend, 0, 0);
      const east = screenOf(blend, 30, 0);
      expect(east.col, `t=${t}`).toBeGreaterThan(zero.col);
    }
  });

  /**
   * The same gate on the UNWRAP path — the sheet<->globe blend an `anchor`
   * engages (`transition.ts`). The linearity argument in this describe
   * block's own doc does NOT carry here: the unwrap is a spherical cap, not
   * a convex combination of the two endpoints, so "both endpoints pass ⇒
   * every blend passes" proves nothing about it and chirality has to be
   * measured at each `t` directly. It is measured under two anchors,
   * because the anchor also rotates the surface about the polar axis — a
   * sign error in that rotation would leave the Greenwich-anchored case
   * looking fine.
   *
   * Unlike the two fixed-camera blocks above, this one moves the camera the
   * way the real transition does: `createGlyphMap.applyProjectionFrame`
   * lerps `rotX`/`rotY` between the two endpoints' own framings (orbit:
   * `cameraForCenter`, i.e. `rotX = 90 - lat`, `rotY = lon`; sheet: `rotX =
   * tilt`, `rotY = 0`, at `tilt: 0` here). Holding the camera fixed would
   * test a viewing condition that never renders — and would fail for a
   * legitimate geometric reason, since an anchor far from the fixed
   * camera's own meridian puts the region under test on the side of the
   * sphere facing away, where east genuinely does read leftward.
   */
  it("equirectangular <-> globe UNWRAP: east reads right at t=0, 0.25, 0.5, 0.75, 1, under two anchors and in both directions", () => {
    const cols = 100;
    const rows = 100;
    const cellAspect = 1;
    const sheet = glyphMapEquirectangular();
    const globe = glyphMapGlobe({ radius: 1, exaggeration: 0 });

    for (const [a, b] of [[sheet, globe], [globe, sheet]] as const) {
      for (const anchor of [[0, 0], [140, 40], [-75, -60]] as const) {
        const orbitFraming = { rotX: 90 - anchor[1], rotY: anchor[0] };
        const sheetFraming = { rotX: 0, rotY: 0 };
        const framingA = a === globe ? orbitFraming : sheetFraming;
        const framingB = b === globe ? orbitFraming : sheetFraming;
        for (const t of [0, 0.25, 0.5, 0.75, 1]) {
          const camera = createGlyphOrthographicCamera({
            rotX: framingA.rotX + (framingB.rotX - framingA.rotX) * t,
            rotY: framingA.rotY + (framingB.rotY - framingA.rotY) * t,
            zoom: 1,
          });
          const blend = glyphMapProjectionTransition(a, b, t, { anchor });
          const screenOf = (lon: number, lat: number): number => {
            const [x, y, z] = blend.project(lon, lat, 0);
            return camera.project([x, y, z], cols, rows, cellAspect)[0];
          };
          // Sampled about the ANCHOR: away from the tangency the sphere
          // genuinely wraps around and a point far enough east is west
          // again, which is the geometry being correct, not a chirality
          // failure.
          const label = `${a.id}->${b.id} anchor ${anchor} t=${t}`;
          expect(screenOf(anchor[0] + 30, anchor[1]), label).toBeGreaterThan(screenOf(anchor[0], anchor[1]));
        }
      }
    }
  });
});
