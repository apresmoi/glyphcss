import { readFileSync } from "fs";
import { parseFont } from "../../../packages/fonts/src/parseFont.ts";
import { composeText } from "../../../packages/fonts/src/composeText.ts";

const buf = readFileSync(new URL("../../../packages/fonts/test/fixtures/Roboto-Bold.ttf", import.meta.url));
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const font = parseFont(ab);
const polys = composeText(font, "Hi", { size: 100, depth: 26, profile: { edge: "bevel" } });

function fitWordArtZoom(polygons, stageW, stageH, scaleX = 1, scaleY = 1) {
  let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity,minZ=Infinity,maxZ=-Infinity;
  for (const p of polygons) for (const v of p.vertices) {
    if (v[0]<minX) minX=v[0]; if (v[0]>maxX) maxX=v[0];
    if (v[1]<minY) minY=v[1]; if (v[1]>maxY) maxY=v[1];
    if (v[2]<minZ) minZ=v[2]; if (v[2]>maxZ) maxZ=v[2];
  }
  const horizontal = Math.max((maxY-minY)*scaleX, maxX-minX);
  const vertical = (maxZ-minZ)*scaleY;
  const fitW = (stageW*0.7)/Math.max(horizontal,1);
  const fitH = (stageH*0.68)/Math.max(vertical,1);
  console.log({ horizontal, vertical, fitW, fitH });
  return Math.max(0.5, Math.min(10, Math.min(fitW, fitH)));
}

console.log("zoom:", fitWordArtZoom(polys, 1059, 646, 1, 1));
