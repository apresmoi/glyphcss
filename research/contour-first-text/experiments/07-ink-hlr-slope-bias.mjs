// Spike/verification 07: apply the slope-scaled HLR bias (subpath 05, now
// shipped as HLR_BIAS/HLR_SLOPE_SCALE in rasterize.ts) to ink mode via the
// PUBLIC `hiddenLines: "hide"` option (no internal flags — the feature is
// shipped, not spiked). Re-runs the exact convex-mesh regression check that
// killed subpath 04's flat bias: cube / icosahedron / sphere show vs hide.
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
  const N = 20;
  const t0 = process.hrtime.bigint();
  let out;
  for (let i = 0; i < N; i++) out = rasterize(ctx);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6 / N;
  return { text: out, inked: countInked(out), ms };
}

function report(label, polys, camera, cols, rows) {
  const show = renderInk(polys, camera, cols, rows, "show");
  const hide = renderInk(polys, camera, cols, rows, "hide");
  const delta = hide.inked - show.inked;
  const pct = ((delta / show.inked) * 100).toFixed(1);
  console.log(`${label.padEnd(28)} show ${String(show.inked).padStart(4)}  hide ${String(hide.inked).padStart(4)}  delta ${String(delta).padStart(5)} (${pct}%)  show ${show.ms.toFixed(2)}ms / hide ${hide.ms.toFixed(2)}ms`);
  return { show, hide };
}

console.log("=== Convex-mesh regression check (this is the ship/no-ship gate) ===");
const camCube = createGlyphOrthographicCamera({ rotX: 30, rotY: 35, zoom: 150 });
report("Cube", cubePolygons({ center: [0, 0, 0], size: 4, color: "#fff" }), camCube, 60, 30);

const camIco = createGlyphOrthographicCamera({ rotX: 20, rotY: 25, zoom: 150 });
report("Icosahedron", icosahedronPolygons({ center: [0, 0, 0], size: 3 }), camIco, 60, 30);

const camSphere = createGlyphOrthographicCamera({ rotX: 20, rotY: 25, zoom: 150 });
report("Sphere (subdiv 2)", spherePolygons({ center: [0, 0, 0], size: 3, subdivisions: 2 }), camSphere, 60, 30);
report("Sphere (subdiv 3, fine)", spherePolygons({ center: [0, 0, 0], size: 3, subdivisions: 3 }), camSphere, 60, 30);

console.log("\n=== Motivating case: extruded text tram-lines ===");
const camGlyph = createGlyphOrthographicCamera({ rotX: 0, rotY: 0, zoom: 14 });
report("GLYPH depth=20", glyphPolys(20), camGlyph, 92, 26);
report("GLYPH depth=4", glyphPolys(4), camGlyph, 92, 26);
const flat = renderInk(glyphPolys(0), camGlyph, 92, 26, undefined);
console.log(`GLYPH depth=0 (flat baseline, no HLR needed): inked ${flat.inked} | ${flat.ms.toFixed(2)} ms/render`);

console.log("\n=== Full renders (hide) for visual proof ===");
for (const [label, polys, cam, cols, rows] of [
  ["GLYPH depth=20", glyphPolys(20), camGlyph, 92, 26],
  ["Cube", cubePolygons({ center: [0, 0, 0], size: 4, color: "#fff" }), camCube, 60, 30],
  ["Sphere", spherePolygons({ center: [0, 0, 0], size: 3, subdivisions: 2 }), camSphere, 60, 30],
]) {
  const show = renderInk(polys, cam, cols, rows, "show");
  const hide = renderInk(polys, cam, cols, rows, "hide");
  console.log(`\n--- ${label} SHOW (inked ${show.inked}) ---`);
  console.log(show.text.split("\n").slice(0, 30).join("\n"));
  console.log(`\n--- ${label} HIDE (inked ${hide.inked}) ---`);
  console.log(hide.text.split("\n").slice(0, 30).join("\n"));
}
