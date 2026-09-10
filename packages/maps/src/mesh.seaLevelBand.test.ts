import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { glyphMapPolygons } from "./mesh";
import { glyphMapEquirectangular } from "./projection";
import { GlyphMapClassifiers } from "./classify";
import type { GlyphMapGeoTile } from "./tile";

/**
 * Reported live: high terrain in the Andes — Bogota (2,640 m), Quito
 * (2,850 m), the Chilean/Bolivian Altiplano (~4,500 m) — rendered as WATER,
 * i.e. `GlyphMapClassifiers.etopo1V1`'s band 0 (below sea level), whose
 * terrain-palette colour is bathymetric blue.
 *
 * The elevation reaching the colour function was measured at every step of
 * the pipeline. ETOPO1 itself is read correctly (Bogota 2555 m, Quito
 * 2910 m, Altiplano 4473 m) and the baked tile carries those values (z4
 * nearest vertex: 2545 / 2864 / 4473). The number goes wrong only at the
 * LAST step: `glyphMapPolygons` took each quad's colour from the MEAN of
 * its 4 corner elevations. Where those corners straddle a coastline the
 * mean is dragged below zero by the ocean corner — and the deeper the
 * adjacent ocean, the further inland it reaches, which is why the Peru-Chile
 * trench (-6,000 to -8,000 m, ~150 km off a 4,000-6,000 m cordillera) makes
 * the Andes the most visible case. Measured on the real z0 tile at the
 * floor tier's own mesh resolution: the quad covering Bogota averaged
 * -155 m across corners while the terrain it covers is 379/441 samples
 * above sea level, median +194 m.
 *
 * The fix that shipped for that was the MEDIAN of the baked vertices a quad
 * covers, and it was defended with a guarantee that is FALSE at the
 * resolution a reader actually looks at: "more than half the covered SAMPLES
 * at or above sea level implies the sample at `n >> 1` is too". At the target
 * tier a relief quad is ONE source cell, so the samples it covers are its own
 * four corners and the median is a 3-of-4 vote blind to magnitude — which is
 * how Buenos Aires' downtown quad (three -1 m estuary corners against one
 * +12 m city corner) came to be painted as river while 72% of the surface
 * drawn between those corners is above sea level.
 *
 * What is pinned here now is the rule that replaced it: a quad takes the band
 * covering the majority of the terrain SURFACE it covers (`colorSample:
 * "surface-median"`, `mesh.surfaceMedian.test.ts` for the rule's own
 * discrimination). That guarantee is exact at every block size, including
 * n = 4, because it is a median's defining property rather than a claim about
 * sample counts: an area median cannot land in a band that less than half the
 * area occupies. Both directions are asserted below, and both were red under
 * the sample median — 94 quads of these fixtures alone, one of them a quad
 * only 2.2% of whose surface is above sea level painted as land.
 *
 * Amsterdam is deliberately present but NOT asserted as a defect: at
 * ETOPO1's own resolution much of the Netherlands genuinely is below sea
 * level (the fixture's nearest vertex to the city is -3 m), so band 0 there
 * is the data reporting itself faithfully — mean, median and area all agree,
 * and no per-quad statistic can separate a polder from a lake bed at ~13 km
 * per sample. Whether bathymetric blue is the right cartography for reclaimed
 * dry land is a presentation question, not a sampling defect, and this test
 * asserts only that the fixture holds that real negative value.
 */

interface SeaLevelBandWindow {
  readonly bounds: GlyphMapGeoTile["bounds"];
  readonly cols: number;
  readonly rows: number;
  /** A lon/lat landing exactly on a vertex of this window's own grid. */
  readonly at: readonly [number, number];
  readonly elevation: readonly number[];
  readonly source: string;
  readonly sampler: string;
}

const FIXTURE = JSON.parse(
  readFileSync(path.resolve(__dirname, "../fixtures/sea-level-band.json"), "utf8"),
) as Record<string, SeaLevelBandWindow>;

function tileOf(name: string): GlyphMapGeoTile {
  const w = FIXTURE[name]!;
  return {
    bounds: w.bounds,
    cols: w.cols,
    rows: w.rows,
    elevation: Float32Array.from(w.elevation),
    source: w.source,
    sampler: w.sampler,
  };
}

/** `mesh.ts`'s own `gridLineIndices`, mirrored so the test can address a coarsened quad. */
function gridLineIndices(total: number, count: number): number[] {
  const out: number[] = [];
  for (let i = 0; i <= count; i++) out.push(Math.round((i * total) / count));
  return out;
}

/**
 * The quad index (row-major, matching `glyphMapPolygons`'s own emission
 * order) containing `lon`/`lat` at a given quad grid. Equirectangular never
 * crops, so no quad is skipped and the index is also the polygon index.
 */
function quadIndexAt(tile: GlyphMapGeoTile, qCols: number, qRows: number, lon: number, lat: number): number {
  const colAt = gridLineIndices(tile.cols, qCols);
  const rowAt = gridLineIndices(tile.rows, qRows);
  const fx = ((lon - tile.bounds.west) / (tile.bounds.east - tile.bounds.west)) * tile.cols;
  const fy = ((tile.bounds.north - lat) / (tile.bounds.north - tile.bounds.south)) * tile.rows;
  let c = 0;
  while (c < qCols - 1 && colAt[c + 1]! <= fx) c++;
  let r = 0;
  while (r < qRows - 1 && rowAt[r + 1]! <= fy) r++;
  return r * qCols + c;
}

const classify = GlyphMapClassifiers.etopo1V1.classifyValue!;
/** `elev -> band index`, as the widget's own raster colour callback does. */
const bandColor = (elev: number): string => String(classify(elev));

/**
 * The `GLYPH_MAP_RELIEF_FRACTIONS` ladder (`widget.ts`) the widget actually
 * mounts a relief tier at, plus the single-quad extreme a permanently
 * mounted floor tier approaches when the view is far out.
 */
const FRACTIONS = [1, 7 / 8, 6 / 8, 5 / 8, 4 / 8, 3 / 8, 2 / 8, 1 / 8, 1 / 20];

/**
 * The independent measurement of "how much of this terrain is above sea
 * level": a brute-force 32x32 midpoint lattice over each source cell's own
 * bilinear patch, cached per cell so a quad covering many cells is their
 * mean. This is deliberately NOT how `mesh.ts` computes its statistic (it
 * solves each row exactly and samples across rows), so the invariant below is
 * a measurement of the shipped rule rather than a restatement of it.
 */
const REFERENCE_LATTICE = 32;

function surfaceAboveSeaLevelPerCell(tile: GlyphMapGeoTile): Float64Array {
  const stride = tile.cols + 1;
  const out = new Float64Array(tile.cols * tile.rows);
  for (let r = 0; r < tile.rows; r++) {
    for (let c = 0; c < tile.cols; c++) {
      const nw = tile.elevation[r * stride + c]!;
      const ne = tile.elevation[r * stride + c + 1]!;
      const sw = tile.elevation[(r + 1) * stride + c]!;
      const se = tile.elevation[(r + 1) * stride + c + 1]!;
      let above = 0;
      for (let j = 0; j < REFERENCE_LATTICE; j++) {
        const v = (j + 0.5) / REFERENCE_LATTICE;
        const west = nw + (sw - nw) * v;
        const east = ne + (se - ne) * v;
        for (let i = 0; i < REFERENCE_LATTICE; i++) {
          if (west + (east - west) * ((i + 0.5) / REFERENCE_LATTICE) >= 0) above++;
        }
      }
      out[r * tile.cols + c] = above / (REFERENCE_LATTICE * REFERENCE_LATTICE);
    }
  }
  return out;
}

const SIGHTINGS = [
  { name: "bogota", label: "Bogota", minElevation: 2000 },
  { name: "quito", label: "Quito", minElevation: 2000 },
  { name: "altiplano", label: "the Chilean/Bolivian Altiplano", minElevation: 4000 },
] as const;

describe("relief quads never paint land with a below-sea-level band", () => {
  it("the vendored fixture really does carry each sighting's true ETOPO1 elevation", () => {
    for (const { name, label, minElevation } of SIGHTINGS) {
      const tile = tileOf(name);
      const [lon, lat] = FIXTURE[name]!.at;
      const col = Math.round(((lon - tile.bounds.west) / (tile.bounds.east - tile.bounds.west)) * tile.cols);
      const row = Math.round(((tile.bounds.north - lat) / (tile.bounds.north - tile.bounds.south)) * tile.rows);
      const elev = tile.elevation[row * (tile.cols + 1) + col]!;
      expect(elev, `${label} fixture elevation`).toBeGreaterThan(minElevation);
      expect(classify(elev), `${label} fixture band`).toBeGreaterThan(0);
    }
  });

  it("Amsterdam's own fixture value is the real, genuinely negative ETOPO1 reading — a presentation question, not a sampling defect", () => {
    const tile = tileOf("amsterdam");
    const [lon, lat] = FIXTURE.amsterdam!.at;
    const col = Math.round(((lon - tile.bounds.west) / (tile.bounds.east - tile.bounds.west)) * tile.cols);
    const row = Math.round(((tile.bounds.north - lat) / (tile.bounds.north - tile.bounds.south)) * tile.rows);
    const elev = tile.elevation[row * (tile.cols + 1) + col]!;
    expect(elev).toBeLessThanOrEqual(0);
    expect(elev).toBeGreaterThan(-20);
  });

  for (const { name, label } of SIGHTINGS) {
    it(`${label} is never coloured with the below-sea-level band, at any mesh resolution`, () => {
      const tile = tileOf(name);
      const [lon, lat] = FIXTURE[name]!.at;
      const water: string[] = [];
      for (const fraction of FRACTIONS) {
        const qCols = Math.min(tile.cols, Math.max(1, Math.round(tile.cols * fraction)));
        const qRows = Math.min(tile.rows, Math.max(1, Math.round(tile.rows * fraction)));
        const polygons = glyphMapPolygons(tile, glyphMapEquirectangular(), {
          color: bandColor,
          resolution: { cols: qCols, rows: qRows },
        });
        expect(polygons.length).toBe(qCols * qRows);
        const band = polygons[quadIndexAt(tile, qCols, qRows, lon, lat)]!.color;
        if (band === "0") water.push(`${label} painted as water at ${qCols}x${qRows} quads`);
      }
      expect(water).toEqual([]);
    });
  }

  /**
   * The reported case, on the real z4 data the page renders: the vendored
   * `buenosAires` window is baked at the pyramid's own 0.125-degree vertex
   * spacing, so its downtown quad is EXACTLY the quad on screen — the city
   * vertex at +12 m against the Rio de la Plata's three -1 m corners. At the
   * target tier (fraction 1) that quad is one source cell, which is where the
   * sample median has nothing but a 3-of-4 vote to go on.
   */
  it("Buenos Aires' downtown quad is land at the tier the reader sees, even though three of its four samples are the estuary", () => {
    const tile = tileOf("buenosAires");
    const [lon, lat] = FIXTURE.buenosAires!.at;
    const stride = tile.cols + 1;
    const col = Math.round(((lon - tile.bounds.west) / (tile.bounds.east - tile.bounds.west)) * tile.cols);
    const row = Math.round(((tile.bounds.north - lat) / (tile.bounds.north - tile.bounds.south)) * tile.rows);
    // The fixture really is the reported quad: the city corner and its three estuary neighbours.
    expect(tile.elevation[row * stride + col]).toBe(12);
    expect(tile.elevation[(row - 1) * stride + col]).toBe(-1);
    expect(tile.elevation[(row - 1) * stride + col + 1]).toBe(-1);
    expect(tile.elevation[row * stride + col + 1]).toBe(-1);

    const polygons = glyphMapPolygons(tile, glyphMapEquirectangular(), { color: bandColor });
    // The quad whose SW corner is the city vertex — one row north of it.
    const quad = polygons[(row - 1) * tile.cols + col]!;
    const surfaceAbove = surfaceAboveSeaLevelPerCell(tile)[(row - 1) * tile.cols + col]!;
    expect(surfaceAbove).toBeGreaterThan(0.7);
    expect(`downtown quad band ${quad.color} over a surface ${(surfaceAbove * 100).toFixed(0)}% above sea level`)
      .toBe(`downtown quad band 1 over a surface ${(surfaceAbove * 100).toFixed(0)}% above sea level`);
  });

  it("a quad's band is the one that covers the majority of the terrain surface it covers — in both directions, at every mesh resolution", () => {
    const offenders: string[] = [];
    for (const name of Object.keys(FIXTURE)) {
      const tile = tileOf(name);
      const cellAbove = surfaceAboveSeaLevelPerCell(tile);
      for (const fraction of FRACTIONS) {
        const qCols = Math.min(tile.cols, Math.max(1, Math.round(tile.cols * fraction)));
        const qRows = Math.min(tile.rows, Math.max(1, Math.round(tile.rows * fraction)));
        const colAt = gridLineIndices(tile.cols, qCols);
        const rowAt = gridLineIndices(tile.rows, qRows);
        const polygons = glyphMapPolygons(tile, glyphMapEquirectangular(), {
          color: bandColor,
          resolution: { cols: qCols, rows: qRows },
        });
        for (let r = 0; r < qRows; r++) {
          for (let c = 0; c < qCols; c++) {
            let above = 0;
            let cells = 0;
            for (let vr = rowAt[r]!; vr < rowAt[r + 1]!; vr++) {
              for (let vc = colAt[c]!; vc < colAt[c + 1]!; vc++) {
                above += cellAbove[vr * tile.cols + vc]!;
                cells++;
              }
            }
            const fractionAbove = above / cells;
            const band = polygons[r * qCols + c]!.color;
            const where = `${name} f=${fraction.toFixed(3)} quad(${c},${r}): ${(fractionAbove * 100).toFixed(1)}% of its surface at or above sea level`;
            if (fractionAbove > 0.5 && band === "0") offenders.push(`${where}, painted band 0`);
            if (fractionAbove < 0.5 && band !== "0") offenders.push(`${where}, painted band ${band}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
