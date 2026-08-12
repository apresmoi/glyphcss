import { readFileSync } from "fs";
import { parseFont } from "../../../packages/fonts/src/parseFont.ts";
import { composeText } from "../../../packages/fonts/src/composeText.ts";
import { compileScene } from "../../../packages/glyphcss/src/index.ts";
import { createGlyphOrthographicCamera } from "../../../packages/glyphcss/src/api/createGlyphCamera.ts";

const buf = readFileSync(new URL("../../../packages/fonts/test/fixtures/Roboto-Bold.ttf", import.meta.url));
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const font = parseFont(ab);
const polys = composeText(font, "Hi", { size: 100, depth: 26, profile: { edge: "bevel" } });

for (const z of [10, 20, 50, 100]) {
  const cam = createGlyphOrthographicCamera({ rotX: 90, rotY: 0, zoom: z });
  const o = compileScene({ polygons: polys, camera: cam, cols: 110, rows: 40, cellAspect: 2, mode: "solid", useColors: false });
  const lines = (o.text ?? o.inner ?? "").split("\n");
  const inkedRows = lines.filter(l => l.trim().length > 0).length;
  const maxLineLen = Math.max(...lines.map(l => l.trimEnd().length));
  console.log(`zoom=${z}: inkedRows=${inkedRows} maxLineLen=${maxLineLen}`);
}
