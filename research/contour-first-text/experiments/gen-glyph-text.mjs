import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { parseFont, textPolygons } from "../../../packages/fonts/dist/index.js";

const buf = readFileSync(resolve(process.cwd(), "packages/fonts/test/fixtures/Roboto-Bold.ttf"));
const font = parseFont(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const polys = textPolygons(font, "GLYPH", { depth: 30, profile: "flat" });
writeFileSync(resolve(process.cwd(), "research/contour-first-text/experiments/glyph-text.json"), JSON.stringify(polys));
console.log("wrote", polys.length, "polygons");
