/*
 * bake_region.mjs — bake a high-detail globe tile for a lat/lon window straight
 * from raw ETOPO1 (1 arc-minute), emitting device-ready MSH1 (mesh) + LIN1 (coast).
 * Reuses the NetCDF sampler approach from website/scripts/bake-globe.mjs.
 *
 * Usage: node --max-old-space-size=4096 bake_region.mjs \
 *          <lonMin> <lonMax> <latMin> <latMax> <cols> <rows> <out.msh> <out.lin>
 */
import { promises as fs } from "node:fs";
import zlib from "node:zlib";
import { writeFileSync } from "node:fs";

const SRC = "/Users/apresmoi/glyphcss/etopo/ETOPO1_Ice_g_gmt4.grd.gz";
const HEIGHT_EXAGG = 30, EARTH_RADIUS_M = 6_371_000;

// ── NetCDF-3 header parse + sampler (condensed from bake-globe.mjs) ──────────
const NC_DIMENSION = 10, NC_VARIABLE = 11, NC_ATTRIBUTE = 12;
const NC_TYPE = { 1: "byte", 2: "char", 3: "short", 4: "int", 5: "float", 6: "double" };
const NC_TYPE_SIZE = { byte: 1, char: 1, short: 2, int: 4, float: 4, double: 8 };
function parseNcHeader(buf) {
  let p = 0;
  if (buf.toString("ascii", 0, 3) !== "CDF") throw new Error("not NetCDF");
  const version = buf[3]; p = 4;
  const rI = () => { const v = buf.readInt32BE(p); p += 4; return v; };
  const rS = () => { const len = rI(); const s = buf.toString("utf8", p, p + len); p += len; p = (p + 3) & ~3; return s; };
  const rAttrs = () => {
    const tag = rI(), n = rI(); if (tag === 0 && n === 0) return [];
    if (tag !== NC_ATTRIBUTE) throw new Error("bad attr");
    const a = [];
    for (let i = 0; i < n; i++) { const name = rS(); const type = NC_TYPE[rI()]; const len = rI();
      if (type === "char") p += len; else p += len * NC_TYPE_SIZE[type]; p = (p + 3) & ~3; a.push({ name, type }); }
    return a;
  };
  rI(); const dimTag = rI(), dimN = rI(); const dims = [];
  if (dimTag === NC_DIMENSION) for (let i = 0; i < dimN; i++) dims.push({ name: rS(), size: rI() });
  rAttrs();
  const varTag = rI(), varN = rI(); const vars = [];
  if (varTag === NC_VARIABLE) for (let i = 0; i < varN; i++) {
    const name = rS(); const ndims = rI(); for (let k = 0; k < ndims; k++) rI(); rAttrs();
    const type = NC_TYPE[rI()]; rI(); const begin = version === 1 ? rI() : Number(buf.readBigInt64BE(p)); if (version === 2) p += 8;
    vars.push({ name, type, begin });
  }
  return { dims, vars };
}
function makeSampler(buf, h) {
  const z = h.vars.find(v => v.name === "z");
  const lonDim = h.dims.find(d => /lon|x/i.test(d.name)), latDim = h.dims.find(d => /lat|y/i.test(d.name));
  const NX = lonDim.size, NY = latDim.size;
  const xVar = h.vars.find(v => /lon|^x$/i.test(v.name)), yVar = h.vars.find(v => /lat|^y$/i.test(v.name));
  const axis = (v, n) => { const sz = NC_TYPE_SIZE[v.type];
    const f = v.type === "double" ? buf.readDoubleBE(v.begin) : buf.readFloatBE(v.begin);
    const l = v.type === "double" ? buf.readDoubleBE(v.begin + sz*(n-1)) : buf.readFloatBE(v.begin + sz*(n-1)); return [f, l]; };
  let [LON_MIN, LON_MAX] = axis(xVar, NX); let [LAT_MIN, LAT_MAX] = axis(yVar, NY);
  if (LAT_MIN > LAT_MAX) { const t = LAT_MIN; LAT_MIN = LAT_MAX; LAT_MAX = t; }
  const cell = (col, row) => buf.readInt32BE(z.begin + (row*NX + col)*4);
  return {
    elevAt(lat, lon) {
      const col = Math.min(NX-1, Math.max(0, Math.round(((lon-LON_MIN)/(LON_MAX-LON_MIN))*(NX-1))));
      const row = Math.min(NY-1, Math.max(0, Math.round(((lat-LAT_MIN)/(LAT_MAX-LAT_MIN))*(NY-1))));
      return cell(col, row);
    }
  };
}
function latLonToXYZ(lat, lon, r) {
  const la = lat*Math.PI/180, lo = lon*Math.PI/180, c = Math.cos(la);
  return [r*c*Math.cos(lo), -r*c*Math.sin(lo), r*Math.sin(la)];
}
function elevToColor(e) {
  if (e < -4000) return [0x0a,0x1a,0x40]; if (e < -1000) return [0x16,0x30,0x70]; if (e < 0) return [0x2a,0x55,0xa8];
  if (e < 300) return [0x3a,0x6b,0x30]; if (e < 1200) return [0x5a,0x7a,0x30]; if (e < 2500) return [0x8a,0x70,0x50];
  if (e < 4000) return [0xa8,0x90,0x70]; return [0xe0,0xe0,0xe0];
}

const [,, lonMinS, lonMaxS, latMinS, latMaxS, colsS, rowsS, outMsh, outLin] = process.argv;
const lonMin=+lonMinS, lonMax=+lonMaxS, latMin=+latMinS, latMax=+latMaxS, cols=+colsS, rows=+rowsS;

console.error("decompressing ETOPO1…");
const buf = zlib.gunzipSync(await fs.readFile(SRC));
const sampler = makeSampler(buf, parseNcHeader(buf));
console.error(`sampling region lon[${lonMin},${lonMax}] lat[${latMin},${latMax}] at ${cols}x${rows}`);

const grid = [];
for (let j = 0; j <= rows; j++) {
  const row = []; const lat = latMax - (latMax-latMin)*j/rows;
  for (let i = 0; i <= cols; i++) {
    const lon = lonMin + (lonMax-lonMin)*i/cols;
    const elev = sampler.elevAt(lat, lon);
    row.push({ xyz: latLonToXYZ(lat, lon, 1 + elev/EARTH_RADIUS_M*HEIGHT_EXAGG), elev });
  }
  grid.push(row);
}

// MSH1 quads
const quads = [];
for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
  const a = grid[j][i], d = grid[j+1][i], c = grid[j+1][i+1], b = grid[j][i+1];
  const e = (a.elev+b.elev+c.elev+d.elev)/4;
  quads.push({ v: [a.xyz, d.xyz, c.xyz, b.xyz], col: elevToColor(e) });
}
let mb = 6; for (const q of quads) mb += 1 + 4*12 + 3;
const msh = Buffer.alloc(mb); let o = 0;
msh.write("MSH1", o, "ascii"); o += 4; msh.writeUInt16LE(quads.length, o); o += 2;
for (const q of quads) { msh.writeUInt8(4, o++); for (const v of q.v) { msh.writeFloatLE(v[0],o); msh.writeFloatLE(v[1],o+4); msh.writeFloatLE(v[2],o+8); o+=12; } msh.writeUInt8(q.col[0],o++); msh.writeUInt8(q.col[1],o++); msh.writeUInt8(q.col[2],o++); }
writeFileSync(outMsh, msh);

// LIN1 coastline (water/land boundary), pushed slightly off-surface
const segs = []; const S = 1.004;
const pushSeg = (p, q) => segs.push(p[0]*S,p[1]*S,p[2]*S, q[0]*S,q[1]*S,q[2]*S);
for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
  const w = grid[j][i].elev < 0;
  if (i+1 < cols && (grid[j][i+1].elev < 0) !== w) pushSeg(grid[j][i+1].xyz, grid[j+1][i+1].xyz);
  if (j+1 < rows && (grid[j+1][i].elev < 0) !== w) pushSeg(grid[j+1][i].xyz, grid[j+1][i+1].xyz);
}
const ns = segs.length/6; const lin = Buffer.alloc(10 + ns*6*4);
lin.write("LIN1",0,"ascii"); lin.writeUInt16LE(ns,4); lin[6]=0xff;lin[7]=0xff;lin[8]=0xff;lin[9]=0x23;
for (let k=0;k<segs.length;k++) lin.writeFloatLE(segs[k],10+k*4);
writeFileSync(outLin, lin);

console.error(`region: ${quads.length} quads → ${outMsh} (${msh.length}B); ${ns} coast segs → ${outLin} (${lin.length}B)`);
