/**
 * Strokes are DRAPED on the terrain: a `line` layer's vertices are projected
 * at the ground elevation under their own lon/lat, not at the datum.
 *
 * The defect this pins. Everything else in a `/maps` scene stands on the
 * exaggerated relief — the terrain mesh by construction, a `fill-extrusion`
 * since `d517143` planted it on `groundElevationSampler` — while `line`
 * vertices were projected at elevation ZERO. Under a tilt that relief has
 * PARALLAX, so a road drawn at sea level lands somewhere the ground it
 * belongs to is not: at `/maps`' default 24x exaggeration and 4.8 m per cell,
 * 10 m of ground moves the building on it 16 rows and moved the road beside
 * it by nothing at all, so the two no longer coincided.
 *
 * The previous slice (`9191e4b`) forgave that offset in the DEPTH TEST
 * (`GLYPH_MAP_STROKE_GROUND_MARGIN`), which fixed WHETHER a stroke was
 * occluded and left WHERE IT IS DRAWN wrong. With the same sampler now
 * feeding the projection itself, the forgiveness has no premise left: a
 * draped stroke's own depth already is the ground's depth, so the second
 * projection per vertex and the margin both go, and the ordinary
 * slope-scaled coplanar bias is the whole allowance.
 *
 * THE EXPECTED ROW, ANALYTICALLY. `glyphMapGlobe.project(lon, lat, h)` is
 * `(1 + h·exaggeration / R_earth)` times `project(lon, lat, 0)` — purely
 * radial — and the widget's only camera is orthographic, whose `project()`
 * is AFFINE in the world point. So with `b` the row the world ORIGIN maps to,
 * `row(k·P) = b + k·(row(P) - b)`, and `b` itself is recoverable from public
 * API alone: `row(P) + row(-P) = 2b`, and `-P` is the ANTIPODE's own
 * sea-level projection. No widget internals, no hard-coded framing.
 *
 * happy-dom has no layout, hence `stubMonospaceMetrics`. Assertions are on
 * EXACT rows (and exact cells within them), never a row-wide ink count — on
 * a globe `sin(180 - L) === sin(L)`, so a far-side point shares its near-side
 * twin's COLUMN and only rows separate the two.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGlyphMap } from "./widget";
import { GLYPH_MAP_EARTH_RADIUS_M, glyphMapGlobe } from "./projection";
import type { GlyphMapProvider } from "./provider";
import type { GlyphMapGeoTile } from "./tile";
import type { GlyphMapVectorFeature } from "./vector/types";

const COLS = 140;
const ROWS = 63;
const CELL_W = 8;
const CELL_H = 16;
const BASE_FONT_PX = 16;
/** `/maps`' own default pitch — with no tilt the ground's parallax is zero and there is nothing to observe. */
const TILT = 40;
const EXAGGERATION = 24;
/** Zurich, at a span where a city block is legible: ~670 m across, 4.8 m per cell. */
const CENTRE: readonly [number, number] = [8.54, 47.375];
const SPAN = 0.006;
/**
 * Small on purpose. At 24x and 4.8 m per cell, 10 m of ground is already 16
 * rows of displacement and 400 m would be 2,000 — a true statement about 24x
 * relief under a tilted camera, and one no 63-row viewport can observe (the
 * same reason `widget.extrusionGround.test.ts` measures 5 m and 10 m).
 */
const GROUND_M = 10;
/** Half-width of the building footprint in degrees (~89 m of latitude). */
const HALF = 0.0008;
/** A real OSM `render_height` for a mid-rise block, in TRUE metres. */
const BUILDING_M = 60;

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
});

function mount() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  hostsToRemove.push(host);
  stubMonospaceMetrics(host);
  const map = createGlyphMap(host, {
    view: { center: [CENTRE[0], CENTRE[1]], span: SPAN, cols: COLS, rows: ROWS },
    projection: glyphMapGlobe({ exaggeration: EXAGGERATION }),
    tilt: TILT,
  });
  mounted.push(map);
  return map;
}

/** Uniform terrain at `elevM`, as a z0-z4 provider — the shape `bake-geo-tiles.mjs` produces. */
function terrainProvider(elevM: number): GlyphMapProvider {
  const zooms = [0, 1, 2, 3, 4].map((z) => ({
    z, cols: 2 ** z, rows: 2 ** z, tileLonSpan: 360 / 2 ** z, tileLatSpan: 180 / 2 ** z, tileCols: 32, tileRows: 32,
  }));
  const bounds = (z: number, x: number, y: number) => {
    const level = zooms[z];
    const west = -180 + x * level.tileLonSpan;
    const north = 90 - y * level.tileLatSpan;
    return { west, east: west + level.tileLonSpan, south: north - level.tileLatSpan, north };
  };
  return {
    id: "stroke-drape-terrain",
    zooms,
    bounds,
    async loadTile(z, x, y): Promise<GlyphMapGeoTile> {
      return { bounds: bounds(z, x, y), cols: 32, rows: 32, elevation: new Float32Array(33 * 33).fill(elevM), source: "stroke-drape", sampler: "nearest" };
    },
  };
}

function squareRing(lon: number, lat: number, half: number): [number, number][] {
  return [[lon - half, lat - half], [lon + half, lat - half], [lon + half, lat + half], [lon - half, lat + half], [lon - half, lat - half]];
}

const building: GlyphMapVectorFeature = {
  id: "block",
  geometryType: "polygon",
  rings: [squareRing(CENTRE[0], CENTRE[1], HALF)],
  properties: { render_height: BUILDING_M },
};

/** A straight west-east road through `CENTRE`, long enough to leave open road on both flanks of the building. */
const road: GlyphMapVectorFeature = {
  id: "street",
  geometryType: "line",
  rings: [[[CENTRE[0] - 0.02, CENTRE[1]], [CENTRE[0] + 0.02, CENTRE[1]]]],
};

const rows = (map: { scene: { output: { textContent: string | null } } }): string[] => (map.scene.output.textContent ?? "").split("\n");

/** Every cell this render CHANGED relative to `before` — i.e. the cells the stroke layer itself inked. */
function inkedCells(before: readonly string[], after: readonly string[]): { row: number; col: number }[] {
  const out: { row: number; col: number }[] = [];
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      if ((before[row]?.[col] ?? " ") !== (after[row]?.[col] ?? " ")) out.push({ row, col });
    }
  }
  return out;
}

/**
 * The row `(lon, lat)` reaches at elevation `elevM`, from public API only —
 * see this file's header for the derivation. The antipode probe recovers the
 * world origin's own row; the radial factor does the rest.
 */
function groundRowFor(map: ReturnType<typeof createGlyphMap>, lon: number, lat: number, elevM: number): number {
  const near = map.project([lon, lat]);
  const far = map.project([lon + 180, -lat]);
  const originRow = (near.row + far.row) / 2;
  const k = 1 + (elevM / GLYPH_MAP_EARTH_RADIUS_M) * EXAGGERATION;
  return originRow + k * (near.row - originRow);
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 150));

/**
 * Wait for the TILE SET to stop changing, not for a fixed number of
 * milliseconds. A fixed sleep is a machine-speed bet: under the full
 * workspace suite these fixtures take 4x as long to settle as they do alone,
 * and a fine tier that has not landed yet reads as the coarse one's ground —
 * a real failure signal fired at the wrong moment.
 */
async function settleFrames(map: { scene: { rerender(): void; output: { textContent: string | null } } }): Promise<void> {
  let previous = "";
  let stable = 0;
  for (let i = 0; i < 80 && stable < 3; i++) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    map.scene.rerender();
    const frame = map.scene.output.textContent ?? "";
    stable = frame === previous ? stable + 1 : 0;
    previous = frame;
  }
}

async function renderWithRoadOverGround(groundM: number): Promise<{
  map: ReturnType<typeof createGlyphMap>;
  inked: { row: number; col: number }[];
  datumRow: number;
  groundRow: number;
}> {
  const map = mount();
  map.addLayer({ type: "raster", id: "terrain", source: terrainProvider(groundM) });
  await settle();
  map.scene.rerender();
  const before = rows(map);

  map.addLayer({ type: "line", id: "roads", source: { features: [road] }, color: "#e8c988" });
  await settle();
  map.scene.rerender();
  const after = rows(map);

  return {
    map,
    inked: inkedCells(before, after),
    datumRow: map.project([CENTRE[0], CENTRE[1]]).row,
    groundRow: groundRowFor(map, CENTRE[0], CENTRE[1], groundM),
  };
}

describe("createGlyphMap — a stroke is drawn on the ground under it", () => {
  it("inks the road on the terrain's own row, not the datum's", async () => {
    const { inked, datumRow, groundRow } = await renderWithRoadOverGround(GROUND_M);

    // The premise: at this framing the ground is genuinely somewhere else on
    // screen. Without this the assertions below would pass for a stroke that
    // never moved.
    const displacement = Math.abs(groundRow - datumRow);
    expect(displacement).toBeGreaterThan(8);
    expect(groundRow).toBeGreaterThan(0);
    expect(groundRow).toBeLessThan(ROWS - 1);

    expect(inked.length).toBeGreaterThan(100);
    // Cell-exact, both ways: EVERY inked cell is on the ground's own row
    // (±1 for the sub-cell walk), and NOT ONE is on the datum's.
    const target = Math.floor(groundRow);
    const datum = Math.floor(datumRow);
    for (const cell of inked) expect(Math.abs(cell.row - target)).toBeLessThanOrEqual(1);
    expect(inked.filter((c) => c.row === datum)).toEqual([]);
  });

  it("moves with the ground: twice the elevation, twice the displacement", async () => {
    const low = await renderWithRoadOverGround(5);
    // Asserted, not assumed: `Math.min` of an EMPTY ink set is `Infinity`,
    // and `Infinity` satisfies every relation below — so a mutation that
    // makes the road vanish entirely would pass this test vacuously.
    expect(low.inked.length).toBeGreaterThan(100);
    const lowRow = Math.min(...low.inked.map((c) => c.row));
    low.map.destroy();
    const high = await renderWithRoadOverGround(10);
    expect(high.inked.length).toBeGreaterThan(100);
    const highRow = Math.min(...high.inked.map((c) => c.row));

    const shiftLow = Math.abs(lowRow - Math.floor(low.datumRow));
    const shiftHigh = Math.abs(highRow - Math.floor(high.datumRow));
    expect(shiftLow).toBeGreaterThan(0);
    // A drape that read a CONSTANT (or forgave the offset in depth only)
    // gives the same shift for both grounds; one that reads the sampler
    // doubles it.
    expect(shiftHigh).toBeGreaterThanOrEqual(shiftLow * 2 - 1);
    expect(shiftHigh).toBeLessThanOrEqual(shiftLow * 2 + 1);
  });

  it("coincides with the building standing on the same ground — the road runs into it and is occluded", async () => {
    const map = mount();
    map.addLayer({ type: "raster", id: "terrain", source: terrainProvider(GROUND_M) });
    map.addLayer({ type: "fill-extrusion", id: "buildings", source: { features: [building] }, color: "#94a3b8", heightProperty: "render_height" });
    await settle();
    map.scene.rerender();
    const before = rows(map);

    map.addLayer({ type: "line", id: "roads", source: { features: [road] }, color: "#e8c988" });
    await settle();
    map.scene.rerender();
    const after = rows(map);

    const groundRow = Math.floor(groundRowFor(map, CENTRE[0], CENTRE[1], GROUND_M));
    const west = map.project([CENTRE[0] - HALF, CENTRE[1]]);
    const east = map.project([CENTRE[0] + HALF, CENTRE[1]]);
    // A radial lift under an orthographic camera moves a point along the
    // ROW axis only, so the footprint's columns are unchanged by the drape.
    const footprintWest = Math.ceil(Math.min(west.col, east.col));
    const footprintEast = Math.floor(Math.max(west.col, east.col));
    expect(footprintEast - footprintWest).toBeGreaterThan(10);

    const inked = inkedCells(before, after).filter((c) => Math.abs(c.row - groundRow) <= 1);
    // The road IS on the building's row band now — the whole point.
    expect(inked.length).toBeGreaterThan(50);
    // ...and the building occludes it there, cell for cell.
    expect(inked.filter((c) => c.col > footprintWest && c.col < footprintEast)).toEqual([]);
    expect(inked.filter((c) => c.col < footprintWest - 1).length).toBeGreaterThan(20);
    expect(inked.filter((c) => c.col > footprintEast + 1).length).toBeGreaterThan(20);
  });

  it("is byte-identical to the pre-drape render when no raster layer is mounted", async () => {
    const map = mount();
    map.addLayer({ type: "fill-extrusion", id: "buildings", source: { features: [building] }, color: "#94a3b8", heightProperty: "render_height" });
    map.addLayer({ type: "line", id: "roads", source: { features: [road] }, color: "#e8c988" });
    await settle();
    map.scene.rerender();
    const frame = map.scene.output.textContent ?? "";
    // Captured from the build at `d517143`, BEFORE draping existed: with no
    // `raster` layer mounted `groundElevationSampler()` is `null`, the ground
    // is the datum for every vertex, and not one extra lookup or projection
    // runs anywhere.
    let hash = 5381;
    for (let i = 0; i < frame.length; i++) hash = ((hash * 33) ^ frame.charCodeAt(i)) >>> 0;
    expect({ hash, length: frame.length }).toEqual({ hash: 3172211336, length: 8882 });
  });
});

/**
 * The one allowance a draped stroke still needs, and the only test that goes
 * red when it is removed.
 *
 * A stroke is draped on the GROUND FIELD (`glyphMapGeoTileElevationAt`,
 * bilinear over the tile's full vertex grid) while the terrain is RASTERIZED
 * from a coarsened quad mesh (`glyphMapPolygons`' per-level `resolution`),
 * whose chord cuts under every rise inside a quad and over every dip. So the
 * draped stroke is not exactly coplanar with the surface drawn under it: it
 * reads BEHIND that surface on a measurable fraction of its own cells, and a
 * depth test with no allowance drops every one of them.
 *
 * Measured on this fixture (a 3,800 m gaussian ridge plus 200 m of
 * tile-scale roughness, 720x360 tiles, the widget's own resolution ladder,
 * span 12 at 40 degrees of pitch): of 650 stamped samples, 147 read behind
 * the surface by up to 6.54e-4 world units, against a slope-scaled allowance
 * reaching 7.18e-3 at those same cells — 11x headroom. 125 are forgiven and
 * 22 are genuinely occluded (a rough peak really does stand in front of the
 * stroke on its far flank, which is the correct answer, not a defect to pad
 * away). With `GLYPH_MAP_STROKE_DEPTH_SLOPE_SCALE` mutated to `0` all 307 go
 * dark and the run breaks, which is what the assertion below reads.
 *
 * THE ROUGHNESS IS LOAD-BEARING in the fixture, not decoration: over the
 * pure gaussian this file first used, the coarse chord and the
 * full-resolution sampler agree to 1e-4 and the same mutation changed
 * exactly ONE cell in the whole frame — an integration test cannot see an
 * allowance that is never called on. `stroke.test.ts` carries the same
 * property as a unit gate, on a synthetic surface where the margin is exact
 * rather than incidental.
 *
 * For scale, the allowance this replaced: the ground offset itself at this
 * view is ~2e-2 world units (3,950 m at 24x), i.e. thirty times the largest
 * gap a draped stroke ever presents. That is the sense in which its premise
 * is gone, not merely its magnitude reduced.
 */
const RIDGE_COLS = 160;
const RIDGE_ROWS = 64;
const RIDGE_TILE_COLS = 720;
const RIDGE_TILE_ROWS = 360;
const RIDGE_CENTRE: readonly [number, number] = [8.2, 46.5];

/** A 3,800 m alpine ridge along lat 46.5 on a 150 m plain — the same field `widget.tiltedTileCulling.test.ts` bakes. */
function ridgeElevation(lon: number, lat: number): number {
  if (lat < 43 || lat > 50 || lon < 3 || lon > 13) return 150;
  // Plus short-wavelength roughness at the tile-vertex scale — the component
  // a coarsened quad chord cannot represent, and the reason a draped stroke
  // reads behind the surface at all. Real relief has it; a pure gaussian
  // does not, and over a smooth field the chord and the sampler agree.
  return 150 + 3800 * Math.exp(-((lat - 46.5) ** 2) / 0.4) + 200 * Math.sin(lon * 37) * Math.sin(lat * 41);
}

function ridgeProvider(): GlyphMapProvider {
  const zooms = [0, 1, 2, 3, 4].map((z) => ({
    z, cols: 2 ** z, rows: 2 ** z, tileLonSpan: 360 / 2 ** z, tileLatSpan: 180 / 2 ** z,
    tileCols: RIDGE_TILE_COLS, tileRows: RIDGE_TILE_ROWS,
  }));
  const bounds = (z: number, x: number, y: number) => {
    const level = zooms[z];
    const west = -180 + x * level.tileLonSpan;
    const north = 90 - y * level.tileLatSpan;
    return { west, east: west + level.tileLonSpan, south: north - level.tileLatSpan, north };
  };
  return {
    id: "stroke-drape-ridge",
    zooms,
    bounds,
    async loadTile(z, x, y): Promise<GlyphMapGeoTile> {
      const b = bounds(z, x, y);
      const elevation = new Float32Array((RIDGE_TILE_COLS + 1) * (RIDGE_TILE_ROWS + 1));
      for (let r = 0; r <= RIDGE_TILE_ROWS; r++) {
        for (let c = 0; c <= RIDGE_TILE_COLS; c++) {
          elevation[r * (RIDGE_TILE_COLS + 1) + c] = ridgeElevation(
            b.west + ((b.east - b.west) * c) / RIDGE_TILE_COLS,
            b.north - ((b.north - b.south) * r) / RIDGE_TILE_ROWS,
          );
        }
      }
      return { bounds: b, cols: RIDGE_TILE_COLS, rows: RIDGE_TILE_ROWS, elevation, source: "stroke-drape-ridge", sampler: "mean" };
    },
  };
}

/** A dense border running west-east across the ridge — one vertex every 0.02 degrees, so the stamp walk is sampling geometry, not interpolating a long chord. */
const ridgeBorder: GlyphMapVectorFeature = {
  id: "border",
  geometryType: "line",
  rings: [Array.from({ length: 326 }, (_, i) => {
    const lon = 5.0 + i * 0.02;
    // It WANDERS across the ridge's flank rather than following the crest:
    // on the crest the terrain is locally flat, the coarse chord and the
    // full-resolution sampler agree, and there is no faceting to survive.
    return [lon, RIDGE_CENTRE[1] + 0.12 * Math.sin(lon * 3)] as [number, number];
  })],
};

describe("createGlyphMap — a draped stroke stays whole over a coarsened relief mesh", () => {
  // ONE span. At span 6 the same border crosses four rough peaks that
  // genuinely stand in front of it, so "unbroken" is not the true statement
  // there and only a count would separate the two states; span 12 gives the
  // exact property with no threshold to tune.
  it("inks an unbroken run across the ridge — the slope-scaled allowance is what keeps the mesh's own faceting from eating it", async () => {
    const span = 12;
    const host = document.createElement("div");
    document.body.appendChild(host);
    hostsToRemove.push(host);
    stubbedHosts.add(host);
    if (!vi.isMockFunction(Element.prototype.getBoundingClientRect)) {
      vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
        const el = this as HTMLElement;
        if (stubbedHosts.has(el)) return rect(RIDGE_COLS * CELL_W, RIDGE_ROWS * CELL_H);
        if (el.tagName !== "PRE" || !/visibility:\s*hidden/.test(el.style.cssText)) return EMPTY_RECT;
        const fontPx = parseFloat(/font-size:\s*([\d.]+)px/.exec(el.style.cssText)?.[1] ?? String(BASE_FONT_PX));
        const k = fontPx / BASE_FONT_PX;
        const lines = (el.textContent ?? "").split("\n").length || 1;
        return rect(CELL_W * k, CELL_H * k * lines);
      });
    }
    const map = createGlyphMap(host, {
      view: { center: [RIDGE_CENTRE[0], RIDGE_CENTRE[1]], span, cols: RIDGE_COLS, rows: RIDGE_ROWS },
      projection: glyphMapGlobe({ exaggeration: EXAGGERATION }),
      tilt: TILT,
    });
    mounted.push(map);
    map.addLayer({ type: "raster", id: "terrain", source: ridgeProvider() });
    await settleFrames(map);
    const before = (map.scene.output.textContent ?? "").split("\n");

    map.addLayer({ type: "line", id: "borders", source: { features: [ridgeBorder] }, color: "#ff0000" });
    await settleFrames(map);
    const after = (map.scene.output.textContent ?? "").split("\n");

    const seen = new Set<number>();
    for (let row = 0; row < RIDGE_ROWS; row++) {
      for (let col = 0; col < RIDGE_COLS; col++) {
        if ((before[row]?.[col] ?? " ") !== (after[row]?.[col] ?? " ")) seen.add(col);
      }
    }
    const inked = [...seen].sort((a, b) => a - b);
    expect(inked.length).toBeGreaterThan(50);
    // A count of BREAKS IN THE RUN, not of ink. The border is ONE polyline,
    // so the columns it inks are consecutive or the depth test ate part of
    // it — whereas a threshold on total ink is satisfied by the 95% of cells
    // that survive the mutation, which is exactly how this allowance went
    // untested until now.
    expect(inked.slice(1).map((c, i) => c - inked[i]).filter((d) => d > 1)).toEqual([]);
  }, 30000);
});

/**
 * Sub-cell stability: what a draped stroke does when the mounted tile set
 * changes under it.
 *
 * The sampler reads MOUNTED tiles, finest tier first, and the relief mesh is
 * built from those same tiles — so the two can never disagree about where
 * the ground is. Within one tier the sample is a pure function of
 * `(lon, lat)` and of nothing the camera does, so a pan, a zoom or an orbit
 * moves a stroke exactly as much as it moves the terrain under it and no
 * shimmer is possible. When a FINER tier lands the stroke does move — to
 * wherever that tier says the ground now is, in the same frame the terrain
 * itself moves there, because both are re-derived per render from the same
 * mounted set (`stamp()` resolves `groundElevationSampler()` on every call;
 * it holds no snapshot). A stroke that did NOT move would be the defect: it
 * would then be the only thing in the scene still standing on the old tier.
 *
 * The fixture makes the tiers disagree on purpose — coarse levels say 5 m,
 * the finest says 10 m — which no real pyramid does by that much, and is the
 * only way to observe which tier a render is actually reading.
 */
function tieredTerrainProvider(coarseM: number, fineM: number): GlyphMapProvider {
  const zooms = [0, 1, 2, 3, 4].map((z) => ({
    z, cols: 2 ** z, rows: 2 ** z, tileLonSpan: 360 / 2 ** z, tileLatSpan: 180 / 2 ** z, tileCols: 32, tileRows: 32,
  }));
  const bounds = (z: number, x: number, y: number) => {
    const level = zooms[z];
    const west = -180 + x * level.tileLonSpan;
    const north = 90 - y * level.tileLatSpan;
    return { west, east: west + level.tileLonSpan, south: north - level.tileLatSpan, north };
  };
  return {
    id: "stroke-drape-tiers",
    zooms,
    bounds,
    async loadTile(z, x, y): Promise<GlyphMapGeoTile> {
      const elev = z >= 4 ? fineM : coarseM;
      return { bounds: bounds(z, x, y), cols: 32, rows: 32, elevation: new Float32Array(33 * 33).fill(elev), source: "stroke-drape-tiers", sampler: "nearest" };
    },
  };
}

describe("createGlyphMap — a draped stroke follows the tier that is mounted", () => {
  it("moves onto the finer tier's ground when that tier lands, instead of holding the coarse one", async () => {
    const map = mount();
    // Wide enough that the target LOD is a coarse level, so the first
    // settled render reads the 5 m tiers.
    map.setView({ center: [CENTRE[0], CENTRE[1]], span: 40, cols: COLS, rows: ROWS });
    map.addLayer({ type: "raster", id: "terrain", source: tieredTerrainProvider(5, 10) });
    map.addLayer({ type: "line", id: "roads", source: { features: [road] }, color: "#e8c988" });
    await settleFrames(map);

    // Now zoom to where z4 is the target LOD, and let it land.
    map.setView({ center: [CENTRE[0], CENTRE[1]], span: SPAN, cols: COLS, rows: ROWS });
    await settleFrames(map);
    const withFine = rows(map);

    // Baseline for the diff: the same settled view with no stroke layer.
    const bare = mount();
    bare.setView({ center: [CENTRE[0], CENTRE[1]], span: SPAN, cols: COLS, rows: ROWS });
    bare.addLayer({ type: "raster", id: "terrain", source: tieredTerrainProvider(5, 10) });
    await settleFrames(bare);
    const before = rows(bare);

    const inked = inkedCells(before, withFine);
    expect(inked.length).toBeGreaterThan(100);

    const fineRow = Math.floor(groundRowFor(map, CENTRE[0], CENTRE[1], 10));
    const coarseRow = Math.floor(groundRowFor(map, CENTRE[0], CENTRE[1], 5));
    // The two tiers are 8 rows apart here, so "it followed" and "it stuck"
    // are cell-exactly distinguishable.
    expect(Math.abs(fineRow - coarseRow)).toBeGreaterThan(4);
    for (const cell of inked) expect(Math.abs(cell.row - fineRow)).toBeLessThanOrEqual(1);
    expect(inked.filter((c) => c.row === coarseRow)).toEqual([]);
  });
});
