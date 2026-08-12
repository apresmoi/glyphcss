// Convex-mesh regression table for the identity-exemption ink HLR fix
// (buildInkOcclusionMap in packages/glyphcss/src/render/rasterize.ts).
// Same convex cases as 09-ink-full-sweep.mjs's baseline row, run against
// hiddenLines: "hide" with NO bias/slope params (none exist anymore).
import {
  createGlyphOrthographicCamera,
  buildRasterizeContext,
  rasterize,
} from "../../../packages/glyphcss/dist/index.js";
import { cubePolygons, icosahedronPolygons, spherePolygons } from "../../../packages/core/dist/index.js";

function countInked(txt) {
  return [...txt].filter((c) => c !== " " && c !== "\n").length;
}
function render(polys, camera, cols, rows, hiddenLines) {
  const ctx = buildRasterizeContext({
    camera, grid: { cols, rows, cellAspect: 2 }, polygons: polys, mode: "ink", useColors: false,
    ...(hiddenLines ? { hiddenLines } : {}),
  });
  return rasterize(ctx);
}

const cases = [
  ["cube", cubePolygons({ center: [0, 0, 0], size: 4, color: "#fff" }), createGlyphOrthographicCamera({ rotX: 30, rotY: 35, zoom: 150 }), 60, 30],
  ["icosahedron", icosahedronPolygons({ center: [0, 0, 0], size: 3 }), createGlyphOrthographicCamera({ rotX: 20, rotY: 25, zoom: 150 }), 60, 30],
  ["sphere subdiv2", spherePolygons({ center: [0, 0, 0], size: 3, subdivisions: 2 }), createGlyphOrthographicCamera({ rotX: 20, rotY: 25, zoom: 150 }), 60, 30],
  ["sphere subdiv3", spherePolygons({ center: [0, 0, 0], size: 3, subdivisions: 3 }), createGlyphOrthographicCamera({ rotX: 20, rotY: 25, zoom: 150 }), 60, 30],
];

console.log("shape | show | hide | delta | delta%");
console.log("---|---|---|---|---");
for (const [label, polys, cam, cols, rows] of cases) {
  const show = countInked(render(polys, cam, cols, rows, "show"));
  const hide = countInked(render(polys, cam, cols, rows, "hide"));
  const delta = hide - show;
  const pct = ((delta / show) * 100).toFixed(1);
  console.log(`${label} | ${show} | ${hide} | ${delta} | ${pct}%`);
}
