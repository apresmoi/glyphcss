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

// Build triangle list exactly like rasterizeInk (fan triangulation).
const tris = [];
for (const poly of base) {
  const v = poly.vertices;
  for (let f = 1; f < v.length - 1; f++) tris.push({ v0: v[0], v1: v[f], v2: v[f + 1] });
}

const EPS_REL = 1e-7;
function computeQuantum(tris) {
  let minX=Infinity,minY=Infinity,minZ=Infinity,maxX=-Infinity,maxY=-Infinity,maxZ=-Infinity;
  for (const t of tris) for (const v of [t.v0,t.v1,t.v2]) {
    if (v[0]<minX) minX=v[0]; if (v[0]>maxX) maxX=v[0];
    if (v[1]<minY) minY=v[1]; if (v[1]>maxY) maxY=v[1];
    if (v[2]<minZ) minZ=v[2]; if (v[2]>maxZ) maxZ=v[2];
  }
  const diag = Math.hypot(maxX-minX, maxY-minY, maxZ-minZ);
  return diag > 0 ? diag * EPS_REL : 1e-9;
}
function makeKey(q) {
  const inv = 1/q;
  return (v) => `${Math.round(v[0]*inv)},${Math.round(v[1]*inv)},${Math.round(v[2]*inv)}`;
}

function degreeHist(keyFn) {
  const edgeMap = new Map();
  const add = (a,b) => {
    const ka=keyFn(a), kb=keyFn(b);
    if (ka===kb) return;
    const canon = ka<kb;
    const k = canon? `${ka}|${kb}` : `${kb}|${ka}`;
    edgeMap.set(k, (edgeMap.get(k)||0)+1);
  };
  for (const t of tris) { add(t.v0,t.v1); add(t.v1,t.v2); add(t.v2,t.v0); }
  const h = {};
  for (const c of edgeMap.values()) h[c]=(h[c]??0)+1;
  return h;
}

const exactKey = (v) => `${v[0]},${v[1]},${v[2]}`;
console.log("BEFORE (exact key):", JSON.stringify(degreeHist(exactKey)));

const quantum = computeQuantum(tris);
console.log("quantum:", quantum, "(diag * 1e-7)");
const tolKey = makeKey(quantum);
console.log("AFTER (tolerant key, real quantum):", JSON.stringify(degreeHist(tolKey)));

// Also show what quantum WOULD be needed to merge the 56 phantom edges, for
// comparison against the safe margin.
for (const relEps of [1e-7, 1e-5, 1e-3, 1e-2, 2e-2]) {
  const q = computeQuantum(tris) / EPS_REL * relEps;
  console.log(`relEps=${relEps} -> `, JSON.stringify(degreeHist(makeKey(q))));
}
