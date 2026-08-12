// Reproduces the user-reported repro URL as closely as possible:
// /wordart?text=Glyph%0ACSS&depth=80&curve=4&spin=0&turn=-38&tilt=0.2&mode=ink
// mesh rotation = [turn, tilt, 0] = [-38, 0.2, 0] (XYZ Euler degrees, Rz then Ry then Rx,
// matching packages/glyphcss/src/api/createGlyphScene.test.ts's rotateVec3Deg).
import { readFileSync } from "node:fs";
import { parseFont, composeText } from "../../../packages/fonts/dist/index.js";
import {
  createGlyphOrthographicCamera,
  buildRasterizeContext,
  rasterize,
} from "../../../packages/glyphcss/dist/index.js";
import { recenterPolygons } from "../../../packages/core/dist/index.js";

const font = parseFont(readFileSync("../../../packages/fonts/test/fixtures/Roboto-Bold.ttf").buffer);

function rotateVec3Deg([x, y, z], rxDeg, ryDeg, rzDeg) {
  const D = Math.PI / 180;
  if (rzDeg !== 0) { const c = Math.cos(rzDeg * D), s = Math.sin(rzDeg * D); [x, y] = [x * c - y * s, x * s + y * c]; }
  if (ryDeg !== 0) { const c = Math.cos(ryDeg * D), s = Math.sin(ryDeg * D); [x, z] = [x * c + z * s, -x * s + z * c]; }
  if (rxDeg !== 0) { const c = Math.cos(rxDeg * D), s = Math.sin(rxDeg * D); [y, z] = [y * c - z * s, y * s + z * c]; }
  return [x, y, z];
}

function rotatePolys(polys, rx, ry, rz) {
  return polys.map((p) => ({ ...p, vertices: p.vertices.map((v) => rotateVec3Deg(v, rx, ry, rz)) }));
}

function countInked(txt) {
  return [...txt].filter((c) => c !== " " && c !== "\n").length;
}

const raw = composeText(font, "Glyph\nCSS", {
  size: 100, depth: 80, profile: "flat", letterSpacing: 0, lineHeight: 1.15, align: "center",
  curveSteps: 4, simplify: 3,
  faces: { front: { color: "#fff" }, sides: { color: "#888" }, back: { color: "#444" } },
});
const polys = recenterPolygons(rotatePolys(recenterPolygons(raw), -38, 0.2, 0));

const cam = createGlyphOrthographicCamera({ rotX: 0, rotY: 0, zoom: 8 });
const COLS = 110, ROWS = 40;

function render(hiddenLines) {
  const ctx = buildRasterizeContext({
    camera: cam, grid: { cols: COLS, rows: ROWS, cellAspect: 2 }, polygons: polys, mode: "ink", useColors: false,
    ...(hiddenLines ? { hiddenLines } : {}),
  });
  return rasterize(ctx);
}

const show = render("show");
const hide = render("hide");
console.log(`inked show=${countInked(show)} hide=${countInked(hide)} identical=${show === hide}`);
console.log("\n--- SHOW ---");
console.log(show);
console.log("\n--- HIDE ---");
console.log(hide);
