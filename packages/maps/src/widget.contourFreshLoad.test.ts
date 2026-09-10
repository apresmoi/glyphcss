/**
 * A `contour` recovers from a first sweep that could not answer — the
 * reported *"I need to disable it and enable it for it to load after I
 * refresh the page"*.
 *
 * THE ORDER IS THE DEFECT, so it is the order these tests reproduce. A
 * contour's mosaic is fetched by its own sweep, and that sweep runs at MOUNT
 * and then only from `scheduleTileUpdate`, which is driven by the VIEW. On a
 * page opened straight from a URL with the layer on, and not touched, the
 * mount-time sweep is therefore the ONLY sweep that will ever run — it races
 * the first terrain tiles, and whatever it resolved (nothing, a partial set)
 * stays the layer's answer for the life of the map. Since `3924f61` the cut
 * geometry is cached on that mosaic, so "nothing resolved" is a cached
 * nothing. Toggling the layer builds a fresh runtime and sweeps again, which
 * is exactly the workaround the report describes.
 *
 * Two independent halves, one per test, each red on its own hunk:
 *
 * 1. ONE FAILED TILE MUST NOT TAKE THE MOSAIC WITH IT. The sweep awaited a
 *    `Promise.all` over every missing tile, so a single 404 or abort — which
 *    is exactly what a fresh page load can produce and a later toggle,
 *    served from a warm cache, cannot — rejected the whole batch and left
 *    `mosaic` unassigned. The vector sweep already states this rule ("a tile
 *    that 404s/times out resolves EMPTY, never rejects; one rejection would
 *    take down the frame's whole `Promise.all`"); the contour needed it more,
 *    because its mosaic is not re-derived per frame.
 * 2. A SWEEP THAT RESOLVED NOTHING MUST BE RETRIED WHEN TERRAIN LANDS. The
 *    contour now registers in `groundChangeSyncs` — the registry whose event
 *    is the mounted raster TILE SET rather than the camera, and the same
 *    second chance the markers and the planted extrusions take.
 *
 * A test that mounted the tiles first would pass on the broken tree and
 * prove nothing, so both tests here mount the layers in ONE turn with every
 * tile still in flight.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createGlyphMap } from "./widget";
import { glyphMapGlobe } from "./projection";
import { glyphMapBreaks } from "./classify";
import type { GlyphMapGeoTile } from "./tile";
import type { GlyphMapProvider, GlyphMapProviderZoomLevel } from "./provider";
import type { GlyphMapBounds } from "./types";

const COLS = 160;
const ROWS = 64;
const CONTOUR_COLOR = "#ff00ff";
const TERRAIN_COLORS = ["#123456", "#2f5a36", "#8a7a55"];
/** A pure north-south ramp: every level's isoline is a parallel, so several cross any view. */
const elevationAt = (lat: number): number => (lat + 90) * 100;

function tileBounds(level: GlyphMapProviderZoomLevel, x: number, y: number): GlyphMapBounds {
  const west = -180 + x * level.tileLonSpan;
  const north = 90 - y * level.tileLatSpan;
  return { west, east: west + level.tileLonSpan, south: north - level.tileLatSpan, north };
}

/**
 * `failFirst` tiles reject before any succeed — a transient fetch failure on
 * the first sweep, and nothing else. `delayMs` keeps every load in flight
 * across the turn the layers are added in.
 */
function makeProvider(id: string, failFirst = 0, delayMs = 60): GlyphMapProvider {
  const zooms: GlyphMapProviderZoomLevel[] = [];
  for (let z = 0; z <= 4; z++) {
    const n = 2 ** z;
    zooms.push({ z, cols: n, rows: n, tileLonSpan: 360 / n, tileLatSpan: 180 / n, tileCols: 90, tileRows: 45 });
  }
  let attempts = 0;
  return {
    id,
    zooms,
    bounds: (z, x, y) => tileBounds(zooms[z]!, x, y),
    loadTile: (z, x, y): Promise<GlyphMapGeoTile> => {
      attempts++;
      if (attempts <= failFirst) return Promise.reject(new Error("transient tile failure"));
      const level = zooms[z]!;
      const bounds = tileBounds(level, x, y);
      const elevation = new Float32Array((level.tileCols + 1) * (level.tileRows + 1));
      const dLat = level.tileLatSpan / level.tileRows;
      for (let row = 0; row <= level.tileRows; row++) {
        for (let col = 0; col <= level.tileCols; col++) {
          elevation[row * (level.tileCols + 1) + col] = elevationAt(bounds.north - row * dLat);
        }
      }
      return new Promise((resolve) => setTimeout(() => resolve({ bounds, cols: level.tileCols, rows: level.tileRows, elevation, source: "ramp", sampler: "nearest" }), delayMs));
    },
  };
}

const mounted: { destroy(): void }[] = [];
const hosts: HTMLElement[] = [];
afterEach(() => {
  for (const m of mounted.splice(0)) m.destroy();
  for (const h of hosts.splice(0)) h.remove();
});

/** Cells painted in the contour's own colour, and cells painted at all. */
function readCells(map: ReturnType<typeof createGlyphMap>): { contour: number; inked: number } {
  let contour = 0;
  let inked = 0;
  const walk = (node: Node, color: string | null): void => {
    if (node.nodeType === 3) {
      for (const ch of node.textContent ?? "") {
        if (ch === "\n" || ch === " ") continue;
        inked++;
        if (color === CONTOUR_COLOR) contour++;
      }
      return;
    }
    const el = node as HTMLElement;
    const own = el.style?.color || color;
    for (const child of Array.from(el.childNodes)) walk(child, own);
  };
  for (const child of Array.from(map.scene.output.childNodes)) walk(child, null);
  return { contour, inked };
}

/**
 * The `/maps` fresh-load shape: a raster layer and a contour layer over the
 * same terrain, both added in ONE turn with every tile still in flight, and
 * no gesture afterwards — so `scheduleTileUpdate` never runs.
 */
async function freshLoad(contourProvider: GlyphMapProvider, withTerrain = true): Promise<ReturnType<typeof createGlyphMap>> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  hosts.push(host);
  const terrain = makeProvider("terrain");
  const map = createGlyphMap(host, {
    view: { center: [8, 46], span: 20, cols: COLS, rows: ROWS },
    projection: glyphMapGlobe({ exaggeration: 24 }),
    layers: [
      ...(withTerrain ? [{ type: "raster" as const, id: "terrain", source: terrain, classifier: glyphMapBreaks([12000, 14000], { id: "ramp" }), colors: TERRAIN_COLORS }] : []),
      { type: "contour" as const, id: "contour", source: contourProvider, levels: { interval: 1000 }, color: CONTOUR_COLOR },
    ],
  });
  mounted.push(map);
  // The whole point of this file is a chain the widget drives itself — the
  // mount sweep, its failures, and the re-sweep the landing terrain
  // provokes — so the wait has to be the widget's own account of being done
  // with it, not 800 ms of hoping.
  await map.idle();
  map.scene.rerender();
  return map;
}

describe("createGlyphMap — a contour recovers from a first sweep that could not answer", () => {
  it("keeps its mosaic when one tile of the first sweep fails", async () => {
    // NO raster layer, deliberately: this half is about the sweep's own
    // failure handling, and with terrain mounted the second half's re-sweep
    // would rescue it and the two hunks could not be told apart.
    const map = await freshLoad(makeProvider("contour-one-failure", 1), false);
    expect(map.getContourFieldRange("contour")).not.toBeNull();
    expect(readCells(map).contour).toBeGreaterThan(0);
  }, 30000);

  it("re-sweeps when the terrain lands, after a first sweep that resolved nothing", async () => {
    // EVERY tile of the first sweep fails, so the mount-time sweep resolves
    // an empty mosaic — the state the report describes. Nothing but a
    // terrain tile arriving can rescue it: the view never changes.
    const map = await freshLoad(makeProvider("contour-all-failed", 8));
    const cells = readCells(map);
    expect(cells.inked).toBeGreaterThan(2000);
    expect(map.getContourFieldRange("contour")).not.toBeNull();
    expect(cells.contour).toBeGreaterThan(0);
  }, 30000);
});
