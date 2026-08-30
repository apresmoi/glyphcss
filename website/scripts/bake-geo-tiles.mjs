// Bake ETOPO1 into @glyphcss/maps's GEOGRAPHIC tile schema — lon/lat/
// elevation, no projection baked in (MAPS.md §13 slice 2's headline
// decision: "tile coordinates: geographic (lon/lat/elev)... projection is
// applied client-side"). This supersedes `bake-globe.mjs --tiles`'s own
// PRE-projected `{z}/{x}_{y}.json` tiles as the format going forward — this
// script is the one slice 3's widget and the website will actually consume.
//
// Two modes:
//   --tiles (default): bakes the same z0/z1 pyramid `bake-globe.mjs --tiles`
//     bakes (1 tile at z0, 4 quadrants at z1, each a 180x90-quad grid) into
//     `website/public/data/geo-tiles/{z}/{x}_{y}.json`. Gitignored — this is
//     regenerable output, not small enough to vendor (~tens of MB
//     uncompressed at this resolution, comparable to the existing
//     pre-projected `website/public/data/tiles/`).
//   --fixture: bakes ONE small (10x10-quad, 121-vertex) window and writes it
//     to `packages/maps/fixtures/geo-tile-parity.json` — the vendored
//     fixture `packages/maps/src/parity.test.ts` (acceptance gate 3) reads
//     to prove `glyphMapGlobe` reproduces `bake-globe.mjs`'s own checked-in
//     `website/public/data/tiles/0/0_0.json` vertex-for-vertex (up to the
//     documented, deliberate `Y`-sign difference — see that test file's
//     "known deviation" note). Small enough to vendor (a few KB), so CI
//     needs no ETOPO1 to run the parity gate.
//
// The NetCDF-3 parsing + nearest-vertex sampler below are copied verbatim
// from `bake-globe.mjs` (same source file, same header format, same
// node-registered nearest-sample convention) — this is the SAME
// determinism-bearing sampling math (MAPS.md §10: "the package must own the
// resampling math"), not an independently re-derived copy that could drift.
//
// Run with:
//   node --max-old-space-size=2048 website/scripts/bake-geo-tiles.mjs --fixture
//   node --max-old-space-size=2048 website/scripts/bake-geo-tiles.mjs --tiles

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

  return {
    NX, NY, LON_MIN, LON_MAX, LAT_MIN, LAT_MAX,
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
  return sampler;
}

// ── geographic tile bake (own resampling math — MAPS.md §10) ─────────────
function bakeGeoTile(sampler, bounds, cols, rows) {
  const vcols = cols + 1;
  const vrows = rows + 1;
  const elevation = new Float32Array(vcols * vrows);
  const tileShape = { bounds, cols, rows };
  for (let row = 0; row < vrows; row++) {
    for (let col = 0; col < vcols; col++) {
      const [lon, lat] = glyphMapGeoTileVertexLonLat(tileShape, col, row);
      elevation[row * vcols + col] = sampler.elevAt(lat, lon);
    }
  }
  return { bounds, cols, rows, elevation: Array.from(elevation), source: "etopo1", sampler: "nearest" };
}

async function bakeFixture(sampler) {
  // A 10x10-quad window near the equator (lon [10, 30], lat [-10, 10]) —
  // real elevation variance (not the poles, where cos(lat) trivializes most
  // terms), and small: 11x11 = 121 vertices, a few KB as JSON.
  const bounds = { west: 10, east: 30, south: -10, north: 10 };
  const tile = bakeGeoTile(sampler, bounds, 10, 10);
  const out = path.join(REPO, "packages/maps/fixtures/geo-tile-parity.json");
  await fs.writeFile(out, `${JSON.stringify(tile, null, 2)}\n`);
  console.log(`Wrote ${out}`);
}

async function bakeTiles(sampler) {
  const COLS_PER_TILE = 180;
  const ROWS_PER_TILE = 90;
  const ROOT = path.join(REPO, "website/public/data/geo-tiles");
  await fs.mkdir(ROOT, { recursive: true });
  const zooms = [
    { z: 0, cols: 1, rows: 1 },
    { z: 1, cols: 2, rows: 2 },
  ];
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
        const out = path.join(zDir, `${tx}_${ty}.json`);
        await fs.writeFile(out, JSON.stringify(tile));
        const stat = await fs.stat(out);
        console.log(`z=${z} tile (${tx},${ty}) — ${(stat.size / 1024).toFixed(1)} KB`);
      }
    }
  }
  // Carries everything `GlyphMapProviderZoomLevel` (packages/maps/src/
  // provider.ts) needs to build a `GlyphMapProvider` client-side without a
  // second hardcoded copy of COLS_PER_TILE/ROWS_PER_TILE — the website's
  // provider adapter (src/lib/geoTilesProvider.ts) reads this manifest
  // directly into that shape.
  const manifest = {
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
  };
  await fs.writeFile(path.join(ROOT, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(`Wrote ${path.join(ROOT, "manifest.json")}`);
}

async function main() {
  const fixtureMode = process.argv.includes("--fixture");
  const sampler = await loadSampler();
  if (fixtureMode) {
    await bakeFixture(sampler);
    return;
  }
  await bakeTiles(sampler);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
