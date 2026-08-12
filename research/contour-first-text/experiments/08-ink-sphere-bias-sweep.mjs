// Diagnostic-only sweep (uses temporary __inkHiddenLineBias/__inkHiddenLineSlopeScale
// overrides added to rasterize.ts just for this run, reverted after) to check
// whether the sphere regression seen with the shipped bias 0.03/slope 0.5 is a
// tuning problem or structural. Not part of the shipped feature.
import {
  createGlyphOrthographicCamera,
  buildRasterizeContext,
  rasterize,
} from "../../../packages/glyphcss/dist/index.js";
import { spherePolygons, icosahedronPolygons, cubePolygons } from "../../../packages/core/dist/index.js";

function countInked(txt) {
  return [...txt].filter((c) => c !== " " && c !== "\n").length;
}
function render(polys, camera, cols, rows, extra) {
  const ctx = buildRasterizeContext({
    camera, grid: { cols, rows, cellAspect: 2 }, polygons: polys, mode: "ink", useColors: false,
  });
  return rasterize({ ...ctx, ...extra });
}

const camSphere = createGlyphOrthographicCamera({ rotX: 20, rotY: 25, zoom: 150 });
const sphere = spherePolygons({ center: [0, 0, 0], size: 3, subdivisions: 2 });
const show = countInked(render(sphere, camSphere, 60, 30, {}));
console.log(`Sphere ground truth (show): ${show}`);
for (const bias of [0.005, 0.015, 0.03, 0.06, 0.1, 0.2, 0.4, 0.8, 1.5]) {
  for (const slope of [0, 0.5, 1.0, 1.5, 2.5, 4.0]) {
    const inked = countInked(render(sphere, camSphere, 60, 30, { hiddenLines: "hide", __inkHiddenLineBias: bias, __inkHiddenLineSlopeScale: slope }));
    const delta = inked - show;
    const flag = delta < -show * 0.03 ? "  <-- REGRESSION" : "";
    console.log(`bias ${bias.toFixed(3)} slope ${slope.toFixed(1)}: inked ${inked} (delta ${delta >= 0 ? "+" : ""}${delta})${flag}`);
  }
}

console.log("\nCube / Icosahedron at shipped 0.03/0.5 for reference:");
const camCube = createGlyphOrthographicCamera({ rotX: 30, rotY: 35, zoom: 150 });
const cube = cubePolygons({ center: [0, 0, 0], size: 4, color: "#fff" });
console.log(`Cube show ${countInked(render(cube, camCube, 60, 30, {}))} hide ${countInked(render(cube, camCube, 60, 30, { hiddenLines: "hide" }))}`);
const camIco = createGlyphOrthographicCamera({ rotX: 20, rotY: 25, zoom: 150 });
const ico = icosahedronPolygons({ center: [0, 0, 0], size: 3 });
console.log(`Ico show ${countInked(render(ico, camIco, 60, 30, {}))} hide ${countInked(render(ico, camIco, 60, 30, { hiddenLines: "hide" }))}`);
