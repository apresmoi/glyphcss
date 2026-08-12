import { readFileSync } from "fs";
import { parseFont } from "../../../packages/fonts/src/parseFont.ts";
import { composeText } from "../../../packages/fonts/src/composeText.ts";
import { compileScene } from "../../../packages/glyphcss/src/index.ts";
import { createGlyphOrthographicCamera } from "../../../packages/glyphcss/src/api/createGlyphCamera.ts";

const buf = readFileSync(new URL("../../../packages/fonts/test/fixtures/Roboto-Bold.ttf", import.meta.url));
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const font = parseFont(ab);
const polys = composeText(font, "Hi", { size: 100, depth: 26, profile: { edge: "bevel" } });

let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity,minZ=Infinity,maxZ=-Infinity;
for (const p of polys) for (const [x,y,z] of p.vertices) {
  if (x<minX) minX=x; if (x>maxX) maxX=x;
  if (y<minY) minY=y; if (y>maxY) maxY=y;
  if (z<minZ) minZ=z; if (z>maxZ) maxZ=z;
}
console.log("bbox X", maxX-minX, "Y", maxY-minY, "Z", maxZ-minZ);

const camera = createGlyphOrthographicCamera({ rotX: 90, rotY: 0, zoom: 3 });
const out = compileScene({
  polygons: polys, camera, cols: 60, rows: 30, cellAspect: 2, mode: "solid",
  useColors: false, directionalLight: { direction: [0,0,1], intensity: 1 }, ambientLight: { intensity: 0.6 },
});
console.log(out.text ?? out);

// Try at the ACTUAL live grid size (110x40) with a range of zoom values to find
// what zoom actually reproduces a sane render, and compare to fitWordArtZoom's heuristic.
for (const z of [0.5, 1, 2, 3, 5]) {
  const cam = createGlyphOrthographicCamera({ rotX: 90, rotY: 0, zoom: z });
  const o = compileScene({ polygons: polys, camera: cam, cols: 110, rows: 40, cellAspect: 2, mode: "solid", useColors: false });
  const lines = (o.text ?? o.inner ?? "").split("\n");
  const inkedRows = lines.filter(l => l.trim().length > 0).length;
  const maxLineLen = Math.max(...lines.map(l => l.trimEnd().length));
  console.log(`zoom=${z}: inkedRows=${inkedRows} maxLineLen=${maxLineLen}`);
}
