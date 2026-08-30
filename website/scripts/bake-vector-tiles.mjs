// Bake Natural Earth admin_0 country boundaries into @glyphcss/maps's
// quadtree vector tile format (MAPS.md §13 slice 5).
//
// Pipeline, per the coordinator's two pinned ORDER traps:
//   1. Decode a whole-world TopoJSON topology's shared arcs.
//   2. Simplify EVERY arc ONCE for the whole level (glyphMapSimplifyArcs) —
//      never per-tile, never per-feature-ring — so two adjacent countries'
//      shared border decimates identically everywhere it's drawn.
//   3. Resolve rings from the simplified arcs.
//   4. THEN clip + quantize into z/x/y tiles (glyphMapBuildVectorTile).
//
// Source resolution per level (z0-1 -> 110m, z2-3 -> 50m): world-atlas ships
// exactly those two Natural-Earth-derived TopoJSON resolutions; it does not
// ship a 10m admin_0 file, so this bake does NOT reach the z4+ -> 10m tier
// the design sketch describes for the GLOBAL pyramid — see this script's own
// printed report and MAPS_VECTOR_TILES.md for the honest accounting. A
// single CURATED place (Switzerland) is baked one level deeper (z4) at a
// far finer epsilon, straight from the 50m source with almost no
// simplification, demonstrating the curated-bundle mechanism
// (`glyphMapCuratedVectorProvider`) even though the global z4 tier itself
// is out of reach without a real 10m source.
//
// Run with:
//   node website/scripts/bake-vector-tiles.mjs

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  decodeGlyphMapTopoJsonArcs,
  glyphMapTopoJsonFeatures,
  glyphMapSimplifyArcs,
  glyphMapCellEpsilonDeg,
  glyphMapBuildVectorTile,
  glyphMapVectorTileBounds,
} from "@glyphcss/maps";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "../..");
const OUT = path.join(REPO, "website/public/data/vector-tiles");

const ATTRIBUTION = [
  { name: "Natural Earth", url: "https://www.naturalearthdata.com", license: "Public domain", date: "v5.1.1 (via world-atlas)" },
];

const SOURCES = {
  110: "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json",
  50: "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-50m.json",
};

// z0-1 -> 110m, z2-3 -> 50m (the coordinator's mapping, minus the z4+ -> 10m
// tier world-atlas can't supply — see this file's header).
const LEVEL_SOURCE = { 0: 110, 1: 110, 2: 50, 3: 50 };
// Nominal "native resolution" quad count for LOD math parity with the
// raster geo-tiles pyramid (provider.ts's glyphMapTargetLOD reads
// `tileLonSpan / tileCols` as degrees-per-source-unit) — vector tiles have
// no real quad grid, so this is a documented stand-in, not a measured value.
const TILE_COLS_NOMINAL = 180;

const CURATED_NAME = "Switzerland";
const CURATED_Z = 4;
const CURATED_EPSILON_DEG = 0.002; // near-zero simplification — almost every source vertex kept

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch failed: ${url} (${res.status})`);
  return res.json();
}

function featureBounds(feature) {
  let west = Infinity, east = -Infinity, south = Infinity, north = -Infinity;
  for (const ring of feature.rings) {
    for (const [lon, lat] of ring) {
      if (lon < west) west = lon;
      if (lon > east) east = lon;
      if (lat < south) south = lat;
      if (lat > north) north = lat;
    }
  }
  return { west, east, south, north };
}

function tilesOverlapping(z, bounds) {
  const n = 2 ** z;
  const tileLonSpan = 360 / n;
  const tileLatSpan = 180 / n;
  const x0 = Math.max(0, Math.floor((bounds.west + 180) / tileLonSpan));
  const x1 = Math.min(n - 1, Math.floor((bounds.east + 180) / tileLonSpan));
  const y0 = Math.max(0, Math.floor((90 - bounds.north) / tileLatSpan));
  const y1 = Math.min(n - 1, Math.floor((90 - bounds.south) / tileLatSpan));
  const out = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push([x, y]);
  return out;
}

async function main() {
  const topologies = {};
  for (const res of new Set(Object.values(LEVEL_SOURCE))) {
    console.log(`Fetching ${res}m admin_0 topology...`);
    topologies[res] = await fetchJson(SOURCES[res]);
  }

  await fs.rm(OUT, { recursive: true, force: true });
  await fs.mkdir(OUT, { recursive: true });

  const manifestZooms = [];
  const report = [];
  let totalBytes = 0;

  for (const z of [0, 1, 2, 3]) {
    const res = LEVEL_SOURCE[z];
    const topo = topologies[res];
    const n = 2 ** z;
    const tileLonSpan = 360 / n;
    const tileLatSpan = 180 / n;
    const epsilon = glyphMapCellEpsilonDeg(tileLonSpan / TILE_COLS_NOMINAL);
    const decoded = decodeGlyphMapTopoJsonArcs(topo);
    const simplified = glyphMapSimplifyArcs(decoded, epsilon);
    const features = glyphMapTopoJsonFeatures(topo, "countries", simplified);

    let levelBytes = 0;
    let tileCount = 0;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const tile = glyphMapBuildVectorTile({ admin0: features }, z, x, y, {
          source: "natural-earth",
          simplify: `vw-z${z}-${res}m`,
          attribution: ATTRIBUTION,
        });
        if (Object.keys(tile.layers).length === 0) continue; // ocean-only tile
        const dir = path.join(OUT, String(z));
        await fs.mkdir(dir, { recursive: true });
        const json = JSON.stringify(tile);
        await fs.writeFile(path.join(dir, `${x}_${y}.json`), json);
        levelBytes += Buffer.byteLength(json);
        tileCount++;
      }
    }
    totalBytes += levelBytes;
    manifestZooms.push({ z, cols: n, rows: n, tileLonSpan, tileLatSpan, tileCols: TILE_COLS_NOMINAL, tileRows: TILE_COLS_NOMINAL / 2 });
    report.push({ z, sourceRes: `${res}m`, epsilonDeg: epsilon, tiles: tileCount, bytes: levelBytes });
    console.log(`z${z} (${res}m source, eps=${epsilon.toFixed(4)}deg): ${tileCount} tiles, ${(levelBytes / 1024).toFixed(1)} KB`);
  }

  // ── Curated place: Switzerland, one level deeper, near-zero simplification ──
  const topo50 = topologies[50];
  const decoded50 = decodeGlyphMapTopoJsonArcs(topo50);
  const fineArcs = glyphMapSimplifyArcs(decoded50, CURATED_EPSILON_DEG);
  const fineFeatures = glyphMapTopoJsonFeatures(topo50, "countries", fineArcs);
  const curatedFeature = fineFeatures.find((f) => f.properties?.name === CURATED_NAME);
  if (!curatedFeature) throw new Error(`curated place "${CURATED_NAME}" not found in source topology`);
  const curatedBounds = featureBounds(curatedFeature);
  const curatedTiles = tilesOverlapping(CURATED_Z, curatedBounds);

  let curatedBytes = 0;
  const curatedDir = path.join(OUT, "curated", String(CURATED_Z));
  await fs.mkdir(curatedDir, { recursive: true });
  for (const [x, y] of curatedTiles) {
    const tile = glyphMapBuildVectorTile({ admin0: fineFeatures }, CURATED_Z, x, y, {
      source: "natural-earth",
      simplify: `curated-${CURATED_NAME.toLowerCase()}-z${CURATED_Z}`,
      attribution: ATTRIBUTION,
    });
    if (Object.keys(tile.layers).length === 0) continue;
    const json = JSON.stringify(tile);
    await fs.writeFile(path.join(curatedDir, `${x}_${y}.json`), json);
    curatedBytes += Buffer.byteLength(json);
  }
  totalBytes += curatedBytes;
  console.log(
    `curated "${CURATED_NAME}" (z${CURATED_Z}, eps=${CURATED_EPSILON_DEG}deg): ${curatedTiles.length} tiles, ${(curatedBytes / 1024).toFixed(1)} KB`,
  );

  const manifest = {
    zooms: manifestZooms,
    source: "natural-earth",
    simplify: "visvalingam-whyatt",
    attribution: ATTRIBUTION,
    curated: [
      {
        name: CURATED_NAME,
        zoom: { z: CURATED_Z, cols: 2 ** CURATED_Z, rows: 2 ** CURATED_Z, tileLonSpan: 360 / 2 ** CURATED_Z, tileLatSpan: 180 / 2 ** CURATED_Z, tileCols: TILE_COLS_NOMINAL, tileRows: TILE_COLS_NOMINAL / 2 },
        bounds: curatedBounds,
        tiles: curatedTiles.map(([x, y]) => `${x}_${y}`),
      },
    ],
  };
  await fs.writeFile(path.join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2));

  console.log(`\nTotal: ${(totalBytes / 1024).toFixed(1)} KB across ${manifestZooms.length} global levels + 1 curated place.`);
  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
