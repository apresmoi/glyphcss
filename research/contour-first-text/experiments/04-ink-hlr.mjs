// Spike 04: hidden-line removal for ink mode. Throwaway; run with `node`.
// Measures inked-cell counts + ms/render before/after the internal
// __inkHiddenLineRemoval flag, across the "GLYPH" extruded-text baseline plus
// a cube, an icosahedron, and a sphere (the sphere is the self-occlusion
// stress case: its silhouette is a smooth curve lying exactly on the surface
// it outlines).
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

function renderInk(polys, camera, cols, rows, extra = {}) {
  const ctx = buildRasterizeContext({
    camera, grid: { cols, rows, cellAspect: 2 }, polygons: polys, mode: "ink", useColors: false,
  });
  const fullCtx = { ...ctx, ...extra };
  const N = 20;
  const t0 = process.hrtime.bigint();
  let out;
  for (let i = 0; i < N; i++) out = rasterize(fullCtx);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6 / N;
  return { text: out, inked: countInked(out), ms };
}

function report(label, polys, camera, cols, rows) {
  console.log(`\n=== ${label} ===`);
  const before = renderInk(polys, camera, cols, rows);
  console.log(`before: inked ${before.inked} | ${before.ms.toFixed(2)} ms/render`);
  for (const bias of [0.005, 0.015, 0.03, 0.06, 0.1, 0.2, 0.4, 0.8]) {
    const after = renderInk(polys, camera, cols, rows, { __inkHiddenLineRemoval: true, __inkHiddenLineBias: bias });
    console.log(`bias ${bias.toFixed(3)}: inked ${after.inked} | ${after.ms.toFixed(2)} ms/render  (delta ${(after.inked - before.inked)})`);
  }
  return before;
}

function printText(txt) {
  console.log(txt.split("\n").slice(0, 30).join("\n"));
}

// --- GLYPH extruded text, depth 20/4/0 (depth 0 is the clean flat baseline: 297 cells) ---
const camGlyph = createGlyphOrthographicCamera({ rotX: 0, rotY: 0, zoom: 14 });
report("GLYPH depth=20", glyphPolys(20), camGlyph, 92, 26);
report("GLYPH depth=4", glyphPolys(4), camGlyph, 92, 26);
const flat = renderInk(glyphPolys(0), camGlyph, 92, 26);
console.log(`\nGLYPH depth=0 (flat baseline, no HLR needed): inked ${flat.inked} | ${flat.ms.toFixed(2)} ms/render`);

// --- Cube ---
const camCube = createGlyphOrthographicCamera({ rotX: 30, rotY: 35, zoom: 150 });
report("Cube", cubePolygons({ center: [0, 0, 0], size: 4, color: "#fff" }), camCube, 60, 30);

// --- Icosahedron ---
const camIco = createGlyphOrthographicCamera({ rotX: 20, rotY: 25, zoom: 150 });
report("Icosahedron", icosahedronPolygons({ center: [0, 0, 0], size: 3 }), camIco, 60, 30);

// --- Sphere (self-occlusion stress case) ---
const camSphere = createGlyphOrthographicCamera({ rotX: 20, rotY: 25, zoom: 150 });
report("Sphere (subdivisions=2)", spherePolygons({ center: [0, 0, 0], size: 3, subdivisions: 2 }), camSphere, 60, 30);

// --- Full before/after renders at the chosen bias for the final report ---
const CHOSEN_BIAS = 0.03;
console.log(`\n\n######## FULL RENDERS at bias=${CHOSEN_BIAS} ########`);

for (const [label, polys, cam, cols, rows] of [
  ["GLYPH depth=20", glyphPolys(20), camGlyph, 92, 26],
  ["Cube", cubePolygons({ center: [0, 0, 0], size: 4, color: "#fff" }), camCube, 60, 30],
  ["Icosahedron", icosahedronPolygons({ center: [0, 0, 0], size: 3 }), camIco, 60, 30],
  ["Sphere", spherePolygons({ center: [0, 0, 0], size: 3, subdivisions: 2 }), camSphere, 60, 30],
  ["Sphere (fine, subdivisions=3)", spherePolygons({ center: [0, 0, 0], size: 3, subdivisions: 3 }), camSphere, 60, 30],
]) {
  const before = renderInk(polys, cam, cols, rows);
  const after = renderInk(polys, cam, cols, rows, { __inkHiddenLineRemoval: true, __inkHiddenLineBias: CHOSEN_BIAS });
  console.log(`\n--- ${label} BEFORE (inked ${before.inked}, ${before.ms.toFixed(2)}ms) ---`);
  printText(before.text);
  console.log(`\n--- ${label} AFTER (inked ${after.inked}, ${after.ms.toFixed(2)}ms) ---`);
  printText(after.text);
}
