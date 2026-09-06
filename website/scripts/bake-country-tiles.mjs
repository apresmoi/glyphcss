// Bake Natural Earth ADMIN-0 COUNTRY LABEL POINTS into @glyphcss/maps's
// quadtree vector tile format — the point dataset behind `/maps`'s `symbol`
// and `circle` layers' "Countries" option, and the symbol layer's default.
//
// WHY A SEPARATE PYRAMID from `bake-place-tiles.mjs`: attribution is derived
// from the mounted layer's own provider (`GlyphMapVectorProvider.attribution`
// -> `map.getAttributions()`), never hardcoded. Populated places and admin-0
// countries are two different Natural Earth files with two different
// provenance records, and a tile carries ONE attribution list — folding the
// countries into the places pyramid would credit a source the user is not
// looking at whenever they show cities. Separate source, separate pyramid,
// separate provider, correct credit line.
//
// WHY NOT the country POLYGON pyramid we already bake
// (`bake-vector-tiles.mjs`, world-atlas admin_0): its properties are `{ name }`
// and nothing else — no label position, no prominence, no population. A
// polygon has no label point, and deriving one is a choice with real failure
// modes (a centroid of Chile/Norway/Indonesia falls in the sea).
//
// WHERE THE LABEL POINT COMES FROM: Natural Earth's own `LABEL_X`/`LABEL_Y`
// columns, which exist on `ne_50m_admin_0_countries` for exactly this
// purpose — cartographer-placed, so they sit inside the country's own land
// and dodge the centroid failure entirely. Measured over all 242 features
// with a point-in-polygon test against each feature's OWN geometry: 232 land
// strictly inside (Chile, Norway, Indonesia, South Africa, Lesotho, Italy,
// Russia all inside; South Africa's point is NOT inside enclaved Lesotho,
// and Lesotho's own point is). The 10 that miss are microstates and single-
// island nations (Vatican, Macao, Antigua and Barb., Trinidad and Tobago,
// Sao Tome and Principe, St. Vin. and Gren., Eq. Guinea, New Zealand, S.
// Geo. and the Is., Br. Indian Ocean Ter.) whose 50m-generalized polygon is
// smaller than Natural Earth's deliberate label offset — that is the source
// telling the truth about a shape too small to hold its own label at this
// resolution, not a placement defect.
//
// WHY 50m: 242 countries, every one carrying LABEL_X/LABEL_Y and LABELRANK.
// The 110m file has only 177 (it drops the small states a reader would then
// find missing when zoomed in); 10m is 258 at ~9x the download for four more
// countries a glyph map cannot resolve anyway.
//
// PROPERTIES kept per feature are Natural Earth's own column names verbatim
// (`name`, `labelrank`, `pop_est`, `iso_a3`, `continent`) plus TWO derived
// columns — `label_priority` and `pop_scale`. Both exist because
// `@glyphcss/maps` layers are DATA, not expressions: `priorityProperty` /
// `radiusProperty` / `weightProperty` name a column and the layer scales it,
// so any inversion or renormalization has to be baked. See each function.
//
// Run with:
//   node website/scripts/bake-country-tiles.mjs

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { glyphMapBuildVectorTile } from "@glyphcss/maps";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "../..");
const OUT = path.join(REPO, "website/public/data/country-tiles");

const NE_TAG = "v5.1.2";
const SOURCE_URL = `https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@${NE_TAG}/geojson/ne_50m_admin_0_countries.geojson`;

const ATTRIBUTION = [
  {
    name: "Natural Earth — admin 0 country label points (50m)",
    url: "https://www.naturalearthdata.com",
    license: "Public domain",
    date: NE_TAG,
  },
];

const ZOOMS = [0, 1, 2, 3, 4];
/**
 * Natural Earth's `LABELRANK` (lower = label this one first) is the column NE
 * ships to decide which country labels survive at which map scale, so the
 * per-zoom thinning schedule reads it rather than inventing a second
 * prominence measure — the same discipline `bake-place-tiles.mjs` applies to
 * `scalerank`. This file's observed range is 2..7. `Infinity` at the deepest
 * level means "every country".
 */
const LABELRANK_MAX = { 0: 3, 1: 4, 2: 5, 3: 6, 4: Infinity };
/** Same nominal source resolution the other two pyramids record, so `glyphMapTargetLOD` treats all three alike. */
const TILE_COLS_NOMINAL = 180;

/**
 * `LABELRANK` INVERTED into the widget's own priority convention.
 *
 * `createPointFeatureRuntime` (packages/maps/src/widget.ts) reads
 * `priorityProperty` as a number where HIGHER wins — `glyphMapDeclutterLabels`
 * sorts descending, and `minPriority` drops anything BELOW its value. Natural
 * Earth's `LABELRANK` runs the other way (2 = most prominent). Feeding it raw
 * would rank Vatican over Russia and make the "minimum prominence" control
 * mean its own opposite, so the inversion is baked as its own column rather
 * than left as a trap for whichever layer reads it.
 *
 * `10 - LABELRANK` puts this file's 2..7 range on 3..8, all positive, with a
 * little headroom either side if a future Natural Earth release widens the
 * range.
 */
function labelPriority(labelrank) {
  return 10 - labelrank;
}

/**
 * A 0..1 LOG-normalized population, baked once — the `circle` layer's
 * `radiusProperty` and the `heatmap` layer's `weightProperty` both read a
 * column called `pop_scale`, and `bake-place-tiles.mjs` writes one under that
 * exact name, so a country tile carrying the same column makes the dataset
 * swap a genuine drop-in: no page-side branch on which dataset is selected,
 * and the radius keeps meaning a real measured quantity (people) rather than
 * a rank dressed up as a magnitude.
 *
 * The window is 1e5..1.5e9 people, which brackets THIS file's own range
 * (Pitcairn at 50 up to China at 1.397e9) — deliberately a different window
 * from the places baker's 1e3..4e7, because each dataset normalizes within
 * itself: a country pyramid whose largest dot was a 40M-person window would
 * clip China, India and the United States to one indistinguishable maximum.
 */
function popScale(pop) {
  const LO = Math.log10(1e5);
  const HI = Math.log10(1.5e9);
  const v = (Math.log10(Math.max(pop, 1e5)) - LO) / (HI - LO);
  return Math.round(Math.min(1, Math.max(0, v)) * 1000) / 1000;
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch failed: ${url} (${res.status})`);
  return res.json();
}

/** One admin-0 feature -> the package's own `GlyphMapVectorFeature` shape (a one-point ring at NE's own label position). */
function toVectorFeature(f) {
  const p = f.properties;
  return {
    id: String(p.ADM0_A3 ?? p.NE_ID),
    geometryType: "point",
    properties: {
      name: p.NAME,
      labelrank: p.LABELRANK,
      label_priority: labelPriority(p.LABELRANK),
      pop_est: p.POP_EST,
      pop_scale: popScale(p.POP_EST),
      iso_a3: p.ADM0_A3,
      continent: p.CONTINENT,
    },
    rings: [[[p.LABEL_X, p.LABEL_Y]]],
  };
}

async function main() {
  console.log(`Fetching Natural Earth admin-0 countries (50m, ${NE_TAG})...`);
  const geojson = await fetchJson(SOURCE_URL);
  const all = geojson.features
    .filter(
      (f) =>
        Number.isFinite(f.properties?.LABEL_X) &&
        Number.isFinite(f.properties?.LABEL_Y) &&
        Number.isFinite(f.properties?.LABELRANK),
    )
    .map(toVectorFeature);
  if (all.length === 0) throw new Error("no admin-0 feature carried LABEL_X/LABEL_Y/LABELRANK — source schema changed");
  console.log(`  countries ${all.length}`);

  await fs.rm(OUT, { recursive: true, force: true });
  await fs.mkdir(OUT, { recursive: true });

  const manifestZooms = [];
  const tileIndex = {};
  const report = [];
  let totalBytes = 0;

  for (const z of ZOOMS) {
    const n = 2 ** z;
    const rankMax = LABELRANK_MAX[z];
    const layers = { countries: all.filter((f) => f.properties.labelrank <= rankMax) };
    const keys = [];
    let levelBytes = 0;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const tile = glyphMapBuildVectorTile(layers, z, x, y, {
          source: "natural-earth-admin-0-label-points",
          simplify: "none",
          attribution: ATTRIBUTION,
        });
        if (Object.keys(tile.layers).length === 0) continue; // no country label in this tile
        const dir = path.join(OUT, String(z));
        await fs.mkdir(dir, { recursive: true });
        const json = JSON.stringify(tile);
        await fs.writeFile(path.join(dir, `${x}_${y}.json`), json);
        levelBytes += Buffer.byteLength(json);
        keys.push(`${x}_${y}`);
      }
    }
    totalBytes += levelBytes;
    tileIndex[z] = keys;
    manifestZooms.push({
      z, cols: n, rows: n,
      tileLonSpan: 360 / n, tileLatSpan: 180 / n,
      tileCols: TILE_COLS_NOMINAL, tileRows: TILE_COLS_NOMINAL / 2,
    });
    report.push({ z, countriesKept: layers.countries.length, tiles: keys.length, bytes: levelBytes });
    console.log(`z${z} (labelrank <= ${rankMax}): ${layers.countries.length} countries, ${keys.length} tiles, ${(levelBytes / 1024).toFixed(1)} KB`);
  }

  const manifest = {
    zooms: manifestZooms,
    source: "natural-earth-admin-0-label-points",
    resolution: "50m",
    attribution: ATTRIBUTION,
    // The full tile INDEX, not just the level shape — same reason
    // `bake-place-tiles.mjs` writes one: most addresses in a point pyramid
    // have no tile at all, and the reader must answer "nothing here" without
    // a 404 round trip, because `createFeatureLayerRuntime` resolves its
    // whole visible set through one `Promise.all` (one rejection would drop
    // every other tile in that view too).
    tiles: tileIndex,
    layers: {
      countries: {
        description: "one label point per admin-0 country, at Natural Earth's own LABEL_X/LABEL_Y",
        count: all.length,
      },
    },
    properties: {
      name: "country name (Natural Earth NAME)",
      labelrank: "Natural Earth LABELRANK, LOWER = more prominent",
      label_priority: "derived: 10 - labelrank, so HIGHER = more prominent (the widget's own priority convention)",
      pop_est: "Natural Earth POP_EST (people)",
      pop_scale: "derived: pop_est log-normalized to 0..1 over 1e5..1.5e9 people",
      iso_a3: "Natural Earth ADM0_A3",
      continent: "Natural Earth CONTINENT",
    },
  };
  await fs.writeFile(path.join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2));

  console.log(`\nTotal: ${(totalBytes / 1024).toFixed(1)} KB across ${ZOOMS.length} levels.`);
  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
