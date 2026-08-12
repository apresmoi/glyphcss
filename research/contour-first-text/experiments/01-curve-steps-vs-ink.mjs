// Spike 00+03: what does ink actually process vs draw, and does curve
// decimation (tuned for fill) hurt the outline? Throwaway; run with `node`.
import { readFileSync } from "node:fs";
import { parseFont, composeText } from "../../../packages/fonts/dist/index.js";
import { compileScene, createGlyphOrthographicCamera } from "../../../packages/glyphcss/dist/index.js";
import { recenterPolygons } from "../../../packages/core/dist/index.js";

const font = parseFont(readFileSync("../../../packages/fonts/test/fixtures/Roboto-Bold.ttf").buffer);
const D = Math.PI / 180;
const rot = (p, [rx, ry]) => p.map((q) => ({ ...q, vertices: q.vertices.map(([x, y, z]) => {
  let a = [x, y * Math.cos(rx * D) - z * Math.sin(rx * D), y * Math.sin(rx * D) + z * Math.cos(rx * D)];
  return [a[0] * Math.cos(ry * D) + a[2] * Math.sin(ry * D), a[1], -a[0] * Math.sin(ry * D) + a[2] * Math.cos(ry * D)];
}) }));

const edgeCensus = (polys) => {
  const k = (a, b) => { const A = a.map(v => v.toFixed(3)).join(), B = b.map(v => v.toFixed(3)).join(); return A < B ? A + "|" + B : B + "|" + A; };
  const m = new Map();
  for (const p of polys) for (let i = 0; i < p.vertices.length; i++) m.set(k(p.vertices[i], p.vertices[(i + 1) % p.vertices.length]), 1);
  return m.size;
};

for (const [curveSteps, depth] of [[6,20],[6,4],[6,0]]) {
  const raw = composeText(font, "GLYPH", { size: 100, depth, profile: "flat", letterSpacing: 0,
    lineHeight: 1.15, align: "center", curveSteps, simplify: 3,
    faces: { front: { color: "#fff" }, sides: { color: "#888" }, back: { color: "#444" } } });
  const polys = recenterPolygons(rot(recenterPolygons(raw), [18, 10]));
  const camera = createGlyphOrthographicCamera({ rotX: 0, rotY: 0, zoom: 1 });
  camera.zoom = 14;
  const t0 = process.hrtime.bigint();
  let out;
  for (let i = 0; i < 20; i++) out = compileScene({ polygons: polys, camera, cols: 92, rows: 26, cellAspect: 2, mode: "ink", useColors: false });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6 / 20;
  const txt = (typeof out === "string" ? out : out.inner ?? out.html).replace(/<[^>]*>/g, "");
  const inked = [...txt].filter((c) => c !== " " && c !== "\n").length;
  console.log(`depth ${String(depth).padStart(2)} | polys ${String(polys.length).padStart(4)} | edges ${String(edgeCensus(polys)).padStart(4)} | ink cells ${String(inked).padStart(4)} | ${ms.toFixed(2)} ms/render`);
  if (true) console.log(txt.split("\n").slice(2, 9).join("\n"));
}
