import { describe, expect, it } from "vitest";
import { createGlyphMap } from "./widget";
import { glyphMapEquirectangular } from "./projection";
import type { GlyphMapGeoTile } from "./tile";
import type { GlyphMapProvider } from "./provider";

/**
 * `map.idle()`'s own gate. Each test isolates ONE clause of `widgetBusy()`
 * and asserts on something only true once that clause has been honoured, so
 * deleting a clause in `widget.ts` turns exactly one of these red rather than
 * leaving a settle that "usually works because the machine is fast".
 *
 * The two MOTION clauses are gated as a pair — a `flyTo` sets both, so each
 * alone is sufficient for it; `widgetBusy`'s own doc names the case each
 * covers that the other does not. `widget.oceanDrape.test.ts`'s "still
 * re-plants the lakes beside the ocean when a finer tier lands" and
 * `widget.test.ts`'s z0..z4 ladder gate the same predicate end to end.
 *
 * Deliberately no `setTimeout` as a WAIT here: a test OF the settle primitive
 * that arranged its own preconditions with a sleep would be asserting against
 * the thing it replaces. The two that appear are a provider's own simulated
 * latency and a yield of one event-loop turn, neither of which is a duration
 * anything is asserted against.
 */

function tileAt(bounds: { west: number; east: number; south: number; north: number }): GlyphMapGeoTile {
  const cols = 2, rows = 2;
  const elevation = new Float32Array((cols + 1) * (rows + 1)).fill(100);
  return { bounds, cols, rows, elevation, source: "synthetic", sampler: "nearest" };
}

const ZOOMS = [0, 1, 2].map((z) => ({
  z,
  cols: 2 ** z,
  rows: 2 ** z,
  tileLonSpan: 360 / 2 ** z,
  tileLatSpan: 180 / 2 ** z,
  tileCols: 2,
  tileRows: 2,
}));

function boundsOf(z: number, x: number, y: number) {
  const lonSpan = 360 / 2 ** z, latSpan = 180 / 2 ** z;
  const west = -180 + x * lonSpan, north = 90 - y * latSpan;
  return { west, east: west + lonSpan, south: north - latSpan, north };
}

function mount(provider: GlyphMapProvider) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const map = createGlyphMap(host, {
    view: { center: [0, 0], span: 300, cols: 40, rows: 20 },
    projection: glyphMapEquirectangular(),
    maxSpan: 360,
    layers: [{ type: "raster", source: provider }],
  });
  return { host, map };
}

describe("createGlyphMap — map.idle()", () => {
  it("is NOT idle while a dispatched tile sweep is still running, and resolves once it finishes", async () => {
    // A provider held open by the test: the widget's mount sweep is genuinely
    // in flight and cannot complete until `release()`. Nothing about elapsed
    // time can make this one pass.
    let pending: (() => void)[] = [];
    let loads = 0;
    const provider: GlyphMapProvider = {
      id: "gated",
      zooms: ZOOMS,
      bounds: boundsOf,
      loadTile: async (z, x, y) => {
        loads++;
        await new Promise<void>((resolve) => { pending.push(resolve); });
        return tileAt(boundsOf(z, x, y));
      },
    };
    const { host, map } = mount(provider);

    let settled = false;
    const idle = map.idle().then(() => { settled = true; });
    for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(loads).toBeGreaterThan(0);
    expect(settled).toBe(false);

    const release = (): void => { const p = pending; pending = []; for (const r of p) r(); };
    // The sweep fetches in phases (fallback, then fine, then the floor), so
    // it re-enters `loadTile` after each release — keep releasing until the
    // widget itself says it is done.
    // Yields a whole event-loop turn, not a duration: `idle()`'s own wait
    // lives in the timers phase, so a microtask-only pump would starve it.
    const turn = (): Promise<void> => new Promise<void>((r) => { setTimeout(r, 0); });
    const pump = (async () => { while (!settled) { release(); await turn(); } })();
    await Promise.all([idle, pump]);
    expect(settled).toBe(true);

    map.destroy();
    host.remove();
  });

  it("waits through `scheduleTileUpdate`'s debounce — a sweep that is ARMED but has not run is not idle", async () => {
    // `bounds` is called once per candidate tile by the SWEEP itself, so it
    // counts sweeps and is blind to the tile cache (which by this point holds
    // every tile, so counting fetches would prove nothing).
    let sweepProbes = 0;
    const provider: GlyphMapProvider = {
      id: "immediate",
      zooms: ZOOMS,
      bounds: (z, x, y) => { sweepProbes++; return boundsOf(z, x, y); },
      loadTile: async (z, x, y) => tileAt(boundsOf(z, x, y)),
    };
    const { host, map } = mount(provider);
    await map.idle();
    const afterMount = sweepProbes;
    expect(afterMount).toBeGreaterThan(0);

    // THE DISCRIMINATOR: at this instant the 180ms debounce is armed and
    // nothing has run. A settle that looked only at in-flight work would
    // answer "idle" here.
    map.setView({ span: 40 });
    expect(sweepProbes).toBe(afterMount);

    await map.idle();
    expect(sweepProbes).toBeGreaterThan(afterMount);

    map.destroy();
    host.remove();
  });

  it("is NOT idle while a `flyTo` is in the air", async () => {
    const { host, map } = mount({
      id: "immediate",
      zooms: ZOOMS,
      bounds: boundsOf,
      loadTile: async (z, x, y) => tileAt(boundsOf(z, x, y)),
    });
    await map.idle();

    let arrived = false;
    // A flight lives in the motion loop, not in any promise the widget
    // awaits — `motionActive()` is the only clause that knows about it.
    void map.flyTo({ center: [40, 10], span: 60 }, { durationMs: 150 }).then(() => { arrived = true; });
    await map.idle();
    expect(arrived).toBe(true);
    expect(map.getView().span).toBeCloseTo(60, 6);

    map.destroy();
    host.remove();
  });

  it("is NOT idle while the ground-change re-plant a `removeLayer` provoked is still fetching", async () => {
    // `notifyGroundChanged` is the ONE path that arms real async work from a
    // synchronous public call with nothing else outstanding: `removeLayer` of
    // a raster layer queues the re-plant microtask and returns. Every other
    // caller of it notifies from INSIDE a sweep, where `pendingUpdates` is
    // already non-zero and would cover the chain on its own — so this is the
    // only shape that can tell the `groundChangeQueued` clause apart.
    let contourLoadsAllowed = false;
    const contourProvider: GlyphMapProvider = {
      id: "contour-ramp",
      zooms: ZOOMS,
      bounds: boundsOf,
      loadTile: (z, x, y) => {
        if (!contourLoadsAllowed) return Promise.reject(new Error("transient tile failure"));
        const b = boundsOf(z, x, y);
        const cols = 8, rows = 8;
        const elevation = new Float32Array((cols + 1) * (rows + 1));
        for (let row = 0; row <= rows; row++) {
          const lat = b.north - (row * (b.north - b.south)) / rows;
          for (let col = 0; col <= cols; col++) elevation[row * (cols + 1) + col] = (lat + 90) * 100;
        }
        // A real macrotask of latency, so a settle that answers on the
        // microtask queue alone answers before this resolves.
        return new Promise((resolve) => {
          setTimeout(() => resolve({ bounds: b, cols, rows, elevation, source: "ramp", sampler: "nearest" }), 20);
        });
      },
    };
    const host = document.createElement("div");
    document.body.appendChild(host);
    const map = createGlyphMap(host, {
      view: { center: [0, 0], span: 120, cols: 40, rows: 20 },
      projection: glyphMapEquirectangular(),
      maxSpan: 360,
      layers: [
        { type: "raster", id: "terrain", source: { id: "t", zooms: ZOOMS, bounds: boundsOf, loadTile: async (z, x, y) => tileAt(boundsOf(z, x, y)) } },
        { type: "contour", id: "contour", source: contourProvider, levels: { interval: 1000 }, color: "#ff00ff" },
      ],
    });
    // Every contour tile of the mount sweep AND of the re-plant the landing
    // terrain provokes has failed, so the layer has no mosaic at all.
    await map.idle();
    expect(map.getContourFieldRange("contour")).toBeNull();

    contourLoadsAllowed = true;
    map.removeLayer("terrain");
    await map.idle();
    expect(map.getContourFieldRange("contour")).not.toBeNull();

    map.destroy();
    host.remove();
  });

  it("resolves on a destroyed map — nothing is owed", async () => {
    const { host, map } = mount({
      id: "never",
      zooms: ZOOMS,
      bounds: boundsOf,
      // Never resolves: only the `destroyed` short-circuit can end this wait.
      loadTile: () => new Promise<GlyphMapGeoTile>(() => {}),
    });
    map.destroy();
    await map.idle();
    host.remove();
  });
});
