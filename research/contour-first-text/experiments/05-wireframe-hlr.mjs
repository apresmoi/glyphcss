// Spike 05: depth-tested hidden-line removal for the WIREFRAME path (ASCII +
// braille). Throwaway; run with `node` after `pnpm --filter glyphcss build`
// and `pnpm --filter @glyphcss/fonts build` (uses the built dist, like 04).
//
// Reproduces the user's exact defect (extruded "Glyph\nCSS", depth 80,
// wireframe + braille — a letter BEHIND paints its side walls over a letter
// in FRONT because rasterizeWireframeBraille has no depth buffer), sweeps
// the internal __wireframeHiddenLineRemoval / __wireframeHiddenLineBias /
// __wireframeHiddenLineSlopeScale / __wireframeHiddenLineSubcellDepth flags,
// and runs the SAME convex-mesh regression check that killed ink's flat-bias
// attempt (04): cube / icosahedron / sphere, comparing against the
// ANALYTIC front-facing-only edge set (the ground truth wireframe HLR should
// converge to), not just a raw before/after delta.
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

const font = parseFont(readFileSync(new URL("../../../packages/fonts/test/fixtures/Roboto-Bold.ttf", import.meta.url)).buffer);
const D = Math.PI / 180;
const rot = (p, [rx, ry]) => p.map((q) => ({ ...q, vertices: q.vertices.map(([x, y, z]) => {
  const a = [x, y * Math.cos(rx * D) - z * Math.sin(rx * D), y * Math.sin(rx * D) + z * Math.cos(rx * D)];
  return [a[0] * Math.cos(ry * D) + a[2] * Math.sin(ry * D), a[1], -a[0] * Math.sin(ry * D) + a[2] * Math.cos(ry * D)];
}) }));

function glyphCssPolys(depth, curveSteps) {
  const raw = composeText(font, "Glyph\nCSS", {
    size: 100, depth, profile: "flat", letterSpacing: 0, lineHeight: 1.15,
    align: "center", curveSteps, simplify: 2,
    faces: { front: { color: "#d4a82a" }, sides: { color: "#7c5e16" }, back: { color: "#7c5e16" } },
  });
  return recenterPolygons(rot(recenterPolygons(raw), [0, 14]));
}

function countInked(txt) {
  return [...txt].filter((c) => c !== " " && c !== "\n").length;
}

function render(polys, camera, cols, rows, mode, charMode, extra = {}) {
  const ctx = buildRasterizeContext({
    camera, grid: { cols, rows, cellAspect: 2 }, polygons: polys, mode, charMode, useColors: false,
  });
  const fullCtx = { ...ctx, ...extra };
  const N = 20;
  const t0 = process.hrtime.bigint();
  let out;
  for (let i = 0; i < N; i++) out = rasterize(fullCtx);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6 / N;
  return { text: out, inked: countInked(out), ms };
}

function printText(txt) {
  console.log(txt);
}

// Analytic "should be visible" edge count. IMPORTANT: must classify only the
// mesh's REAL boundary edges (the same ones `polygonsToWireframeEdges` /
// `ctx.wireframe` produce — each polygon's own consecutive-vertex-pair
// perimeter), never a fan-triangulation DIAGONAL. A quad face fan-triangulates
// into two triangles joined by a diagonal that is a legitimate triangle edge
// but NOT a real cube/mesh edge — an earlier version of this script emitted
// those diagonals too and inflated the "ground truth" cube count past the
// full X-ray count, which is impossible (front-only must be <= all-edges) and
// was caught precisely by that sanity check.
function frontFacingEdgeWireframe(polygons, camera, cols, rows, cellAspect) {
  // Real boundary edges, same key/edge convention as polygonsToWireframeEdges.
  const realEdges = new Map();
  for (const poly of polygons) {
    const verts = poly.vertices;
    if (verts.length < 2) continue;
    for (let i = 0; i < verts.length; i++) {
      const a = verts[i], b = verts[(i + 1) % verts.length];
      const k1 = `${a[0]},${a[1]},${a[2]}`, k2 = `${b[0]},${b[1]},${b[2]}`;
      const key = k1 < k2 ? `${k1}|${k2}` : `${k2}|${k1}`;
      if (!realEdges.has(key)) realEdges.set(key, { from: a, to: b });
    }
  }
  // Front-facing touch, from the fan triangulation (diagonals included here,
  // but only used to ANSWER "does this key touch a front triangle" — a
  // diagonal's own key is simply never looked up below since it's absent
  // from `realEdges`).
  const frontTouch = new Map();
  for (const poly of polygons) {
    const verts = poly.vertices;
    if (verts.length < 3) continue;
    for (let f = 1; f < verts.length - 1; f++) {
      const v0 = verts[0], v1 = verts[f], v2 = verts[f + 1];
      const pa = camera.project(v0, cols, rows, cellAspect);
      const pb = camera.project(v1, cols, rows, cellAspect);
      const pc = camera.project(v2, cols, rows, cellAspect);
      if (pa[0] !== pa[0] || pb[0] !== pb[0] || pc[0] !== pc[0]) continue;
      const area2 = (pb[0] - pa[0]) * (pc[1] - pa[1]) - (pb[1] - pa[1]) * (pc[0] - pa[0]);
      const front = area2 <= 0;
      for (const [a, b] of [[v0, v1], [v1, v2], [v2, v0]]) {
        const k1 = `${a[0]},${a[1]},${a[2]}`, k2 = `${b[0]},${b[1]},${b[2]}`;
        const key = k1 < k2 ? `${k1}|${k2}` : `${k2}|${k1}`;
        frontTouch.set(key, (frontTouch.get(key) || false) || front);
      }
    }
  }
  const edges = [];
  for (const [key, e] of realEdges) {
    if (frontTouch.get(key)) edges.push({ from: e.from, to: e.to, weight: 2 });
  }
  return edges;
}

console.log("######## PART 1: reproduce the user's exact defect ########");
console.log("text='Glyph\\nCSS' depth=80 curveSteps=4 mode=wireframe charMode=braille, mesh rotY=14 (matches the workbench's static tilt)\n");

const camWA = createGlyphOrthographicCamera({ rotX: 0, rotY: 0, zoom: 6 });
const cols = 100, rows = 34;
const wcPolys = glyphCssPolys(80, 4);

console.log("=== BEFORE (flag off) ===");
const before = render(wcPolys, camWA, cols, rows, "wireframe", "braille");
printText(before.text);
console.log(`\ninked ${before.inked} | ${before.ms.toFixed(2)} ms/render`);

console.log("\n=== AFTER (flag on, bias=0.03, slopeScale=0.5) ===");
const after = render(wcPolys, camWA, cols, rows, "wireframe", "braille", {
  __wireframeHiddenLineRemoval: true, __wireframeHiddenLineBias: 0.03, __wireframeHiddenLineSlopeScale: 0.5,
});
printText(after.text);
console.log(`\ninked ${after.inked} | ${after.ms.toFixed(2)} ms/render`);

console.log("\n\n######## PART 2: bias sweep (per-cell depth, cross-object occlusion case) ########");
for (const bias of [0.005, 0.015, 0.03, 0.06, 0.1, 0.2]) {
  const r = render(wcPolys, camWA, cols, rows, "wireframe", "braille", { __wireframeHiddenLineRemoval: true, __wireframeHiddenLineBias: bias });
  console.log(`bias ${bias.toFixed(3)}: inked ${r.inked} (delta ${r.inked - before.inked}) | ${r.ms.toFixed(2)} ms`);
}

console.log("\n\n######## PART 3: convex-mesh regression check (cube/ico/sphere) — same shape as 04 ########");
console.log("Ground truth = analytic front-facing-only edge set (no depth test needed, pure facing classification).");
console.log("Regression = depth-HLR keeping FEWER cells than that ground truth (self-occlusion acne eating real front-facing edges).\n");

function regressionCheck(label, polys, camera, cols, rows) {
  console.log(`--- ${label} ---`);
  const full = render(polys, camera, cols, rows, "wireframe", "ascii");
  const gtEdges = frontFacingEdgeWireframe(polys, camera, cols, rows, 2);
  const gtCtx = buildRasterizeContext({ camera, grid: { cols, rows, cellAspect: 2 }, wireframe: gtEdges, mode: "wireframe", useColors: false });
  const gt = rasterize(gtCtx);
  const gtInked = countInked(gt);
  console.log(`full X-ray (no HLR, current default): inked ${full.inked} | ${full.ms.toFixed(2)}ms`);
  console.log(`analytic front-facing-only ground truth: inked ${gtInked}`);
  for (const bias of [0.005, 0.015, 0.03, 0.06, 0.1, 0.2]) {
    for (const slope of [0, 0.5, 1.5]) {
      const r = render(polys, camera, cols, rows, "wireframe", "ascii", { __wireframeHiddenLineRemoval: true, __wireframeHiddenLineBias: bias, __wireframeHiddenLineSlopeScale: slope });
      const deltaVsGt = r.inked - gtInked;
      const flag = deltaVsGt < -gtInked * 0.03 ? "  <-- REGRESSION (eats real front-facing edges)" : "";
      console.log(`  bias ${bias.toFixed(3)} slope ${slope}: inked ${r.inked} (delta vs ground truth ${deltaVsGt >= 0 ? "+" : ""}${deltaVsGt})${flag}`);
    }
  }
  console.log();
}

const camCube = createGlyphOrthographicCamera({ rotX: 30, rotY: 35, zoom: 150 });
regressionCheck("Cube", cubePolygons({ center: [0, 0, 0], size: 4, color: "#fff" }), camCube, 60, 30);

const camIco = createGlyphOrthographicCamera({ rotX: 20, rotY: 25, zoom: 150 });
regressionCheck("Icosahedron", icosahedronPolygons({ center: [0, 0, 0], size: 3 }), camIco, 60, 30);

const camSphere = createGlyphOrthographicCamera({ rotX: 20, rotY: 25, zoom: 150 });
regressionCheck("Sphere (subdivisions=2)", spherePolygons({ center: [0, 0, 0], size: 3, subdivisions: 2 }), camSphere, 60, 30);

console.log("\n\n######## PART 4: subcell vs per-cell depth resolution (braille only) ########");
{
  const bias = 0.03, slope = 0.5;
  const perCell = render(wcPolys, camWA, cols, rows, "wireframe", "braille", { __wireframeHiddenLineRemoval: true, __wireframeHiddenLineBias: bias, __wireframeHiddenLineSlopeScale: slope, __wireframeHiddenLineSubcellDepth: false });
  const subCell = render(wcPolys, camWA, cols, rows, "wireframe", "braille", { __wireframeHiddenLineRemoval: true, __wireframeHiddenLineBias: bias, __wireframeHiddenLineSlopeScale: slope, __wireframeHiddenLineSubcellDepth: true });
  console.log(`per-cell depth:    inked ${perCell.inked} | ${perCell.ms.toFixed(3)} ms/render`);
  console.log(`per-subcell depth: inked ${subCell.inked} | ${subCell.ms.toFixed(3)} ms/render`);
  console.log(`\nper-cell text:\n${perCell.text}`);
  console.log(`\nper-subcell text:\n${subCell.text}`);
}

console.log("\n\n######## PART 5: cost delta summary (mean of 20 renders) ########");
{
  const off = render(wcPolys, camWA, cols, rows, "wireframe", "braille");
  const onFlat = render(wcPolys, camWA, cols, rows, "wireframe", "braille", { __wireframeHiddenLineRemoval: true, __wireframeHiddenLineBias: 0.03, __wireframeHiddenLineSlopeScale: 0 });
  const onSlope = render(wcPolys, camWA, cols, rows, "wireframe", "braille", { __wireframeHiddenLineRemoval: true, __wireframeHiddenLineBias: 0.03, __wireframeHiddenLineSlopeScale: 0.5 });
  console.log(`flag off:            ${off.ms.toFixed(3)} ms/render`);
  console.log(`flag on, flat bias:  ${onFlat.ms.toFixed(3)} ms/render (delta ${(onFlat.ms - off.ms).toFixed(3)} ms, ${(((onFlat.ms - off.ms) / off.ms) * 100).toFixed(1)}%)`);
  console.log(`flag on, slope bias: ${onSlope.ms.toFixed(3)} ms/render (delta ${(onSlope.ms - off.ms).toFixed(3)} ms, ${(((onSlope.ms - off.ms) / off.ms) * 100).toFixed(1)}%)`);

  const asciiOff = render(wcPolys, camWA, cols, rows, "wireframe", "ascii");
  const asciiOn = render(wcPolys, camWA, cols, rows, "wireframe", "ascii", { __wireframeHiddenLineRemoval: true, __wireframeHiddenLineBias: 0.03, __wireframeHiddenLineSlopeScale: 0.5 });
  console.log(`\nASCII flag off: ${asciiOff.ms.toFixed(3)} ms/render`);
  console.log(`ASCII flag on:  ${asciiOn.ms.toFixed(3)} ms/render (delta ${(asciiOn.ms - asciiOff.ms).toFixed(3)} ms, ${(((asciiOn.ms - asciiOff.ms) / asciiOff.ms) * 100).toFixed(1)}%)`);
}
