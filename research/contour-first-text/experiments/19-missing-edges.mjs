// Are ink's missing letter strokes a KEEP-RULE problem (facing/winding) rather
// than occlusion? Compare ink vs wireframe on the same mesh + camera.
import { readFileSync } from "node:fs";
import { parseFont, composeText } from "../../../packages/fonts/dist/index.js";
import { compileScene, createGlyphOrthographicCamera } from "../../../packages/glyphcss/dist/index.js";
import { recenterPolygons } from "../../../packages/core/dist/index.js";
const font = parseFont(readFileSync("../../../packages/fonts/test/fixtures/Roboto-Bold.ttf").buffer);
const D = Math.PI/180;
const rot = (ps,[rx,ry]) => ps.map(q=>({...q, vertices:q.vertices.map(([x,y,z])=>{
  let a=[x, y*Math.cos(rx*D)-z*Math.sin(rx*D), y*Math.sin(rx*D)+z*Math.cos(rx*D)];
  return [a[0]*Math.cos(ry*D)+a[2]*Math.sin(ry*D), a[1], -a[0]*Math.sin(ry*D)+a[2]*Math.cos(ry*D)];})}));
const raw = composeText(font, "h", { size:100, depth:80, profile:"flat", letterSpacing:0,
  lineHeight:1.15, align:"center", curveSteps:4, simplify:3,
  faces:{front:{color:"#fff"}, sides:{color:"#888"}, back:{color:"#444"}} });
console.log("polygons:", raw.length);
// winding census: signed area of each polygon in its own plane (XY projection)
let cw=0, ccw=0, degen=0;
for (const q of raw) { let a=0; const v=q.vertices;
  for (let i=0;i<v.length;i++){ const [x1,y1]=v[i], [x2,y2]=v[(i+1)%v.length]; a += x1*y2-x2*y1; }
  if (Math.abs(a) < 1e-9) degen++; else if (a>0) ccw++; else cw++; }
console.log(`winding (XY): ccw ${ccw} | cw ${cw} | degenerate ${degen}`);
for (const [turn,tilt] of [[47.7,27.9],[31.5,28.8],[0.7,24.7],[-4.7,-4.4]]) {
  const polys = recenterPolygons(rot(recenterPolygons(raw), [tilt, turn]));
  const out = {};
  for (const mode of ["ink","wireframe"]) {
    const camera = createGlyphOrthographicCamera({ rotX:0, rotY:0, zoom:1 }); camera.zoom = 3.2;
    const r = compileScene({ polygons:polys, camera, cols:120, rows:40, cellAspect:2, mode, useColors:false });
    const t = (typeof r === "string" ? r : r.inner ?? r.html).replace(/<[^>]*>/g,"");
    out[mode] = [...t].filter(c=>c!==" "&&c!=="\n").length;
  }
  console.log(`turn ${String(turn).padStart(6)} tilt ${String(tilt).padStart(6)} | ink ${String(out.ink).padStart(4)} | wireframe ${String(out.wireframe).padStart(4)} | ink/wf ${(out.ink/out.wireframe).toFixed(2)}`);
}
