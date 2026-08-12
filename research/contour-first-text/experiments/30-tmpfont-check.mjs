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

function degreeHist(polys, label) {
  const key = (v) => `${v[0]},${v[1]},${v[2]}`;
  const edgeMap = new Map();
  const addEdge = (a, b) => {
    const ka = key(a), kb = key(b);
    if (ka === kb) return;
    const canon = ka < kb;
    const k = canon ? `${ka}|${kb}` : `${kb}|${ka}`;
    let e = edgeMap.get(k);
    if (!e) { e = { a: canon?a:b, b: canon?b:a, count:0 }; edgeMap.set(k, e); }
    e.count++;
  };
  for (const poly of polys) {
    const v = poly.vertices;
    for (let f = 1; f < v.length - 1; f++) { addEdge(v[0], v[f]); addEdge(v[f], v[f+1]); addEdge(v[f+1], v[0]); }
  }
  const hist = {};
  for (const e of edgeMap.values()) hist[e.count] = (hist[e.count]??0)+1;
  console.log(label, hist, "total", edgeMap.size);
  return edgeMap;
}
degreeHist(raw, "raw (NO recenter, tmp font):");
const centered = recenterPolygons(raw);
const em = degreeHist(centered, "recentered (tmp font):");

// For the recentered (matches exp24) mesh, find closest OTHER unique vertex to
// each degree-1 endpoint using a FULL scan, not excluding by key text but by
// actual value equality, to find the true nearest match irrespective of exact key.
const uniqueVerts = new Map();
const key = (v) => `${v[0]},${v[1]},${v[2]}`;
for (const e of em.values()) { uniqueVerts.set(key(e.a), e.a); uniqueVerts.set(key(e.b), e.b); }
const uvEntries = [...uniqueVerts.entries()];
function nearest(v, selfKey) {
  let best = Infinity, bestV = null;
  for (const [k, w] of uvEntries) {
    if (k === selfKey) continue;
    const d = Math.hypot(v[0]-w[0], v[1]-w[1], v[2]-w[2]);
    if (d < best) { best = d; bestV = w; }
  }
  return [best, bestV];
}
const degree1 = [...em.values()].filter(e => e.count === 1);
console.log("degree1 count", degree1.length);
const sample = degree1.slice(0, 5);
for (const e of sample) {
  for (const endpoint of [e.a, e.b]) {
    const k = key(endpoint);
    const [d, w] = nearest(endpoint, k);
    console.log("endpoint", endpoint, "nearest-other", w, "dist", d);
  }
}
