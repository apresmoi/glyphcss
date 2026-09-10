import { afterEach, describe, expect, it, vi } from "vitest";
import { createGlyphMap } from "./widget";
import { glyphMapGlobe } from "./projection";
import type { GlyphMapProvider, GlyphMapProviderZoomLevel } from "./provider";
import type { GlyphMapGeoTile } from "./tile";

/**
 * Regression for a real defect: a provider-backed `contour` layer resolved
 * its elevation field from exactly ONE tile — the tile containing
 * `view.center` — so it could only ever ink that tile's own geographic box.
 * Every other cell unprojected to a lon/lat outside that box, sampled NaN
 * (`glyphMapFieldValueAt` returns NaN outside `field.bounds`), and was
 * skipped with no error.
 *
 * The visible symptom depends ENTIRELY on which zoom level the view happens
 * to resolve to, which is why it read as a different shape to different
 * people and went unnoticed at the coarsest view: a z0 tile IS the whole
 * world (the bug is invisible), a z1 tile is a HEMISPHERE, a z2 tile is a
 * QUADRANT, a z3 tile an eighth. `view.center` `[0, 0]` sits exactly on a
 * tile corner at every z >= 1 (`Math.floor` anchors the single tile at the
 * view's NW corner), so the resolved field lay wholly east and south of the
 * screen centre.
 *
 * These tests therefore sweep FOUR zoom levels rather than only the default
 * view — a test that exercised one view is exactly what let this ship.
 */

const TILE_CELLS = 90;

function levelsFor(maxZ: number): GlyphMapProviderZoomLevel[] {
  return Array.from({ length: maxZ + 1 }, (_, z) => ({
    z,
    cols: 2 ** z,
    rows: 2 ** z,
    tileLonSpan: 360 / 2 ** z,
    tileLatSpan: 180 / 2 ** z,
    tileCols: TILE_CELLS,
    tileRows: TILE_CELLS,
  }));
}

/**
 * Elevation with zero crossings every 30 degrees of longitude AND latitude,
 * so a `levels: [0]` contour has real crossings EVERYWHERE on the globe —
 * an under-covered mosaic can never pass by the field happening to be flat
 * outside the one tile it resolved.
 */
function elevAt(lon: number, lat: number): number {
  return 1000 * Math.sin((lon * Math.PI) / 30) * Math.cos((lat * Math.PI) / 30);
}

function makeProvider(maxZ = 3): GlyphMapProvider & { loadTile: ReturnType<typeof vi.fn> } {
  const zooms = levelsFor(maxZ);
  const bounds = (z: number, x: number, y: number) => {
    const level = zooms[z];
    const west = -180 + x * level.tileLonSpan;
    const north = 90 - y * level.tileLatSpan;
    return { west, east: west + level.tileLonSpan, south: north - level.tileLatSpan, north };
  };
  const loadTile = vi.fn(async (z: number, x: number, y: number): Promise<GlyphMapGeoTile> => {
    const b = bounds(z, x, y);
    const cols = 24, rows = 24;
    const elevation = new Float32Array((cols + 1) * (rows + 1));
    for (let r = 0; r <= rows; r++) {
      for (let c = 0; c <= cols; c++) {
        const lon = b.west + (b.east - b.west) * (c / cols);
        const lat = b.north - (b.north - b.south) * (r / rows);
        elevation[r * (cols + 1) + c] = elevAt(lon, lat);
      }
    }
    return { bounds: b, cols, rows, elevation, source: "contour-mosaic-test", sampler: "nearest" };
  });
  return { id: "contour-mosaic-test", zooms, bounds, loadTile };
}

/**
 * Cells the contour layer actually changed — the render WITHOUT the layer
 * differenced against the render WITH it. A per-cell diff rather than a
 * glyph-set membership count: it can never mistake a terrain ramp glyph
 * that happens to collide with the oriented-ink set for contour ink.
 */
function inkedCells(before: string, after: string, cols: number, rows: number): { col: number; row: number }[] {
  const a = before.split("\n");
  const b = after.split("\n");
  const out: { col: number; row: number }[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if ((a[row]?.[col] ?? " ") !== (b[row]?.[col] ?? " ")) out.push({ col, row });
    }
  }
  return out;
}

async function measure(span: number, cols: number, rows: number, maxZ = 3) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const map = createGlyphMap(host, {
    view: { center: [0, 0], span, cols, rows },
    projection: glyphMapGlobe(),
  });
  map.scene.rerender();
  const before = map.scene.output.textContent ?? "";
  const provider = makeProvider(maxZ);
  map.addLayer({ type: "contour", id: "contours", source: provider, levels: [0], color: "#00aaff" });
  await vi.waitFor(() => expect(provider.loadTile).toHaveBeenCalled(), { timeout: 2000 });
  await new Promise((r) => setTimeout(r, 60));
  map.scene.rerender();
  const after = map.scene.output.textContent ?? "";
  const cells = inkedCells(before, after, cols, rows);
  const tiles = provider.loadTile.mock.calls.map(([z, x, y]) => ({ z, x, y }));
  map.destroy();
  host.remove();
  return { cells, tiles, cols, rows };
}

/** Ink count strictly inside one screen quadrant, excluding the centre row/column so a single tile's edge can never satisfy two quadrants at once. */
function quadrant(cells: { col: number; row: number }[], cols: number, rows: number, west: boolean, north: boolean): number {
  const cc = cols / 2;
  const rc = rows / 2;
  return cells.filter((c) => (west ? c.col < cc - 1 : c.col > cc + 1) && (north ? c.row < rc - 1 : c.row > rc + 1)).length;
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("createGlyphMap — a provider-backed contour layer holds a TILE MOSAIC, not one tile", () => {
  // z0's single tile IS the whole world, so this level alone cannot detect
  // the defect — it is here to prove the fix does not regress the one view
  // that always worked.
  const cases = [
    { label: "z0 (one world tile — the view the defect was invisible at)", span: 360, cols: 90, rows: 36, z: 0 },
    { label: "z1 (a tile is a hemisphere)", span: 140, cols: 50, rows: 20, z: 1 },
    { label: "z2 (a tile is a quadrant)", span: 140, cols: 90, rows: 36, z: 2 },
    { label: "z3 (a tile is an eighth)", span: 140, cols: 160, rows: 64, z: 3 },
  ] as const;

  for (const { label, span, cols, rows, z } of cases) {
    it(`inks all four screen quadrants at ${label}`, async () => {
      const { cells, tiles } = await measure(span, cols, rows);
      expect(tiles.every((t) => t.z === z)).toBe(true);

      const nw = quadrant(cells, cols, rows, true, true);
      const ne = quadrant(cells, cols, rows, false, true);
      const sw = quadrant(cells, cols, rows, true, false);
      const se = quadrant(cells, cols, rows, false, false);
      // The single-tile defect put EVERY inked cell in exactly one quadrant
      // (SE, for `view.center` [0, 0]) and left the other three at zero.
      expect({ nw, ne, sw, se }).toEqual({
        nw: expect.any(Number), ne: expect.any(Number), sw: expect.any(Number), se: expect.any(Number),
      });
      expect(nw).toBeGreaterThan(0);
      expect(ne).toBeGreaterThan(0);
      expect(sw).toBeGreaterThan(0);
      expect(se).toBeGreaterThan(0);
    });
  }

  it("fetches every tile the view covers at z2, not just the one containing view.center", async () => {
    const { tiles } = await measure(140, 90, 36);
    const keys = new Set(tiles.map((t) => `${t.z}/${t.x}_${t.y}`));
    // z2 addressing: tileLonSpan 90, tileLatSpan 45. `view.center` [0, 0] is
    // the NW corner of tile (2, 2); the visible disc reaches west of the
    // prime meridian and north of the equator, so tiles (1, 1)/(2, 1)/(1, 2)
    // are all genuinely on screen. The defect fetched ONLY (2, 2).
    expect(keys.has("2/2_2")).toBe(true);
    expect(keys.has("2/1_1")).toBe(true);
    expect(keys.has("2/2_1")).toBe(true);
    expect(keys.has("2/1_2")).toBe(true);
  });

  it("drops tiles that leave the view and picks up the new ones after a pan across the globe", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const map = createGlyphMap(host, {
      view: { center: [0, 0], span: 140, cols: 90, rows: 36 },
      projection: glyphMapGlobe(),
    });
    map.scene.rerender();
    const blank = map.scene.output.textContent ?? "";
    const provider = makeProvider();
    map.addLayer({ type: "contour", id: "contours", source: provider, levels: [0], color: "#00aaff" });
    await vi.waitFor(() => expect(provider.loadTile).toHaveBeenCalled(), { timeout: 2000 });
    await new Promise((r) => setTimeout(r, 60));
    map.scene.rerender();
    const atGreenwich = map.scene.output.textContent ?? "";

    map.setView({ center: [150, -40] });
    await new Promise((r) => setTimeout(r, 300));
    await vi.waitFor(() => {
      const keys = new Set(provider.loadTile.mock.calls.map(([z, x, y]) => `${z}/${x}_${y}`));
      // Tiles around lon 150 / lat -40 at z2 (tileLonSpan 90, tileLatSpan 45).
      expect(keys.has("2/3_2")).toBe(true);
      expect(keys.has("2/3_3")).toBe(true);
    }, { timeout: 2000 });
    map.scene.rerender();
    const atPacific = map.scene.output.textContent ?? "";

    // Both views ink, and they ink DIFFERENTLY — the mosaic followed the pan
    // rather than freezing on whatever it first resolved.
    expect(atGreenwich).not.toBe(blank);
    expect(atPacific).not.toBe(blank);
    expect(atPacific).not.toBe(atGreenwich);

    const cells = inkedCells(blank, atPacific, 90, 36);
    expect(quadrant(cells, 90, 36, true, true)).toBeGreaterThan(0);
    expect(quadrant(cells, 90, 36, false, false)).toBeGreaterThan(0);

    map.destroy();
    host.remove();
  });
});
