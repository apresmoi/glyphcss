/**
 * Companion to `widget.farSideStroke.test.ts`, for the MESH-backed vector
 * layers: `fill` and `fill-extrusion`.
 *
 * The stroke defect was "the stamp never consulted `projection.visible`".
 * These layers are a different mechanism with the same symptom, and it splits
 * in two:
 *
 * 1. **Caps.** A cap face's outward normal is the surface's own radial
 *    direction, so the rasterizer's backface cull removes the far hemisphere
 *    for free — PROVIDED the face is small enough that its flat chord plane
 *    really is the local surface. `glyphMapVectorPolygons` triangulates in
 *    lon/lat with earcut, which happily connects boundary vertices tens of
 *    degrees apart, and such a face's normal can point straight INTO the
 *    sphere (measured on the real baked pyramid: plane distance -1.000, i.e.
 *    tangent at the antipode). `layers.globe.test.ts` pins the geometry; this
 *    file pins that the resulting picture has no far-side ink in it.
 * 2. **Walls.** An extrusion wall is a vertical curtain: its normal is
 *    TANGENTIAL, never radial, so no amount of correct winding makes a
 *    far-hemisphere wall back-facing — half of them genuinely face the camera
 *    through the globe (measured: 14 of 29 wall faces on a far-side box).
 *    Only `projection.visible` can answer that, which is why
 *    `glyphMapVectorPolygons` takes a `visible` predicate and the widget
 *    supplies one. Measured leak before the fix: 46 cells with no terrain
 *    mounted, 18 with a full-globe terrain layer (the terrain's own opaque
 *    shell wins the depth test everywhere it actually covers, which is why
 *    the no-terrain case is the larger of the two and both are asserted).
 *
 * A far-side point mirrors onto the SAME COLUMN as its near-side twin
 * (`sin(180 - L) === sin(L)`), so no column window can separate the two — the
 * assertions here are therefore whole-grid "changed nothing at all" diffs
 * against a baseline render, exactly as the stroke file's are.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGlyphMap } from "./widget";
import { glyphMapEquirectangular, glyphMapGlobe } from "./projection";
import type { GlyphMapProvider } from "./provider";
import type { GlyphMapGeoTile } from "./tile";
import type { GlyphMapVectorFeature } from "./vector/types";

const COLS = 120;
const ROWS = 48;
/** ~6% of the globe's radius: a visible skirt that still cannot poke past the limb from 20+ degrees behind it. */
const WALL_HEIGHT_M = 400_000;

function makeTerrain(): GlyphMapProvider & { loadTile: ReturnType<typeof vi.fn> } {
  const zooms = [0, 1].map((z) => ({
    z, cols: 2 ** z, rows: 2 ** z,
    tileLonSpan: 360 / 2 ** z, tileLatSpan: 180 / 2 ** z, tileCols: 32, tileRows: 32,
  }));
  const bounds = (z: number, x: number, y: number) => {
    const level = zooms[z];
    const west = -180 + x * level.tileLonSpan;
    const north = 90 - y * level.tileLatSpan;
    return { west, east: west + level.tileLonSpan, south: north - level.tileLatSpan, north };
  };
  const loadTile = vi.fn(async (z: number, x: number, y: number): Promise<GlyphMapGeoTile> => ({
    bounds: bounds(z, x, y), cols: 32, rows: 32,
    elevation: new Float32Array(33 * 33), source: "far-side-fill-test", sampler: "nearest",
  }));
  return { id: "far-side-fill-test", zooms, bounds, loadTile };
}

/** Every output grid the scene owns — a mesh layer can pop into its own `<pre>`, so `scene.output` alone would not see it. */
function grids(host: HTMLElement): string[] {
  return Array.from(host.querySelectorAll("pre")).map((pre) => pre.textContent ?? "");
}

function changedCells(before: readonly string[], after: readonly string[]): { grid: number; col: number; row: number }[] {
  const out: { grid: number; col: number; row: number }[] = [];
  for (let g = 0; g < Math.max(before.length, after.length); g++) {
    const a = (before[g] ?? "").split("\n");
    const b = (after[g] ?? "").split("\n");
    for (let row = 0; row < Math.max(a.length, b.length); row++) {
      const ar = a[row] ?? "", br = b[row] ?? "";
      for (let col = 0; col < Math.max(ar.length, br.length); col++) {
        if ((ar[col] ?? " ") !== (br[col] ?? " ")) out.push({ grid: g, col, row });
      }
    }
  }
  return out;
}

function inkedCells(gridList: readonly string[]): number {
  return gridList.reduce((n, grid) => n + [...grid].filter((c) => c !== " " && c !== "\n").length, 0);
}

function ring(west: number, east: number, south: number, north: number, step = 5): [number, number][] {
  const out: [number, number][] = [];
  for (let lon = west; lon <= east; lon += step) out.push([lon, south]);
  for (let lat = south + step; lat <= north; lat += step) out.push([east, lat]);
  for (let lon = east - step; lon >= west; lon -= step) out.push([lon, north]);
  for (let lat = north - step; lat >= south; lat -= step) out.push([west, lat]);
  out.push([west, south]);
  return out;
}

function feature(rings: [number, number][][], properties?: Record<string, unknown>): GlyphMapVectorFeature {
  return { geometryType: "polygon", properties, rings, polygons: [rings] };
}

async function mount(withTerrain: boolean, projection = glyphMapGlobe()) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const map = createGlyphMap(host, {
    view: { center: [0, 0], span: 170, cols: COLS, rows: ROWS },
    projection,
  });
  if (withTerrain) {
    const terrain = makeTerrain();
    map.addLayer({ type: "raster", id: "terrain", source: terrain });
    await vi.waitFor(() => expect(terrain.loadTile).toHaveBeenCalled(), { timeout: 2000 });
    await new Promise((r) => setTimeout(r, 80));
  }
  map.scene.rerender();
  return { host, map, before: grids(host) };
}

/** `addLayer` for a static source rebuilds synchronously, but the widget still schedules its own repaint. */
async function settle(): Promise<void> {
  await new Promise((r) => setTimeout(r, 30));
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

// The camera is centred on lon 0, so `|lon| <= 90` is exactly the near
// hemisphere at every latitude (`cameraForCenter(0, 0)` => `rotX: 90,
// rotY: 0`, whose depth functional reduces to world X = cos(lat)cos(lon)).
// Every point of 100..260 x -50..50 is on the far side; its nearest corner
// (lon 100, lat +-50) sits 6.4 degrees behind the limb, which is LESS than one
// refined face's own ~13-degree span — so this fixture also pins that the
// sliver guard, not just the face size, is what makes the cull exact.
const FAR = () => ring(100, 260, -50, 50);
/**
 * The same thing for an EXTRUSION, pushed further round. A wall has height,
 * and height buys horizon reach: a point at `h` over a sphere of radius `r`
 * clears the limb for `acos(r / (r + h))` of extra arc — 20.4 degrees at this
 * file's 400 km {@link WALL_HEIGHT_M} — so {@link FAR}'s nearest corner, only
 * 6.4 degrees behind the limb, has its TOP ring genuinely in view and inks a
 * wall band on purpose (that is what `widget.extrusionHorizon.test.ts` pins).
 * `FAR`'s tight corner is calibrated for the CAP question this file's `fill`
 * cases ask (a 6.4-degree margin is narrower than one refined face's own
 * ~13-degree span, so it pins the sliver guard); the wall question needs a
 * ring behind the horizon, not merely behind the limb. Nearest corner here
 * (lon 130, lat 35) is 121.8 degrees of arc from the view centre, 11.4
 * degrees clear of the 110.4-degree reach of a 400 km top ring.
 */
const FAR_EXTRUSION = () => ring(130, 230, -35, 35);
const NEAR = () => ring(-60, 60, -35, 35);

describe("createGlyphMap — far-hemisphere fill geometry never inks the near side", () => {
  for (const withTerrain of [true, false]) {
    it(`a fill layer leaves ZERO ink (terrain ${withTerrain ? "mounted" : "absent"})`, async () => {
      const { host, map, before } = await mount(withTerrain);
      map.addLayer({ type: "fill", id: "far", source: { features: [feature([FAR()])] }, color: "#ff0000" });
      await settle();
      map.scene.rerender();
      expect(changedCells(before, grids(host))).toEqual([]);
      map.destroy();
      host.remove();
    });

    it(`a fill-extrusion layer leaves ZERO ink (terrain ${withTerrain ? "mounted" : "absent"})`, async () => {
      const { host, map, before } = await mount(withTerrain);
      map.addLayer({
        type: "fill-extrusion", id: "far", color: "#ff0000",
        source: { features: [feature([FAR_EXTRUSION()], { height: WALL_HEIGHT_M })] },
        heightProperty: "height",
      });
      await settle();
      map.scene.rerender();
      expect(changedCells(before, grids(host))).toEqual([]);
      map.destroy();
      host.remove();
    });
  }

  it("still draws a NEAR-hemisphere fill (the far-side gate is not a dead layer)", async () => {
    const { host, map, before } = await mount(false);
    map.addLayer({ type: "fill", id: "near", source: { features: [feature([NEAR()])] }, color: "#00ff00" });
    await settle();
    map.scene.rerender();
    expect(changedCells(before, grids(host)).length).toBeGreaterThan(400);
    map.destroy();
    host.remove();
  });

  it("still draws a NEAR-hemisphere fill-extrusion", async () => {
    const { host, map, before } = await mount(false);
    map.addLayer({
      type: "fill-extrusion", id: "near", color: "#00ff00",
      source: { features: [feature([NEAR()], { height: WALL_HEIGHT_M })] },
      heightProperty: "height",
    });
    await settle();
    map.scene.rerender();
    expect(changedCells(before, grids(host)).length).toBeGreaterThan(400);
    map.destroy();
    host.remove();
  });

  it("re-culls after the camera turns, so geometry that BECOMES far-side stops inking", async () => {
    // A static (non-provider) source has nothing to re-fetch, so nothing used
    // to rebuild its mesh on a view change at all — a wall culled at mount
    // would stay culled (or stay drawn) forever as the globe turns. Spun a
    // full 180 degrees, the near-side patch is now behind the globe.
    const { host, map, before } = await mount(false);
    map.addLayer({
      type: "fill-extrusion", id: "spin", color: "#00ff00",
      source: { features: [feature([NEAR()], { height: WALL_HEIGHT_M })] },
      heightProperty: "height",
    });
    await settle();
    map.scene.rerender();
    expect(changedCells(before, grids(host)).length).toBeGreaterThan(400);

    map.setView({ center: [180, 0] });
    map.scene.rerender();
    // IMMEDIATELY, on the very next render — no debounce, no waiting. The
    // wall cull is not baked into the mesh any more: `setView` drains
    // `nearSideSyncs`, which re-culls the (camera-independent) mesh against
    // the camera that now exists. Before that fix this render measured 258
    // stale cells painting straight through the globe, and only reached 0
    // after the 180ms `scheduleTileUpdate` debounce rebuilt the geometry.
    // No terrain is mounted, so an empty scene is literally zero ink — the
    // strongest available form of "the far side left nothing behind".
    expect(inkedCells(grids(host))).toBe(0);

    // And it STAYS zero once the debounce would have fired, so the per-frame
    // cull and the tile update cannot disagree about the same view.
    await new Promise((r) => setTimeout(r, 260));
    map.scene.rerender();
    expect(inkedCells(grids(host))).toBe(0);

    // Spun back, the walls come back — the cull is a live verdict, not a
    // one-way erasure of geometry the mesh no longer holds.
    map.setView({ center: [0, 0] });
    map.scene.rerender();
    expect(changedCells(before, grids(host)).length).toBeGreaterThan(400);
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
    const before = grids(host);
    map.addLayer({ type: "fill", id: "flat", source: { features: [feature([NEAR()])] }, color: "#00ff00" });
    await settle();
    map.scene.rerender();
    expect(changedCells(before, grids(host)).length).toBeGreaterThan(400);
    map.destroy();
    host.remove();
  });
});
