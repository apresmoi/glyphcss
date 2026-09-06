/**
 * Regression coverage for the "disabling a layer explodes the page"
 * investigation (user report: unchecking Borders — later confirmed to
 * apply to unchecking ANY /maps layer — crashed the page).
 *
 * The ACTUAL crash, confirmed live against the running `/maps` dev page
 * with a real Chromium (Playwright + CDP), is `RangeError: Maximum call
 * stack size exceeded` inside `packages/glyphcss/src/api/createGlyphScene.ts`'s
 * `publishRendererState`, which does `shadeCache.iA.splice(0, len,
 * ...nextShadeCache.iA)` — a JS engine spread call has a hard argument-count
 * ceiling (measured ~100k-200k in this repo's Node/V8), and the REAL ETOPO1
 * terrain mesh produces a 294,124-entry `shadeCache.iA`/`iB`/`iC`/`lit` array
 * well past it. That function runs on every `scene.rerender()` regardless
 * of which layer changed, which is exactly why the report widened from
 * "Borders" to "any layer" — `removeLayer` always ends in `rerender()`. That
 * fix belongs in `packages/glyphcss`, out of this package's scope.
 *
 * This file instead documents what the leads pointed at inside
 * `packages/maps/src/widget.ts` turned out NOT to be, each with real
 * end-to-end coverage through the actual rasterizer (jsdom via happy-dom,
 * `widget.stroke.test.ts`'s own style):
 *
 * - `syncStrokeHookInstalled` DOES correctly uninstall the composed
 *   `transformCells` hook when the last stroke layer is removed —
 *   `createGlyphScene.ts`'s `setOptions` forwards an explicit `undefined`
 *   via `"transformCells" in partial`, not a `!== undefined` guard, so the
 *   hook genuinely clears rather than sticking around silently.
 * - `composedTransformCells`'s `cachedBaseGrid!`/`cachedBaseCamera!` non-null
 *   assertions are safe in practice: `createGlyphScene.ts`'s `renderDetailLayers`
 *   has exactly one call site, always reached AFTER the base grid's own
 *   `rasterize()` call in the same `doRenderTransaction()` — so the base
 *   hook call (which sets `cachedBaseGrid`) always precedes any detail hook
 *   call within a render, for the lifetime of a widget instance. A runtime
 *   probe (`if (isDetail && cachedBaseGrid === null) throw`) added
 *   temporarily at that line never fired across the full existing maps test
 *   suite (234 tests) plus every scenario below — removing a raster/line/
 *   contour layer in every combination, at density 1 and density > 1 (a
 *   real per-mesh detail `<pre>`), removing the last of two stroke layers,
 *   and the exact mount-time remove+re-add cascade `MapsWorkbench.tsx`'s
 *   own "recolor-or-remount" effects run once on initial mount (every
 *   layer effect fires on mount, not only on a later dependency change).
 * - `removeLayer`'s tail (`layerStates.delete` → `layerOrder.splice` →
 *   `syncStrokeHookInstalled` → `scene.rerender()`) never leaves a disposed
 *   stroke runtime reachable from `layerOrder`/`layerStates` by the time the
 *   hook's stamp loop runs.
 */
import { describe, expect, it, vi } from "vitest";
import { createGlyphMap } from "./widget";
import { glyphMapEquirectangular } from "./projection";
import type { GlyphMapGeoTile } from "./tile";
import type { GlyphMapField } from "./types";
import type { GlyphMapProvider } from "./provider";
import type { GlyphMapVectorFeature, GlyphMapVectorFeatureCollection, GlyphMapVectorProvider } from "./vector/types";

function makeField(bounds: GlyphMapField["bounds"], cols: number, rows: number, value: number): GlyphMapField {
  return {
    bounds,
    cols,
    rows,
    values: new Float32Array(cols * rows).fill(value),
    noData: new Uint8Array(cols * rows),
    kind: "continuous",
    min: value,
    max: value,
  };
}

function makeTile(bounds: GlyphMapGeoTile["bounds"], cols: number, rows: number, elev: number): GlyphMapGeoTile {
  const elevation = new Float32Array((cols + 1) * (rows + 1)).fill(elev);
  return { bounds, cols, rows, elevation, source: "synthetic", sampler: "nearest" };
}

function mount(overrides: Partial<Parameters<typeof createGlyphMap>[1]> = {}) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const map = createGlyphMap(host, {
    view: { center: [0, 0], span: 40, cols: 60, rows: 24 },
    projection: glyphMapEquirectangular(),
    tilt: 0,
    ...overrides,
  });
  return { host, map };
}

describe("createGlyphMap.removeLayer — every layer-removal combination stays safe", () => {
  it("removing the line layer (Borders) while a raster layer is mounted", async () => {
    const { host, map } = mount();
    const ridge = makeTile({ west: -6, east: 6, south: -20, north: 20 }, 4, 4, 2_000_000);
    map.addLayer({ type: "raster", id: "terrain", source: ridge, density: 1 });
    const line: GlyphMapVectorFeature = { id: "equator", rings: [[[-18, 0], [18, 0]]] };
    const source: GlyphMapVectorFeatureCollection = { features: [line] };
    map.addLayer({ type: "line", id: "border", source, color: "#ff0000" });

    await vi.waitFor(() => expect(map.scene.output.textContent ?? "").not.toBe(""));
    await new Promise((r) => setTimeout(r, 50));
    map.scene.rerender();

    expect(() => {
      map.removeLayer("border");
      map.scene.rerender();
    }).not.toThrow();

    map.destroy();
    host.remove();
  });

  it("removing the raster layer (Terrain) while a line layer is mounted", async () => {
    const { host, map } = mount();
    const ridge = makeTile({ west: -6, east: 6, south: -20, north: 20 }, 4, 4, 2_000_000);
    map.addLayer({ type: "raster", id: "terrain", source: ridge, density: 1 });
    const line: GlyphMapVectorFeature = { id: "equator", rings: [[[-18, 0], [18, 0]]] };
    const source: GlyphMapVectorFeatureCollection = { features: [line] };
    map.addLayer({ type: "line", id: "border", source, color: "#ff0000" });

    await vi.waitFor(() => expect(map.scene.output.textContent ?? "").not.toBe(""));
    await new Promise((r) => setTimeout(r, 50));
    map.scene.rerender();

    expect(() => {
      map.removeLayer("terrain");
      map.scene.rerender();
    }).not.toThrow();

    map.destroy();
    host.remove();
  });

  it("removing the raster layer at density > 1 (its own detail <pre>) while a line layer is mounted", async () => {
    const { host, map } = mount();
    const ridge = makeTile({ west: -6, east: 6, south: -20, north: 20 }, 4, 4, 2_000_000);
    map.addLayer({ type: "raster", id: "terrain", source: ridge, density: 2 });
    const line: GlyphMapVectorFeature = { id: "equator", rings: [[[-18, 0], [18, 0]]] };
    const source: GlyphMapVectorFeatureCollection = { features: [line] };
    map.addLayer({ type: "line", id: "border", source, color: "#ff0000" });

    await vi.waitFor(() => expect(map.scene.output.textContent ?? "").not.toBe(""));
    await new Promise((r) => setTimeout(r, 50));
    map.scene.rerender();

    expect(() => {
      map.removeLayer("terrain");
      map.scene.rerender();
    }).not.toThrow();

    map.destroy();
    host.remove();
  });

  it("removing the contour layer while a raster layer is mounted", async () => {
    const { host, map } = mount();
    const ridge = makeTile({ west: -6, east: 6, south: -20, north: 20 }, 4, 4, 2_000_000);
    map.addLayer({ type: "raster", id: "terrain", source: ridge, density: 1 });
    map.addLayer({
      type: "contour", id: "contour",
      source: makeField({ west: -6, east: 6, south: -20, north: 20 }, 4, 4, 2_000_000),
      levels: { interval: 500_000 }, color: "#00ff00",
    });

    await vi.waitFor(() => expect(map.scene.output.textContent ?? "").not.toBe(""));
    await new Promise((r) => setTimeout(r, 50));
    map.scene.rerender();

    expect(() => {
      map.removeLayer("contour");
      map.scene.rerender();
    }).not.toThrow();

    map.destroy();
    host.remove();
  });

  it("removing the last of two stroke layers (line, then contour) uninstalls the composed hook cleanly", async () => {
    const { host, map } = mount();
    const ridge = makeTile({ west: -6, east: 6, south: -20, north: 20 }, 4, 4, 2_000_000);
    map.addLayer({ type: "raster", id: "terrain", source: ridge, density: 1 });
    const line: GlyphMapVectorFeature = { id: "equator", rings: [[[-18, 0], [18, 0]]] };
    const source: GlyphMapVectorFeatureCollection = { features: [line] };
    map.addLayer({ type: "line", id: "border", source, color: "#ff0000" });
    map.addLayer({
      type: "contour", id: "contour",
      source: makeField({ west: -6, east: 6, south: -20, north: 20 }, 4, 4, 2_000_000),
      levels: { interval: 500_000 }, color: "#00ff00",
    });

    await vi.waitFor(() => expect(map.scene.output.textContent ?? "").not.toBe(""));
    await new Promise((r) => setTimeout(r, 50));
    map.scene.rerender();

    expect(() => {
      map.removeLayer("border");
      map.scene.rerender();
      map.removeLayer("contour");
      map.scene.rerender();
    }).not.toThrow();

    map.destroy();
    host.remove();
  });
});

describe("createGlyphMap — MapsWorkbench's mount-time cascade (every layer effect also fires once on initial mount)", () => {
  // MapsWorkbench.tsx mounts `createGlyphMap` with `layers: [background,
  // terrain, border]` already included, THEN — because every
  // "recolor-or-remount" useEffect ALSO fires once on initial mount (React
  // runs every effect after the first commit, not only on a later
  // dependency change) — immediately does, synchronously, in effect
  // declaration order:
  //   removeLayer(TERRAIN); addLayer(TERRAIN)       (palette/density effect)
  //   removeLayer(BACKGROUND); addLayer(BACKGROUND) (background effect)
  //   removeLayer(BORDER); addLayer(BORDER)         (borders effect)
  //   removeLayer(CONTOUR)                          (contour effect, no-op: showContour defaults false)
  // each followed by its own `map.scene.rerender()`, all BEFORE any of the
  // provider's in-flight tile fetches (real async — `loadTile` is a
  // Promise) have resolved. This reproduces that exact sequence with real
  // async raster/vector providers.
  it("mount, then remove+re-add every layer synchronously before any tile fetch resolves", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);

    const rasterProvider: GlyphMapProvider = {
      id: "raster",
      zooms: [{ z: 0, cols: 1, rows: 1, tileLonSpan: 360, tileLatSpan: 180, tileCols: 2, tileRows: 2 }],
      bounds: () => ({ west: -180, east: 180, south: -90, north: 90 }),
      loadTile: async () => makeTile({ west: -180, east: 180, south: -90, north: 90 }, 2, 2, 500),
    };
    const vectorProvider: GlyphMapVectorProvider = {
      id: "vector",
      zooms: [{ z: 0, cols: 1, rows: 1, tileLonSpan: 360, tileLatSpan: 180, tileCols: 2, tileRows: 2 }],
      bounds: () => ({ west: -180, east: 180, south: -90, north: 90 }),
      loadTile: async () => ({ layers: { admin: [{ id: "eq", rings: [[[-18, 0], [18, 0]]] }] } }),
    };

    const map = createGlyphMap(host, {
      view: { center: [0, 0], span: 40, cols: 60, rows: 24 },
      projection: glyphMapEquirectangular(),
      tilt: 0,
      layers: [
        { type: "background", id: "background", color: "#05070c" },
        { type: "raster", id: "terrain", source: rasterProvider, density: 1 },
        { type: "line", id: "borders", source: vectorProvider, color: "#e8c988" },
      ],
    });

    expect(() => {
      map.removeLayer("terrain");
      map.addLayer({ type: "raster", id: "terrain", source: rasterProvider, density: 1 });
      map.scene.rerender();

      map.removeLayer("background");
      map.addLayer({ type: "background", id: "background", color: "#05070c" });
      map.scene.rerender();

      map.removeLayer("borders");
      map.addLayer({ type: "line", id: "borders", source: vectorProvider, color: "#e8c988" });
      map.scene.rerender();

      map.removeLayer("contour"); // not mounted — no-op
      map.scene.rerender();
    }).not.toThrow();

    // Now let every in-flight (and re-triggered) tile fetch resolve and
    // rerender again — this is where a stale/disposed-runtime reference
    // resolving late would surface.
    await new Promise((r) => setTimeout(r, 50));
    expect(() => map.scene.rerender()).not.toThrow();

    map.destroy();
    host.remove();
  });

  it("same cascade, then toggle Borders off while Terrain stays mounted at density > 1 (its own detail grid)", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);

    const rasterProvider: GlyphMapProvider = {
      id: "raster",
      zooms: [{ z: 0, cols: 1, rows: 1, tileLonSpan: 360, tileLatSpan: 180, tileCols: 2, tileRows: 2 }],
      bounds: () => ({ west: -180, east: 180, south: -90, north: 90 }),
      loadTile: async () => makeTile({ west: -180, east: 180, south: -90, north: 90 }, 2, 2, 500),
    };
    const vectorProvider: GlyphMapVectorProvider = {
      id: "vector",
      zooms: [{ z: 0, cols: 1, rows: 1, tileLonSpan: 360, tileLatSpan: 180, tileCols: 2, tileRows: 2 }],
      bounds: () => ({ west: -180, east: 180, south: -90, north: 90 }),
      loadTile: async () => ({ layers: { admin: [{ id: "eq", rings: [[[-18, 0], [18, 0]]] }] } }),
    };

    const map = createGlyphMap(host, {
      view: { center: [0, 0], span: 40, cols: 60, rows: 24 },
      projection: glyphMapEquirectangular(),
      tilt: 0,
      layers: [
        { type: "background", id: "background", color: "#05070c" },
        { type: "raster", id: "terrain", source: rasterProvider, density: 3 },
        { type: "line", id: "borders", source: vectorProvider, color: "#e8c988" },
      ],
    });

    await vi.waitFor(() => expect(map.scene.output.textContent ?? "").not.toBe(""));
    await new Promise((r) => setTimeout(r, 50));
    map.scene.rerender();

    // Unchecking "Borders" in the UI does exactly this.
    expect(() => {
      map.removeLayer("borders");
      map.scene.rerender();
    }).not.toThrow();

    await new Promise((r) => setTimeout(r, 50));
    expect(() => map.scene.rerender()).not.toThrow();

    map.destroy();
    host.remove();
  });
});
