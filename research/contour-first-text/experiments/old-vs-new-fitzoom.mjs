import { readFileSync } from "fs";
import { parseFont } from "../../../packages/fonts/src/parseFont.ts";
import { composeText } from "../../../packages/fonts/src/composeText.ts";
import { compileScene } from "../../../packages/glyphcss/src/index.ts";
import { createGlyphOrthographicCamera } from "../../../packages/glyphcss/src/api/createGlyphCamera.ts";

const buf = readFileSync(new URL("../../../packages/fonts/test/fixtures/Roboto-Bold.ttf", import.meta.url));
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const font = parseFont(ab);

// NEW frame (current extrude.ts): toWorld = [z, px, py]
const newPolys = composeText(font, "Hi", { size: 100, depth: 26, profile: { edge: "bevel" } });

// Simulate OLD frame by remapping NEW's world coords back: old = [z_new_isX(depth)-> actually let's just
// derive OLD directly: oldToWorld(p,z) = [-p.y, p.x, z]. We don't have access to raw type-plane p/z here,
// but we CAN reconstruct by inverting newToWorld: given new=[X,Y,Z]=[depth,px,py], we know depth=X, px=Y, py=Z.
// old = [-py, px, depth] = [-Z, Y, X].
function toOld(polys) {
  return polys.map(p => ({ ...p, vertices: p.vertices.map(([x,y,z]) => [-z, y, x]) }));
}
const oldPolys = toOld(newPolys);

function bbox(polys) {
  let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity,minZ=Infinity,maxZ=-Infinity;
  for (const p of polys) for (const v of p.vertices) {
    if (v[0]<minX) minX=v[0]; if (v[0]>maxX) maxX=v[0];
    if (v[1]<minY) minY=v[1]; if (v[1]>maxY) maxY=v[1];
    if (v[2]<minZ) minZ=v[2]; if (v[2]>maxZ) maxZ=v[2];
  }
  return {minX,maxX,minY,maxY,minZ,maxZ};
}
console.log("NEW bbox:", bbox(newPolys));
console.log("OLD bbox:", bbox(oldPolys));

function fitZoomOld(polys, stageW, stageH) {
  const b = bbox(polys);
  const horizontal = Math.max(b.maxY-b.minY, b.maxZ-b.minZ);
  const vertical = b.maxX-b.minX;
  const fitW = (stageW*0.7)/Math.max(horizontal,1);
  const fitH = (stageH*0.68)/Math.max(vertical,1);
  return Math.max(0.5, Math.min(10, Math.min(fitW, fitH)));
}
function fitZoomNew(polys, stageW, stageH) {
  const b = bbox(polys);
  const horizontal = Math.max(b.maxY-b.minY, b.maxX-b.minX);
  const vertical = b.maxZ-b.minZ;
  const fitW = (stageW*0.7)/Math.max(horizontal,1);
  const fitH = (stageH*0.68)/Math.max(vertical,1);
  return Math.max(0.5, Math.min(10, Math.min(fitW, fitH)));
}

const zOld = fitZoomOld(oldPolys, 1059, 646);
const zNew = fitZoomNew(newPolys, 1059, 646);
console.log("zoom OLD:", zOld, "zoom NEW:", zNew);

const camOld = createGlyphOrthographicCamera({ rotX: 0, rotY: 0, zoom: zOld });
const camNew = createGlyphOrthographicCamera({ rotX: 90, rotY: 0, zoom: zNew });
const oOld = compileScene({ polygons: oldPolys, camera: camOld, cols: 110, rows: 40, cellAspect: 2, mode: "solid", useColors: false });
const oNew = compileScene({ polygons: newPolys, camera: camNew, cols: 110, rows: 40, cellAspect: 2, mode: "solid", useColors: false });
function stats(o) {
  const lines = (o.text ?? o.inner ?? "").split("\n");
  const inkedRows = lines.filter(l => l.trim().length > 0).length;
  const maxLineLen = Math.max(...lines.map(l => l.trimEnd().length));
  return { inkedRows, maxLineLen };
}
console.log("OLD render stats:", stats(oOld));
console.log("NEW render stats:", stats(oNew));
