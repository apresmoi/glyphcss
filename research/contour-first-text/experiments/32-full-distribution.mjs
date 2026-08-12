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
  if (!e) { e = { a: canon?a:b, b: canon?b:a, count:0 }; edgeMap.set(k, e); }
  e.count++;
};
for (const poly of base) {
  const v = poly.vertices;
  for (let f = 1; f < v.length - 1; f++) { addEdge(v[0], v[f]); addEdge(v[f], v[f+1]); addEdge(v[f+1], v[0]); }
}
const uniqueVerts = new Map();
for (const e of edgeMap.values()) { uniqueVerts.set(key(e.a), e.a); uniqueVerts.set(key(e.b), e.b); }
const uvEntries = [...uniqueVerts.entries()];
function nearest(v, selfKey) {
  let best = Infinity;
  for (const [k, w] of uvEntries) {
    if (k === selfKey) continue;
    const d = Math.hypot(v[0]-w[0], v[1]-w[1], v[2]-w[2]);
    if (d < best) best = d;
  }
  return best;
}
const degree1 = [...edgeMap.values()].filter(e => e.count === 1);
const allDists = [];
for (const e of degree1) for (const endpoint of [e.a, e.b]) {
  allDists.push(nearest(endpoint, key(endpoint)));
}
allDists.sort((a,b)=>a-b);
console.log("all", allDists.length, "distances:");
console.log(allDists.map(d=>d.toFixed(4)).join(", "));
