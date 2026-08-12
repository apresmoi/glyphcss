import { readFileSync } from "node:fs";
import { parseFont, composeText } from "../../../packages/fonts/dist/index.js";
import { createGlyphOrthographicCamera, buildRasterizeContext, rasterize } from "../../../packages/glyphcss/dist/index.js";
import { recenterPolygons, cubePolygons, icosahedronPolygons, spherePolygons } from "../../../packages/core/dist/index.js";

const font = parseFont(readFileSync("../../../packages/fonts/test/fixtures/Roboto-Bold.ttf").buffer);
const D = Math.PI / 180;
const rot = (p, [rx, ry]) => p.map((q) => ({ ...q, vertices: q.vertices.map(([x, y, z]) => {
  let a = [x, y * Math.cos(rx * D) - z * Math.sin(rx * D), y * Math.sin(rx * D) + z * Math.cos(rx * D)];
  return [a[0] * Math.cos(ry * D) + a[2] * Math.sin(ry * D), a[1], -a[0] * Math.sin(ry * D) + a[2] * Math.cos(ry * D)];
}) }));
function glyphPolys(depth) {
  const raw = composeText(font, "GLYPH", { size: 100, depth, profile: "flat", letterSpacing: 0,
    lineHeight: 1.15, align: "center", curveSteps: 6, simplify: 3,
    faces: { front: { color: "#fff" }, sides: { color: "#888" }, back: { color: "#444" } } });
  return recenterPolygons(rot(recenterPolygons(raw), [18, 10]));
}
function countInked(txt) { return [...txt].filter((c) => c !== " " && c !== "\n").length; }
function render(polys, camera, cols, rows, extra) {
  const ctx = buildRasterizeContext({ camera, grid: { cols, rows, cellAspect: 2 }, polygons: polys, mode: "ink", useColors: false });
  return rasterize({ ...ctx, ...extra });
}

const cases = [
  ["Cube", cubePolygons({ center: [0, 0, 0], size: 4, color: "#fff" }), createGlyphOrthographicCamera({ rotX: 30, rotY: 35, zoom: 150 }), 60, 30],
  ["Icosahedron", icosahedronPolygons({ center: [0, 0, 0], size: 3 }), createGlyphOrthographicCamera({ rotX: 20, rotY: 25, zoom: 150 }), 60, 30],
  ["Sphere", spherePolygons({ center: [0, 0, 0], size: 3, subdivisions: 2 }), createGlyphOrthographicCamera({ rotX: 20, rotY: 25, zoom: 150 }), 60, 30],
  ["Sphere fine", spherePolygons({ center: [0, 0, 0], size: 3, subdivisions: 3 }), createGlyphOrthographicCamera({ rotX: 20, rotY: 25, zoom: 150 }), 60, 30],
  ["GLYPH depth=20", glyphPolys(20), createGlyphOrthographicCamera({ rotX: 0, rotY: 0, zoom: 14 }), 92, 26],
  ["GLYPH depth=4", glyphPolys(4), createGlyphOrthographicCamera({ rotX: 0, rotY: 0, zoom: 14 }), 92, 26],
];

const shows = cases.map(([label, polys, cam, cols, rows]) => [label, countInked(render(polys, cam, cols, rows, {}))]);
console.log("show baselines:", shows);

for (const bias of [0.005, 0.03]) {
  for (const slope of [0.5, 1.0, 1.5, 2.0, 2.5]) {
    const row = cases.map(([label, polys, cam, cols, rows], i) => {
      const inked = countInked(render(polys, cam, cols, rows, { hiddenLines: "hide", __inkHiddenLineBias: bias, __inkHiddenLineSlopeScale: slope }));
      const delta = inked - shows[i][1];
      return `${label}:${inked}(${delta>=0?"+":""}${delta})`;
    }).join("  ");
    console.log(`bias ${bias} slope ${slope}: ${row}`);
  }
}
