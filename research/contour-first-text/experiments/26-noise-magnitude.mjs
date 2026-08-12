import { readFileSync } from "node:fs";
import { parseFont, composeText } from "../../../packages/fonts/dist/index.js";
import { recenterPolygons } from "../../../packages/core/dist/index.js";

const fontBuf = readFileSync("/tmp/roboto700.ttf");
const font = parseFont(fontBuf.buffer.slice(fontBuf.byteOffset, fontBuf.byteOffset + fontBuf.byteLength));

const raw = composeText(font, "h", {
  size: 100, depth: 80, profile: { edge: "bevel", raised: false, segments: 3 },
  letterSpacing: 0, lineHeight: 1.15, align: "center", underline: false, strike: false,
  curveSteps: 4, simplify: 2, warp: { shape: "none", amount: 0.5 },
  faces: { front: { color: "#d4a82a" }, sides: { color: "#7c5e16" }, back: { color: "#7c5e16" } },
});
const base = recenterPolygons(raw);

const allVerts = [];
for (const poly of base) for (const v of poly.vertices) allVerts.push(v);

// bbox / diagonal
let min = [Infinity,Infinity,Infinity], max = [-Infinity,-Infinity,-Infinity];
for (const v of allVerts) for (let i=0;i<3;i++){ if(v[i]<min[i]) min[i]=v[i]; if(v[i]>max[i]) max[i]=v[i]; }
const diag = Math.hypot(max[0]-min[0], max[1]-min[1], max[2]-min[2]);
console.log("bbox min", min, "max", max, "diagonal", diag);

// exact-key groups
const groups = new Map();
for (const v of allVerts) {
  const k = `${v[0]},${v[1]},${v[2]}`;
  let g = groups.get(k);
  if (!g) { g = []; groups.set(k, []); groups.set(k, g); }
  g.push(v);
}
console.log("unique exact-key vertex groups:", groups.size, "/ total verts", allVerts.length);

// Now find "near duplicate" pairs: sort by rounded-to-6-decimals key and cluster,
// measure max distance within a near-cluster (candidate coincident but noisy).
const round6 = (v) => v.map(n => n.toFixed(6)).join(",");
const nearGroups = new Map();
for (const v of allVerts) {
  const k = round6(v);
  let g = nearGroups.get(k);
  if (!g) { g = []; nearGroups.set(k, g); }
  g.push(v);
}
let maxNoiseDist = 0;
let noisyGroupCount = 0;
for (const g of nearGroups.values()) {
  if (g.length < 2) continue;
  // check if this group actually contains >1 EXACT sub-key (i.e. real noise, not true dupes)
  const exactKeys = new Set(g.map(v => `${v[0]},${v[1]},${v[2]}`));
  if (exactKeys.size < 2) continue;
  noisyGroupCount++;
  for (let i=0;i<g.length;i++) for (let j=i+1;j<g.length;j++) {
    const d = Math.hypot(g[i][0]-g[j][0], g[i][1]-g[j][1], g[i][2]-g[j][2]);
    if (d > maxNoiseDist) maxNoiseDist = d;
  }
}
console.log("near(1e-6)-groups with real float noise (>1 exact key):", noisyGroupCount);
console.log("max distance within such a noisy group (worst-case noise magnitude):", maxNoiseDist, "relative to diagonal:", maxNoiseDist/diag);

// Now: closest distance between vertices that are NOT the same corner (genuinely distinct),
// i.e. minimum nonzero distance among ALL distinct exact-key vertices, excluding near-noise pairs.
// Approximate via grid bucketing for speed.
const cellSize = diag / 200; // coarse bucket
const grid = new Map();
const gk = (v) => `${Math.floor(v[0]/cellSize)},${Math.floor(v[1]/cellSize)},${Math.floor(v[2]/cellSize)}`;
const uniqueVerts = [...groups.keys()].map(k => k.split(",").map(Number));
for (const v of uniqueVerts) {
  const k = gk(v);
  let arr = grid.get(k);
  if (!arr) { arr = []; grid.set(k, arr); }
  arr.push(v);
}
let minDist = Infinity;
for (const [k, arr] of grid) {
  const [cx,cy,cz] = k.split(",").map(Number);
  const neighborsCells = [];
  for (let dx=-1;dx<=1;dx++) for (let dy=-1;dy<=1;dy++) for (let dz=-1;dz<=1;dz++) {
    const nk = `${cx+dx},${cy+dy},${cz+dz}`;
    const n = grid.get(nk);
    if (n) neighborsCells.push(n);
  }
  for (const v of arr) {
    for (const cell of neighborsCells) {
      for (const w of cell) {
        if (v === w) continue;
        const d = Math.hypot(v[0]-w[0], v[1]-w[1], v[2]-w[2]);
        if (d > 1e-9 && d < minDist) minDist = d;
      }
    }
  }
}
console.log("closest distance between genuinely distinct unique-key vertices:", minDist, "relative to diagonal:", minDist/diag);
