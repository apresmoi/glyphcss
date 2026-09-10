/**
 * A `heatmap`'s relief reads THE SAME GROUND every other layer does.
 *
 * `GlyphMapOptions.groundElevation` is documented as "the ONE elevation
 * source everything in a map that stands on the ground reads", and as
 * WINNING over the mounted `raster` layers everywhere — "so a map can drape
 * on terrain it never draws". Its own doc names exactly one structural
 * exception, the `contour`, whose lines are marched from a FIELD rather than
 * looked up per point.
 *
 * The heatmap was a second, undocumented one. `createHeatmapTerrainReader`
 * swept the first mounted `raster` layer's PROVIDER on its own and read the
 * tiles with its own `elevationAt`, so it (a) ignored a caller-supplied
 * ground entirely — a heatmap sat on the datum on a map that had one and no
 * raster layer — and (b) ignored the `raster` layer's own elevation WINDOW,
 * so over a floored sea its relief hugged the unclamped seabed.
 *
 * Both clauses below are ROW comparisons under a tilt, because that is the
 * framing in which an elevation is observable at all: at zero pitch a
 * ground moves depth and no row.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createGlyphMap } from "./widget";
import { glyphMapGlobe } from "./projection";
import type { GlyphMapProvider } from "./provider";
import type { GlyphMapGeoTile } from "./tile";
import type { GlyphMapVectorFeature } from "./vector/types";

const COLS = 120;
const ROWS = 48;
const CENTRE: readonly [number, number] = [8, 47];
const SPAN = 8;
/** Deep enough that the difference is rows and not rounding: 4,000 m at 24x is 96 km of world. */
const GROUND_M = 4000;

const mounted: { destroy(): void }[] = [];
const hosts: HTMLElement[] = [];
afterEach(() => {
  for (const m of mounted.splice(0)) m.destroy();
  for (const h of hosts.splice(0)) h.remove();
});

const point = (lon: number, lat: number): GlyphMapVectorFeature => ({
  geometryType: "point",
  rings: [[[lon, lat]]],
  properties: { weight: 1 },
});

/** Uniform terrain at `elevM`, as the z0-z4 shape `bake-geo-tiles.mjs` produces. */
function terrainProvider(elevM: number): GlyphMapProvider {
  const zooms = [0, 1, 2, 3, 4].map((z) => ({
    z, cols: 2 ** z, rows: 2 ** z, tileLonSpan: 360 / 2 ** z, tileLatSpan: 180 / 2 ** z, tileCols: 32, tileRows: 32,
  }));
  const bounds = (z: number, x: number, y: number) => {
    const level = zooms[z];
    const west = -180 + x * level.tileLonSpan;
    const north = 90 - y * level.tileLatSpan;
    return { west, east: west + level.tileLonSpan, south: north - level.tileLatSpan, north };
  };
  return {
    id: "heatmap-ground-terrain",
    zooms,
    bounds,
    async loadTile(z, x, y): Promise<GlyphMapGeoTile> {
      return { bounds: bounds(z, x, y), cols: 32, rows: 32, elevation: new Float32Array(33 * 33).fill(elevM), source: "heatmap-ground", sampler: "nearest" };
    },
  };
}

async function render(options: {
  groundElevation?: (lon: number, lat: number) => number | null;
  terrain?: GlyphMapProvider;
  window?: { minElevation?: number; maxElevation?: number };
}): Promise<string> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  hosts.push(host);
  const map = createGlyphMap(host, {
    view: { center: [CENTRE[0], CENTRE[1]], span: SPAN, cols: COLS, rows: ROWS },
    projection: glyphMapGlobe({ exaggeration: 24 }),
    tilt: 40,
    groundElevation: options.groundElevation,
    layers: [
      ...(options.terrain ? [{ type: "raster" as const, id: "terrain", source: options.terrain, ...options.window }] : []),
      {
        type: "heatmap" as const,
        id: "heat",
        source: { features: [point(CENTRE[0], CENTRE[1])] },
        bounds: { west: CENTRE[0] - 3, east: CENTRE[0] + 3, south: CENTRE[1] - 3, north: CENTRE[1] + 3 },
        radius: 3,
        weightProperty: "weight",
        height: 20_000,
        colors: ["#111827", "#ef4444"],
      },
    ],
  });
  mounted.push(map);
  for (let i = 0; i < 50; i++) await new Promise((r) => setTimeout(r, 10));
  map.scene.rerender();
  return map.scene.output.textContent ?? "";
}

describe("createGlyphMap — a `heatmap` reads the one ground", () => {
  it("stands on a caller-supplied ground with no raster layer mounted", async () => {
    const datum = await render({});
    // The premise: the layer draws something, so a comparison of two frames
    // is a comparison of two pictures.
    expect(datum.replace(/\s/g, "").length).toBeGreaterThan(100);
    const raised = await render({ groundElevation: () => GROUND_M });
    expect(raised).not.toBe(datum);
  }, 30000);

  it("takes the `raster` layer's own elevation window, like the terrain it sits on", async () => {
    const unwindowed = await render({ terrain: terrainProvider(GROUND_M) });
    expect(unwindowed.replace(/\s/g, "").length).toBeGreaterThan(100);
    // The same terrain with a ceiling BELOW it: the relief the reader is
    // allowed to see is clamped, so the heatmap standing on it has to move.
    const floored = await render({ terrain: terrainProvider(GROUND_M), window: { maxElevation: 0 } });
    expect(floored).not.toBe(unwindowed);
  }, 30000);
});
