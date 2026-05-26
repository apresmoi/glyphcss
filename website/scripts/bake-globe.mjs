// Bake ETOPO1 terrain into glyphcss-renderable polygon tiles.
//
// Two modes:
//   - Default (no args): bakes the whole globe at 180×90 to a single legacy
//     output (website/public/data/earth.json). Keeps the simple /map demo
//     working without tiles.
//   - Tile pyramid mode (--tiles): bakes a tile pyramid into
//     public/data/tiles/{z}/{x}_{y}.json. Currently emits zoom 0 (1 tile,
//     full globe at 180×90) and zoom 1 (4 quadrants, each 180×90 ≈ 4×
//     resolution density vs. zoom 0).
//
// Pipeline (per tile):
//   1. gunzip ETOPO1_Ice_g_gmt4.grd.gz → in-memory buffer (~933 MB)
//      (cached across tiles in this process — only paid once)
//   2. Parse NetCDF-3 header by hand to find the `z` variable offset.
//      netcdfjs materialises every cell as a JS number and OOMs even at
//      8 GB heap; we keep z as an int32-BE view over the source buffer.
//   3. For the tile's lat/lon range, sample ETOPO1 at (COLS+1)×(ROWS+1)
//      grid, displace each vertex outward by elevation * exaggeration.
//   4. Emit one quad per cell, colored by averaged elevation bucket.
//
// Run with:
//   node --max-old-space-size=2048 website/scripts/bake-globe.mjs           # legacy single-file
//   node --max-old-space-size=2048 website/scripts/bake-globe.mjs --tiles   # tile pyramid

import { promises as fs } from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "../..");
const SRC = path.join(REPO, "etopo/ETOPO1_Ice_g_gmt4.grd.gz");

const HEIGHT_EXAGG = 30;
const EARTH_RADIUS_M = 6_371_000;

// ── NetCDF-3 classic header parser (only what we need) ───────────────────
const NC_DIMENSION = 10;
const NC_VARIABLE  = 11;
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
    for (let i = 0; i < dimN; i++) {
      dims.push({ name: readString(), size: readInt32() });
    }
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

// Elevation → band index 0..8 (water + 8 land tiers). The flat-map tiles
// store the band per face; the client maps band→color via a chosen palette,
// so palettes can be swapped at runtime without re-baking.
function elevToBand(elev) {
  if (elev < 0)    return 0;
  if (elev < 250)  return 1;
  if (elev < 800)  return 2;
  if (elev < 1600) return 3;
  if (elev < 2600) return 4;
  if (elev < 3600) return 5;
  if (elev < 4600) return 6;
  if (elev < 5600) return 7;
  return 8;
}

// ── Terrain → color buckets (ocean depth / land elevation) ───────────────
function elevToColor(elev) {
  if (elev < -4000) return "#0a1a40";
  if (elev < -1000) return "#163070";
  if (elev < 0)     return "#2a55a8";
  if (elev < 300)   return "#3a6b30";
  if (elev < 1200)  return "#5a7a30";
  if (elev < 2500)  return "#8a7050";
  if (elev < 4000)  return "#a89070";
  return "#e0e0e0";
}

// Sphere coords. Y negated so longitude reads east-on-screen under
// glyphcss's Z-up / X-right / Y-into-screen convention. Quad winding is
// reversed downstream to compensate.
function latLonToXYZ(latDeg, lonDeg, radius) {
  const lat = (latDeg * Math.PI) / 180;
  const lon = (lonDeg * Math.PI) / 180;
  const cosLat = Math.cos(lat);
  return [
    radius * cosLat * Math.cos(lon),
    -radius * cosLat * Math.sin(lon),
    radius * Math.sin(lat),
  ];
}

// ── ETOPO1 sample function bound to a parsed source buffer ───────────────
function makeSampler(buf, header) {
  const zVar = header.vars.find((v) => v.name === "z");
  if (!zVar) throw new Error("no `z` variable in NetCDF header");
  if (zVar.type !== "int") {
    throw new Error(`expected z to be int, got ${zVar.type}`);
  }
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
    const last  = v.type === "double" ? buf.readDoubleBE(v.begin + sz * (n - 1)) : buf.readFloatBE(v.begin + sz * (n - 1));
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

// ── Bake one tile of the globe at the requested grid resolution ──────────
function bakeTile(sampler, opts) {
  const { lonMin, lonMax, latMin, latMax, cols, rows } = opts;

  const vertGrid = [];
  for (let j = 0; j <= rows; j++) {
    const rowOut = [];
    const lat = latMax - ((latMax - latMin) * j) / rows;
    for (let i = 0; i <= cols; i++) {
      const lon = lonMin + ((lonMax - lonMin) * i) / cols;
      const elev = sampler.elevAt(lat, lon);
      const r = 1 + (elev / EARTH_RADIUS_M) * HEIGHT_EXAGG;
      rowOut.push({ xyz: latLonToXYZ(lat, lon, r), elev });
    }
    vertGrid.push(rowOut);
  }

  const polygons = [];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const a = vertGrid[j][i];
      const b = vertGrid[j][i + 1];
      const c = vertGrid[j + 1][i + 1];
      const d = vertGrid[j + 1][i];
      const elevCenter = (a.elev + b.elev + c.elev + d.elev) / 4;
      // Reversed winding (a, d, c, b) because latLonToXYZ negates Y.
      polygons.push({
        vertices: [a.xyz, d.xyz, c.xyz, b.xyz],
        color: elevToColor(elevCenter),
      });
    }
  }
  return polygons;
}

// Number-truncation to 5 sig figs trims serialized JSON by ~30% without
// any visible quality loss at our zoom levels.
function trunc(n) { return Math.round(n * 1e5) / 1e5; }
function serializePolygons(polygons) {
  return JSON.stringify(polygons.map((p) => ({
    vertices: p.vertices.map(([x, y, z]) => [trunc(x), trunc(y), trunc(z)]),
    color: p.color,
  })));
}

async function loadSampler() {
  console.log(`Reading ${SRC}…`);
  const gz = await fs.readFile(SRC);
  const buf = zlib.gunzipSync(gz);
  console.log(`Decompressed ${(buf.byteLength / 1e6).toFixed(1)} MB; parsing header…`);
  const header = parseNcHeader(buf);
  const sampler = makeSampler(buf, header);
  console.log(`Source grid ${sampler.NX}×${sampler.NY}, lon [${sampler.LON_MIN}, ${sampler.LON_MAX}], lat [${sampler.LAT_MIN}, ${sampler.LAT_MAX}]`);
  console.log(`Sanity: Everest=${sampler.elevAt(27.99, 86.93)} m, Mariana=${sampler.elevAt(11.35, 142.20)} m, Sahara=${sampler.elevAt(23, 13)} m`);
  return sampler;
}

// Tighter 4-sig-fig truncation. The landing globe is rendered at small
// screen size with low cell density — extra decimal places are invisible
// but add ~25% to the JSON size before gzip.
const truncTight = (n) => Math.round(n * 1e4) / 1e4;
function serializePolygonsIndexedLanding(polygons) {
  const vertexMap = new Map();
  const vertices = [];
  function vertexIndex(v) {
    const key = `${truncTight(v[0])},${truncTight(v[1])},${truncTight(v[2])}`;
    let idx = vertexMap.get(key);
    if (idx === undefined) {
      idx = vertices.length;
      vertices.push([truncTight(v[0]), truncTight(v[1]), truncTight(v[2])]);
      vertexMap.set(key, idx);
    }
    return idx;
  }
  const colorPool = new Map();
  const colors = [];
  function colorIndex(c) {
    if (!c) return -1;
    let idx = colorPool.get(c);
    if (idx === undefined) {
      idx = colors.length;
      colors.push(c);
      colorPool.set(c, idx);
    }
    return idx;
  }
  const faces = polygons.map((p) => ({
    v: p.vertices.map((v) => vertexIndex(v)),
    c: colorIndex(p.color),
  }));
  return JSON.stringify({ vertices, colors, faces });
}

// Index-based serialization: dedupe shared vertices (~75% of vertices are
// shared between neighbouring quads), reference them by index. Pairs well
// with gzip because vertex coords cluster spatially.
function serializePolygonsIndexed(polygons) {
  const vertexMap = new Map();
  const vertices = [];
  function vertexIndex(v) {
    const key = `${trunc(v[0])},${trunc(v[1])},${trunc(v[2])}`;
    let idx = vertexMap.get(key);
    if (idx === undefined) {
      idx = vertices.length;
      vertices.push([trunc(v[0]), trunc(v[1]), trunc(v[2])]);
      vertexMap.set(key, idx);
    }
    return idx;
  }
  const colorPool = new Map();
  const colors = [];
  function colorIndex(c) {
    if (!c) return -1;
    let idx = colorPool.get(c);
    if (idx === undefined) {
      idx = colors.length;
      colors.push(c);
      colorPool.set(c, idx);
    }
    return idx;
  }
  const faces = polygons.map((p) => ({
    v: p.vertices.map((v) => vertexIndex(v)),
    c: colorIndex(p.color),
  }));
  return JSON.stringify({ vertices, colors, faces });
}

// ── Flat-map (iso terrain) support ───────────────────────────────────────
// A small region projected onto a flat plane: x/y from lon/lat (equirect-
// angular with cos-lat aspect correction so the region isn't stretched),
// z = elevation relief. Rendered at a fixed iso camera angle; the user pans
// across the plane. Plane is centered on the region center so the default
// camera target [0,0,0] frames the middle.

// Andes-tuned palette: more bands in the 0–7000 m land range than the global
// elevToColor (which spends half its buckets on bathymetry).
function elevToColorAndes(elev) {
  if (elev < 0)     return "#2a55a8"; // water (Pacific, lakes)
  if (elev < 250)   return "#2f5a36"; // coastal green
  if (elev < 800)   return "#3f6b32";
  if (elev < 1600)  return "#5f7536"; // foothills
  if (elev < 2600)  return "#86713f"; // dry slope
  if (elev < 3600)  return "#9c7b50"; // high desert
  if (elev < 4600)  return "#b09471"; // bare rock
  if (elev < 5600)  return "#cdb49a"; // scree
  return "#f0f0f0";                   // snow / summit
}

// Web Mercator latitude limit (where the projection becomes square).
const MERC_MAX_LAT = 85.0511;
// Inverse Web Mercator: normalized mercator Y (m ∈ [-1,1]) → latitude degrees.
function invMercatorLat(m) {
  return (Math.atan(Math.sinh(m * Math.PI)) * 180) / Math.PI;
}

// Project geographic lat/lon/elev → flat plane world coords, Web Mercator.
//   worldX = -mercatorY(lat)  → north maps to -X (top); conformal vertical.
//   worldY = (lon - lonC)/180 → east maps to +Y (right), linear.
//   worldZ = elevation        → relief toward the iso camera.
// Square plane: worldX, worldY ∈ [-1, 1]. Latitude is clamped to ±85.05°
// (Mercator can't represent the poles).
function flatToPlane(lat, lon, elev, proj) {
  const { lonC, scaleZ } = proj;
  const clamped = Math.max(-MERC_MAX_LAT, Math.min(MERC_MAX_LAT, lat));
  const mercY = Math.log(Math.tan(Math.PI / 4 + (clamped * Math.PI) / 360)) / Math.PI;
  return [
    -mercY,
    (lon - lonC) / 180,
    Math.max(0, elev) * scaleZ, // clamp ocean to z=0 — flat water reads cleaner
  ];
}

// Bake one flat-plane tile covering [lonMin,lonMax]×[latMin,latMax].
// Returns a serializable tile object:
//   vertices : deduped plane vertices (terrain surface, z = relief)
//   faces    : [{ v:[i,j,k,l], b: elevationBand }]  — b drives palette color
//   coast    : flat [x0,y0,x1,y1,...] sea-level contour (z=0)  — "continents"
//   wire     : flat [ax,ay,az,bx,by,bz,...] coarse surface lattice (3D)
//   bbox     : plane-space AABB for client frustum culling
function bakeFlatTile(sampler, opts, proj) {
  const { lonMin, lonMax, latMin, latMax, cols, rows } = opts;

  const vertGrid = [];
  for (let j = 0; j <= rows; j++) {
    const rowOut = [];
    const lat = latMax - ((latMax - latMin) * j) / rows;
    for (let i = 0; i <= cols; i++) {
      const lon = lonMin + ((lonMax - lonMin) * i) / cols;
      const elev = sampler.elevAt(lat, lon);
      rowOut.push({ xyz: flatToPlane(lat, lon, elev, proj), elev });
    }
    vertGrid.push(rowOut);
  }

  // Indexed terrain faces with elevation band.
  const vertexMap = new Map();
  const vertices = [];
  const vertexIndex = (v) => {
    const key = `${truncTight(v[0])},${truncTight(v[1])},${truncTight(v[2])}`;
    let idx = vertexMap.get(key);
    if (idx === undefined) {
      idx = vertices.length;
      vertices.push([truncTight(v[0]), truncTight(v[1]), truncTight(v[2])]);
      vertexMap.set(key, idx);
    }
    return idx;
  };
  const faces = [];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const a = vertGrid[j][i], b = vertGrid[j][i + 1];
      const c = vertGrid[j + 1][i + 1], d = vertGrid[j + 1][i];
      const elevCenter = (a.elev + b.elev + c.elev + d.elev) / 4;
      // Winding (a,d,c,b) keeps the top surface as the front face under cull.
      faces.push({
        v: [vertexIndex(a.xyz), vertexIndex(d.xyz), vertexIndex(c.xyz), vertexIndex(b.xyz)],
        b: elevToBand(elevCenter),
      });
    }
  }

  // Coastline contour: marching squares at elevation 0 (z=0, flat).
  const coast = [];
  const crossing = (p, q) => {
    const t = p.elev / (p.elev - q.elev);
    return [p.xyz[0] + t * (q.xyz[0] - p.xyz[0]), p.xyz[1] + t * (q.xyz[1] - p.xyz[1])];
  };
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const tl = vertGrid[j][i], tr = vertGrid[j][i + 1];
      const bl = vertGrid[j + 1][i], br = vertGrid[j + 1][i + 1];
      const pts = [];
      if ((tl.elev >= 0) !== (tr.elev >= 0)) pts.push(crossing(tl, tr));
      if ((tr.elev >= 0) !== (br.elev >= 0)) pts.push(crossing(tr, br));
      if ((bl.elev >= 0) !== (br.elev >= 0)) pts.push(crossing(bl, br));
      if ((tl.elev >= 0) !== (bl.elev >= 0)) pts.push(crossing(tl, bl));
      for (let k = 0; k + 1 < pts.length; k += 2) {
        coast.push(trunc(pts[k][0]), trunc(pts[k][1]), trunc(pts[k + 1][0]), trunc(pts[k + 1][1]));
      }
    }
  }

  // Heightmap wireframe = topographic contour lines at evenly-spaced
  // elevations, each sitting at its own relief Z. Contours hug terrain
  // features (ridges, valleys) — sparse on flats, dense on slopes — so they
  // read as the heightmap far better than an arbitrary grid lattice. Stacked
  // at elevation Z under the iso camera they show the 3D relief directly.
  // Grouped by elevation band so the client can color contours with the
  // active palette (low→high gradient). Each group: { b: band, segs: [...] }.
  const contourLevels = [200, 1000, 2000, 3000, 4000, 5000, 6000]; // metres
  const crossingAt = (p, q, level) => {
    const t = (level - p.elev) / (q.elev - p.elev);
    return [
      p.xyz[0] + t * (q.xyz[0] - p.xyz[0]),
      p.xyz[1] + t * (q.xyz[1] - p.xyz[1]),
      level * proj.scaleZ,
    ];
  };
  const wire = [];
  for (const level of contourLevels) {
    const segs = [];
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const tl = vertGrid[j][i], tr = vertGrid[j][i + 1];
        const bl = vertGrid[j + 1][i], br = vertGrid[j + 1][i + 1];
        const pts = [];
        if ((tl.elev >= level) !== (tr.elev >= level)) pts.push(crossingAt(tl, tr, level));
        if ((tr.elev >= level) !== (br.elev >= level)) pts.push(crossingAt(tr, br, level));
        if ((bl.elev >= level) !== (br.elev >= level)) pts.push(crossingAt(bl, br, level));
        if ((tl.elev >= level) !== (bl.elev >= level)) pts.push(crossingAt(tl, bl, level));
        for (let k = 0; k + 1 < pts.length; k += 2) {
          segs.push(
            trunc(pts[k][0]), trunc(pts[k][1]), trunc(pts[k][2]),
            trunc(pts[k + 1][0]), trunc(pts[k + 1][1]), trunc(pts[k + 1][2]),
          );
        }
      }
    }
    if (segs.length > 0) wire.push({ b: elevToBand(level), segs });
  }

  const corners = [
    flatToPlane(latMin, lonMin, 0, proj), flatToPlane(latMin, lonMax, 0, proj),
    flatToPlane(latMax, lonMin, 0, proj), flatToPlane(latMax, lonMax, 0, proj),
  ];
  const xs = corners.map((c) => c[0]);
  const ys = corners.map((c) => c[1]);
  const bbox = { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
  return { vertices, faces, coast, wire, bbox };
}

async function bakeFlatMap(sampler) {
  // Whole-world Web Mercator flat map. Square plane (worldX, worldY ∈ [-1,1]);
  // longitude → worldY (linear), latitude → worldX (Mercator, north up),
  // elevation → worldZ relief. Standard slippy-map tile pyramid: level z is
  // 2^z × 2^z square tiles, tile rows spaced evenly in Mercator-Y (so each
  // tile is square in projected space and seams align). Poles beyond ±85.05°
  // are not representable in Mercator and are clipped.
  const lonC = 0;

  // 1 plane unit (worldY) = 180° lon ≈ 20,000 km at the equator. Heavy
  // exaggeration so relief reads against the planet's scale; it pops as you
  // zoom in (visible extent shrinks, relief fixed). Tunable live via slider.
  const METERS_PER_UNIT = 20_000_000;
  const EXAGG = 200;
  const scaleZ = (1 / METERS_PER_UNIT) * EXAGG;
  const proj = { lonC, scaleZ };

  const planeHalfX = 1.0; // worldX ∈ [-1, 1]
  const planeHalfY = 1.0; // worldY ∈ [-1, 1] — square

  // Per-tile sample grid, ADAPTIVE per zoom level. A tile should carry roughly
  // as many samples as the glyph cells it occupies on screen when its LOD is
  // active. Shallow LODs have few tiles covering the whole viewport, so each
  // tile spans many cells → needs a dense grid. Deep LODs share the viewport
  // among many small tiles, so a light grid already matches cell density.
  // (`--grid N` forces a fixed grid for all levels, for A/B testing.)
  const gridArg = process.argv.indexOf("--grid");
  const fixedGrid = gridArg >= 0 ? parseInt(process.argv[gridArg + 1], 10) : null;
  // Balances crispness vs the ~35k-visible-poly / 60fps budget at each level's
  // active zoom (≈4 tiles fill the screen at LOD1, more tiles as you zoom in).
  const gridForZoom = (z) =>
    fixedGrid ?? (z <= 1 ? 96 : z === 2 ? 64 : z === 3 ? 48 : 32);
  const ROOT = path.join(REPO, "website/public/data/flatmap");
  await fs.rm(ROOT, { recursive: true, force: true });
  await fs.mkdir(ROOT, { recursive: true });

  // Square pyramid: z → 2^z × 2^z tiles.
  const zooms = [0, 1, 2, 3, 4, 5].map((z) => ({ z, n: 2 ** z }));

  const tileBoxes = {};
  let tileCount = 0;
  let totalKB = 0;

  for (const { z, n } of zooms) {
    const zDir = path.join(ROOT, String(z));
    await fs.mkdir(zDir, { recursive: true });
    const GRID = gridForZoom(z);
    const tileLon = 360 / n;
    for (let ty = 0; ty < n; ty++) {
      // Tile rows split Mercator-Y evenly (m ∈ [-1,1], +1 = north). Convert
      // the row's mercator bounds back to latitude for sampling.
      const mTop = 1 - (2 * ty) / n;
      const mBot = 1 - (2 * (ty + 1)) / n;
      const latMax = invMercatorLat(mTop);
      const latMin = invMercatorLat(mBot);
      for (let tx = 0; tx < n; tx++) {
        const lonMin = -180 + tx * tileLon;
        const lonMax = lonMin + tileLon;
        const { vertices, faces, coast, wire, bbox } = bakeFlatTile(sampler, { lonMin, lonMax, latMin, latMax, cols: GRID, rows: GRID }, proj);
        const out = path.join(zDir, `${tx}_${ty}.json`);
        await fs.writeFile(out, JSON.stringify({ vertices, faces, coast, wire }));
        tileBoxes[`${z}/${tx}_${ty}`] = {
          x0: trunc(bbox.x0), x1: trunc(bbox.x1), y0: trunc(bbox.y0), y1: trunc(bbox.y1),
        };
        const stat = await fs.stat(out);
        tileCount++; totalKB += stat.size / 1024;
      }
    }
    console.log(`z=${z}: ${n}×${n} = ${n * n} tiles @ GRID ${GRID}`);
  }
  console.log(`Total ${tileCount} tiles, ${(totalKB / 1024).toFixed(1)} MB`);

  const manifest = {
    plane: { halfX: planeHalfX, halfY: planeHalfY },
    exagg: EXAGG,
    zooms: zooms.map(({ z, n }) => ({ z, cols: n, rows: n })),
    tileBoxes,
  };
  await fs.writeFile(path.join(ROOT, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(`Wrote ${path.join(ROOT, "manifest.json")} — Web Mercator, square plane ±1`);
}

async function main() {
  const tilesMode = process.argv.includes("--tiles");
  const landingMode = process.argv.includes("--landing");
  const flatMapMode = process.argv.includes("--flatmap");
  const sampler = await loadSampler();

  if (flatMapMode) {
    await bakeFlatMap(sampler);
    return;
  }

  if (landingMode) {
    // Landing-page Earth: fixed-zoom, decorative. 120x60 grid (~7200 quads)
    // + shared-vertex index format + per-color palette + 4-sig-fig
    // precision keeps gzip around ~75 KB.
    const OUT = path.join(REPO, "website/public/data/landing-earth.json");
    const polys = bakeTile(sampler, {
      lonMin: -180, lonMax: 180, latMin: -90, latMax: 90,
      cols: 120, rows: 60,
    });
    await fs.mkdir(path.dirname(OUT), { recursive: true });
    await fs.writeFile(OUT, serializePolygonsIndexedLanding(polys));
    const stat = await fs.stat(OUT);
    console.log(`Wrote ${OUT} — ${(stat.size / 1024).toFixed(1)} KB, ${polys.length} polygons`);
    return;
  }

  if (!tilesMode) {
    // Legacy single-file output for the simple /map demo.
    const OUT = path.join(REPO, "website/public/data/earth.json");
    const polys = bakeTile(sampler, { lonMin: -180, lonMax: 180, latMin: -90, latMax: 90, cols: 180, rows: 90 });
    await fs.mkdir(path.dirname(OUT), { recursive: true });
    await fs.writeFile(OUT, serializePolygons(polys));
    const stat = await fs.stat(OUT);
    console.log(`Wrote ${OUT} — ${(stat.size / 1024).toFixed(1)} KB, ${polys.length} polygons`);
    return;
  }

  // Tile pyramid. Each tile's grid is the same (COLS×ROWS) so emitted tiles
  // at higher zoom have proportionally finer ETOPO sampling per cell.
  const COLS_PER_TILE = 180;
  const ROWS_PER_TILE = 90;
  const TILES_ROOT = path.join(REPO, "website/public/data/tiles");
  await fs.mkdir(TILES_ROOT, { recursive: true });

  // Zoom level Z covers the world with 2^Z columns × max(1, 2^(Z-1)) rows of
  // tiles. We special-case zoom 0 as a single tile spanning the whole world.
  const zooms = [
    { z: 0, cols: 1, rows: 1 },
    { z: 1, cols: 2, rows: 2 },
    { z: 2, cols: 4, rows: 4 },
    { z: 3, cols: 8, rows: 8 },
  ];

  for (const { z, cols, rows } of zooms) {
    const zDir = path.join(TILES_ROOT, String(z));
    await fs.mkdir(zDir, { recursive: true });
    const tileLonSpan = 360 / cols;
    const tileLatSpan = 180 / rows;
    for (let ty = 0; ty < rows; ty++) {
      for (let tx = 0; tx < cols; tx++) {
        const lonMin = -180 + tx * tileLonSpan;
        const lonMax = lonMin + tileLonSpan;
        // ty=0 is the northernmost tile (lat=+90..+90-span); reads top-down.
        const latMax = 90 - ty * tileLatSpan;
        const latMin = latMax - tileLatSpan;
        const polys = bakeTile(sampler, {
          lonMin, lonMax, latMin, latMax,
          cols: COLS_PER_TILE, rows: ROWS_PER_TILE,
        });
        const out = path.join(zDir, `${tx}_${ty}.json`);
        await fs.writeFile(out, serializePolygons(polys));
        const stat = await fs.stat(out);
        console.log(`z=${z} tile (${tx},${ty}) lon[${lonMin},${lonMax}] lat[${latMin},${latMax}] — ${(stat.size / 1024).toFixed(1)} KB, ${polys.length} polys`);
      }
    }
  }

  // Manifest for the client: how many tiles per zoom level + tile bbox math.
  const manifest = {
    zooms: zooms.map((z) => ({
      z: z.z, cols: z.cols, rows: z.rows,
      tileLonSpan: 360 / z.cols, tileLatSpan: 180 / z.rows,
    })),
    heightExagg: HEIGHT_EXAGG,
    earthRadiusM: EARTH_RADIUS_M,
  };
  const manifestPath = path.join(TILES_ROOT, "manifest.json");
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`Wrote ${manifestPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
