/**
 * The LOD ladder, end to end — every level a provider declares, and what a
 * layer whose data starts deep gets at each of them.
 *
 * Written because of a report that `glyphMapTargetLOD` "steps z14 -> z12,
 * skipping z13, at about a 4 km span", which matters because the
 * OpenMapTiles `building` source layer starts at z13 (the vendored TileJSON's
 * own number, re-read below rather than quoted) — a skipped z13 would mean a
 * reader zooming out from a street loses every building in one step with no
 * level in between.
 *
 * It does not reproduce, and the tests below are what says so and keeps
 * saying so:
 *
 *  - `glyphMapTargetLOD` composed with `glyphMapMercatorZooms` visits EVERY
 *    declared level. Each level owns exactly one octave of `span/cols`,
 *    z13's included, and the real widget sweep requests all fifteen of them
 *    on the way out from a street view to the world.
 *  - What IS true is that z13's octave is narrow ON THE GROUND: at 140 cols
 *    it is `span` 0.02424..0.04849 deg, which at Zurich's latitude is
 *    1.83..3.66 km of ground across the viewport. A probe at "a street view"
 *    and another at "about 4 km" straddle it and land on z14 and z12 — which
 *    is the z13-is-missing reading, and is a property of where the two
 *    probes were taken, not of the ladder.
 *  - So buildings do vanish in one step, at a measured span, because the
 *    SCHEMA has none below z13 — not because a level was skipped. The last
 *    describe block pins that step's exact location and the counts either
 *    side, so the day the LOD rule or the ladder changes, the thing a reader
 *    actually notices moves visibly in this file.
 *
 * A skipped level IS possible for a provider whose declared ladder is not
 * strictly monotonic in native resolution; that hazard is demonstrated here
 * on a synthetic ladder and then excluded for every ladder this package
 * ships.
 *
 * happy-dom has no layout, hence `stubMonospaceMetrics`. Nothing here
 * touches the network: every provider is a local probe, and the one real
 * artefact read is the vendored TileJSON.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGlyphMap, type GlyphMapFillExtrusionLayer } from "./widget";
import { glyphMapEquirectangular } from "./projection";
import { glyphMapDegreesPerCell, glyphMapTargetLOD, type GlyphMapProviderZoomLevel } from "./provider";
import { glyphMapMercatorTileBounds, glyphMapMercatorTileRange, glyphMapMercatorZooms } from "./vector/mercator";
import { glyphMapOpenFreeMapProvider } from "./vector/openfreemap";
import { glyphMapOpenMapTilesLayers } from "./vector/openmaptiles";
import type { GlyphMapVectorFeature, GlyphMapVectorProvider, GlyphMapVectorTile } from "./vector/types";

const COLS = 140;
const ROWS = 63;
const CELL_W = 8;
const CELL_H = 16;
const BASE_FONT_PX = 16;
/** Zurich — where the vendored OSM tiles are, and the latitude the reported "4 km" was measured at. */
const CENTRE: readonly [number, number] = [8.54, 47.375];

const MIN_Z = 0;
const MAX_Z = 14;
const MERCATOR_ZOOMS = glyphMapMercatorZooms(MIN_Z, MAX_Z, 256);
/** Degrees of longitude per source sample at level `z` — what `glyphMapTargetLOD` compares against `span/cols`. */
const native = (z: number): number => {
  const level = MERCATOR_ZOOMS.find((l) => l.z === z);
  if (!level) throw new Error(`no level ${z}`);
  return level.tileLonSpan / level.tileCols;
};

const EMPTY_RECT = { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
const rect = (width: number, height: number): DOMRect =>
  ({ width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
const stubbedHosts = new Set<HTMLElement>();

function stubMonospaceMetrics(host: HTMLElement): void {
  stubbedHosts.add(host);
  if (vi.isMockFunction(Element.prototype.getBoundingClientRect)) return;
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const el = this as HTMLElement;
    if (stubbedHosts.has(el)) return rect(COLS * CELL_W, ROWS * CELL_H);
    if (el.tagName !== "PRE" || !/visibility:\s*hidden/.test(el.style.cssText)) return EMPTY_RECT;
    const fontPx = parseFloat(/font-size:\s*([\d.]+)px/.exec(el.style.cssText)?.[1] ?? String(BASE_FONT_PX));
    const k = fontPx / BASE_FONT_PX;
    const lines = (el.textContent ?? "").split("\n").length || 1;
    return rect(CELL_W * k, CELL_H * k * lines);
  });
}

const mounted: { destroy(): void }[] = [];
const hostsToRemove: HTMLElement[] = [];
afterEach(() => {
  for (const m of mounted.splice(0)) m.destroy();
  for (const h of hostsToRemove.splice(0)) h.remove();
  vi.restoreAllMocks();
  stubbedHosts.clear();
  document.body.innerHTML = "";
});

// ───────────────────────────────────────────────────── the rule, level by level

describe("`glyphMapTargetLOD` reaches every level `glyphMapMercatorZooms` declares", () => {
  const provider = { zooms: MERCATOR_ZOOMS };

  it("gives each declared level its own, non-empty window of degrees-per-cell", () => {
    // A level is chosen exactly on `native(z) <= degPerCell < native(z-1)`.
    // Asserting at both ends of every window is what says no level is
    // unreachable: an unreachable one would answer with a neighbour here.
    for (let z = MIN_Z; z <= MAX_Z; z++) {
      expect(glyphMapTargetLOD(provider, native(z))).toBe(z);
      if (z > MIN_Z) expect(glyphMapTargetLOD(provider, native(z - 1) * (1 - 1e-12))).toBe(z);
    }
  });

  it("in particular hands z13 a full octave between z14 and z12 — the level the report says is skipped", () => {
    expect(glyphMapTargetLOD(provider, native(13))).toBe(13);
    expect(glyphMapTargetLOD(provider, native(12) * (1 - 1e-12))).toBe(13);
    // One octave, exactly like every other level's.
    expect(native(12) / native(13)).toBeCloseTo(2, 12);
  });

  it("walks 14 -> 0 one level at a time as degrees-per-cell grows, never two", () => {
    const seen: number[] = [];
    for (let degPerCell = native(MAX_Z) / 4; degPerCell < native(MIN_Z) * 4; degPerCell *= 1.02) {
      const z = glyphMapTargetLOD(provider, degPerCell);
      if (seen[seen.length - 1] !== z) seen.push(z);
    }
    expect(seen).toEqual([14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0]);
  });

  it("keeps the deepest level when nothing is fine enough, and the coarsest when everything is", () => {
    expect(glyphMapTargetLOD(provider, 1e-9)).toBe(MAX_Z);
    expect(glyphMapTargetLOD(provider, 1e9)).toBe(MIN_Z);
  });
});

describe("a level is unreachable only when a declared ladder is not strictly monotonic", () => {
  /**
   * The hazard, made concrete: z6 is baked at HALF the samples per tile of
   * its neighbours, so it declares the same native resolution as z5 and adds
   * nothing between z5 and z7. `glyphMapTargetLOD` answers z5 for every
   * degrees-per-cell z6 would have served and z7 for the rest — z6 is
   * unreachable at any view, which is what a skipped level really looks like.
   */
  const flat: GlyphMapProviderZoomLevel[] = [
    { z: 5, cols: 32, rows: 32, tileLonSpan: 360 / 32, tileLatSpan: 180 / 32, tileCols: 256, tileRows: 256 },
    { z: 6, cols: 64, rows: 64, tileLonSpan: 360 / 64, tileLatSpan: 180 / 64, tileCols: 128, tileRows: 128 },
    { z: 7, cols: 128, rows: 128, tileLonSpan: 360 / 128, tileLatSpan: 180 / 128, tileCols: 256, tileRows: 256 },
  ];

  it("skips the level a non-monotonic ladder makes indistinguishable", () => {
    const reachable = new Set<number>();
    for (let d = 1e-6; d < 10; d *= 1.01) reachable.add(glyphMapTargetLOD({ zooms: flat }, d));
    expect([...reachable].sort((a, b) => a - b)).toEqual([5, 7]);
  });

  it("and no ladder this package ships is like that", () => {
    // Web Mercator (OpenFreeMap, PMTiles) …
    const sorted = [...MERCATOR_ZOOMS].sort((a, b) => a.z - b.z);
    for (let i = 1; i < sorted.length; i++) {
      expect(native(sorted[i]!.z)).toBeLessThan(native(sorted[i - 1]!.z));
    }
    // … and this package's own equal-angle pyramids, whose baked manifests
    // hold `tileCols` constant while `tileLonSpan` halves.
    const equalAngle = Array.from({ length: 8 }, (_, z) => ({
      z, cols: 2 ** z, rows: 2 ** z, tileLonSpan: 360 / 2 ** z, tileLatSpan: 180 / 2 ** z, tileCols: 180, tileRows: 90,
    }));
    for (let z = 0; z < equalAngle.length; z++) {
      expect(glyphMapTargetLOD({ zooms: equalAngle }, equalAngle[z]!.tileLonSpan / equalAngle[z]!.tileCols)).toBe(z);
    }
  });
});

// ─────────────────────────────────────────────── the ladder the sweep visits

function ladderProbe(): GlyphMapVectorProvider & { readonly loadTile: ReturnType<typeof vi.fn> } {
  const loadTile = vi.fn(async (z: number, x: number, y: number): Promise<GlyphMapVectorTile> => ({
    z, x, y, bounds: glyphMapMercatorTileBounds(z, x, y), source: "probe", simplify: "mvt-source", layers: {},
  }));
  return { id: "ladder-probe", zooms: MERCATOR_ZOOMS, tileRange: glyphMapMercatorTileRange, bounds: glyphMapMercatorTileBounds, loadTile };
}

async function sweepAt(span: number): Promise<{ readonly z: number; readonly tiles: number }> {
  const provider = ladderProbe();
  const host = document.createElement("div");
  document.body.appendChild(host);
  hostsToRemove.push(host);
  stubMonospaceMetrics(host);
  const map = createGlyphMap(host, {
    view: { center: [CENTRE[0], CENTRE[1]], span, cols: COLS, rows: ROWS },
    projection: glyphMapEquirectangular(),
    tilt: 0,
  });
  mounted.push(map);
  map.addLayer({ type: "line", id: "probe", source: provider, sourceLayer: "transportation", color: "#fff" });
  await vi.waitFor(() => expect(provider.loadTile).toHaveBeenCalled());
  const calls = provider.loadTile.mock.calls as [number, number, number][];
  return { z: calls[0]![0], tiles: calls.length };
}

describe("the real widget sweep requests every level on the way out", () => {
  it("asks for 14, 13, 12, 11 … in order as the view opens, with none missing", async () => {
    const seen: number[] = [];
    for (let span = native(MAX_Z) * COLS; span < 360; span *= 1.06) {
      const { z } = await sweepAt(span);
      if (seen[seen.length - 1] !== z) seen.push(z);
    }
    expect(seen).toEqual([14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0]);
  }, 60_000);

  it("puts the z14/z13 and z13/z12 steps exactly one octave apart, at the spans the rule predicts", async () => {
    const under = (z: number) => native(z) * COLS * (1 - 1e-9);
    const at = (z: number) => native(z) * COLS;
    // z13 owns span 0.0240326 .. 0.0480652 deg at 140 cols.
    expect(at(13)).toBeCloseTo(0.0240326, 6);
    expect(at(12)).toBeCloseTo(0.0480652, 6);
    expect((await sweepAt(under(13))).z).toBe(14);
    expect((await sweepAt(at(13))).z).toBe(13);
    expect((await sweepAt(under(12))).z).toBe(13);
    expect((await sweepAt(at(12))).z).toBe(12);
  }, 30_000);

  it("stays inside the sweep budget either side of the z13/z12 step", async () => {
    const deep = await sweepAt(native(12) * COLS * (1 - 1e-9));
    const shallow = await sweepAt(native(12) * COLS);
    expect(deep.z).toBe(13);
    expect(shallow.z).toBe(12);
    for (const { tiles } of [deep, shallow]) {
      expect(tiles).toBeGreaterThan(0);
      expect(tiles).toBeLessThanOrEqual(100);
    }
  }, 30_000);

  it("a paced wheel zoom-out visits z13 rather than jumping z14 -> z12", async () => {
    const provider = ladderProbe();
    const host = document.createElement("div");
    document.body.appendChild(host);
    hostsToRemove.push(host);
    stubMonospaceMetrics(host);
    const map = createGlyphMap(host, {
      view: { center: [CENTRE[0], CENTRE[1]], span: native(MAX_Z) * COLS, cols: COLS, rows: ROWS },
      projection: glyphMapEquirectangular(),
      tilt: 0,
    });
    mounted.push(map);
    map.addLayer({ type: "line", id: "probe", source: provider, sourceLayer: "transportation", color: "#fff" });
    await vi.waitFor(() => expect(provider.loadTile).toHaveBeenCalled());
    // Out through both octaves, letting the 180 ms tile debounce fire.
    while (map.getView().span < native(12) * COLS * 1.05) {
      host.dispatchEvent(new WheelEvent("wheel", { deltaY: 100, deltaMode: 0, bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 220));
    }
    const zs = [...new Set((provider.loadTile.mock.calls as [number, number, number][]).map((c) => c[0]))];
    expect(zs).toEqual([14, 13, 12]);
  }, 60_000);
});

// ─────────────────────────────── a layer whose data starts deeper than the view

const TILEJSON = path.resolve(__dirname, "../fixtures/openfreemap/tilejson.json");

/** The schema's own floor for buildings, read from the service's manifest rather than quoted. */
function buildingMinZoom(): number {
  const manifest = JSON.parse(readFileSync(TILEJSON, "utf8")) as {
    vector_layers: { id: string; minzoom: number }[];
  };
  const layer = manifest.vector_layers.find((l) => l.id === "building");
  if (!layer) throw new Error("no `building` layer in the vendored TileJSON");
  return layer.minzoom;
}

/** A block of footprints around the centre — one per grid slot, each with its own id. */
function blocks(count: number): GlyphMapVectorFeature[] {
  const out: GlyphMapVectorFeature[] = [];
  const side = Math.ceil(Math.sqrt(count));
  const pitch = 0.0016;
  const w = 0.0006;
  for (let i = 0; i < count; i++) {
    const lon = CENTRE[0] + ((i % side) - side / 2) * pitch;
    const lat = CENTRE[1] + (Math.floor(i / side) - side / 2) * pitch;
    const ring: [number, number][] = [[lon, lat], [lon + w, lat], [lon + w, lat + w], [lon, lat + w], [lon, lat]];
    out.push({
      id: `b${i}`,
      geometryType: "polygon",
      properties: { render_height: 12 + (i % 5) * 6, render_min_height: 0 },
      rings: [ring],
      polygons: [[ring]],
    });
  }
  return out;
}

const BUILDINGS = blocks(36);

/**
 * A provider carrying those footprints in a `building` source layer, present
 * only at or below the schema's own `minzoom` — the exact shape of the real
 * service, with nothing but the depth rule synthesised.
 */
function buildingProvider(minZoom: number): GlyphMapVectorProvider {
  return {
    id: "building-probe",
    zooms: MERCATOR_ZOOMS,
    tileRange: glyphMapMercatorTileRange,
    bounds: glyphMapMercatorTileBounds,
    async loadTile(z, x, y): Promise<GlyphMapVectorTile> {
      const bounds = glyphMapMercatorTileBounds(z, x, y);
      const inside = BUILDINGS.filter((f) => {
        const [lon, lat] = f.rings![0]![0]!;
        return lon >= bounds.west && lon < bounds.east && lat <= bounds.north && lat > bounds.south;
      });
      return { z, x, y, bounds, source: "building-probe", simplify: "mvt-source", layers: z >= minZoom ? { building: inside } : {} };
    },
  };
}

/** Mount the real `omt-buildings` row on that provider and report which footprints reached the mesh. */
async function buildingsDrawnAt(span: number, minZoom: number): Promise<{ readonly ids: Set<string>; readonly polygons: number }> {
  const provider = buildingProvider(minZoom);
  const host = document.createElement("div");
  document.body.appendChild(host);
  hostsToRemove.push(host);
  stubMonospaceMetrics(host);
  const map = createGlyphMap(host, {
    view: { center: [CENTRE[0], CENTRE[1]], span, cols: COLS, rows: ROWS },
    projection: glyphMapEquirectangular({ exaggeration: 1 }),
    tilt: 0,
  });
  mounted.push(map);
  let polygons = 0;
  const add = map.scene.add.bind(map.scene);
  map.scene.add = ((polys: Parameters<typeof add>[0], transform?: Parameters<typeof add>[1]) => {
    polygons += polys.length;
    return add(polys, transform);
  }) as typeof map.scene.add;

  const ids = new Set<string>();
  const built = glyphMapOpenMapTilesLayers(glyphMapOpenFreeMapProvider(), { include: ["omt-buildings"] })[0] as GlyphMapFillExtrusionLayer;
  map.addLayer({ ...built, source: provider, filter: (f) => { ids.add(String(f.id)); return true; } } as GlyphMapFillExtrusionLayer);
  await vi.waitFor(() => expect(polygons + ids.size).toBeGreaterThanOrEqual(0));
  // The mesh build is awaited inside the layer runtime's own update; give it
  // the microtask turn the sweep's `Promise.all` needs.
  await new Promise((r) => setTimeout(r, 50));
  return { ids, polygons };
}

describe("what a `building` layer gets either side of the step, and why it is the schema and not a skipped level", () => {
  it("the vendored OpenFreeMap manifest really does start `building` at z13", () => {
    expect(buildingMinZoom()).toBe(13);
  });

  it("draws every footprint at z14 and at z13, and none at z12", async () => {
    const minZoom = buildingMinZoom();
    const deepest = await buildingsDrawnAt(native(14) * COLS, minZoom);
    const last = await buildingsDrawnAt(native(12) * COLS * (1 - 1e-9), minZoom);
    const gone = await buildingsDrawnAt(native(12) * COLS, minZoom);

    // z14 and z13 both carry the layer, so the whole block is built.
    expect(deepest.ids.size).toBe(BUILDINGS.length);
    expect(deepest.polygons).toBeGreaterThan(0);
    expect(last.ids.size).toBe(BUILDINGS.length);
    expect(last.polygons).toBeGreaterThan(0);
    // One octave wider and the source layer is simply not in the tile.
    expect(gone.ids.size).toBe(0);
    expect(gone.polygons).toBe(0);
  }, 60_000);

  it("puts that cliff at the z13/z12 step, not at a skipped level", async () => {
    // The two spans above differ by one part in 1e9 and land on adjacent
    // levels — so the disappearance is the level change itself, and the
    // ladder had no gap to fall through.
    expect((await sweepAt(native(12) * COLS * (1 - 1e-9))).z).toBe(13);
    expect((await sweepAt(native(12) * COLS)).z).toBe(12);
  }, 30_000);

  it("is one octave of view span wide, which is a narrow band of GROUND at this latitude", () => {
    // The number the report reached for: the widest view that still shows a
    // building, in kilometres across, at Zurich.
    const kmPerDeg = 111.32 * Math.cos((CENTRE[1] * Math.PI) / 180);
    const widest = native(12) * COLS * kmPerDeg;
    const narrowest = native(13) * COLS * kmPerDeg;
    expect(widest).toBeCloseTo(3.62, 2);
    expect(narrowest).toBeCloseTo(1.81, 2);
    // And `glyphMapDegreesPerCell` is the only input the choice has, so the
    // band moves with the grid and with nothing else.
    expect(glyphMapDegreesPerCell({ center: [CENTRE[0], CENTRE[1]], span: native(12) * COLS, cols: COLS, rows: ROWS }))
      .toBeCloseTo(native(12), 12);
  });
});
