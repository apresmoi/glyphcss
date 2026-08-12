import { readFileSync } from "fs";
import { parseFont } from "../../../packages/fonts/src/parseFont.ts";
import { composeText } from "../../../packages/fonts/src/composeText.ts";
import { compileScene } from "../../../packages/glyphcss/src/index.ts";
import { createGlyphOrthographicCamera } from "../../../packages/glyphcss/src/api/createGlyphCamera.ts";

const buf = readFileSync(new URL("../../../packages/fonts/test/fixtures/Roboto-Bold.ttf", import.meta.url));
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const font = parseFont(ab);
const polys = composeText(font, "Hi", { size: 100, depth: 26, profile: { edge: "bevel" } });
const cam = createGlyphOrthographicCamera({ rotX: 90, rotY: 0, zoom: 20 });
const o = compileScene({ polygons: polys, camera: cam, cols: 110, rows: 40, cellAspect: 2, mode: "solid", useColors: false,
  directionalLight: { direction: [0.6,0.3,-0.6], intensity: 0.95 }, ambientLight: { intensity: 0.7 } });
console.log(o.text ?? o.inner);
