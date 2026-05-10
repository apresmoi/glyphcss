#!/usr/bin/env node
/**
 * Report how close adjacent same-material triangle pairs are to being coplanar.
 *
 * Usage:
 *   node bench/coplanar-tolerance-report.mjs website/public/gallery/glb/Dog.glb
 *   node bench/coplanar-tolerance-report.mjs website/public/gallery/obj/chicken.obj --mtl website/public/gallery/obj/chicken.mtl
 *   node bench/coplanar-tolerance-report.mjs website/public/gallery/vox/dog.vox --json /tmp/dog-coplanar.json
 *
 * The report measures the culled, pre-merge triangle surface by default. That is
 * the useful point for approximate simplification: strict merge has not hidden
 * the rejected split quads yet, but fully interior triangles are out of the way.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  cullInteriorPolygons,
  mergePolygons,
  parseGltf,
  parseMtl,
  parseObj,
  parseVox,
} from "../packages/core/dist/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

const argv = process.argv.slice(2);
const flag = (name) => argv.indexOf(`--${name}`);
const hasFlag = (name) => flag(name) >= 0;
const optStr = (name, dflt = "") => {
  const i = flag(name);
  return i >= 0 ? argv[i + 1] : dflt;
};
const optList = (name, dflt) => {
  const raw = optStr(name);
  return raw ? raw.split(",").map(Number).filter(Number.isFinite) : dflt;
};

const inputArg = argv.find((arg) => !arg.startsWith("--"));
if (!inputArg || hasFlag("help")) {
  console.log(`Usage: node bench/coplanar-tolerance-report.mjs <model> [--mtl file] [--raw] [--json file]

Options:
  --mtl <file>          Companion MTL for OBJ color matching.
  --raw                 Analyze raw parsed polygons instead of interior-culled polygons.
  --json <file>         Write the full report as JSON.
  --top <n>             Print the n least-coplanar examples. Default: 8.
  --angles <list>       Comma-separated angle thresholds in degrees.
  --distances <list>    Comma-separated best-fit plane distance thresholds in scene units.
`);
  process.exit(inputArg ? 0 : 1);
}

const modelPath = resolve(repoRoot, inputArg);
const mtlPath = optStr("mtl") ? resolve(repoRoot, optStr("mtl")) : "";
const jsonPath = optStr("json") ? resolve(repoRoot, optStr("json")) : "";
const topCount = Number(optStr("top", "8"));
const angleThresholds = optList("angles", [0.5, 1, 2, 5, 10, 15, 20, 30]);
const distanceThresholds = optList("distances", [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1]);

if (!existsSync(modelPath)) throw new Error(`Model not found: ${modelPath}`);
if (mtlPath && !existsSync(mtlPath)) throw new Error(`MTL not found: ${mtlPath}`);

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const length = (v) => Math.hypot(v[0], v[1], v[2]);
const scale = (v, n) => [v[0] * n, v[1] * n, v[2] * n];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const normalize = (v) => {
  const len = length(v);
  return len > 1e-12 ? scale(v, 1 / len) : null;
};
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const pct = (n, total) => total > 0 ? `${((n / total) * 100).toFixed(1)}%` : "0.0%";
const fmt = (n, digits = 4) => Number.isFinite(n) ? n.toFixed(digits) : "n/a";
const vecKey = (v) => `${v[0]},${v[1]},${v[2]}`;
const edgeKey = (a, b) => {
  const ak = vecKey(a);
  const bk = vecKey(b);
  return ak < bk ? `${ak}|${bk}` : `${bk}|${ak}`;
};

function parseModel(path) {
  const ext = extname(path).toLowerCase();
  if (ext === ".glb" || ext === ".gltf") {
    const bytes = readFileSync(path);
    return parseGltf(bytes, {
      baseUrl: path,
      resolveBuffer: (uri) => readFileSync(resolve(dirname(path), uri)),
    });
  }
  if (ext === ".obj") {
    let objOptions = undefined;
    if (mtlPath) {
      const { colors, textures } = parseMtl(readFileSync(mtlPath, "utf8"));
      objOptions = {
        materialColors: colors,
        materialTextures: Object.fromEntries(
          Object.entries(textures).map(([name, texture]) => [name, resolve(dirname(mtlPath), texture)]),
        ),
      };
    }
    return parseObj(readFileSync(path, "utf8"), objOptions);
  }
  if (ext === ".vox") {
    const bytes = readFileSync(path);
    return parseVox(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  }
  throw new Error(`Unsupported model extension "${ext}". Use .glb, .gltf, .obj, or .vox.`);
}

function materialKey(polygon) {
  const data = polygon.data
    ? Object.keys(polygon.data).sort().map((key) => `${key}:${String(polygon.data[key])}`).join("|")
    : "";
  return [
    polygon.color ?? "#cccccc",
    polygon.texture ?? "",
    polygon.uvs ? "uv" : "plain",
    data,
  ].join("|");
}

function planeOf(polygon) {
  const vertices = polygon.vertices;
  if (!vertices || vertices.length < 3) return null;
  const origin = vertices[0];
  let normalSum = [0, 0, 0];
  for (let i = 1; i < vertices.length - 1; i++) {
    normalSum = add(normalSum, cross(sub(vertices[i], origin), sub(vertices[i + 1], origin)));
  }
  const normal = normalize(normalSum);
  return normal ? { normal, d: dot(normal, origin) } : null;
}

function bboxOf(polygons) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const polygon of polygons) {
    for (const vertex of polygon.vertices ?? []) {
      for (let axis = 0; axis < 3; axis++) {
        min[axis] = Math.min(min[axis], vertex[axis]);
        max[axis] = Math.max(max[axis], vertex[axis]);
      }
    }
  }
  const size = sub(max, min);
  return { min, max, size, diagonal: length(size), maxExtent: Math.max(...size) };
}

function jacobiSmallestEigenVector3(matrix) {
  const a = matrix.map((row) => row.slice());
  const v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

  for (let iter = 0; iter < 24; iter++) {
    let p = 0;
    let q = 1;
    let maxOff = Math.abs(a[0][1]);
    for (const [i, j] of [[0, 2], [1, 2]]) {
      const off = Math.abs(a[i][j]);
      if (off > maxOff) {
        maxOff = off;
        p = i;
        q = j;
      }
    }
    if (maxOff < 1e-14) break;

    const app = a[p][p];
    const aqq = a[q][q];
    const apq = a[p][q];
    const theta = (aqq - app) / (2 * apq);
    const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
    const c = 1 / Math.sqrt(t * t + 1);
    const s = t * c;

    for (let k = 0; k < 3; k++) {
      if (k === p || k === q) continue;
      const akp = a[k][p];
      const akq = a[k][q];
      a[k][p] = akp * c - akq * s;
      a[p][k] = a[k][p];
      a[k][q] = akp * s + akq * c;
      a[q][k] = a[k][q];
    }
    a[p][p] = app * c * c + aqq * s * s - 2 * apq * s * c;
    a[q][q] = app * s * s + aqq * c * c + 2 * apq * s * c;
    a[p][q] = 0;
    a[q][p] = 0;

    for (let k = 0; k < 3; k++) {
      const vkp = v[k][p];
      const vkq = v[k][q];
      v[k][p] = vkp * c - vkq * s;
      v[k][q] = vkp * s + vkq * c;
    }
  }

  let smallest = 0;
  if (a[1][1] < a[smallest][smallest]) smallest = 1;
  if (a[2][2] < a[smallest][smallest]) smallest = 2;
  return normalize([v[0][smallest], v[1][smallest], v[2][smallest]]) ?? [0, 0, 1];
}

function bestFitPlane(points) {
  const centroid = scale(points.reduce((sum, point) => add(sum, point), [0, 0, 0]), 1 / points.length);
  const covariance = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const point of points) {
    const d = sub(point, centroid);
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) covariance[row][col] += d[row] * d[col];
    }
  }
  const normal = jacobiSmallestEigenVector3(covariance);
  const distances = points.map((point) => Math.abs(dot(normal, sub(point, centroid))));
  const maxDistance = Math.max(...distances);
  const rmsDistance = Math.sqrt(distances.reduce((sum, d) => sum + d * d, 0) / distances.length);
  return { normal, centroid, maxDistance, rmsDistance };
}

function uniqueVertices(a, b) {
  const out = [];
  for (const vertex of [...a.vertices, ...b.vertices]) {
    if (!out.some((existing) => vecKey(existing) === vecKey(vertex))) out.push(vertex);
  }
  return out;
}

function quantile(sortedValues, q) {
  if (sortedValues.length === 0) return null;
  const i = (sortedValues.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  if (lo === hi) return sortedValues[lo];
  return sortedValues[lo] + (sortedValues[hi] - sortedValues[lo]) * (i - lo);
}

function summarize(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return {
    min: sorted[0] ?? null,
    p50: quantile(sorted, 0.5),
    p75: quantile(sorted, 0.75),
    p90: quantile(sorted, 0.9),
    p95: quantile(sorted, 0.95),
    p99: quantile(sorted, 0.99),
    max: sorted[sorted.length - 1] ?? null,
  };
}

function buildPairs(polygons) {
  const edgeIndex = new Map();
  for (let polygonIndex = 0; polygonIndex < polygons.length; polygonIndex++) {
    const polygon = polygons[polygonIndex];
    for (let edge = 0; edge < polygon.vertices.length; edge++) {
      const key = edgeKey(polygon.vertices[edge], polygon.vertices[(edge + 1) % polygon.vertices.length]);
      const owners = edgeIndex.get(key);
      const owner = { polygonIndex, edge };
      if (owners) owners.push(owner);
      else edgeIndex.set(key, [owner]);
    }
  }

  const pairs = [];
  for (const owners of edgeIndex.values()) {
    if (owners.length !== 2) continue;
    const a = polygons[owners[0].polygonIndex];
    const b = polygons[owners[1].polygonIndex];
    if (!a || !b) continue;
    if (a.vertices.length !== 3 || b.vertices.length !== 3) continue;
    if (materialKey(a) !== materialKey(b)) continue;

    const unique = uniqueVertices(a, b);
    if (unique.length !== 4) continue;

    const planeA = planeOf(a);
    const planeB = planeOf(b);
    if (!planeA || !planeB) continue;
    const normalDot = clamp(dot(planeA.normal, planeB.normal), -1, 1);
    const angleDeg = Math.acos(clamp(normalDot, -1, 1)) * 180 / Math.PI;
    const oppositeDistances = [
      ...b.vertices.map((vertex) => Math.abs(dot(planeA.normal, vertex) - planeA.d)),
      ...a.vertices.map((vertex) => Math.abs(dot(planeB.normal, vertex) - planeB.d)),
    ];
    const fit = bestFitPlane(unique);
    pairs.push({
      a: owners[0].polygonIndex,
      b: owners[1].polygonIndex,
      color: a.color ?? "#cccccc",
      texture: a.texture,
      normalDot,
      angleDeg,
      planeDelta: Math.abs(planeA.d - planeB.d),
      maxOppositePlaneDistance: Math.max(...oppositeDistances),
      bestFitMaxDistance: fit.maxDistance,
      bestFitRmsDistance: fit.rmsDistance,
      vertices: unique,
    });
  }
  return pairs;
}

function thresholdCounts(pairs) {
  return angleThresholds.map((angle) => ({
    angleDeg: angle,
    distances: distanceThresholds.map((distance) => ({
      distance,
      count: pairs.filter((pair) => pair.angleDeg <= angle && pair.bestFitMaxDistance <= distance).length,
    })),
  }));
}

function printThresholdTable(pairs, thresholds) {
  const header = ["angle\\dist", ...distanceThresholds.map((d) => String(d))];
  const rows = thresholds.map((row) => [
    `${row.angleDeg}deg`,
    ...row.distances.map((cell) => `${cell.count} (${pct(cell.count, pairs.length)})`),
  ]);
  const widths = header.map((cell, index) => Math.max(
    cell.length,
    ...rows.map((row) => String(row[index]).length),
  ));
  console.log(header.map((cell, i) => String(cell).padStart(widths[i])).join("  "));
  for (const row of rows) {
    console.log(row.map((cell, i) => String(cell).padStart(widths[i])).join("  "));
  }
}

const parsed = parseModel(modelPath);
const analysisPolygons = hasFlag("raw") ? parsed.polygons : cullInteriorPolygons(parsed.polygons);
const strictMerged = mergePolygons(analysisPolygons);
const bbox = bboxOf(analysisPolygons);
const pairs = buildPairs(analysisPolygons);
const strictLikePairs = pairs.filter((pair) => pair.normalDot > 0.999 && pair.planeDelta < 0.05);
const angleStats = summarize(pairs.map((pair) => pair.angleDeg));
const fitMaxStats = summarize(pairs.map((pair) => pair.bestFitMaxDistance));
const fitRmsStats = summarize(pairs.map((pair) => pair.bestFitRmsDistance));
const oppositeStats = summarize(pairs.map((pair) => pair.maxOppositePlaneDistance));
const thresholds = thresholdCounts(pairs);
const worst = [...pairs]
  .sort((a, b) => b.bestFitMaxDistance - a.bestFitMaxDistance || b.angleDeg - a.angleDeg)
  .slice(0, Number.isFinite(topCount) ? Math.max(0, topCount) : 8)
  .map((pair) => ({
    a: pair.a,
    b: pair.b,
    color: pair.color,
    angleDeg: pair.angleDeg,
    bestFitMaxDistance: pair.bestFitMaxDistance,
    bestFitRmsDistance: pair.bestFitRmsDistance,
    maxOppositePlaneDistance: pair.maxOppositePlaneDistance,
  }));

const report = {
  model: modelPath,
  analyzedSurface: hasFlag("raw") ? "raw parsed polygons" : "interior-culled polygons",
  counts: {
    rawPolygons: parsed.polygons.length,
    analyzedPolygons: analysisPolygons.length,
    strictMergedPolygons: strictMerged.length,
    sharedEdgeSameMaterialTrianglePairs: pairs.length,
    strictCoplanarPairMatches: strictLikePairs.length,
  },
  bbox,
  stats: {
    angleDeg: angleStats,
    bestFitMaxDistance: fitMaxStats,
    bestFitMaxDistancePctOfMaxExtent: summarize(pairs.map((pair) => pair.bestFitMaxDistance / bbox.maxExtent * 100)),
    bestFitRmsDistance: fitRmsStats,
    maxOppositePlaneDistance: oppositeStats,
  },
  thresholds,
  worst,
};

console.log(`Coplanar tolerance report: ${modelPath}`);
console.log(`Surface: ${report.analyzedSurface}`);
console.log("");
console.log(`Raw polygons:             ${report.counts.rawPolygons}`);
console.log(`Analyzed polygons:        ${report.counts.analyzedPolygons}`);
console.log(`Strict merged polygons:   ${report.counts.strictMergedPolygons}`);
console.log(`Same-material tri pairs:  ${pairs.length}`);
console.log(`Strict-like pair matches: ${strictLikePairs.length} (${pct(strictLikePairs.length, pairs.length)})`);
console.log(`BBox max extent:          ${fmt(bbox.maxExtent, 3)} scene units`);
console.log("");
console.log("Pair error distributions");
console.log(`angle deg              min ${fmt(angleStats.min)}  p50 ${fmt(angleStats.p50)}  p90 ${fmt(angleStats.p90)}  p95 ${fmt(angleStats.p95)}  p99 ${fmt(angleStats.p99)}  max ${fmt(angleStats.max)}`);
console.log(`best-fit max distance  min ${fmt(fitMaxStats.min)}  p50 ${fmt(fitMaxStats.p50)}  p90 ${fmt(fitMaxStats.p90)}  p95 ${fmt(fitMaxStats.p95)}  p99 ${fmt(fitMaxStats.p99)}  max ${fmt(fitMaxStats.max)}`);
console.log(`best-fit rms distance  min ${fmt(fitRmsStats.min)}  p50 ${fmt(fitRmsStats.p50)}  p90 ${fmt(fitRmsStats.p90)}  p95 ${fmt(fitRmsStats.p95)}  p99 ${fmt(fitRmsStats.p99)}  max ${fmt(fitRmsStats.max)}`);
console.log(`opposite plane dist    min ${fmt(oppositeStats.min)}  p50 ${fmt(oppositeStats.p50)}  p90 ${fmt(oppositeStats.p90)}  p95 ${fmt(oppositeStats.p95)}  p99 ${fmt(oppositeStats.p99)}  max ${fmt(oppositeStats.max)}`);
console.log("");
console.log("Pairs within angle + best-fit max-distance thresholds");
printThresholdTable(pairs, thresholds);

if (worst.length > 0) {
  console.log("");
  console.log(`Worst ${worst.length} pairs by best-fit max distance`);
  for (const pair of worst) {
    console.log(
      `#${pair.a}/#${pair.b} ${pair.color}  angle=${fmt(pair.angleDeg, 2)}deg  ` +
      `fitMax=${fmt(pair.bestFitMaxDistance)}  fitRms=${fmt(pair.bestFitRmsDistance)}  ` +
      `oppPlane=${fmt(pair.maxOppositePlaneDistance)}`,
    );
  }
}

if (jsonPath) {
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log("");
  console.log(`Wrote JSON report: ${jsonPath}`);
}
