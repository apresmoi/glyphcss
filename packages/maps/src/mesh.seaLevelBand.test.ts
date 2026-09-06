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
 * The fix is to take the quad's representative elevation as the MEDIAN of
 * the baked vertices it actually covers. That carries a guarantee a mean
 * cannot: if strictly more than half of a quad's covered samples are above
 * sea level then more than half the sorted samples are, so the median is
 * too — a majority-land quad can never be classified into a below-sea-level
 * band, at any mesh resolution. This file pins both the named real-world
 * sightings and that general invariant.
 *
 * Amsterdam is deliberately present but NOT asserted as a defect: at
 * ETOPO1's own resolution much of the Netherlands genuinely is below sea
 * level (the fixture's nearest vertex to the city is -3 m), so band 0 there
 * is the data reporting itself faithfully. Whether bathymetric blue is the
 * right cartography for reclaimed dry land is a presentation question, not
 * a sampling defect, and this test asserts only that the fixture holds that
 * real negative value.
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

  it("no quad whose covered samples are majority above sea level is ever given a below-sea-level band — the invariant a corner mean cannot hold", () => {
    const offenders: string[] = [];
    for (const name of Object.keys(FIXTURE)) {
      const tile = tileOf(name);
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
            let total = 0;
            for (let vr = rowAt[r]!; vr <= rowAt[r + 1]!; vr++) {
              for (let vc = colAt[c]!; vc <= colAt[c + 1]!; vc++) {
                if (tile.elevation[vr * (tile.cols + 1) + vc]! >= 0) above++;
                total++;
              }
            }
            const band = polygons[r * qCols + c]!.color;
            if (above * 2 > total && band === "0") {
              offenders.push(`${name} f=${fraction.toFixed(3)} quad(${c},${r}): ${above}/${total} samples at or above sea level, painted band 0`);
            }
            if (above * 2 < total && band !== "0") {
              offenders.push(`${name} f=${fraction.toFixed(3)} quad(${c},${r}): ${total - above}/${total} samples below sea level, painted band ${band}`);
            }
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
