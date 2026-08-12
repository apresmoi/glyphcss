#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createCanvas, ImageData } from "@napi-rs/canvas";
import {
  buildGlyphControlFrame,
  computeGlyphControlContentSha256,
  computeGlyphControlGeometryHashes,
  createGlyphOrthographicCamera,
  cubePolygons,
  packGlyphControlTensor
} from "glyphcss";
import dictionary from "../config/glyph-object-dictionary.json" with { type: "json" };
import normalization from "../config/control-normalization.json" with { type: "json" };
import { contentSha256, sha256 } from "../src/coarse/retrieval.mjs";

const researchRoot = resolve(new URL("..", import.meta.url).pathname);
const output = resolve(researchRoot, "fixtures/coarse/native-teacher-control");
const cols = 42;
const rows = 24;
const width = 512;
const height = 512;
const camera = { projection: "orthographic", rotX: 63, rotY: 70, zoom: 55 };
const polygons = cubePolygons({ center: [0, 0, 0], size: 2, color: "#e8edf4" });
const hashes = computeGlyphControlGeometryHashes(polygons);
const sceneBase = {
  schemaVersion: "control-scene/v1",
  id: "generative/cube-v1",
  dictionaryId: dictionary.id,
  dictionarySha256: dictionary.contentSha256,
  ...hashes,
  contentSha256: "",
  instances: [{ id: "generative/cube", classId: 1 }],
  surfaces: polygons.map((_, index) => ({ id: `generative/cube/face-${index}`, instanceId: "generative/cube" })),
  polygonSurfaceIds: polygons.map((_, index) => `generative/cube/face-${index}`)
};
const scene = { ...sceneBase, contentSha256: computeGlyphControlContentSha256(sceneBase) };
const frame = buildGlyphControlFrame({
  polygons,
  scene,
  dictionary,
  camera: createGlyphOrthographicCamera(camera),
  grid: { cols, rows, cellAspect: 11 / 6, cellWidth: 6, cellHeight: 11 },
  directionalLight: { direction: [0.4, 0.5, 1], intensity: 0.8, color: "#ffffff" },
  ambientLight: { intensity: 0.2, color: "#ffffff" },
  glyphPalette: " .:-=+*#%@",
  supersample: 2
});
const packed = packGlyphControlTensor(frame, normalization);
const tensorBytes = Buffer.from(packed.keyframe.buffer, packed.keyframe.byteOffset, packed.keyframe.byteLength);
const tensorSha256 = sha256(tensorBytes);

const sourcePixels = new Uint8ClampedArray(cols * rows * 4);
const cells = cols * rows;
for (let cell = 0; cell < cells; cell++) {
  const covered = packed.keyframe[15 * cells + cell] === 1;
  const value = covered ? Math.round((1 - packed.keyframe[5 * cells + cell]) * 255) : 0;
  const pixel = cell * 4;
  sourcePixels[pixel] = value;
  sourcePixels[pixel + 1] = value;
  sourcePixels[pixel + 2] = value;
  sourcePixels[pixel + 3] = 255;
}
const source = createCanvas(cols, rows);
source.getContext("2d").putImageData(new ImageData(sourcePixels, cols, rows), 0, 0);
const target = createCanvas(width, height);
const context = target.getContext("2d");
context.imageSmoothingEnabled = false;
context.drawImage(source, 0, 0, width, height);
const depthBytes = await target.encode("png");
const depthSha256 = sha256(depthBytes);
const request = {
  schemaVersion: "glyph-coarse-base-request/v1",
  prompt: "weathered red clay in a quiet studio",
  seed: 1427,
  styleId: "base",
  controls: {
    geometry: "cube",
    sceneId: scene.id,
    sceneSha256: scene.contentSha256,
    tensorContractSha256: packed.spec.contractSha256,
    coverageRatio: frame.coverage.reduce((sum, value) => sum + Number(Boolean(value)), 0) / frame.coverage.length,
    camera
  }
};
const requestBytes = Buffer.from(`${JSON.stringify(request, null, 2)}\n`);
const manifestBase = {
  schemaVersion: "glyph-coarse-native-control/v1",
  id: "glyphcss/coarse-native-control-cube-divergent-v1",
  contentSha256: "",
  request: { path: "request.json", sha256: sha256(requestBytes) },
  scene: { id: scene.id, contentSha256: scene.contentSha256 },
  tensor: {
    path: "control-keyframe-f32.bin",
    sha256: tensorSha256,
    dtype: "float32-le",
    layout: "NCHW",
    shape: [1, 17, rows, cols],
    contractSha256: packed.spec.contractSha256,
    instanceSha256: packed.spec.instance.contentSha256,
    specSha256: packed.spec.contentSha256
  },
  depthControl: {
    path: "control-depth.png",
    sha256: depthSha256,
    mimeType: "image/png",
    width,
    height,
    sourceGrid: { cols, rows, cellAspect: 11 / 6 },
    scaling: "covered:(1-normalized-camera-depth)*255; empty:0",
    resize: "nearest"
  },
  camera
};
const manifest = { ...manifestBase, contentSha256: contentSha256(manifestBase) };
await mkdir(output, { recursive: true });
await writeFile(resolve(output, "request.json"), requestBytes);
await writeFile(resolve(output, "control-keyframe-f32.bin"), tensorBytes);
await writeFile(resolve(output, "control-depth.png"), depthBytes);
await writeFile(resolve(output, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
