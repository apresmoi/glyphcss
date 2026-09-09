import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createGlyphMap } from "./widget";
import { glyphMapMercator } from "./projection";
import { glyphMapBreaks } from "./classify";
import type { GlyphMapGeoTile } from "./tile";
import type { GlyphMapProvider, GlyphMapProviderZoomLevel } from "./provider";
import type { GlyphMapBounds } from "./types";

/**
 * The reported defect, on the cells a reader actually sees.
 *
 * "Terrain is painting land as water" over Buenos Aires: at the reported view
 * the whole city centre — Retiro, Recoleta, Palermo, downtown — was
 * bathymetric blue with a straight edge through it, because the ONE z4 relief
 * quad covering it took its colour from a 3-of-4 vote among its own corners
 * (nw -1, ne -1, sw +12, se -1) instead of from the surface those corners
 * describe, 72% of which is above sea level. 2,756 base cells that
 * OpenStreetMap calls land were painted as water; 1,673 of them visible.
 *
 * `mesh.seaLevelBand.test.ts` and `mesh.surfaceMedian.test.ts` pin the rule
 * itself. This file pins the SYMPTOM, through the real widget on the real
 * ETOPO1 samples the page renders (the vendored `buenosAires` window is baked
 * at the pyramid's own 0.125-degree spacing and is byte-identical to the
 * shipped z4 tile over its extent), because "the statistic changed" and "the
 * city is no longer a river" are two different claims.
 *
 * Both directions are asserted: the city's own quad must be land, and the
 * estuary quad one step north of it — four real -1 m samples, water under
 * every candidate statistic — must stay water. A fix that simply biased the
 * whole ramp upward would pass the first clause and fail the second.
 */

interface FixtureWindow {
  readonly bounds: GlyphMapBounds;
  readonly cols: number;
  readonly rows: number;
  readonly elevation: readonly number[];
  readonly source: string;
  readonly sampler: string;
}

const WINDOW = (
  JSON.parse(readFileSync(path.resolve(__dirname, "../fixtures/sea-level-band.json"), "utf8")) as Record<string, FixtureWindow>
).buenosAires!;

const WATER = "#2a55a8";
const LAND = "#2f5a36";
/** Band 0 below sea level, band 1 at or above it — `GlyphMapClassifiers.etopo1V1`'s own first break. */
const classifier = glyphMapBreaks([0], { id: "sea-level" });

/**
 * The city quad: its south-west corner is the +12 m vertex under downtown and
 * its other three corners are the Rio de la Plata's -1 m.
 */
const CITY_QUAD = { west: -58.375, east: -58.25, south: -34.625, north: -34.5 };
/** One quad north: four -1 m samples, open estuary. */
const ESTUARY_QUAD = { west: -58.375, east: -58.25, south: -34.5, north: -34.375 };

/**
 * A single-level provider whose 2-degree tiles line up with the vendored
 * window, so the one tile in frame carries the real samples and its
 * neighbours are flat estuary. One level means the floor tier IS the target
 * LOD, so no backstop sink is in play and what renders is the surface under
 * test.
 */
const LEVEL: GlyphMapProviderZoomLevel = { z: 0, cols: 180, rows: 90, tileLonSpan: 2, tileLatSpan: 2, tileCols: WINDOW.cols, tileRows: WINDOW.rows };

function boundsOf(x: number, y: number): GlyphMapBounds {
  const west = -180 + x * LEVEL.tileLonSpan;
  const north = 90 - y * LEVEL.tileLatSpan;
  return { west, east: west + LEVEL.tileLonSpan, south: north - LEVEL.tileLatSpan, north };
}

const provider: GlyphMapProvider = {
  id: "buenos-aires-fixture",
  zooms: [LEVEL],
  bounds: (_z, x, y) => boundsOf(x, y),
  loadTile: (_z, x, y): Promise<GlyphMapGeoTile> => {
    const bounds = boundsOf(x, y);
    const real = bounds.west === WINDOW.bounds.west && bounds.north === WINDOW.bounds.north;
    const elevation = real
      ? Float32Array.from(WINDOW.elevation)
      : new Float32Array((LEVEL.tileCols + 1) * (LEVEL.tileRows + 1)).fill(-1);
    return Promise.resolve({ bounds, cols: LEVEL.tileCols, rows: LEVEL.tileRows, elevation, source: WINDOW.source, sampler: WINDOW.sampler });
  },
};

/**
 * Degrees trimmed off every side of a quad before its cells are counted. A
 * cell is a rectangle and a quad edge lands inside one, so the cell centre
 * `unproject` names and the quad that won that cell's depth test disagree
 * along a one-cell band on the boundary (measured: 13 of 455 estuary cells at
 * span 0.5 without the trim). The trim is about which cells the test can
 * attribute, not about what the renderer painted — every cell inside it is
 * unambiguously over one quad.
 */
const QUAD_EDGE_TRIM_DEG = 0.02;

interface Rendered {
  readonly cells: (quad: typeof CITY_QUAD) => { readonly total: number; readonly water: number; readonly land: number };
  readonly teardown: () => void;
}

async function render(span: number, tilt: number): Promise<Rendered> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const cols = 140;
  const rows = 63;
  const map = createGlyphMap(host, {
    view: { center: [-58.365075, -34.608439], span, cols, rows },
    projection: glyphMapMercator({ exaggeration: 24 }),
    tilt,
    layers: [{ type: "raster", id: "terrain", source: provider, classifier, colors: [WATER, LAND] }],
    scene: { mode: "solid", useColors: true },
  });
  for (let i = 0; i < 60; i++) await new Promise((r) => setTimeout(r, 10));
  map.scene.rerender();

  const grid: (string | null)[][] = [[]];
  const walk = (node: Node, color: string | null): void => {
    if (node.nodeType === 3) {
      for (const ch of node.textContent ?? "") {
        if (ch === "\n") grid.push([]);
        else grid[grid.length - 1]!.push(ch === " " ? null : color);
      }
      return;
    }
    const el = node as HTMLElement;
    const own = el.style?.color || color;
    for (const child of Array.from(el.childNodes)) walk(child, own);
  };
  for (const child of Array.from(map.scene.output.childNodes)) walk(child, null);

  return {
    cells: (quad) => {
      let total = 0;
      let water = 0;
      let land = 0;
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const color = grid[row]?.[col] ?? null;
          if (color === null) continue;
          const ll = map.unproject([col + 0.5, row + 0.5]);
          if (!ll) continue;
          if (ll[0] < quad.west + QUAD_EDGE_TRIM_DEG || ll[0] > quad.east - QUAD_EDGE_TRIM_DEG) continue;
          if (ll[1] < quad.south + QUAD_EDGE_TRIM_DEG || ll[1] > quad.north - QUAD_EDGE_TRIM_DEG) continue;
          total++;
          // Lambert shading moves the literal hex, so compare hue family: the
          // land band is green-dominant, the water band blue-dominant.
          const n = Number.parseInt(color.slice(1), 16);
          if (((n >> 8) & 255) >= (n & 255)) land++;
          else water++;
        }
      }
      return { total, water, land };
    },
    teardown: () => { map.destroy(); host.remove(); },
  };
}

describe("createGlyphMap — relief colour follows the surface a quad draws", () => {
  it("paints the city quad as land at the reported view, where it is one source cell", async () => {
    const r = await render(0.0649, 40);
    try {
      const city = r.cells(CITY_QUAD);
      expect(city.total).toBeGreaterThan(300);
      expect(`${city.water} of ${city.total} cells over downtown Buenos Aires painted as water`)
        .toBe(`0 of ${city.total} cells over downtown Buenos Aires painted as water`);
    } finally {
      r.teardown();
    }
  }, 20000);

  it("still paints the estuary quad beside it as water", async () => {
    const r = await render(0.5, 0);
    try {
      const estuary = r.cells(ESTUARY_QUAD);
      const city = r.cells(CITY_QUAD);
      expect(estuary.total).toBeGreaterThan(50);
      expect(city.total).toBeGreaterThan(50);
      expect(`estuary: ${estuary.land} land of ${estuary.total}; city: ${city.water} water of ${city.total}`)
        .toBe(`estuary: 0 land of ${estuary.total}; city: 0 water of ${city.total}`);
    } finally {
      r.teardown();
    }
  }, 20000);
});
