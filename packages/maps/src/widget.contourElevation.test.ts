/**
 * A `contour` layer is REAL GEOMETRY AT ITS OWN ELEVATION.
 *
 * THE DEFECT THIS CLOSES. A contour used to project no vertex at all: it
 * sampled per output CELL, `unproject(cell centre) -> lon/lat ->
 * elevationAtLonLat`, and inked where a level crossed between neighbours.
 * `unproject` inverts at ELEVATION ZERO — a projection's `z` axis is one-way
 * relief, never re-derived from world space — so under a tilt the cell the
 * reader is looking at was attributed the lon/lat of the SEA-LEVEL point
 * under the view ray rather than of the terrain point actually drawn there.
 * The line therefore landed where sea level would be: the mirror image of the
 * parallax `781486f` closed for `line` layers by draping them, recorded in
 * `docs/design/maps.md` as "identified and unfixed" and as needing a terrain
 * ray-march.
 *
 * WHAT REPLACED IT is not a ray-march but the removal of the question.
 * Marching squares (`contourGeometry.ts`) cuts each level's isoline in the
 * field's OWN (lon, lat) domain, so every vertex it produces is at a KNOWN
 * height — the level's own — and goes through `projection.project(lon, lat,
 * level)` exactly like the terrain vertex beside it. There is no datum left
 * to be wrong about at any tilt, and the lines wrap the relief in three
 * dimensions, which is what the report asked for ("so when I tilt the camera
 * I also see them from the side").
 *
 * HOW THIS IS ASSERTED — forward, never by inverting anything.
 *
 *  - The terrain is EXACTLY LINEAR IN LATITUDE inside a band, so a level's
 *    isoline sits at a latitude this file can state in closed form, without
 *    asking the marcher where it put it. Bilinear interpolation of a linear
 *    function is exact, so the tile grid's own resolution cannot move it.
 *  - The expected screen row comes from the same identity
 *    `widget.strokeDrape.test.ts` uses, out of public API alone:
 *    `glyphMapGlobe.project(lon, lat, h)` is `(1 + h·exaggeration/R_earth)`
 *    times `project(lon, lat, 0)` — purely radial — and the widget's only
 *    camera is orthographic, whose `project()` is AFFINE in the world point.
 *    So with `b` the row the world ORIGIN maps to, `row(k·P) = b + k·(row(P)
 *    - b)`, and `b` is recoverable as `(row(P) + row(-P))/2` with `-P` the
 *    ANTIPODE's own sea-level projection. No widget internals, no hard-coded
 *    framing.
 *  - Both predictions are computed: at the LEVEL (what geometry must draw)
 *    and at the DATUM (what the old per-cell path drew). The test reports
 *    their separation and requires the ink to sit on the first and nowhere
 *    near the second.
 *
 * Fixture notes: happy-dom has no layout, hence `stubMonospaceMetrics` — and
 * it must answer glyphcss's own hidden-`<pre>` cell probe too, or the camera
 * and the rasterizer disagree about cell size and every predicted cell is
 * off. The real-data case uses the VENDORED ETOPO1 tile
 * (`fixtures/geo-tile-parity.json`, baked by `bake-geo-tiles.mjs --fixture`);
 * the full z0-z4 pyramid under `website/public/data/geo-tiles/` is
 * gitignored and so cannot be a test dependency.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGlyphMap } from "./widget";
import { GLYPH_MAP_EARTH_RADIUS_M, glyphMapGlobe } from "./projection";
import { glyphMapGeoTileElevationAt } from "./tile";
import { glyphMapMarchContourGrid, glyphMapMarchContourMosaic } from "./contourGeometry";
import type { GlyphMapProvider } from "./provider";
import type { GlyphMapGeoTile } from "./tile";

const COLS = 140;
const ROWS = 63;
const CELL_W = 8;
const CELL_H = 16;
const BASE_FONT_PX = 16;
/** `/maps`' own default pitch. With no tilt the relief has no parallax and there is nothing to observe. */
const TILT = 40;
/** `/maps`' own default relief exaggeration. */
const EXAGGERATION = 24;

/** An alpine valley view: 0.6 degrees of longitude, ~4.3e-3 degrees per cell. */
const CENTRE: readonly [number, number] = [8.0, 46.5];
const SPAN = 0.6;

/**
 * Terrain: sea level at `CENTRE`, falling 8,000 m per degree of latitude
 * NORTHWARD, flat outside a half-degree band.
 *
 * The sign is chosen, not arbitrary. A level's line is displaced twice — once
 * by its own LATITUDE (where the isoline runs) and once by its ELEVATION
 * (`/maps`' 24x, which at this span is ~0.016 rows per metre). A ramp that
 * RISES northward makes the two add, and every level worth testing leaves the
 * 63-row viewport; falling northward makes them partly cancel, so all four
 * levels stay on screen while each still sits ~10-20 rows from its own datum.
 */
const RAMP_LAT0 = 46.5;
const RAMP_BASE_M = 0;
const RAMP_M_PER_DEG = -8000;
const RAMP_HALF_BAND_DEG = 0.5;
const LEVELS = [-1200, -600, 600, 1200];

const rampElevation = (lat: number, mPerDeg = RAMP_M_PER_DEG): number =>
  RAMP_BASE_M + mPerDeg * Math.max(-RAMP_HALF_BAND_DEG, Math.min(RAMP_HALF_BAND_DEG, lat - RAMP_LAT0));
/** The exact latitude a level's isoline runs along — stated in closed form, never asked of the marcher. */
const latOfLevel = (level: number, mPerDeg = RAMP_M_PER_DEG): number => RAMP_LAT0 + (level - RAMP_BASE_M) / mPerDeg;

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

function mount(tilt: number) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  hostsToRemove.push(host);
  stubMonospaceMetrics(host);
  const map = createGlyphMap(host, {
    view: { center: [CENTRE[0], CENTRE[1]], span: SPAN, cols: COLS, rows: ROWS },
    projection: glyphMapGlobe({ exaggeration: EXAGGERATION }),
    tilt,
  });
  mounted.push(map);
  return map;
}

/** The ramp terrain as a z0-z4 provider — the shape `bake-geo-tiles.mjs` produces. */
function rampProvider(mPerDeg = RAMP_M_PER_DEG): GlyphMapProvider {
  const zooms = [0, 1, 2, 3, 4].map((z) => ({
    // Fine enough that one marching quad is a few output cells rather than
    // most of the frame — which is what makes the stamp's screen-cull margin
    // observable at the grid edges (see the edge-reach assertion below).
    z, cols: 2 ** z, rows: 2 ** z, tileLonSpan: 360 / 2 ** z, tileLatSpan: 180 / 2 ** z, tileCols: 512, tileRows: 512,
  }));
  const bounds = (z: number, x: number, y: number) => {
    const level = zooms[z];
    const west = -180 + x * level.tileLonSpan;
    const north = 90 - y * level.tileLatSpan;
    return { west, east: west + level.tileLonSpan, south: north - level.tileLatSpan, north };
  };
  return {
    id: `contour-elevation-ramp-${mPerDeg}`,
    zooms,
    bounds,
    loadTile: (z, x, y): Promise<GlyphMapGeoTile> => {
      const b = bounds(z, x, y);
      const level = zooms[z];
      const vc = level.tileCols + 1, vr = level.tileRows + 1;
      const elevation = new Float32Array(vc * vr);
      for (let r = 0; r < vr; r++) {
        const lat = b.north - ((b.north - b.south) * r) / level.tileRows;
        for (let c = 0; c < vc; c++) elevation[r * vc + c] = rampElevation(lat, mPerDeg);
      }
      return Promise.resolve({ bounds: b, cols: level.tileCols, rows: level.tileRows, elevation, source: "ramp", sampler: "nearest" });
    },
  };
}

/**
 * The screen position of `(lon, lat)` standing at `elevM`, from public API
 * alone — see this file's header for the radial/affine identity and why the
 * antipode recovers the world origin's own cell.
 */
function projectAtElevation(map: ReturnType<typeof createGlyphMap>, lon: number, lat: number, elevM: number): { col: number; row: number } {
  const p = map.project([lon, lat]);
  const anti = map.project([lon > 0 ? lon - 180 : lon + 180, -lat]);
  const originCol = (p.col + anti.col) / 2;
  const originRow = (p.row + anti.row) / 2;
  const k = 1 + (elevM * EXAGGERATION) / GLYPH_MAP_EARTH_RADIUS_M;
  return { col: originCol + k * (p.col - originCol), row: originRow + k * (p.row - originRow) };
}

/** Every cell a level's isoline would occupy if drawn at `elevM`, sampled densely along it in longitude. */
function predictedCells(map: ReturnType<typeof createGlyphMap>, level: number, elevM: number, mPerDeg = RAMP_M_PER_DEG): Set<string> {
  const lat = latOfLevel(level, mPerDeg);
  const out = new Set<string>();
  // Sampled well past the nominal span: a tilted globe shows a WIDER band of
  // longitude away from the pivot than at it, and an out-of-grid sample is
  // dropped below anyway.
  const reach = SPAN * 2;
  for (let i = 0; i <= COLS * 8; i++) {
    const lon = CENTRE[0] - reach / 2 + (reach * i) / (COLS * 8);
    const { col, row } = projectAtElevation(map, lon, lat, elevM);
    if (!Number.isFinite(col) || !Number.isFinite(row)) continue;
    const c = Math.floor(col), r = Math.floor(row);
    if (c >= 0 && c < COLS && r >= 0 && r < ROWS) out.add(`${c},${r}`);
  }
  return out;
}

function inkedCells(map: ReturnType<typeof createGlyphMap>): { col: number; row: number }[] {
  const lines = (map.scene.output.textContent ?? "").split("\n");
  const out: { col: number; row: number }[] = [];
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const ch = lines[row]?.[col] ?? " ";
      if (ch !== " " && ch !== "") out.push({ col, row });
    }
  }
  return out;
}

/** Cells within `radius` of any member of `cells` — the one-cell tolerance a rasterized line is allowed against a continuous prediction. */
function dilate(cells: Set<string>, radius: number): Set<string> {
  const out = new Set<string>();
  for (const key of cells) {
    const [c, r] = key.split(",").map(Number);
    for (let dr = -radius; dr <= radius; dr++) for (let dc = -radius; dc <= radius; dc++) out.add(`${c + dc},${r + dr}`);
  }
  return out;
}

describe("createGlyphMap — a contour stands at its own elevation", () => {
  it("draws every line at the LEVEL's own height under a tilt, not at the datum", async () => {
    const map = mount(TILT);
    map.addLayer({ type: "contour", id: "c", source: rampProvider(), levels: LEVELS, color: "#00aaff" });
    await vi.waitFor(() => expect(map.getContourFieldRange("c")).not.toBeNull(), { timeout: 3000 });
    map.scene.rerender();

    const ink = inkedCells(map);
    expect(ink.length).toBeGreaterThan(100); // guard the guard: a blank render passes every set test below

    const atLevel = new Set<string>();
    const atDatum = new Set<string>();
    for (const level of LEVELS) {
      for (const key of predictedCells(map, level, level)) atLevel.add(key);
      for (const key of predictedCells(map, level, 0)) atDatum.add(key);
    }
    // The fixture must actually contain the parallax, or "on the level, off
    // the datum" is satisfiable by drawing in one place.
    const separation = Math.min(
      ...LEVELS.map((level) =>
        Math.abs(projectAtElevation(map, CENTRE[0], latOfLevel(level), level).row - projectAtElevation(map, CENTRE[0], latOfLevel(level), 0).row),
      ),
    );
    expect(separation).toBeGreaterThan(5);

    const nearLevel = dilate(atLevel, 1);
    const nearDatum = dilate(atDatum, 1);
    const onLevel = ink.filter((c) => nearLevel.has(`${c.col},${c.row}`)).length;
    // Cells at the datum position that the elevated line does NOT also cover —
    // the old path's own signature.
    const onDatumOnly = ink.filter((c) => nearDatum.has(`${c.col},${c.row}`) && !nearLevel.has(`${c.col},${c.row}`)).length;

    expect({ onLevel: onLevel === ink.length, onDatumOnly }).toEqual({ onLevel: true, onDatumOnly: 0 });

    // And the line reaches BOTH edge columns of the grid.
    const cols = new Set(ink.map((c) => c.col));
    expect({ left: cols.has(0), right: cols.has(COLS - 1) }).toEqual({ left: true, right: true });
  });

  it("moves the lines with the terrain's exaggeration, so a level sits on its own ground at any relief scale", async () => {
    // Same geometry, two exaggerations: at 1x the parallax is 24x smaller, so
    // the ink must follow the prediction DOWN with it. A datum-projected line
    // would not move at all — it does not read `exaggeration`.
    const rows: Record<number, number> = {};
    for (const exaggeration of [1, EXAGGERATION]) {
      const host = document.createElement("div");
      document.body.appendChild(host);
      hostsToRemove.push(host);
      stubMonospaceMetrics(host);
      const map = createGlyphMap(host, {
        view: { center: [CENTRE[0], CENTRE[1]], span: SPAN, cols: COLS, rows: ROWS },
        projection: glyphMapGlobe({ exaggeration }),
        tilt: TILT,
      });
      mounted.push(map);
      map.addLayer({ type: "contour", id: "c", source: rampProvider(), levels: [1200], color: "#00aaff" });
      await vi.waitFor(() => expect(map.getContourFieldRange("c")).not.toBeNull(), { timeout: 3000 });
      map.scene.rerender();
      const ink = inkedCells(map);
      expect(ink.length).toBeGreaterThan(50);
      const mid = ink.filter((c) => Math.abs(c.col - COLS / 2) <= 2).map((c) => c.row);
      expect(mid.length).toBeGreaterThan(0);
      rows[exaggeration] = mid.reduce((a, b) => a + b, 0) / mid.length;
    }
    // 1,200 m of ground at 24x against the same ground at 1x: the two must be
    // many rows apart, and the exaggerated one FURTHER from the datum.
    expect(Math.abs(rows[EXAGGERATION] - rows[1])).toBeGreaterThan(5);
  });

  it("keeps a line whose whole segment overruns the grid — the stamp's screen-cull margin", async () => {
    // The cull's own bound, at the one view where it bites. The stamp skips a
    // segment whose FIRST endpoint lands outside the grid by more than
    // `2 x quadDeg / degPerCell`, and that margin is a bound rather than a
    // tuning because a marching segment lies inside one quad of its own grid.
    // Here the grid is deliberately COARSE — one quad is 1.4 degrees against a
    // 0.6-degree view — so the single segment carrying this contour across the
    // frame has BOTH its endpoints far off-grid, and a margin that did not
    // cover a quad would drop it and blank the layer entirely.
    const coarse: GlyphMapProvider = {
      ...rampProvider(),
      id: "contour-elevation-coarse",
      zooms: [0, 1, 2, 3, 4].map((z) => ({
        z, cols: 2 ** z, rows: 2 ** z, tileLonSpan: 360 / 2 ** z, tileLatSpan: 180 / 2 ** z, tileCols: 16, tileRows: 16,
      })),
      loadTile: (z, x, y): Promise<GlyphMapGeoTile> => {
        const lonSpan = 360 / 2 ** z, latSpan = 180 / 2 ** z;
        const b = { west: -180 + x * lonSpan, east: -180 + (x + 1) * lonSpan, north: 90 - y * latSpan, south: 90 - (y + 1) * latSpan };
        const elevation = new Float32Array(17 * 17);
        for (let r = 0; r <= 16; r++) {
          // Globally linear in latitude, so the ONE level below sits at a
          // latitude stated in closed form however coarsely it is sampled.
          const lat = b.north - ((b.north - b.south) * r) / 16;
          for (let c = 0; c <= 16; c++) elevation[r * 17 + c] = RAMP_M_PER_DEG * (lat - RAMP_LAT0);
        }
        return Promise.resolve({ bounds: b, cols: 16, rows: 16, elevation, source: "coarse-ramp", sampler: "nearest" });
      },
    };
    const map = mount(TILT);
    map.addLayer({ type: "contour", id: "c", source: coarse, levels: [0], color: "#00aaff" });
    await vi.waitFor(() => expect(map.getContourFieldRange("c")).not.toBeNull(), { timeout: 3000 });
    map.scene.rerender();

    const ink = inkedCells(map);
    expect(ink.length).toBeGreaterThan(50);
    const atLevel = dilate(predictedCells(map, 0, 0), 1);
    expect(ink.every((c) => atLevel.has(`${c.col},${c.row}`))).toBe(true);
  });

  it("reads unchanged with no tilt, where the datum and the level project to the same place", async () => {
    const map = mount(0);
    map.addLayer({ type: "contour", id: "c", source: rampProvider(), levels: LEVELS, color: "#00aaff" });
    await vi.waitFor(() => expect(map.getContourFieldRange("c")).not.toBeNull(), { timeout: 3000 });
    map.scene.rerender();

    const ink = inkedCells(map);
    expect(ink.length).toBeGreaterThan(100);
    for (const level of LEVELS) {
      const a = projectAtElevation(map, CENTRE[0], latOfLevel(level), level);
      const b = projectAtElevation(map, CENTRE[0], latOfLevel(level), 0);
      // Straight down at the view centre the elevation offset is along the
      // view axis, so it moves depth and not the row: this is what makes an
      // elevated/flat TOGGLE pointless — at tilt 0 there is nothing to choose
      // between, and everywhere else the flat one is simply wrong.
      expect(Math.abs(a.row - b.row)).toBeLessThan(1);
    }
    const atLevel = dilate(new Set(LEVELS.flatMap((level) => [...predictedCells(map, level, level)])), 1);
    expect(ink.every((c) => atLevel.has(`${c.col},${c.row}`))).toBe(true);
  });

  it("lands ON the rendered relief with terrain mounted, and survives its depth test", async () => {
    // A GENTLER ramp than the other cases use. At 24x, this file's own
    // -8,000 m/degree is a 60-degree wall in world space, and a tilted camera
    // looking at its back face sees almost none of it — the contour would then
    // be hidden by the relief in front of it, which is correct behaviour and
    // the wrong thing to measure here. -2,000 m/degree is ~23 degrees, a slope
    // a 40-degree pitch sees whole.
    const M_PER_DEG = -2000;
    const CASE_LEVELS = [-300, 300];
    const map = mount(TILT);
    const source = rampProvider(M_PER_DEG);
    map.addLayer({ type: "raster", id: "terrain", source, colors: ["#204020", "#608060"] });
    await vi.waitFor(() => expect((map.scene.output.textContent ?? "").trim().length).toBeGreaterThan(200), { timeout: 3000 });
    await new Promise((r) => setTimeout(r, 250));
    map.scene.rerender();
    const withoutContour = map.scene.output.textContent ?? "";

    map.addLayer({ type: "contour", id: "c", source, levels: CASE_LEVELS, color: "#00aaff" });
    await vi.waitFor(() => expect(map.getContourFieldRange("c")).not.toBeNull(), { timeout: 3000 });
    map.scene.rerender();
    const withContour = map.scene.output.textContent ?? "";

    // The contour's own cells, isolated by DIFFERENCING the same render with
    // and without the layer — never by glyph-set membership, which cannot tell
    // an oriented-ink glyph apart from a terrain ramp glyph that happens to
    // collide with it.
    const before = withoutContour.split("\n");
    const after = withContour.split("\n");
    const changed: { col: number; row: number }[] = [];
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        if ((before[row]?.[col] ?? " ") !== (after[row]?.[col] ?? " ")) changed.push({ col, row });
      }
    }
    // Counted against the rendered relief, never asserted as a total: the
    // question is WHERE the surviving ink is, not how much of it there is.
    expect(changed.length).toBeGreaterThan(20);

    const atLevel = dilate(new Set(CASE_LEVELS.flatMap((level) => [...predictedCells(map, level, level, M_PER_DEG)])), 1);
    const atDatum = dilate(new Set(CASE_LEVELS.flatMap((level) => [...predictedCells(map, level, 0, M_PER_DEG)])), 1);
    const off = changed.filter((c) => !atLevel.has(`${c.col},${c.row}`));
    const datumOnly = changed.filter((c) => atDatum.has(`${c.col},${c.row}`) && !atLevel.has(`${c.col},${c.row}`));
    // Every surviving cell sits on the relief at its own level — so the
    // terrain neither displaced the line nor ate it, which is the pair of
    // failures a datum-projected contour produces under a tilt.
    expect({ off: off.length, datumOnly: datumOnly.length }).toEqual({ off: 0, datumOnly: 0 });
  });
});

describe("glyphMapMarchContourGrid — real ETOPO1 data", () => {
  /** The vendored real-ETOPO1 tile (`bake-geo-tiles.mjs --fixture`): 20x20 degrees over equatorial Africa, 10x10 quads. */
  const fixture = JSON.parse(
    readFileSync(path.resolve(__dirname, "../fixtures/geo-tile-parity.json"), "utf8"),
  ) as { bounds: { west: number; east: number; south: number; north: number }; cols: number; rows: number; elevation: number[] };
  const tile: GlyphMapGeoTile = {
    bounds: fixture.bounds,
    cols: fixture.cols,
    rows: fixture.rows,
    elevation: Float32Array.from(fixture.elevation),
    source: "etopo1",
    sampler: "nearest",
  };

  it("cuts every vertex AT its own level, read back through the tile's own bilinear field", () => {
    const levels = [0, 250, 500, 750, 1000];
    const segments = glyphMapMarchContourGrid(
      { bounds: tile.bounds, cols: tile.cols, rows: tile.rows, values: tile.elevation },
      levels,
    );
    expect(segments.length).toBeGreaterThan(20); // real relief, real crossings

    let worst = 0;
    for (const segment of segments) {
      for (const [lon, lat] of [segment.a, segment.b]) {
        const sampled = glyphMapGeoTileElevationAt(tile, lon, lat);
        expect(Number.isFinite(sampled)).toBe(true);
        worst = Math.max(worst, Math.abs(sampled - segment.level));
      }
    }
    // A marching vertex lies on a quad EDGE, where the tile's bilinear field
    // reduces to the same linear interpolation the crossing was solved from —
    // so this is exact up to float rounding, not a tolerance with slack in it.
    expect(worst).toBeLessThan(1e-6);
  });

  it("cuts the same segment LIST however the same field is tiled", () => {
    // The canonical sort's own guarantee. Adjacent tiles share their edge
    // vertex row/column, so the segment SET is a property of the field and not
    // of the tiling — but the ORDER a mosaic yields it in follows the tiling,
    // and the last stamp into a contested output cell wins the glyph. This is
    // the property that lets `widget.contourTileBoundary.test.ts` demand
    // cell-for-cell identity between one tile and sixty-four.
    const levels = [0, 250, 500, 750, 1000];
    const whole = glyphMapMarchContourMosaic(
      [{ bounds: tile.bounds, cols: tile.cols, rows: tile.rows, values: tile.elevation }],
      levels,
    );
    // The same 10x10-quad grid served as a 2x2 arrangement of 5x5-quad grids,
    // sharing edge vertices exactly as the baker's tiles do.
    const stride = tile.cols + 1;
    const halfCols = tile.cols / 2, halfRows = tile.rows / 2;
    const quarters = [0, 1].flatMap((ty) => [0, 1].map((tx) => {
      const values = new Float64Array((halfCols + 1) * (halfRows + 1));
      for (let r = 0; r <= halfRows; r++) for (let c = 0; c <= halfCols; c++) {
        values[r * (halfCols + 1) + c] = tile.elevation[(ty * halfRows + r) * stride + tx * halfCols + c];
      }
      const lonStep = (tile.bounds.east - tile.bounds.west) / 2;
      const latStep = (tile.bounds.north - tile.bounds.south) / 2;
      return {
        bounds: {
          west: tile.bounds.west + tx * lonStep, east: tile.bounds.west + (tx + 1) * lonStep,
          north: tile.bounds.north - ty * latStep, south: tile.bounds.north - (ty + 1) * latStep,
        },
        cols: halfCols, rows: halfRows, values,
      };
    }));
    // Reversed, so a tiling-order dependence cannot pass by accident.
    const tiled = glyphMapMarchContourMosaic([...quarters].reverse(), levels);
    expect(whole.length).toBeGreaterThan(20);
    expect(tiled).toEqual(whole);
  });

  it("keeps every level's vertices inside the tile's own bounds", () => {
    const segments = glyphMapMarchContourGrid(
      { bounds: tile.bounds, cols: tile.cols, rows: tile.rows, values: tile.elevation },
      [0, 500, 1000],
    );
    for (const segment of segments) {
      for (const [lon, lat] of [segment.a, segment.b]) {
        expect({ inLon: lon >= tile.bounds.west && lon <= tile.bounds.east, inLat: lat >= tile.bounds.south && lat <= tile.bounds.north })
          .toEqual({ inLon: true, inLat: true });
      }
    }
  });
});
