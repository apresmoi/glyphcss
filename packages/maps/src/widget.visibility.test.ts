import { describe, expect, it } from "vitest";
import { createGlyphMap } from "./widget";
import { glyphMapGlobe } from "./projection";
import type { GlyphMapView } from "./types";

/**
 * MAPS.md §13 slice 3 acceptance gate 1 — an INDEPENDENT visibility
 * assertion, not parity with `world.astro`. The expectation is derived from
 * geography (a view centred on Greenwich/equator can never see the exact
 * antipode, [180, 0]), never from the code under test — a reimplementer who
 * inherited `world.astro`'s inverted depth-sign bug (`:188`'s
 * `findFocalLatLon` picks MINIMUM depth as the near-hemisphere focal point;
 * `:366`'s `depth < 0` front-hemisphere check) could still write a
 * self-consistent test with the same inverted sign and pass it.
 */
describe("createGlyphMap — visibility (acceptance gate 1)", () => {
  function mount(view: GlyphMapView) {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const map = createGlyphMap(host, { view, projection: glyphMapGlobe({ radius: 1, exaggeration: 0 }) });
    return { host, map };
  }

  it("a marker at [180, 0] is culled when the view is centred on [0, 0]", () => {
    const { host, map } = mount({ center: [0, 0], span: 60, cols: 80, rows: 40 });
    try {
      expect(map.project([180, 0]).visible).toBe(false);
    } finally {
      map.destroy();
      host.remove();
    }
  });

  it("a marker at [0, 0] is visible when the view is centred on [0, 0]", () => {
    const { host, map } = mount({ center: [0, 0], span: 60, cols: 80, rows: 40 });
    try {
      expect(map.project([0, 0]).visible).toBe(true);
    } finally {
      map.destroy();
      host.remove();
    }
  });

  it("stays correct under a DIFFERENT camera state (view centred on [90, 30]) — not a fixture-specific coincidence", () => {
    const { host, map } = mount({ center: [90, 30], span: 60, cols: 80, rows: 40 });
    try {
      // The far hemisphere from [90, 30] is centred on its antipode, [-90, -30].
      expect(map.project([90, 30]).visible).toBe(true);
      expect(map.project([-90, -30]).visible).toBe(false);
    } finally {
      map.destroy();
      host.remove();
    }
  });

  it("addMarker hides the marker element itself on the far hemisphere", () => {
    const { host, map } = mount({ center: [0, 0], span: 60, cols: 80, rows: 40 });
    try {
      const near = map.addMarker({ at: [0, 0] });
      const far = map.addMarker({ at: [180, 0] });
      expect(near.el.style.display).not.toBe("none");
      expect(far.el.style.display).toBe("none");
    } finally {
      map.destroy();
      host.remove();
    }
  });

  /**
   * MUTATION CHECK (required by the task): temporarily reverting
   * `glyphMapGlobe`'s `visible()` to the buggy `world.astro:366` convention
   * (`depth < 0` as front-facing, using RAW depth rather than depth relative
   * to the sphere's own centre) flips this test red — verified by hand
   * during development, not left in the tree as a toggle (a real defect,
   * not a knob). This test's own value: it fails if `visible` is deleted,
   * inverted, or hardcoded to `true`/`false`, and it does NOT compare
   * against `world.astro`'s own output (which is impossible anyway — the
   * bug this gate exists to catch was never reproduced in a test until now).
   */
  it("is not satisfied by a constant true or false — both directions are exercised on one fixture", () => {
    const { host, map } = mount({ center: [0, 0], span: 60, cols: 80, rows: 40 });
    try {
      const near = map.project([0, 0]).visible;
      const far = map.project([180, 0]).visible;
      expect(near).not.toBe(far);
    } finally {
      map.destroy();
      host.remove();
    }
  });
});
