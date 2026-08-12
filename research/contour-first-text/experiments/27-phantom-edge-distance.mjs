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

const key = (v) => `${v[0]},${v[1]},${v[2]}`;
const edgeMap = new Map();
const addEdge = (a, b) => {
  const ka = key(a), kb = key(b);
  if (ka === kb) return;
  const canon = ka < kb;
  const k = canon ? `${ka}|${kb}` : `${kb}|${ka}`;
  let e = edgeMap.get(k);
  if (!e) { e = { a: canon?a:b, b: canon?b:a, count: 0 }; edgeMap.set(k, e); }
  e.count++;
};
for (const poly of base) {
  const v = poly.vertices;
  for (let f = 1; f < v.length - 1; f++) {
    addEdge(v[0], v[f]); addEdge(v[f], v[f+1]); addEdge(v[f+1], v[0]);
  }
}

const uniqueVerts = new Map();
for (const e of edgeMap.values()) {
  uniqueVerts.set(key(e.a), e.a);
  uniqueVerts.set(key(e.b), e.b);
}
const uvEntries = [...uniqueVerts.entries()];

function nearestExcludingSelfKey(v, selfKey) {
  let best = Infinity, bestV = null;
  for (const [k, w] of uvEntries) {
    if (k === selfKey) continue;
    const d = Math.hypot(v[0]-w[0], v[1]-w[1], v[2]-w[2]);
    if (d < best) { best = d; bestV = w; }
  }
  return [best, bestV];
}

const degree1 = [...edgeMap.values()].filter(e => e.count === 1);
console.log("degree-1 edges:", degree1.length, "/ total", edgeMap.size);

const dists = [];
const detail = [];
for (const e of degree1) {
  for (const endpoint of [e.a, e.b]) {
    const k = key(endpoint);
    const [d, w] = nearestExcludingSelfKey(endpoint, k);
    dists.push(d);
    detail.push({ endpoint, nearest: w, d });
  }
}
dists.sort((a,b)=>a-b);
console.log("nearest-DIFFERENT-key-vertex distance for degree-1 endpoints:");
console.log("min", dists[0], "p10", dists[Math.floor(dists.length*0.1)], "p50", dists[Math.floor(dists.length*0.5)], "p90", dists[Math.floor(dists.length*0.9)], "max", dists[dists.length-1]);
console.log("smallest 15 with detail:");
detail.sort((a,b)=>a.d-b.d);
for (const d of detail.slice(0,15)) {
  console.log(d.d, d.endpoint, "~", d.nearest);
}
