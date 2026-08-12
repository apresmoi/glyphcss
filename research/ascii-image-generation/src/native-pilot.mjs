import { createHash } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { checkRenderedTargetAdmission } from "../scripts/admit-rendered-targets.mjs";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const researchRoot = resolve(import.meta.dirname, "..");
const canonical = (value) => Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : value && typeof value === "object" ? `{${Object.keys(value).filter((key) => key !== "contentSha256").sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}` : JSON.stringify(value);
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const hashFile = async (path) => sha256(await readFile(path));
const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));
const assert = (value, code) => { if (!value) throw new Error(code); };
const normalPath = (root, path, code) => {
  const result = resolve(root, path);
  assert(result !== root && result.startsWith(`${root}${sep}`), code);
  return result;
};
const writeJson = async (path, value) => {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  await writeFile(temporary, json(value));
  await rename(temporary, path);
};
const count = (map, key, amount = 1) => { map[key] = (map[key] ?? 0) + amount; };
const blank = () => ({ frames: 0, sourcePacks: {}, classes: {}, semanticGlyphs: {}, instances: {}, surfaces: {}, cameras: {}, motions: {}, occlusions: {}, lighting: {}, geometry: {}, textures: {}, textureStatus: {}, appearance: {}, scenes: {}, trajectories: {}, splitGroups: {} });
const add = (target, source) => {
  target.frames += 1;
  for (const [key, value] of Object.entries(source)) if (key !== "frames") for (const item of value) count(target[key], item);
};
const dimensions = (record) => ({
  sourcePacks: record.asset.sourcePackIds,
  classes: [String(record.asset.classId)],
  semanticGlyphs: record.strata.semanticGlyphs,
  instances: record.strata.instances,
  surfaces: record.strata.surfaces,
  cameras: [record.frame.cameraId],
  motions: [record.variant.pose.id],
  occlusions: [record.variant.occlusion.id],
  lighting: [record.frame.lightingId],
  geometry: [record.asset.sourceGeometrySha256],
  textures: record.asset.textureIds,
  textureStatus: ["exact-rgb"],
  appearance: [record.appearancePopulation],
  scenes: [record.sceneSha256],
  trajectories: [record.trajectorySha256],
  splitGroups: [record.asset.splitGroupId],
});
let schemaValidators;
async function validateSchemas(manifest, balance) {
  if (!schemaValidators) {
    const ajv = new Ajv2020({ strict: true, allErrors: true });
    schemaValidators = await Promise.all(["pilot-manifest.schema.json", "pilot-balance.schema.json"].map(async (name) => ajv.compile(await readJson(join(researchRoot, "schema", name)))));
  }
  assert(schemaValidators[0](manifest), `PILOT_NATIVE_MANIFEST_SCHEMA:${JSON.stringify(schemaValidators[0].errors)}`);
  assert(schemaValidators[1](balance), `PILOT_NATIVE_BALANCE_SCHEMA:${JSON.stringify(schemaValidators[1].errors)}`);
}
async function validateB45Schema(report) {
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  const validate = ajv.compile(await readJson(join(researchRoot, "schema/rendered-target-admission.schema.json")));
  assert(validate(report), `PILOT_NATIVE_B45_SCHEMA:${JSON.stringify(validate.errors)}`);
  assert(report.contentSha256 === sha256(canonical(report)), "PILOT_NATIVE_B45_SEAL_INVALID");
}

const B10_METRICS = ["visible-ascii-adherence", "semantic-class-presence", "dictionary-class-confusion", "instance-surface-preservation", "depth-edge-agreement", "unintended-additions", "style-match", "cross-view-identity", "reprojection-valid-error", "disocclusion-recovery", "temporal-warp-error", "correction-magnitude"];
function validateB45Record(source) {
  assert(source && typeof source.assetId === "string" && typeof source.variantId === "string" && typeof source.frameId === "string" && ["train", "validation", "test"].includes(source.split), "PILOT_NATIVE_B45_RECORD_SCHEMA");
  assert(source.b10?.evaluator === "admission-v1" && source.b10.contractVersion === "v3" && source.b10.accepted === true && B10_METRICS.every((key) => Number.isFinite(source.b10.metrics?.[key])), "PILOT_NATIVE_EXACT_B10_REQUIRED");
  assert(source.target?.width === 256 && source.target.height === 128 && /^[a-f0-9]{64}$/.test(source.target.decodedPixelsSha256 ?? ""), "PILOT_NATIVE_B45_TARGET_SCHEMA");
  for (const value of [source.controls?.manifestSha256, source.controls?.trajectorySha256, source.controls?.sceneSha256, source.controls?.visibleAsciiSha256, source.controls?.semanticAsciiSha256, source.controls?.targetRgbSha256, source.controls?.coverageSha256, source.provenance?.aggregateReportSha256, source.provenance?.assetManifestSha256, source.provenance?.sourceGeometrySha256, source.provenance?.cameraSha256]) assert(/^[a-f0-9]{64}$/.test(value ?? ""), "PILOT_NATIVE_B45_HASH_SCHEMA");
  assert(typeof source.provenance.seed === "string" && source.provenance.seed.length > 0 && source.provenance.renderer && typeof source.provenance.renderer === "object", "PILOT_NATIVE_B45_PROVENANCE_SCHEMA");
}

async function verifySealedManifest(path, expectedFileSha256 = null) {
  const bytes = await readFile(path), value = JSON.parse(bytes);
  if (expectedFileSha256 !== null) assert(sha256(bytes) === expectedFileSha256, "PILOT_NATIVE_MANIFEST_FILE_HASH_MISMATCH");
  assert(value.contentSha256 === sha256(canonical(value)), "PILOT_NATIVE_MANIFEST_SEAL_INVALID");
  if (value.files) for (const [file, expected] of Object.entries(value.files)) assert(await hashFile(normalPath(dirname(path), file, "PILOT_NATIVE_CONTROL_FILE_PATH_ESCAPE")) === expected, "PILOT_NATIVE_CONTROL_FILE_HASH_MISMATCH");
  return value;
}

function enforceLeakage(records) {
  const authorities = new Map();
  for (const record of records) for (const key of [record.asset.splitGroupId, ...record.asset.sourcePackIds, record.asset.sourceGeometrySha256, ...record.asset.textureIds, record.target?.sha256, record.sceneSha256, record.trajectorySha256].filter(Boolean)) {
    const prior = authorities.get(key); assert(prior === undefined || prior === record.split, "PILOT_NATIVE_CROSS_SPLIT_LEAKAGE"); authorities.set(key, record.split);
  }
}
export const validateNativePilotLeakage = enforceLeakage;

/**
 * B11's first pilot is intentionally a linker, not another image generator.
 * B45 has already decoded and admitted every exact renderer target.  This step
 * freezes those records into B43's connected split groups and records every
 * non-image material-only item as excluded evidence.
 */
export async function buildNativePilotDataset({ outputRoot, config, admissionReportPath, assetCorpusRoot, assetRegistryPath }) {
  const reportPath = resolve(admissionReportPath), report = await readJson(reportPath);
  await checkRenderedTargetAdmission(reportPath, {
    assetReport: resolve(researchRoot, config.assetReport),
    datasetRoot: resolve(config.assetCorpusRoot),
    materialReport: resolve(researchRoot, config.materialReport),
    materialDatasetRoot: resolve(config.materialDatasetRoot),
  });
  await validateB45Schema(report);
  assert(report.schemaVersion === "glyph-rendered-target-admission/v1" && report.status === "admitted", "PILOT_NATIVE_B45_AUTHORITY_REQUIRED");
  assert(report.population === "exact-rgb" && Array.isArray(report.exactRgb?.accepted) && Array.isArray(report.materialOnly?.records), "PILOT_NATIVE_B45_RECORDS_REQUIRED");
  assert(report.exactRgb.admittedFrameCount === report.exactRgb.accepted.length && report.exactRgb.accepted.length > 0 && report.b10?.evaluator === "admission-v1" && report.b10.contractVersion === "v3", "PILOT_NATIVE_B45_SCHEMA_INVALID");
  const root = resolve(outputRoot), sourceRoot = resolve(assetCorpusRoot);
  const registry = await readJson(assetRegistryPath);
  assert(registry.contentSha256 === sha256(canonical(registry)) && registry.stats?.usableTextureUvSourceFiles === 77, "PILOT_NATIVE_B43_REGISTRY_REQUIRED");
  const reportSha256 = await hashFile(reportPath), records = [], seen = new Set(), balances = new Map();
  for (const source of report.exactRgb.accepted) {
    validateB45Record(source);
    const key = `${source.assetId}\0${source.variantId}\0${source.frameId}`;
    assert(!seen.has(key), "PILOT_NATIVE_DUPLICATE_FRAME"); seen.add(key);
    assert(source.split && source.splitGroupId && source.provenance?.sourceGeometrySha256 && Array.isArray(source.provenance.sourcePackIds) && Array.isArray(source.provenance.textureIds), "PILOT_NATIVE_B43_LINEAGE_REQUIRED");
    assert(source.target?.path && /^[a-f0-9]{64}$/.test(source.target.sha256 ?? "") && /^[a-f0-9]{64}$/.test(source.controls?.manifestSha256 ?? ""), "PILOT_NATIVE_ARTIFACT_BINDING_REQUIRED");
    const targetPath = normalPath(sourceRoot, source.target.path, "PILOT_NATIVE_TARGET_PATH_ESCAPE");
    const assetDirectory = join(sourceRoot, source.assetId.slice("asset/".length));
    const assetManifestPath = join(assetDirectory, "asset-manifest.json"), assetManifest = await verifySealedManifest(assetManifestPath, source.provenance.assetManifestSha256);
    const registryAsset = registry.assets.find((candidate) => candidate.id === source.assetId);
    assert(registryAsset?.admitted === true && registryAsset.appearanceDisposition === "exact-rgb" && registryAsset.split === source.split && registryAsset.splitGroupId === source.splitGroupId && registryAsset.geometry.sha256 === source.provenance.sourceGeometrySha256 && canonical(registryAsset.textureIds) === canonical(source.provenance.textureIds) && canonical(registryAsset.sourcePackIds) === canonical(source.provenance.sourcePackIds), "PILOT_NATIVE_B43_RECORD_REBOUND");
    const variant = assetManifest.variants.find((candidate) => candidate.id === source.variantId);
    const frame = variant?.frames.find((candidate) => candidate.id === source.frameId);
    assert(variant && frame && assetManifest.asset?.id === source.assetId && assetManifest.asset.split === source.split && assetManifest.asset.splitGroupId === source.splitGroupId && assetManifest.asset.sourceGeometrySha256 === source.provenance.sourceGeometrySha256 && canonical(assetManifest.asset.textureIds) === canonical(source.provenance.textureIds) && canonical(assetManifest.asset.sourcePackIds) === canonical(source.provenance.sourcePackIds), "PILOT_NATIVE_ASSET_MANIFEST_LINEAGE_INVALID");
    const controlPath = join(assetDirectory, "variants", source.variantId, "controls", "manifest.json");
    assert((await stat(targetPath)).isFile() && (await stat(controlPath)).isFile(), "PILOT_NATIVE_ARTIFACT_MISSING");
    const controlManifest = await verifySealedManifest(controlPath);
    assert(await hashFile(targetPath) === source.target.sha256 && controlManifest.contentSha256 === source.controls.manifestSha256, "PILOT_NATIVE_ARTIFACT_HASH_MISMATCH");
    assert(config.modelRaster?.id === "glyph-model-raster/physical-cell-letterbox-v1", "PILOT_NATIVE_MODEL_RASTER_REQUIRED");
    const asset = { id: source.assetId, split: source.split, splitGroupId: source.splitGroupId, classId: assetManifest.renderer.classId, sourceGeometrySha256: source.provenance.sourceGeometrySha256, textureIds: source.provenance.textureIds, sourcePackIds: source.provenance.sourcePackIds };
    const controlFrame = controlManifest.frames.find((candidate) => candidate.id === source.frameId);
    assert(controlFrame, "PILOT_NATIVE_CONTROL_FRAME_MISSING");
    const semantic = await readFile(normalPath(dirname(controlPath), controlFrame.files.semantic, "PILOT_NATIVE_SEMANTIC_PATH_ESCAPE"), "utf8");
    const lookups = await readJson(normalPath(dirname(controlPath), controlFrame.files.indexLookups, "PILOT_NATIVE_LOOKUP_PATH_ESCAPE"));
    const record = {
      targetId: `native/${source.assetId.slice("asset/".length)}/${source.variantId}/${source.frameId}`, targetKind: "native-exact-rgb/v1", split: source.split,
      trajectoryId: `trajectory/${source.assetId.slice("asset/".length)}/${source.variantId}`, frameIndex: variant.frames.findIndex((candidate) => candidate.id === source.frameId), prompt: config.nativePrompt,
      sceneSha256: source.controls.sceneSha256, trajectorySha256: source.controls.trajectorySha256, appearancePopulation: `native/source-pack/${source.provenance.sourcePackIds.slice().sort().join("+")}`,
      asset, variant: { id: source.variantId, pose: variant.pose, occlusion: variant.occlusion }, frame: { id: source.frameId, cameraId: frame.camera?.id ?? frame.cameraId, lightingId: frame.lightingId },
      target: { path: relative(sourceRoot, targetPath).replaceAll("\\", "/"), sha256: source.target.sha256 },
      control: { path: relative(sourceRoot, controlPath).replaceAll("\\", "/"), sha256: source.controls.manifestSha256, frameId: source.frameId },
      modelRaster: config.modelRaster, admission: { reportSha256, recordSha256: sha256(canonical(source)), b10: source.b10 },
      strata: { semanticGlyphs: [...new Set(semantic.replaceAll("\n", "").replaceAll(" ", ""))].sort(), instances: lookups.instanceLookup, surfaces: lookups.surfaceLookup },
    };
    record.contentSha256 = sha256(canonical(record));
    records.push(record);
    const balanceKey = asset.split;
    if (!balances.has(balanceKey)) balances.set(balanceKey, blank());
    add(balances.get(balanceKey), dimensions(record));
  }
  enforceLeakage(records);
  const materialOnly = report.materialOnly.records.map((entry) => {
    const asset = registry.assets.find((candidate) => candidate.id === entry.assetId);
    assert(asset && asset.split === entry.split && asset.splitGroupId === entry.splitGroupId && asset.appearanceDisposition === "material-only", "PILOT_NATIVE_MATERIAL_REGISTRY_REBOUND");
    const record = { assetId: entry.assetId, split: entry.split, splitGroupId: entry.splitGroupId, sourcePackIds: asset.sourcePackIds, sourceGeometrySha256: asset.geometry.sha256, textureIds: asset.textureIds, targetStatus: "material-only-not-exact-rgb", disposition: "excluded-from-exact-rgb-training", sourceRecordSha256: sha256(canonical(entry)) };
    return { ...record, contentSha256: sha256(canonical(record)) };
  });
  assert(report.materialOnly.status === "excluded-from-exact-rgb-b10", "PILOT_NATIVE_MATERIAL_DISPOSITION_INVALID");
  enforceLeakage([...records, ...materialOnly.map((entry) => ({ split: entry.split, asset: { splitGroupId: entry.splitGroupId, sourcePackIds: entry.sourcePackIds, sourceGeometrySha256: entry.sourceGeometrySha256, textureIds: entry.textureIds } }))]);
  const represented = new Set(records.map((record) => record.asset.id));
  const sourceCoverage = registry.sourceFiles.filter((entry) => entry.census === "usable-texture-uv-v1").map((entry) => {
    const asset = registry.assets.find((candidate) => candidate.id === entry.canonicalAssetId);
    const included = represented.has(entry.canonicalAssetId);
    return { path: entry.path, canonicalAssetId: entry.canonicalAssetId, disposition: included ? "represented" : "admission-failure", reasons: included ? [] : asset?.admissionReasons?.length ? asset.admissionReasons : ["B43 source has no B45-admitted exact-RGB frame"] };
  });
  assert(sourceCoverage.length === 77, "PILOT_NATIVE_SOURCE_CENSUS_DRIFT");
  const blockedAssets = registry.assets.filter((asset) => !asset.admitted).map((asset) => ({ assetId: asset.id, appearanceDisposition: asset.appearanceDisposition ?? "unknown", reasons: asset.admissionReasons?.length ? asset.admissionReasons : ["B43 asset admission blocked without a narrower reason"] }));
  const heldOutAppearance = Object.fromEntries(config.heldOutAppearance.splits.map((split) => {
    const splitRecords = records.filter((record) => record.split === split);
    const assetIds = [...new Set(splitRecords.map((record) => record.asset.id))].sort();
    const populations = [...new Set(splitRecords.map((record) => record.appearancePopulation))].sort();
    assert(assetIds.length >= config.heldOutAppearance.minAssetsPerSplit && populations.length >= config.heldOutAppearance.minAppearancePopulationsPerSplit, "PILOT_NATIVE_HELD_OUT_APPEARANCE_FLOOR");
    return [split, { assetIds, appearancePopulations: populations }];
  }));
  const manifest = {
    schemaVersion: "glyph-pilot-manifest/v2", status: "complete", datasetRoot: config.remoteRoot,
    authority: { kind: "B43-B45-native-asset-first/v1", admissionReport: config.admissionReport, admissionReportSha256: reportSha256, assetCorpusRoot: config.assetCorpusRoot },
    balanceReport: "pilot-balance.json", records, materialOnly, blockedAssets, sourceCoverage, heldOutAppearance,
  };
  manifest.contentSha256 = sha256(canonical(manifest));
  const balance = { schemaVersion: "glyph-pilot-balance/v2", status: "complete", admittedOnly: true, targetKind: "native-exact-rgb/v1", splits: Object.fromEntries(["train", "validation", "test"].map((split) => [split, balances.get(split) ?? blank()])) };
  balance.contentSha256 = sha256(canonical(balance));
  await validateSchemas(manifest, balance);
  await Promise.all([writeJson(join(root, "pilot-manifest.json"), manifest), writeJson(join(root, "pilot-balance.json"), balance)]);
  return { manifest, balance, reportPath: join(root, "pilot-manifest.json") };
}

export async function validateNativePilotDataset({ datasetRoot, reportPath, config }) {
  const root = resolve(datasetRoot), manifest = await readJson(reportPath), balance = await readJson(join(dirname(reportPath), manifest.balanceReport));
  await validateSchemas(manifest, balance);
  assert(manifest.schemaVersion === "glyph-pilot-manifest/v2" && manifest.status === "complete" && manifest.datasetRoot === config.remoteRoot, "PILOT_NATIVE_MANIFEST_INVALID");
  assert(manifest.contentSha256 === sha256(canonical(manifest)) && balance.contentSha256 === sha256(canonical(balance)), "PILOT_NATIVE_MANIFEST_HASH_INVALID");
  assert(balance.schemaVersion === "glyph-pilot-balance/v2" && balance.status === "complete" && balance.admittedOnly === true && balance.targetKind === "native-exact-rgb/v1", "PILOT_NATIVE_BALANCE_INVALID");
  const admissionPath = resolve(researchRoot, config.admissionReport), registryPath = resolve(researchRoot, config.assetRegistry);
  const [admissionBytes, registry] = await Promise.all([readFile(admissionPath), readJson(registryPath)]);
  const admission = JSON.parse(admissionBytes);
  await checkRenderedTargetAdmission(admissionPath, {
    assetReport: resolve(researchRoot, config.assetReport),
    datasetRoot: resolve(config.assetCorpusRoot),
    materialReport: resolve(researchRoot, config.materialReport),
    materialDatasetRoot: resolve(config.materialDatasetRoot),
  });
  await validateB45Schema(admission);
  assert(admission.schemaVersion === "glyph-rendered-target-admission/v1" && admission.status === "admitted" && admission.population === "exact-rgb" && admission.exactRgb?.admittedFrameCount === admission.exactRgb?.accepted?.length, "PILOT_NATIVE_B45_AUTHORITY_REQUIRED");
  for (const source of admission.exactRgb.accepted) validateB45Record(source);
  assert(sha256(admissionBytes) === manifest.authority.admissionReportSha256 && registry.contentSha256 === sha256(canonical(registry)) && registry.stats?.usableTextureUvSourceFiles === 77, "PILOT_NATIVE_AUTHORITY_REBOUND");
  const accepted = new Map();
  for (const entry of admission.exactRgb.accepted) {
    const key = `${entry.assetId}\0${entry.variantId}\0${entry.frameId}`;
    assert(!accepted.has(key), "PILOT_NATIVE_B45_ACCEPTED_DUPLICATE");
    accepted.set(key, entry);
  }
  const sourceRoot = resolve(config.assetCorpusRoot), recomputed = new Map();
  const consumed = new Set();
  for (const record of manifest.records) {
    assert(record.targetKind === "native-exact-rgb/v1" && record.admission.b10.accepted === true, "PILOT_NATIVE_NONEXACT_RECORD");
    assert(record.contentSha256 === sha256(canonical(record)), "PILOT_NATIVE_RECORD_HASH_INVALID");
    const targetPath = normalPath(sourceRoot, record.target.path, "PILOT_NATIVE_ARTIFACT_PATH_ESCAPE");
    assert(await hashFile(targetPath) === record.target.sha256, "PILOT_NATIVE_ARTIFACT_HASH_MISMATCH");
    const recordKey = `${record.asset.id}\0${record.variant.id}\0${record.frame.id}`;
    assert(!consumed.has(recordKey), "PILOT_NATIVE_DUPLICATE_FRAME"); consumed.add(recordKey);
    const source = accepted.get(recordKey);
    assert(source && record.admission.recordSha256 === sha256(canonical(source)) && source.b10.accepted === true, "PILOT_NATIVE_B45_RECORD_REBOUND");
    const assetManifestPath = join(sourceRoot, record.asset.id.slice("asset/".length), "asset-manifest.json");
    const assetManifest = await verifySealedManifest(assetManifestPath, source.provenance.assetManifestSha256);
    const controlPath = normalPath(sourceRoot, record.control.path, "PILOT_NATIVE_ARTIFACT_PATH_ESCAPE");
    const control = await verifySealedManifest(controlPath);
    assert(control.contentSha256 === record.control.sha256, "PILOT_NATIVE_ARTIFACT_HASH_MISMATCH");
    const registryAsset = registry.assets.find((candidate) => candidate.id === source.assetId);
    const variant = assetManifest.variants.find((candidate) => candidate.id === source.variantId);
    const frameIndex = variant?.frames.findIndex((candidate) => candidate.id === source.frameId), frame = variant?.frames[frameIndex];
    const controlFrame = control.frames.find((candidate) => candidate.id === source.frameId);
    const semantic = await readFile(normalPath(dirname(controlPath), controlFrame.files.semantic, "PILOT_NATIVE_SEMANTIC_PATH_ESCAPE"), "utf8");
    const lookups = await readJson(normalPath(dirname(controlPath), controlFrame.files.indexLookups, "PILOT_NATIVE_LOOKUP_PATH_ESCAPE"));
    const expected = {
      targetId: `native/${source.assetId.slice("asset/".length)}/${source.variantId}/${source.frameId}`, targetKind: "native-exact-rgb/v1", split: source.split,
      trajectoryId: `trajectory/${source.assetId.slice("asset/".length)}/${source.variantId}`, frameIndex, prompt: config.nativePrompt,
      sceneSha256: source.controls.sceneSha256, trajectorySha256: source.controls.trajectorySha256,
      appearancePopulation: `native/source-pack/${source.provenance.sourcePackIds.slice().sort().join("+")}`,
      asset: { id: source.assetId, split: source.split, splitGroupId: source.splitGroupId, classId: assetManifest.renderer.classId, sourceGeometrySha256: source.provenance.sourceGeometrySha256, textureIds: source.provenance.textureIds, sourcePackIds: source.provenance.sourcePackIds },
      variant: { id: source.variantId, pose: variant.pose, occlusion: variant.occlusion },
      frame: { id: source.frameId, cameraId: frame.camera?.id ?? frame.cameraId, lightingId: frame.lightingId },
      target: { path: source.target.path, sha256: source.target.sha256 },
      control: { path: relative(sourceRoot, controlPath).replaceAll("\\", "/"), sha256: source.controls.manifestSha256, frameId: source.frameId },
      modelRaster: config.modelRaster, admission: { reportSha256: sha256(admissionBytes), recordSha256: sha256(canonical(source)), b10: source.b10 },
      strata: { semanticGlyphs: [...new Set(semantic.replaceAll("\n", "").replaceAll(" ", ""))].sort(), instances: lookups.instanceLookup, surfaces: lookups.surfaceLookup },
    };
    const { contentSha256: _seal, ...actualRecord } = record;
    assert(canonical(actualRecord) === canonical(expected), "PILOT_NATIVE_RECORD_RECONSTRUCTION_MISMATCH");
    assert(registryAsset?.admitted && registryAsset.appearanceDisposition === "exact-rgb", "PILOT_NATIVE_B43_RECORD_REBOUND");
    if (!recomputed.has(record.split)) recomputed.set(record.split, blank());
    add(recomputed.get(record.split), dimensions(record));
  }
  assert(accepted.size === manifest.records.length && consumed.size === accepted.size && [...accepted.keys()].every((key) => consumed.has(key)), "PILOT_NATIVE_B45_RECORD_COUNT_MISMATCH");
  enforceLeakage(manifest.records);
  for (const split of ["train", "validation", "test"]) {
    const actual = recomputed.get(split) ?? blank(), reported = balance.splits[split];
    assert(canonical(actual) === canonical(reported), "PILOT_NATIVE_BALANCE_RECONSTRUCTION_MISMATCH");
    for (const [dimension, floor] of Object.entries(config.balance.floors)) assert(Object.values(actual[dimension] ?? {}).every((count) => count >= floor) && Object.keys(actual[dimension] ?? {}).length > 0, `PILOT_NATIVE_BALANCE_${dimension.toUpperCase()}_FLOOR`);
  }
  assert(manifest.materialOnly.every((entry) => entry.targetStatus === "material-only-not-exact-rgb" && entry.disposition === "excluded-from-exact-rgb-training"), "PILOT_NATIVE_MATERIAL_LEAKAGE");
  const materialKeys = new Set();
  assert(manifest.materialOnly.length === admission.materialOnly.records.length && manifest.materialOnly.every((entry) => {
    if (materialKeys.has(entry.assetId)) return false; materialKeys.add(entry.assetId);
    const source = admission.materialOnly.records.find((candidate) => candidate.assetId === entry.assetId);
    const asset = registry.assets.find((candidate) => candidate.id === entry.assetId);
    const raw = source && asset ? { assetId: source.assetId, split: source.split, splitGroupId: source.splitGroupId, sourcePackIds: asset.sourcePackIds, sourceGeometrySha256: asset.geometry.sha256, textureIds: asset.textureIds, targetStatus: "material-only-not-exact-rgb", disposition: "excluded-from-exact-rgb-training", sourceRecordSha256: sha256(canonical(source)) } : null;
    const expected = raw ? { ...raw, contentSha256: sha256(canonical(raw)) } : null;
    return expected && canonical(entry) === canonical(expected) && entry.contentSha256 === expected.contentSha256;
  }), "PILOT_NATIVE_MATERIAL_AUTHORITY_REBOUND");
  assert(admission.materialOnly.records.every((entry) => materialKeys.has(entry.assetId)), "PILOT_NATIVE_MATERIAL_AUTHORITY_REBOUND");
  enforceLeakage([...manifest.records, ...manifest.materialOnly.map((entry) => ({ split: entry.split, asset: { splitGroupId: entry.splitGroupId, sourcePackIds: entry.sourcePackIds, sourceGeometrySha256: entry.sourceGeometrySha256, textureIds: entry.textureIds } }))]);
  const represented = new Set(manifest.records.map((record) => record.asset.id));
  const expectedCoverage = registry.sourceFiles.filter((entry) => entry.census === "usable-texture-uv-v1").map((entry) => {
    const asset = registry.assets.find((candidate) => candidate.id === entry.canonicalAssetId), included = represented.has(entry.canonicalAssetId);
    return { path: entry.path, canonicalAssetId: entry.canonicalAssetId, disposition: included ? "represented" : "admission-failure", reasons: included ? [] : asset?.admissionReasons?.length ? asset.admissionReasons : ["B43 source has no B45-admitted exact-RGB frame"] };
  });
  assert(canonical(manifest.sourceCoverage) === canonical(expectedCoverage), "PILOT_NATIVE_SOURCE_CENSUS_DRIFT");
  const expectedBlocked = registry.assets.filter((asset) => !asset.admitted).map((asset) => ({ assetId: asset.id, appearanceDisposition: asset.appearanceDisposition ?? "unknown", reasons: asset.admissionReasons?.length ? asset.admissionReasons : ["B43 asset admission blocked without a narrower reason"] }));
  assert(canonical(manifest.blockedAssets) === canonical(expectedBlocked), "PILOT_NATIVE_BLOCKED_ASSETS_REBOUND");
  const heldOutAppearance = Object.fromEntries(config.heldOutAppearance.splits.map((split) => {
    const splitRecords = manifest.records.filter((record) => record.split === split);
    return [split, { assetIds: [...new Set(splitRecords.map((record) => record.asset.id))].sort(), appearancePopulations: [...new Set(splitRecords.map((record) => record.appearancePopulation))].sort() }];
  }));
  assert(canonical(manifest.heldOutAppearance) === canonical(heldOutAppearance)
    && Object.values(heldOutAppearance).every((entry) => entry.assetIds.length >= config.heldOutAppearance.minAssetsPerSplit && entry.appearancePopulations.length >= config.heldOutAppearance.minAppearancePopulationsPerSplit), "PILOT_NATIVE_HELD_OUT_APPEARANCE_REBOUND");
  return { records: manifest.records.length, root, sourceCoverage: manifest.sourceCoverage };
}
