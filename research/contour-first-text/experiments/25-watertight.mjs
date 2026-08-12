// Is the extruded text mesh watertight? A closed solid must have every edge
// shared by exactly 2 triangles. Degree-1 edges = holes in the mesh.
import { readFileSync } from "node:fs";
import { parseFont, composeText } from "../../../packages/fonts/dist/index.js";
const font = parseFont(readFileSync("../../../packages/fonts/test/fixtures/Roboto-Bold.ttf").buffer);
const key = (v) => v.map((n) => n.toFixed(4)).join(",");
for (const [label, profile] of [["flat", "flat"], ["bevel", { edge: "bevel", raised: false, segments: 3 }]]) {
  for (const ch of ["h", "p", "y", "o"]) {
    const polys = composeText(font, ch, { size: 100, depth: 80, profile, letterSpacing: 0, lineHeight: 1.15,
      align: "center", curveSteps: 4, simplify: 2,
      faces: { front: { color: "#fff" }, sides: { color: "#888" }, back: { color: "#444" } } });
    const deg = new Map();
    for (const q of polys) {           // fan-triangulate exactly like rasterizeInk
      const v = q.vertices;
      for (let i = 1; i + 1 < v.length; i++) {
        for (const [a, b] of [[v[0], v[i]], [v[i], v[i + 1]], [v[i + 1], v[0]]]) {
          const ka = key(a), kb = key(b), k = ka < kb ? ka + "|" + kb : kb + "|" + ka;
          deg.set(k, (deg.get(k) ?? 0) + 1);
        }
      }
    }
    const h = {};
    for (const d of deg.values()) h[d] = (h[d] ?? 0) + 1;
    const d1 = h[1] ?? 0;
    console.log(`${label.padEnd(6)} '${ch}'  polys ${String(polys.length).padStart(3)}  edges ${String(deg.size).padStart(4)}  degrees ${JSON.stringify(h)}  ${d1 ? "NOT watertight" : "watertight"}`);
  }
}
