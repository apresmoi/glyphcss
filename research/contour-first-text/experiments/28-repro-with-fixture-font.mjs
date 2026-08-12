import { readFileSync } from "node:fs";
import { parseFont, composeText } from "../../../packages/fonts/dist/index.js";

const font = parseFont(readFileSync("../../../packages/fonts/test/fixtures/Roboto-Bold.ttf").buffer);

const polys = composeText(font, "h", {
  size: 100, depth: 80, profile: { edge: "bevel", raised: false, segments: 3 },
  letterSpacing: 0, lineHeight: 1.15, align: "center",
  curveSteps: 4, simplify: 2,
  faces: { front: { color: "#fff" }, sides: { color: "#888" }, back: { color: "#444" } },
});

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
for (const poly of polys) {
  const v = poly.vertices;
  for (let f = 1; f < v.length - 1; f++) {
    addEdge(v[0], v[f]); addEdge(v[f], v[f+1]); addEdge(v[f+1], v[0]);
  }
}
const hist = {};
for (const e of edgeMap.values()) hist[e.count] = (hist[e.count]??0)+1;
console.log("exact-key degree histogram:", hist, "total edges", edgeMap.size);

const uniqueVerts = new Map();
for (const e of edgeMap.values()) { uniqueVerts.set(key(e.a), e.a); uniqueVerts.set(key(e.b), e.b); }
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
const dists = [];
for (const e of degree1) for (const endpoint of [e.a, e.b]) {
  const k = key(endpoint);
  const [d] = nearestExcludingSelfKey(endpoint, k);
  dists.push(d);
}
dists.sort((a,b)=>a-b);
console.log("degree-1 count:", degree1.length, "nearest-other-vertex dist: min", dists[0], "p50", dists[Math.floor(dists.length/2)], "max", dists[dists.length-1]);
