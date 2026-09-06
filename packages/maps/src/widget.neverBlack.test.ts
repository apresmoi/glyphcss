import { describe, expect, it } from "vitest";
import { createGlyphMap } from "./widget";
import { glyphMapEquirectangular } from "./projection";
import type { GlyphMapGeoTile } from "./tile";
import type { GlyphMapProvider, GlyphMapProviderZoomLevel } from "./provider";
import type { GlyphMapBounds } from "./types";

/**
 * "Never show a blank/black hole while panning or zooming" — the map must
 * always have SOME mounted terrain geometry covering the viewport, even
 * mid-gesture and even while a genuinely new region's fine tiles are still
 * in flight. The fix this pins: a permanent whole-world floor level (the
 * provider's shallowest zoom, always mounted, never evicted) plus a
 * one-level-coarser "retained ancestor" fallback that appears immediately
 * from cache while the target LOD's own tiles are loading, then is evicted
 * once the fine tiles actually land.
 *
 * Coverage is measured as a FRACTION of non-space characters in the
 * rasterized `<pre>` output, not "every cell must be non-space": happy-dom
 * has no real layout/font-metrics engine, so the widget's own screen-space
 * math (`host.getBoundingClientRect()`-derived) and glyphcss's internal
 * cell-size measurement for the actual rasterizer disagree in this test
 * environment even for geometry that unambiguously covers its whole tile
 * (confirmed directly: a single static tile framed to exactly fill the
 * view still only rasterizes to ~15-20% non-space here, never more, with
 * no regression present). What IS reliable, and what the bug this fixes
 * actually produces, is the difference between "some terrain is drawn"
 * and "literally nothing is drawn" (0%) — so the assertion is a coverage
 * FLOOR well above the noise band, not full-grid coverage.
 */
const MIN_COVERAGE_FRACTION = 0.03;

function tileBounds(level: GlyphMapProviderZoomLevel, x: number, y: number): GlyphMapBounds {
  const lonMin = -180 + x * level.tileLonSpan;
  const latMax = 90 - y * level.tileLatSpan;
  return { west: lonMin, east: lonMin + level.tileLonSpan, south: latMax - level.tileLatSpan, north: latMax };
}

function makeTile(bounds: GlyphMapBounds, cols: number, rows: number, elev: number): GlyphMapGeoTile {
  const elevation = new Float32Array((cols + 1) * (rows + 1)).fill(elev);
  return { bounds, cols, rows, elevation, source: "synthetic", sampler: "nearest" };
}

/**
 * A small synthetic world pyramid (z0..maxZ, equal-angle addressing, same
 * quad size at every level — matching the real ETOPO1 manifest's own shape,
 * `website/public/data/geo-tiles/manifest.json`, where every level ships
 * the identical 180x90 quad grid). `hold`/`release` let a test pause a
 * SPECIFIC tile's fetch to inspect the "still in flight" frame.
 */
function makePyramidProvider(maxZ: number, tileQuad = 4) {
  const zooms: GlyphMapProviderZoomLevel[] = [];
  for (let z = 0; z <= maxZ; z++) {
    const n = 2 ** z;
    zooms.push({ z, cols: n, rows: n, tileLonSpan: 360 / n, tileLatSpan: 180 / n, tileCols: tileQuad, tileRows: tileQuad });
  }
  const loaded: string[] = [];
  const held = new Set<string>();
  const pending = new Map<string, () => void>();

  const provider: GlyphMapProvider = {
    id: "pyramid",
    zooms,
    bounds: (z, x, y) => tileBounds(zooms[z], x, y),
    loadTile: (z, x, y) => {
      const key = `${z}/${x}_${y}`;
      loaded.push(key);
      const tile = makeTile(tileBounds(zooms[z], x, y), tileQuad, tileQuad, z * 1000 + 1);
      if (held.has(key)) {
        return new Promise<GlyphMapGeoTile>((resolve) => pending.set(key, () => resolve(tile)));
      }
      return Promise.resolve(tile);
    },
  };

  return {
    provider,
    loaded,
    tileKeyFor(z: number, lon: number, lat: number): string {
      const level = zooms[z];
      const x = Math.min(level.cols - 1, Math.max(0, Math.floor((lon + 180) / level.tileLonSpan)));
      const y = Math.min(level.rows - 1, Math.max(0, Math.floor((90 - lat) / level.tileLatSpan)));
      return `${z}/${x}_${y}`;
    },
    hold(key: string): void {
      held.add(key);
    },
    release(key: string): void {
      held.delete(key);
      pending.get(key)?.();
      pending.delete(key);
    },
  };
}

function mount(provider: GlyphMapProvider, center: readonly [number, number] = [0, 0]) {
  const host = document.createElement("div");
  // happy-dom's default `getBoundingClientRect()` is all zeros, which makes
  // `projectionGrid()` fall back to a fixed cell size regardless of
  // `cols`/`rows` — a real measured host size is load-bearing here, same as
  // `widget.test.ts`'s own fitBounds-into-globe regression test. `tilt: 0`
  // pins a top-down camera (the widget's own default sheet tilt is 40,
  // which is irrelevant noise for a coverage check).
  Object.defineProperty(host, "getBoundingClientRect", {
    value: () => ({ width: 600, height: 600, top: 0, left: 0, right: 600, bottom: 600, x: 0, y: 0, toJSON() {} }),
  });
  document.body.appendChild(host);
  const map = createGlyphMap(host, {
    view: { center, span: 40, cols: 60, rows: 30 },
    projection: glyphMapEquirectangular(),
    tilt: 0,
    scene: { glyphPalette: "solid" },
    layers: [{ type: "raster", source: provider }],
  });
  return { host, map };
}

/** Fraction of non-space, non-newline characters in the rasterized output — see module doc. */
function coverageFraction(map: ReturnType<typeof createGlyphMap>): number {
  const text = map.scene.output.textContent ?? "";
  if (text.length === 0) return 0;
  let nonSpace = 0, total = 0;
  for (const ch of text) {
    if (ch === "\n") continue;
    total++;
    if (ch !== " ") nonSpace++;
  }
  return total === 0 ? 0 : nonSpace / total;
}

async function settle(ms = 260): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

describe("createGlyphMap — never a blank/black hole while panning or zooming", () => {
  it("stays above the coverage floor through a settled view -> zoom into an uncached region -> pan mid-gesture -> return sequence, including while the fine tiles are still in flight", async () => {
    const { provider, loaded, tileKeyFor, hold, release } = makePyramidProvider(5);
    const { host, map } = mount(provider);

    // Step 0: initial view settles.
    await settle();
    expect(coverageFraction(map)).toBeGreaterThan(MIN_COVERAGE_FRACTION);
    expect(loaded.length).toBeGreaterThan(0);

    // Step 1: jump (setView, the "gesture just ended" analogue) to a
    // distant, never-before-visited region — but hold back its own fine
    // tile so the fetch is still in flight when we check.
    const deepKey = tileKeyFor(5, 100, -40);
    hold(deepKey);
    map.setView({ center: [100, -40], span: 40 });
    await settle(); // past the 180ms debounce — the fetch has started, but `deepKey` is gated
    expect(loaded).toContain(deepKey);
    // Floor/fallback must cover this even though the fine tile hasn't arrived.
    expect(coverageFraction(map)).toBeGreaterThan(MIN_COVERAGE_FRACTION);

    release(deepKey);
    await settle(120);
    expect(coverageFraction(map)).toBeGreaterThan(MIN_COVERAGE_FRACTION); // still covered once the fine tile lands

    // Step 2: a drag gesture that never sees pointerup/pointercancel (lost
    // capture, or an inertial tail with no terminal event) — detail for
    // wherever it ends up must still eventually arrive, purely from
    // `onPointerMove` re-arming `scheduleTileUpdate`'s debounce on every
    // move (mirroring `onWheel`'s own already-existing settle behavior).
    const loadedBeforeDrag = loaded.length;
    const centerBeforeDrag = map.getView().center;
    host.dispatchEvent(new PointerEvent("pointerdown", { clientX: 300, clientY: 300, pointerId: 9, bubbles: true }));
    // Several incremental moves, like a real drag, panning well past the
    // current view's own tile footprint.
    for (let i = 1; i <= 6; i++) {
      host.dispatchEvent(new PointerEvent("pointermove", { clientX: 300 - i * 80, clientY: 300 - i * 40, pointerId: 9, bubbles: true }));
    }
    // Deliberately no pointerup/pointercancel.
    expect(coverageFraction(map)).toBeGreaterThan(MIN_COVERAGE_FRACTION); // never black mid-gesture either, even with no formal end
    expect(map.getView().center).not.toEqual(centerBeforeDrag); // the drag genuinely moved the view
    await settle();
    expect(coverageFraction(map)).toBeGreaterThan(MIN_COVERAGE_FRACTION);
    // Detail for the new position genuinely arrived even though the
    // gesture never formally ended.
    expect(loaded.length).toBeGreaterThan(loadedBeforeDrag);

    // Step 3: back to the original view.
    map.setView({ center: [0, 0], span: 40 });
    await settle();
    expect(coverageFraction(map)).toBeGreaterThan(MIN_COVERAGE_FRACTION);

    map.destroy();
    host.remove();
  });

  it("mounted tile count stays bounded across a realistic pan-and-zoom sequence (retained fallbacks are evicted, not accumulated)", async () => {
    const { provider, tileKeyFor, hold, release } = makePyramidProvider(5);
    const { host, map } = mount(provider);

    let mountedTiles = 0;
    const realAdd = map.scene.add.bind(map.scene);
    (map.scene as unknown as { add: typeof map.scene.add }).add = (polygons, transform) => {
      const handle = realAdd(polygons, transform);
      mountedTiles++;
      const realDispose = handle.dispose.bind(handle);
      handle.dispose = () => {
        mountedTiles--;
        realDispose();
      };
      return handle;
    };

    await settle();
    const afterInitial = mountedTiles;
    expect(afterInitial).toBeGreaterThan(0);

    const spots: readonly [number, number][] = [[100, -40], [-150, 60], [30, 10], [-60, -20]];
    for (const [lon, lat] of spots) {
      const key = tileKeyFor(5, lon, lat);
      hold(key);
      map.setView({ center: [lon, lat], span: 40 });
      await settle();
      release(key);
      await settle(120);
    }

    map.setView({ center: [0, 0], span: 40 });
    await settle();
    const afterRoundTrip = mountedTiles;

    // Bounded, not perpetually growing: the steady state before and after
    // the whole pan sequence mounts roughly the same tile count (floor +
    // whatever the settled view itself needs) rather than accumulating
    // every fallback/fine tile ever touched along the way.
    expect(afterRoundTrip).toBeLessThan(afterInitial * 4);

    map.destroy();
    host.remove();
  });

  it("a retained fallback tile is evicted once its own fine replacement finishes mounting, not just when it later scrolls off-screen", async () => {
    // A count-only assertion here is unreliable: swapping N fallback tiles
    // for N fine tiles at the same footprint leaves the TOTAL mounted count
    // unchanged even when eviction works correctly (mutation-tested — see
    // AGENTS.md/the fix's own history). So instead compare against a
    // GROUND-TRUTH: a second, freshly constructed map at the exact same
    // final view with no fallback ever mounted at all. If eviction is
    // broken, the gated map's steady state carries the leftover fallback
    // meshes ALONGSIDE the fine ones and mounts strictly more than the
    // fresh map's own steady state; if it works, the two converge exactly.
    function trackedMount(center: readonly [number, number] = [0, 0]) {
      const { provider, tileKeyFor, hold, release, loaded } = makePyramidProvider(5);
      const { host, map } = mount(provider, center);
      let mountedTiles = 0;
      const realAdd = map.scene.add.bind(map.scene);
      (map.scene as unknown as { add: typeof map.scene.add }).add = (polygons, transform) => {
        const handle = realAdd(polygons, transform);
        mountedTiles++;
        const realDispose = handle.dispose.bind(handle);
        handle.dispose = () => {
          mountedTiles--;
          realDispose();
        };
        return handle;
      };
      return { host, map, tileKeyFor, hold, release, loaded, current: () => mountedTiles };
    }

    const gated = trackedMount([0, 0]);
    await settle();
    const key = gated.tileKeyFor(5, 100, -40);
    gated.hold(key);
    gated.map.setView({ center: [100, -40], span: 40 });
    await settle();
    const midFetch = gated.current();
    gated.release(key);
    await settle(150);
    const afterArrival = gated.current();

    // The ground truth is constructed DIRECTLY at the final view — not
    // "settle elsewhere, then setView here" like `gated` — so it never
    // mounts a first view's own fallback tier at all, and genuinely has no
    // history to leak. Constructing it the same two-step way `gated` was
    // built would make it accumulate the identical first-view leftover
    // under a broken eviction, masking exactly the regression this test
    // exists to catch (mutation-verified — a from-scratch ground truth is
    // load-bearing here, not a style choice).
    const fresh = trackedMount([100, -40]);
    await settle();
    const groundTruth = fresh.current();

    expect(midFetch).toBeGreaterThan(0);
    expect(afterArrival).toBe(groundTruth);

    gated.map.destroy();
    gated.host.remove();
    fresh.map.destroy();
    fresh.host.remove();
  });
});
