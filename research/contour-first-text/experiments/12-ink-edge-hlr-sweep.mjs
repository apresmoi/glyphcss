// Spike 12: sweep INK_HLR_BIAS / INK_HLR_SLOPE_SCALE / sample count for the
// new PER-EDGE (all-samples-must-fail) ink hidden-line removal, via debug
// globals the source temporarily reads (__inkHlrBias/__inkHlrSlope/__inkHlrSamples).
import { readFileSync } from "node:fs";
import { parseFont, composeText } from "../../../packages/fonts/dist/index.js";
import {
  createGlyphOrthographicCamera,
  buildRasterizeContext,
  rasterize,
} from "../../../packages/glyphcss/dist/index.js";
import {
  recenterPolygons,
  cubePolygons,
  icosahedronPolygons,
  spherePolygons,
} from "../../../packages/core/dist/index.js";

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

function countInked(txt) {
  return [...txt].filter((c) => c !== " " && c !== "\n").length;
}

function renderInk(polys, camera, cols, rows, hiddenLines) {
  const ctx = buildRasterizeContext({
    camera, grid: { cols, rows, cellAspect: 2 }, polygons: polys, mode: "ink", useColors: false,
    ...(hiddenLines ? { hiddenLines } : {}),
  });
  return { text: rasterize(ctx), inked: countInked(rasterize(ctx)) };
}

const camCube = createGlyphOrthographicCamera({ rotX: 30, rotY: 35, zoom: 150 });
const cube = cubePolygons({ center: [0, 0, 0], size: 4, color: "#fff" });
const camIco = createGlyphOrthographicCamera({ rotX: 20, rotY: 25, zoom: 150 });
const ico = icosahedronPolygons({ center: [0, 0, 0], size: 3 });
const camSphere = createGlyphOrthographicCamera({ rotX: 20, rotY: 25, zoom: 150 });
const sphere2 = spherePolygons({ center: [0, 0, 0], size: 3, subdivisions: 2 });
const sphere3 = spherePolygons({ center: [0, 0, 0], size: 3, subdivisions: 3 });
const camGlyph = createGlyphOrthographicCamera({ rotX: 0, rotY: 0, zoom: 14 });
const glyph20 = glyphPolys(20);

const cubeShow = renderInk(cube, camCube, 60, 30, "show").inked;
const icoShow = renderInk(ico, camIco, 60, 30, "show").inked;
const s2Show = renderInk(sphere2, camSphere, 60, 30, "show").inked;
const s3Show = renderInk(sphere3, camSphere, 60, 30, "show").inked;
const glyphShow = renderInk(glyph20, camGlyph, 92, 26, "show").inked;

function sweep(bias, slope, samples) {
  globalThis.__inkHlrBias = bias;
  globalThis.__inkHlrSlope = slope;
  globalThis.__inkHlrSamples = samples;
  const cubeHide = renderInk(cube, camCube, 60, 30, "hide").inked;
  const icoHide = renderInk(ico, camIco, 60, 30, "hide").inked;
  const s2Hide = renderInk(sphere2, camSphere, 60, 30, "hide").inked;
  const s3Hide = renderInk(sphere3, camSphere, 60, 30, "hide").inked;
  const glyphHide = renderInk(glyph20, camGlyph, 92, 26, "hide").inked;
  const pct = (a, b) => (((a - b) / b) * 100).toFixed(1);
  console.log(
    `bias=${bias} slope=${slope} samples=${samples}  ` +
    `cube ${cubeHide}/${cubeShow} (${pct(cubeHide, cubeShow)}%)  ` +
    `ico ${icoHide}/${icoShow} (${pct(icoHide, icoShow)}%)  ` +
    `s2 ${s2Hide}/${s2Show} (${pct(s2Hide, s2Show)}%)  ` +
    `s3 ${s3Hide}/${s3Show} (${pct(s3Hide, s3Show)}%)  ` +
    `glyph ${glyphHide}/${glyphShow} (${pct(glyphHide, glyphShow)}%)`,
  );
}

console.log(`baselines: cube=${cubeShow} ico=${icoShow} s2=${s2Show} s3=${s3Show} glyph20=${glyphShow}`);
for (const bias of [0.03, 0.06, 0.1, 0.2]) {
  for (const slope of [0.5, 1.0, 1.5]) {
    sweep(bias, slope, 6);
  }
}
console.log("--- sample count effect at bias=0.06 slope=1.0 ---");
for (const samples of [3, 6, 12, 20]) {
  sweep(0.06, 1.0, samples);
}
