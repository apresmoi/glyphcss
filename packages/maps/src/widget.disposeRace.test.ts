/**
 * Regression coverage for the reported "layers get duplicated, they do not
 * offload" / "I unticked ALL the layers but I still see the world" defect.
 *
 * ROOT CAUSE: `createRasterLayerRuntime` is async throughout (its floor
 * fetch, its fallback-tier fetch, its fine-tier fetch, and the queued-update
 * tail all `await provider.loadTile(...)`) but held NO `disposed` flag — the
 * discipline `createFeatureLayerRuntime` already applies (`if (disposed)
 * return;` after its own await). So a fetch already in flight when the user
 * unticks a layer resolves AFTER `dispose()` has disposed every handle, and
 * its continuation calls `scene.add(...)` again. Those meshes are ORPHANS:
 * no runtime holds their handles any more, so nothing can ever dispose them
 * — the terrain stays on screen with every layer unticked, and re-ticking
 * mounts a second copy on top of the first.
 *
 * The raster tests measure MOUNTED MESHES, not "is something rendered": the
 * defect is extra `scene.add` calls that outlive their runtime, and a coarse
 * "the <pre> is non-empty" assertion passes for the duplication case (one
 * layer's worth of terrain looks the same as two). The `line`/`contour`
 * runtimes mount no mesh at all, so their own post-dispose continuation is
 * measured as what it actually costs: a `scene.rerender()` for a layer that
 * is gone, plus the state `dispose()` had just cleared coming back.
 *
 * Measured against the unguarded code, for the record: 5 orphan meshes and
 * 1,440 non-whitespace glyphs still in the `<pre>` after removing the ONLY
 * layer, and 10 meshes where one layer's worth is 5 on the remove-then-
 * re-add path.
 */
import { afterEach, describe, expect, it } from "vitest";
import type { GlyphMeshHandle } from "glyphcss";
import { createGlyphMap, type GlyphMapHandle } from "./widget";
import { glyphMapEquirectangular } from "./projection";
import type { GlyphMapGeoTile } from "./tile";
import type { GlyphMapProvider, GlyphMapProviderZoomLevel } from "./provider";
import type { GlyphMapVectorProvider } from "./vector/types";

/**
 * Three levels, so a `view.span` of 40 selects z2 as the target LOD and
 * leaves z1 as a distinct FALLBACK tier above the permanent z0 floor — all
 * three tiers fetch, so one gate holds every await in the runtime at once.
 */
const ZOOMS: readonly GlyphMapProviderZoomLevel[] = [
  { z: 0, cols: 1, rows: 1, tileLonSpan: 360, tileLatSpan: 180, tileCols: 2, tileRows: 2 },
  { z: 1, cols: 2, rows: 1, tileLonSpan: 180, tileLatSpan: 180, tileCols: 4, tileRows: 4 },
  { z: 2, cols: 4, rows: 2, tileLonSpan: 90, tileLatSpan: 90, tileCols: 8, tileRows: 8 },
];

/**
 * Two levels: the only level coarser than the target LOD IS the floor, so
 * `updateProvider` mounts NO fallback tier and its fallback fetch phase is
 * skipped entirely. That leaves the fine tier's own `await` (plus `await
 * floor`) as the FIRST await the runtime reaches — the one guard the
 * three-level fixture can never exercise, because an earlier guard always
 * returns first.
 */
const ZOOMS_NO_FALLBACK: readonly GlyphMapProviderZoomLevel[] = [ZOOMS[0], ZOOMS[1]];

function tileBounds(zooms: readonly GlyphMapProviderZoomLevel[], z: number, x: number, y: number): GlyphMapGeoTile["bounds"] {
  const level = zooms.find((l) => l.z === z)!;
  return {
    west: -180 + x * level.tileLonSpan,
    east: -180 + (x + 1) * level.tileLonSpan,
    north: 90 - y * level.tileLatSpan,
    south: 90 - (y + 1) * level.tileLatSpan,
  };
}

function makeTile(zooms: readonly GlyphMapProviderZoomLevel[], z: number, x: number, y: number): GlyphMapGeoTile {
  const level = zooms.find((l) => l.z === z)!;
  const { tileCols: cols, tileRows: rows } = level;
  const elevation = new Float32Array((cols + 1) * (rows + 1)).fill(2_000_000);
  return { bounds: tileBounds(zooms, z, x, y), cols, rows, elevation, source: "synthetic", sampler: "nearest" };
}

/**
 * A provider whose every `loadTile` blocks on ONE gate promise, so a test
 * can hold every tier's fetch (floor, fallback, fine) in flight, dispose
 * the layer, and only then let them all resolve. Deterministic — no timing
 * assumptions, unlike a `setTimeout`-backed fake.
 */
function gatedProvider(zooms: readonly GlyphMapProviderZoomLevel[] = ZOOMS): { provider: GlyphMapProvider; open: () => void; calls: string[] } {
  let open: () => void = () => {};
  const gate = new Promise<void>((resolve) => { open = resolve; });
  const calls: string[] = [];
  const provider: GlyphMapProvider = {
    id: "gated",
    zooms,
    bounds: (z, x, y) => tileBounds(zooms, z, x, y),
    async loadTile(z, x, y) {
      calls.push(`${z}/${x}_${y}`);
      await gate;
      return makeTile(zooms, z, x, y);
    },
  };
  return { provider, open, calls };
}

/** The `line` layer's own gated source — same one-gate discipline. */
function gatedVectorProvider(): { provider: GlyphMapVectorProvider; open: () => void } {
  let open: () => void = () => {};
  const gate = new Promise<void>((resolve) => { open = resolve; });
  const provider: GlyphMapVectorProvider = {
    id: "gated-vector",
    zooms: ZOOMS,
    bounds: (z, x, y) => tileBounds(ZOOMS, z, x, y),
    async loadTile() {
      await gate;
      return { layers: { admin: [{ id: "equator", rings: [[[-18, 0], [18, 0]]] }] } };
    },
  };
  return { provider, open };
}

/**
 * Counts every `scene.rerender()` from now on. A disposed stroke runtime
 * mounts no mesh, so its post-dispose continuation is invisible in a mesh
 * count — what it DOES do is repopulate the state `dispose()` just cleared
 * and force a full re-render of a scene that has nothing to show for it.
 */
function countRenders(map: GlyphMapHandle): () => number {
  let renders = 0;
  const realRerender = map.scene.rerender.bind(map.scene);
  map.scene.rerender = () => { renders++; realRerender(); };
  return () => renders;
}

/**
 * Live mounted-mesh set for a widget's scene: every `scene.add` this widget
 * makes joins it, every `handle.dispose()` leaves it. Patched on the scene
 * handle object the widget itself closes over (`createGlyphScene` returns a
 * plain object and the widget calls `scene.add(...)` as a method on it), so
 * this observes the real mount/unmount traffic rather than a proxy of it.
 */
function trackMeshes(map: GlyphMapHandle): Set<GlyphMeshHandle> {
  const live = new Set<GlyphMeshHandle>();
  const realAdd = map.scene.add.bind(map.scene);
  map.scene.add = (polygons, transform) => {
    const handle = realAdd(polygons, transform);
    live.add(handle);
    const realDispose = handle.dispose.bind(handle);
    handle.dispose = () => { live.delete(handle); realDispose(); };
    return handle;
  };
  return live;
}

function mount(): { host: HTMLElement; map: GlyphMapHandle } {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const map = createGlyphMap(host, {
    view: { center: [0, 0], span: 40, cols: 60, rows: 24 },
    projection: glyphMapEquirectangular(),
    tilt: 0,
  });
  return { host, map };
}

/**
 * Drain the chained continuations (fallback fetch → fine fetch → floor).
 * Deliberately shorter than `scheduleTileUpdate`'s own 180ms debounce, so a
 * view-driven re-update never confuses the mesh count.
 */
async function flush(): Promise<void> {
  for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 5));
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("createGlyphMap — a raster layer disposed mid-fetch never remounts", () => {
  it("removing the layer while every tile fetch is in flight leaves ZERO meshes once they resolve", async () => {
    const { host, map } = mount();
    const live = trackMeshes(map);
    const { provider, open, calls } = gatedProvider();

    map.addLayer({ type: "raster", id: "terrain", source: provider, density: 1 });
    await Promise.resolve();

    // The runtime is genuinely mid-flight: fetches issued, nothing mounted.
    expect(calls.length).toBeGreaterThan(0);
    expect(live.size).toBe(0);

    map.removeLayer("terrain");
    open();
    await flush();
    map.scene.rerender();

    expect(live.size).toBe(0);
    expect(map.scene.output.textContent ?? "").toMatch(/^\s*$/);

    map.destroy();
    host.remove();
  });

  it("remove + immediately re-add while fetches are in flight holds exactly ONE layer's worth of geometry", async () => {
    // Baseline: what a single, undisturbed mount of this layer costs.
    const control = mount();
    const controlLive = trackMeshes(control.map);
    const controlProvider = gatedProvider();
    control.map.addLayer({ type: "raster", id: "terrain", source: controlProvider.provider, density: 1 });
    controlProvider.open();
    await flush();
    const expected = controlLive.size;
    expect(expected).toBeGreaterThan(0);
    control.map.destroy();
    control.host.remove();

    const { host, map } = mount();
    const live = trackMeshes(map);
    const first = gatedProvider();
    const second = gatedProvider();

    map.addLayer({ type: "raster", id: "terrain", source: first.provider, density: 1 });
    await Promise.resolve();
    map.removeLayer("terrain");
    map.addLayer({ type: "raster", id: "terrain", source: second.provider, density: 1 });
    await Promise.resolve();

    first.open();
    second.open();
    await flush();
    map.scene.rerender();

    expect(live.size).toBe(expected);

    map.destroy();
    host.remove();
  });

  it("the fine tier alone (no separate fallback level) also mounts nothing after dispose", async () => {
    const { host, map } = mount();
    const live = trackMeshes(map);
    const { provider, open, calls } = gatedProvider(ZOOMS_NO_FALLBACK);

    map.addLayer({ type: "raster", id: "terrain", source: provider, density: 1 });
    await Promise.resolve();

    // Only the floor (z0) and the target LOD (z1) are fetched — no z-level
    // sits strictly between them, so the fallback phase never runs.
    expect(calls.every((key) => key.startsWith("0/") || key.startsWith("1/"))).toBe(true);
    expect(live.size).toBe(0);

    map.removeLayer("terrain");
    open();
    await flush();
    map.scene.rerender();

    expect(live.size).toBe(0);
    expect(map.scene.output.textContent ?? "").toMatch(/^\s*$/);

    map.destroy();
    host.remove();
  });

  it("a queued update cannot restart after dispose", async () => {
    const { host, map } = mount();
    const live = trackMeshes(map);
    const { provider, open } = gatedProvider();

    map.addLayer({ type: "raster", id: "terrain", source: provider, density: 1 });
    await Promise.resolve();
    // A second update while the first is in flight only sets `updateQueued`,
    // which the first one's `finally` tail runs — after `dispose()`. It
    // arrives through `scheduleTileUpdate`'s own 180ms debounce, so wait it
    // out before removing the layer.
    map.setView({ center: [10, 10], span: 30 });
    await new Promise((r) => setTimeout(r, 260));

    map.removeLayer("terrain");
    open();
    await flush();
    map.scene.rerender();

    expect(live.size).toBe(0);
    expect(map.scene.output.textContent ?? "").toMatch(/^\s*$/);

    map.destroy();
    host.remove();
  });
});

describe("createGlyphMap — a stroke layer disposed mid-fetch stays disposed", () => {
  it("a line layer removed mid-fetch never re-renders the scene once its tiles arrive", async () => {
    const { host, map } = mount();
    const { provider, open } = gatedVectorProvider();

    map.addLayer({ type: "line", id: "borders", source: provider, color: "#ff0000" });
    await Promise.resolve();
    // Also arms the queued-update tail (`finally`'s `if (updateQueued)`),
    // which `updateProvider`'s entry guard is what stops after dispose.
    map.setView({ center: [10, 10], span: 30 });
    await new Promise((r) => setTimeout(r, 260));

    map.removeLayer("borders");
    const renders = countRenders(map);
    open();
    await flush();

    expect(renders()).toBe(0);

    map.destroy();
    host.remove();
  });

  it("a contour layer removed mid-fetch never re-renders the scene once its tiles arrive", async () => {
    const { host, map } = mount();
    const { provider, open } = gatedProvider();

    map.addLayer({ type: "contour", id: "contour", source: provider, levels: { interval: 500_000 }, color: "#00ff00" });
    await Promise.resolve();
    // Arms the queued-update tail too — see the line case above.
    map.setView({ center: [10, 10], span: 30 });
    await new Promise((r) => setTimeout(r, 260));

    map.removeLayer("contour");
    const renders = countRenders(map);
    open();
    await flush();

    expect(renders()).toBe(0);

    map.destroy();
    host.remove();
  });
});
