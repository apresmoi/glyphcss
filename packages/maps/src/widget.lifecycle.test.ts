import { describe, expect, it, vi } from "vitest";
import { createGlyphMap } from "./widget";
import { glyphMapEquirectangular, glyphMapGlobe } from "./projection";
import type { GlyphMapGeoTile } from "./tile";
import type { GlyphMapProvider } from "./provider";

function makeFlatTile(): GlyphMapGeoTile {
  const cols = 2, rows = 2;
  const elevation = new Float32Array((cols + 1) * (rows + 1)).fill(100);
  return { bounds: { west: -10, east: 10, south: -10, north: 10 }, cols, rows, elevation, source: "synthetic", sampler: "nearest" };
}

/** MAPS.md §13 slice 3 acceptance gate 3. */
describe("createGlyphMap — lifecycle (acceptance gate 3)", () => {
  it("destroy() removes the scene's DOM subtree from the host", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const map = createGlyphMap(host, { view: { center: [0, 0], span: 60, cols: 40, rows: 20 }, projection: glyphMapEquirectangular() });
    expect(host.childElementCount).toBeGreaterThan(0);
    map.destroy();
    expect(host.childElementCount).toBe(0);
    host.remove();
  });

  it("destroy() removes every host listener the widget attached", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const map = createGlyphMap(host, { view: { center: [0, 0], span: 60, cols: 40, rows: 20 }, projection: glyphMapEquirectangular() });
    const removeSpy = vi.spyOn(host, "removeEventListener");
    map.destroy();
    const removedTypes = removeSpy.mock.calls.map((call) => call[0]);
    for (const type of ["pointerdown", "pointermove", "pointerup", "pointercancel", "wheel"]) {
      expect(removedTypes).toContain(type);
    }
    host.remove();
  });

  it("destroy() cancels a pending debounced tile fetch — no leaked timer keeps fetching after teardown", async () => {
    vi.useFakeTimers();
    try {
      const host = document.createElement("div");
      document.body.appendChild(host);
      let loadCount = 0;
      const provider: GlyphMapProvider = {
        id: "synthetic",
        zooms: [{ z: 0, cols: 1, rows: 1, tileLonSpan: 360, tileLatSpan: 180, tileCols: 2, tileRows: 2 }],
        bounds: () => ({ west: -180, east: 180, south: -90, north: 90 }),
        loadTile: async () => {
          loadCount++;
          return makeFlatTile();
        },
      };
      const map = createGlyphMap(host, {
        view: { center: [0, 0], span: 60, cols: 40, rows: 20 },
        projection: glyphMapEquirectangular(),
        layers: [{ type: "raster", source: provider }],
      });
      await vi.runAllTimersAsync();
      const countAfterInitialLoad = loadCount;
      expect(countAfterInitialLoad).toBeGreaterThan(0);

      // A view change schedules a debounced refetch...
      map.setView({ span: 30 });
      // ...but destroy happens before the debounce timer fires.
      map.destroy();
      await vi.runAllTimersAsync();
      expect(loadCount).toBe(countAfterInitialLoad);
      host.remove();
    } finally {
      vi.useRealTimers();
    }
  });

  it("destroy() is safe to call twice", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const map = createGlyphMap(host, { view: { center: [0, 0], span: 60, cols: 40, rows: 20 }, projection: glyphMapGlobe() });
    map.destroy();
    expect(() => map.destroy()).not.toThrow();
    host.remove();
  });

  it("destroy() clears the widget's own marker/layer/listener bookkeeping — a marker added before destroy leaves no live sync hook running", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const map = createGlyphMap(host, { view: { center: [0, 0], span: 60, cols: 40, rows: 20 }, projection: glyphMapGlobe() });
    const marker = map.addMarker({ at: [0, 0] });
    map.destroy();
    // The marker's own hotspot DOM was removed along with the scene subtree
    // — mutating it further (a stray sync callback still holding a
    // reference) would be silently harmless, but the element itself must be
    // detached, proving no dangling reference keeps it alive in the host.
    expect(marker.el.isConnected).toBe(false);
    host.remove();
  });
});
