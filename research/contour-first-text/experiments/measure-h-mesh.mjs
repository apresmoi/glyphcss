import { readFileSync } from "fs";
import { parseFont } from "../../../packages/fonts/src/parseFont.ts";
import { composeText } from "../../../packages/fonts/src/composeText.ts";

const buf = readFileSync(new URL("../../../packages/fonts/test/fixtures/Roboto-Bold.ttf", import.meta.url));
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const font = parseFont(ab);
const polys = composeText(font, "H", { size: 100, depth: 40 });

let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity,minZ=Infinity,maxZ=-Infinity;
for (const p of polys) for (const [x,y,z] of p.vertices) {
  if (x<minX) minX=x; if (x>maxX) maxX=x;
  if (y<minY) minY=y; if (y>maxY) maxY=y;
  if (z<minZ) minZ=z; if (z>maxZ) maxZ=z;
}
console.log("H mesh bbox, size=100, depth=40:");
console.log(`  X (depth):  ${(maxX-minX).toFixed(2)}  [${minX.toFixed(2)}, ${maxX.toFixed(2)}]`);
console.log(`  Y (width):  ${(maxY-minY).toFixed(2)}  [${minY.toFixed(2)}, ${maxY.toFixed(2)}]`);
console.log(`  Z (height): ${(maxZ-minZ).toFixed(2)}  [${minZ.toFixed(2)}, ${maxZ.toFixed(2)}]`);
