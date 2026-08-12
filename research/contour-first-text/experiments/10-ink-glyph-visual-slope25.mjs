import { readFileSync } from "node:fs";
import { parseFont, composeText } from "../../../packages/fonts/dist/index.js";
import { createGlyphOrthographicCamera, buildRasterizeContext, rasterize } from "../../../packages/glyphcss/dist/index.js";
import { recenterPolygons } from "../../../packages/core/dist/index.js";

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
function render(polys, camera, cols, rows, extra) {
  const ctx = buildRasterizeContext({ camera, grid: { cols, rows, cellAspect: 2 }, polygons: polys, mode: "ink", useColors: false });
  return rasterize({ ...ctx, ...extra });
}
const cam = createGlyphOrthographicCamera({ rotX: 0, rotY: 0, zoom: 14 });
const polys = glyphPolys(20);
console.log("=== SHOW ===");
console.log(render(polys, cam, 92, 26, {}));
console.log("\n=== HIDE slope 0.5 (shipped wireframe value) ===");
console.log(render(polys, cam, 92, 26, { hiddenLines: "hide", __inkHiddenLineBias: 0.03, __inkHiddenLineSlopeScale: 0.5 }));
console.log("\n=== HIDE slope 2.5 (sphere-safe value) ===");
console.log(render(polys, cam, 92, 26, { hiddenLines: "hide", __inkHiddenLineBias: 0.03, __inkHiddenLineSlopeScale: 2.5 }));
