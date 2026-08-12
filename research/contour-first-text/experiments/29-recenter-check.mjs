import { readFileSync } from "node:fs";
import { parseFont, composeText } from "../../../packages/fonts/dist/index.js";
import { recenterPolygons } from "../../../packages/core/dist/index.js";

const font = parseFont(readFileSync("../../../packages/fonts/test/fixtures/Roboto-Bold.ttf").buffer);

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
    edgeMap.set(k, (edgeMap.get(k)||0)+1);
  };
  for (const poly of polys) {
    const v = poly.vertices;
    for (let f = 1; f < v.length - 1; f++) { addEdge(v[0], v[f]); addEdge(v[f], v[f+1]); addEdge(v[f+1], v[0]); }
  }
  const hist = {};
  for (const c of edgeMap.values()) hist[c] = (hist[c]??0)+1;
  console.log(label, hist, "total", edgeMap.size);
}
degreeHist(raw, "raw (no recenter):");
const centered = recenterPolygons(raw);
degreeHist(centered, "recentered:");
