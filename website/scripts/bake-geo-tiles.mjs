// Bake ETOPO1 into @glyphcss/maps's GEOGRAPHIC tile schema — lon/lat/
// elevation, no projection baked in (MAPS.md §13 slice 2's headline
// decision: "tile coordinates: geographic (lon/lat/elev)... projection is
// applied client-side"). This supersedes `bake-globe.mjs --tiles`'s own
// PRE-projected `{z}/{x}_{y}.json` tiles as the format going forward — this
// script is the one slice 3's widget and the website will actually consume.
//
// Two modes:
//   --tiles (the default; also accepted explicitly): bakes a z0-z4 GLOBAL
//     pyramid (1, 4, 16, 64, 256 tiles = 341 total, each a 180x90-quad grid)
//     into `website/public/data/geo-tiles/{z}/{x}_{y}.bin` — a raw little-
//     endian Int16Array of vertex-centered elevation samples ONLY (no JSON,
//     no header; `bounds`/`cols`/`rows`/`source`/`sampler` all come from
//     `manifest.json`, which records `format: "int16"` and `byteOrder:
//     "little-endian"` so a reader can never mis-parse a stale pyramid
//     against new code, or vice versa).
//     ETOPO1's `z` variable is whole metres in [-10898, 8271] (measured
//     against the full source grid), well inside int16's range, so this is
//     lossless. Gitignored — this is regenerable output. Measured total size
//     at z0-z4: 11.2 MB on disk (341 tiles, 16471 samples/tile x 2 bytes) —
//     a prior claim of "~tens of MB" here was never measured and was wrong.
//     Past z4 the global pyramid would cost tens to hundreds of MB per
//     level (measured from the actual 32,942 bytes/tile and 4^z tiles/level:
//     z5 ~33.7 MB, z6 ~134.9 MB, z7 ~539.7 MB as int16), so `--tiles` also
//     bakes a CURATED raster overlay (the raster mirror of `bake-vector-tiles.mjs`'s
//     curated bundle, `@glyphcss/maps`'s `glyphMapCuratedProvider`, which
//     supports several curated PLACES sharing a depth — entries are grouped
//     by `zoom.z` and their real-tile key sets/bounds unioned): z5-z7 tiles,
//     but only inside each `CURATED_PLACES` entry's own bounds (Switzerland,
//     west 5.9 east 10.5 south 45.8 north 47.9; Bahía Blanca + Sierra de la
//     Ventana, west -62.8 east -61.2 south -39.2 north -37.7 — Buenos Aires
//     was measured and deliberately excluded, see that constant's own
//     comment), into `website/public/data/geo-tiles/curated/{z}/{x}_{y}.bin`
//     — same `.bin` shape, same 180x90-quad grid, recorded as
//     `manifest.curated` (one entry per curated place PER zoom level:
//     `{ name, zoom, bounds, tiles }`, `tiles` the exact list of real
//     `"x_y"` keys at that level) rather than a second manifest file, so a
//     reader needs exactly one fetch and never has to probe for 404s.
//   --fixture: bakes TWO vendored fixtures. The first is ONE small
//     (10x10-quad, 121-vertex) window written to
//     `packages/maps/fixtures/geo-tile-parity.json` — the vendored
//     fixture `packages/maps/src/parity.test.ts` (acceptance gate 3) reads
//     to prove `glyphMapGlobe` reproduces `bake-globe.mjs`'s own checked-in
//     `website/public/data/tiles/0/0_0.json` vertex-for-vertex (up to the
//     documented, deliberate `Y`-sign difference — see that test file's
//     "known deviation" note). Small enough to vendor (a few KB), so CI
//     needs no ETOPO1 to run the parity gate. Unchanged by the int16 tile
//     format above — the fixture stays plain, human-readable JSON. The
//     second is `packages/maps/fixtures/sea-level-band.json`: four small
//     20x20-quad windows straddling a coastline (see
//     `SEA_LEVEL_BAND_WINDOWS`), which pin that a relief quad never paints
//     land with a below-sea-level band.
//
// The NetCDF-3 parsing + nearest-vertex sampler below are copied verbatim
// from `bake-globe.mjs` (same source file, same header format, same
// node-registered nearest-sample convention) — this is the SAME
// determinism-bearing sampling math (MAPS.md §10: "the package must own the
// resampling math"), not an independently re-derived copy that could drift.
//
// Run with:
//   node --max-old-space-size=4096 website/scripts/bake-geo-tiles.mjs --fixture
//   node --max-old-space-size=4096 website/scripts/bake-geo-tiles.mjs --tiles

import { promises as fs } from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { glyphMapGeoTileVertexLonLat } from "@glyphcss/maps";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "../..");
const SRC = path.join(REPO, "etopo/ETOPO1_Ice_g_gmt4.grd.gz");

// ── NetCDF-3 classic header parser (verbatim from bake-globe.mjs) ────────
const NC_DIMENSION = 10;
const NC_VARIABLE = 11;
const NC_ATTRIBUTE = 12;
const NC_TYPE = { 1: "byte", 2: "char", 3: "short", 4: "int", 5: "float", 6: "double" };
const NC_TYPE_SIZE = { byte: 1, char: 1, short: 2, int: 4, float: 4, double: 8 };

function parseNcHeader(buf) {
  let p = 0;
  if (buf.toString("ascii", 0, 3) !== "CDF") throw new Error("not a NetCDF file");
  const version = buf[3];
  p = 4;
  const readInt32 = () => { const v = buf.readInt32BE(p); p += 4; return v; };
  const readString = () => {
    const len = readInt32();
    const s = buf.toString("utf8", p, p + len);
    p += len;
    p = (p + 3) & ~3;
    return s;
  };
  const readAttrList = () => {
    const tag = readInt32();
    const n = readInt32();
    if (tag === 0 && n === 0) return [];
    if (tag !== NC_ATTRIBUTE) throw new Error(`bad attr tag ${tag}`);
    const attrs = [];
    for (let i = 0; i < n; i++) {
      const name = readString();
      const type = NC_TYPE[readInt32()];
      const len = readInt32();
      const values = [];
      if (type === "char") {
        values.push(buf.toString("utf8", p, p + len));
        p += len;
      } else if (type === "int") {
        for (let k = 0; k < len; k++) values.push(buf.readInt32BE(p + k * 4));
        p += len * 4;
      } else if (type === "double") {
        for (let k = 0; k < len; k++) values.push(buf.readDoubleBE(p + k * 8));
        p += len * 8;
      } else if (type === "float") {
        for (let k = 0; k < len; k++) values.push(buf.readFloatBE(p + k * 4));
        p += len * 4;
      } else {
        p += len * NC_TYPE_SIZE[type];
      }
      p = (p + 3) & ~3;
      attrs.push({ name, type, values });
    }
    return attrs;
  };

  readInt32(); // numrecs
  const dimTag = readInt32();
  const dimN = readInt32();
  const dims = [];
  if (dimTag === NC_DIMENSION) {
    for (let i = 0; i < dimN; i++) dims.push({ name: readString(), size: readInt32() });
  }
  const gattrs = readAttrList();
  const varTag = readInt32();
  const varN = readInt32();
  const vars = [];
  if (varTag === NC_VARIABLE) {
    for (let i = 0; i < varN; i++) {
      const name = readString();
      const ndims = readInt32();
      const dimids = [];
      for (let k = 0; k < ndims; k++) dimids.push(readInt32());
      const attrs = readAttrList();
      const type = NC_TYPE[readInt32()];
      const vsize = readInt32();
      const begin = version === 1 ? readInt32() : Number(buf.readBigInt64BE(p));
      if (version === 2) p += 8;
      vars.push({ name, dimids, attrs, type, vsize, begin });
    }
  }
  return { dims, gattrs, vars };
}

function makeSampler(buf, header) {
  const zVar = header.vars.find((v) => v.name === "z");
  if (!zVar) throw new Error("no `z` variable in NetCDF header");
  if (zVar.type !== "int") throw new Error(`expected z to be int, got ${zVar.type}`);
  const lonDim = header.dims.find((d) => /lon|x/i.test(d.name));
  const latDim = header.dims.find((d) => /lat|y/i.test(d.name));
  if (!lonDim || !latDim) throw new Error("could not infer grid shape from dims");
  const NX = lonDim.size;
  const NY = latDim.size;
  const xVar = header.vars.find((v) => /lon|^x$/i.test(v.name));
  const yVar = header.vars.find((v) => /lat|^y$/i.test(v.name));
  const readAxis = (v, n) => {
    const sz = NC_TYPE_SIZE[v.type];
    const first = v.type === "double" ? buf.readDoubleBE(v.begin) : buf.readFloatBE(v.begin);
    const last = v.type === "double" ? buf.readDoubleBE(v.begin + sz * (n - 1)) : buf.readFloatBE(v.begin + sz * (n - 1));
    return [first, last];
  };
  let [LON_MIN, LON_MAX] = readAxis(xVar, NX);
  let [LAT_MIN, LAT_MAX] = readAxis(yVar, NY);
  if (LAT_MIN > LAT_MAX) { const t = LAT_MIN; LAT_MIN = LAT_MAX; LAT_MAX = t; }

  const sampleCell = (col, row) => buf.readInt32BE(zVar.begin + (row * NX + col) * 4);

  let elevationMin = Infinity;
  let elevationMax = -Infinity;
  const sourceSamples = NX * NY;
  const sourceEnd = zVar.begin + sourceSamples * NC_TYPE_SIZE.int;
  if (sourceEnd > buf.byteLength) {
    throw new RangeError(`ETOPO1 z grid overruns the NetCDF payload: needs ${sourceEnd} bytes, file has ${buf.byteLength}.`);
  }
  for (let i = 0; i < sourceSamples; i++) {
    const value = buf.readInt32BE(zVar.begin + i * NC_TYPE_SIZE.int);
    if (value < elevationMin) elevationMin = value;
    if (value > elevationMax) elevationMax = value;
  }
  if (elevationMin < INT16_MIN || elevationMax > INT16_MAX) {
    throw new RangeError(
      `bake-geo-tiles: source elevation range [${elevationMin}, ${elevationMax}] exceeds int16 [${INT16_MIN}, ${INT16_MAX}] — refusing a lossy bake.`,
    );
  }

  return {
    NX, NY, LON_MIN, LON_MAX, LAT_MIN, LAT_MAX, elevationMin, elevationMax,
    latToRow: (lat) => Math.min(NY - 1, Math.max(0, Math.round(((lat - LAT_MIN) / (LAT_MAX - LAT_MIN)) * (NY - 1)))),
    lonToCol: (lon) => Math.min(NX - 1, Math.max(0, Math.round(((lon - LON_MIN) / (LON_MAX - LON_MIN)) * (NX - 1)))),
    elevAt(lat, lon) { return sampleCell(this.lonToCol(lon), this.latToRow(lat)); },
  };
}

async function loadSampler() {
  console.log(`Reading ${SRC}…`);
  const gz = await fs.readFile(SRC);
  const buf = zlib.gunzipSync(gz);
  console.log(`Decompressed ${(buf.byteLength / 1e6).toFixed(1)} MB; parsing header…`);
  const header = parseNcHeader(buf);
  const sampler = makeSampler(buf, header);
  console.log(`Source grid ${sampler.NX}x${sampler.NY}, lon [${sampler.LON_MIN}, ${sampler.LON_MAX}], lat [${sampler.LAT_MIN}, ${sampler.LAT_MAX}]`);
  console.log(`Source elevation range [${sampler.elevationMin}, ${sampler.elevationMax}] m fits losslessly in int16.`);
  return sampler;
}

// int16 range check is a real guard against a future source swap (a
// dataset with a taller vertical range than ETOPO1's measured
// [-10898, 8271]), not defensive code for a case ETOPO1 itself can hit.
const INT16_MIN = -32768;
const INT16_MAX = 32767;

// ── geographic tile bake (own resampling math — MAPS.md §10) ─────────────
// Returns the raw Int16Array payload the `.bin` file is written from
// verbatim (no JSON envelope) plus the shape/provenance fields the manifest
// records once per level rather than repeating per tile.
function bakeGeoTile(sampler, bounds, cols, rows) {
  const vcols = cols + 1;
  const vrows = rows + 1;
  const elevation = new Int16Array(vcols * vrows);
  const tileShape = { bounds, cols, rows };
  for (let row = 0; row < vrows; row++) {
    for (let col = 0; col < vcols; col++) {
      const [lon, lat] = glyphMapGeoTileVertexLonLat(tileShape, col, row);
      const value = sampler.elevAt(lat, lon);
      if (!Number.isInteger(value) || value < INT16_MIN || value > INT16_MAX) {
        throw new RangeError(
          `bake-geo-tiles: sampled elevation ${value} at lon=${lon} lat=${lat} is outside int16 range [${INT16_MIN}, ${INT16_MAX}] or non-integer — the source dataset no longer fits this tile format.`,
        );
      }
      elevation[row * vcols + col] = value;
    }
  }
  return { bounds, cols, rows, elevation, source: "etopo1", sampler: "nearest" };
}

// Small real-ETOPO1 windows straddling a shoreline, vendored so
// `packages/maps/src/mesh.seaLevelBand.test.ts` can assert against REAL
// geography without ETOPO1 in CI. Each window deliberately spans deep ocean
// AND high terrain, because that is the combination that used to paint land
// as water: a coarsened relief quad took its colour from the mean of its 4
// corners, and where those corners straddle a coast the mean falls below sea
// level even though most of the quad is land (measured: Bogota's floor-tier
// quad averaged -155 m over terrain whose own median is +194 m).
//
// `at` is a lon/lat that lands exactly on a vertex of the window's own grid,
// so the test can assert the fixture really does hold that place's true
// elevation before it asserts anything about colour.
const SEA_LEVEL_BAND_WINDOWS = [
  { name: "bogota", bounds: { west: -79, east: -69, south: 0, north: 10 }, at: [-74, 4.5] },
  { name: "quito", bounds: { west: -84, east: -74, south: -5, north: 5 }, at: [-78.5, 0] },
  { name: "altiplano", bounds: { west: -73, east: -63, south: -27, north: -17 }, at: [-68, -22] },
  { name: "amsterdam", bounds: { west: 0, east: 10, south: 48, north: 58 }, at: [5, 52.5] },
];
const SEA_LEVEL_BAND_QUADS = 20;

async function bakeSeaLevelBandFixture(sampler) {
  const out = {};
  for (const window of SEA_LEVEL_BAND_WINDOWS) {
    const tile = bakeGeoTile(sampler, window.bounds, SEA_LEVEL_BAND_QUADS, SEA_LEVEL_BAND_QUADS);
    out[window.name] = {
      bounds: tile.bounds,
      cols: tile.cols,
      rows: tile.rows,
      at: window.at,
      elevation: Array.from(tile.elevation),
      source: tile.source,
      sampler: tile.sampler,
    };
  }
  const dest = path.join(REPO, "packages/maps/fixtures/sea-level-band.json");
  await fs.writeFile(dest, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`Wrote ${dest}`);
}

async function bakeFixture(sampler) {
  // A 10x10-quad window near the equator (lon [10, 30], lat [-10, 10]) —
  // real elevation variance (not the poles, where cos(lat) trivializes most
  // terms), and small: 11x11 = 121 vertices, a few KB as JSON.
  const bounds = { west: 10, east: 30, south: -10, north: 10 };
  const tile = bakeGeoTile(sampler, bounds, 10, 10);
  // `bakeGeoTile` now returns `elevation` as an Int16Array (the `.bin` tile
  // format below) — the fixture stays plain-array JSON exactly as before,
  // so it's converted explicitly rather than `JSON.stringify`ing the typed
  // array, which would serialize as an `{"0":...,"1":...}` object instead.
  const out = path.join(REPO, "packages/maps/fixtures/geo-tile-parity.json");
  await fs.writeFile(out, `${JSON.stringify({ ...tile, elevation: Array.from(tile.elevation) }, null, 2)}\n`);
  console.log(`Wrote ${out}`);
}

// `Int16Array`'s own backing buffer is native-endian, which is LE on every
// realistic build/serve host but not guaranteed — the `.bin` files are a
// wire format read back by a browser via DataView, so this writes explicit
// little-endian bytes regardless of the baking host's endianness.
function encodeInt16LE(int16) {
  const out = Buffer.allocUnsafe(int16.length * 2);
  for (let i = 0; i < int16.length; i++) out.writeInt16LE(int16[i], i * 2);
  return out;
}

// Same overlap math `bake-vector-tiles.mjs` uses to find which tiles a
// bounds box actually touches at a given zoom — copied rather than imported
// because it's a few lines of pure arithmetic over the SAME equal-angle
// addressing this file's own global-pyramid loop already uses, not
// independently re-derived.
//
// Multiple curated PLACES, each baked at the same three deeper zooms.
// `packages/maps/src/curated.ts`'s `glyphMapCuratedProvider` groups
// `manifest.curated` entries by `zoom.z` and UNIONS their real-tile key
// sets, so a second place sharing a depth an existing place already
// occupies is additive, not a collision — confirmed by that module's own
// "two curated places sharing one zoom" test suite before relying on the
// claim here.
//
// Buenos Aires (measured: -2..39 m across the whole metro box, a 41 m
// spread) is deliberately NOT included — see the bake report for the
// measured numbers behind that call. Bahía Blanca's box is widened north
// of the city itself to reach into the Sierra de la Ventana range (ETOPO1-
// resolved peak 929 m at roughly lon -61.95, lat -38.17), which is what
// makes its curated depth show real relief instead of another flat
// rectangle (measured: -10..929 m, a 939 m spread, inside the box below).
const CURATED_PLACES = [
  { name: "Switzerland", bounds: { west: 5.9, east: 10.5, south: 45.8, north: 47.9 }, zs: [5, 6, 7] },
  { name: "Bahía Blanca (incl. Sierra de la Ventana)", bounds: { west: -62.8, east: -61.2, south: -39.2, north: -37.7 }, zs: [5, 6, 7] },
];

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

// Bakes the curated raster overlay (this file's own header, and
// `packages/maps/src/curated.ts`'s `glyphMapCuratedProvider`, which this
// schema is built for): real tiles ONLY inside each place's own bounds, at
// each of its own `zs`, past the global pyramid's own max zoom. Returns the
// `manifest.curated` entries (one per place per level) plus byte/tile
// totals for the final report — never written to `manifest.json` itself.
//
// Two places can legitimately share a tile at a shallow depth (a big
// enough tile spans more than one place's box) — `written` dedupes the
// actual disk write/stat per (z, x, y) across places so the byte/tile
// totals count each file once, while both places still list the shared key
// in their own `tiles` set (harmless: `glyphMapCuratedProvider` groups by
// `zoom.z` and a shared key's `loadTile` fetches the same path regardless
// of which place "claims" it).
async function bakeCurated(sampler, root, colsPerTile, rowsPerTile) {
  const entries = [];
  let totalBytes = 0;
  let totalTiles = 0;
  const written = new Map(); // z -> Set of "x_y" already baked to disk this run
  for (const place of CURATED_PLACES) {
    for (const z of place.zs) {
      const n = 2 ** z;
      const tileLonSpan = 360 / n;
      const tileLatSpan = 180 / n;
      const zDir = path.join(root, "curated", String(z));
      await fs.mkdir(zDir, { recursive: true });
      const zWritten = written.get(z) ?? new Set();
      written.set(z, zWritten);
      const tileKeys = [];
      for (const [tx, ty] of tilesOverlapping(z, place.bounds)) {
        const key = `${tx}_${ty}`;
        tileKeys.push(key);
        if (zWritten.has(key)) continue;
        const lonMin = -180 + tx * tileLonSpan;
        const latMax = 90 - ty * tileLatSpan;
        const bounds = { west: lonMin, east: lonMin + tileLonSpan, south: latMax - tileLatSpan, north: latMax };
        const tile = bakeGeoTile(sampler, bounds, colsPerTile, rowsPerTile);
        const out = path.join(zDir, `${key}.bin`);
        await fs.writeFile(out, encodeInt16LE(tile.elevation));
        const stat = await fs.stat(out);
        totalBytes += stat.size;
        totalTiles += 1;
        zWritten.add(key);
      }
      entries.push({
        name: place.name,
        zoom: { z, cols: n, rows: n, tileLonSpan, tileLatSpan, tileCols: colsPerTile, tileRows: rowsPerTile },
        bounds: place.bounds,
        tiles: tileKeys,
      });
      console.log(`curated "${place.name}" z=${z}: ${tileKeys.length} tiles`);
    }
  }
  return { entries, totalBytes, totalTiles };
}

async function bakeTiles(sampler) {
  const COLS_PER_TILE = 180;
  const ROWS_PER_TILE = 90;
  const ROOT = path.join(REPO, "website/public/data/geo-tiles");
  await fs.rm(ROOT, { recursive: true, force: true });
  await fs.mkdir(ROOT, { recursive: true });
  const zooms = [
    { z: 0, cols: 1, rows: 1 },
    { z: 1, cols: 2, rows: 2 },
    { z: 2, cols: 4, rows: 4 },
    { z: 3, cols: 8, rows: 8 },
    { z: 4, cols: 16, rows: 16 },
  ];
  let totalBytes = 0;
  let totalTiles = 0;
  for (const { z, cols, rows } of zooms) {
    const zDir = path.join(ROOT, String(z));
    await fs.mkdir(zDir, { recursive: true });
    const tileLonSpan = 360 / cols;
    const tileLatSpan = 180 / rows;
    for (let ty = 0; ty < rows; ty++) {
      for (let tx = 0; tx < cols; tx++) {
        const lonMin = -180 + tx * tileLonSpan;
        const latMax = 90 - ty * tileLatSpan;
        const bounds = { west: lonMin, east: lonMin + tileLonSpan, south: latMax - tileLatSpan, north: latMax };
        const tile = bakeGeoTile(sampler, bounds, COLS_PER_TILE, ROWS_PER_TILE);
        const out = path.join(zDir, `${tx}_${ty}.bin`);
        await fs.writeFile(out, encodeInt16LE(tile.elevation));
        const stat = await fs.stat(out);
        totalBytes += stat.size;
        totalTiles += 1;
      }
    }
    const samplesPerTile = (COLS_PER_TILE + 1) * (ROWS_PER_TILE + 1);
    console.log(`z=${z}: ${cols * rows} tiles baked (${((cols * rows * samplesPerTile * 2) / 1024).toFixed(1)} KB)`);
  }
  const curated = await bakeCurated(sampler, ROOT, COLS_PER_TILE, ROWS_PER_TILE);
  totalBytes += curated.totalBytes;
  totalTiles += curated.totalTiles;
  // Carries everything `GlyphMapProviderZoomLevel` (packages/maps/src/
  // provider.ts) needs to build a `GlyphMapProvider` client-side without a
  // second hardcoded copy of COLS_PER_TILE/ROWS_PER_TILE — the website's
  // provider adapter (src/lib/geoTilesProvider.ts) reads this manifest
  // directly into that shape.
  const manifest = {
    // Genuinely gated by the reader (alongside `format`): a manifest whose
    // SCHEMA changes independent of the tile payload encoding (e.g. this
    // slice's `curated` field) still needs a reader to be able to tell it
    // apart from an older manifest that has no such field.
    version: 2,
    // The ONLY tile payload encoding this manifest version's readers accept
    // — `website/src/lib/geoTilesProvider.ts` rejects anything else rather
    // than falling back to a JSON parse (repo rule: no dual code paths).
    format: "int16",
    byteOrder: "little-endian",
    elevationRange: { min: sampler.elevationMin, max: sampler.elevationMax, units: "metres" },
    zooms: zooms.map((z) => ({
      z: z.z,
      cols: z.cols,
      rows: z.rows,
      tileLonSpan: 360 / z.cols,
      tileLatSpan: 180 / z.rows,
      tileCols: COLS_PER_TILE,
      tileRows: ROWS_PER_TILE,
    })),
    source: "etopo1",
    sampler: "nearest",
    // MAPS.md's attribution requirement (derived from mounted layers, not
    // hardcoded on the page): ETOPO1's own provenance, attached once here
    // so `geoTilesProvider.ts` can forward it as `GlyphMapProvider.attribution`.
    attribution: [
      { name: "NOAA NCEI (ETOPO1)", url: "https://www.ngdc.noaa.gov/mgg/global/", license: "Public domain", date: "2009" },
    ],
    // The raster curated overlay (`bakeCurated` above) — one entry per
    // curated zoom level, `tiles` the exact real `"x_y"` keys at that
    // level, so `geoTilesProvider.ts` can build a `GlyphMapCuratedRasterTiles`
    // for each without probing the tile server for what exists.
    curated: curated.entries,
  };
  await fs.writeFile(path.join(ROOT, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(`Wrote ${path.join(ROOT, "manifest.json")}`);
  console.log(`Total: ${totalTiles} tiles, ${(totalBytes / 1e6).toFixed(2)} MB on disk (${curated.totalTiles} curated).`);
}

async function main() {
  const fixtureMode = process.argv.includes("--fixture");
  const sampler = await loadSampler();
  if (fixtureMode) {
    await bakeFixture(sampler);
    await bakeSeaLevelBandFixture(sampler);
    return;
  }
  await bakeTiles(sampler);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
