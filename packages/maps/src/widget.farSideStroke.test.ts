import { afterEach, describe, expect, it, vi } from "vitest";
import { createGlyphMap } from "./widget";
import { glyphMapGlobe, glyphMapEquirectangular } from "./projection";
import type { GlyphMapProvider } from "./provider";
import type { GlyphMapGeoTile } from "./tile";
import type { GlyphMapVectorFeature } from "./vector/types";

/**
 * Regression for a real defect: a `line` layer's `stamp` projected every
 * ring vertex with `camera.project` and stamped it, WITHOUT ever consulting
 * `projection.visible` — the globe's own near/far-hemisphere capability
 * that tile culling (`isBoundsVisible`), marker hiding, point-feature
 * hotspots and `unprojectSphere` all already go through. An orthographic
 * camera projects the FAR hemisphere onto the same screen disc as the near
 * one, so a border on the far side landed inside the globe's silhouette and
 * read as lines drawn through the sphere.
 *
 * The depth test in `stampGlyphMapPolyline` was the only thing standing in
 * the way, and it is explicitly a no-op on a cell whose `grid.depth` is
 * non-finite ("no base surface there means nothing to be occluded by",
 * `stroke.ts`) — which is every cell the terrain mesh does not cover,
 * including the ring of cells just inside/around the limb and the polar
 * caps. Measured on a full-globe terrain layer, a far-hemisphere graticule
 * still leaked 124 cells.
 */

const COLS = 120;
const ROWS = 48;

function makeTerrain(): GlyphMapProvider & { loadTile: ReturnType<typeof vi.fn> } {
  const zooms = [0, 1].map((z) => ({
    z,
    cols: 2 ** z,
    rows: 2 ** z,
    tileLonSpan: 360 / 2 ** z,
    tileLatSpan: 180 / 2 ** z,
    tileCols: 32,
    tileRows: 32,
  }));
  const bounds = (z: number, x: number, y: number) => {
    const level = zooms[z];
    const west = -180 + x * level.tileLonSpan;
    const north = 90 - y * level.tileLatSpan;
    return { west, east: west + level.tileLonSpan, south: north - level.tileLatSpan, north };
  };
  const loadTile = vi.fn(async (z: number, x: number, y: number): Promise<GlyphMapGeoTile> => ({
    bounds: bounds(z, x, y),
    cols: 32,
    rows: 32,
    elevation: new Float32Array(33 * 33),
    source: "far-side-test",
    sampler: "nearest",
  }));
  return { id: "far-side-test", zooms, bounds, loadTile };
}

function changedCells(before: string, after: string): { col: number; row: number }[] {
  const a = before.split("\n");
  const b = after.split("\n");
  const out: { col: number; row: number }[] = [];
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      if ((a[row]?.[col] ?? " ") !== (b[row]?.[col] ?? " ")) out.push({ col, row });
    }
  }
  return out;
}

/** Meridians + parallels confined to a longitude window, at 5-degree vertex spacing. */
function graticule(westLon: number, eastLon: number): GlyphMapVectorFeature[] {
  const wrap = (lon: number) => ((((lon + 180) % 360) + 360) % 360) - 180;
  const features: GlyphMapVectorFeature[] = [];
  for (let lon = westLon; lon <= eastLon; lon += 5) {
    const ring: [number, number][] = [];
    for (let lat = -85; lat <= 85; lat += 5) ring.push([wrap(lon), lat]);
    features.push({ id: `m${lon}`, rings: [ring] });
  }
  for (let lat = -80; lat <= 80; lat += 10) {
    const ring: [number, number][] = [];
    for (let lon = westLon; lon <= eastLon; lon += 5) ring.push([wrap(lon), lat]);
    features.push({ id: `p${lat}`, rings: [ring] });
  }
  return features;
}

async function mountGlobeWithTerrain(withTerrain: boolean) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const map = createGlyphMap(host, {
    view: { center: [0, 0], span: 170, cols: COLS, rows: ROWS },
    projection: glyphMapGlobe(),
  });
  if (withTerrain) {
    const terrain = makeTerrain();
    map.addLayer({ type: "raster", id: "terrain", source: terrain });
    await vi.waitFor(() => expect(terrain.loadTile).toHaveBeenCalled(), { timeout: 2000 });
    await new Promise((r) => setTimeout(r, 80));
  }
  map.scene.rerender();
  return { host, map, before: map.scene.output.textContent ?? "" };
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("createGlyphMap — a line layer never draws far-hemisphere geometry over the near side", () => {
  it("leaves ZERO ink for a far-side graticule, even where the terrain mesh covers the disc", async () => {
    const { host, map, before } = await mountGlobeWithTerrain(true);
    // Camera is centred on lon 0, so every longitude beyond ±90 is on the
    // far hemisphere. 95..265 is strictly far side with a 5-degree margin.
    map.addLayer({ type: "line", id: "far", source: { features: graticule(95, 265) }, color: "#ff0000" });
    map.scene.rerender();
    const after = map.scene.output.textContent ?? "";
    expect(changedCells(before, after)).toEqual([]);
    map.destroy();
    host.remove();
  });

  it("leaves ZERO ink for a far-side graticule with NO terrain at all (every cell reads empty depth)", async () => {
    const { host, map, before } = await mountGlobeWithTerrain(false);
    map.addLayer({ type: "line", id: "far", source: { features: graticule(95, 265) }, color: "#ff0000" });
    map.scene.rerender();
    const after = map.scene.output.textContent ?? "";
    // With no opaque base every cell's `grid.depth` is non-finite, so the
    // depth test is a documented no-op and the far side painted straight
    // through the sphere's centre — measured 85 cells before the fix.
    expect(changedCells(before, after)).toEqual([]);
    map.destroy();
    host.remove();
  });

  it("still draws the NEAR side (the far-side gate is not a dead layer)", async () => {
    const { host, map, before } = await mountGlobeWithTerrain(false);
    map.addLayer({ type: "line", id: "near", source: { features: graticule(-60, 60) }, color: "#00ff00" });
    map.scene.rerender();
    const after = map.scene.output.textContent ?? "";
    const cells = changedCells(before, after);
    expect(cells.length).toBeGreaterThan(200);
    map.destroy();
    host.remove();
  });

  it("clips a limb-crossing segment AT the limb — the near run inks, the far run does not", async () => {
    const { host, map, before } = await mountGlobeWithTerrain(false);
    // With the camera centred on lon 0 (`cameraForCenter(0, 0)` =>
    // `rotX: 90, rotY: 0`), the orthographic depth functional reduces to
    // world X = cos(lat)*cos(lon), so the near side is exactly |lon| <= 90
    // at EVERY latitude. A far-side point mirrors onto the same column as
    // its near-side twin (sin(180 - L) === sin(L)), so a column window can
    // never separate the two halves of an equatorial line — this polyline
    // is shaped so the far run lives in ROWS the near run never reaches:
    // the near run is the equator from lon 0 out to the limb, the far run
    // drops to lat -70 immediately past it.
    const ring: [number, number][] = [
      [0, 0], [40, 0], [80, 0], [88, 0],
      [92, 0], [92, -35], [92, -70], [130, -70], [178, -70],
    ];
    map.addLayer({ type: "line", id: "crossing", source: { features: [{ id: "x", rings: [ring] }] }, color: "#ff00ff" });
    map.scene.rerender();
    const after = map.scene.output.textContent ?? "";
    const cells = changedCells(before, after);
    const centreRow = ROWS / 2;
    // The near run is confined to the equator band; the far run's own
    // latitudes (-35 and -70) land well below it. Dropping the whole ring
    // at the first invisible vertex would empty `nearRun` too, and stamping
    // it whole leaves ink in `farRun` — so this fails in both directions.
    const nearRun = cells.filter((c) => Math.abs(c.row - centreRow) <= 2);
    const farRun = cells.filter((c) => c.row > centreRow + 4);
    expect(nearRun.length).toBeGreaterThan(10);
    expect(farRun).toEqual([]);
    map.destroy();
    host.remove();
  });

  it("a contour layer inks nothing when only the FAR hemisphere carries crossings", async () => {
    // The companion check for the contour path, which reaches its field
    // through `unproject()` -> `unprojectSphere`, and so is gated on
    // `projection.visible` already (widget.ts). With the contour's tile
    // MOSAIC now covering the whole visible globe rather than one tile, a
    // far-side leak there would show up as ink mirrored back over the near
    // hemisphere — this pins that it does not, and that the two defects
    // were genuinely separate mechanisms.
    //
    // Mutation-checked by making `stamp` sample each cell's ANTIPODE (red).
    // Deleting `unprojectSphere`'s own `projection.visible` line alone does
    // NOT redden it, and that is correct rather than a weak assertion: that
    // Newton solve is seeded from `centerForCamera(...)`, the near-side
    // sub-observer point, so it converges to the near-side root and never
    // reports a far-side `(lon, lat)` in the first place. The `visible` line
    // is a second guard on the same property, not the only one.
    const zooms = [0, 1, 2].map((z) => ({
      z, cols: 2 ** z, rows: 2 ** z,
      tileLonSpan: 360 / 2 ** z, tileLatSpan: 180 / 2 ** z, tileCols: 90, tileRows: 90,
    }));
    const bounds = (z: number, x: number, y: number) => {
      const level = zooms[z];
      const west = -180 + x * level.tileLonSpan;
      const north = 90 - y * level.tileLatSpan;
      return { west, east: west + level.tileLonSpan, south: north - level.tileLatSpan, north };
    };
    // Flat (elevation 0) everywhere within 120 degrees of the camera's own
    // longitude, so no `levels: [500]` crossing can exist on the near side
    // OR in the bilinear neighbourhood of the limb; strongly varying beyond.
    const provider: GlyphMapProvider & { loadTile: ReturnType<typeof vi.fn> } = {
      id: "far-only-field",
      zooms,
      bounds,
      loadTile: vi.fn(async (z: number, x: number, y: number): Promise<GlyphMapGeoTile> => {
        const b = bounds(z, x, y);
        const cols = 24, rows = 24;
        const elevation = new Float32Array((cols + 1) * (rows + 1));
        for (let r = 0; r <= rows; r++) for (let c = 0; c <= cols; c++) {
          const lon = b.west + (b.east - b.west) * (c / cols);
          elevation[r * (cols + 1) + c] = Math.abs(lon) > 120 ? 1000 * Math.sin((lon * Math.PI) / 15) : 0;
        }
        return { bounds: b, cols, rows, elevation, source: "far-only", sampler: "nearest" };
      }),
    };
    const { host, map, before } = await mountGlobeWithTerrain(false);
    map.addLayer({ type: "contour", id: "c", source: provider, levels: [500], color: "#00aaff" });
    await vi.waitFor(() => expect(provider.loadTile).toHaveBeenCalled(), { timeout: 2000 });
    await new Promise((r) => setTimeout(r, 60));
    map.scene.rerender();
    // The mosaic really did mount the far-side tiles (otherwise this passes
    // for the wrong reason — no far-side data to leak in the first place).
    const keys = new Set(provider.loadTile.mock.calls.map(([z, x, y]) => `${z}/${x}_${y}`));
    expect(keys.size).toBeGreaterThan(1);
    expect(changedCells(before, map.scene.output.textContent ?? "")).toEqual([]);
    map.destroy();
    host.remove();
  });

  it("is byte-identical on a flat projection, which declares no `visible` capability", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const map = createGlyphMap(host, {
      view: { center: [0, 0], span: 170, cols: COLS, rows: ROWS },
      projection: glyphMapEquirectangular(),
      tilt: 0,
    });
    map.scene.rerender();
    const before = map.scene.output.textContent ?? "";
    map.addLayer({ type: "line", id: "grat", source: { features: graticule(-80, 80) }, color: "#00ff00" });
    map.scene.rerender();
    const after = map.scene.output.textContent ?? "";
    expect(changedCells(before, after).length).toBeGreaterThan(200);
    map.destroy();
    host.remove();
  });
});
