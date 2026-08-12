// Visual proof for the identity-exemption `hiddenLines: "hide"` ink fix:
// renders `show` (x-ray, today's default, byte-identical to before this
// change) vs `hide` (new occlusion) side by side for the three canonical
// cases: extruded "GLYPH" at a 3/4 rotation (side walls visible), a sphere,
// and a cube. Throwaway.
import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { compileScene, createGlyphOrthographicCamera } from "../../../packages/glyphcss/dist/index.js";
import { cubePolygons, spherePolygons } from "../../../packages/core/dist/index.js";

const glyphPolys = JSON.parse(readFileSync(resolve(process.cwd(), "research/contour-first-text/experiments/glyph-text.json"), "utf8"));

function render(polygons, camera, cols, rows, hiddenLines) {
  return compileScene({ polygons, camera, cols, rows, cellAspect: 2.0, mode: "ink", useColors: false, hiddenLines }).inner;
}
function countInked(txt) { return [...txt].filter((c) => c !== " " && c !== "\n").length; }

const cases = [
  ["glyph-3quarter", glyphPolys, createGlyphOrthographicCamera({ zoom: 5, rotX: 20, rotY: 35 }), 160, 40],
  ["sphere", spherePolygons({ center: [0, 0, 0], size: 3, subdivisions: 3 }), createGlyphOrthographicCamera({ rotX: 20, rotY: 25, zoom: 150 }), 60, 30],
  ["cube", cubePolygons({ center: [0, 0, 0], size: 4 }), createGlyphOrthographicCamera({ rotX: 30, rotY: 35, zoom: 150 }), 60, 30],
];

for (const [label, polys, cam, cols, rows] of cases) {
  const show = render(polys, cam, cols, rows, "show");
  const hide = render(polys, cam, cols, rows, "hide");
  writeFileSync(resolve(process.cwd(), `research/contour-first-text/experiments/18-${label}-show.txt`), show);
  writeFileSync(resolve(process.cwd(), `research/contour-first-text/experiments/18-${label}-hide.txt`), hide);
  console.log(`${label}: show=${countInked(show)} hide=${countInked(hide)} delta=${countInked(hide) - countInked(show)}`);
}
