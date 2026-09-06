import { describe, expect, it, vi } from "vitest";
import { createGlyphMap } from "./widget";
import { glyphMapEquirectangular, glyphMapGlobe } from "./projection";
import { glyphMapBuildVectorTile, glyphMapDecodeVectorTile, glyphMapVectorTileBounds } from "./vector/tile";
import type { GlyphMapVectorFeature, GlyphMapVectorProvider } from "./vector/types";
import type { GlyphMapProvider, GlyphMapProviderZoomLevel } from "./provider";
import type { GlyphMapProjection } from "./projection";

/**
 * The four point-driven layers (`symbol`, `circle`, `heatmap`) plus `model`,
 * asserted on what they actually PAINT for a known city at a known view —
 * not on whether they mount.
 *
 * These layers were never broken so much as starved: `/maps` pointed all of
 * them at a country-POLYGON tile pyramid, and until `glyphMapBuildVectorTile`
 * learned to carry points (`vector/tile.ts`) no pyramid could have carried
 * city data anyway. `placeProvider` below therefore runs real cities through
 * the REAL bake (`glyphMapBuildVectorTile` -> `glyphMapDecodeVectorTile`),
 * not a hand-built in-memory collection, so a regression anywhere on that
 * path fails here rather than only on the website.
 *
 * Two fixture traps this file is written around:
 *   - happy-dom has no layout, so every position assertion goes through
 *     `map.project`, which reads the same camera the renderer does.
 *   - `sin(180 - L) === sin(L)`: on the globe a far-side point projects to
 *     its near-side twin's COLUMN. Every near/far assertion here is keyed on
 *     ROWS (two cities at opposite LATITUDES), never on columns.
 */

const COLS = 120;
const ROWS = 48;

/** Natural Earth `ne_50m_populated_places_simple` field names, verbatim. */
interface Place {
  readonly name: string;
  readonly lon: number;
  readonly lat: number;
  readonly pop_max: number;
  /** 0..1 log-normalized population — the derived column `bake-place-tiles.mjs` writes. */
  readonly pop_scale: number;
}

const ZURICH: Place = { name: "Zurich", lon: 8.548064, lat: 47.381934, pop_max: 1_108_000, pop_scale: 0.6 };
const LIMA: Place = { name: "Lima", lon: -77.05, lat: -12.05, pop_max: 8_012_000, pop_scale: 0.85 };

function placeFeature(place: Place): GlyphMapVectorFeature {
  return {
    id: place.name,
    geometryType: "point",
    properties: { name: place.name, pop_max: place.pop_max, pop_scale: place.pop_scale },
    rings: [[[place.lon, place.lat]]],
  };
}

function zoomLevel(z: number): GlyphMapProviderZoomLevel {
  return { z, cols: 2 ** z, rows: 2 ** z, tileLonSpan: 360 / 2 ** z, tileLatSpan: 180 / 2 ** z, tileCols: 180, tileRows: 90 };
}

/** A provider whose tiles come out of the real bake/decode pair, exactly like the baked `place-tiles` pyramid. */
function placeProvider(places: readonly Place[]): GlyphMapVectorProvider {
  const features = places.map(placeFeature);
  return {
    id: "places-test",
    zooms: [0, 1, 2].map(zoomLevel),
    bounds: glyphMapVectorTileBounds,
    async loadTile(z, x, y) {
      return glyphMapDecodeVectorTile(glyphMapBuildVectorTile({ places: features }, z, x, y, { source: "ne-test", simplify: "none" }));
    },
  };
}

function mount(overrides: Partial<Parameters<typeof createGlyphMap>[1]> = {}) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const map = createGlyphMap(host, {
    view: { center: [ZURICH.lon, ZURICH.lat], span: 20, cols: COLS, rows: ROWS },
    projection: glyphMapEquirectangular(),
    tilt: 0,
    ...overrides,
  });
  return { host, map, teardown: () => { map.destroy(); host.remove(); } };
}

function firePointer(host: HTMLElement, type: string, x: number, y: number, pointerId = 1): void {
  host.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, pointerId, bubbles: true }));
}

function gridLines(text: string): string[] {
  return text.split("\n");
}

/** Non-blank cells strictly inside a `radius`-cell box around `(col, row)`. */
function inkIn(text: string, col: number, row: number, radius: number): number {
  const lines = gridLines(text);
  let n = 0;
  for (let r = Math.max(0, Math.round(row) - radius); r <= Math.min(ROWS - 1, Math.round(row) + radius); r++) {
    for (let c = Math.max(0, Math.round(col) - radius); c <= Math.min(COLS - 1, Math.round(col) + radius); c++) {
      if ((lines[r]?.[c] ?? " ") !== " ") n++;
    }
  }
  return n;
}

describe("symbol layer — city labels from a baked point pyramid", () => {
  it("mounts a label carrying the city's real name, visible, at the city's own cell", async () => {
    const { host, map, teardown } = mount({
      layers: [{ type: "symbol", source: placeProvider([ZURICH]), sourceLayer: "places", textProperty: "name", priorityProperty: "pop_max" }],
    });
    try {
      await vi.waitFor(() => expect(host.querySelectorAll(".glyph-map-symbol")).toHaveLength(1));
      const label = host.querySelector<HTMLElement>(".glyph-map-symbol")!;
      expect(label.textContent).toBe("Zurich");
      expect(label.style.opacity).toBe("1");
      const at = map.project([ZURICH.lon, ZURICH.lat]);
      expect(at.visible).toBe(true);
      expect(at.col).toBeGreaterThan(0);
      expect(at.col).toBeLessThan(COLS);
    } finally { teardown(); }
  });

  /**
   * The reported defect verbatim: `/maps` filtered on `population_rank`, a
   * column Natural Earth does not have, so `minPriority` removed every
   * symbol. Pointed at a REAL population column the filter has to keep the
   * city above the threshold and drop the one below it.
   */
  it("minPriority filters on a real population column instead of removing everything", async () => {
    const source = placeProvider([ZURICH, LIMA]);
    const { host, map, teardown } = mount({
      view: { center: [0, 0], span: 340, cols: COLS, rows: ROWS },
      layers: [{ type: "symbol", source, sourceLayer: "places", textProperty: "name", priorityProperty: "pop_max", minPriority: 5_000_000 }],
    });
    try {
      await vi.waitFor(() => expect(host.querySelectorAll(".glyph-map-symbol").length).toBeGreaterThan(0));
      const names = [...host.querySelectorAll<HTMLElement>(".glyph-map-symbol")].map((el) => el.textContent);
      expect(names).toEqual(["Lima"]);
      void map;
    } finally { teardown(); }
  });

  it("hides a far-side city label on the globe — keyed on ROWS, since a far-side point shares its twin's column", async () => {
    const north: Place = { ...ZURICH, name: "North", lon: 0, lat: 30 };
    const south: Place = { ...ZURICH, name: "South", lon: 180, lat: -30 };
    const { host, map, teardown } = mount({
      view: { center: [0, 0], span: 160, cols: COLS, rows: ROWS },
      projection: glyphMapGlobe({ radius: 1, exaggeration: 0 }),
      layers: [{ type: "symbol", source: placeProvider([north, south]), sourceLayer: "places", textProperty: "name", priorityProperty: "pop_max" }],
    });
    try {
      await vi.waitFor(() => expect(host.querySelectorAll(".glyph-map-symbol")).toHaveLength(2));
      // The fixture's own premise: same column, different rows.
      const a = map.project([0, 30]);
      const b = map.project([180, -30]);
      expect(Math.round(a.col)).toBe(Math.round(b.col));
      expect(Math.round(a.row)).not.toBe(Math.round(b.row));
      expect(a.visible).toBe(true);
      expect(b.visible).toBe(false);
      await vi.waitFor(() => {
        const opacities = [...host.querySelectorAll<HTMLElement>(".glyph-map-symbol")].map((el) => el.style.opacity);
        expect(opacities.filter((o) => o === "1")).toHaveLength(1);
        expect(opacities.filter((o) => o === "0")).toHaveLength(1);
      });
    } finally { teardown(); }
  });

  /**
   * The reported live bug: "when you move with some inertia and the globe
   * keeps spinning, before finishing the spin some labels of the symbol
   * layer that shouldn't be visible flicker into view and disappear."
   *
   * Root cause: `applyDrag` (run synchronously on every `pointermove`)
   * updates `camera`/`view` immediately, but `syncMarkers()` — the thing
   * that keeps a symbol's `opacity` in sync with hemisphere visibility — was
   * only ever called from inside the widget's OWN deferred motion frame
   * (`motionStep`, one rAF later). `/maps` (`MapsWorkbench.tsx`) drives its
   * own `interactiveDownscale` off the SAME native `pointerup`, and its
   * handler calls `map.scene.rerender()` directly to settle the drag-density
   * font-size change — a plain escape-hatch call (AGENTS.md: "`map.scene` is
   * the escape hatch for anything not modeled on the widget surface"), fired
   * on `window` and so, by event-bubble order, AFTER the widget's own
   * `host`-level `pointerup` handler already started the inertial glide.
   * `scene.rerender()` re-stages every hotspot's glyphcss-owned `display`
   * from the CURRENT (already-dragged) camera — but `opacity` is a channel
   * glyphcss's commit never touches, so whatever `syncMarkers()` last wrote
   * (the PRE-drag near-side value) survives untouched, unhidden by the fresh
   * `display: ""`. The label reads as briefly visible until the next real
   * motion frame corrects it — the flicker.
   *
   * This test reproduces the race directly: drag far enough in ONE
   * `pointermove` to carry a centred city past the limb, WITHOUT awaiting a
   * frame (so the widget's own deferred sync has not run yet), then call
   * `map.scene.rerender()` exactly like `MapsWorkbench.tsx`'s `onUp` does —
   * and assert the label is already hidden, not stale.
   */
  it("a raw scene.rerender() from OUTSIDE the widget (mid-drag, before the widget's own motion frame) never observes a stale near-side opacity", async () => {
    const centred: Place = { ...ZURICH, name: "Centred", lon: 0, lat: 0 };
    const { host, map, teardown } = mount({
      view: { center: [0, 0], span: 140, cols: COLS, rows: ROWS },
      projection: glyphMapGlobe({ radius: 1, exaggeration: 0 }),
      tilt: 0,
      layers: [{ type: "symbol", source: placeProvider([centred]), sourceLayer: "places", textProperty: "name", priorityProperty: "pop_max" }],
    });
    try {
      await vi.waitFor(() => expect(host.querySelectorAll(".glyph-map-symbol")).toHaveLength(1));
      const label = host.querySelector<HTMLElement>(".glyph-map-symbol")!;
      expect(map.project([0, 0]).visible).toBe(true);
      expect(label.style.opacity).toBe("1");

      // ONE large drag carries the centred city past the limb — no frame
      // awaited, so the widget's own deferred motion-frame sync has not run.
      firePointer(host, "pointerdown", 400, 300);
      firePointer(host, "pointermove", 2900, 300);
      expect(map.project([0, 0]).visible).toBe(false);

      // The exact call `MapsWorkbench.tsx`'s onUp makes to settle
      // `interactiveDownscale`, bypassing the widget's own marker sync.
      map.scene.rerender();

      expect(label.style.opacity).toBe("0");

      firePointer(host, "pointerup", 2900, 300);
    } finally { teardown(); }
  });
});

describe("circle layer — radius from a real population column", () => {
  it("radiusScale converts a normalized attribute into a pixel radius", async () => {
    const { host, teardown } = mount({
      layers: [{ type: "circle", source: placeProvider([ZURICH]), sourceLayer: "places", radiusProperty: "pop_scale", radiusScale: 15, color: "#f59e0b" }],
    });
    try {
      await vi.waitFor(() => expect(host.querySelectorAll(".glyph-map-circle")).toHaveLength(1));
      const dot = host.querySelector<HTMLElement>(".glyph-map-circle")!;
      // 0.6 * 15 = 9px radius -> an 18px box.
      expect(dot.style.width).toBe("18px");
      expect(dot.style.height).toBe("18px");
      expect(dot.style.visibility).not.toBe("hidden");
    } finally { teardown(); }
  });

  it("without radiusScale the raw attribute is the radius — the pre-existing contract, unchanged", async () => {
    const { host, teardown } = mount({
      layers: [{ type: "circle", source: placeProvider([ZURICH]), sourceLayer: "places", radiusProperty: "pop_scale" }],
    });
    try {
      await vi.waitFor(() => expect(host.querySelectorAll(".glyph-map-circle")).toHaveLength(1));
      // 0.6 -> clamped to the 1px floor -> a 2px box.
      expect(host.querySelector<HTMLElement>(".glyph-map-circle")!.style.width).toBe("2px");
    } finally { teardown(); }
  });

  it("hides a far-side city on the globe — keyed on ROWS, since a far-side point shares its twin's column", async () => {
    const north: Place = { ...ZURICH, name: "North", lon: 0, lat: 30 };
    const south: Place = { ...ZURICH, name: "South", lon: 180, lat: -30 };
    const { host, map, teardown } = mount({
      view: { center: [0, 0], span: 160, cols: COLS, rows: ROWS },
      projection: glyphMapGlobe({ radius: 1, exaggeration: 0 }),
      layers: [{ type: "circle", source: placeProvider([north, south]), sourceLayer: "places", radiusProperty: "pop_scale", radiusScale: 10 }],
    });
    try {
      await vi.waitFor(() => expect(host.querySelectorAll(".glyph-map-circle")).toHaveLength(2));
      // The fixture's own premise: same column, different rows.
      const a = map.project([0, 30]);
      const b = map.project([180, -30]);
      expect(Math.round(a.col)).toBe(Math.round(b.col));
      expect(Math.round(a.row)).not.toBe(Math.round(b.row));
      expect(a.visible).toBe(true);
      expect(b.visible).toBe(false);
      const shown = [...host.querySelectorAll<HTMLElement>(".glyph-map-circle")].filter((el) => el.style.visibility !== "hidden");
      expect(shown).toHaveLength(1);
    } finally { teardown(); }
  });
});

describe("heatmap layer — population relief over the land", () => {
  const BOUNDS = { west: -20, east: 20, south: -8, north: 8 } as const;
  const HOT: Place = { name: "Hot", lon: 10, lat: 4, pop_max: 20_000_000, pop_scale: 1 };

  function heatMount(threshold: number) {
    return mount({
      view: { center: [0, 0], span: 40, cols: COLS, rows: ROWS },
      layers: [{
        type: "heatmap", source: { features: [placeFeature(HOT)] },
        bounds: BOUNDS, radius: 3, weightProperty: "pop_scale", threshold,
        height: 50_000, colors: ["#111827", "#ef4444"],
      }],
    });
  }

  it("paints ink over the weighted city and leaves the empty half of the field alone", async () => {
    const { map, teardown } = heatMount(0.15);
    try {
      await vi.waitFor(() => expect(map.scene.output.textContent?.replace(/\s/g, "").length).toBeGreaterThan(0));
      const text = map.scene.output.textContent ?? "";
      const hot = map.project([HOT.lon, HOT.lat]);
      const cold = map.project([-HOT.lon, -HOT.lat]);
      expect(Math.round(hot.row)).not.toBe(Math.round(cold.row));
      expect(inkIn(text, hot.col, hot.row, 2)).toBeGreaterThan(0);
      expect(inkIn(text, cold.col, cold.row, 2)).toBe(0);
    } finally { teardown(); }
  });

  /**
   * `threshold: 0` is the pre-existing behaviour — one unbroken sheet over
   * the layer's whole `bounds`, which is exactly why the layer read as
   * "does nothing useful" on a real, mostly-empty point dataset: it covers
   * and z-fights the terrain everywhere instead of overlaying it.
   */
  it("threshold is what makes it an overlay: at 0 the same field covers the cold cells too", async () => {
    const { map, teardown } = heatMount(0);
    try {
      await vi.waitFor(() => expect(map.scene.output.textContent?.replace(/\s/g, "").length).toBeGreaterThan(0));
      const text = map.scene.output.textContent ?? "";
      const cold = map.project([-HOT.lon, -HOT.lat]);
      expect(inkIn(text, cold.col, cold.row, 2)).toBeGreaterThan(0);
    } finally { teardown(); }
  });

  it("weights by the named attribute — a zero-weight city leaves no relief where a heavy one does", async () => {
    const light: Place = { ...HOT, pop_scale: 0 };
    const { map, teardown } = mount({
      view: { center: [0, 0], span: 40, cols: COLS, rows: ROWS },
      layers: [{
        type: "heatmap", source: { features: [placeFeature(light)] },
        bounds: BOUNDS, radius: 3, weightProperty: "pop_scale", threshold: 0.15,
        height: 50_000, colors: ["#111827", "#ef4444"],
      }],
    });
    try {
      await vi.waitFor(() => expect(map.getView().span).toBe(40));
      const hot = map.project([HOT.lon, HOT.lat]);
      expect(inkIn(map.scene.output.textContent ?? "", hot.col, hot.row, 2)).toBe(0);
    } finally { teardown(); }
  });

  it("drops the far hemisphere on the globe — keyed on rows", async () => {
    const north: Place = { name: "N", lon: 0, lat: 30, pop_max: 1, pop_scale: 1 };
    const far: Place = { name: "F", lon: 180, lat: -30, pop_max: 1, pop_scale: 1 };
    const { map, teardown } = mount({
      view: { center: [0, 0], span: 160, cols: COLS, rows: ROWS },
      projection: glyphMapGlobe({ radius: 1, exaggeration: 1 }),
      layers: [{
        type: "heatmap", source: { features: [placeFeature(north), placeFeature(far)] },
        radius: 2, weightProperty: "pop_scale", threshold: 0.2, height: 200_000, colors: ["#111827", "#ef4444"],
      }],
    });
    try {
      await vi.waitFor(() => expect(map.scene.output.textContent?.replace(/\s/g, "").length).toBeGreaterThan(0));
      const text = map.scene.output.textContent ?? "";
      const near = map.project([0, 30]);
      const behind = map.project([180, -30]);
      expect(Math.round(near.col)).toBe(Math.round(behind.col));
      expect(Math.round(near.row)).not.toBe(Math.round(behind.row));
      expect(inkIn(text, near.col, near.row, 1)).toBeGreaterThan(0);
      expect(inkIn(text, behind.col, behind.row, 1)).toBe(0);
    } finally { teardown(); }
  });

  /**
   * The reported live bug: "the heatmap layer doesn't really begin glued to
   * the planet — it should start from the surface, doesn't make sense to
   * have it floating."
   *
   * Root cause: the heatmap's synthesized relief tile built its elevation
   * from the layer's own normalized density ALONE (`own * reliefHeight`),
   * with no term for the terrain elevation beneath — a shell at a fixed
   * radius from the datum, floating over ocean basins and piercing
   * mountains, sitting exactly at 0 wherever density is 0.
   *
   * Mounts a flat SYNTHETIC raster terrain at a known, large elevation
   * (`TERRAIN_ELEV`) then an EMPTY-feature heatmap (density 0 everywhere,
   * `threshold: 0` so every vertex is defined, not NaN) over it, and reads
   * the heatmap's OWN mounted mesh's real world-Z vertex coordinates
   * directly — intercepting `scene.add` (the same technique
   * `widget.reliefResolution.test.ts` uses), not a global projection spy:
   * the widget itself calls `projection.project(lon, lat, 0)` for camera
   * framing on every settle, which a spy on `project()` can't tell apart
   * from a genuine floating-at-the-datum heatmap vertex. `scene.add` is
   * called once per mesh rebuild, so its polygons ARE exactly (and only)
   * that rebuild's own vertices.
   *
   * With no relief contribution at all, a heatmap vertex's world Z should
   * sit near the terrain's own (not nonzero the datum's 0), and — since
   * `glyphMapPolygons` feeds the SAME raw elevation into the SAME
   * `projection.project` terrain itself goes through — scaling exaggeration
   * should scale the heatmap's world Z by the same factor, proving the fix
   * doesn't hand-roll its own exaggeration math.
   */
  it("hugs the terrain surface instead of floating at the datum, and tracks exaggeration through the SAME projection formula terrain uses", async () => {
    const TERRAIN_ELEV = 5000;
    const terrainProvider: GlyphMapProvider = {
      id: "flat-terrain",
      zooms: [{ z: 0, cols: 1, rows: 1, tileLonSpan: 360, tileLatSpan: 180, tileCols: 1, tileRows: 1 }],
      bounds: () => ({ west: -180, east: 180, south: -90, north: 90 }),
      async loadTile() {
        return {
          bounds: { west: -180, east: 180, south: -90, north: 90 },
          cols: 2, rows: 2,
          elevation: new Float32Array(9).fill(TERRAIN_ELEV),
          source: "flat-terrain-test", sampler: "nearest",
        };
      },
    };

    /** The heatmap's own mounted mesh's vertex world-Z values, at a given exaggeration. */
    async function heatmapVertexZs(exaggeration: number): Promise<number[]> {
      const host = document.createElement("div");
      document.body.appendChild(host);
      const map = createGlyphMap(host, {
        view: { center: [0, 0], span: 40, cols: COLS, rows: ROWS },
        projection: glyphMapEquirectangular({ exaggeration }),
        tilt: 0,
        layers: [{ type: "raster", id: "terrain", source: terrainProvider }],
      });
      // Wrapped AFTER the constructor's own `raster` layer already mounted
      // (synchronously, inside `createGlyphMap`), so only the heatmap layer
      // added below is ever captured — no size-based filtering needed, kept
      // anyway as a belt-and-braces safety net.
      const batches: number[][] = [];
      const realAdd = map.scene.add.bind(map.scene);
      (map.scene as { add: typeof realAdd }).add = (polygons, transform) => {
        batches.push(polygons.map((p) => p.vertices[0]![2]));
        return realAdd(polygons, transform);
      };
      map.addLayer({
        type: "heatmap", id: "heatmap", source: { features: [] },
        bounds: { west: -20, east: 20, south: -10, north: 10 }, threshold: 0, height: 1000,
        colors: ["#111827", "#ef4444"],
      });
      await vi.waitFor(() => expect(batches.some((b) => b.length > 1000)).toBe(true));
      const heatmapBatch = batches.find((b) => b.length > 1000)!;
      map.destroy();
      host.remove();
      return heatmapBatch;
    }

    const atExaggeration1 = await heatmapVertexZs(1);
    // Not floating at the datum: every heatmap vertex's world Z must be
    // clearly nonzero (the pre-fix bug put every one of them at EXACTLY 0).
    expect(atExaggeration1.every((z) => Math.abs(z) > 1e-6)).toBe(true);

    const atExaggeration4 = await heatmapVertexZs(4);
    // The SAME raw elevation run through the SAME `reliefZ` scaling, at 4x
    // exaggeration, must scale world Z by ~4x — not by some OTHER factor a
    // hand-rolled, heatmap-local exaggeration multiply could introduce.
    const ratio = atExaggeration4[0]! / atExaggeration1[0]!;
    expect(ratio).toBeCloseTo(4, 1);
  });
});

describe("fill-extrusion layer — heightScale turns an attribute into metres", () => {
  const square: GlyphMapVectorFeature = {
    geometryType: "polygon",
    properties: { pop_scale: 0.8 },
    rings: [[[-4, -4], [4, -4], [4, 4], [-4, 4], [-4, -4]]],
  };

  it("an attribute-driven extrusion is visibly taller than the same feature flat", async () => {
    const projection = glyphMapEquirectangular({ exaggeration: 1 });
    const heights: number[] = [];
    const spy = { ...projection, project(lon: number, lat: number, elev: number) { heights.push(elev); return projection.project(lon, lat, elev); } };
    const { map, teardown } = mount({
      view: { center: [0, 0], span: 40, cols: COLS, rows: ROWS },
      projection: spy,
      layers: [{ type: "fill-extrusion", source: { features: [square] }, heightProperty: "pop_scale", heightScale: 500_000, color: "#94a3b8" }],
    });
    try {
      await vi.waitFor(() => expect(map.scene.output.textContent?.replace(/\s/g, "").length).toBeGreaterThan(0));
      // 0.8 * 500,000 = 400,000 m — without `heightScale` this would be 0.8 m.
      // `localUpDirection`'s winding probe also projects `elev + 1`, so the
      // exact value has to be asserted by membership, not by the maximum.
      expect(heights).toContain(400_000);
    } finally { teardown(); }
  });
});

describe("model layer — caller-authored 3D geometry anchored at a place", () => {
  /**
   * A square in the map's own world frame (X = north/south, Y = east/west,
   * Z = elevation), wound front-facing toward a `tilt: 0` sheet camera —
   * the same winding `widget.renderMode.test.ts`'s own model fixture pins.
   */
  function markerAt(lon: number, lat: number, halfDeg: number) {
    const z = 0.05;
    return [{
      vertices: [
        [-lat - halfDeg, lon - halfDeg, z],
        [-lat + halfDeg, lon - halfDeg, z],
        [-lat + halfDeg, lon + halfDeg, z],
        [-lat - halfDeg, lon + halfDeg, z],
      ] as [number, number, number][],
      color: "#38bdf8",
    }];
  }

  it("paints ink at the anchored place and nowhere else", async () => {
    const { map, teardown } = mount({
      view: { center: [0, 0], span: 40, cols: COLS, rows: ROWS },
      layers: [{ type: "model", polygons: markerAt(10, 4, 1.5) }],
    });
    try {
      await vi.waitFor(() => expect(map.scene.output.textContent?.replace(/\s/g, "").length).toBeGreaterThan(0));
      const text = map.scene.output.textContent ?? "";
      const at = map.project([10, 4]);
      const away = map.project([-10, -4]);
      expect(Math.round(at.row)).not.toBe(Math.round(away.row));
      expect(inkIn(text, at.col, at.row, 1)).toBeGreaterThan(0);
      expect(inkIn(text, away.col, away.row, 1)).toBe(0);
    } finally { teardown(); }
  });
});
