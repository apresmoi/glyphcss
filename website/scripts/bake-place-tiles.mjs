// Bake Natural Earth POPULATED PLACES into @glyphcss/maps's quadtree vector
// tile format — the point dataset behind `/maps`'s `symbol`, `circle` and
// `heatmap` layers.
//
// Those three layer types are point-driven and, until this bake existed, the
// page pointed all of them at the country-POLYGON pyramid
// (`bake-vector-tiles.mjs`), which has no points in it at all — so they
// rendered nothing however they were configured. `glyphMapBuildVectorTile`
// carries point features now (`packages/maps/src/vector/tile.ts`); this is
// the data that fills them.
//
// SOURCE: `ne_50m_populated_places_simple` from nvkelso/natural-earth-vector,
// pinned to a release tag, fetched from jsDelivr at bake time — the same
// CDN-at-bake-time convention `bake-vector-tiles.mjs` already uses for
// world-atlas. Public domain, no key.
//
// WHY 50m: 1,251 places. The 10m file carries ~7,300 and every one of them
// becomes a DOM hotspot in the `symbol`/`circle` runtimes, which is a bad
// trade for a demo; the 110m file carries ~240, too sparse for a heatmap to
// read as a field. 50m is the only resolution that serves all three layers.
//
// LAYERS (each a `sourceLayer` the page's per-layer dataset picker selects):
//   places      every populated place, thinned per zoom by Natural Earth's
//               own `scalerank` — the column NE ships for exactly this.
//   capitals    `adm0cap === 1`, i.e. national capitals (200).
//   megacities  `pop_max >= 5,000,000` (53).
// `capitals`/`megacities` are already small, so they are NOT thinned per
// zoom: thinning a 53-feature layer at z0 would empty it.
//
// PROPERTIES kept per feature are Natural Earth's own column names verbatim
// (`name`, `pop_max`, `adm0name`, `scalerank`) plus ONE derived column,
// `pop_scale` — see `popScale` below for why a derived 0..1 column is needed
// rather than scaling raw population at render time.
//
// Run with:
//   node website/scripts/bake-place-tiles.mjs

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { glyphMapBuildVectorTile } from "@glyphcss/maps";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "../..");
const OUT = path.join(REPO, "website/public/data/place-tiles");

const NE_TAG = "v5.1.2";
const SOURCE_URL = `https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@${NE_TAG}/geojson/ne_50m_populated_places_simple.geojson`;

const ATTRIBUTION = [
  {
    name: "Natural Earth — populated places (50m)",
    url: "https://www.naturalearthdata.com",
    license: "Public domain",
    date: NE_TAG,
  },
];

const ZOOMS = [0, 1, 2, 3, 4];
/**
 * Natural Earth's `scalerank` (0 = most prominent, 10 = least) is the
 * column NE ships to decide which places survive at which map scale, so the
 * per-zoom thinning schedule reads it rather than inventing a second
 * prominence measure. `Infinity` at the deepest level means "everything".
 */
const PLACES_SCALERANK_MAX = { 0: 1, 1: 3, 2: 5, 3: 7, 4: Infinity };
/** Same nominal source resolution `bake-vector-tiles.mjs` records, so `glyphMapTargetLOD` treats both pyramids alike. */
const TILE_COLS_NOMINAL = 180;

const MEGACITY_POP = 5_000_000;

/**
 * A 0..1 LOG-normalized population, baked once rather than derived at render
 * time. Two reasons it has to be a column and not a runtime expression:
 *
 *  - `@glyphcss/maps` layers are DATA, not expressions — `radiusProperty` /
 *    `weightProperty` name a column and the layer's own `radiusScale` turns
 *    it into pixels. There is no `interpolate`/`log` operator to write here.
 *  - Population is log-distributed over four decades (this file's own range
 *    is 0 to 35,676,000). Linear scaling makes Tokyo 357x a 100,000-person
 *    town, which is a single enormous dot and 1,200 invisible ones — and it
 *    weights a heatmap into one spike rather than a field.
 *
 * The window is 1e3..4e7 people, which brackets the dataset (its own max is
 * Tokyo at 3.57e7) and puts a 100,000-person town near 0.43.
 */
function popScale(pop) {
  const LO = Math.log10(1e3);
  const HI = Math.log10(4e7);
  const v = (Math.log10(Math.max(pop, 1e3)) - LO) / (HI - LO);
  return Math.round(Math.min(1, Math.max(0, v)) * 1000) / 1000;
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch failed: ${url} (${res.status})`);
  return res.json();
}

/** GeoJSON Point feature -> the package's own `GlyphMapVectorFeature` shape (a one-point ring). */
function toVectorFeature(f) {
  const [lon, lat] = f.geometry.coordinates;
  const p = f.properties;
  return {
    id: String(p.ne_id),
    geometryType: "point",
    properties: {
      name: p.name,
      pop_max: p.pop_max,
      pop_scale: popScale(p.pop_max),
      adm0name: p.adm0name,
      scalerank: p.scalerank,
    },
    rings: [[[lon, lat]]],
  };
}

async function main() {
  console.log(`Fetching Natural Earth populated places (50m, ${NE_TAG})...`);
  const geojson = await fetchJson(SOURCE_URL);
  const all = geojson.features
    .filter((f) => f.geometry?.type === "Point" && Number.isFinite(f.geometry.coordinates?.[0]))
    .map(toVectorFeature);

  const capitals = geojson.features.filter((f) => f.properties.adm0cap === 1).map(toVectorFeature);
  const megacities = all.filter((f) => f.properties.pop_max >= MEGACITY_POP);
  console.log(`  places ${all.length} · capitals ${capitals.length} · megacities ${megacities.length}`);

  await fs.rm(OUT, { recursive: true, force: true });
  await fs.mkdir(OUT, { recursive: true });

  const manifestZooms = [];
  const tileIndex = {};
  const report = [];
  let totalBytes = 0;

  for (const z of ZOOMS) {
    const n = 2 ** z;
    const rankMax = PLACES_SCALERANK_MAX[z];
    const layers = {
      places: all.filter((f) => f.properties.scalerank <= rankMax),
      capitals,
      megacities,
    };
    const keys = [];
    let levelBytes = 0;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const tile = glyphMapBuildVectorTile(layers, z, x, y, {
          source: "natural-earth-populated-places",
          simplify: "none",
          attribution: ATTRIBUTION,
        });
        if (Object.keys(tile.layers).length === 0) continue; // no place in this tile
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
    report.push({ z, placesKept: layers.places.length, tiles: keys.length, bytes: levelBytes });
    console.log(`z${z} (scalerank <= ${rankMax}): ${layers.places.length} places, ${keys.length} tiles, ${(levelBytes / 1024).toFixed(1)} KB`);
  }

  const manifest = {
    zooms: manifestZooms,
    source: "natural-earth-populated-places",
    resolution: "50m",
    attribution: ATTRIBUTION,
    // The full tile INDEX, not just the level shape: most of the world is
    // ocean, so most addresses have no tile, and the reader must answer
    // "nothing here" without a 404 round trip (`createFeatureLayerRuntime`
    // resolves its whole visible set with one `Promise.all` — a single
    // rejection would drop the entire layer for that view, not one tile).
    tiles: tileIndex,
    layers: {
      places: { description: "every populated place, thinned per zoom by Natural Earth's own scalerank" },
      capitals: { description: "national capitals (adm0cap = 1)", count: capitals.length },
      megacities: { description: `population >= ${MEGACITY_POP.toLocaleString("en-US")}`, count: megacities.length },
    },
    properties: {
      name: "place name",
      pop_max: "maximum population estimate (people)",
      pop_scale: "derived: population log-normalized to 0..1 over 1e3..4e7 people",
      adm0name: "country name",
      scalerank: "Natural Earth prominence, 0 = most prominent",
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
