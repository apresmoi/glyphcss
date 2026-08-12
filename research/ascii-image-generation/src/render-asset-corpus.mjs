import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import { createCanvas, ImageData, loadImage } from "@napi-rs/canvas";
import { buildNodeTextureSamplerBundle, loadMeshFromFile, materializeNodeTextureUrls, releaseNodeTextureUrls, writeGlyphControlMaps } from "@glyphcss/compile";
import { buildGlyphControlFrame, computeGlyphControlContentSha256, computeGlyphControlGeometryHashes, createGlyphOrthographicCamera } from "glyphcss";
import { loadAssetTaxonomy, resolveAssetTaxonomyClass } from "../scripts/asset-taxonomy.mjs";
import { assertExactPairMembership, traceBoundMotion, traceFrameBindings, tracePhase, verifyTraceAuthority } from "./trace-bound-schedule.mjs";

const root = resolve(import.meta.dirname, "..");
const ASSET_CORPUS_BASE_IMAGE = "node:22.14.0-bookworm-slim@sha256:745403dc46b5ab4c998502b07a12cbf020cf2c30645427a68ec0718f02d647de";
const ASSET_RENDER_CONCURRENCY = 8;
const sha = (value) => createHash("sha256").update(value).digest("hex");
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const readJson = async (path) => JSON.parse(await readFile(resolve(root, path), "utf8"));
const exists = async (path) => { try { await access(path); return true; } catch { return false; } };
async function rendererContractSha() {
  const sourceRoots = [resolve(root, "../../packages/core/src"), resolve(root, "../../packages/glyphcss/src"), resolve(root, "../../packages/compile/src")];
  const files = [];
  const visit = async (directory) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) files.push(path);
    }
  };
  await Promise.all(sourceRoots.map(visit));
  files.push(resolve(import.meta.filename), resolve(root, "src/asset-corpus-render-worker.mjs"), resolve(root, "../../pnpm-lock.yaml"));
  const digest = createHash("sha256");
  for (const path of files.sort()) digest.update(relative(resolve(root, "../.."), path).replaceAll("\\\\", "/")).update("\0").update(await readFile(path)).update("\0");
  return digest.digest("hex");
}

async function imageRuntimeAuthority() {
  const imageId = process.env.GLYPHCSS_ASSET_CORPUS_IMAGE_ID;
  if (!/^sha256:[a-f0-9]{64}$/.test(imageId ?? "")) throw new Error("ASSET_CORPUS_IMAGE_ID_REQUIRED");
  if (process.version !== "v22.14.0") throw new Error(`ASSET_CORPUS_NODE_VERSION_REBOUND: ${process.version}`);
  const path = resolve(root, "reports/image-source-manifest.json");
  const value = JSON.parse(await readFile(path, "utf8"));
  if (value.schemaVersion !== "glyph-asset-corpus-image-source/v1" || !Array.isArray(value.files)
    || value.contentSha256 !== sha(canonical(value)) || !value.files.length
    || new Set(value.files.map((file) => file.path)).size !== value.files.length
    || value.files.some((file) => typeof file.path !== "string" || !Number.isInteger(file.bytes) || file.bytes < 0 || !isSha256(file.sha256))) {
    throw new Error("ASSET_CORPUS_IMAGE_SOURCE_MANIFEST_INVALID");
  }
  return { imageId, baseImage: ASSET_CORPUS_BASE_IMAGE, nodeVersion: process.version, sourceFileSetSha256: value.contentSha256 };
}

function parseArgs() {
  const values = process.argv.slice(2); const at = values.indexOf("--config"); const check = values.indexOf("--check");
  const limit = values.indexOf("--limit"); const population = values.indexOf("--population");
  const reviewAssets = values.indexOf("--review-assets");
  const readiness = values.indexOf("--readiness-check");
  const assetIds = values.indexOf("--asset-ids"), proofOutput = values.indexOf("--proof-output"), checkProof = values.indexOf("--check-proof");
  return { config: at < 0 ? "config/asset-corpus.json" : resolve(values[at + 1]), check: check < 0 ? null : resolve(values[check + 1]), readiness: readiness < 0 ? null : resolve(values[readiness + 1]), population: population < 0 ? "exact-rgb" : values[population + 1], render: values.includes("--render"), review: values.includes("--review"), reviewAssets: reviewAssets < 0 ? null : values[reviewAssets + 1].split(",").filter(Boolean), limit: limit < 0 ? null : Number.parseInt(values[limit + 1], 10), assetIds: assetIds < 0 ? null : values[assetIds + 1].split(",").filter(Boolean), proofOutput: proofOutput < 0 ? null : resolve(values[proofOutput + 1]), checkProof: checkProof < 0 ? null : resolve(values[checkProof + 1]) };
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).filter((key) => key !== "contentSha256").sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function population(registry) {
  const counts = { exactRgb: { train: 0, validation: 0, test: 0 }, materialOnly: { train: 0, validation: 0, test: 0 } };
  for (const asset of registry.assets) if (asset.admitted && asset.split) {
    if (asset.appearanceDisposition === "exact-rgb") counts.exactRgb[asset.split]++;
    if (asset.appearanceDisposition === "material-only") counts.materialOnly[asset.split]++;
  }
  return counts;
}

function assertPopulation(config, counts) {
  const failures = Object.entries(config.populationFloors.exactRgb).flatMap(([split, floor]) => counts.exactRgb[split] < floor ? [`exact-rgb ${split}: ${counts.exactRgb[split]}/${floor}`] : []);
  return { pass: failures.length === 0, failures };
}

function corpusPopulationName(populationName) {
  if (!['exact-rgb', 'material-only'].includes(populationName)) throw new Error('ASSET_CORPUS_POPULATION_INVALID');
  return populationName;
}

export async function mapAssetCorpusWorkersOrdered(values, { concurrency = ASSET_RENDER_CONCURRENCY, workerUrl = new URL("./asset-corpus-render-worker.mjs", import.meta.url) } = {}) {
  if (!Array.isArray(values) || !Number.isInteger(concurrency) || concurrency < 1 || !(workerUrl instanceof URL)) {
    throw new Error("ASSET_CORPUS_CONCURRENCY_INVALID");
  }
  if (values.length === 0) return [];
  const results = new Array(values.length);
  let cursor = 0;
  let completed = 0;
  let terminal = false;
  const workers = [];
  const assignments = new Map();
  return new Promise((resolvePool, rejectPool) => {
    const stop = async (error = null) => {
      if (terminal) return;
      terminal = true;
      await Promise.allSettled(workers.map((worker) => worker.terminate()));
      if (error) rejectPool(error);
      else resolvePool(results);
    };
    const fail = (error) => {
      void stop(error instanceof Error ? error : new Error(String(error)));
    };
    const dispatch = (worker) => {
      if (terminal) return;
      if (cursor >= values.length) {
        if (completed === values.length) void stop();
        return;
      }
      const index = cursor++;
      assignments.set(worker, index);
      try {
        worker.postMessage({ index, value: values[index] });
      } catch (error) {
        assignments.delete(worker);
        fail(error);
      }
    };
    const workerCount = Math.min(concurrency, values.length);
    for (let lane = 0; lane < workerCount; lane++) {
      let worker;
      try {
        worker = new Worker(workerUrl, { type: "module", stdout: true, stderr: true });
      } catch (error) {
        fail(error);
        break;
      }
      workers.push(worker);
      // CLI stdout is a machine-readable single JSON document. Worker output
      // is diagnostic only, so preserve it on stderr rather than contaminating
      // the proof/report stream.
      worker.stdout?.on("data", (chunk) => process.stderr.write(chunk));
      worker.stderr?.on("data", (chunk) => process.stderr.write(chunk));
      worker.on("message", (message) => {
        if (terminal) return;
        const keys = message && typeof message === "object" ? Object.keys(message).sort() : [];
        const hasResult = keys.includes("result"), hasError = keys.includes("error");
        if (!message || !Number.isInteger(message.index) || message.index < 0 || message.index >= values.length
          || hasResult === hasError || keys.some((key) => !["error", "index", "result", "threadId"].includes(key))
          || !Number.isInteger(message.threadId) || message.threadId <= 0 || message.threadId !== worker.threadId
          || (hasResult && (!message.result || typeof message.result !== "object"))
          || (hasError && (!message.error || typeof message.error !== "object" || typeof message.error.message !== "string"
            || !("stack" in message.error) || (message.error.stack !== null && typeof message.error.stack !== "string")
            || Object.keys(message.error).some((key) => !["message", "stack"].includes(key))))) {
          fail(new Error("ASSET_CORPUS_WORKER_PROTOCOL_INVALID"));
          return;
        }
        if (assignments.get(worker) !== message.index) {
          fail(new Error("ASSET_CORPUS_WORKER_PROTOCOL_INVALID"));
          return;
        }
        assignments.delete(worker);
        if (message.error) {
          const error = new Error(message.error.message ?? "ASSET_CORPUS_WORKER_FAILED");
          if (typeof message.error.stack === "string") error.stack = message.error.stack;
          fail(error);
          return;
        }
        results[message.index] = message.result;
        completed++;
        dispatch(worker);
      });
      worker.on("error", fail);
      worker.on("exit", (code) => {
        if (!terminal) fail(new Error(`ASSET_CORPUS_WORKER_EXITED: ${code}`));
      });
      dispatch(worker);
    }
  });
}

function materialOnlyOutput(config) {
  // Keep B44's exact-RGB root immutable. Material controls may share its
  // schedule, but never its artifact tree or aggregate evaluation report.
  return config.materialOnlyOutput ?? `${config.output}-material-only`;
}

export function materialOnlyProvenance(asset) {
  if (!asset?.admitted || asset.appearanceDisposition !== 'material-only') throw new Error(`ASSET_CORPUS_MATERIAL_ONLY_ASSET_INVALID: ${asset?.id ?? 'unknown'}`);
  const materials = asset.materials.map(({ name, baseColor, textures }) => ({ name, baseColor: baseColor == null ? [1, 1, 1, 1] : Array.isArray(baseColor) && baseColor.length === 3 ? [...baseColor, 1] : baseColor, baseColorSource: baseColor == null ? "renderer-default-white" : Array.isArray(baseColor) && baseColor.length === 3 ? "authored-material-rgb-alpha-one" : "authored-material", textures }));
  const baseColors = materials.map(({ name, baseColor, baseColorSource }) => ({ name, baseColor, baseColorSource }));
  if (materials.some((material) => !Array.isArray(material.baseColor) || material.baseColor.length !== 4 || !material.baseColor.every(Number.isFinite)
    || material.textures.some((texture) => texture.role === 'baseColor' && typeof texture.textureId === 'string'))) throw new Error(`ASSET_CORPUS_MATERIAL_ONLY_TEXTURE_RECLASSIFICATION_REQUIRED: ${asset.id}`);
  return {
    targetStatus: 'material-only-not-exact-rgb', disposition: 'material-only-control-derived',
    colorSource: 'authored-material-base-color', materialsSha256: sha(canonical(materials)), baseColorsSha256: sha(canonical(baseColors)),
    textureIds: asset.textureIds, nonBaseColorTextureIds: materials.flatMap((material) => material.textures.map((texture) => texture.textureId)).filter(Boolean).sort(),
  };
}

function assertMaterialOnlySplitIsolation(registry, assets) {
  for (const { asset } of assets) {
    const connected = registry.assets.filter((candidate) => candidate.splitGroupId === asset.splitGroupId && candidate.admitted);
    // B43 groups source-pack siblings across both appearance populations. The
    // material corpus may not *render* its exact-RGB siblings, but it must
    // retain their group split so neither population can leak across splits.
    if (!asset.split || connected.some((candidate) => candidate.split !== asset.split)) {
      throw new Error(`ASSET_CORPUS_MATERIAL_SPLIT_OR_POPULATION_LEAKAGE: ${asset.id}`);
    }
  }
}

export function selectAssetCorpusPopulation(registry, taxonomy, populationName) {
  if (!["exact-rgb", "material-only"].includes(populationName)) throw new Error("ASSET_CORPUS_POPULATION_INVALID");
  return registry.assets.filter((asset) => asset.admitted && asset.appearanceDisposition === populationName).map((asset) => {
    const entry = taxonomy.byAsset.get(asset.id);
    if (!entry) throw new Error(`ASSET_CORPUS_TAXONOMY_MAPPING_ABSENT: ${asset.id}`);
    const dictionaryClass = taxonomy.dictionary.classes.find((candidate) => candidate.id === entry.classId);
    if (!dictionaryClass || dictionaryClass.name === "synthetic-occluder") throw new Error(`ASSET_CORPUS_TAXONOMY_CLASS_INVALID: ${asset.id}`);
    return { asset, classId: entry.classId };
  });
}

function boundsFor(polygons) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const polygon of polygons) for (const vertex of polygon.vertices) for (let axis = 0; axis < 3; axis++) { min[axis] = Math.min(min[axis], vertex[axis]); max[axis] = Math.max(max[axis], vertex[axis]); }
  const center = min.map((value, axis) => (value + max[axis]) / 2);
  const radius = Math.hypot(...max.map((value, axis) => value - min[axis])) / 2;
  if (!(radius > 0 && Number.isFinite(radius))) throw new Error("ASSET_EMPTY_OR_DEGENERATE");
  return { min, max, center, radius };
}

export function fitAssetCorpusCamera(polygons, config, index, assetId, camera) {
  const { center } = boundsFor(polygons), usable = 1 - config.trajectory.margin * 2;
  const trace = traceBoundMotion(config);
  const binding = camera?.anchorId ? camera : null;
  const anchor = binding ? config.trajectory.anchors.find((candidate) => candidate.id === binding.anchorId) : camera;
  if (!anchor) throw new Error("ASSET_CORPUS_TRACE_ANCHOR_MISSING");
  const phase = tracePhase(config, assetId);
  const fitted = createGlyphOrthographicCamera({
    rotX: config.trajectory.rotX + anchor.rotXOffset,
    rotY: phase + anchor.rotYOffset + (binding?.step ? trace.max : 0),
    zoom: 1,
    target: center,
    center: [0, 0],
  });
  const projected = polygons.flatMap((polygon) => polygon.vertices.map((vertex) => fitted.project(vertex, config.grid.cols, config.grid.rows, config.grid.cellAspect)));
  const minCol = Math.min(...projected.map((point) => point[0]));
  const maxCol = Math.max(...projected.map((point) => point[0]));
  const minRow = Math.min(...projected.map((point) => point[1]));
  const maxRow = Math.max(...projected.map((point) => point[1]));
  const spanCols = maxCol - minCol;
  const spanRows = maxRow - minRow;
  if (!(spanCols > 0 && spanRows > 0 && [minCol, maxCol, minRow, maxRow].every(Number.isFinite))) throw new Error("ASSET_CORPUS_PROJECTED_BOUNDS_INVALID");
  fitted.zoom = Math.min(config.grid.cols * usable / spanCols, config.grid.rows * usable / spanRows);
  fitted.center = [
    0.5 - ((minCol + maxCol) / 2) * fitted.zoom / config.grid.cols,
    0.5 - ((minRow + maxRow) / 2) * fitted.zoom / config.grid.rows,
  ];
  return fitted;
}

const cameraFor = fitAssetCorpusCamera;
const cameraMetadata = (camera) => ({ kind: camera.kind, rotX: camera.rotX, rotY: camera.rotY, center: [...camera.center], mat: camera.mat ? [...camera.mat] : null, useMat: camera.useMat, distance: camera.distance, perspective: camera.perspective, zoom: camera.zoom, stretch: camera.stretch, fovScale: camera.fovScale, target: [...camera.target], eyeMode: camera.eyeMode });

function cloneAnchorCamera(anchor, rotY) {
  return createGlyphOrthographicCamera({ rotX: anchor.rotX, rotY, zoom: anchor.zoom, target: [...anchor.target], center: [...anchor.center], mat: anchor.mat ? [...anchor.mat] : null, useMat: anchor.useMat });
}

export function traceBoundCamerasFor(polygons, config, assetId, bindings) {
  const trace = traceBoundMotion(config), anchors = new Map();
  for (const binding of bindings.filter((candidate) => candidate.role === "keyframe")) {
    if (!anchors.has(binding.anchorId)) anchors.set(binding.anchorId, cameraFor(polygons, config, 0, assetId, binding));
  }
  return bindings.map((binding) => {
    const anchor = anchors.get(binding.anchorId);
    if (!anchor) throw new Error("ASSET_CORPUS_TRACE_ANCHOR_MISSING");
    const camera = cloneAnchorCamera(anchor, anchor.rotY + binding.step * trace.max);
    if (camera.zoom !== anchor.zoom || canonical(camera.center) !== canonical(anchor.center) || canonical(camera.target) !== canonical(anchor.target) || camera.rotX !== anchor.rotX) throw new Error("ASSET_CORPUS_TRACE_COMPANION_REBOUND");
    return camera;
  });
}

function occludersFor(polygons, lighting, directShadowReceivers) {
  const { center, radius, min, max } = boundsFor(polygons);
  const half = radius * 0.16;
  const offset = radius * 0.12;
  const triangulateSquare = (vertices) => [
    { vertices: [vertices[0], vertices[1], vertices[2]], uvs: [[0, 0], [1, 0], [1, 1]], color: "#101010" },
    { vertices: [vertices[0], vertices[2], vertices[3]], uvs: [[0, 0], [1, 1], [0, 1]], color: "#101010" },
  ];
  const square = (axis, coordinate, first, second) => {
    const vertex = (a, b) => {
      const value = [...center];
      value[axis] = coordinate;
      value[first] += a * half;
      value[second] += b * half;
      return value;
    };
    return triangulateSquare([vertex(-1, -1), vertex(1, -1), vertex(1, 1), vertex(-1, 1)]);
  };
  // The corpus has two independently rotated cameras. A single world-Z plane
  // can sit behind an asset after rotation, so the frozen "front-plane"
  // intervention is represented by one small exterior plane on each AABB
  // side. At least one is camera-front while the real renderer/depth buffer
  // still has to prove an overlapping winner; no approximate projection or
  // synthetic mask decides causality.
  const occluders = [
    square(0, min[0] - offset, 1, 2),
    square(0, max[0] + offset, 1, 2),
    square(1, min[1] - offset, 0, 2),
    square(1, max[1] + offset, 0, 2),
    square(2, min[2] - offset, 0, 1),
    square(2, max[2] + offset, 0, 1),
  ].flat();
  for (const entry of lighting) {
    if (!entry.shadow || entry.shadow.opacity <= 0) continue;
    const raw = entry.directional.direction;
    const magnitude = Math.hypot(...raw);
    if (!(magnitude > 0)) throw new Error(`ASSET_CORPUS_SHADOW_LIGHT_DIRECTION_INVALID: ${entry.id}`);
    const direction = raw.map((value) => value / magnitude);
    const receivers = directShadowReceivers.get(entry.id);
    if (!receivers?.length) continue;
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const normalize = (value) => {
      const length = Math.hypot(...value);
      return value.map((component) => component / length);
    };
    const reference = Math.abs(direction[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0];
    const tangent = normalize(cross(direction, reference));
    const bitangent = normalize(cross(direction, tangent));
    // Each point is a real, visible cell whose unshadowed shade exceeds the
    // ambient floor. Translating a small source-facing square along the light
    // ray preserves its light-space footprint on that exact receiver while
    // moving the visible caster away in camera space.
    const lift = Math.max(radius * 1.5, (entry.shadow.lift ?? 0.05) * 8);
    const casterHalf = Math.max(radius * 0.06, (entry.shadow.lift ?? 0.05) * 0.5);
    for (const point of receivers.slice(0, 12)) {
      const casterCenter = point.map((value, axis) => value + direction[axis] * lift);
      const vertex = (a, b) => casterCenter.map((value, axis) => value + tangent[axis] * a * casterHalf + bitangent[axis] * b * casterHalf);
      occluders.push(...triangulateSquare([vertex(-1, -1), vertex(1, -1), vertex(1, 1), vertex(-1, 1)]));
    }
  }
  return occluders;
}

function sceneFor(asset, polygons, dictionary, sourcePolygonCount, classId, syntheticOccluderClassId) {
  const instanceId = `instance/${asset.id.slice("asset/".length)}`;
  const surfaces = polygons.map((_, index) => ({ id: `${instanceId}/surface-${index}`, instanceId: index < sourcePolygonCount ? instanceId : `${instanceId}/occluder` }));
  const hashes = computeGlyphControlGeometryHashes(polygons);
  const raw = {
    schemaVersion: "control-scene/v1", id: `scene/${asset.id.slice("asset/".length)}`,
    dictionaryId: dictionary.id, dictionarySha256: dictionary.contentSha256, ...hashes,
    instances: [{ id: instanceId, classId }, { id: `${instanceId}/occluder`, classId: syntheticOccluderClassId }], surfaces, polygonSurfaceIds: surfaces.map((surface) => surface.id),
  };
  return { ...raw, contentSha256: computeGlyphControlContentSha256(raw) };
}

export function targetBytes(frame) {
  const canvas = createCanvas(frame.metadata.cols, frame.metadata.rows); const context = canvas.getContext("2d");
  const pixels = new Uint8ClampedArray(frame.targetRgb.length * 4);
  for (let index = 0; index < frame.targetRgb.length; index++) { const color = frame.targetRgb[index]; const p = index * 4; pixels[p] = color >>> 16; pixels[p + 1] = (color >>> 8) & 0xff; pixels[p + 2] = color & 0xff; pixels[p + 3] = frame.coverage[index] ? 255 : 0; }
  context.putImageData(new ImageData(pixels, frame.metadata.cols, frame.metadata.rows), 0, 0);
  return canvas.toBuffer("image/png");
}

async function writeExact(path, bytes, label) {
  const digest = sha(bytes);
  if (await exists(path)) {
    if (sha(await readFile(path)) !== digest) throw new Error(`ASSET_CORPUS_${label}_RESUME_MISMATCH: ${path}`);
    return digest;
  }
  await mkdir(dirname(path), { recursive: true }); await writeFile(path, bytes); return digest;
}

function sourceCoverage(registry) {
  return registry.sourceFiles.map((source) => {
    const asset = registry.assets.find((candidate) => candidate.id === source.canonicalAssetId);
    if (!asset) throw new Error(`ASSET_CORPUS_SOURCE_CENSUS_UNKNOWN_ASSET: ${source.path}`);
    return {
      sourcePath: source.path, canonicalAssetId: source.canonicalAssetId, textureIds: source.textureIds,
      disposition: asset.admitted && asset.appearanceDisposition === "exact-rgb" ? "scheduled-exact-rgb" : "admission-failure",
      admissionFailure: asset.admitted && asset.appearanceDisposition === "exact-rgb" ? null : asset.admissionReasons.length ? asset.admissionReasons : [`appearance is ${asset.appearanceDisposition}`],
      splitGroupId: asset.splitGroupId, split: asset.split,
    };
  });
}

function expectedBindingDisposition(asset, source) {
  if (asset.admitted) return source.path === asset.canonicalPath ? "render-bound-base-color" : "alias-of-rendered";
  return "admission-failure";
}

function expectedBindingAdmissionFailure(asset) {
  return asset.admitted ? null : asset.admissionReasons.length ? asset.admissionReasons : [`appearance is ${asset.appearanceDisposition}`];
}

function isSha256(value) { return typeof value === "string" && /^[a-f0-9]{64}$/.test(value); }
function sameSortedStrings(left, right) { return canonical([...left].sort()) === canonical([...right].sort()); }
function expectedTextureRoles(asset) {
  return asset.materials.flatMap((material) => material.textures
    .filter((texture) => typeof texture.textureId === "string")
    .map((texture) => ({ textureId: texture.textureId, role: texture.role })))
    .sort((left, right) => left.textureId.localeCompare(right.textureId) || left.role.localeCompare(right.role));
}
function validateBoundBaseColorSource(entry, asset, source) {
  if (!entry || typeof entry !== "object" || !isSha256(entry.byteSha256) || !isSha256(entry.decodedPixelSha256)
    || entry.textureId !== `texture/${entry.byteSha256}` || !Number.isInteger(entry.width) || entry.width <= 0
    || !Number.isInteger(entry.height) || entry.height <= 0 || entry.disposition !== "render-bound-base-color"
    || !entry.sample || !Array.isArray(entry.sample.uv) || entry.sample.uv.length !== 2
    || !entry.sample.uv.every(Number.isFinite) || !Array.isArray(entry.sample.rgba) || entry.sample.rgba.length !== 4
    || !entry.sample.rgba.every((value) => Number.isInteger(value) && value >= 0 && value <= 255)) throw new Error(`ASSET_CORPUS_RENDER_BINDING_BASE_COLOR_INVALID: ${source.path}`);
  const materialTextureIds = new Set(expectedTextureRoles(asset).filter((texture) => texture.role === "baseColor").map((texture) => texture.textureId));
  if (!materialTextureIds.has(entry.textureId) || !source.textureIds.includes(entry.textureId) || !asset.textureIds.includes(entry.textureId)) throw new Error(`ASSET_CORPUS_RENDER_BINDING_BASE_COLOR_REBOUND: ${source.path}/${entry.textureId}`);
}

export function validateAssetRenderBindingAuthority(binding, registry, expectedContentSha256 = null) {
  if (!binding || binding.schemaVersion !== "glyph-asset-render-binding/v2" || binding.contentSha256 !== sha(canonical(binding)) || binding.pass !== true || binding.registrySha256 !== registry.contentSha256) throw new Error("ASSET_CORPUS_RENDER_BINDING_AUTHORITY_INVALID");
  const exactAssets = registry.assets.filter((asset) => asset.appearanceDisposition === "exact-rgb");
  if (!Array.isArray(binding.assets) || binding.assets.length !== 76 || new Set(binding.assets.map((entry) => entry.assetId)).size !== 76) throw new Error("ASSET_CORPUS_RENDER_BINDING_ASSET_CENSUS_INVALID");
  for (const asset of exactAssets) {
    const entry = binding.assets.find((candidate) => candidate.assetId === asset.id);
    if (!entry || entry.canonicalPath !== asset.canonicalPath || entry.pass !== true) throw new Error(`ASSET_CORPUS_RENDER_BINDING_ASSET_REBOUND: ${asset.id}`);
  }
  if (exactAssets.length !== 76 || !Array.isArray(binding.sourceCoverage) || binding.sourceCoverage.length !== 77 || new Set(binding.sourceCoverage.map((entry) => entry.sourcePath)).size !== 77) throw new Error("ASSET_CORPUS_RENDER_BINDING_SOURCE_CENSUS_INVALID");
  const counts = { "render-bound-base-color": 0, "alias-of-rendered": 0, "admission-failure": 0 };
  for (const source of registry.sourceFiles) {
    const asset = registry.assets.find((candidate) => candidate.id === source.canonicalAssetId);
    const entry = binding.sourceCoverage.find((candidate) => candidate.sourcePath === source.path);
    if (!asset || !entry || entry.canonicalAssetId !== asset.id || !Array.isArray(entry.baseColorSources) || entry.baseColorSources.length === 0 || entry.productionDisposition === "binding-failure") throw new Error(`ASSET_CORPUS_RENDER_BINDING_SOURCE_REBOUND: ${source.path}`);
    const expectedRoles = expectedTextureRoles(asset);
    if (!Array.isArray(entry.textureRoles)
      || canonical(entry.textureRoles) !== canonical(expectedRoles)
      || !sameSortedStrings(source.textureIds, asset.textureIds)
      || !sameSortedStrings(new Set(entry.textureRoles.map((texture) => texture.textureId)), new Set(asset.textureIds))) throw new Error(`ASSET_CORPUS_RENDER_BINDING_TEXTURE_ROLES_REBOUND: ${source.path}`);
    const expectedBaseColorTextureIds = [...new Set(expectedRoles.filter((texture) => texture.role === "baseColor").map((texture) => texture.textureId))].sort();
    if (entry.baseColorSources.length !== expectedBaseColorTextureIds.length
      || !sameSortedStrings(entry.baseColorSources.map((baseColor) => baseColor.textureId), expectedBaseColorTextureIds)) throw new Error(`ASSET_CORPUS_RENDER_BINDING_BASE_COLOR_CENSUS_REBOUND: ${source.path}`);
    for (const baseColor of entry.baseColorSources) validateBoundBaseColorSource(baseColor, asset, source);
    const disposition = expectedBindingDisposition(asset, source);
    if (entry.corpusDisposition !== disposition || canonical(entry.admissionFailure) !== canonical(expectedBindingAdmissionFailure(asset))) throw new Error(`ASSET_CORPUS_RENDER_BINDING_DISPOSITION_REBOUND: ${source.path}`);
    counts[disposition]++;
  }
  if (counts["render-bound-base-color"] !== 45 || counts["alias-of-rendered"] !== 1 || counts["admission-failure"] !== 31) throw new Error("ASSET_CORPUS_RENDER_BINDING_DISPOSITION_CENSUS_INVALID");
  if (expectedContentSha256 !== null && binding.contentSha256 !== expectedContentSha256) throw new Error("ASSET_CORPUS_RENDER_BINDING_SOURCE_TRUTH_REBOUND");
  return { path: null, contentSha256: binding.contentSha256 };
}

async function loadAssetRenderBindingAuthority(config, registry) {
  const declared = config.assetRenderBindings;
  if (!declared || typeof declared !== "object" || typeof declared.path !== "string" || !isSha256(declared.contentSha256) || !isSha256(declared.fileSha256)) throw new Error("ASSET_CORPUS_RENDER_BINDING_AUTHORITY_REQUIRED");
  const path = resolve(root, declared.path), bytes = await readFile(path), binding = JSON.parse(bytes);
  const authority = validateAssetRenderBindingAuthority(binding, registry, declared.contentSha256);
  if (authority.contentSha256 !== declared.contentSha256 || sha(bytes) !== declared.fileSha256) throw new Error("ASSET_CORPUS_RENDER_BINDING_CONFIG_REBOUND");
  return { ...authority, path: relative(resolve(root, "..", ".."), path).replaceAll("\\\\", "/"), value: binding };
}

function expectedDecoderParityCoverage(binding) {
  const records = binding.sourceCoverage.flatMap((source) => source.baseColorSources.map((baseColor) => `${source.sourcePath}\0${baseColor.textureId}`));
  return { sourceRecords: records.length, uniqueTextures: new Set(binding.sourceCoverage.flatMap((source) => source.baseColorSources.map((baseColor) => baseColor.textureId))).size };
}

export function validateAssetDecoderParityAuthority(parity, binding, registry) {
  if (!parity || parity.schemaVersion !== "glyph-asset-render-binding-decoder-parity/v1"
    || parity.contentSha256 !== sha(canonical(parity)) || parity.registrySha256 !== registry.contentSha256
    || parity.assetRenderBindingsSha256 !== binding.contentSha256 || !["blocked", "pass"].includes(parity.status)) throw new Error("ASSET_CORPUS_DECODER_PARITY_AUTHORITY_INVALID");
  const expected = expectedDecoderParityCoverage(binding);
  if (!parity.coverage || parity.coverage.sourceRecords !== expected.sourceRecords || parity.coverage.uniqueTextures !== expected.uniqueTextures) throw new Error("ASSET_CORPUS_DECODER_PARITY_COVERAGE_REBOUND");
  if (parity.status === "blocked") {
    if (parity.pass !== false || parity.complete !== false || typeof parity.blockedReason !== "string" || parity.blockedReason.length === 0 || parity.browserRun !== null) throw new Error("ASSET_CORPUS_DECODER_PARITY_BLOCKED_INVALID");
  } else {
    const run = parity.browserRun, summary = run?.decoderParity;
    if (parity.pass !== true || parity.complete !== true || typeof run?.path !== "string" || !isSha256(run.fileSha256) || !isSha256(run.contentSha256)
      || run.schemaVersion !== "glyph-asset-render-binding-browser-run/v3" || run.verdict !== "pass"
      || !summary || summary.sourceRecords !== expected.sourceRecords || summary.uniqueTextures !== expected.uniqueTextures
      || !Array.isArray(summary.sourceDecodedHashMismatches) || summary.sourceDecodedHashMismatches.length !== 0
      || !Array.isArray(summary.uniqueDecodedHashMismatches) || summary.uniqueDecodedHashMismatches.length !== 0
      || !Array.isArray(summary.sourceExactUvSampleMismatches) || summary.sourceExactUvSampleMismatches.length !== 0
      || !Array.isArray(summary.uniqueExactUvSampleMismatches) || summary.uniqueExactUvSampleMismatches.length !== 0
      || summary.browserNodeDecoderStatus !== "pass" || summary.b44ExactSharedDecoderStatus !== "pass") throw new Error("ASSET_CORPUS_DECODER_PARITY_INCOMPLETE_OR_STALE");
  }
  return { contentSha256: parity.contentSha256, status: parity.status, pass: parity.pass, complete: parity.complete };
}

async function loadAssetDecoderParityAuthority(config, binding, registry) {
  const declared = config.assetDecoderParity;
  if (!declared || typeof declared !== "object" || typeof declared.path !== "string" || !isSha256(declared.contentSha256) || !isSha256(declared.fileSha256)) throw new Error("ASSET_CORPUS_DECODER_PARITY_AUTHORITY_REQUIRED");
  const path = resolve(root, declared.path), bytes = await readFile(path), parity = JSON.parse(bytes);
  const authority = validateAssetDecoderParityAuthority(parity, binding, registry);
  if (authority.contentSha256 !== declared.contentSha256 || sha(bytes) !== declared.fileSha256) throw new Error("ASSET_CORPUS_DECODER_PARITY_CONFIG_REBOUND");
  if (authority.pass) {
    const runPath = resolve(root, parity.browserRun.path), runBytes = await readFile(runPath), run = JSON.parse(runBytes);
    const { contentSha256: runSeal, ...unsignedRun } = run;
    if (sha(runBytes) !== parity.browserRun.fileSha256 || run.contentSha256 !== parity.browserRun.contentSha256
      || run.schemaVersion !== parity.browserRun.schemaVersion || run.verdict !== parity.browserRun.verdict
      || runSeal !== sha(JSON.stringify(unsignedRun)) || run.reportContentSha256 !== binding.contentSha256 || canonical(run.decoderParity) !== canonical(parity.browserRun.decoderParity)) throw new Error("ASSET_CORPUS_DECODER_PARITY_RUN_REBOUND");
  }
  return { ...authority, path: relative(resolve(root, "..", ".."), path).replaceAll("\\\\", "/"), fileSha256: sha(bytes), value: parity };
}

async function loadControlNormalizationAuthority(config) {
  if (typeof config.controlNormalization !== "string") throw new Error("ASSET_CORPUS_CONTROL_NORMALIZATION_REQUIRED");
  const path = resolve(root, config.controlNormalization), bytes = await readFile(path), value = JSON.parse(bytes);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("ASSET_CORPUS_CONTROL_NORMALIZATION_INVALID");
  return { path: relative(resolve(root, "..", ".."), path).replaceAll("\\\\", "/"), contentSha256: sha(canonical(value)), fileSha256: sha(bytes), value };
}

function reconcileTextures(asset, sources) {
  const sourceByHash = new Map(sources.map((source) => [source.byteSha256, source]));
  const roles = new Map();
  for (const material of asset.materials) for (const texture of material.textures) if (texture.textureId) {
    const set = roles.get(texture.textureId) ?? new Set(); set.add(texture.role); roles.set(texture.textureId, set);
  }
  const records = [...roles].sort(([a], [b]) => a.localeCompare(b)).map(([textureId, roleSet]) => {
    const byteSha256 = textureId.slice("texture/".length), source = sourceByHash.get(byteSha256), roleList = [...roleSet].sort();
    if (roleSet.has("baseColor")) return source
      ? { textureId, roles: roleList, disposition: "render-bound-base-color", source }
      : { textureId, roles: roleList, disposition: "admission-failure", reason: "base-color texture is absent from render-bound decoded samplers" };
    return { textureId, roles: roleList, disposition: "unused-or-non-rgb", reason: "not a base-color input" };
  });
  const unexpected = sources.filter((source) => !roles.has(`texture/${source.byteSha256}`));
  if (unexpected.length) throw new Error(`ASSET_CORPUS_UNREGISTERED_RENDER_TEXTURE: ${unexpected.map((source) => source.byteSha256).join(",")}`);
  const failures = records.filter((record) => record.disposition === "admission-failure");
  if (failures.length) throw new Error(`ASSET_CORPUS_TEXTURE_RECONCILIATION_FAILED: ${failures.map((record) => record.textureId).join(",")}`);
  return records;
}

function scheduleFor(asset, loaded, config) {
  const schedule = config.trajectory.poseSchedule;
  if (!schedule || !Array.isArray(schedule.static) || schedule.static.length !== 1 || schedule.static[0]?.id !== "static" || schedule.animated?.idPrefix !== "clip-" || schedule.animated?.sample !== "midpoint-clamped" || canonical(config.trajectory.occlusionSchedule) !== canonical(config.trajectory.occlusions.map((entry) => entry.id))) throw new Error("ASSET_CORPUS_FROZEN_SCHEDULE_INVALID");
  const poses = loaded.animation?.clips.length
    ? loaded.animation.clips.map((clip) => ({ id: `clip-${clip.index}`, kind: "animated", clip: clip.index, timeSeconds: Math.min(clip.duration * 0.5, config.trajectory.maxAnimationSampleSeconds) }))
    : [{ id: schedule.static[0].id, kind: "static", clip: null, timeSeconds: null }];
  return poses.flatMap((pose) => config.trajectory.occlusions.map((occlusion) => ({ id: `${pose.id}--${occlusion.id}`, pose, occlusion })));
}

function assertFrozenSchedule(asset, loaded, config, variants) {
  const expected = scheduleFor(asset, loaded, config).map((variation) => variation.id);
  const actual = variants.map((variant) => variant.id);
  if (canonical(actual) !== canonical(expected)) throw new Error(`ASSET_CORPUS_FROZEN_SCHEDULE_DRIFT: ${asset.id}`);
}

async function preparedPolygons(loaded, pose) {
  if (pose.kind === "static") return loaded.polygons;
  return materializeNodeTextureUrls(loaded.animation.sample(pose.clip, pose.timeSeconds));
}

async function reconstructTraceBoundCameraAuthority(asset, loaded, variation, config) {
  const polygons = await preparedPolygons(loaded, variation.pose);
  try {
    const bindings = expectedFrameBindings(config, variation);
    const cameras = traceBoundCamerasFor(polygons, config, asset.id, bindings).map(cameraMetadata);
    for (const pair of assertExactPairMembership(bindings)) {
      const [keyframe, adjacent] = pair, source = cameras[bindings.indexOf(keyframe)], target = cameras[bindings.indexOf(adjacent)];
      const delta = Math.abs(target.rotX - source.rotX) + Math.abs(target.rotY - source.rotY) + Math.abs(target.zoom - source.zoom);
      if (canonical(source.center) !== canonical(target.center) || canonical(source.target) !== canonical(target.target)
        || source.zoom !== target.zoom || source.rotX !== target.rotX || delta !== adjacent.traceMotionDegrees || delta > traceBoundMotion(config).max) throw new Error("ASSET_CORPUS_TRACE_CAMERA_REBOUND");
    }
    return { bindings, cameras };
  } finally { if (variation.pose.kind === "animated") releaseNodeTextureUrls(polygons); }
}

function stableFrameId(index) { return `frame-${String(index).padStart(3, "0")}`; }

function expectedFrameBindings(config, variant) { return traceFrameBindings(config, variant); }

function controlsTrajectory(config, asset, variant) {
  const bindings = expectedFrameBindings(config, variant);
  return { id: config.trajectory.id, seed: config.trajectory.seed, traceAuthority: config.trajectory.traceAuthority, variation: { id: variant.id, pose: variant.pose, occlusion: variant.occlusion }, anchors: config.trajectory.anchors, steps: config.trajectory.steps, lighting: config.trajectory.lighting, frames: bindings, assetId: asset.id, split: asset.split, splitGroupId: asset.splitGroupId, staticPose: variant.pose.kind === "static" ? "not-applicable-no-animation" : null };
}

export function validateAssetCorpusRenderRecipe(config) {
  const raster = config?.modelRaster;
  if (config?.schemaVersion !== "glyph-asset-corpus-config/v3" || config.supersample !== 1
    || canonical(config.grid) !== canonical({ cols: 256, rows: 128, cellAspect: 2 })
    || config.trajectory?.margin !== 0.05
    || raster?.id !== "glyph-model-raster/physical-cell-letterbox-v1"
    || canonical(raster.source) !== canonical(config.grid)
    || raster.width !== 256 || raster.height !== 256 || raster.fit !== "contain"
    || raster.targetSampling !== "nearest" || raster.discreteControlSampling !== "nearest"
    || raster.continuousControlSampling !== "nearest" || raster.latentContinuousSampling !== "bilinear") {
    throw new Error("ASSET_CORPUS_CONFIG_INVALID_OR_SUPERSAMPLED");
  }
  traceBoundMotion(config); assertExactPairMembership(traceFrameBindings(config, { pose: { id: "static" }, occlusion: { id: "none" } }));
}

async function writeOrReuseControls(destination, frames, normalization, trajectory) {
  const manifestPath = join(destination, "manifest.json");
  if (await exists(manifestPath)) {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    await verifyControlManifest(destination, manifest);
    if (manifest.schemaVersion !== "glyph-control-export/v2" || manifest.appearanceRgb !== "albedo-and-target"
      || manifest.scene.contentSha256 !== frames[0].metadata.scene.contentSha256
      || manifest.scene.geometrySha256 !== frames[0].metadata.scene.geometrySha256
      || canonical(manifest.normalization) !== canonical(normalization)
      || canonical(manifest.trajectory) !== canonical(trajectory)
      || manifest.frames.length !== frames.length
      || manifest.frames.some((frame, index) => frame.id !== stableFrameId(index)
        || typeof frame.files["albedo-rgb-u32"] !== "string"
        || typeof frame.files["target-rgb-u32"] !== "string")) throw new Error(`ASSET_CORPUS_CONTROL_RESUME_MISMATCH: ${destination}`);
    return { manifest };
  }
  return writeGlyphControlMaps({ destination, frames: frames.map((frame, index) => ({ frame, id: stableFrameId(index) })), normalization, trajectory, appearanceRgb: "albedo-and-target" });
}

export function validateControlNormalizationManifest(manifest, normalizationAuthority) {
  if (canonical(manifest.normalization) !== canonical(normalizationAuthority.value)) throw new Error("ASSET_CORPUS_CONTROL_NORMALIZATION_REBOUND");
}

async function verifyControlManifest(destination, manifest) {
  if (manifest.contentSha256 !== sha(canonical(manifest))) throw new Error(`ASSET_CORPUS_CONTROL_MANIFEST_SEAL_INVALID: ${destination}`);
  for (const [path, digest] of Object.entries(manifest.files)) {
    if (sha(await readFile(join(destination, path))) !== digest) throw new Error(`ASSET_CORPUS_CONTROL_PAYLOAD_STALE: ${destination}/${path}`);
  }
}

export async function verifyTargetPngAgainstControls(targetPath, targetRgbPath, coveragePath, cols, rows) {
  const [target, targetRgb, coverage] = await Promise.all([readFile(targetPath), readFile(targetRgbPath), readFile(coveragePath)]);
  const cells = cols * rows;
  if (targetRgb.byteLength !== cells * Uint32Array.BYTES_PER_ELEMENT || coverage.byteLength !== cells) throw new Error(`ASSET_CORPUS_TARGET_CONTROL_SIZE_INVALID: ${targetPath}`);
  const image = await loadImage(target), canvas = createCanvas(cols, rows), context = canvas.getContext("2d");
  if (image.width !== cols || image.height !== rows) throw new Error(`ASSET_CORPUS_TARGET_DIMENSIONS_INVALID: ${targetPath}`);
  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, cols, rows).data;
  for (let cell = 0; cell < cells; cell++) {
    const color = targetRgb.readUInt32LE(cell * Uint32Array.BYTES_PER_ELEMENT), pixel = cell * 4;
    if (pixels[pixel] !== (color >>> 16) || pixels[pixel + 1] !== ((color >>> 8) & 0xff) || pixels[pixel + 2] !== (color & 0xff) || pixels[pixel + 3] !== (coverage[cell] ? 255 : 0)) throw new Error(`ASSET_CORPUS_TARGET_PIXEL_RECONCILIATION_FAILED: ${targetPath}/${cell}`);
  }
}

async function renderAsset(asset, config, registry, dictionary, controlNormalization, decoderParity, report, classId, syntheticOccluderClassId, populationName = "exact-rgb") {
  const materialOnly = populationName === "material-only";
  const material = materialOnly ? materialOnlyProvenance(asset) : null;
  const source = resolve(root, "../..", asset.canonicalPath);
  const loaded = await loadMeshFromFile(source, { preserveTextures: true, solidTextureSamples: false });
  try {
    const variants = [];
    for (const variation of scheduleFor(asset, loaded, config)) {
      const bindings = expectedFrameBindings(config, variation);
      assertExactPairMembership(bindings);
      const original = await preparedPolygons(loaded, variation.pose);
      const cameras = traceBoundCamerasFor(original, config, asset.id, bindings);
      // `original` owns any embedded GLB image bytes through the Node decoder's
      // WeakMap. Decode before appending the untextured occluder so no copied
      // polygon array becomes a second hidden texture authority.
      const bundle = materialOnly ? { samplers: new Map(), sources: [] } : await buildNodeTextureSamplerBundle(original);
      if (!materialOnly && !bundle.samplers.size) throw new Error(`ASSET_TEXTURE_DECODE_FAILED: ${asset.canonicalPath}`);
      const reconciliation = materialOnly ? material : reconcileTextures(asset, bundle.sources);
      const baseScene = sceneFor(asset, original, dictionary, original.length, classId, syntheticOccluderClassId);
      const baseFrames = bindings.map((binding) => {
        const lighting = config.trajectory.lighting.find((entry) => entry.id === binding.lightingId);
        const cameraState = cameras[bindings.indexOf(binding)];
        return buildGlyphControlFrame({ polygons: original, scene: baseScene, dictionary, camera: cameraState, grid: config.grid, doubleSided: true, supersample: config.supersample, textureSamplers: bundle.samplers, directionalLight: lighting.directional, ambientLight: lighting.ambient, shadow: lighting.shadow, castShadowFlags: original.map(() => false), receiveShadowFlags: original.map(() => true) });
      });
      const directShadowReceivers = new Map();
      for (let lightingIndex = 0; lightingIndex < config.trajectory.lighting.length; lightingIndex++) {
        const lighting = config.trajectory.lighting[lightingIndex];
        if (!lighting.shadow || lighting.shadow.opacity <= 0) continue;
        const receiversByWinner = new Map();
        for (let frameIndex = 0; frameIndex < bindings.length; frameIndex++) {
          if (bindings[frameIndex].lightingId !== lighting.id) continue;
          const frame = baseFrames[frameIndex];
          for (let cell = 0; cell < frame.coverage.length; cell++) {
            const winner = frame.winnerPolygon[cell];
            if (!frame.coverage[cell] || winner < 0 || !(frame.shade[cell] > lighting.ambient.intensity)) continue;
            const point = [frame.worldPosition[cell * 3], frame.worldPosition[cell * 3 + 1], frame.worldPosition[cell * 3 + 2]];
            if (point.every(Number.isFinite) && !receiversByWinner.has(winner)) receiversByWinner.set(winner, point);
          }
        }
        directShadowReceivers.set(lighting.id, [...receiversByWinner.values()]);
      }
      const polygons = variation.occlusion.id === "none" ? original : [...original, ...occludersFor(original, config.trajectory.lighting, directShadowReceivers)];
      const scene = sceneFor(asset, polygons, dictionary, original.length, classId, syntheticOccluderClassId);
      const frames = bindings.map((binding) => {
        const lighting = config.trajectory.lighting.find((entry) => entry.id === binding.lightingId);
        const cameraState = cameras[bindings.indexOf(binding)];
        return buildGlyphControlFrame({ polygons, scene, dictionary, camera: cameraState, grid: config.grid, doubleSided: true, supersample: config.supersample, textureSamplers: bundle.samplers, directionalLight: lighting.directional, ambientLight: lighting.ambient, shadow: lighting.shadow, castShadowFlags: polygons.map((_, index) => index >= original.length), receiveShadowFlags: polygons.map((_, index) => index < original.length) });
      });
      if (config.trajectory.lighting.length > 1) {
        const changed = config.trajectory.anchors.some((anchor) => {
          const first = frames.find((_, index) => bindings[index].anchorId === anchor.id && bindings[index].lightingId === config.trajectory.lighting[0].id && bindings[index].role === "keyframe");
          const second = frames.find((_, index) => bindings[index].anchorId === anchor.id && bindings[index].lightingId === config.trajectory.lighting[1].id && bindings[index].role === "keyframe");
          return Array.from(first.coverage).some((covered, cell) => covered && first.winnerPolygon[cell] < original.length && second.winnerPolygon[cell] === first.winnerPolygon[cell] && first.targetRgb[cell] !== second.targetRgb[cell]);
        });
        if (!changed) throw new Error(`ASSET_CORPUS_LIGHTING_CAUSALITY_ABSENT: ${asset.id}/${variation.id}`);
      }
      if (variation.occlusion.id !== "none") {
        const overlaps = frames.some((frame, frameIndex) => Array.from(frame.coverage).some((covered, cell) => covered && frame.winnerPolygon[cell] >= original.length && baseFrames[frameIndex].coverage[cell] && frame.targetRgb[cell] !== baseFrames[frameIndex].targetRgb[cell]));
        if (!overlaps) throw new Error(`ASSET_CORPUS_OCCLUSION_NOT_CAUSAL: ${asset.id}/${variation.id}`);
        const shadowInterventions = [];
        for (let lightingIndex = 0; lightingIndex < config.trajectory.lighting.length; lightingIndex++) {
          const lighting = config.trajectory.lighting[lightingIndex];
          if (!lighting.shadow || lighting.shadow.opacity <= 0) continue;
          const directReceiverCount = directShadowReceivers.get(lighting.id)?.length ?? 0;
          if (directReceiverCount === 0) {
            shadowInterventions.push({ lightingId: lighting.id, status: "degenerate-no-visible-direct-receiver", directReceiverCount });
            continue;
          }
          const changed = bindings.some((binding, frameIndex) => {
            if (binding.lightingId !== lighting.id) return false;
            const cameraState = cameras[frameIndex];
            const withoutShadow = buildGlyphControlFrame({ polygons, scene, dictionary, camera: cameraState, grid: config.grid, doubleSided: true, supersample: config.supersample, textureSamplers: bundle.samplers, directionalLight: lighting.directional, ambientLight: lighting.ambient, castShadowFlags: polygons.map((_, index) => index >= original.length), receiveShadowFlags: polygons.map((_, index) => index < original.length) });
            const withShadow = frames[frameIndex];
            return Array.from(withShadow.coverage).some((covered, cell) => covered && withShadow.winnerPolygon[cell] < original.length && withoutShadow.winnerPolygon[cell] === withShadow.winnerPolygon[cell] && withShadow.albedoRgb[cell] === withoutShadow.albedoRgb[cell] && withShadow.depth[cell] === withoutShadow.depth[cell] && withShadow.targetRgb[cell] !== withoutShadow.targetRgb[cell]);
          });
          if (!changed) {
            const diagnostics = bindings.filter((binding) => binding.lightingId === lighting.id).map((binding) => {
              const cameraState = cameras[bindings.indexOf(binding)];
              const withoutShadow = buildGlyphControlFrame({ polygons, scene, dictionary, camera: cameraState, grid: config.grid, doubleSided: true, supersample: config.supersample, textureSamplers: bundle.samplers, directionalLight: lighting.directional, ambientLight: lighting.ambient, castShadowFlags: polygons.map((_, index) => index >= original.length), receiveShadowFlags: polygons.map((_, index) => index < original.length) });
              const withShadow = frames[bindings.indexOf(binding)];
              const counts = { originalWinners: 0, casterWinners: 0, stableOriginal: 0, stableAlbedoDepth: 0, shadeChanged: 0, targetChanged: 0 };
              for (let cell = 0; cell < withShadow.coverage.length; cell++) {
                if (withShadow.winnerPolygon[cell] >= original.length) counts.casterWinners++;
                if (withShadow.winnerPolygon[cell] < 0 || withShadow.winnerPolygon[cell] >= original.length) continue;
                counts.originalWinners++;
                if (withoutShadow.winnerPolygon[cell] !== withShadow.winnerPolygon[cell]) continue;
                counts.stableOriginal++;
                if (withShadow.albedoRgb[cell] !== withoutShadow.albedoRgb[cell] || withShadow.depth[cell] !== withoutShadow.depth[cell]) continue;
                counts.stableAlbedoDepth++;
                if (withShadow.shade[cell] !== withoutShadow.shade[cell]) counts.shadeChanged++;
                if (withShadow.targetRgb[cell] !== withoutShadow.targetRgb[cell]) counts.targetChanged++;
              }
              return { anchorId: binding.anchorId, step: binding.step, ...counts };
            });
            throw new Error(`ASSET_CORPUS_SHADOW_CAUSALITY_ABSENT: ${asset.id}/${variation.id}/${lighting.id}/${JSON.stringify(diagnostics)}`);
          }
          shadowInterventions.push({ lightingId: lighting.id, status: "causal", directReceiverCount });
        }
        variation.interventions = { lighting: "causal", occlusion: "causal", shadows: shadowInterventions };
      }
      const destination = join(config.output, asset.id.slice("asset/".length), "variants", variation.id);
      const trajectory = controlsTrajectory(config, asset, variation);
      const controls = await writeOrReuseControls(join(destination, "controls"), frames, controlNormalization.value, trajectory);
      const targets = await Promise.all(frames.map((frame, index) => writeExact(join(destination, `target-${stableFrameId(index)}.png`), targetBytes(frame), "TARGET")));
      variants.push({ id: variation.id, pose: variation.pose, occlusion: variation.occlusion, interventions: variation.interventions ?? { lighting: "causal", occlusion: "not-applicable", shadows: [] }, controlsManifestSha256: controls.manifest.contentSha256, targets, renderGeometrySha256: scene.geometrySha256, polygonOrderSha256: scene.polygonOrderSha256, frames: frames.map((frame, index) => ({ ...bindings[index], camera: frame.metadata.camera, controlSceneSha256: frame.metadata.scene.contentSha256, visibleAsciiSha256: sha(frame.visibleAscii), semanticAsciiSha256: sha(frame.semanticAscii), targetSha256: targets[index], targetPngPath: `target-${stableFrameId(index)}.png`, albedoRgbMapPath: controls.manifest.frames[index].files["albedo-rgb-u32"], targetRgbMapPath: controls.manifest.frames[index].files["target-rgb-u32"], coverageMapPath: controls.manifest.frames[index].files["coverage-u8"] })) });
      variants[variants.length - 1][materialOnly ? "materialProvenance" : "textureReconciliation"] = reconciliation;
      if (variation.pose.kind === "animated") releaseNodeTextureUrls(original);
    }
    assertFrozenSchedule(asset, loaded, config, variants);
    const raw = {
      schemaVersion: materialOnly ? "glyph-material-asset-trajectory/v1" : "glyph-asset-trajectory/v2", population: populationName,
      target: materialOnly ? material : { targetStatus: "exact-rgb" },
      asset: { id: asset.id, canonicalPath: asset.canonicalPath, aliases: asset.aliases, sourcePackIds: asset.sourcePackIds, sourceIds: asset.sourceIds, sourceGeometrySha256: asset.geometry.sha256, textureIds: asset.textureIds, split: asset.split, splitGroupId: asset.splitGroupId },
      renderer: { runtime: report.runtime, configSha256: report.config.sha256, rendererContractSha256: await rendererContractSha(), registrySha256: registry.contentSha256, ...(materialOnly ? { materialProvenance: material } : { assetRenderBindingsSha256: report.assetRenderBindings.contentSha256, assetDecoderParity: { path: decoderParity.path, contentSha256: decoderParity.contentSha256, fileSha256: decoderParity.fileSha256 } }), controlNormalization: { path: controlNormalization.path, contentSha256: controlNormalization.contentSha256, fileSha256: controlNormalization.fileSha256 }, dictionarySha256: dictionary.contentSha256, mappingSha256: report.taxonomy.mappingSha256, classId, supersample: config.supersample, texturePolicy: config.texturePolicy }, variants,
    };
    const sealed = { ...raw, contentSha256: sha(canonical(raw)) }, path = join(config.output, asset.id.slice("asset/".length), "asset-manifest.json");
    await writeExact(path, Buffer.from(json(sealed)), "PROVENANCE");
    return { assetId: asset.id, sourceGeometrySha256: asset.geometry.sha256, provenanceSha256: sha(await readFile(path)), ...(materialOnly ? { target: material } : {}), variants };
  } finally { loaded.dispose(); }
}

async function reconstructMaterialVariantAuthority(asset, loaded, variation, config, dictionary, classId, syntheticOccluderClassId) {
  const original = await preparedPolygons(loaded, variation.pose);
  try {
    const bindings = expectedFrameBindings(config, variation);
    const cameras = traceBoundCamerasFor(original, config, asset.id, bindings);
    const baseScene = sceneFor(asset, original, dictionary, original.length, classId, syntheticOccluderClassId);
    const baseFrames = bindings.map((binding) => {
      const lighting = config.trajectory.lighting.find((entry) => entry.id === binding.lightingId);
      const cameraState = cameras[bindings.indexOf(binding)];
      return buildGlyphControlFrame({ polygons: original, scene: baseScene, dictionary, camera: cameraState, grid: config.grid, doubleSided: true, supersample: config.supersample, textureSamplers: new Map(), directionalLight: lighting.directional, ambientLight: lighting.ambient, shadow: lighting.shadow, castShadowFlags: original.map(() => false), receiveShadowFlags: original.map(() => true) });
    });
    const directShadowReceivers = new Map();
    for (let lightingIndex = 0; lightingIndex < config.trajectory.lighting.length; lightingIndex++) {
      const lighting = config.trajectory.lighting[lightingIndex];
      if (!lighting.shadow || lighting.shadow.opacity <= 0) continue;
      const receiversByWinner = new Map();
      for (let frameIndex = 0; frameIndex < bindings.length; frameIndex++) {
        if (bindings[frameIndex].lightingId !== lighting.id) continue;
        const frame = baseFrames[frameIndex];
        for (let cell = 0; cell < frame.coverage.length; cell++) {
          const winner = frame.winnerPolygon[cell];
          if (!frame.coverage[cell] || winner < 0 || !(frame.shade[cell] > lighting.ambient.intensity)) continue;
          const point = [frame.worldPosition[cell * 3], frame.worldPosition[cell * 3 + 1], frame.worldPosition[cell * 3 + 2]];
          if (point.every(Number.isFinite) && !receiversByWinner.has(winner)) receiversByWinner.set(winner, point);
        }
      }
      directShadowReceivers.set(lighting.id, [...receiversByWinner.values()]);
    }
    const polygons = variation.occlusion.id === "none" ? original : [...original, ...occludersFor(original, config.trajectory.lighting, directShadowReceivers)];
    const scene = sceneFor(asset, polygons, dictionary, original.length, classId, syntheticOccluderClassId);
    return {
      scene,
      cameras: cameras.map(cameraMetadata),
    };
  } finally {
    if (variation.pose.kind === "animated") releaseNodeTextureUrls(original);
  }
}

async function reportBase(configPath, config, registry, dictionary, taxonomy, controlNormalization, limit) {
  validateAssetCorpusRenderRecipe(config);
  await verifyTraceAuthority(config);
  const counts = population(registry), floor = assertPopulation(config, counts), admitted = registry.assets.filter((asset) => asset.admitted && asset.appearanceDisposition === "exact-rgb");
  const assets = limit === null ? admitted : admitted.slice(0, limit), coverage = sourceCoverage(registry);
  if (coverage.length !== 77 || new Set(coverage.filter((entry) => entry.disposition === "scheduled-exact-rgb").map((entry) => entry.canonicalAssetId)).size !== admitted.length) throw new Error("ASSET_CORPUS_SOURCE_CENSUS_DRIFT");
  const assetRenderBindings = await loadAssetRenderBindingAuthority(config, registry);
  const assetDecoderParity = await loadAssetDecoderParityAuthority(config, assetRenderBindings.value, registry);
  return { schemaVersion: "glyph-asset-corpus-report/v2", config: { path: relative(resolve(root, "..", ".."), resolve(root, configPath)).replaceAll("\\\\", "/"), sha256: sha(config.__bytes) }, registry: { contentSha256: registry.contentSha256, usableTextureUvSourceFiles: registry.stats.usableTextureUvSourceFiles }, assetRenderBindings: { path: assetRenderBindings.path, contentSha256: assetRenderBindings.contentSha256 }, assetDecoderParity: { path: assetDecoderParity.path, contentSha256: assetDecoderParity.contentSha256, fileSha256: assetDecoderParity.fileSha256, status: assetDecoderParity.status, pass: assetDecoderParity.pass, complete: assetDecoderParity.complete }, controlNormalization: { path: controlNormalization.path, contentSha256: controlNormalization.contentSha256, fileSha256: controlNormalization.fileSha256 }, taxonomy: { mappingSha256: taxonomy.mapping.contentSha256, dictionarySha256: dictionary.contentSha256 }, texturePolicy: config.texturePolicy, supersample: config.supersample, population: { counts, floor }, assets: { admittedExactRgb: assets.length, expectedAdmittedExactRgb: admitted.length, admittedMaterialOnly: registry.assets.filter((asset) => asset.admitted && asset.appearanceDisposition === "material-only").length, exactRgbTargets: !floor.pass ? "blocked-until-population-floor-pass" : assetDecoderParity.pass ? "ready-for-remote-render" : "blocked-until-decoder-parity-pass", materialOnlyTargets: "material-only-not-rgb-texture" }, sourceCoverage: coverage, rendered: [] };
}

async function materialReportBase(configPath, config, registry, dictionary, taxonomy, controlNormalization, limit) {
  validateAssetCorpusRenderRecipe(config);
  const counts = population(registry), admitted = selectAssetCorpusPopulation(registry, taxonomy, "material-only");
  assertMaterialOnlySplitIsolation(registry, admitted);
  for (const { asset } of admitted) materialOnlyProvenance(asset);
  const assets = limit === null ? admitted : admitted.slice(0, limit);
  if (!assets.length || new Set(assets.map(({ asset }) => asset.id)).size !== assets.length) throw new Error("ASSET_CORPUS_MATERIAL_ONLY_CENSUS_INVALID");
  return {
    schemaVersion: "glyph-material-asset-corpus-report/v1", population: "material-only",
    config: { path: relative(resolve(root, "..", ".."), resolve(root, configPath)).replaceAll("\\\\", "/"), sha256: sha(config.__bytes) },
    output: materialOnlyOutput(config), registry: { contentSha256: registry.contentSha256 },
    controlNormalization: { path: controlNormalization.path, contentSha256: controlNormalization.contentSha256, fileSha256: controlNormalization.fileSha256 },
    taxonomy: { mappingSha256: taxonomy.mapping.contentSha256, dictionarySha256: dictionary.contentSha256 },
    texturePolicy: config.texturePolicy, supersample: config.supersample,
    populationSummary: { counts, admittedMaterialOnly: assets.length, expectedAdmittedMaterialOnly: admitted.length, targetStatus: "material-only-not-exact-rgb", exactRgbEvaluation: "excluded" },
    rendered: [],
  };
}

export async function loadInputs(configPath) {
  const bytes = await readFile(resolve(root, configPath)), config = JSON.parse(bytes); config.__bytes = bytes;
  if (typeof config.assetClassMapping !== "string") throw new Error("ASSET_CORPUS_TAXONOMY_MAPPING_REQUIRED");
  const taxonomy = await loadAssetTaxonomy({ registryPath: config.assetRegistry, dictionaryPath: config.dictionary, mappingPath: config.assetClassMapping });
  const controlNormalization = await loadControlNormalizationAuthority(config);
  return { config, registry: taxonomy.registry, dictionary: taxonomy.dictionary, taxonomy, controlNormalization };
}

const workerContextCache = new Map();

async function loadWorkerContext(configPath, populationName) {
  const key = `${populationName}\0${resolve(configPath)}`;
  if (!workerContextCache.has(key)) {
    workerContextCache.set(key, (async () => {
      const inputs = await loadInputs(configPath);
      const { config, registry, dictionary, taxonomy, controlNormalization } = inputs;
      if (populationName === "exact-rgb") {
        const report = await reportBase(configPath, config, registry, dictionary, taxonomy, controlNormalization, null);
        const binding = await loadAssetRenderBindingAuthority(config, registry);
        const decoderParity = await loadAssetDecoderParityAuthority(config, binding.value, registry);
        if (!decoderParity.pass) throw new Error("ASSET_CORPUS_DECODER_PARITY_REQUIRED_FOR_RENDER");
        return { ...inputs, report, decoderParity };
      }
      const report = await materialReportBase(configPath, config, registry, dictionary, taxonomy, controlNormalization, null);
      return { ...inputs, report, decoderParity: null };
    })());
  }
  return workerContextCache.get(key);
}

export async function renderAssetCorpusWorkerTask(task) {
  if (!task || !["exact-rgb", "material-only"].includes(task.population) || typeof task.configPath !== "string"
    || typeof task.assetId !== "string" || !task.runtime || typeof task.runtime !== "object") {
    throw new Error("ASSET_CORPUS_WORKER_TASK_INVALID");
  }
  const { config, registry, dictionary, taxonomy, controlNormalization, report: baseReport, decoderParity } = await loadWorkerContext(task.configPath, task.population);
  const syntheticOccluder = taxonomy.dictionary.classes.find((entry) => entry.name === "synthetic-occluder");
  if (!syntheticOccluder) throw new Error("ASSET_CORPUS_SYNTHETIC_OCCLUDER_CLASS_REQUIRED");
  if (typeof task.output !== "string" || !task.output) throw new Error("ASSET_CORPUS_WORKER_TASK_INVALID");
  const workerConfig = { ...config, output: task.output };
  const report = { ...baseReport, runtime: task.runtime };
  if (task.population === "exact-rgb") {
    const asset = registry.assets.find((candidate) => candidate.id === task.assetId && candidate.admitted && candidate.appearanceDisposition === "exact-rgb");
    if (!asset) throw new Error(`ASSET_CORPUS_WORKER_ASSET_INVALID: ${task.assetId}`);
    const classId = resolveAssetTaxonomyClass(taxonomy, asset).id;
    return renderAsset(asset, workerConfig, registry, dictionary, controlNormalization, decoderParity, report, classId, syntheticOccluder.id);
  }
  const selected = selectAssetCorpusPopulation(registry, taxonomy, "material-only").find(({ asset }) => asset.id === task.assetId);
  if (!selected) throw new Error(`ASSET_CORPUS_WORKER_ASSET_INVALID: ${task.assetId}`);
  return renderAsset(selected.asset, workerConfig, registry, dictionary, controlNormalization, null, report, selected.classId, syntheticOccluder.id, "material-only");
}

async function createRunStagingRoot(finalOutput) {
  const absolute = resolve(root, finalOutput);
  await mkdir(dirname(absolute), { recursive: true });
  return mkdtemp(`${absolute}.staging-`);
}

async function promoteStagedAssets(stagingOutput, finalOutput, rendered) {
  const finalRoot = resolve(root, finalOutput);
  const backupRoot = `${stagingOutput}.backups`;
  const promoted = [];
  await mkdir(finalRoot, { recursive: true });
  try {
    for (const { assetId } of rendered) {
      const suffix = assetId.slice("asset/".length);
      const staged = join(stagingOutput, suffix), final = join(finalRoot, suffix), backup = join(backupRoot, suffix);
      await mkdir(dirname(final), { recursive: true });
      const operation = { final, backup, installed: false, hadBackup: false };
      if (await exists(final)) {
        await mkdir(dirname(backup), { recursive: true });
        await rename(final, backup);
        operation.hadBackup = true;
      }
      promoted.push(operation);
      await rename(staged, final);
      operation.installed = true;
    }
    await rm(backupRoot, { recursive: true, force: true });
  } catch (error) {
    for (const { final, backup, installed, hadBackup } of promoted.reverse()) {
      if (installed) await rm(final, { recursive: true, force: true });
      if (hadBackup && await exists(backup)) await rename(backup, final);
    }
    throw error;
  } finally {
    await rm(backupRoot, { recursive: true, force: true });
  }
}

export async function runStagedAssetCorpus(finalOutput, renderStaged, validateStaged) {
  if (typeof finalOutput !== "string" || !finalOutput || typeof renderStaged !== "function" || typeof validateStaged !== "function") {
    throw new Error("ASSET_CORPUS_STAGING_TRANSACTION_INVALID");
  }
  const stagingOutput = await createRunStagingRoot(finalOutput);
  try {
    const rendered = await renderStaged(stagingOutput);
    await validateStaged(stagingOutput, rendered);
    await promoteStagedAssets(stagingOutput, finalOutput, rendered);
    return rendered;
  } finally {
    await rm(stagingOutput, { recursive: true, force: true });
  }
}

export function validateRenderedAssetAuthority(rendered, assetManifest, authority) {
  const asset = authority.registry.assets.find((candidate) => candidate.id === rendered.assetId);
  if (!asset || !asset.admitted || asset.appearanceDisposition !== "exact-rgb") throw new Error(`ASSET_CORPUS_RENDERED_UNKNOWN_ASSET: ${rendered.assetId}`);
  const mapping = authority.taxonomy.byAsset.get(asset.id);
  if (!mapping) throw new Error(`ASSET_CORPUS_RENDERED_MAPPING_ABSENT: ${asset.id}`);
  const renderer = assetManifest.renderer;
  if (!renderer || !renderer.assetDecoderParity || !authority.assetDecoderParity || canonical(renderer.runtime) !== canonical(authority.runtime) || renderer.mappingSha256 !== authority.taxonomy.mapping.contentSha256 || renderer.dictionarySha256 !== authority.dictionary.contentSha256 || renderer.registrySha256 !== authority.registry.contentSha256 || renderer.assetRenderBindingsSha256 !== authority.assetRenderBindingsSha256 || canonical(renderer.assetDecoderParity) !== canonical(authority.assetDecoderParity) || canonical(renderer.controlNormalization) !== canonical(authority.controlNormalization) || renderer.configSha256 !== authority.configSha256 || renderer.rendererContractSha256 !== authority.rendererContractSha256 || renderer.classId !== mapping.classId) throw new Error(`ASSET_CORPUS_RENDERED_AUTHORITY_REBOUND: ${asset.id}`);
  const lineage = assetManifest.asset;
  if (!lineage || lineage.id !== asset.id || lineage.canonicalPath !== asset.canonicalPath || canonical(lineage.aliases) !== canonical(asset.aliases) || canonical(lineage.sourcePackIds) !== canonical(asset.sourcePackIds) || canonical(lineage.sourceIds) !== canonical(asset.sourceIds) || canonical(lineage.textureIds) !== canonical(asset.textureIds) || lineage.sourceGeometrySha256 !== asset.geometry.sha256 || lineage.split !== asset.split || lineage.splitGroupId !== asset.splitGroupId) throw new Error(`ASSET_CORPUS_RENDERED_LINEAGE_REBOUND: ${asset.id}`);
}

export function validateMaterialRenderedAssetAuthority(rendered, assetManifest, authority) {
  const asset = authority.registry.assets.find((candidate) => candidate.id === rendered.assetId);
  if (!asset || !asset.admitted || asset.appearanceDisposition !== "material-only") throw new Error(`ASSET_CORPUS_MATERIAL_UNKNOWN_ASSET: ${rendered.assetId}`);
  const mapping = authority.taxonomy.byAsset.get(asset.id);
  if (!mapping) throw new Error(`ASSET_CORPUS_MATERIAL_MAPPING_ABSENT: ${asset.id}`);
  const renderer = assetManifest.renderer;
  if (!renderer || canonical(renderer.runtime) !== canonical(authority.runtime)
    || renderer.configSha256 !== authority.configSha256 || renderer.rendererContractSha256 !== authority.rendererContractSha256
    || renderer.controlNormalization?.path !== authority.controlNormalization.path
    || renderer.controlNormalization?.contentSha256 !== authority.controlNormalization.contentSha256
    || renderer.controlNormalization?.fileSha256 !== authority.controlNormalization.fileSha256
    || renderer.supersample !== authority.supersample || canonical(renderer.texturePolicy) !== canonical(authority.texturePolicy)
    || renderer.mappingSha256 !== authority.taxonomy.mapping.contentSha256
    || renderer.dictionarySha256 !== authority.dictionary.contentSha256 || renderer.registrySha256 !== authority.registry.contentSha256
    || renderer.classId !== mapping.classId) throw new Error(`ASSET_CORPUS_MATERIAL_AUTHORITY_REBOUND: ${asset.id}`);
  const lineage = assetManifest.asset;
  if (rendered.sourceGeometrySha256 !== asset.geometry.sha256 || rendered.sourceGeometrySha256 !== lineage?.sourceGeometrySha256) {
    throw new Error(`ASSET_CORPUS_MATERIAL_GEOMETRY_REBOUND: ${asset.id}`);
  }
  if (!lineage || lineage.id !== asset.id || lineage.canonicalPath !== asset.canonicalPath
    || canonical(lineage.aliases) !== canonical(asset.aliases) || canonical(lineage.sourceIds) !== canonical(asset.sourceIds)
    || canonical(lineage.sourcePackIds) !== canonical(asset.sourcePackIds) || canonical(lineage.textureIds) !== canonical(asset.textureIds)
    || lineage.sourceGeometrySha256 !== asset.geometry.sha256 || lineage.split !== asset.split || lineage.splitGroupId !== asset.splitGroupId) {
    throw new Error(`ASSET_CORPUS_MATERIAL_LINEAGE_REBOUND: ${asset.id}`);
  }
}

export function validateMaterialAssetManifest(rendered, bytes, authority) {
  if (sha(bytes) !== rendered.provenanceSha256) throw new Error(`ASSET_CORPUS_MATERIAL_PROVENANCE_STALE: ${rendered.assetId}`);
  const manifest = JSON.parse(bytes);
  const asset = authority.registry.assets.find((candidate) => candidate.id === rendered.assetId);
  const material = materialOnlyProvenance(asset);
  if (manifest.contentSha256 !== sha(canonical(manifest)) || manifest.schemaVersion !== "glyph-material-asset-trajectory/v1" || manifest.population !== "material-only"
    || canonical(manifest.target) !== canonical(material) || canonical(manifest.renderer?.materialProvenance) !== canonical(material)
    || canonical(manifest.variants) !== canonical(rendered.variants)) {
    throw new Error(`ASSET_CORPUS_MATERIAL_PROVENANCE_INVALID: ${rendered.assetId}`);
  }
  validateMaterialRenderedAssetAuthority(rendered, manifest, authority);
  return { manifest, asset, material };
}

export function validateMaterialControlFrameAuthority(assetId, variant, controls, bindings, index, metadata, supersample, independent) {
  if (canonical(controls.frames.map(({ id }) => id)) !== canonical(bindings.map(({ id }) => id))) {
    throw new Error(`ASSET_CORPUS_MATERIAL_CONTROL_TRAJECTORY_REBOUND: ${assetId}/${variant.id}`);
  }
  const frame = variant.frames[index];
  const expectedCamera = independent.cameras[index], expectedScene = independent.scene;
  if (!frame || canonical(frame.camera) !== canonical(expectedCamera) || canonical(metadata.camera) !== canonical(expectedCamera)
    || frame.controlSceneSha256 !== expectedScene.contentSha256 || metadata.scene?.contentSha256 !== expectedScene.contentSha256
    || variant.renderGeometrySha256 !== expectedScene.geometrySha256 || metadata.scene?.geometrySha256 !== expectedScene.geometrySha256
    || metadata.supersample !== supersample) {
    throw new Error(`ASSET_CORPUS_MATERIAL_FRAME_METADATA_REBOUND: ${assetId}/${variant.id}/${index}`);
  }
}

export function validateAssetCorpusVariantSchedule(assetId, assetManifestVariants, renderedVariants, expectedVariations) {
  const expectedLineage = expectedVariations.map(({ id, pose, occlusion }) => ({ id, pose, occlusion }));
  if (canonical(assetManifestVariants.map(({ id, pose, occlusion }) => ({ id, pose, occlusion }))) !== canonical(expectedLineage) || canonical(renderedVariants.map(({ id, pose, occlusion }) => ({ id, pose, occlusion }))) !== canonical(expectedLineage)) throw new Error(`ASSET_CORPUS_RENDERED_SCHEDULE_REBOUND: ${assetId}`);
  return expectedVariations;
}

export async function validateArtifacts(report, config, registry, dictionary, taxonomy, controlNormalization, selectedIds = null) {
  await verifyTraceAuthority(config);
  if ((!selectedIds && !report.population.floor.pass) || report.rendered.length !== (selectedIds?.length ?? report.assets.expectedAdmittedExactRgb) || report.rendered.some((entry) => entry.rejection)) throw new Error("ASSET_CORPUS_AGGREGATE_PARTIAL_OR_REJECTED");
  const ids = new Set(report.rendered.map((entry) => entry.assetId));
  if (ids.size !== report.rendered.length || (selectedIds ? selectedIds.some((id) => !ids.has(id)) : ids.size !== report.assets.expectedAdmittedExactRgb)) throw new Error("ASSET_CORPUS_AGGREGATE_DUPLICATE_OR_MISSING");
  for (const rendered of report.rendered) {
    const asset = registry.assets.find((candidate) => candidate.id === rendered.assetId);
    if (!asset) throw new Error(`ASSET_CORPUS_RENDERED_UNKNOWN_ASSET: ${rendered.assetId}`);
    const assetRoot = join(config.output, rendered.assetId.slice("asset/".length));
    const manifest = await readFile(join(assetRoot, "asset-manifest.json"));
    if (sha(manifest) !== rendered.provenanceSha256) throw new Error(`ASSET_CORPUS_PROVENANCE_STALE: ${rendered.assetId}`);
    const assetManifest = JSON.parse(manifest);
    if (assetManifest.contentSha256 !== sha(canonical(assetManifest)) || canonical(assetManifest.variants) !== canonical(rendered.variants) || !rendered.variants.length) throw new Error(`ASSET_CORPUS_PROVENANCE_INVALID: ${rendered.assetId}`);
    const assetRenderBindings = await loadAssetRenderBindingAuthority(config, registry);
    const assetDecoderParity = await loadAssetDecoderParityAuthority(config, assetRenderBindings.value, registry);
    if (!assetDecoderParity.pass) throw new Error("ASSET_CORPUS_DECODER_PARITY_REQUIRED_FOR_CHECK");
    validateRenderedAssetAuthority(rendered, assetManifest, { runtime: report.runtime, registry, dictionary, taxonomy, assetRenderBindingsSha256: assetRenderBindings.contentSha256, assetDecoderParity: { path: assetDecoderParity.path, contentSha256: assetDecoderParity.contentSha256, fileSha256: assetDecoderParity.fileSha256 }, controlNormalization: { path: controlNormalization.path, contentSha256: controlNormalization.contentSha256, fileSha256: controlNormalization.fileSha256 }, configSha256: sha(config.__bytes), rendererContractSha256: await rendererContractSha() });
    const source = resolve(root, "../..", asset.canonicalPath);
    const current = await loadMeshFromFile(source, { preserveTextures: true, solidTextureSamples: false });
    let expectedVariations;
    try {
      const decoded = await buildNodeTextureSamplerBundle(current.polygons);
      const reconciliation = reconcileTextures(asset, decoded.sources);
      if (assetManifest.variants.some((variant) => canonical(variant.textureReconciliation) !== canonical(reconciliation))) throw new Error(`ASSET_CORPUS_TEXTURE_RECONCILIATION_STALE: ${rendered.assetId}`);
      expectedVariations = validateAssetCorpusVariantSchedule(rendered.assetId, assetManifest.variants, rendered.variants, scheduleFor(asset, current, config));
    } finally { current.dispose(); }
    for (let variantIndex = 0; variantIndex < rendered.variants.length; variantIndex++) {
      const variant = rendered.variants[variantIndex], expectedVariation = expectedVariations[variantIndex];
      if (!variant || !expectedVariation) throw new Error(`ASSET_CORPUS_RENDERED_SCHEDULE_REBOUND: ${rendered.assetId}`);
      const shadowLightingIds = config.trajectory.lighting.filter((lighting) => lighting.shadow && lighting.shadow.opacity > 0).map((lighting) => lighting.id);
      if (!variant.interventions || variant.interventions.lighting !== "causal"
        || (expectedVariation.occlusion.id === "none"
          ? variant.interventions.occlusion !== "not-applicable" || variant.interventions.shadows.length !== 0
          : variant.interventions.occlusion !== "causal"
            || canonical(variant.interventions.shadows.map((entry) => entry.lightingId)) !== canonical(shadowLightingIds)
            || variant.interventions.shadows.some((entry) => !["causal", "degenerate-no-visible-direct-receiver"].includes(entry.status)
              || !Number.isInteger(entry.directReceiverCount) || entry.directReceiverCount < 0
              || (entry.status === "causal") !== (entry.directReceiverCount > 0)))) {
        throw new Error(`ASSET_CORPUS_INTERVENTION_AUDIT_INVALID: ${rendered.assetId}/${variant.id}`);
      }
      if (variant.frames.length !== expectedFrameBindings(config, expectedVariation).length || variant.targets.length !== variant.frames.length) throw new Error(`ASSET_CORPUS_VARIANT_PARTIAL: ${rendered.assetId}/${variant.id}`);
      const controls = JSON.parse(await readFile(join(assetRoot, "variants", variant.id, "controls", "manifest.json"), "utf8"));
      if (controls.contentSha256 !== variant.controlsManifestSha256 || controls.schemaVersion !== "glyph-control-export/v2" || controls.appearanceRgb !== "albedo-and-target") throw new Error(`ASSET_CORPUS_CONTROL_STALE: ${rendered.assetId}/${variant.id}`);
      await verifyControlManifest(join(assetRoot, "variants", variant.id, "controls"), controls);
      validateControlNormalizationManifest(controls, controlNormalization);
      const frameBindings = expectedFrameBindings(config, expectedVariation);
      if (canonical(variant.frames.map(({ id, anchorId, trackId, pairId, role, stepId, step, cameraId, lightingId, poseId, occlusionId, traceMotionDegrees }) => ({ id, anchorId, trackId, pairId, role, stepId, step, cameraId, lightingId, poseId, occlusionId, traceMotionDegrees }))) !== canonical(frameBindings) || canonical(controls.frames.map((frame) => frame.id)) !== canonical(frameBindings.map((frame) => frame.id)) || canonical(controls.trajectory) !== canonical(controlsTrajectory(config, asset, expectedVariation))) throw new Error(`ASSET_CORPUS_CONTROL_TRAJECTORY_REBOUND: ${rendered.assetId}/${variant.id}`);
      assertExactPairMembership(variant.frames);
      const source = resolve(root, "../..", asset.canonicalPath), independentLoaded = await loadMeshFromFile(source, { preserveTextures: true, solidTextureSamples: false });
      let independent;
      try { independent = await reconstructTraceBoundCameraAuthority(asset, independentLoaded, expectedVariation, config); } finally { independentLoaded.dispose(); }
      for (let index = 0; index < variant.targets.length; index++) {
        const frame = variant.frames[index], controlFrame = controls.frames[index], targetPath = frame?.targetPngPath;
        if (!frame || !controlFrame || targetPath !== `target-${stableFrameId(index)}.png` || frame.targetSha256 !== variant.targets[index] || frame.albedoRgbMapPath !== controlFrame.files["albedo-rgb-u32"] || frame.targetRgbMapPath !== controlFrame.files["target-rgb-u32"] || frame.coverageMapPath !== controlFrame.files["coverage-u8"]) throw new Error(`ASSET_CORPUS_TARGET_MAP_REBOUND: ${rendered.assetId}/${variant.id}/${index}`);
        const target = join(assetRoot, "variants", variant.id, targetPath);
        if (sha(await readFile(target)) !== variant.targets[index]) throw new Error(`ASSET_CORPUS_TARGET_STALE: ${rendered.assetId}/${variant.id}`);
        const metadataPath = controlFrame.files.metadata;
        if (typeof metadataPath !== "string" || canonical(frame.camera) !== canonical(independent.cameras[index])) throw new Error(`ASSET_CORPUS_FRAME_CAMERA_REBOUND: ${rendered.assetId}/${variant.id}/${index}`);
        const metadata = JSON.parse(await readFile(join(assetRoot, "variants", variant.id, "controls", metadataPath), "utf8"));
        if (canonical(metadata.camera) !== canonical(independent.cameras[index])) throw new Error(`ASSET_CORPUS_FRAME_CAMERA_REBOUND: ${rendered.assetId}/${variant.id}/${index}`);
        await verifyTargetPngAgainstControls(target, join(assetRoot, "variants", variant.id, "controls", frame.targetRgbMapPath), join(assetRoot, "variants", variant.id, "controls", frame.coverageMapPath), config.grid.cols, config.grid.rows);
      }
    }
  }
}

export async function validateMaterialArtifacts(report, config, registry, dictionary, taxonomy, controlNormalization) {
  await verifyTraceAuthority(config);
  if (report.population !== "material-only" || report.populationSummary?.targetStatus !== "material-only-not-exact-rgb" || report.populationSummary?.exactRgbEvaluation !== "excluded"
    || report.rendered.length !== report.populationSummary?.expectedAdmittedMaterialOnly || report.rendered.some((entry) => entry.rejection)) throw new Error("ASSET_CORPUS_MATERIAL_AGGREGATE_PARTIAL_OR_REJECTED");
  const expected = selectAssetCorpusPopulation(registry, taxonomy, "material-only");
  const ids = new Set(report.rendered.map((entry) => entry.assetId));
  if (ids.size !== expected.length || expected.some(({ asset }) => !ids.has(asset.id))) throw new Error("ASSET_CORPUS_MATERIAL_AGGREGATE_DUPLICATE_OR_MISSING");
  const renderedAuthority = {
    runtime: report.runtime, registry, dictionary, taxonomy,
    configSha256: sha(config.__bytes), rendererContractSha256: await rendererContractSha(),
    controlNormalization: { path: controlNormalization.path, contentSha256: controlNormalization.contentSha256, fileSha256: controlNormalization.fileSha256 },
    supersample: config.supersample, texturePolicy: config.texturePolicy,
  };
  for (const rendered of report.rendered) {
    const asset = registry.assets.find((candidate) => candidate.id === rendered.assetId);
    const material = materialOnlyProvenance(asset);
    if (canonical(rendered.target) !== canonical(material)) throw new Error(`ASSET_CORPUS_MATERIAL_TARGET_REBOUND: ${rendered.assetId}`);
    const assetRoot = join(config.output, rendered.assetId.slice("asset/".length));
    const bytes = await readFile(join(assetRoot, "asset-manifest.json"));
    const { manifest } = validateMaterialAssetManifest(rendered, bytes, renderedAuthority);
    const current = await loadMeshFromFile(resolve(root, "../..", asset.canonicalPath), { preserveTextures: true, solidTextureSamples: false });
    let expectedVariations, independentAuthorities;
    try {
      if (sha(await readFile(resolve(root, "../..", asset.canonicalPath))) !== asset.geometry.sha256) throw new Error(`ASSET_CORPUS_MATERIAL_GEOMETRY_STALE: ${rendered.assetId}`);
      expectedVariations = scheduleFor(asset, current, config);
      const syntheticOccluder = dictionary.classes.find((entry) => entry.name === "synthetic-occluder");
      const classId = resolveAssetTaxonomyClass(taxonomy, asset).id;
      independentAuthorities = [];
      for (const variation of expectedVariations) {
        const materialAuthority = await reconstructMaterialVariantAuthority(asset, current, variation, config, dictionary, classId, syntheticOccluder.id);
        const cameraAuthority = await reconstructTraceBoundCameraAuthority(asset, current, variation, config);
        if (canonical(materialAuthority.cameras) !== canonical(cameraAuthority.cameras)) throw new Error(`ASSET_CORPUS_MATERIAL_TRACE_CAMERA_REBOUND: ${rendered.assetId}/${variation.id}`);
        independentAuthorities.push(materialAuthority);
      }
    } finally { current.dispose(); }
    validateAssetCorpusVariantSchedule(rendered.assetId, manifest.variants, rendered.variants, expectedVariations);
    for (let variantIndex = 0; variantIndex < rendered.variants.length; variantIndex++) {
      const variant = rendered.variants[variantIndex], expectedVariation = expectedVariations[variantIndex];
      const independent = independentAuthorities[variantIndex];
      if (canonical(variant.materialProvenance) !== canonical(material) || variant.frames.length !== expectedFrameBindings(config, expectedVariation).length || variant.targets.length !== variant.frames.length) throw new Error(`ASSET_CORPUS_MATERIAL_VARIANT_PARTIAL: ${rendered.assetId}/${variant.id}`);
      if (variant.renderGeometrySha256 !== independent.scene.geometrySha256) throw new Error(`ASSET_CORPUS_MATERIAL_RENDER_GEOMETRY_REBOUND: ${rendered.assetId}/${variant.id}`);
      const controlsRoot = join(assetRoot, "variants", variant.id, "controls");
      const controls = JSON.parse(await readFile(join(controlsRoot, "manifest.json"), "utf8"));
      if (controls.contentSha256 !== variant.controlsManifestSha256 || controls.schemaVersion !== "glyph-control-export/v2" || controls.appearanceRgb !== "albedo-and-target") throw new Error(`ASSET_CORPUS_MATERIAL_CONTROL_STALE: ${rendered.assetId}/${variant.id}`);
      await verifyControlManifest(controlsRoot, controls);
      validateControlNormalizationManifest(controls, controlNormalization);
      const bindings = expectedFrameBindings(config, expectedVariation);
      if (canonical(variant.frames.map(({ id, anchorId, trackId, pairId, role, stepId, step, cameraId, lightingId, poseId, occlusionId, traceMotionDegrees }) => ({ id, anchorId, trackId, pairId, role, stepId, step, cameraId, lightingId, poseId, occlusionId, traceMotionDegrees }))) !== canonical(bindings)
        || canonical(controls.trajectory) !== canonical(controlsTrajectory(config, asset, expectedVariation))) throw new Error(`ASSET_CORPUS_MATERIAL_CONTROL_TRAJECTORY_REBOUND: ${rendered.assetId}/${variant.id}`);
      assertExactPairMembership(variant.frames);
      for (let index = 0; index < variant.targets.length; index++) {
        const frame = variant.frames[index], control = controls.frames[index], targetPath = frame?.targetPngPath;
        if (!frame || !control || targetPath !== `target-${stableFrameId(index)}.png` || frame.targetSha256 !== variant.targets[index]
          || frame.albedoRgbMapPath !== control.files["albedo-rgb-u32"] || frame.targetRgbMapPath !== control.files["target-rgb-u32"] || frame.coverageMapPath !== control.files["coverage-u8"]) throw new Error(`ASSET_CORPUS_MATERIAL_TARGET_MAP_REBOUND: ${rendered.assetId}/${variant.id}/${index}`);
        const metadataPath = control.files.metadata;
        if (typeof metadataPath !== "string") throw new Error(`ASSET_CORPUS_MATERIAL_FRAME_METADATA_REBOUND: ${rendered.assetId}/${variant.id}/${index}`);
        const metadata = JSON.parse(await readFile(join(controlsRoot, metadataPath), "utf8"));
        validateMaterialControlFrameAuthority(rendered.assetId, variant, controls, bindings, index, metadata, manifest.renderer.supersample, independent);
        const target = join(assetRoot, "variants", variant.id, targetPath);
        if (sha(await readFile(target)) !== variant.targets[index]) throw new Error(`ASSET_CORPUS_MATERIAL_TARGET_STALE: ${rendered.assetId}/${variant.id}`);
        await verifyTargetPngAgainstControls(target, join(controlsRoot, frame.targetRgbMapPath), join(controlsRoot, frame.coverageMapPath), config.grid.cols, config.grid.rows);
      }
    }
  }
}

export async function renderAssetCorpus(configPath = "config/asset-corpus.json", { write = false, limit = null, review = false, reviewAssets = null } = {}) {
  const { config, registry, dictionary, taxonomy, controlNormalization } = await loadInputs(configPath), report = await reportBase(configPath, config, registry, dictionary, taxonomy, controlNormalization, limit);
  if (!write) return report;
  report.runtime = await imageRuntimeAuthority();
  if (!report.population.floor.pass || (limit !== null && !review) || (review && limit === null && reviewAssets === null)) throw new Error("ASSET_CORPUS_RENDER_REQUIRES_COMPLETE_POPULATION");
  if (review) {
    report.reviewOnly = true;
    report.admissible = false;
    report.reviewReason = "Human visual calibration only; cannot satisfy corpus admission or training authority.";
  }
  if (!report.assetDecoderParity.pass) throw new Error("ASSET_CORPUS_DECODER_PARITY_REQUIRED_FOR_RENDER");
  const syntheticOccluder = taxonomy.dictionary.classes.find((entry) => entry.name === "synthetic-occluder");
  if (!syntheticOccluder) throw new Error("ASSET_CORPUS_SYNTHETIC_OCCLUDER_CLASS_REQUIRED");
  const population = registry.assets.filter((candidate) => candidate.admitted && candidate.appearanceDisposition === "exact-rgb");
  const requested = reviewAssets ? new Set(reviewAssets) : null;
  if (requested && (requested.size !== reviewAssets.length || [...requested].some((id) => !population.some((asset) => asset.id === id)))) throw new Error("ASSET_CORPUS_REVIEW_ASSET_SELECTION_INVALID");
  const selected = (requested ? population.filter((asset) => requested.has(asset.id)) : population).slice(0, limit ?? undefined);
  if (new Set(selected.map((asset) => asset.id)).size !== selected.length) throw new Error("ASSET_CORPUS_WORKER_DUPLICATE_ASSET");
  report.rendered = await runStagedAssetCorpus(config.output, (stagingOutput) =>
    mapAssetCorpusWorkersOrdered(selected.map((asset) => ({
      population: "exact-rgb",
      configPath,
      assetId: asset.id,
      runtime: report.runtime,
      output: stagingOutput,
    }))), async (stagingOutput, rendered) => {
      report.rendered = rendered;
      if (!review) await validateArtifacts(report, { ...config, output: stagingOutput }, registry, dictionary, taxonomy, controlNormalization);
    });
  return report;
}

export async function renderAssetCorpusProof(configPath, assetIds, proofOutput, { write = false } = {}) {
  if (!write || !Array.isArray(assetIds) || !assetIds.length || !proofOutput || new Set(assetIds).size !== assetIds.length) throw new Error("ASSET_CORPUS_PROOF_ARGUMENTS_INVALID");
  const { config, registry, dictionary, taxonomy, controlNormalization } = await loadInputs(configPath);
  const proofRoot = resolve(config.output), resolvedProof = resolve(proofOutput);
  if (!resolvedProof.startsWith(`${proofRoot}${sep}`)) throw new Error("ASSET_CORPUS_PROOF_OUTPUT_OUTSIDE_DATASET_ROOT");
  const population = registry.assets.filter((asset) => asset.admitted && asset.appearanceDisposition === "exact-rgb");
  if (assetIds.some((id) => !population.some((asset) => asset.id === id))) throw new Error("ASSET_CORPUS_PROOF_ASSET_SELECTION_INVALID");
  const report = await reportBase(configPath, config, registry, dictionary, taxonomy, controlNormalization, null); report.runtime = await imageRuntimeAuthority();
  const selected = assetIds.map((id) => population.find((asset) => asset.id === id));
  const rendered = await runStagedAssetCorpus(config.output, (stagingOutput) => mapAssetCorpusWorkersOrdered(selected.map((asset) => ({ population: "exact-rgb", configPath, assetId: asset.id, runtime: report.runtime, output: stagingOutput }))), async (stagingOutput, entries) => {
    report.rendered = entries;
    await validateArtifacts(report, { ...config, output: stagingOutput }, registry, dictionary, taxonomy, controlNormalization, assetIds);
  });
  const raw = { schemaVersion: "glyph-asset-corpus-proof/v1", productionAdmissible: false, config: report.config, registry: report.registry, assetRenderBindings: report.assetRenderBindings, assetDecoderParity: report.assetDecoderParity, taxonomy: report.taxonomy, controlNormalization: report.controlNormalization, runtime: report.runtime, selectedAssetIds: assetIds, rendered };
  const proof = { ...raw, contentSha256: sha(canonical(raw)) };
  await mkdir(dirname(resolvedProof), { recursive: true });
  await writeFile(resolvedProof, json(proof));
  const persisted = JSON.parse(await readFile(resolvedProof, "utf8"));
  if (canonical(persisted) !== canonical(proof) || persisted.contentSha256 !== proof.contentSha256) throw new Error("ASSET_CORPUS_PROOF_WRITE_REBOUND");
  return proof;
}

export async function checkAssetCorpusProof(configPath, assetIds, proofPath) {
  const proof = JSON.parse(await readFile(proofPath, "utf8"));
  if (proof.schemaVersion !== "glyph-asset-corpus-proof/v1" || proof.productionAdmissible !== false || proof.contentSha256 !== sha(canonical(proof)) || canonical(proof.selectedAssetIds) !== canonical(assetIds)) throw new Error("ASSET_CORPUS_PROOF_REBOUND");
  const { config, registry, dictionary, taxonomy, controlNormalization } = await loadInputs(configPath);
  const report = { ...proof, rendered: proof.rendered, population: { floor: { pass: false } }, assets: { expectedAdmittedExactRgb: proof.rendered.length } };
  await validateArtifacts(report, config, registry, dictionary, taxonomy, controlNormalization, assetIds);
  return proof;
}

export async function renderMaterialAssetCorpus(configPath = "config/asset-corpus.json", { write = false, limit = null } = {}) {
  const { config, registry, dictionary, taxonomy, controlNormalization } = await loadInputs(configPath);
  const report = await materialReportBase(configPath, config, registry, dictionary, taxonomy, controlNormalization, limit);
  if (!write) return report;
  report.runtime = await imageRuntimeAuthority();
  if (limit !== null) throw new Error("ASSET_CORPUS_RENDER_REQUIRES_COMPLETE_POPULATION");
  const syntheticOccluder = taxonomy.dictionary.classes.find((entry) => entry.name === "synthetic-occluder");
  if (!syntheticOccluder) throw new Error("ASSET_CORPUS_SYNTHETIC_OCCLUDER_CLASS_REQUIRED");
  const materialConfig = { ...config, output: materialOnlyOutput(config) };
  const selected = selectAssetCorpusPopulation(registry, taxonomy, "material-only");
  if (new Set(selected.map(({ asset }) => asset.id)).size !== selected.length) throw new Error("ASSET_CORPUS_WORKER_DUPLICATE_ASSET");
  report.rendered = await runStagedAssetCorpus(materialConfig.output, (stagingOutput) =>
    mapAssetCorpusWorkersOrdered(selected.map(({ asset }) => ({
      population: "material-only",
      configPath,
      assetId: asset.id,
      runtime: report.runtime,
      output: stagingOutput,
    }))), async (stagingOutput, rendered) => {
      report.rendered = rendered;
      await validateMaterialArtifacts(report, { ...materialConfig, output: stagingOutput }, registry, dictionary, taxonomy, controlNormalization);
    });
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = parseArgs(); if (args.limit !== null && (!(args.limit > 0) || !Number.isInteger(args.limit))) throw new Error("ASSET_CORPUS_LIMIT_INVALID");
  if (args.assetIds || args.proofOutput || args.checkProof) {
    if (args.population !== "exact-rgb" || args.review || args.reviewAssets || args.limit !== null || args.check || args.readiness || (args.render ? !args.assetIds || !args.proofOutput || args.checkProof : !args.checkProof || !args.assetIds || args.proofOutput)) throw new Error("ASSET_CORPUS_PROOF_ARGUMENTS_INVALID");
    if (args.render) process.stdout.write(json(await renderAssetCorpusProof(args.config, args.assetIds, args.proofOutput, { write: true })));
    else process.stdout.write(json(await checkAssetCorpusProof(args.config, args.assetIds, args.checkProof)));
    process.exit(0);
  }
  corpusPopulationName(args.population);
  if (args.population === "material-only" && args.check) {
    const existing = JSON.parse(await readFile(args.check, "utf8")), { config, registry, dictionary, taxonomy, controlNormalization } = await loadInputs(args.config);
    const expected = await materialReportBase(args.config, config, registry, dictionary, taxonomy, controlNormalization, null);
    expected.runtime = await imageRuntimeAuthority();
    const comparable = { ...existing, rendered: [] };
    if (json(comparable) !== json(expected)) throw new Error(`ASSET_CORPUS_MATERIAL_REPORT_DRIFT: ${args.check}`);
    await validateMaterialArtifacts(existing, { ...config, output: materialOnlyOutput(config) }, registry, dictionary, taxonomy, controlNormalization);
    process.stdout.write(json(existing));
  } else if (args.population === "material-only" && args.render) {
    process.stdout.write(json(await renderMaterialAssetCorpus(args.config, { write: true, limit: args.limit })));
  } else if (args.population === "material-only" && args.readiness) {
    const existing = JSON.parse(await readFile(args.readiness, "utf8")), { config, registry, dictionary, taxonomy, controlNormalization } = await loadInputs(args.config);
    const expected = await materialReportBase(args.config, config, registry, dictionary, taxonomy, controlNormalization, null);
    if (json(existing) !== json(expected) || existing.rendered.length !== 0) throw new Error(`ASSET_CORPUS_MATERIAL_READINESS_REPORT_DRIFT: ${args.readiness}`);
    process.stdout.write(json(existing));
  } else if (args.population === "material-only" && !args.readiness) {
    const { registry, taxonomy } = await loadInputs(args.config);
    const assets = selectAssetCorpusPopulation(registry, taxonomy, "material-only");
    process.stdout.write(json({ schemaVersion: "glyph-material-asset-corpus-readiness/v1", population: "material-only", rendered: false, assets: assets.map(({ asset, classId }) => ({ id: asset.id, classId, split: asset.split, splitGroupId: asset.splitGroupId })), mappingSha256: taxonomy.mapping.contentSha256 }));
  } else if (args.check) {
    const existing = JSON.parse(await readFile(args.check, "utf8")), { config, registry, dictionary, taxonomy, controlNormalization } = await loadInputs(args.config), expected = await reportBase(args.config, config, registry, dictionary, taxonomy, controlNormalization, null);
    expected.runtime = await imageRuntimeAuthority();
    if (!expected.assetDecoderParity.pass) throw new Error("ASSET_CORPUS_DECODER_PARITY_REQUIRED_FOR_CHECK");
    const comparable = { ...existing, rendered: [] };
    if (json(comparable) !== json(expected)) throw new Error(`ASSET_CORPUS_REPORT_DRIFT: ${args.check}`);
    await validateArtifacts(existing, config, registry, dictionary, taxonomy, controlNormalization);
    process.stdout.write(json(existing));
  } else if (args.readiness) {
    const existing = JSON.parse(await readFile(args.readiness, "utf8")), { config, registry, dictionary, taxonomy, controlNormalization } = await loadInputs(args.config), expected = await reportBase(args.config, config, registry, dictionary, taxonomy, controlNormalization, null);
    if (json(existing) !== json(expected) || existing.rendered.length !== 0) throw new Error(`ASSET_CORPUS_READINESS_REPORT_DRIFT: ${args.readiness}`);
    process.stdout.write(json(existing));
  } else process.stdout.write(json(await renderAssetCorpus(args.config, { write: args.render, limit: args.limit, review: args.review, reviewAssets: args.reviewAssets })));
}
