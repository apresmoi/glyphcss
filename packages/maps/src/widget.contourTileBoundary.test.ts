/**
 * A `contour` layer must never ink a line the terrain does not have.
 *
 * The report: zooming in over the north pole draws "3 lines of concentric
 * octagons", and "there is one also in the south pole", in contour colour.
 * An equal-angle lat/lon tile pyramid is the only thing in the render with
 * that symmetry. At z3 (`cols` = 8, `tileLatSpan` = 22.5 — read off the baked
 * manifest, `website/public/data/geo-tiles/manifest.json`) the latitude
 * boundaries nearest a pole are 67.5, 45 and 22.5 — three rings — and there
 * are eight longitude divisions — eight sides. Terrain is not symmetric about
 * the equator; a tile grid is.
 *
 * MECHANISM, measured. The contour runtime derived a CELL-CENTERED
 * `GlyphMapField` per tile (each cell the average of its quad's four vertex
 * corners) and sampled it with `glyphMapFieldValueAt`, which interpolates
 * between cell CENTRES and CLAMPS at the field's own edge. A tile's outermost
 * cell centre sits half a cell INSIDE its bounds, so a band one cell wide
 * straddling every shared boundary has no sample on either side, and each
 * neighbour flat-extrapolates its own edge cell across it. The two
 * extrapolations differ by one cell of terrain gradient, so the sampled field
 * STEPS at every tile edge — measured on a gentle synthetic terrain at 39 m
 * across a meridian boundary and 59 m across a parallel one, with the true
 * value exactly the midpoint of the two, which is the signature of a
 * symmetric half-cell error on each side (`tile.elevationAt.test.ts` pins
 * this). A contour inks where the field crosses a level between neighbouring
 * cells, so a step manufactures a crossing along the WHOLE boundary.
 *
 * THE FIX is exact rather than approximate, because the data is already
 * there: `GlyphMapGeoTile` is VERTEX-centered and adjacent tiles SHARE their
 * edge vertex row/column (that is why the schema is vertex-centered — so
 * adjacent relief quads share an edge with no seam). Sampling that vertex
 * grid directly (`glyphMapGeoTileElevationAt`) makes both sides of a boundary
 * interpolate the same shared values, so they agree bit-for-bit and there is
 * no step left to ink. It also makes the contour read exactly the bilinear
 * patch the relief mesh itself draws.
 *
 * HOW THIS IS ASSERTED — differentially, not by a heuristic. The same terrain
 * is rendered twice: once through a provider whose tiles divide the world 8x8
 * (z3 — the reported level) and once through a provider serving it as ONE
 * global tile, which has no interior boundaries at all. Both sample the SAME
 * global vertex lon/lat set, and both are given the SAME explicit `levels`
 * array (a count or an interval would resolve against each mosaic's own
 * range and differ for reasons that have nothing to do with boundaries). Any
 * cell that differs between the two renders is therefore caused by tiling and
 * nothing else — no threshold to tune, no "is that line real?" judgement.
 *
 * Both directions are counted, and both matter:
 *  - EXTRA ink (inked when tiled, blank when whole) is the false line.
 *  - MISSING ink (blank when tiled, inked when whole) is the other half of
 *    the same defect: the flat-extrapolated band destroys genuine crossings
 *    inside it. It is also what makes this test impossible to satisfy by
 *    SUPPRESSING contours near a boundary or a pole — that would drive
 *    `missing` up, not down.
 * On failure the extra ink is reported bucketed by nearest z3 ring latitude
 * and nearest z3 tile meridian, so the octagon is visible in the diff.
 *
 * Fixture notes:
 *  - happy-dom has no layout: `stubMonospaceMetrics` gives the cell probes a
 *    real advance, without which nothing renders at all.
 *  - NO raster layer is mounted, so `requireSurface` degrades to "draw
 *    wherever the field is defined" and EVERY non-blank cell in the base
 *    `<pre>` is contour ink — attributable without separating it from terrain
 *    glyphs by colour.
 *  - `density` is 1, so the contour stamps into the base grid at its own
 *    native resolution: base cells ARE the finest grid here, and no seam can
 *    hide in a finer one.
 *  - The polar views are centred at +/-89.9, not exactly +/-90. At exactly a
 *    pole the globe's Newton unproject starts at the sub-observer point,
 *    where the (lon, lat) Jacobian's longitude column vanishes, and EVERY
 *    cell unprojects to null so the layer paints nothing at all. That is a
 *    separate polar defect with its own regression
 *    (`widget.polarUnproject.test.ts`).
 *  - The field is deliberately COARSER than the glyph grid (7.5 degrees per
 *    field cell against ~1.06 per glyph cell). That is the regime the report
 *    comes from — zoomed in past the data's own resolution — and it is where
 *    a half-cell clamp is largest relative to a genuine cell-to-cell step.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGlyphMap } from "./widget";
import { glyphMapGlobe } from "./projection";
import type { GlyphMapProvider, GlyphMapProviderZoomLevel } from "./provider";
import type { GlyphMapGeoTile } from "./tile";

const VIEW_COLS = 160, VIEW_ROWS = 80, CELL_W = 8, CELL_H = 16, PROBE_FONT_PX = 16;

const rect = (w: number, h: number) =>
  ({ width: w, height: h, top: 0, left: 0, right: w, bottom: h, x: 0, y: 0, toJSON() {} }) as DOMRect;
const EMPTY_RECT = rect(0, 0);
const stubbedHosts = new Set<HTMLElement>();

function stubMonospaceMetrics(host: HTMLElement): void {
  stubbedHosts.add(host);
  if (vi.isMockFunction(Element.prototype.getBoundingClientRect)) return;
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const el = this as HTMLElement;
    if (stubbedHosts.has(el)) return rect(VIEW_COLS * CELL_W, VIEW_ROWS * CELL_H);
    if (el.tagName !== "PRE" || !/visibility:\s*hidden/.test(el.style.cssText)) return EMPTY_RECT;
    const fontPx = parseFloat(/font-size:\s*([\d.]+)px/.exec(el.style.cssText)?.[1] ?? String(PROBE_FONT_PX));
    const k = fontPx / PROBE_FONT_PX;
    const lines = (el.textContent ?? "").split("\n").length || 1;
    return rect(CELL_W * k, CELL_H * k * lines);
  });
}

afterEach(() => {
  document.body.innerHTML = "";
  stubbedHosts.clear();
  vi.restoreAllMocks();
});

/** The world's vertex grid, shared by every tiling of it. */
const GLOBAL_COLS = 48, GLOBAL_ROWS = 24;
/** z3's longitude divisions — the reported octagon's side count. */
const Z3_DIVISIONS = 8;
const Z3_TILE_LON_SPAN = 360 / Z3_DIVISIONS;
const Z3_TILE_LAT_SPAN = 180 / Z3_DIVISIONS;

/**
 * Smooth analytic terrain — C-infinity in both axes, no feature aligned to
 * any tile boundary, and steep enough that genuine contours cover the globe.
 * Sampled at GLOBAL vertex indices below, so every tiling of it carries
 * bit-identical values on every shared edge, exactly as the real baker does.
 */
const terrainAt = (lon: number, lat: number): number =>
  4000 * Math.sin((lat * Math.PI) / 180) + 1500 * Math.sin((lon * Math.PI) / 60) + 900 * Math.cos((lat * Math.PI) / 47);

/**
 * An explicit level set, identical for both renders. `levels: number` or
 * `{ interval }` would each resolve against the mosaic's OWN elevation range,
 * which differs between one tile and sixty-four, so the two renders would
 * differ for a reason that has nothing to do with tile boundaries.
 */
const LEVELS = Array.from({ length: 60 }, (_, i) => -5000 + i * 200.7);

function makeProvider(divisions: number): GlyphMapProvider {
  const level: GlyphMapProviderZoomLevel = {
    z: 0, cols: divisions, rows: divisions,
    tileLonSpan: 360 / divisions, tileLatSpan: 180 / divisions,
    tileCols: GLOBAL_COLS / divisions, tileRows: GLOBAL_ROWS / divisions,
  };
  const bounds = (_z: number, x: number, y: number) => {
    const west = -180 + x * level.tileLonSpan, north = 90 - y * level.tileLatSpan;
    return { west, east: west + level.tileLonSpan, south: north - level.tileLatSpan, north };
  };
  return {
    id: `divisions-${divisions}`,
    zooms: [level],
    bounds,
    loadTile: (_z, x, y): Promise<GlyphMapGeoTile> => {
      const b = bounds(0, x, y);
      const vc = level.tileCols + 1, vr = level.tileRows + 1;
      const elevation = new Float32Array(vc * vr);
      for (let r = 0; r < vr; r++) {
        for (let c = 0; c < vc; c++) {
          // GLOBAL vertex indices: two different tilings sample the identical
          // lon/lat set, so a shared edge carries identical values and any
          // render difference is the tiling itself.
          const lon = -180 + ((x * level.tileCols + c) * 360) / GLOBAL_COLS;
          const lat = 90 - ((y * level.tileRows + r) * 180) / GLOBAL_ROWS;
          elevation[r * vc + c] = terrainAt(lon, lat);
        }
      }
      return Promise.resolve({ bounds: b, cols: level.tileCols, rows: level.tileRows, elevation, source: "analytic", sampler: "nearest" });
    },
  };
}

interface Rendered {
  /** Non-blank base-grid cells; with no raster layer mounted every one is contour ink. */
  readonly inked: Uint8Array;
  /** Each cell's own lon/lat, or null where the cell is off the globe. */
  readonly lonLat: readonly (readonly [number, number] | null)[];
  readonly ink: number;
}

async function render(divisions: number, centerLat: number): Promise<Rendered> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  stubMonospaceMetrics(host);
  const map = createGlyphMap(host, {
    view: { center: [0, centerLat], span: 170, cols: VIEW_COLS, rows: VIEW_ROWS },
    projection: glyphMapGlobe({ exaggeration: 1 }),
    tilt: 0,
    maxSpan: 720,
  });
  map.addLayer({ type: "contour", id: "contour", source: makeProvider(divisions), levels: LEVELS, color: "#ff0000" });
  await new Promise((r) => setTimeout(r, 600));
  map.scene.rerender();

  const lines = (map.scene.output.textContent ?? "").split("\n");
  const inked = new Uint8Array(VIEW_COLS * VIEW_ROWS);
  let ink = 0;
  for (let r = 0; r < Math.min(VIEW_ROWS, lines.length); r++) {
    const line = lines[r]!;
    for (let c = 0; c < Math.min(VIEW_COLS, line.length); c++) {
      if (line[c] !== " ") { inked[r * VIEW_COLS + c] = 1; ink++; }
    }
  }
  // Unprojected BEFORE teardown — `map.unproject` reads the live scene.
  const lonLat: (readonly [number, number] | null)[] = [];
  for (let r = 0; r < VIEW_ROWS; r++) for (let c = 0; c < VIEW_COLS; c++) lonLat.push(map.unproject([c + 0.5, r + 0.5]));
  map.destroy();
  host.remove();
  return { inked, lonLat, ink };
}

/** Extra ink bucketed by the z3 boundary it sits on — the octagon, made countable. */
function boundaryHistogram(cells: readonly (readonly [number, number])[]): { rings: Record<string, number>; sides: Record<string, number> } {
  const rings: Record<string, number> = {};
  const sides: Record<string, number> = {};
  for (const [lon, lat] of cells) {
    const nearestRing = Math.round(lat / Z3_TILE_LAT_SPAN) * Z3_TILE_LAT_SPAN;
    const nearestSide = Math.round(lon / Z3_TILE_LON_SPAN) * Z3_TILE_LON_SPAN;
    if (Math.abs(lat - nearestRing) < 1.5) rings[String(nearestRing)] = (rings[String(nearestRing)] ?? 0) + 1;
    if (Math.abs(lon - nearestSide) < 3) sides[String(nearestSide)] = (sides[String(nearestSide)] ?? 0) + 1;
  }
  return { rings, sides };
}

describe("createGlyphMap — a contour layer's field is continuous across mosaic tile boundaries", () => {
  for (const [name, centerLat] of [
    ["north pole (the reported concentric octagons)", 89.9],
    ["south pole (the mirrored ring — a tile grid is symmetric about the equator, terrain is not)", -89.9],
    ["mid-latitudes (the same defect, where the boundaries read as straight lines)", 20],
  ] as const) {
    it(`${name}: tiling the same terrain 8x8 changes no cell`, async () => {
      const whole = await render(1, centerLat);
      const tiled = await render(Z3_DIVISIONS, centerLat);

      // Guard the guard: a vacuous comparison (nothing inked, or nothing
      // unprojectable) would pass every assertion below.
      expect(whole.ink).toBeGreaterThan(400);
      expect(whole.lonLat.filter((p) => p !== null).length).toBeGreaterThan(1000);

      const extra: (readonly [number, number])[] = [];
      const missing: (readonly [number, number])[] = [];
      for (let i = 0; i < whole.inked.length; i++) {
        const p = whole.lonLat[i];
        if (p === null || tiled.lonLat[i] === null) continue;
        if (tiled.inked[i] && !whole.inked[i]) extra.push(p);
        if (!tiled.inked[i] && whole.inked[i]) missing.push(p);
      }

      // EXACTLY zero in both directions. `extra` is the false line; `missing`
      // is the genuine contour the flat-extrapolated band destroyed, and is
      // what makes suppressing ink near a boundary or a pole fail rather than
      // pass. Before the fix, the north-pole view alone reported extra 205 /
      // missing 278, with the extra bucketed on ring latitudes 67.5/45/22.5
      // and seven of z3's eight tile meridians.
      expect({
        extra: extra.length,
        missing: missing.length,
        extraByRingLat: boundaryHistogram(extra).rings,
        extraByTileLon: boundaryHistogram(extra).sides,
      }).toEqual({ extra: 0, missing: 0, extraByRingLat: {}, extraByTileLon: {} });

      // And the tiled render did not merely match by painting the same total
      // somewhere else.
      expect(tiled.ink).toBe(whole.ink);
    }, 60_000);
  }
});
