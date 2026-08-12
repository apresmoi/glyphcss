/**
 * B45 native rendered-target admission.
 *
 * This deliberately consumes the B44/B48 renderer's immutable artifact tree.
 * It does not render, resize, composite, or synthesize an image.  A target is
 * admitted only when its decoded native PNG pixels reconstruct the paired
 * target-rgb/coverage controls and its complete renderer/asset lineage seals
 * agree with the aggregate report.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { loadMeshFromFile } from "@glyphcss/compile";
import { reprojectGlyphSurfaceAtlas } from "glyphcss";
import Ajv2020 from "ajv/dist/2020.js";
import { canonical, evaluateAdmissionFixture } from "../src/eval/admission.mjs";
import { assertExactPairMembership, traceBoundMotion, traceFrameBindings, verifyTraceAuthority } from "../src/trace-bound-schedule.mjs";

const root = resolve(import.meta.dirname, "..");
const FROZEN_B10 = Object.freeze({
  contractPath: "config/derivations/admission-v1.json", contractSha256: "091a46d4602f7bbdaa5cb0e1109e8adc3d0eadaf7f6b5ac4972801e596fb972e",
  evaluatorPath: "src/eval/admission.mjs", evaluatorSha256: "0f38e5b8834b3b152e273fd6e7f2711350f3208a82abafa3b7a1828829392ce6",
  baselinePath: "reports/eval-baseline.json", baselineSha256: "19b9076113f24e6f42a7a78597bbc10efbc0192268296c65c9dba4ef81a6b598",
});
const HASH = /^[a-f0-9]{64}$/;
const hash = (value) => createHash("sha256").update(value).digest("hex");
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));
const isHash = (value) => typeof value === "string" && HASH.test(value);
const inside = (base, path) => {
  const resolvedBase = resolve(base), resolvedPath = resolve(path);
  if (resolvedPath !== resolvedBase && !resolvedPath.startsWith(`${resolvedBase}${sep}`)) throw new Error("RENDERED_TARGET_PATH_ESCAPE");
  return resolvedPath;
};
const digestCanonical = (value) => hash(canonical(value));
const sealCanonical = (value) => Array.isArray(value)
  ? `[${value.map(sealCanonical).join(",")}]`
  : value && typeof value === "object"
    ? `{${Object.keys(value).filter((key) => key !== "contentSha256").sort().map((key) => `${JSON.stringify(key)}:${sealCanonical(value[key])}`).join(",")}}`
    : JSON.stringify(value);
const digestSeal = (value) => hash(sealCanonical(value));
const assert = (condition, code) => { if (!condition) throw new Error(code); };
let admissionSchemaValidator;
async function validateAdmissionSchema(value) {
  admissionSchemaValidator ??= new Ajv2020({ allErrors: true, strict: true }).compile(await readJson(join(root, "schema/rendered-target-admission.schema.json")));
  assert(admissionSchemaValidator(value), `RENDERED_TARGET_ADMISSION_SCHEMA_INVALID:${new Ajv2020().errorsText(admissionSchemaValidator.errors)}`);
}
export function verifyFrozenB10Bytes({ contractBytes, evaluatorBytes, baselineBytes }) {
  assert(hash(contractBytes) === FROZEN_B10.contractSha256 && hash(evaluatorBytes) === FROZEN_B10.evaluatorSha256
    && hash(baselineBytes) === FROZEN_B10.baselineSha256, "RENDERED_TARGET_B10_FROZEN_AUTHORITY_DRIFT");
  const contract = JSON.parse(contractBytes);
  assert(contract.id === "admission-v1" && contract.contractVersion === "v3" && contract.evaluator === "eq"
    && canonical(Object.keys(contract.thresholds).sort()) === canonical(["correctionMagnitude", "corruption", "crossViewIdentityMismatch", "depthEdgeError", "dictionaryConfusion", "disocclusionRecoveryError", "instanceSurfaceMismatch", "reprojectionValidError", "semanticClassMismatch", "styleDistance", "temporalWarpError", "unintendedAddition", "visibleAsciiMismatch"].sort()),
  "RENDERED_TARGET_B10_CONTRACT_INVALID");
  return { contract, authority: FROZEN_B10 };
}
async function loadFrozenB10() {
  const [contractBytes, evaluatorBytes, baselineBytes] = await Promise.all([
    readFile(join(root, FROZEN_B10.contractPath)), readFile(join(root, FROZEN_B10.evaluatorPath)), readFile(join(root, FROZEN_B10.baselinePath)),
  ]);
  return verifyFrozenB10Bytes({ contractBytes, evaluatorBytes, baselineBytes });
}
async function currentRendererContractSha256() {
  const workspace = resolve(root, "..", ".."), files = [];
  const visit = async (directory) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) files.push(path);
    }
  };
  await Promise.all(["packages/core/src", "packages/glyphcss/src", "packages/compile/src"].map((path) => visit(join(workspace, path))));
  files.push(
    join(root, "src/render-asset-corpus.mjs"),
    join(root, "src/asset-corpus-render-worker.mjs"),
    join(workspace, "pnpm-lock.yaml"),
  );
  const digest = createHash("sha256");
  for (const path of files.sort()) digest.update(relative(workspace, path).replaceAll("\\", "/")).update("\0").update(await readFile(path)).update("\0");
  return digest.digest("hex");
}
async function loadRendererAuthority(config, registry) {
  const file = async (declared, code) => {
    assert(declared && typeof declared.path === "string" && isHash(declared.contentSha256) && isHash(declared.fileSha256), `${code}_DECLARATION_INVALID`);
    const bytes = await readFile(inside(root, resolve(root, declared.path))), value = JSON.parse(bytes);
    assert(hash(bytes) === declared.fileSha256 && digestSeal(value) === declared.contentSha256, `${code}_FILE_REBOUND`);
    return { value, binding: { path: relative(resolve(root, "..", ".."), resolve(root, declared.path)).replaceAll("\\", "/"), contentSha256: declared.contentSha256, fileSha256: declared.fileSha256 } };
  };
  const [bindings, decoder] = await Promise.all([
    file(config.assetRenderBindings, "RENDERED_TARGET_ASSET_BINDINGS"), file(config.assetDecoderParity, "RENDERED_TARGET_DECODER_PARITY"),
  ]);
  assert(bindings.value.registrySha256 === registry.contentSha256 && bindings.value.pass === true
    && decoder.value.registrySha256 === registry.contentSha256 && decoder.value.pass === true && decoder.value.complete === true,
  "RENDERED_TARGET_RENDERER_EXTERNAL_AUTHORITY_INVALID");
  const normalizationPath = inside(root, resolve(root, config.controlNormalization)), normalizationBytes = await readFile(normalizationPath), normalization = JSON.parse(normalizationBytes);
  const dictionaryPath = inside(root, resolve(root, config.dictionary)), dictionaryBytes = await readFile(dictionaryPath), dictionary = JSON.parse(dictionaryBytes);
  const mappingPath = inside(root, resolve(root, config.assetClassMapping)), mappingBytes = await readFile(mappingPath), mapping = JSON.parse(mappingBytes);
  assert(digestSeal(dictionary) === dictionary.contentSha256 && digestSeal(mapping) === mapping.contentSha256
    && mapping.registry?.contentSha256 === registry.contentSha256 && mapping.dictionary?.contentSha256 === dictionary.contentSha256,
  "RENDERED_TARGET_TAXONOMY_AUTHORITY_INVALID");
  return {
    bindings, decoder, normalization: { value: normalization, binding: { path: relative(resolve(root, "..", ".."), normalizationPath).replaceAll("\\", "/"), contentSha256: digestSeal(normalization), fileSha256: hash(normalizationBytes) } },
    dictionary: { value: dictionary, contentSha256: dictionary.contentSha256, fileSha256: hash(dictionaryBytes) },
    mapping: { value: mapping, contentSha256: mapping.contentSha256, fileSha256: hash(mappingBytes) },
    rendererContractSha256: await currentRendererContractSha256(),
  };
}
const CONTROL_ROLES = Object.freeze([
  "visible", "semantic", "selected", "metadata", "indexLookups", "semantic-color-argb", "visible-color-argb",
  "albedo-rgb-u32", "target-rgb-u32", "coverage-u8", "winner-polygon-i32", "class-id-i32", "instance-id-i32",
  "surface-id-i32", "depth-f64", "shade-f32", "normal-f32", "world-position-f32", "surface-uv-f32", "tensorSpec",
  "tensor-keyframe-f32", "depth-normalized-f32", "normal-normalized-f32", "world-position-normalized-f32", "surface-uv-normalized-f32",
]);

function parseArgs(argv = process.argv.slice(2)) {
  const take = (name, fallback = null) => {
    const at = argv.indexOf(name);
    return at < 0 ? fallback : argv[at + 1] ?? (() => { throw new Error(`ARGUMENT_VALUE_REQUIRED:${name}`); })();
  };
  return {
    check: take("--check"), output: take("--output"),
    assetReport: take("--asset-report", join(root, "reports/asset-corpus.json")),
    materialReport: take("--material-report", join(root, "reports/material-asset-corpus.json")),
    datasetRoot: take("--dataset-root"), materialDatasetRoot: take("--material-dataset-root"),
  };
}

async function bytesWithHash(path, expected, code) {
  const bytes = await readFile(path);
  assert(hash(bytes) === expected, code);
  return bytes;
}

async function decodeNativePng(path, width, height) {
  // Canvas is the pinned native decoder used by B44's target integrity check.
  // Keeping it here means a damaged/unsupported PNG cannot quietly become a
  // fabricated array through a permissive JavaScript decoder.
  const image = await loadImage(path);
  assert(image.width === width && image.height === height, "RENDERED_TARGET_DIMENSIONS_MISMATCH");
  const canvas = createCanvas(width, height), context = canvas.getContext("2d");
  context.drawImage(image, 0, 0);
  return Buffer.from(context.getImageData(0, 0, width, height).data);
}

async function verifyClosedControlManifest(controlRoot, manifest, expectedFrameCount) {
  assert(manifest.schemaVersion === "glyph-control-export/v2" && manifest.appearanceRgb === "albedo-and-target"
    && manifest.glyphOutput === "visible" && Array.isArray(manifest.frames) && manifest.frames.length === expectedFrameCount,
  "RENDERED_TARGET_CONTROL_SCHEMA_INVALID");
  assert(digestSeal(manifest) === manifest.contentSha256, "RENDERED_TARGET_CONTROL_MANIFEST_SEAL_INVALID");
  const expectedPaths = new Set(["scene.json", "dictionary.json"]);
  for (const frame of manifest.frames) {
    assert(canonical(Object.keys(frame.files).sort()) === canonical([...CONTROL_ROLES].sort()), "RENDERED_TARGET_CONTROL_ROLE_SET_INVALID");
    assert(frame.transition === null, "RENDERED_TARGET_UNDECLARED_TEMPORAL_CONTROL");
    for (const role of CONTROL_ROLES) {
      const path = frame.files[role];
      assert(typeof path === "string" && path.startsWith(`frames/${frame.id}/`) && !expectedPaths.has(path), `RENDERED_TARGET_CONTROL_ROLE_REBOUND:${role}`);
      expectedPaths.add(path);
    }
  }
  assert(canonical(Object.keys(manifest.files).sort()) === canonical([...expectedPaths].sort()), "RENDERED_TARGET_CONTROL_FILE_CENSUS_INVALID");
  for (const path of [...expectedPaths].sort()) {
    const digest = manifest.files[path];
    assert(isHash(digest), "RENDERED_TARGET_CONTROL_FILE_HASH_INVALID");
    await bytesWithHash(inside(controlRoot, join(controlRoot, path)), digest, `RENDERED_TARGET_CONTROL_HASH_MISMATCH:${path}`);
  }
}

function readI32(bytes, cells, code) {
  assert(bytes.byteLength === cells * 4, code);
  const out = new Array(cells);
  for (let index = 0; index < cells; index++) out[index] = bytes.readInt32LE(index * 4);
  return out;
}
function readU32Rgb(bytes, cells, code) {
  assert(bytes.byteLength === cells * 4, code);
  const out = new Array(cells * 3);
  for (let index = 0; index < cells; index++) {
    const color = bytes.readUInt32LE(index * 4);
    out[index * 3] = (color >>> 16) / 255; out[index * 3 + 1] = ((color >>> 8) & 255) / 255; out[index * 3 + 2] = (color & 255) / 255;
  }
  return out;
}
function readF32Planes(bytes, cells, planes, code) {
  assert(bytes.byteLength === cells * planes * 4, code);
  // The export is NCHW (plane-major); B10 takes one xyz tuple per cell.
  const out = new Array(cells * planes);
  for (let cell = 0; cell < cells; cell++) for (let plane = 0; plane < planes; plane++) out[cell * planes + plane] = bytes.readFloatLE((plane * cells + cell) * 4);
  return out;
}
function readF32(bytes, count, code) {
  assert(bytes.byteLength === count * 4, code); const out = new Float32Array(count);
  for (let index = 0; index < count; index++) out[index] = bytes.readFloatLE(index * 4);
  return out;
}
function readF64(bytes, count, code) {
  assert(bytes.byteLength === count * 8, code); const out = new Float64Array(count);
  for (let index = 0; index < count; index++) out[index] = bytes.readDoubleLE(index * 8);
  return out;
}
function readI32Array(bytes, count, code) { return Int32Array.from(readI32(bytes, count, code)); }
function readU32Array(bytes, count, code) {
  assert(bytes.byteLength === count * 4, code); const out = new Uint32Array(count);
  for (let index = 0; index < count; index++) out[index] = bytes.readUInt32LE(index * 4); return out;
}
const IDENTITY_VIEW_PROJECTION = Object.freeze([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

async function loadControlFrame(controlRoot, controlManifest, frame, expectedFrame) {
  const files = frame.files;
  for (const key of ["visible", "semantic", "coverage-u8", "class-id-i32", "instance-id-i32", "surface-id-i32", "world-position-f32", "target-rgb-u32", "metadata"]) {
    assert(typeof files[key] === "string" && typeof controlManifest.files[files[key]] === "string", `RENDERED_TARGET_CONTROL_ROLE_MISSING:${key}`);
  }
  const file = async (key) => {
    const path = inside(controlRoot, join(controlRoot, files[key]));
    return bytesWithHash(path, controlManifest.files[files[key]], `RENDERED_TARGET_CONTROL_HASH_MISMATCH:${key}`);
  };
  const [visibleRaw, semanticRaw, coverageRaw, winnerRaw, classRaw, instanceRaw, surfaceRaw, depthRaw, shadeRaw, normalRaw, worldRaw, uvRaw,
    visibleColorRaw, semanticColorRaw, albedoRaw, rgbRaw, metadataRaw, lookupsRaw] = await Promise.all([
    file("visible"), file("semantic"), file("coverage-u8"), file("winner-polygon-i32"), file("class-id-i32"), file("instance-id-i32"), file("surface-id-i32"),
    file("depth-f64"), file("shade-f32"), file("normal-f32"), file("world-position-f32"), file("surface-uv-f32"),
    file("visible-color-argb"), file("semantic-color-argb"), file("albedo-rgb-u32"), file("target-rgb-u32"), file("metadata"), file("indexLookups"),
  ]);
  const metadata = JSON.parse(metadataRaw), lookups = JSON.parse(lookupsRaw);
  const cells = metadata.cols * metadata.rows;
  assert(Number.isInteger(metadata.cols) && Number.isInteger(metadata.rows) && metadata.cols > 0 && metadata.rows > 0, "RENDERED_TARGET_CONTROL_GRID_INVALID");
  assert(canonical(metadata.camera) === canonical(expectedFrame.camera), "RENDERED_TARGET_CAMERA_REBOUND");
  assert(metadata.scene?.contentSha256 === expectedFrame.controlSceneSha256, "RENDERED_TARGET_CONTROL_SCENE_REBOUND");
  const visibleAscii = visibleRaw.toString("utf8"), semanticAscii = semanticRaw.toString("utf8");
  assert([...visibleAscii.replaceAll("\n", "")].length === cells && [...semanticAscii.replaceAll("\n", "")].length === cells, "RENDERED_TARGET_ASCII_GRID_MISMATCH");
  assert(hash(visibleAscii) === expectedFrame.visibleAsciiSha256 && hash(semanticAscii) === expectedFrame.semanticAsciiSha256, "RENDERED_TARGET_ASCII_HASH_MISMATCH");
  assert(coverageRaw.byteLength === cells, "RENDERED_TARGET_COVERAGE_SIZE_MISMATCH");
  const coverage = Array.from(coverageRaw, Boolean);
  const winnerPolygon = readI32Array(winnerRaw, cells, "RENDERED_TARGET_WINNER_SIZE_MISMATCH");
  const classId = readI32Array(classRaw, cells, "RENDERED_TARGET_CLASS_SIZE_MISMATCH");
  const instanceId = readI32Array(instanceRaw, cells, "RENDERED_TARGET_INSTANCE_SIZE_MISMATCH");
  const surfaceId = readI32Array(surfaceRaw, cells, "RENDERED_TARGET_SURFACE_SIZE_MISMATCH");
  for (let cell = 0; cell < cells; cell++) assert(coverage[cell] ? classId[cell] >= 0 && instanceId[cell] >= 0 && surfaceId[cell] >= 0 : classId[cell] === -1 && instanceId[cell] === -1 && surfaceId[cell] === -1, "RENDERED_TARGET_WINNER_ALIGNMENT_MISMATCH");
  return {
    metadata, cells, visibleAscii, semanticAscii, coverage, winnerPolygon, classId, instanceId, surfaceId,
    visibleColor: readU32Array(visibleColorRaw, cells, "RENDERED_TARGET_VISIBLE_COLOR_SIZE_MISMATCH"),
    semanticColor: readU32Array(semanticColorRaw, cells, "RENDERED_TARGET_SEMANTIC_COLOR_SIZE_MISMATCH"),
    albedoRgb: readU32Array(albedoRaw, cells, "RENDERED_TARGET_ALBEDO_SIZE_MISMATCH"),
    packedTargetRgb: readU32Array(rgbRaw, cells, "RENDERED_TARGET_RGB_SIZE_MISMATCH"),
    depth: readF64(depthRaw, cells, "RENDERED_TARGET_DEPTH_SIZE_MISMATCH"), shade: readF32(shadeRaw, cells, "RENDERED_TARGET_SHADE_SIZE_MISMATCH"),
    normal: readF32(normalRaw, cells * 3, "RENDERED_TARGET_NORMAL_SIZE_MISMATCH"),
    worldPosition: readF32(worldRaw, cells * 3, "RENDERED_TARGET_WORLD_SIZE_MISMATCH"),
    surfaceUv: readF32(uvRaw, cells * 2, "RENDERED_TARGET_UV_SIZE_MISMATCH"),
    instanceLookup: lookups.instanceLookup, surfaceLookup: lookups.surfaceLookup,
    targetRgb: readU32Rgb(rgbRaw, cells, "RENDERED_TARGET_RGB_SIZE_MISMATCH"),
    targetRgbBytes: rgbRaw, coverageBytes: coverageRaw,
  };
}

function dictionaryFor(frame) {
  const glyphs = [...frame.semanticAscii.replaceAll("\n", "")];
  const dictionary = {};
  for (let cell = 0; cell < frame.cells; cell++) if (frame.coverage[cell]) {
    const glyph = glyphs[cell], classId = frame.classId[cell];
    if (dictionary[glyph] !== undefined && dictionary[glyph] !== classId) throw new Error("RENDERED_TARGET_DICTIONARY_CLASS_CONFLICT");
    dictionary[glyph] = classId;
  }
  return dictionary;
}

function b10Frame(frame, { targetRgb, warpRgb, valid, disocclusion, stateVersion, style }) {
  return {
    visibleAscii: frame.visibleAscii, semanticAscii: frame.semanticAscii, coverage: frame.coverage,
    classId: frame.classId, instanceId: frame.instanceId, surfaceId: frame.surfaceId,
    worldPosition: frame.worldPosition, camera: { viewProjection: IDENTITY_VIEW_PROJECTION },
    style, crossViewIds: frame.surfaceId.map((surface, index) => surface < 0 ? -1 : surface * 1_000_003 + frame.instanceId[index]), stateVersion,
    reprojectionValid: valid, disocclusion,
    warpRgb, targetRgb, correctedRgb: targetRgb,
    sampleSourceSurfaceId: frame.surfaceId.map((id) => id < 0 ? -1 : id),
  };
}

function oracleFrame(frame) {
  return {
    visibleAscii: frame.visibleAscii, semanticAscii: frame.semanticAscii, visibleColor: frame.visibleColor, semanticColor: frame.semanticColor,
    targetRgb: frame.packedTargetRgb, albedoRgb: frame.albedoRgb, coverage: Uint8Array.from(frame.coverage, Number),
    winnerPolygon: frame.winnerPolygon, classId: frame.classId, instanceId: frame.instanceId, surfaceId: frame.surfaceId,
    instanceLookup: frame.instanceLookup, surfaceLookup: frame.surfaceLookup, depth: frame.depth, shade: frame.shade, normal: frame.normal,
    worldPosition: frame.worldPosition, surfaceUv: frame.surfaceUv, metadata: frame.metadata,
  };
}
function nchwRgbToCellMajor(rgb, cells) {
  const out = new Array(cells * 3);
  for (let cell = 0; cell < cells; cell++) { out[cell * 3] = rgb[cell]; out[cell * 3 + 1] = rgb[cells + cell]; out[cell * 3 + 2] = rgb[cells * 2 + cell]; }
  return out;
}

const EXACT_REPROJECTION_SUPPORT_RADIUS = .5;
const EXACT_REPROJECTION_TIE_EPSILON = 1e-7;
const vectorDistance = (left, right) => Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2]);
const uvDistance = (left, right) => Math.hypot(left[0] - right[0], left[1] - right[1]);
const normalAgreement = (left, right) => {
  const leftLength = Math.hypot(...left), rightLength = Math.hypot(...right);
  return leftLength > 0 && rightLength > 0 && (left[0] * right[0] + left[1] * right[1] + left[2] * right[2]) / (leftLength * rightLength);
};
const observationAt = (frame, cell) => ({
  cell,
  surface: frame.surfaceLookup[frame.surfaceId[cell]],
  winner: frame.winnerPolygon[cell],
  uv: [frame.surfaceUv[cell * 2], frame.surfaceUv[cell * 2 + 1]],
  world: [frame.worldPosition[cell * 3], frame.worldPosition[cell * 3 + 1], frame.worldPosition[cell * 3 + 2]],
  normal: [frame.normal[cell * 3], frame.normal[cell * 3 + 1], frame.normal[cell * 3 + 2]],
});
const coordinates = (observation, key) => observation[key];

// A deterministic balanced k-d tree.  Bounds are tested with the same
// Euclidean radius used for a point, so pruning cannot omit an exact nearest
// point or an epsilon tie.  `cell` is only a stable tree-construction tie
// breaker; never a semantic selection rule.
function buildExactSpatialIndex(observations, key, dimensions) {
  if (observations.length === 0) return null;
  let axis = 0, widest = -Infinity;
  for (let candidate = 0; candidate < dimensions; candidate++) {
    let low = Infinity, high = -Infinity;
    for (const observation of observations) { const value = coordinates(observation, key)[candidate]; low = Math.min(low, value); high = Math.max(high, value); }
    if (high - low > widest) { widest = high - low; axis = candidate; }
  }
  const ordered = [...observations].sort((left, right) => coordinates(left, key)[axis] - coordinates(right, key)[axis] || left.cell - right.cell);
  const middle = Math.floor(ordered.length / 2);
  return { observation: ordered[middle], axis, left: buildExactSpatialIndex(ordered.slice(0, middle), key, dimensions), right: buildExactSpatialIndex(ordered.slice(middle + 1), key, dimensions) };
}
function nearestExactPair(index, point, key, dimensions, counter, { excludedCell = null, stopAtZero = false } = {}) {
  let first = null, second = null, stopped = false;
  const consider = (observation, distance) => {
    if (observation.cell === excludedCell) return;
    if (!first || distance + EXACT_REPROJECTION_TIE_EPSILON < first.distance) {
      second = first; first = { observation, distance };
    } else if (observation.cell !== first.observation.cell && (!second || distance < second.distance)) second = { observation, distance };
    // A source support radius of zero is already unusable, so no remaining
    // point can change that conclusion. For target routing, two epsilon-equal
    // nearest observations prove ambiguity without scanning their population.
    if (first?.distance === 0 && stopAtZero) stopped = true;
    if (first?.distance === 0 && second && second.distance <= EXACT_REPROJECTION_TIE_EPSILON) stopped = true;
  };
  const visit = (node) => {
    if (!node || stopped) return;
    const coordinate = coordinates(node.observation, key), delta = point[node.axis] - coordinate[node.axis];
    const near = delta <= 0 ? node.left : node.right, far = delta <= 0 ? node.right : node.left;
    visit(near);
    if (stopped) return;
    const distance = dimensions === 2 ? uvDistance(point, coordinate) : vectorDistance(point, coordinate); counter.distanceEvaluations++;
    consider(node.observation, distance);
    if (!stopped && Math.abs(delta) <= (second?.distance ?? Infinity) + EXACT_REPROJECTION_TIE_EPSILON) visit(far);
  };
  visit(index);
  return { first, second };
}

/**
 * B45's exact-RGB scorer cannot use the presentation atlas's nearest-texel
 * occupancy bit as a validity oracle.  A 64² bin may contain several source
 * samples, and its last writer is traversal-order dependent.  Instead, use
 * the control-frame's exact surface/winner/UV/world/normal lineage to accept
 * only a locally unambiguous source observation.  This deliberately does not
 * read target RGB: changing a target image must never alter its valid mask.
 */
export function deriveExactReprojectionEvidence(sourceFrame, targetFrame, sourceRgb) {
  const sourceCount = sourceFrame.coverage.length, targetCount = targetFrame.coverage.length;
  assert(sourceRgb.length === sourceCount * 3, "RENDERED_TARGET_EXACT_REPROJECTION_RGB_SIZE_MISMATCH");
  const groups = new Map();
  for (let cell = 0; cell < sourceCount; cell++) {
    if (!sourceFrame.coverage[cell] || sourceFrame.winnerPolygon[cell] < 0 || sourceFrame.surfaceId[cell] < 0) continue;
    const observation = observationAt(sourceFrame, cell);
    if (!observation.surface || !observation.uv.every(Number.isFinite) || !observation.world.every(Number.isFinite) || !observation.normal.every(Number.isFinite)) continue;
    const key = `${observation.surface}\u0000${observation.winner}`;
    const group = groups.get(key) ?? { observations: [] };
    group.observations.push(observation); groups.set(key, group);
  }
  const counter = { distanceEvaluations: 0 };
  for (const group of groups.values()) {
    const observations = group.observations;
    // The ordering is canonical only for deterministic diagnostics. Selection
    // itself is geometric and explicitly rejects tied, divergent observations.
    observations.sort((left, right) => left.cell - right.cell);
    group.uvIndex = buildExactSpatialIndex(observations, "uv", 2);
    group.worldIndex = buildExactSpatialIndex(observations, "world", 3);
    for (const observation of observations) {
      observation.nearestUv = nearestExactPair(group.uvIndex, observation.uv, "uv", 2, counter, { excludedCell: observation.cell, stopAtZero: true }).first?.distance ?? Infinity;
      observation.nearestWorld = nearestExactPair(group.worldIndex, observation.world, "world", 3, counter, { excludedCell: observation.cell, stopAtZero: true }).first?.distance ?? Infinity;
    }
  }
  const warpRgb = new Float32Array(targetCount * 3), reprojectionValid = new Float32Array(targetCount), disocclusion = new Float32Array(targetCount), atlasConfidence = new Float32Array(targetCount);
  let routableCellCount = 0;
  for (let cell = 0; cell < targetCount; cell++) {
    if (!targetFrame.coverage[cell] || targetFrame.winnerPolygon[cell] < 0 || targetFrame.surfaceId[cell] < 0) continue;
    const target = observationAt(targetFrame, cell);
    if (!target.surface || !target.uv.every(Number.isFinite) || !target.world.every(Number.isFinite) || !target.normal.every(Number.isFinite)) { disocclusion[cell] = 1; continue; }
    const group = groups.get(`${target.surface}\u0000${target.winner}`);
    if (group) routableCellCount++;
    let selected = null, selectedUvDistance = Infinity, selectedWorldDistance = Infinity, ambiguous = false;
    if (group) {
      const nearestUv = nearestExactPair(group.uvIndex, target.uv, "uv", 2, counter);
      const nearestWorld = nearestExactPair(group.worldIndex, target.world, "world", 3, counter);
      if (nearestUv.first && nearestWorld.first) {
        selected = nearestUv.first.observation; selectedUvDistance = nearestUv.first.distance; selectedWorldDistance = nearestWorld.first.distance;
        ambiguous = (nearestUv.second?.distance ?? Infinity) <= nearestUv.first.distance + EXACT_REPROJECTION_TIE_EPSILON
          || (nearestWorld.second?.distance ?? Infinity) <= nearestWorld.first.distance + EXACT_REPROJECTION_TIE_EPSILON
          || nearestUv.first.observation.cell !== nearestWorld.first.observation.cell;
      }
    }
    if (!selected || ambiguous || !Number.isFinite(selected.nearestUv) || !Number.isFinite(selected.nearestWorld)
      || selectedUvDistance > selected.nearestUv * EXACT_REPROJECTION_SUPPORT_RADIUS
      || selectedWorldDistance > selected.nearestWorld * EXACT_REPROJECTION_SUPPORT_RADIUS
      || normalAgreement(target.normal, selected.normal) < 1 - EXACT_REPROJECTION_TIE_EPSILON) { disocclusion[cell] = 1; continue; }
    const source = selected.cell, sourceOffset = source * 3;
    warpRgb[cell] = sourceRgb[sourceOffset]; warpRgb[targetCount + cell] = sourceRgb[sourceOffset + 1]; warpRgb[targetCount * 2 + cell] = sourceRgb[sourceOffset + 2];
    reprojectionValid[cell] = 1; atlasConfidence[cell] = 1;
  }
  return Object.freeze({ warpRgb, reprojectionValid, disocclusion, atlasConfidence, routableCellCount, distanceEvaluations: counter.distanceEvaluations });
}

function evaluateExactB10Transition(source, next, contract, style, state, sourceStateVersion = null, targetStateVersion = null) {
  assert(source.frame.cells === next.frame.cells, "RENDERED_TARGET_TRANSITION_GRID_REBOUND");
  const stateVersion = targetStateVersion ?? Number.parseInt(next.expectedFrame.id.slice("frame-".length), 10);
  sourceStateVersion ??= Number.parseInt(source.expectedFrame.id.slice("frame-".length), 10);
  assert(Number.isInteger(stateVersion) && Number.isInteger(sourceStateVersion) && stateVersion === sourceStateVersion + 1, "RENDERED_TARGET_FRAME_STATE_INVALID");
  const oracle = reprojectGlyphSurfaceAtlas({ state, sourceFrame: oracleFrame(source.frame), sourceRgb: Float32Array.from(source.decodedRgb),
    sourceStateVersion, targetFrame: oracleFrame(next.frame), targetStateVersion: stateVersion, atlasSize: 64 });
  const exact = deriveExactReprojectionEvidence(source.frame, next.frame, source.decodedRgb);
  const valid = Array.from(exact.reprojectionValid, Boolean), disocclusion = Array.from(exact.disocclusion, Boolean);
  const warpRgb = nchwRgbToCellMajor(exact.warpRgb, next.frame.cells);
  // A populous correspondence opportunity cannot be silently converted into
  // an all-hole temporal oracle. Tiny fixture/geometry cases are allowed to
  // prove disocclusion behavior; real, routable transitions need a material
  // amount of exact local support.
  const validFloor = exact.routableCellCount >= 128 ? Math.max(8, Math.ceil(exact.routableCellCount * .01)) : 0;
  assert(valid.filter(Boolean).length >= validFloor, "RENDERED_TARGET_EXACT_REPROJECTION_DEGENERATE");
  const expected = b10Frame(next.frame, { targetRgb: next.decodedRgb, warpRgb, valid, disocclusion, stateVersion, style });
  // Candidate fields are reconstructed independently from the admitted next
  // frame and decoded image.  No empty patch inherits an expected result.
  const candidate = b10Frame(next.frame, { targetRgb: [...next.decodedRgb], warpRgb: [...warpRgb], valid: [...valid], disocclusion: [...disocclusion], stateVersion, style: [...style] });
  const fixture = { id: "rendered-target-admission/native-v3-transition", dictionary: dictionaryFor(next.frame), thresholds: contract.thresholds,
    reference: expected, cases: [{ id: `${source.expectedFrame.id}--${next.expectedFrame.id}`, kind: "good", candidate }] };
  const evaluation = evaluateAdmissionFixture(fixture), result = evaluation.cases[0];
  // B10's fixture-only `good-has-no-candidate-delta` setup assertion is not an
  // admission rule for real candidates.  The unchanged twelve metric branches
  // and frozen thresholds are authoritative here.
  if (result.failed.length !== 0) {
    const metrics = Object.fromEntries(Object.entries(result.metrics).map(([id, entry]) => [id, { value: entry.value, pass: entry.pass, threshold: entry.threshold }]));
    throw new Error(`RENDERED_TARGET_B10_REJECTED:${JSON.stringify({ sourceFrameId: source.expectedFrame.id, targetFrameId: next.expectedFrame.id, failed: result.failed, metrics, validCellCount: valid.filter(Boolean).length, disoccludedCellCount: disocclusion.filter(Boolean).length })}`);
  }
  return { state: oracle.state, admission: {
    evaluator: contract.id, contractVersion: contract.contractVersion, accepted: true,
    transition: { sourceFrameId: source.expectedFrame.id, targetFrameId: next.expectedFrame.id,
      pairId: source.expectedFrame.pairId, anchorId: source.expectedFrame.anchorId, trackId: source.expectedFrame.trackId,
      sourceRole: source.expectedFrame.role, targetRole: next.expectedFrame.role,
      sourceCameraSha256: digestCanonical(source.expectedFrame.camera), targetCameraSha256: digestCanonical(next.expectedFrame.camera),
      cameraChanged: canonical(source.expectedFrame.camera) !== canonical(next.expectedFrame.camera), validCellCount: valid.filter(Boolean).length,
      disoccludedCellCount: disocclusion.filter(Boolean).length, oracleStateSha256: oracle.state.contentSha256 },
    metrics: Object.fromEntries(Object.entries(result.metrics).map(([id, entry]) => [id, entry.value])),
  } };
}

export function buildExactTransitionLanes(admittedFrames, config) {
  const bindings = admittedFrames.map((frame) => frame.expectedFrame);
  traceBoundMotion(config);
  let pairs;
  try { pairs = assertExactPairMembership(bindings); } catch { throw new Error("RENDERED_TARGET_TRANSITION_PAIR_MEMBERSHIP_REBOUND"); }
  const lanes = pairs.map((pair) => {
    const frames = pair.map((binding) => admittedFrames.find((frame) => frame.expectedFrame.id === binding.id));
    assert(frames.every(Boolean), "RENDERED_TARGET_TRANSITION_LANE_INCOMPLETE");
    assert(frames[0].expectedFrame.anchorId === frames[1].expectedFrame.anchorId
      && frames[0].expectedFrame.lightingId === frames[1].expectedFrame.lightingId
      && frames[0].expectedFrame.trackId === frames[1].expectedFrame.trackId
      && frames[0].expectedFrame.role === "keyframe" && frames[1].expectedFrame.role === "adjacent"
      && frames[1].expectedFrame.step === frames[0].expectedFrame.step + 1,
    "RENDERED_TARGET_TRANSITION_CROSS_ANCHOR_LIGHT_OR_STEP");
    return { pairId: pair[0].pairId, anchorId: pair[0].anchorId, lightingId: pair[0].lightingId, trackId: pair[0].trackId, frames };
  });
  const membership = lanes.flatMap((lane) => lane.frames);
  assert(membership.length === admittedFrames.length && new Set(membership).size === admittedFrames.length, "RENDERED_TARGET_TRANSITION_FRAME_MEMBERSHIP_REBOUND");
  return lanes;
}

async function admitExactFrame({ datasetRoot, aggregateBytes, rendered, assetManifest, variant, expectedFrame, index }) {
  const assetRoot = inside(datasetRoot, join(datasetRoot, rendered.assetId.slice("asset/".length)));
  const variantRoot = inside(assetRoot, join(assetRoot, "variants", variant.id));
  const controlRoot = join(variantRoot, "controls"), controlManifestBytes = await readFile(join(controlRoot, "manifest.json"));
  const controlManifest = JSON.parse(controlManifestBytes);
  await verifyClosedControlManifest(controlRoot, controlManifest, variant.frames.length);
  assert(controlManifest.contentSha256 === variant.controlsManifestSha256, "RENDERED_TARGET_CONTROL_MANIFEST_REBOUND");
  const controlFrame = controlManifest.frames[index];
  assert(controlFrame?.id === expectedFrame.id && controlManifest.trajectory !== null, "RENDERED_TARGET_CONTROL_TRAJECTORY_MISSING");
  const frame = await loadControlFrame(controlRoot, controlManifest, controlFrame, expectedFrame);
  const targetPath = inside(variantRoot, join(variantRoot, expectedFrame.targetPngPath));
  const targetBytes = await bytesWithHash(targetPath, expectedFrame.targetSha256, "RENDERED_TARGET_PNG_HASH_MISMATCH");
  assert(expectedFrame.targetSha256 === variant.targets[index], "RENDERED_TARGET_TARGET_LIST_REBOUND");
  const pixels = await decodeNativePng(targetPath, frame.metadata.cols, frame.metadata.rows);
  const decodedRgb = new Array(frame.cells * 3);
  for (let cell = 0; cell < frame.cells; cell++) {
    const packed = frame.targetRgbBytes.readUInt32LE(cell * 4), pixel = cell * 4;
    assert(pixels[pixel] === (packed >>> 16) && pixels[pixel + 1] === ((packed >>> 8) & 255) && pixels[pixel + 2] === (packed & 255) && pixels[pixel + 3] === (frame.coverage[cell] ? 255 : 0), "RENDERED_TARGET_PIXEL_CONTROL_MISMATCH");
    decodedRgb[cell * 3] = pixels[pixel] / 255; decodedRgb[cell * 3 + 1] = pixels[pixel + 1] / 255; decodedRgb[cell * 3 + 2] = pixels[pixel + 2] / 255;
  }
  const record = {
    assetId: rendered.assetId, variantId: variant.id, frameId: expectedFrame.id, split: assetManifest.asset.split, splitGroupId: assetManifest.asset.splitGroupId,
    target: { path: relative(datasetRoot, targetPath).replaceAll("\\", "/"), sha256: hash(targetBytes), decodedPixelsSha256: hash(pixels), width: frame.metadata.cols, height: frame.metadata.rows },
    controls: { manifestSha256: controlManifest.contentSha256, trajectorySha256: digestCanonical(controlManifest.trajectory), sceneSha256: frame.metadata.scene.contentSha256, visibleAsciiSha256: expectedFrame.visibleAsciiSha256, semanticAsciiSha256: expectedFrame.semanticAsciiSha256, targetRgbSha256: hash(frame.targetRgbBytes), coverageSha256: hash(frame.coverageBytes) },
    provenance: { aggregateReportSha256: hash(aggregateBytes), assetManifestSha256: rendered.provenanceSha256, sourceGeometrySha256: assetManifest.asset.sourceGeometrySha256, textureIds: assetManifest.asset.textureIds, sourcePackIds: assetManifest.asset.sourcePackIds, renderer: assetManifest.renderer, cameraSha256: digestCanonical(expectedFrame.camera), seed: controlManifest.trajectory.seed },
  };
  return { record, frame, decodedRgb, expectedFrame };
}

function validateAggregate(report, bytes, population) {
  assert(report && typeof report === "object", "RENDERED_TARGET_REPORT_INVALID");
  if (population === "exact-rgb") {
    assert(report.schemaVersion === "glyph-asset-corpus-report/v2" && report.assets?.exactRgbTargets === "ready-for-remote-render", "RENDERED_TARGET_EXACT_REPORT_SCHEMA_INVALID");
    assert(Array.isArray(report.rendered) && report.rendered.length === report.assets.expectedAdmittedExactRgb && report.rendered.length > 0, "RENDERED_TARGET_EXACT_REPORT_PARTIAL");
  } else {
    assert(report.schemaVersion === "glyph-material-asset-corpus-report/v1" && report.population === "material-only" && report.populationSummary?.targetStatus === "material-only-not-exact-rgb" && report.populationSummary?.exactRgbEvaluation === "excluded", "RENDERED_TARGET_MATERIAL_REPORT_SCHEMA_INVALID");
    assert(Array.isArray(report.rendered) && report.rendered.length === report.populationSummary.expectedAdmittedMaterialOnly, "RENDERED_TARGET_MATERIAL_REPORT_PARTIAL");
  }
  assert(bytes.length > 0, "RENDERED_TARGET_REPORT_EMPTY");
}

function validateSplitIsolation(records) {
  const groups = new Map();
  for (const record of records) {
    const p = record.provenance;
    for (const key of [record.splitGroupId, p.sourceGeometrySha256, ...p.textureIds, ...p.sourcePackIds]) {
      const prior = groups.get(key); if (prior !== undefined && prior !== record.split) throw new Error("RENDERED_TARGET_CROSS_SPLIT_LEAKAGE");
      groups.set(key, record.split);
    }
  }
}

function expectedFrameBindings(config, variation) {
  return traceFrameBindings(config, variation);
}

async function expectedAssetSchedule(asset, config) {
  const source = inside(resolve(root, "..", ".."), resolve(root, "..", "..", asset.canonicalPath));
  const sourceBytes = await bytesWithHash(source, asset.geometry.sha256, "RENDERED_TARGET_SOURCE_GEOMETRY_HASH_MISMATCH");
  assert(sourceBytes.byteLength === asset.geometry.byteLength, "RENDERED_TARGET_SOURCE_GEOMETRY_SIZE_MISMATCH");
  const loaded = await loadMeshFromFile(source, { preserveTextures: false });
  try {
    const poses = loaded.animation?.clips.length
      ? loaded.animation.clips.map((clip) => ({ id: `clip-${clip.index}`, kind: "animated", clip: clip.index, timeSeconds: Math.min(clip.duration * 0.5, config.trajectory.maxAnimationSampleSeconds) }))
      : [{ id: "static", kind: "static", clip: null, timeSeconds: null }];
    return poses.flatMap((pose) => config.trajectory.occlusions.map((occlusion) => ({ id: `${pose.id}--${occlusion.id}`, pose, occlusion })));
  } finally { loaded.dispose(); }
}

function expectedTrajectory(config, asset, variation) {
  return { id: config.trajectory.id, seed: config.trajectory.seed, traceAuthority: config.trajectory.traceAuthority, variation: { id: variation.id, pose: variation.pose, occlusion: variation.occlusion }, anchors: config.trajectory.anchors, steps: config.trajectory.steps, lighting: config.trajectory.lighting, frames: expectedFrameBindings(config, variation), assetId: asset.id, split: asset.split, splitGroupId: asset.splitGroupId, staticPose: variation.pose.kind === "static" ? "not-applicable-no-animation" : null };
}

function expectedMaterialProvenance(asset) {
  const materials = asset.materials.map(({ name, baseColor, textures }) => ({ name,
    baseColor: baseColor == null ? [1, 1, 1, 1] : baseColor.length === 3 ? [...baseColor, 1] : baseColor,
    baseColorSource: baseColor == null ? "renderer-default-white" : baseColor.length === 3 ? "authored-material-rgb-alpha-one" : "authored-material", textures }));
  assert(materials.every((material) => material.textures.every((texture) => texture.role !== "baseColor" || !texture.textureId)), "RENDERED_TARGET_MATERIAL_RECLASSIFICATION_REQUIRED");
  const baseColors = materials.map(({ name, baseColor, baseColorSource }) => ({ name, baseColor, baseColorSource }));
  return { targetStatus: "material-only-not-exact-rgb", disposition: "material-only-control-derived", colorSource: "authored-material-base-color",
    materialsSha256: digestSeal(materials), baseColorsSha256: digestSeal(baseColors), textureIds: asset.textureIds,
    nonBaseColorTextureIds: materials.flatMap((material) => material.textures.map((texture) => texture.textureId)).filter(Boolean).sort() };
}

async function admitExact({ reportPath, datasetRoot, contract, fixtureAssetIds = null }) {
  const aggregateBytes = await readFile(reportPath), aggregate = JSON.parse(aggregateBytes);
  validateAggregate(aggregate, aggregateBytes, "exact-rgb");
  assert(typeof aggregate.config?.path === "string" && !aggregate.config.path.startsWith("/"), "RENDERED_TARGET_NATIVE_V3_CONFIG_PATH_REQUIRED");
  const configBytes = await readFile(inside(resolve(root, "..", ".."), resolve(root, "..", "..", aggregate.config.path)));
  const config = JSON.parse(configBytes);
  assert(config.schemaVersion === "glyph-asset-corpus-config/v3" && config.id === "asset-corpus/native-v3" && hash(configBytes) === aggregate.config.sha256, "RENDERED_TARGET_NATIVE_V3_CONFIG_REBOUND");
  await verifyTraceAuthority(config);
  assert(typeof config.assetRegistry === "string" && !config.assetRegistry.startsWith("/"), "RENDERED_TARGET_REGISTRY_PATH_REQUIRED");
  const registry = JSON.parse(await readFile(inside(root, resolve(root, config.assetRegistry))));
  assert(digestSeal(registry) === registry.contentSha256 && registry.contentSha256 === aggregate.registry?.contentSha256, "RENDERED_TARGET_REGISTRY_REBOUND");
  const rendererAuthority = await loadRendererAuthority(config, registry);
  assert(aggregate.assetRenderBindings?.contentSha256 === rendererAuthority.bindings.binding.contentSha256
    && aggregate.assetDecoderParity?.contentSha256 === rendererAuthority.decoder.binding.contentSha256
    && aggregate.assetDecoderParity?.fileSha256 === rendererAuthority.decoder.binding.fileSha256
    && canonical(aggregate.controlNormalization) === canonical(rendererAuthority.normalization.binding)
    && aggregate.taxonomy?.dictionarySha256 === rendererAuthority.dictionary.contentSha256
    && aggregate.taxonomy?.mappingSha256 === rendererAuthority.mapping.contentSha256,
  "RENDERED_TARGET_AGGREGATE_EXTERNAL_AUTHORITY_REBOUND");
  const fullPopulation = registry.assets.filter((asset) => asset.admitted && asset.appearanceDisposition === "exact-rgb");
  const expectedAssets = fixtureAssetIds === null ? fullPopulation : fullPopulation.filter((asset) => fixtureAssetIds.includes(asset.id));
  assert(fixtureAssetIds === null || process.env.VITEST === "true" || process.env.NODE_ENV === "test", "RENDERED_TARGET_FIXTURE_AUTHORITY_FORBIDDEN");
  assert(aggregate.rendered.length === expectedAssets.length && aggregate.assets.expectedAdmittedExactRgb === expectedAssets.length
    && aggregate.assets.admittedExactRgb === expectedAssets.length, "RENDERED_TARGET_EXACT_POPULATION_REBOUND");
  const records = [], assetIds = new Set(), targetPixels = new Set();
  for (const rendered of aggregate.rendered) {
    assert(!assetIds.has(rendered.assetId), "RENDERED_TARGET_DUPLICATE_ASSET"); assetIds.add(rendered.assetId);
    const assetRoot = inside(datasetRoot, join(datasetRoot, rendered.assetId.slice("asset/".length)));
    const manifestBytes = await bytesWithHash(join(assetRoot, "asset-manifest.json"), rendered.provenanceSha256, "RENDERED_TARGET_ASSET_MANIFEST_HASH_MISMATCH");
    const assetManifest = JSON.parse(manifestBytes);
    assert(assetManifest.schemaVersion === "glyph-asset-trajectory/v2" && assetManifest.population === "exact-rgb" && assetManifest.target?.targetStatus === "exact-rgb", "RENDERED_TARGET_ASSET_PROVENANCE_INVALID");
    assert(digestSeal(assetManifest) === assetManifest.contentSha256 && canonical(assetManifest.variants) === canonical(rendered.variants), "RENDERED_TARGET_ASSET_MANIFEST_REBOUND");
    assert(assetManifest.renderer?.configSha256 === aggregate.config?.sha256 && assetManifest.renderer?.registrySha256 === aggregate.registry?.contentSha256
      && canonical(assetManifest.renderer?.runtime) === canonical(aggregate.runtime)
      && assetManifest.renderer?.assetRenderBindingsSha256 === aggregate.assetRenderBindings?.contentSha256
      && canonical(assetManifest.renderer?.assetDecoderParity) === canonical({ path: aggregate.assetDecoderParity?.path, contentSha256: aggregate.assetDecoderParity?.contentSha256, fileSha256: aggregate.assetDecoderParity?.fileSha256 })
      && canonical(assetManifest.renderer?.controlNormalization) === canonical(aggregate.controlNormalization)
      && assetManifest.renderer?.dictionarySha256 === aggregate.taxonomy?.dictionarySha256
      && assetManifest.renderer?.mappingSha256 === aggregate.taxonomy?.mappingSha256
      && assetManifest.renderer?.rendererContractSha256 === rendererAuthority.rendererContractSha256, "RENDERED_TARGET_RENDERER_REBOUND");
    const authority = registry.assets?.find((candidate) => candidate.id === rendered.assetId);
    assert(authority?.admitted === true && authority.appearanceDisposition === "exact-rgb" && authority.split === assetManifest.asset?.split && authority.splitGroupId === assetManifest.asset?.splitGroupId
      && authority.geometry?.sha256 === assetManifest.asset?.sourceGeometrySha256 && canonical(authority.textureIds) === canonical(assetManifest.asset?.textureIds)
      && canonical(authority.sourcePackIds) === canonical(assetManifest.asset?.sourcePackIds), "RENDERED_TARGET_ASSET_REGISTRY_REBOUND");
    const classMapping = rendererAuthority.mapping.value.mappings.find((entry) => entry.assetId === authority.id);
    assert(classMapping?.canonicalPath === authority.canonicalPath && classMapping.appearanceDisposition === "exact-rgb"
      && assetManifest.renderer?.classId === classMapping.classId, "RENDERED_TARGET_CLASS_MAPPING_REBOUND");
    const schedule = await expectedAssetSchedule(authority, config);
    assert(canonical(rendered.variants.map(({ id, pose, occlusion }) => ({ id, pose, occlusion }))) === canonical(schedule), "RENDERED_TARGET_VARIANT_SCHEDULE_REBOUND");
    for (let variantIndex = 0; variantIndex < rendered.variants.length; variantIndex++) {
      const variant = rendered.variants[variantIndex], variation = schedule[variantIndex];
      const manifestVariant = assetManifest.variants.find((candidate) => candidate.id === variant.id);
      assert(manifestVariant && canonical(manifestVariant) === canonical(variant), "RENDERED_TARGET_VARIANT_PROVENANCE_REBOUND");
      assert(variant.frames.length === variant.targets.length && variant.frames.length > 0, "RENDERED_TARGET_VARIANT_PARTIAL");
      const expectedBindings = expectedFrameBindings(config, variation);
      assert(canonical(variant.frames.map(({ id, anchorId, trackId, pairId, role, stepId, step, cameraId, lightingId, poseId, occlusionId, traceMotionDegrees }) => ({ id, anchorId, trackId, pairId, role, stepId, step, cameraId, lightingId, poseId, occlusionId, traceMotionDegrees }))) === canonical(expectedBindings), "RENDERED_TARGET_FRAME_SCHEDULE_REBOUND");
      const admittedFrames = [];
      for (let index = 0; index < variant.frames.length; index++) {
        const admitted = await admitExactFrame({ datasetRoot, aggregateBytes, rendered, assetManifest, variant, expectedFrame: variant.frames[index], index });
        assert(!targetPixels.has(admitted.record.target.decodedPixelsSha256), "RENDERED_TARGET_DUPLICATE_PIXELS"); targetPixels.add(admitted.record.target.decodedPixelsSha256); admittedFrames.push(admitted);
      }
      const controlManifest = await readJson(join(datasetRoot, rendered.assetId.slice("asset/".length), "variants", variant.id, "controls", "manifest.json"));
      assert(canonical(controlManifest.trajectory) === canonical(expectedTrajectory(config, authority, variation)), "RENDERED_TARGET_TRAJECTORY_REBOUND");
      const style = [Number.parseInt(hash(canonical({ textures: authority.textureIds, materials: authority.materials })).slice(0, 8), 16) / 0xffffffff];
      const transitions = [], transitionByFrame = new Map();
      for (const { pairId, anchorId, lightingId, trackId, frames: lane } of buildExactTransitionLanes(admittedFrames, config)) {
        let evaluated;
        try {
          // A pair begins with a fresh atlas; anchor jumps never become stateful edges.
          evaluated = evaluateExactB10Transition(lane[0], lane[1], contract, style, null, 0, 1);
        } catch (error) {
          throw new Error(`RENDERED_TARGET_TRANSITION_REJECTED:${JSON.stringify({ assetId: rendered.assetId, variantId: variant.id, pairId, anchorId, trackId, lightingId, sourceFrameId: lane[0].expectedFrame.id, targetFrameId: lane[1].expectedFrame.id })}:${error instanceof Error ? error.message : String(error)}`);
        }
        transitions.push(evaluated.admission);
        assert(evaluated.admission.transition.cameraChanged === true, "RENDERED_TARGET_TRANSITION_CAMERA_UNCHANGED");
        transitionByFrame.set(lane[0].expectedFrame.id, evaluated.admission);
        transitionByFrame.set(lane[1].expectedFrame.id, evaluated.admission);
      }
      assert(transitions.length > 0 && admittedFrames.every((frame) => transitionByFrame.has(frame.expectedFrame.id)), "RENDERED_TARGET_TRAJECTORY_PAIR_MISSING");
      assert(transitions.some((entry) => entry.metrics["temporal-warp-error"] > 0 || entry.metrics["correction-magnitude"] > 0 || entry.transition.disoccludedCellCount > 0), "RENDERED_TARGET_TRAJECTORY_INTERVENTION_UNREACHED");
      for (let index = 0; index < admittedFrames.length; index++) {
        const b10 = transitionByFrame.get(admittedFrames[index].expectedFrame.id);
        records.push({ ...admittedFrames[index].record, b10 });
      }
    }
  }
  assert(expectedAssets.every((asset) => assetIds.has(asset.id)), "RENDERED_TARGET_EXACT_POPULATION_MISSING");
  validateSplitIsolation(records);
  return { reportSha256: hash(aggregateBytes), records };
}

async function inspectMaterial({ reportPath, datasetRoot }) {
  const bytes = await readFile(reportPath), report = JSON.parse(bytes); validateAggregate(report, bytes, "material-only");
  assert(typeof report.config?.path === "string" && !report.config.path.startsWith("/"), "RENDERED_TARGET_MATERIAL_CONFIG_PATH_REQUIRED");
  const configBytes = await readFile(inside(resolve(root, "..", ".."), resolve(root, "..", "..", report.config.path))), config = JSON.parse(configBytes);
  assert(config.schemaVersion === "glyph-asset-corpus-config/v3" && config.id === "asset-corpus/native-v3" && hash(configBytes) === report.config.sha256, "RENDERED_TARGET_MATERIAL_CONFIG_REBOUND");
  await verifyTraceAuthority(config);
  const registry = JSON.parse(await readFile(inside(root, resolve(root, config.assetRegistry))));
  assert(digestSeal(registry) === registry.contentSha256 && registry.contentSha256 === report.registry?.contentSha256, "RENDERED_TARGET_MATERIAL_REGISTRY_REBOUND");
  const rendererAuthority = await loadRendererAuthority(config, registry);
  assert(canonical(report.controlNormalization) === canonical(rendererAuthority.normalization.binding)
    && report.taxonomy?.dictionarySha256 === rendererAuthority.dictionary.contentSha256
    && report.taxonomy?.mappingSha256 === rendererAuthority.mapping.contentSha256,
  "RENDERED_TARGET_MATERIAL_EXTERNAL_AUTHORITY_REBOUND");
  const expectedAssets = registry.assets.filter((asset) => asset.admitted && asset.appearanceDisposition === "material-only");
  assert(report.rendered.length === expectedAssets.length && report.populationSummary.expectedAdmittedMaterialOnly === expectedAssets.length
    && report.populationSummary.admittedMaterialOnly === expectedAssets.length, "RENDERED_TARGET_MATERIAL_POPULATION_REBOUND");
  const records = [], ids = new Set();
  for (const rendered of report.rendered) {
    assert(!ids.has(rendered.assetId), "RENDERED_TARGET_MATERIAL_DUPLICATE_ASSET"); ids.add(rendered.assetId);
    const authority = expectedAssets.find((asset) => asset.id === rendered.assetId);
    assert(authority, "RENDERED_TARGET_MATERIAL_UNKNOWN_ASSET");
    const assetRoot = inside(datasetRoot, join(datasetRoot, rendered.assetId.slice("asset/".length)));
    const manifestBytes = await bytesWithHash(join(assetRoot, "asset-manifest.json"), rendered.provenanceSha256, "RENDERED_TARGET_MATERIAL_MANIFEST_HASH_MISMATCH");
    const manifest = JSON.parse(manifestBytes);
    const material = expectedMaterialProvenance(authority);
    assert(manifest.schemaVersion === "glyph-material-asset-trajectory/v1" && manifest.population === "material-only" && canonical(manifest.target) === canonical(material), "RENDERED_TARGET_MATERIAL_PROVENANCE_INVALID");
    assert(digestSeal(manifest) === manifest.contentSha256 && canonical(manifest.variants) === canonical(rendered.variants), "RENDERED_TARGET_MATERIAL_MANIFEST_REBOUND");
    assert(manifest.asset?.id === authority.id && manifest.asset?.split === authority.split && manifest.asset?.splitGroupId === authority.splitGroupId
      && manifest.asset?.sourceGeometrySha256 === authority.geometry.sha256 && canonical(manifest.asset?.sourcePackIds) === canonical(authority.sourcePackIds)
      && canonical(manifest.asset?.textureIds) === canonical(authority.textureIds), "RENDERED_TARGET_MATERIAL_ASSET_REBOUND");
    assert(manifest.renderer?.configSha256 === report.config.sha256 && manifest.renderer?.registrySha256 === registry.contentSha256
      && canonical(manifest.renderer?.runtime) === canonical(report.runtime) && canonical(manifest.renderer?.controlNormalization) === canonical(report.controlNormalization)
      && manifest.renderer?.dictionarySha256 === report.taxonomy?.dictionarySha256 && manifest.renderer?.mappingSha256 === report.taxonomy?.mappingSha256
      && canonical(manifest.renderer?.materialProvenance) === canonical(material)
      && manifest.renderer?.rendererContractSha256 === rendererAuthority.rendererContractSha256, "RENDERED_TARGET_MATERIAL_RENDERER_REBOUND");
    const classMapping = rendererAuthority.mapping.value.mappings.find((entry) => entry.assetId === authority.id);
    assert(classMapping?.canonicalPath === authority.canonicalPath && classMapping.appearanceDisposition === "material-only"
      && manifest.renderer?.classId === classMapping.classId, "RENDERED_TARGET_MATERIAL_CLASS_MAPPING_REBOUND");
    const schedule = await expectedAssetSchedule(authority, config);
    assert(canonical(rendered.variants.map(({ id, pose, occlusion }) => ({ id, pose, occlusion }))) === canonical(schedule), "RENDERED_TARGET_MATERIAL_VARIANT_SCHEDULE_REBOUND");
    // B48 is intentionally retained as controls/provenance only. It must never
    // pass through B10 exact-RGB evaluation merely because the renderer emitted
    // a convenient flat-color PNG.
    let controlFrameCount = 0;
    for (let variantIndex = 0; variantIndex < rendered.variants.length; variantIndex++) {
      const variant = rendered.variants[variantIndex], variation = schedule[variantIndex];
      assert(variant.frames.length === variant.targets.length && variant.frames.length > 0, "RENDERED_TARGET_MATERIAL_VARIANT_PARTIAL");
      const variantRoot = inside(assetRoot, join(assetRoot, "variants", variant.id)), controlRoot = join(variantRoot, "controls");
      const controlManifest = await readJson(join(controlRoot, "manifest.json")); await verifyClosedControlManifest(controlRoot, controlManifest, variant.frames.length);
      assert(controlManifest.contentSha256 === variant.controlsManifestSha256 && canonical(controlManifest.trajectory) === canonical(expectedTrajectory(config, authority, variation)), "RENDERED_TARGET_MATERIAL_CONTROL_REBOUND");
      assert(canonical(variant.frames.map(({ id, anchorId, trackId, pairId, role, stepId, step, cameraId, lightingId, poseId, occlusionId, traceMotionDegrees }) => ({ id, anchorId, trackId, pairId, role, stepId, step, cameraId, lightingId, poseId, occlusionId, traceMotionDegrees }))) === canonical(expectedFrameBindings(config, variation)), "RENDERED_TARGET_MATERIAL_FRAME_SCHEDULE_REBOUND");
      assertExactPairMembership(variant.frames);
      for (let index = 0; index < variant.frames.length; index++) {
        const expectedFrame = variant.frames[index], frame = await loadControlFrame(controlRoot, controlManifest, controlManifest.frames[index], expectedFrame);
        const targetPath = inside(variantRoot, join(variantRoot, expectedFrame.targetPngPath));
        const targetBytes = await bytesWithHash(targetPath, expectedFrame.targetSha256, "RENDERED_TARGET_MATERIAL_TARGET_HASH_MISMATCH");
        assert(expectedFrame.targetSha256 === variant.targets[index], "RENDERED_TARGET_MATERIAL_TARGET_LIST_REBOUND");
        const pixels = await decodeNativePng(targetPath, frame.metadata.cols, frame.metadata.rows);
        for (let cell = 0; cell < frame.cells; cell++) {
          const packed = frame.targetRgbBytes.readUInt32LE(cell * 4), pixel = cell * 4;
          assert(pixels[pixel] === (packed >>> 16) && pixels[pixel + 1] === ((packed >>> 8) & 255) && pixels[pixel + 2] === (packed & 255) && pixels[pixel + 3] === (frame.coverage[cell] ? 255 : 0), "RENDERED_TARGET_MATERIAL_PIXEL_CONTROL_MISMATCH");
        }
        // Preserve integrity only; `targetBytes` is purposefully not fed to B10.
        assert(hash(targetBytes) === expectedFrame.targetSha256, "RENDERED_TARGET_MATERIAL_TARGET_HASH_MISMATCH"); controlFrameCount++;
      }
    }
    records.push({ assetId: rendered.assetId, split: manifest.asset.split, splitGroupId: manifest.asset.splitGroupId, targetStatus: "material-only-not-exact-rgb", disposition: "excluded-from-exact-rgb-b10", controlFrameCount, assetManifestSha256: rendered.provenanceSha256, sourceGeometrySha256: authority.geometry.sha256, textureIds: authority.textureIds, sourcePackIds: authority.sourcePackIds, materialProvenance: manifest.target });
  }
  assert(expectedAssets.every((asset) => ids.has(asset.id)), "RENDERED_TARGET_MATERIAL_POPULATION_MISSING");
  validateSplitIsolation(records.map((entry) => ({ ...entry, provenance: { sourceGeometrySha256: entry.sourceGeometrySha256, textureIds: entry.textureIds, sourcePackIds: entry.sourcePackIds } })));
  return { status: "excluded-from-exact-rgb-b10", reportSha256: hash(bytes), records };
}

async function defaultDatasetRoots(assetReport, datasetRoot, materialDatasetRoot) {
  if (datasetRoot && materialDatasetRoot) return { datasetRoot, materialDatasetRoot };
  const aggregate = await readJson(assetReport);
  assert(typeof aggregate.config?.path === "string" && !aggregate.config.path.startsWith("/"), "RENDERED_TARGET_NATIVE_V3_CONFIG_PATH_REQUIRED");
  const config = JSON.parse(await readFile(inside(resolve(root, "..", ".."), resolve(root, "..", "..", aggregate.config.path))));
  assert(config.schemaVersion === "glyph-asset-corpus-config/v3" && config.id === "asset-corpus/native-v3" && typeof config.output === "string" && config.output.startsWith("/"), "RENDERED_TARGET_NATIVE_V3_CONFIG_REBOUND");
  return { datasetRoot: datasetRoot ?? config.output, materialDatasetRoot: materialDatasetRoot ?? config.materialOnlyOutput ?? `${config.output}-material-only` };
}

export async function admitRenderedTargets({ assetReport, datasetRoot, materialReport = null, materialDatasetRoot = null } = {}) {
  assert(assetReport, "RENDERED_TARGET_INPUT_REQUIRED");
  materialReport ??= join(root, "reports/material-asset-corpus.json");
  const roots = await defaultDatasetRoots(assetReport, datasetRoot, materialDatasetRoot);
  const { contract, authority } = await loadFrozenB10();
  const exact = await admitExact({ reportPath: resolve(assetReport), datasetRoot: resolve(roots.datasetRoot), contract });
  const material = await inspectMaterial({ reportPath: resolve(materialReport), datasetRoot: resolve(roots.materialDatasetRoot) });
  validateSplitIsolation([...exact.records, ...material.records.map((entry) => ({ ...entry, provenance: { sourceGeometrySha256: entry.sourceGeometrySha256, textureIds: entry.textureIds, sourcePackIds: entry.sourcePackIds } }))]);
  const unsealed = {
    schemaVersion: "glyph-rendered-target-admission/v1", status: "admitted", population: "exact-rgb", b10: { evaluator: "admission-v1", contractVersion: "v3", ...authority },
    exactRgb: { reportSha256: exact.reportSha256, admittedFrameCount: exact.records.length, accepted: exact.records },
    materialOnly: material,
  };
  const report = { ...unsealed, contentSha256: digestSeal(unsealed) };
  await validateAdmissionSchema(report);
  return report;
}

/** Synthetic-fixture entry point. Its result is permanently non-production. */
export async function admitRenderedTargetsFixture({ assetReport, datasetRoot, assetIds }) {
  assert(Array.isArray(assetIds) && assetIds.length > 0, "RENDERED_TARGET_FIXTURE_ASSETS_REQUIRED");
  const { contract } = await loadFrozenB10();
  const exact = await admitExact({ reportPath: resolve(assetReport), datasetRoot: resolve(datasetRoot), contract, fixtureAssetIds: assetIds });
  return { schemaVersion: "glyph-rendered-target-admission-fixture/v1", status: "fixture-only", productionAdmissible: false, exactRgb: { admittedFrameCount: exact.records.length, accepted: exact.records } };
}

async function atomicWrite(path, value) {
  await mkdir(dirname(path), { recursive: true }); const stage = `${path}.stage-${process.pid}`;
  try { await writeFile(stage, json(value)); await rename(stage, path); } finally { await rm(stage, { force: true }); }
}
export async function checkRenderedTargetAdmission(path, options = null) {
  const report = await readJson(path);
  await validateAdmissionSchema(report);
  assert(digestSeal(report) === report.contentSha256, "RENDERED_TARGET_ADMISSION_SEAL_INVALID");
  const { authority } = await loadFrozenB10();
  assert(canonical(report.b10) === canonical({ evaluator: "admission-v1", contractVersion: "v3", ...authority }), "RENDERED_TARGET_ADMISSION_B10_AUTHORITY_REBOUND");
  assert(options?.assetReport, "RENDERED_TARGET_ADMISSION_RECONSTRUCTION_INPUT_REQUIRED");
  const regenerated = await admitRenderedTargets(options);
  assert(canonical(report) === canonical(regenerated), "RENDERED_TARGET_ADMISSION_REPORT_DRIFT");
  return report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs();
  if (args.check) {
    const report = await checkRenderedTargetAdmission(resolve(args.check), { assetReport: args.assetReport, datasetRoot: args.datasetRoot, materialReport: args.materialReport, materialDatasetRoot: args.materialDatasetRoot });
    process.stdout.write(json(report));
  } else {
    assert(args.output && args.datasetRoot, "RENDERED_TARGET_OUTPUT_AND_DATASET_ROOT_REQUIRED");
    const report = await admitRenderedTargets({ assetReport: args.assetReport, datasetRoot: args.datasetRoot, materialReport: args.materialReport, materialDatasetRoot: args.materialDatasetRoot });
    await atomicWrite(resolve(args.output), report); process.stdout.write(json(report));
  }
}
