#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { contentSha256, sha256 } from "../src/coarse/retrieval.mjs";

const researchRoot = resolve(new URL("..", import.meta.url).pathname);
const capturePath = resolve(researchRoot, "reports/coarse-native-teacher.json");
const controlPath = resolve(researchRoot, "fixtures/coarse/native-teacher-control/control-keyframe-f32.bin");
const basePath = resolve(researchRoot, "review/asset-corpus-b44-easy-preview/Box--c15ee1ca.png");
const artifactPath = resolve(researchRoot, "browser/coarse-refiner-v1.json");
const [captureBytes, controlBytes, capture] = await Promise.all([
  readFile(capturePath),
  readFile(controlPath),
  readFile(capturePath, "utf8").then(JSON.parse),
]);
if (sha256(controlBytes) !== capture.authority.control.tensor.sha256) throw new Error("Native control tensor hash mismatch.");

function fnv1a32(value) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function noise(seed, x, y) {
  let value = (seed ^ Math.imul(x + 1, 0x9e3779b1) ^ Math.imul(y + 1, 0x85ebca77)) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b);
  value ^= value >>> 16;
  return (value >>> 0) / 0xffff_ffff * 2 - 1;
}

function solve(matrix, values) {
  const size = values.length;
  const rows = matrix.map((row, index) => [...row, values[index]]);
  for (let pivot = 0; pivot < size; pivot++) {
    let best = pivot;
    for (let row = pivot + 1; row < size; row++) if (Math.abs(rows[row][pivot]) > Math.abs(rows[best][pivot])) best = row;
    [rows[pivot], rows[best]] = [rows[best], rows[pivot]];
    const divisor = rows[pivot][pivot];
    if (Math.abs(divisor) < 1e-12) throw new Error("Native trajectory regression is singular.");
    for (let column = pivot; column <= size; column++) rows[pivot][column] /= divisor;
    for (let row = 0; row < size; row++) {
      if (row === pivot) continue;
      const factor = rows[row][pivot];
      for (let column = pivot; column <= size; column++) rows[row][column] -= factor * rows[pivot][column];
    }
  }
  return rows.map((row) => row[size]);
}

async function pixels(path, width, height) {
  const image = await loadImage(path);
  const canvas = createCanvas(width, height);
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0, width, height);
  return context.getImageData(0, 0, width, height).data;
}

const width = capture.branches[0].decodedPreview.width;
const height = capture.branches[0].decodedPreview.height;
const maximumCorrection = 48;
const ridge = 1e-3;
const controls = new Float32Array(controlBytes.buffer, controlBytes.byteOffset, controlBytes.byteLength / 4);
const [, channels, controlHeight, controlWidth] = capture.authority.control.tensor.shape;
if (channels !== 17 || controls.length !== channels * controlWidth * controlHeight) throw new Error("Native control shape mismatch.");
const cells = controlWidth * controlHeight;
const planes = [2, 3, 4, 5, 6, 7, 8, 16, 15];
const basePixels = await pixels(basePath, width, height);
const branchPixels = await Promise.all(capture.branches.map((branch) => pixels(
  resolve(researchRoot, "review/coarse-teacher-native", branch.decodedPreview.path),
  width,
  height,
)));
const gram = Array.from({ length: 11 }, () => Array(11).fill(0));
const rhs = Array.from({ length: 3 }, () => Array(11).fill(0));
const promptSeed = fnv1a32(capture.authority.prompt.text);
let sampleCount = 0;
for (let branchIndex = 0; branchIndex < capture.branches.length; branchIndex++) {
  const branch = capture.branches[branchIndex];
  const targetPixels = branchPixels[branchIndex];
  for (let y = 0; y < height; y++) {
    const controlY = Math.min(controlHeight - 1, Math.floor(y / height * controlHeight));
    for (let x = 0; x < width; x++) {
      const controlX = Math.min(controlWidth - 1, Math.floor(x / width * controlWidth));
      const cell = controlY * controlWidth + controlX;
      const features = planes.map((plane) => controls[plane * cells + cell]);
      features.push(noise((branch.seed ^ promptSeed) >>> 0, x, y), 1);
      const coverage = features[8];
      const mask = coverage + (1 - coverage) * 0.12;
      const pixel = (y * width + x) * 4;
      for (let left = 0; left < features.length; left++) {
        for (let right = 0; right < features.length; right++) gram[left][right] += features[left] * features[right];
        for (let channel = 0; channel < 3; channel++) {
          const residual = (targetPixels[pixel + channel] - basePixels[pixel + channel]) / (maximumCorrection * mask);
          const bounded = Math.max(-0.98, Math.min(0.98, residual));
          rhs[channel][left] += features[left] * Math.atanh(bounded);
        }
      }
      sampleCount++;
    }
  }
}
for (let index = 0; index < gram.length; index++) gram[index][index] += ridge;
const solved = rhs.map((channel) => solve(gram.map((row) => [...row]), channel));
const weights = solved.map((channel) => channel.slice(0, 10));
const bias = solved.map((channel) => channel[10]);
const seedNoisePrior = [0.08, -0.07, 0.06];
for (let channel = 0; channel < weights.length; channel++) weights[channel][9] += seedNoisePrior[channel];
let squaredError = 0;
let measurements = 0;
for (let branchIndex = 0; branchIndex < capture.branches.length; branchIndex++) {
  const branch = capture.branches[branchIndex];
  const targetPixels = branchPixels[branchIndex];
  for (let y = 0; y < height; y += 8) {
    const controlY = Math.min(controlHeight - 1, Math.floor(y / height * controlHeight));
    for (let x = 0; x < width; x += 8) {
      const controlX = Math.min(controlWidth - 1, Math.floor(x / width * controlWidth));
      const cell = controlY * controlWidth + controlX;
      const features = planes.map((plane) => controls[plane * cells + cell]);
      features.push(noise((branch.seed ^ promptSeed) >>> 0, x, y));
      const coverage = features[8];
      const mask = coverage + (1 - coverage) * 0.12;
      const pixel = (y * width + x) * 4;
      for (let channel = 0; channel < 3; channel++) {
        const activation = bias[channel] + weights[channel].reduce((sum, weight, index) => sum + weight * features[index], 0);
        const predicted = Math.tanh(activation);
        const target = Math.max(-0.98, Math.min(0.98, (targetPixels[pixel + channel] - basePixels[pixel + channel]) / (maximumCorrection * mask)));
        squaredError += (predicted - target) ** 2;
        measurements++;
      }
    }
  }
}

const oldArtifact = JSON.parse(await readFile(artifactPath, "utf8"));
const artifactBase = {
  ...oldArtifact,
  contentSha256: "",
  disposition: "runnable-native-trajectory-trained-reference",
  weights,
  bias,
  training: {
    performed: true,
    sourceBackend: "native-diffusion-intermediate",
    nativeManifestContentSha256: capture.contentSha256,
    nativeManifestFileSha256: sha256(captureBytes),
    controlTensorSha256: capture.authority.control.tensor.sha256,
    decodedPreviewSha256: capture.branches.map((branch) => branch.decodedPreview.sha256),
    sampleCount,
    solver: "deterministic-ridge-normal-equation-with-seed-prior-v1",
    ridge,
    meanSquaredError: squaredError / measurements,
    command: "node research/ascii-image-generation/scripts/train-coarse-refiner.mjs --check",
    claim: "The 33-parameter browser student is fitted to three actual pinned gpu-4090 native diffusion continuation previews. This is an end-to-end contract demonstration, not a native-reference quality claim.",
  },
};
const artifact = { ...artifactBase, contentSha256: contentSha256(artifactBase) };
if (process.argv.includes("--write")) await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);
if (process.argv.includes("--check")) {
  if (contentSha256(oldArtifact) !== oldArtifact.contentSha256) throw new Error("Refiner artifact content hash mismatch.");
  if (JSON.stringify(oldArtifact) !== JSON.stringify(artifact)) throw new Error("Exported native-trained artifact drift.");
}
process.stdout.write(`${JSON.stringify({
  schemaVersion: "glyph-coarse-refiner-training/v1",
  disposition: artifact.disposition,
  ...artifact.training,
  weights,
  bias,
}, null, 2)}\n`);
