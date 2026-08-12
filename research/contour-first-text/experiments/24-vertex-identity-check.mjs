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

// Build a raw (no rotation) exact-key adjacency map to get TRUE topological
// degree of every edge, then compare distribution to what we saw AFTER
// rotation to see whether adjacency itself is rotation-fragile.
const key = (v) => `${v[0]},${v[1]},${v[2]}`;
const edgeMap = new Map();
const addEdge = (a, b) => {
  const ka = key(a), kb = key(b);
  if (ka === kb) return;
  const canon = ka < kb;
  const k = canon ? `${ka}|${kb}` : `${kb}|${ka}`;
  edgeMap.set(k, (edgeMap.get(k) || 0) + 1);
};
for (const poly of base) {
  const verts = poly.vertices;
  for (let f = 1; f < verts.length - 1; f++) {
    addEdge(verts[0], verts[f]);
    addEdge(verts[f], verts[f + 1]);
    addEdge(verts[f + 1], verts[0]);
  }
}
const degreeHist = {};
for (const d of edgeMap.values()) degreeHist[d] = (degreeHist[d] || 0) + 1;
console.log("UNROTATED exact-key degree histogram (all edges, whole h mesh):", degreeHist);
console.log("total unique edges:", edgeMap.size);

function rotateVec3(v, rxDeg, ryDeg, rzDeg) {
  const dx=(rxDeg*Math.PI)/180, dy=(ryDeg*Math.PI)/180, dz=(rzDeg*Math.PI)/180;
  let [x,y,z]=v;
  if (dz!==0){const c=Math.cos(dz),s=Math.sin(dz);[x,y]=[x*c-y*s,x*s+y*c];}
  if (dy!==0){const c=Math.cos(dy),s=Math.sin(dy);[x,z]=[x*c+z*s,-x*s+z*c];}
  if (dx!==0){const c=Math.cos(dx),s=Math.sin(dx);[y,z]=[y*c-z*s,y*s+z*c];}
  return [x,y,z];
}

for (const [label, turn, tilt] of [["worst",47.7,27.9],["best",-4.7,-4.4]]) {
  const em = new Map();
  const add = (a,b) => {
    const ka=key(a), kb=key(b);
    if (ka===kb) return;
    const canon = ka<kb;
    const k = canon ? `${ka}|${kb}` : `${kb}|${ka}`;
    em.set(k, (em.get(k)||0)+1);
  };
  for (const poly of base) {
    const rv = poly.vertices.map(v => rotateVec3(v, turn, tilt, 0));
    for (let f = 1; f < rv.length - 1; f++) {
      add(rv[0], rv[f]); add(rv[f], rv[f+1]); add(rv[f+1], rv[0]);
    }
  }
  const hist = {};
  for (const d of em.values()) hist[d] = (hist[d]||0)+1;
  console.log(`ROTATED [${label}] degree histogram:`, hist, "total edges:", em.size);
}
