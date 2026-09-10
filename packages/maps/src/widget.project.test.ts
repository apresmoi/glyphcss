import { describe, expect, it } from "vitest";
import { createGlyphMap } from "./widget";
import { glyphMapGlobe, glyphMapMercator } from "./projection";

function mount(view: { center: readonly [number, number]; span: number; cols: number; rows: number }, projection: Parameters<typeof createGlyphMap>[1]["projection"]) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const map = createGlyphMap(host, { view, projection });
  return { host, map };
}

/** MAPS.md §13 slice 3 acceptance gate 4. */
describe("createGlyphMap — project()/unproject() round-trip (acceptance gate 4)", () => {
  it("round-trips through the widget at a non-trivial (off-centre, tilted) globe view", () => {
    const { host, map } = mount({ center: [35, 20], span: 50, cols: 100, rows: 60 }, glyphMapGlobe({ radius: 1, exaggeration: 0 }));
    try {
      const lngLat: readonly [number, number] = [42, 28];
      const projected = map.project(lngLat);
      expect(projected.visible).toBe(true);
      const back = map.unproject([projected.col, projected.row]);
      expect(back).not.toBeNull();
      expect(back![0]).toBeCloseTo(lngLat[0], 1);
      expect(back![1]).toBeCloseTo(lngLat[1], 1);
    } finally {
      map.destroy();
      host.remove();
    }
  });

  it("round-trips through the widget at a non-trivial (off-centre) flat (Mercator) view", () => {
    const { host, map } = mount({ center: [12, -8], span: 30, cols: 90, rows: 45 }, glyphMapMercator());
    try {
      const lngLat: readonly [number, number] = [18, -4];
      const projected = map.project(lngLat);
      expect(projected.visible).toBe(true);
      const back = map.unproject([projected.col, projected.row]);
      expect(back).not.toBeNull();
      expect(back![0]).toBeCloseTo(lngLat[0], 6);
      expect(back![1]).toBeCloseTo(lngLat[1], 6);
    } finally {
      map.destroy();
      host.remove();
    }
  });

  it("reports visible: false for a far-hemisphere globe point, and unproject of an off-globe screen cell is null", () => {
    const { host, map } = mount({ center: [35, 20], span: 50, cols: 100, rows: 60 }, glyphMapGlobe({ radius: 1, exaggeration: 0 }));
    try {
      // The antipode of the view centre is never visible.
      const antipode: readonly [number, number] = [35 - 180, -20];
      expect(map.project(antipode).visible).toBe(false);

      // A screen cell far outside the projected globe silhouette has no
      // corresponding lon/lat under this camera.
      const offGlobe = map.unproject([-1000, -1000]);
      expect(offGlobe).toBeNull();
    } finally {
      map.destroy();
      host.remove();
    }
  });

  it("unproject of a cell outside a flat projection's domain is null", () => {
    const { host, map } = mount({ center: [0, 0], span: 30, cols: 90, rows: 45 }, glyphMapMercator());
    try {
      // Far outside Mercator's own screen footprint at this zoom.
      const outside = map.unproject([1_000_000, 1_000_000]);
      expect(outside).toBeNull();
    } finally {
      map.destroy();
      host.remove();
    }
  });
});
