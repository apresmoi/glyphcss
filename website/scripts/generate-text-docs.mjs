import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { composeText, parseFont } from "@glyphcss/fonts";

const asset = new URL("../public/data/docs-text.json", import.meta.url);

export async function textDocsAsset() {
  const font = parseFont(await readFile(new URL("../public/fonts/default.ttf", import.meta.url)));
  const polygons = composeText(font, "Hello", {
    depth: 30,
    profile: { edge: "bevel", segments: 3 },
    warp: { shape: "wave", amount: 0.35 },
    faces: { front: { color: "#38bdf8" }, sides: { color: "#0e5a7e" }, back: { color: "#0e5a7e" } },
  });
  const vertices = [];
  const colors = [];
  const vertexIndices = new Map();
  const colorIndices = new Map();
  const faces = polygons.map((polygon) => {
    const v = polygon.vertices.map((vertex) => {
      // Match the landing mesh's precision: extra decimals only enlarge the download.
      const point = vertex.map((value) => Math.round(value * 1e4) / 1e4);
      const key = JSON.stringify(point);
      if (!vertexIndices.has(key)) {
        vertexIndices.set(key, vertices.length);
        vertices.push(point);
      }
      return vertexIndices.get(key);
    });
    if (!colorIndices.has(polygon.color)) {
      colorIndices.set(polygon.color, colors.length);
      colors.push(polygon.color);
    }
    return { v, c: colorIndices.get(polygon.color) };
  });
  return { vertices, colors, faces };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const data = await textDocsAsset();
  const json = JSON.stringify(data);
  await writeFile(asset, json + "\n");
  console.log(`docs-text.json: ${data.faces.length} faces, ${data.vertices.length} vertices, ${json.length} bytes`);
}
