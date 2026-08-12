#!/usr/bin/env node
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath, readFile, readdir, rm, symlink } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";

const root = resolve(import.meta.dirname, "..");
const fixtureDirectory = join(root, "fixtures", "schema");
const artifactRoot = join(fixtureDirectory, "artifacts");
const configuredDictionaryPath = join(root, "config", "glyph-object-dictionary.json");
const schemaNames = ["glyph-object-dictionary.schema.json", "asset-class-mapping.schema.json", "control-scene.schema.json", "control-sample.schema.json", "control-trajectory.schema.json"];
const schemas = await Promise.all(schemaNames.map(async (name) => JSON.parse(await readFile(join(root, "schema", name), "utf8"))));
const ajv = new Ajv2020({ allErrors: true, strict: true, strictTypes: false });
for (const value of schemas) ajv.addSchema(value);
const [dictionarySchema, assetMappingSchema, sceneSchema, sampleSchema, trajectorySchema] = schemas.map((value) => ajv.getSchema(value.$id));
const configuredDictionary = JSON.parse(await readFile(configuredDictionaryPath, "utf8"));
const configuredAssetDictionary = JSON.parse(await readFile(join(root, "config", "asset-object-dictionary.json"), "utf8"));
const configuredAssetMapping = JSON.parse(await readFile(join(root, "config", "asset-class-mapping.json"), "utf8"));

function fail(code, message) { const error = new Error(`${code}: ${message}`); error.code = code; throw error; }
function assert(value, code, message) { if (!value) fail(code, message); }
function schema(validate, label, value) { if (validate(value)) return; const missingHash = validate.errors?.some((error) => error.keyword === "required" && /sha256$/i.test(error.params.missingProperty)); fail(missingHash ? "MISSING_REQUIRED_HASH" : "SCHEMA_VALIDATION_FAILED", `${label}: ${ajv.errorsText(validate.errors)}`); }
function hash(value) { return createHash("sha256").update(value).digest("hex"); }
function canonical(value) { if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`; if (value && typeof value === "object") return `{${Object.keys(value).filter((key) => key !== "contentSha256").sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`; return JSON.stringify(value); }
function manifestHash(record) { return hash(canonical(record)); }
function distinct(values, code, label) { const seen = new Set(); for (const value of values) { assert(!seen.has(value), code, `${label} ${JSON.stringify(value)} repeats`); seen.add(value); } }
function finite(value, code, label) { assert(typeof value === "number" && Number.isFinite(value), code, `${label} must be finite`); }
function grid(sample, name, components, check) { const value = sample.controls[name]; const cells = sample.ascii.width * sample.ascii.height; assert(value.width === sample.ascii.width && value.height === sample.ascii.height && value.values.length === cells * components, "CONTROL_DIMENSION_MISMATCH", `${sample.id} ${name} shape differs`); for (const item of value.values) assert(check(item), "INVALID_CONTROL_CHANNEL", `${sample.id} ${name} has malformed value`); }

function validateDictionary(dictionary) {
  schema(dictionarySchema, "dictionary", dictionary);
  assert(dictionary.contentSha256 === manifestHash(dictionary), "CONTENT_HASH_MISMATCH", "dictionary canonical content hash differs");
  distinct(dictionary.classes.map((entry) => entry.id), "DUPLICATE_CLASS_ID", "class id");
  distinct(dictionary.classes.map((entry) => entry.name), "DUPLICATE_CLASS_NAME", "class name");
  distinct(dictionary.classes.map((entry) => entry.semanticGlyph), "DUPLICATE_CLASS_GLYPH", "semantic glyph");
  distinct(dictionary.classes.map((entry) => entry.controlColor.toLowerCase()), "DUPLICATE_CLASS_COLOR", "class color");
  schema(dictionarySchema, "configured dictionary", configuredDictionary);
  assert(configuredDictionary.contentSha256 === manifestHash(configuredDictionary), "CONTENT_HASH_MISMATCH", "configured dictionary canonical content hash differs");
  assert(dictionary.contentSha256 === configuredDictionary.contentSha256 && canonical(dictionary) === canonical(configuredDictionary), "DICTIONARY_CONFIG_MISMATCH", "inline dictionary differs from config/glyph-object-dictionary.json");
}
function validateAssetTaxonomyConfigs() {
  schema(dictionarySchema, "asset dictionary", configuredAssetDictionary);
  schema(assetMappingSchema, "asset mapping", configuredAssetMapping);
  assert(configuredAssetDictionary.contentSha256 === manifestHash(configuredAssetDictionary), "CONTENT_HASH_MISMATCH", "asset dictionary canonical content hash differs");
  assert(configuredAssetMapping.contentSha256 === manifestHash(configuredAssetMapping), "CONTENT_HASH_MISMATCH", "asset mapping canonical content hash differs");
}
function validateScene(scene, dictionary) {
  schema(sceneSchema, `scene ${scene.id}`, scene);
  assert(scene.contentSha256 === manifestHash(scene), "CONTENT_HASH_MISMATCH", `${scene.id} canonical content hash differs`);
  assert(scene.dictionaryId === dictionary.id && scene.dictionarySha256 === dictionary.contentSha256, "DICTIONARY_MISMATCH", `${scene.id} dictionary differs`);
  distinct(scene.instances.map((entry) => entry.id), "DUPLICATE_INSTANCE_ID", "instance id");
  distinct(scene.surfaces.map((entry) => entry.id), "DUPLICATE_SURFACE_ID", "surface id");
  const classes = new Set(dictionary.classes.map((entry) => entry.id)); const instances = new Map(scene.instances.map((entry) => [entry.id, entry.classId])); const surfaces = new Map(scene.surfaces.map((entry) => [entry.id, entry.instanceId]));
  for (const [id, classId] of instances) assert(classes.has(classId), "UNKNOWN_INSTANCE_CLASS", `${id} class ${classId}`);
  for (const [id, instanceId] of surfaces) assert(instances.has(instanceId), "UNKNOWN_SURFACE_INSTANCE", `${id} instance ${instanceId}`);
  for (const [index, surfaceId] of scene.polygonSurfaceIds.entries()) assert(surfaces.has(surfaceId), "UNKNOWN_POLYGON_SURFACE", `${scene.id} polygon ${index} surface ${surfaceId}`);
  return { scene, instances, surfaces };
}
function validateCamera(camera, id) { for (const key of ["rotX", "rotY", "zoom", "fontSize", "lineHeight"]) finite(camera[key], "UNREPRODUCIBLE_CAMERA", `${id} ${key}`); for (const value of camera.target) finite(value, "UNREPRODUCIBLE_CAMERA", `${id} target`); if (camera.projection === "perspective") { assert(camera.perspective !== undefined && camera.distance !== undefined, "UNREPRODUCIBLE_CAMERA", `${id} perspective needs perspective and distance`); finite(camera.perspective, "UNREPRODUCIBLE_CAMERA", `${id} perspective`); finite(camera.distance, "UNREPRODUCIBLE_CAMERA", `${id} distance`); } }
const emptySemanticGlyph = " ";
async function artifactPath(path) {
  assert(!isAbsolute(path), "ARTIFACT_PATH_ESCAPE", `${path} is absolute`);
  assert(path.startsWith("fixtures/schema/artifacts/"), "ARTIFACT_PATH_ESCAPE", `${path} is outside artifact namespace`);
  assert(!path.split("/").some((part) => part === "." || part === ".."), "ARTIFACT_PATH_ESCAPE", `${path} has traversal`);
  const requested = resolve(root, path); const base = await realpath(artifactRoot); let actual;
  try { actual = await realpath(requested); } catch { fail("ARTIFACT_PATH_ESCAPE", `${path} cannot resolve inside artifact root`); }
  assert(actual !== base && actual.startsWith(`${base}${sep}`), "ARTIFACT_PATH_ESCAPE", `${path} resolves outside artifact root`);
  return { requested, actual, base };
}
async function artifactHash(path) {
  const artifact = await artifactPath(path);
  const before = await lstat(artifact.requested).catch(() => fail("ARTIFACT_PATH_ESCAPE", `${path} is unavailable`));
  assert(!before.isSymbolicLink() && before.isFile(), "ARTIFACT_PATH_ESCAPE", `${path} is not a regular non-symlink file`);
  const noFollow = constants.O_NOFOLLOW ?? 0;
  let handle;
  try { handle = await open(artifact.requested, constants.O_RDONLY | noFollow); } catch { fail("ARTIFACT_PATH_ESCAPE", `${path} cannot be opened safely`); }
  try {
    const opened = await handle.stat();
    assert(opened.isFile() && opened.dev === before.dev && opened.ino === before.ino, "ARTIFACT_PATH_ESCAPE", `${path} changed while opening`);
    const bytes = await handle.readFile();
    const after = await lstat(artifact.requested).catch(() => fail("ARTIFACT_PATH_ESCAPE", `${path} disappeared while reading`));
    assert(!after.isSymbolicLink() && after.isFile() && after.dev === opened.dev && after.ino === opened.ino, "ARTIFACT_PATH_ESCAPE", `${path} changed while reading`);
    const resolved = await realpath(artifact.requested).catch(() => fail("ARTIFACT_PATH_ESCAPE", `${path} cannot be re-resolved`));
    assert(resolved === artifact.actual && resolved.startsWith(`${artifact.base}${sep}`), "ARTIFACT_PATH_ESCAPE", `${path} changed resolution`);
    return hash(bytes);
  } finally { await handle.close(); }
}
function sourceClass(scene, polygon) { const surfaceId = scene.scene.polygonSurfaceIds[polygon]; assert(surfaceId !== undefined, "UNRESOLVED_WINNER_INDEX", `polygon ${polygon}`); const instanceId = scene.surfaces.get(surfaceId); assert(instanceId, "UNRESOLVED_WINNER_INDEX", `surface ${surfaceId}`); const classId = scene.instances.get(instanceId); assert(classId !== undefined, "UNRESOLVED_WINNER_INDEX", `instance ${instanceId}`); return { surfaceId, instanceId, classId }; }
async function validateSample(sample, dictionary, scene) {
  schema(sampleSchema, `sample ${sample.id}`, sample);
  assert(sample.contentSha256 === manifestHash(sample), "CONTENT_HASH_MISMATCH", `${sample.id} canonical content hash differs`);
  assert(sample.sceneId === scene.scene.id && sample.sceneSha256 === scene.scene.contentSha256, "SCENE_MISMATCH", `${sample.id} scene differs`);
  assert(sample.dictionaryId === dictionary.id && sample.dictionarySha256 === dictionary.contentSha256, "DICTIONARY_MISMATCH", `${sample.id} dictionary differs`);
  validateCamera(sample.camera, sample.id);
  for (const key of ["visibleCells", "semanticCells"]) { assert(sample.ascii[key].length === sample.ascii.height, "CONTROL_DIMENSION_MISMATCH", `${sample.id} ${key} row count differs`); for (const row of sample.ascii[key]) assert([...row].length === sample.ascii.width, "CONTROL_DIMENSION_MISMATCH", `${sample.id} ${key} row width differs`); }
  const number = (value) => typeof value === "number" && Number.isFinite(value); const integer = (value) => Number.isInteger(value);
  grid(sample, "winnerPolygon", 1, (value) => integer(value) && value >= -1); grid(sample, "semanticClassId", 1, (value) => integer(value) && value >= -1); grid(sample, "objectInstanceId", 1, (value) => typeof value === "string"); grid(sample, "surfaceId", 1, (value) => typeof value === "string"); grid(sample, "depth", 1, number); grid(sample, "normal", 3, number); grid(sample, "worldPosition", 3, number); grid(sample, "surfaceUv", 2, number); grid(sample, "coverage", 1, (value) => number(value) && value >= 0 && value <= 1); grid(sample, "shade", 1, (value) => number(value) && value >= 0 && value <= 1); grid(sample, "validity", 1, (value) => value === 0 || value === 1); grid(sample, "disocclusion", 1, (value) => value === 0 || value === 1); grid(sample, "confidence", 1, (value) => number(value) && value >= 0 && value <= 1);
  const cells = sample.ascii.width * sample.ascii.height;
  for (let index = 0; index < cells; index += 1) {
    const winner = sample.controls.winnerPolygon.values[index]; const classId = sample.controls.semanticClassId.values[index]; const surfaceId = sample.controls.surfaceId.values[index]; const instanceId = sample.controls.objectInstanceId.values[index];
    const semanticRow = Math.floor(index / sample.ascii.width); const semanticColumn = index % sample.ascii.width; const semanticGlyph = [...sample.ascii.semanticCells[semanticRow]][semanticColumn];
    if (winner === -1) { assert(classId === -1 && surfaceId === "" && instanceId === "", "INVALID_EMPTY_SENTINEL", `${sample.id} cell ${index}`); assert(semanticGlyph === emptySemanticGlyph, "INVALID_EMPTY_SEMANTIC_GLYPH", `${sample.id} cell ${index}`); continue; }
    const expected = sourceClass(scene, winner); assert(classId === expected.classId && surfaceId === expected.surfaceId && instanceId === expected.instanceId, "INVALID_WINNER_LINEAGE", `${sample.id} cell ${index}`); const dictionaryClass = dictionary.classes.find((entry) => entry.id === classId); assert(dictionaryClass, "UNKNOWN_SEMANTIC_CLASS", `${sample.id} cell ${index}`); assert(semanticGlyph === dictionaryClass.semanticGlyph, "SEMANTIC_ASCII_MISMATCH", `${sample.id} cell ${index}`);
  }
  const expectedRoles = new Set(["control-bundle:visible", "control-bundle:semantic", "target:target"]); const actualRoles = new Set(sample.artifacts.map((artifact) => `${artifact.role}:${artifact.outputSource}`)); assert(actualRoles.size === sample.artifacts.length, "DUPLICATE_ARTIFACT_ROLE", sample.id); for (const role of expectedRoles) assert(actualRoles.has(role), "MISSING_ARTIFACT_ROLE", `${sample.id} ${role}`); assert(actualRoles.size === expectedRoles.size && [...actualRoles].every((role) => expectedRoles.has(role)), "INVALID_ARTIFACT_ROLE_SET", sample.id); for (const artifact of sample.artifacts) assert(artifact.sha256 === await artifactHash(artifact.path), "ARTIFACT_HASH_MISMATCH", `${sample.id} ${artifact.path} hash differs`);
  if (sample.transition) for (const surfaceId of sample.transition.atlasUpdate.surfaceIds) assert(scene.surfaces.has(surfaceId), "INVALID_SURFACE_CORRESPONDENCE", `${sample.id} atlas ${surfaceId}`);
}
async function validateRecords(records) {
  const { dictionary, scenes, samples, trajectories } = records; validateDictionary(dictionary); distinct(scenes.map((scene) => scene.id), "DUPLICATE_SCENE_ID", "scene id"); const sceneById = new Map(); const instanceOwners = new Map(); const surfaceOwners = new Map(); for (const raw of scenes) { const scene = validateScene(raw, dictionary); sceneById.set(raw.id, scene); for (const id of scene.instances.keys()) { const owner = instanceOwners.get(id); assert(!owner || owner === raw.contentSha256, "GLOBAL_INSTANCE_OWNERSHIP_CONFLICT", `${id} belongs to distinct immutable scenes`); instanceOwners.set(id, raw.contentSha256); } for (const id of scene.surfaces.keys()) { const owner = surfaceOwners.get(id); assert(!owner || owner === raw.contentSha256, "GLOBAL_SURFACE_OWNERSHIP_CONFLICT", `${id} belongs to distinct immutable scenes`); surfaceOwners.set(id, raw.contentSha256); } }
  const sampleById = new Map(); const seedSplits = new Map(); const immutableSceneSplits = new Map();
  for (const sample of samples) { assert(!sampleById.has(sample.id), "DUPLICATE_SAMPLE_ID", sample.id); const scene = sceneById.get(sample.sceneId); assert(scene, "UNKNOWN_SAMPLE_SCENE", sample.sceneId); await validateSample(sample, dictionary, scene); sampleById.set(sample.id, sample); const seedSet = seedSplits.get(sample.sceneSeed) ?? new Set(); seedSet.add(sample.split); seedSplits.set(sample.sceneSeed, seedSet); const immutableKey = `${sample.sceneId}\u0000${sample.sceneSha256}`; const sceneSet = immutableSceneSplits.get(immutableKey) ?? new Set(); sceneSet.add(sample.split); immutableSceneSplits.set(immutableKey, sceneSet); }
  for (const [seed, splits] of seedSplits) assert(splits.size === 1, "SCENE_SEED_SPLIT_LEAKAGE", seed); for (const [scene, splits] of immutableSceneSplits) assert(splits.size === 1, "IMMUTABLE_SCENE_SPLIT_LEAKAGE", scene);
  distinct(trajectories.map((trajectory) => trajectory.id), "DUPLICATE_TRAJECTORY_ID", "trajectory id");
  const memberships = new Map();
  for (const trajectory of trajectories) {
    schema(trajectorySchema, `trajectory ${trajectory.id}`, trajectory); assert(trajectory.contentSha256 === manifestHash(trajectory), "CONTENT_HASH_MISMATCH", `${trajectory.id} canonical content hash differs`); const scene = sceneById.get(trajectory.sceneId); assert(scene && trajectory.sceneSha256 === scene.scene.contentSha256, "SCENE_MISMATCH", trajectory.id); assert(trajectory.dictionaryId === dictionary.id && trajectory.dictionarySha256 === dictionary.contentSha256, "DICTIONARY_MISMATCH", trajectory.id);
    const ordered = [...trajectory.frames].sort((a, b) => a.index - b.index); distinct(ordered.map((frame) => frame.frameId), "DUPLICATE_TRAJECTORY_FRAME", trajectory.id); for (let index = 0; index < ordered.length; index += 1) { const frame = ordered[index]; const sample = sampleById.get(frame.frameId); assert(sample && sample.sceneId === trajectory.sceneId && sample.sceneSha256 === trajectory.sceneSha256 && sample.sceneSeed === trajectory.sceneSeed && sample.split === trajectory.split && sample.camera.id === frame.cameraId, "BROKEN_TRAJECTORY_LINEAGE", `${trajectory.id} ${frame.frameId}`); assert(frame.index === index && frame.previousFrameId === ordered[index - 1]?.frameId && frame.nextFrameId === ordered[index + 1]?.frameId, "BROKEN_TRAJECTORY_ADJACENCY", `${trajectory.id} ${frame.frameId}`); const members = memberships.get(frame.frameId) ?? []; members.push(trajectory.id); memberships.set(frame.frameId, members); const transition = sample.transition; if (index === 0) assert(!transition, "UNEXPECTED_FIRST_TRANSITION", `${trajectory.id} ${frame.frameId}`); else { assert(transition, "MISSING_TRANSITION", `${trajectory.id} ${frame.frameId}`); assert(transition.sourceFrameId === ordered[index - 1].frameId && transition.targetFrameId === frame.frameId, "BROKEN_TRANSITION_ADJACENCY", `${trajectory.id} ${frame.frameId}`); } }
  }
  for (const sample of samples) { const member = memberships.get(sample.id) ?? []; if (sample.transition && member.length === 0) fail("UNTRAJECTORIED_TRANSITION", sample.id); assert(member.length === 1, "SAMPLE_TRAJECTORY_MEMBERSHIP", `${sample.id} belongs to ${member.length} trajectories`); }
}
async function json(path) { return JSON.parse(await readFile(path, "utf8")); }
function mutate(record, mutation) { const parts = mutation.path.slice(1).split("/"); if (parts[0] === "records") parts.shift(); let parent = record; for (const part of parts.slice(0, -1)) parent = parent[part]; if (mutation.op === "set") parent[parts.at(-1)] = mutation.value; else if (mutation.op === "delete") delete parent[parts.at(-1)]; else fail("FIXTURE_INVALID", mutation.op); }
async function refreshHashes(records, options = {}) { if (!options.preserveArtifactHashes) for (const sample of records.samples) for (const artifact of sample.artifacts) artifact.sha256 = await artifactHash(artifact.path); if (!options.preserveLinkedHashes) { records.dictionary.contentSha256 = manifestHash(records.dictionary); for (const scene of records.scenes) { scene.dictionarySha256 = records.dictionary.contentSha256; scene.contentSha256 = manifestHash(scene); } for (const sample of records.samples) { sample.dictionarySha256 = records.dictionary.contentSha256; sample.sceneSha256 = records.scenes.find((scene) => scene.id === sample.sceneId)?.contentSha256 ?? sample.sceneSha256; } for (const trajectory of records.trajectories) { trajectory.dictionarySha256 = records.dictionary.contentSha256; trajectory.sceneSha256 = records.scenes.find((scene) => scene.id === trajectory.sceneId)?.contentSha256 ?? trajectory.sceneSha256; } } if (!options.preserveContentHashes) { for (const sample of records.samples) sample.contentSha256 = manifestHash(sample); for (const trajectory of records.trajectories) trajectory.contentSha256 = manifestHash(trajectory); } }
async function fixture(path) { const source = await json(path); if (!source.extends) { await refreshHashes(source.records); return { records: source.records, options: source }; } const base = structuredClone((await fixture(resolve(dirname(path), source.extends))).records); for (const mutation of source.mutations ?? []) mutate(base, mutation); await refreshHashes(base, source); return { records: base, options: source }; }
async function withArtifactLinks(options, run) { const links = options.artifactLinks ?? []; const created = []; try { for (const link of links) { const path = resolve(root, link.path); await rm(path, { force: true }); await symlink(isAbsolute(link.target) ? link.target : resolve(root, link.target), path); created.push(path); } return await run(); } finally { await Promise.all(created.map((path) => rm(path, { force: true }))); } }
async function fixtures() { const valid = (await readdir(join(fixtureDirectory, "valid"))).filter((name) => name.endsWith(".json")).sort(); const invalid = (await readdir(join(fixtureDirectory, "invalid"))).filter((name) => name.endsWith(".json")).sort(); for (const name of valid) await validateRecords((await fixture(join(fixtureDirectory, "valid", name))).records); for (const name of invalid) { const path = join(fixtureDirectory, "invalid", name); const expected = (await json(path)).expectedError; const value = await fixture(path); try { await withArtifactLinks(value.options, () => validateRecords(value.records)); fail("FIXTURE_DID_NOT_FAIL", name); } catch (error) { if (error.code === "FIXTURE_DID_NOT_FAIL") throw error; assert(error.code === expected, "FIXTURE_WRONG_ERROR", `${name}: expected ${expected}, received ${error.code}`); } } console.log(`Validated ${valid.length} valid and ${invalid.length} invalid schema fixtures.`); }
if (process.argv.includes("--fixtures")) { validateAssetTaxonomyConfigs(); await fixtures(); } else fail("USAGE", "use --fixtures");
