import { readFileSync } from "fs";
import { parseFont } from "../../../packages/fonts/src/parseFont.ts";
import { composeText } from "../../../packages/fonts/src/composeText.ts";
import { compileScene } from "../../../packages/glyphcss/src/index.ts";
import { createGlyphOrthographicCamera } from "../../../packages/glyphcss/src/api/createGlyphCamera.ts";

const buf = readFileSync(new URL("../../../packages/fonts/test/fixtures/Roboto-Bold.ttf", import.meta.url));
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const font = parseFont(ab);

// Matrix Fall preset config (profile flat, depth 10, "a" letter, no effect —
// isolating BASE mesh coverage only).
const polys = composeText(font, "a", {
  size: 100, depth: 10, profile: "flat", letterSpacing: 0, lineHeight: 1.15, align: "center",
  curveSteps: 3, simplify: 3, faces: { front: { color: "#1d6b3a" }, sides: { color: "#0f3a20" }, back: { color: "#0f3a20" } },
});

function centerMesh(ps) {
  let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity,minZ=Infinity,maxZ=-Infinity;
  for (const p of ps) for (const v of p.vertices) {
    if (v[0]<minX) minX=v[0]; if (v[0]>maxX) maxX=v[0];
    if (v[1]<minY) minY=v[1]; if (v[1]>maxY) maxY=v[1];
    if (v[2]<minZ) minZ=v[2]; if (v[2]>maxZ) maxZ=v[2];
  }
  const cx=(minX+maxX)/2, cy=(minY+maxY)/2, cz=(minZ+maxZ)/2;
  return ps.map(p => ({...p, vertices: p.vertices.map(([x,y,z]) => [x-cx,y-cy,z-cz])}));
}
function rotateDeg(ps, [rx,ry,rz]) {
  const D = Math.PI/180, cX=Math.cos(rx*D),sX=Math.sin(rx*D),cY=Math.cos(ry*D),sY=Math.sin(ry*D),cZ=Math.cos(rz*D),sZ=Math.sin(rz*D);
  return ps.map(p => ({...p, vertices: p.vertices.map(([x,y,z]) => {
    let nx=cZ*x-sZ*y, ny=sZ*x+cZ*y, nz=z;
    x=cY*nx+sY*nz; y=ny; z=-sY*nx+cY*nz;
    nx=x; ny=cX*y-sX*z; nz=sX*y+cX*z;
    return [nx,ny,nz];
  })}));
}

const tilted = centerMesh(rotateDeg(centerMesh(polys), [0, 10, 18]));

function frameZoomForGrid(cam, ps, cols, rows, cellAspect, fill=0.95) {
  cam.zoom = 1;
  let minc=Infinity,maxc=-Infinity,minr=Infinity,maxr=-Infinity;
  for (const p of ps) for (const v of p.vertices) {
    const pr = cam.project(v, cols, rows, cellAspect);
    if (!isFinite(pr[0])||!isFinite(pr[1])) continue;
    if (pr[0]<minc) minc=pr[0]; if (pr[0]>maxc) maxc=pr[0];
    if (pr[1]<minr) minr=pr[1]; if (pr[1]>maxr) maxr=pr[1];
  }
  const w=maxc-minc, h=maxr-minr;
  if (!(w>0)||!(h>0)) return 1;
  return Math.min((fill*cols)/w, (fill*rows)/h);
}

const cam1 = createGlyphOrthographicCamera({ rotX: 90, rotY: 0, zoom: 1 });
const meshZoom = frameZoomForGrid(cam1, tilted, 16, 11, 1.45, 0.92);
console.log("mesh.zoom (static-bake fit):", meshZoom);

function inkedBBox(text) {
  const lines = text.split("\n");
  let minRow=Infinity,maxRow=-Infinity,minCol=Infinity,maxCol=-Infinity;
  lines.forEach((line, r) => {
    for (let c = 0; c < line.length; c++) if (line[c] !== " ") {
      if (r<minRow) minRow=r; if (r>maxRow) maxRow=r;
      if (c<minCol) minCol=c; if (c>maxCol) maxCol=c;
    }
  });
  return { minRow, maxRow, minCol, maxCol };
}

for (const [label, z] of [["static (mesh.zoom)", meshZoom], ["live (mesh.zoom*0.62)", meshZoom*0.62]]) {
  const cam = createGlyphOrthographicCamera({ rotX: 90, rotY: 0, zoom: z });
  const o = compileScene({ polygons: tilted, camera: cam, cols: 16, rows: 11, cellAspect: 1.45, mode: "solid", useColors: false,
    directionalLight: { direction: [0.6,0.3,-0.6], intensity: 0.95 }, ambientLight: { intensity: 0.7 } });
  console.log(label, "zoom=" + z.toFixed(3), JSON.stringify(inkedBBox(o.text ?? o.inner)));
}
