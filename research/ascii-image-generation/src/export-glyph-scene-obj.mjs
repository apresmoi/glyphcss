/**
 * Export the authored cabin scene as an OBJ/MTL pair for upstream SyncMVD.
 *
 * The scene is loaded from render-glyph-scene.mjs, so every `vt` record comes
 * directly from the UV coordinates used to produce glyphcss control maps.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadGlyphScene } from "./render-glyph-scene.mjs";

const root = resolve(import.meta.dirname, "..");
const DEFAULT_OUT_ROOT = "reports/glyph-scenes";
const colorRgb = (color) => [
  Number.parseInt(color.slice(1, 3), 16) / 255,
  Number.parseInt(color.slice(3, 5), 16) / 255,
  Number.parseInt(color.slice(5, 7), 16) / 255,
];
const materialName = (color) => `glyph_${color.slice(1).toLowerCase()}`;
const formatNumber = (value) => Number(value).toString();
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

function validateFaceTokens(face, vertexCount, uvCount) {
  if (face.length < 3) throw new Error("GLYPH_OBJ_FACE_HAS_FEWER_THAN_THREE_VERTICES");
  for (const token of face) {
    const match = /^(\d+)\/(\d+)$/.exec(token);
    if (!match) throw new Error(`GLYPH_OBJ_FACE_MISSING_VERTEX_UV_REFERENCE:${token}`);
    const vertex = Number(match[1]), uv = Number(match[2]);
    if (vertex < 1 || vertex > vertexCount || uv < 1 || uv > uvCount) {
      throw new Error(`GLYPH_OBJ_FACE_INDEX_OUT_OF_RANGE:${token}`);
    }
  }
}

/** Re-read a written OBJ and prove every face corner references a valid `vt`. */
export async function verifyGlyphSceneObj(objPath, expectedUvs) {
  const text = await readFile(objPath, "utf8");
  let vertexCount = 0, uvCount = 0, faceCount = 0, faceCornerCount = 0;
  const parsedUvs = [];
  for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
    if (line.startsWith("v ")) vertexCount++;
    else if (line.startsWith("vt ")) {
      const fields = line.trim().split(/\s+/);
      if (fields.length !== 3 || !Number.isFinite(Number(fields[1])) || !Number.isFinite(Number(fields[2]))) {
        throw new Error(`GLYPH_OBJ_INVALID_VT:${line}`);
      }
      uvCount++;
      parsedUvs.push([Number(fields[1]), Number(fields[2])]);
    } else if (line.startsWith("f ")) {
      const face = line.trim().split(/\s+/).slice(1);
      validateFaceTokens(face, vertexCount, uvCount);
      faceCount++;
      faceCornerCount += face.length;
    }
  }
  if (uvCount !== expectedUvs.length) throw new Error(`GLYPH_OBJ_VT_COUNT_MISMATCH:${uvCount}:${expectedUvs.length}`);
  if (faceCornerCount !== expectedUvs.length) throw new Error(`GLYPH_OBJ_FACE_CORNER_COUNT_MISMATCH:${faceCornerCount}:${expectedUvs.length}`);
  for (let index = 0; index < expectedUvs.length; index++) {
    if (parsedUvs[index][0] !== expectedUvs[index][0] || parsedUvs[index][1] !== expectedUvs[index][1]) {
      throw new Error(`GLYPH_OBJ_VT_DOES_NOT_MATCH_AUTHORED_UV:${index}`);
    }
  }
  return { vertexCount, vtCount: uvCount, faceCount, faceCornerCount, everyFaceReferencesVt: true, authoredUvsMatchExactly: true };
}

export async function exportGlyphSceneObj({
  scenePath,
  sceneKey = "cabin",
  outRoot = DEFAULT_OUT_ROOT,
} = {}) {
  const { polygons, atlasLayout } = await loadGlyphScene({ scenePath, sceneKey });
  const output = outRoot === DEFAULT_OUT_ROOT ? resolve(root, outRoot) : resolve(outRoot);
  const outputDirectory = join(output, sceneKey, "syncmvd");
  const objPath = join(outputDirectory, `${sceneKey}.obj`);
  const mtlPath = join(outputDirectory, `${sceneKey}.mtl`);
  const materials = [...new Set(polygons.map((polygon) => polygon.color))].sort();
  const mtl = materials.map((color) => {
    const [r, g, b] = colorRgb(color).map(formatNumber);
    return [`newmtl ${materialName(color)}`, "Ka 0 0 0", `Kd ${r} ${g} ${b}`, "Ks 0 0 0", "d 1", "illum 1", ""].join("\n");
  }).join("\n");
  const obj = [`# Authored glyph scene: ${sceneKey}`, `mtllib ${basename(mtlPath)}`, "o glyph_scene"];
  const authoredUvs = [];
  let vertexIndex = 1, uvIndex = 1, previousMaterial = null;
  for (const polygon of polygons) {
    const material = materialName(polygon.color);
    if (material !== previousMaterial) obj.push(`usemtl ${material}`);
    previousMaterial = material;
    const firstVertex = vertexIndex, firstUv = uvIndex;
    for (const [x, y, z] of polygon.vertices) obj.push(`v ${formatNumber(x)} ${formatNumber(y)} ${formatNumber(z)}`);
    for (const [u, v] of polygon.uvs) {
      obj.push(`vt ${formatNumber(u)} ${formatNumber(v)}`);
      authoredUvs.push([u, v]);
    }
    obj.push(`f ${polygon.vertices.map((_, corner) => `${firstVertex + corner}/${firstUv + corner}`).join(" ")}`);
    vertexIndex += polygon.vertices.length;
    uvIndex += polygon.uvs.length;
  }
  await mkdir(outputDirectory, { recursive: true });
  await Promise.all([writeFile(objPath, `${obj.join("\n")}\n`), writeFile(mtlPath, `${mtl}\n`)]);
  const verification = await verifyGlyphSceneObj(objPath, authoredUvs);
  const manifestPath = join(outputDirectory, "export-manifest.json");
  await writeFile(manifestPath, json({
    schemaVersion: "glyph-authored-obj-export/v1", sceneKey,
    obj: basename(objPath), mtl: basename(mtlPath), polygonCount: polygons.length,
    materialCount: materials.length,
    atlas: { schemaVersion: atlasLayout.schemaVersion, vConvention: atlasLayout.vConvention, faceToCell: atlasLayout.faceToCell },
    verification,
  }));
  return { objPath, mtlPath, manifestPath, polygonCount: polygons.length, materialCount: materials.length, verification };
}

function parseArgs() {
  const values = process.argv.slice(2);
  const value = (flag) => {
    const index = values.indexOf(flag);
    if (index < 0) return undefined;
    if (!values[index + 1]) throw new Error(`GLYPH_OBJ_${flag.slice(2).replaceAll("-", "_").toUpperCase()}_REQUIRED`);
    return values[index + 1];
  };
  return { scenePath: value("--scene"), outRoot: value("--out-root"), sceneKey: value("--scene-key") };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.stdout.write(json(await exportGlyphSceneObj(parseArgs())));
}
