#!/usr/bin/env node
/**
 * Compare lossy mesh optimization strategies on a small gallery corpus.
 *
 * "Pair-only" is the isolated-pair approximation path. Current lossy evaluates
 * the public automatic chooser.
 *
 * Usage:
 *   node bench/lossy-optimizer-bench.mjs
 *   node bench/lossy-optimizer-bench.mjs --models ducky,shark
 *   node bench/lossy-optimizer-bench.mjs --json bench/results/lossy-optimizer.json
 */
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import {
  bakeSolidTextureSamples,
  optimizeMeshPolygons,
  parseGltf,
  parseMtl,
  parseObj,
  parseVox,
} from "../packages/core/dist/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const requireFromWebsite = createRequire(resolve(repoRoot, "website/package.json"));

const MODELS = [
  { id: "elephant", label: "Elephant", path: "website/public/gallery/glb/Elephant.glb" },
  { id: "dog", label: "Dog", path: "website/public/gallery/glb/Dog.glb" },
  { id: "ducky", label: "Ducky", path: "website/public/gallery/glb/poly-pizza/ducky.glb" },
  { id: "duck", label: "Duck", path: "website/public/gallery/glb/Duck.glb" },
  { id: "fish-animated", label: "FishAnimated", path: "website/public/gallery/glb/FishAnimated.glb" },
  { id: "mushnub-animated", label: "AnimatedMushnub", path: "website/public/gallery/glb/AnimatedMushnub.glb" },
  { id: "animated-fox", label: "AnimatedFox", path: "website/public/gallery/glb/khronos/animated-fox.glb" },
  { id: "shark", label: "Shark", path: "website/public/gallery/glb/Shark.glb" },
  { id: "cactus-a", label: "Cactus A", path: "website/public/gallery/glb/poly-pizza/cactus-a.glb" },
  { id: "glass", label: "Glass", path: "website/public/gallery/glb/poly-pizza/glass.glb" },
  { id: "electric-guitar", label: "ElectricGuitar", path: "website/public/gallery/glb/Electricguitar.glb" },
  { id: "dinosaur", label: "Dinosaur", path: "website/public/gallery/glb/Dinosaur.glb" },
  { id: "gorilla", label: "Gorilla", path: "website/public/gallery/glb/Gorilla.glb" },
  { id: "hippo", label: "Hippo", path: "website/public/gallery/glb/Hippo.glb" },
  { id: "dragon", label: "Dragon", path: "website/public/gallery/glb/Dragon.glb" },
  { id: "lobster", label: "Lobster", path: "website/public/gallery/glb/Lobster.glb" },
  { id: "octopus", label: "Octopus", path: "website/public/gallery/glb/Octopus.glb" },
  { id: "rat", label: "Rat", path: "website/public/gallery/glb/Rat.glb" },
  { id: "dump-truck", label: "DumpTruck", path: "website/public/gallery/glb/Dump truck.glb" },
  { id: "policecar", label: "Policecar", path: "website/public/gallery/glb/Policecar.glb" },
  { id: "violin", label: "Violin", path: "website/public/gallery/glb/Violin.glb" },
  { id: "animated-snake", label: "AnimatedSnake", path: "website/public/gallery/glb/AnimatedSnake.glb" },
  { id: "animated-wizard", label: "AnimatedWizard", path: "website/public/gallery/glb/AnimatedWizard.glb" },
  { id: "zebra", label: "Zebra", path: "website/public/gallery/glb/Zebra.glb" },
  { id: "bear", label: "Bear", path: "website/public/gallery/glb/Bear.glb" },
  { id: "horse", label: "Horse", path: "website/public/gallery/glb/Horse.glb" },
  { id: "cheetah", label: "Cheetah", path: "website/public/gallery/glb/Cheetah.glb" },
  { id: "bicycle", label: "Bicycle", path: "website/public/gallery/glb/Bicycle.glb" },
];

const DEFAULT_LOSSY_APPROXIMATE = {
  maxAngleDeg: 15,
  maxPlaneDisplacement: 0.35,
  maxBoundaryDisplacement: 0.075,
};
const GAP_DETECTION_TOLERANCE = 0.2;

const argv = process.argv.slice(2);
const flag = (name) => argv.indexOf(`--${name}`);
const hasFlag = (name) => flag(name) >= 0;
const optStr = (name, dflt = "") => {
  const i = flag(name);
  return i >= 0 ? argv[i + 1] : dflt;
};

if (hasFlag("help")) {
  console.log(`Usage: node bench/lossy-optimizer-bench.mjs [--models ids] [--json file]

Options:
  --models <ids>  Comma-separated model ids or labels to run.
  --json <file>    Write the full result rows as JSON.
`);
  process.exit(0);
}

function selectedModels() {
  const filter = optStr("models").trim();
  if (!filter) return MODELS;

  const requested = new Set(filter.split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean));
  const selected = MODELS.filter((model) =>
    requested.has(model.id.toLowerCase()) ||
    requested.has(model.label.toLowerCase()) ||
    requested.has(model.label.toLowerCase().replace(/\s+/g, "-"))
  );
  if (selected.length === 0) {
    throw new Error(`No models matched --models ${filter}`);
  }
  return selected;
}

function readBytes(path) {
  const bytes = readFileSync(path);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

let textureSamplingEnvReady = false;
let textureSamplingEnvUnavailable = false;

function installTextureSamplingEnv() {
  if (textureSamplingEnvReady) return true;
  if (textureSamplingEnvUnavailable) return false;

  let sharp;
  try {
    sharp = requireFromWebsite("sharp");
  } catch {
    textureSamplingEnvUnavailable = true;
    return false;
  }

  class BenchImage {
    onload = null;
    onerror = null;
    decoding = "async";
    width = 0;
    height = 0;
    naturalWidth = 0;
    naturalHeight = 0;
    data = null;
    #src = "";
    #decodePromise = null;

    set src(value) {
      this.#src = value;
      this.#decodePromise = (async () => {
        const input = await readImageBytes(value);
        const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        this.width = this.naturalWidth = info.width;
        this.height = this.naturalHeight = info.height;
        this.data = data;
        this.onload?.();
      })().catch((error) => {
        this.onerror?.();
        throw error;
      });
    }

    get src() {
      return this.#src;
    }

    decode() {
      return this.#decodePromise ?? Promise.resolve();
    }
  }

  class BenchCanvas {
    width = 0;
    height = 0;
    image = null;

    getContext() {
      return {
        drawImage: (image) => {
          this.image = image;
        },
        getImageData: () => ({
          data: this.image?.data ?? new Uint8ClampedArray(this.width * this.height * 4),
        }),
      };
    }
  }

  globalThis.Image = BenchImage;
  globalThis.document = {
    createElement: (tagName) => tagName === "canvas" ? new BenchCanvas() : {},
  };
  textureSamplingEnvReady = true;
  return true;
}

async function readImageBytes(url) {
  if (/^(blob:|data:|https?:)/.test(url)) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`image fetch failed: ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  }
  return readFileSync(url.startsWith("file://") ? fileURLToPath(url) : url);
}

async function applyGalleryTexturePrepass(result) {
  if (!installTextureSamplingEnv()) return result;
  return bakeSolidTextureSamples(result);
}

async function parseModel(model) {
  const modelPath = resolve(repoRoot, model.path);
  if (!existsSync(modelPath)) throw new Error(`Model not found: ${model.path}`);

  const ext = extname(modelPath).toLowerCase();
  if (ext === ".glb" || ext === ".gltf") {
    return applyGalleryTexturePrepass(parseGltf(readBytes(modelPath), {
      baseUrl: modelPath,
      resolveBuffer: (uri) => readFileSync(resolve(dirname(modelPath), uri)),
    }));
  }

  if (ext === ".obj") {
    let objOptions = undefined;
    if (model.mtl) {
      const mtlPath = resolve(repoRoot, model.mtl);
      const { colors, textures } = parseMtl(readFileSync(mtlPath, "utf8"));
      objOptions = {
        materialColors: colors,
        materialTextures: Object.fromEntries(
          Object.entries(textures).map(([name, texture]) => [name, resolve(dirname(mtlPath), texture)]),
        ),
      };
    }
    return applyGalleryTexturePrepass(parseObj(readFileSync(modelPath, "utf8"), objOptions));
  }

  if (ext === ".vox") return parseVox(readBytes(modelPath));

  throw new Error(`Unsupported model extension "${ext}" for ${model.path}`);
}

function pairOnlyLossyOptions() {
  return {
    meshResolution: "lossy",
    approximateMerge: { ...DEFAULT_LOSSY_APPROXIMATE, isolatedPairs: true },
  };
}

function groupedLossyOptions() {
  return {
    meshResolution: "lossy",
    approximateMerge: { ...DEFAULT_LOSSY_APPROXIMATE, isolatedPairs: false },
  };
}

function timed(fn) {
  const start = performance.now();
  const value = fn();
  return { value, ms: performance.now() - start };
}

function polygonRenderCost(polygons) {
  let cost = 0;
  for (const polygon of polygons) {
    const vertexCount = polygon.vertices.length;
    const irregularPenalty = vertexCount <= 4 ? 0 : Math.min(4, vertexCount - 4) * 0.12;
    const texturePenalty = polygon.texture || polygon.material?.texture || polygon.textureTriangles?.length ? 0.15 : 0;
    cost += 1 + irregularPenalty + texturePenalty;
  }
  return cost;
}

function polygonStats(polygons) {
  let totalVertices = 0;
  let maxVertices = 0;
  let triangles = 0;
  let textured = 0;
  const solidColors = new Set();
  for (const polygon of polygons) {
    totalVertices += polygon.vertices.length;
    maxVertices = Math.max(maxVertices, polygon.vertices.length);
    if (polygon.vertices.length === 3) triangles += 1;
    if (polygon.texture || polygon.material?.texture || polygon.textureTriangles?.length) {
      textured += 1;
    } else {
      solidColors.add(polygon.color ?? "#cccccc");
    }
  }
  return {
    count: polygons.length,
    renderCost: Number(polygonRenderCost(polygons).toFixed(2)),
    triangles,
    textured,
    solidColorCount: solidColors.size,
    totalVertices,
    maxVertices,
  };
}

function vertexKey(vertex) {
  return `${vertex[0]},${vertex[1]},${vertex[2]}`;
}

function edgeKey(a, b) {
  const ak = vertexKey(a);
  const bk = vertexKey(b);
  return ak < bk ? `${ak}|${bk}` : `${bk}|${ak}`;
}

function distanceVec(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function collectEdgeStats(polygons) {
  const edges = new Map();
  for (const polygon of polygons) {
    for (let i = 0; i < polygon.vertices.length; i++) {
      const a = polygon.vertices[i];
      const b = polygon.vertices[(i + 1) % polygon.vertices.length];
      const key = edgeKey(a, b);
      const current = edges.get(key);
      if (current) current.count += 1;
      else edges.set(key, { count: 1, a, b });
    }
  }

  const boundaryKeys = new Set();
  const internalKeys = new Set();
  const boundarySegments = [];
  const internalSegments = [];
  let boundaryLength = 0;
  for (const [key, edge] of edges) {
    const segment = { a: edge.a, b: edge.b };
    if (edge.count === 1) {
      boundaryKeys.add(key);
      boundarySegments.push(segment);
      boundaryLength += distanceVec(segment.a, segment.b);
    } else {
      internalKeys.add(key);
      internalSegments.push(segment);
    }
  }
  return { boundaryKeys, internalKeys, boundarySegments, internalSegments, boundaryLength };
}

function segmentCell(segment, cellSize) {
  return [
    Math.floor(((segment.a[0] + segment.b[0]) / 2) / cellSize),
    Math.floor(((segment.a[1] + segment.b[1]) / 2) / cellSize),
    Math.floor(((segment.a[2] + segment.b[2]) / 2) / cellSize),
  ];
}

function cellKey(x, y, z) {
  return `${x},${y},${z}`;
}

function buildSegmentIndex(segments, tolerance) {
  const cellSize = Math.max(tolerance * 2, 1e-6);
  const cells = new Map();
  for (const segment of segments) {
    const [cx, cy, cz] = segmentCell(segment, cellSize);
    const key = cellKey(cx, cy, cz);
    const bucket = cells.get(key);
    if (bucket) bucket.push(segment);
    else cells.set(key, [segment]);
  }
  return { cellSize, cells };
}

function segmentEndpointGap(a, b) {
  return Math.min(
    Math.max(distanceVec(a.a, b.a), distanceVec(a.b, b.b)),
    Math.max(distanceVec(a.a, b.b), distanceVec(a.b, b.a)),
  );
}

function indexedInternalEdgeGap(segment, index, tolerance) {
  const [cx, cy, cz] = segmentCell(segment, index.cellSize);
  let best = null;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dz = -1; dz <= 1; dz++) {
        const bucket = index.cells.get(cellKey(cx + dx, cy + dy, cz + dz));
        if (!bucket) continue;
        for (const candidate of bucket) {
          const gap = segmentEndpointGap(segment, candidate);
          if (gap <= tolerance) best = best === null ? gap : Math.min(best, gap);
        }
      }
    }
  }
  return best;
}

function gapMetrics(sourcePolygons, candidatePolygons) {
  const sourceEdges = collectEdgeStats(sourcePolygons);
  const candidateEdges = collectEdgeStats(candidatePolygons);
  const internalIndex = buildSegmentIndex(sourceEdges.internalSegments, GAP_DETECTION_TOLERANCE);
  const metrics = {
    maxGap: 0,
    internalBoundaryLength: 0,
    excessBoundaryLength: Math.max(0, candidateEdges.boundaryLength - sourceEdges.boundaryLength),
  };

  for (const edge of candidateEdges.boundarySegments) {
    const key = edgeKey(edge.a, edge.b);
    if (sourceEdges.boundaryKeys.has(key)) continue;
    if (sourceEdges.internalKeys.has(key)) {
      metrics.internalBoundaryLength += distanceVec(edge.a, edge.b);
      continue;
    }
    const gap = indexedInternalEdgeGap(edge, internalIndex, GAP_DETECTION_TOLERANCE);
    if (gap !== null) {
      metrics.maxGap = Math.max(metrics.maxGap, gap);
      metrics.internalBoundaryLength += distanceVec(edge.a, edge.b);
    }
  }
  return {
    maxGap: Number(metrics.maxGap.toFixed(4)),
    internalBoundaryLength: Number(metrics.internalBoundaryLength.toFixed(2)),
    excessBoundaryLength: Number(metrics.excessBoundaryLength.toFixed(2)),
  };
}

function choiceFor(current, pairOnly, grouped, lossless) {
  const currentCost = polygonRenderCost(current);
  const candidates = [
    ["pair", polygonRenderCost(pairOnly)],
    ["groups", polygonRenderCost(grouped)],
    ["lossless", polygonRenderCost(lossless)],
  ];
  const match = candidates.find(([, cost]) => Math.abs(cost - currentCost) < 1e-9);
  return match?.[0] ?? "auto";
}

function pctDrop(after, before) {
  return before > 0 ? Number((((before - after) / before) * 100).toFixed(1)) : 0;
}

function pad(value, width) {
  return String(value).padStart(width, " ");
}

async function timedAsync(fn) {
  const start = performance.now();
  const value = await fn();
  return { value, ms: performance.now() - start };
}

async function summarizeModel(model) {
  const parsed = await timedAsync(() => parseModel(model));
  const raw = parsed.value.polygons;
  const lossless = timed(() => optimizeMeshPolygons(raw, { meshResolution: "lossless" }));
  const pairOnly = timed(() => optimizeMeshPolygons(raw, pairOnlyLossyOptions()));
  const grouped = timed(() => optimizeMeshPolygons(raw, groupedLossyOptions()));
  const current = timed(() => optimizeMeshPolygons(raw, { meshResolution: "lossy" }));
  const stats = {
    raw: polygonStats(raw),
    lossless: polygonStats(lossless.value),
    pairOnlyLossy: polygonStats(pairOnly.value),
    groupedLossy: polygonStats(grouped.value),
    currentLossy: polygonStats(current.value),
  };

  return {
    id: model.id,
    label: model.label,
    path: model.path,
    raw: stats.raw.count,
    lossless: stats.lossless.count,
    pairOnlyLossy: stats.pairOnlyLossy.count,
    groupedLossy: stats.groupedLossy.count,
    currentLossy: stats.currentLossy.count,
    autoChoice: choiceFor(current.value, pairOnly.value, grouped.value, lossless.value),
    currentVsLosslessPct: pctDrop(current.value.length, lossless.value.length),
    currentVsPairDelta: current.value.length - pairOnly.value.length,
    currentVsPairCostDelta: Number((stats.currentLossy.renderCost - stats.pairOnlyLossy.renderCost).toFixed(2)),
    stats,
    gaps: {
      lossless: gapMetrics(raw, lossless.value),
      pairOnlyLossy: gapMetrics(raw, pairOnly.value),
      groupedLossy: gapMetrics(raw, grouped.value),
      currentLossy: gapMetrics(raw, current.value),
    },
    timingsMs: {
      parse: Number(parsed.ms.toFixed(2)),
      lossless: Number(lossless.ms.toFixed(2)),
      pairOnlyLossy: Number(pairOnly.ms.toFixed(2)),
      groupedLossy: Number(grouped.ms.toFixed(2)),
      currentLossy: Number(current.ms.toFixed(2)),
    },
    warnings: parsed.value.warnings ?? [],
  };
}

const rows = [];
for (const model of selectedModels()) {
  rows.push(await summarizeModel(model));
}

console.log("lossy optimizer benchmark");
console.log("pair-only = forced isolated-pair lossy; groups = forced plane-group lossy; current = automatic lossy chooser");
console.log("texture swatches are baked with the same solidTextureSamples prepass used by loadMesh when sharp is available");
console.log("");
console.log([
  "model".padEnd(17),
  pad("raw", 5),
  pad("lossless", 8),
  pad("pair", 8),
  pad("groups", 8),
  pad("current", 8),
  "choice".padEnd(8),
  pad("vs lossless", 11),
  pad("poly Δ", 7),
  pad("cost Δ", 7),
  pad("verts", 7),
  pad("maxV", 5),
  pad("gap", 7),
  pad("crackL", 8),
  pad("current ms", 10),
].join("  "));
console.log("-".repeat(141));

for (const row of rows) {
  console.log([
    row.label.padEnd(17),
    pad(row.raw, 5),
    pad(row.lossless, 8),
    pad(row.pairOnlyLossy, 8),
    pad(row.groupedLossy, 8),
    pad(row.currentLossy, 8),
    row.autoChoice.padEnd(8),
    pad(`${row.currentVsLosslessPct.toFixed(1)}%`, 11),
    pad(row.currentVsPairDelta, 7),
    pad(row.currentVsPairCostDelta.toFixed(2), 7),
    pad(row.stats.currentLossy.totalVertices, 7),
    pad(row.stats.currentLossy.maxVertices, 5),
    pad(row.gaps.currentLossy.maxGap.toFixed(4), 7),
    pad(row.gaps.currentLossy.internalBoundaryLength.toFixed(2), 8),
    pad(row.timingsMs.currentLossy.toFixed(2), 10),
  ].join("  "));
}

const jsonPath = optStr("json");
if (jsonPath) {
  const outputPath = resolve(repoRoot, jsonPath);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(rows, null, 2)}\n`);
  console.log("");
  console.log(`wrote ${jsonPath}`);
}
