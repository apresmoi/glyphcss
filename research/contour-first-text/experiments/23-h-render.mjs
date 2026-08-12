import { readFileSync } from "node:fs";
import { parseFont, composeText } from "../../../packages/fonts/dist/index.js";
import { compileScene, createGlyphOrthographicCamera } from "../../../packages/glyphcss/dist/index.js";
import { recenterPolygons } from "../../../packages/core/dist/index.js";

const fontBuf = readFileSync("/tmp/roboto700.ttf");
const font = parseFont(fontBuf.buffer.slice(fontBuf.byteOffset, fontBuf.byteOffset + fontBuf.byteLength));

const raw = composeText(font, "h", {
  size: 100, depth: 80, profile: { edge: "bevel", raised: false, segments: 3 },
  letterSpacing: 0, lineHeight: 1.15, align: "center", underline: false, strike: false,
  curveSteps: 4, simplify: 2, warp: { shape: "none", amount: 0.5 },
  faces: { front: { color: "#d4a82a" }, sides: { color: "#7c5e16" }, back: { color: "#7c5e16" } },
});

function rotateVec3(v, rxDeg, ryDeg, rzDeg) {
  const dx=(rxDeg*Math.PI)/180, dy=(ryDeg*Math.PI)/180, dz=(rzDeg*Math.PI)/180;
  let [x,y,z]=v;
  if (dz!==0){const c=Math.cos(dz),s=Math.sin(dz);[x,y]=[x*c-y*s,x*s+y*c];}
  if (dy!==0){const c=Math.cos(dy),s=Math.sin(dy);[x,z]=[x*c+z*s,-x*s+z*c];}
  if (dx!==0){const c=Math.cos(dx),s=Math.sin(dx);[y,z]=[y*c-z*s,y*s+z*c];}
  return [x,y,z];
}
function rotatePolys(ps, turn, tilt) { return ps.map(q=>({...q, vertices:q.vertices.map(v=>rotateVec3(v,turn,tilt,0))})); }

for (const [label, turn, tilt] of [["worst",47.7,27.9],["also-bad",31.5,28.8],["better",0.7,24.7],["best",-4.7,-4.4]]) {
  const polys = recenterPolygons(rotatePolys(recenterPolygons(raw), turn, tilt));
  const camera = createGlyphOrthographicCamera({ rotX:0, rotY:0, zoom:1 }); camera.zoom = 3.2;
  const r = compileScene({ polygons: polys, camera, cols: 80, rows: 40, cellAspect: 2, mode: "ink", hiddenLines: "show", useColors: false });
  const t = (typeof r === "string" ? r : r.inner ?? r.html).replace(/<[^>]*>/g, "");
  console.log(`\n=== ${label} (turn ${turn}, tilt ${tilt}) ===`);
  console.log(t);
}
