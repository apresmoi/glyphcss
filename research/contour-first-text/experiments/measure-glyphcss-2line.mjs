import { readFileSync } from "fs";
import { parseFont } from "../../../packages/fonts/src/parseFont.ts";
import { composeText } from "../../../packages/fonts/src/composeText.ts";

const buf = readFileSync(new URL("../../../packages/fonts/test/fixtures/Roboto-Bold.ttf", import.meta.url));
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const font = parseFont(ab);
const polys = composeText(font, "Glyph\nCSS", { size: 100, depth: 26, profile: { edge: "bevel" }, lineHeight: 1.15 });

let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity,minZ=Infinity,maxZ=-Infinity;
for (const p of polys) for (const [x,y,z] of p.vertices) {
  if (x<minX) minX=x; if (x>maxX) maxX=x;
  if (y<minY) minY=y; if (y>maxY) maxY=y;
  if (z<minZ) minZ=z; if (z>maxZ) maxZ=z;
}
console.log("Glyph\\nCSS mesh bbox:");
console.log(`  X (depth):  ${(maxX-minX).toFixed(2)}`);
console.log(`  Y (width):  ${(maxY-minY).toFixed(2)}`);
console.log(`  Z (height): ${(maxZ-minZ).toFixed(2)}`);
console.log("polys:", polys.length);
