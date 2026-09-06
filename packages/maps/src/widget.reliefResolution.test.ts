import { describe, expect, it } from "vitest";
import { createGlyphMap } from "./widget";
import { glyphMapGlobe } from "./projection";
import { glyphMapDegreesPerCell } from "./provider";
import type { GlyphMapGeoTile } from "./tile";
import type { GlyphMapProvider, GlyphMapProviderZoomLevel } from "./provider";
import type { GlyphMapBounds } from "./types";

/**
 * Relief-mesh resolution (AGENTS.md's "Mesh resolution"): the baked pyramid
 * ships ONE tile shape (180x90 quads at every zoom, `website/public/data/
 * geo-tiles/manifest.json`) regardless of how much output grid a tile
 * actually covers, so a settled view mounted ~15 tiles x 16,200 quads =
 * ~243,000 quads to fill a 160x64 = 10,240-cell grid. These pin the two
 * rules that fixed it and the two invariants that keep it correct:
 *
 * - a tier is never built COARSER than one quad per glyph cell (except the
 *   floor, which is explicitly a glimpse-only backstop when it is not the
 *   target LOD);
 * - every tile of one pyramid level is built at the SAME resolution, which
 *   is what keeps sibling tiles' shared edges exactly shared (`mesh.test
 *   .ts`'s own seam assertions prove the mesh-level half of that).
 */

function tileBounds(level: GlyphMapProviderZoomLevel, x: number, y: number): GlyphMapBounds {
  const lonMin = -180 + x * level.tileLonSpan;
  const latMax = 90 - y * level.tileLatSpan;
  return { west: lonMin, east: lonMin + level.tileLonSpan, south: latMax - level.tileLatSpan, north: latMax };
}

/** The real ETOPO1 pyramid's shape: z0..z4, 180x90 quads at every level. */
function makeProvider(maxZ = 4): GlyphMapProvider {
  const zooms: GlyphMapProviderZoomLevel[] = [];
  for (let z = 0; z <= maxZ; z++) {
    const n = 2 ** z;
    zooms.push({ z, cols: n, rows: n, tileLonSpan: 360 / n, tileLatSpan: 180 / n, tileCols: 180, tileRows: 90 });
  }
  return {
    id: "pyramid-180x90",
    zooms,
    bounds: (z, x, y) => tileBounds(zooms[z], x, y),
    loadTile: (z, x, y): Promise<GlyphMapGeoTile> => {
      const bounds = tileBounds(zooms[z], x, y);
      const elevation = new Float32Array(181 * 91);
      for (let i = 0; i < elevation.length; i++) elevation[i] = 100 + (i % 37) * 5;
      return Promise.resolve({ bounds, cols: 180, rows: 90, elevation, source: "synthetic", sampler: "nearest" });
    },
  };
}

/** Mounts a raster layer and returns every live mesh's polygon count. */
async function mountedQuadCounts(span: number, center: [number, number] = [8, 46]): Promise<{ counts: number[]; degPerCell: number; teardown: () => void }> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const map = createGlyphMap(host, {
    view: { center, span, cols: 160, rows: 64 },
    projection: glyphMapGlobe({ exaggeration: 20 }),
    maxSpan: 720,
    layers: [],
  });
  const live = new Map<object, number>();
  const realAdd = map.scene.add.bind(map.scene);
  (map.scene as { add: typeof realAdd }).add = (polygons, transform) => {
    const handle = realAdd(polygons, transform);
    live.set(handle, polygons.length);
    const realDispose = handle.dispose.bind(handle);
    (handle as { dispose: () => void }).dispose = () => { live.delete(handle); realDispose(); };
    return handle;
  };
  map.addLayer({ type: "raster", id: "terrain", source: makeProvider() });
  for (let i = 0; i < 40; i++) await new Promise((r) => setTimeout(r, 10));
  return {
    counts: [...live.values()].sort((a, b) => a - b),
    degPerCell: glyphMapDegreesPerCell(map.getView()),
    teardown: () => { map.destroy(); host.remove(); },
  };
}

describe("createGlyphMap — relief mesh resolution", () => {
  it("mounts far fewer quads than the baked tile grid, while every tile of the target level shares ONE resolution", async () => {
    const { counts, teardown } = await mountedQuadCounts(140, [0, 20]);
    expect(counts.length).toBeGreaterThan(1);
    // The permanent floor is the single capped mesh; every other mounted
    // mesh belongs to the target level and must agree with its siblings —
    // two resolutions at one level is exactly the T-junction crack
    // `mesh.test.ts`'s "MISMATCHED resolutions" case demonstrates.
    const fine = counts.slice(1);
    expect(new Set(fine).size).toBe(1);
    expect(fine[0]).toBeLessThan(180 * 90);
    // And the whole scene is well under the pre-change 15 x 16,200.
    const total = counts.reduce((a, b) => a + b, 0);
    expect(total).toBeLessThan(0.5 * counts.length * 180 * 90);
    teardown();
  }, 30000);

  it("never builds the target level coarser than one quad per glyph cell", async () => {
    for (const span of [140, 30, 8]) {
      const { counts, degPerCell, teardown } = await mountedQuadCounts(span);
      const fine = counts[counts.length - 1];
      // The level `glyphMapTargetLOD` picks has degPerQuad <= degPerCell, so
      // its own tile spans at least this many cells; the mesh must keep at
      // least that many quads.
      const level = makeProvider().zooms.find((z) => z.tileLonSpan / z.tileCols <= degPerCell) ?? makeProvider().zooms[4];
      // Capped by the tile's own baked grid: at a span finer than the
      // pyramid's deepest level, `glyphMapPolygons` never upsamples, so
      // "full resolution" is the most that can be asked for.
      const needed = Math.min(level.tileCols * level.tileRows, Math.floor((level.tileLonSpan / degPerCell) * (level.tileLatSpan / degPerCell)));
      expect(fine).toBeGreaterThanOrEqual(needed);
      teardown();
    }
  }, 60000);

  it("caps the permanent floor to a glimpse-only backstop while it is hidden, but not while it IS the target LOD", async () => {
    // Deep enough that z0 is nowhere near the target level: the floor is
    // pure never-black insurance and gets the backstop cap.
    const deep = await mountedQuadCounts(4);
    expect(deep.counts[0]).toBeLessThanOrEqual(32 * 16);
    deep.teardown();

    // Zoomed out past the pyramid's own shallowest level: z0 IS the surface,
    // so the cap must not apply and it renders at full one-quad-per-cell
    // resolution like any other tier.
    const out = await mountedQuadCounts(720, [0, 0]);
    expect(out.counts[out.counts.length - 1]).toBeGreaterThan(32 * 16);
    out.teardown();
  }, 60000);

  it("rebuilds already-mounted tiles when a zoom changes the level's resolution — a level must never hold two resolutions at once", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const map = createGlyphMap(host, {
      view: { center: [0, 20], span: 140, cols: 160, rows: 64 },
      projection: glyphMapGlobe({ exaggeration: 20 }),
      maxSpan: 720,
      layers: [],
    });
    const live = new Map<object, number>();
    const realAdd = map.scene.add.bind(map.scene);
    (map.scene as { add: typeof realAdd }).add = (polygons, transform) => {
      const handle = realAdd(polygons, transform);
      live.set(handle, polygons.length);
      const realDispose = handle.dispose.bind(handle);
      (handle as { dispose: () => void }).dispose = () => { live.delete(handle); realDispose(); };
      return handle;
    };
    map.addLayer({ type: "raster", id: "terrain", source: makeProvider() });
    for (let i = 0; i < 40; i++) await new Promise((r) => setTimeout(r, 10));
    const before = [...live.values()].sort((a, b) => a - b);
    expect(new Set(before.slice(1)).size).toBe(1);

    // Both spans select the SAME level (z2 covers degPerCell in [0.5, 1)),
    // so the tile SET barely changes and most tiles stay mounted — but the
    // resolution rung does change. Without a rebuild of the already-mounted
    // tiles, the level would end up holding the old resolution next to the
    // new one, and crack along every seam between them.
    map.setView({ span: 90 });
    for (let i = 0; i < 40; i++) await new Promise((r) => setTimeout(r, 10));
    const after = [...live.values()].sort((a, b) => a - b);
    expect(new Set(after.slice(1)).size).toBe(1);
    expect(after[after.length - 1]).not.toBe(before[before.length - 1]);
    map.destroy();
    host.remove();
  }, 60000);

  it("a static (non-provider) tile source still mounts at the tile's own full resolution", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const map = createGlyphMap(host, {
      view: { center: [0, 0], span: 40, cols: 160, rows: 64 },
      projection: glyphMapGlobe(),
      layers: [],
    });
    const counts: number[] = [];
    const realAdd = map.scene.add.bind(map.scene);
    (map.scene as { add: typeof realAdd }).add = (polygons, transform) => { counts.push(polygons.length); return realAdd(polygons, transform); };
    const elevation = new Float32Array(21 * 11).fill(50);
    map.addLayer({
      type: "raster",
      id: "static",
      source: { bounds: { west: -10, east: 10, south: -5, north: 5 }, cols: 20, rows: 10, elevation, source: "synthetic", sampler: "nearest" },
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(counts).toEqual([20 * 10]);
    map.destroy();
    host.remove();
  }, 30000);
});
