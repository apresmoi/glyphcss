import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { encodeControlUploadManifest } from "./targets/control-png.mjs";
import { CONTROL_ROLES, admitTrajectoryTarget, createTargetUploadManifest, persistTargetCandidates } from "./targets/provider-core.mjs";
import { generateCorpusAt } from "./generate-controls.mjs";
import { evaluateMockTargetThroughB10, pilotAcceptanceSha256 } from "./pilot-admission.mjs";

const root = resolve(new URL("..", import.meta.url).pathname);
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));
const writeJson = async (path, value) => { await mkdir(dirname(path), { recursive: true }); const temporary = `${path}.tmp`; await writeFile(temporary, json(value)); await rename(temporary, path); };
const count = (map, key, value = 1) => { map[key] = (map[key] ?? 0) + value; };
const blank = () => ({ frames: 0, classCells: {}, glyphCells: {}, instanceCells: {}, surfaceCells: {}, motionFrames: {} });
const int32 = (bytes) => new Int32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
const refs = (population, trajectoryId, frameId) => CONTROL_ROLES.map((role) => ({ role, fileId: `pilot-${population}-${trajectoryId.replaceAll("/", "-")}-${frameId}-${role}` }));

async function sourceStats(corpusRoot, record, frameId, dictionary) {
  const dir = join(corpusRoot, record.visibleBundle, "frames", frameId);
  const [classes, instances, surfaces, lookups] = await Promise.all([readFile(join(dir, "class-id-i32.bin")), readFile(join(dir, "instance-id-i32.bin")), readFile(join(dir, "surface-id-i32.bin")), readJson(join(dir, "index-lookups.json"))]);
  const result = blank(), glyphs = Object.fromEntries(dictionary.classes.map((entry) => [entry.id, entry.semanticGlyph]));
  for (const entry of dictionary.classes) { result.classCells[String(entry.id)] = 0; result.glyphCells[entry.semanticGlyph] = 0; }
  for (const id of int32(classes)) if (id >= 0) { count(result.classCells, String(id)); count(result.glyphCells, glyphs[id]); }
  for (const id of int32(instances)) if (id >= 0) count(result.instanceCells, lookups.instanceLookup[id]);
  for (const id of int32(surfaces)) if (id >= 0) count(result.surfaceCells, lookups.surfaceLookup[id]);
  result.frames = 1; result.motionFrames[record.kind] = 1;
  return result;
}
function merge(to, from) { to.frames += from.frames; for (const field of ["classCells", "glyphCells", "instanceCells", "surfaceCells", "motionFrames"]) for (const [key, value] of Object.entries(from[field])) count(to[field], key, value); }

export async function finalizePilotDataset({ outputRoot, config, corpus, corpusRoot, selections }) {
  const destination = resolve(outputRoot);
  const [dictionary, configBytes] = await Promise.all([readJson(join(root, "config/glyph-object-dictionary.json")), readFile(join(root, "config/corpus.json"))]);
  const balances = new Map();
  const records = [];
  for (const { population, record, frameId, accepted, acceptance } of selections) {
    const trajectory = record.trajectory.controlTrajectory;
    const target = await readJson(join(destination, accepted.metadataPath));
    const acceptancePath = `admission/${accepted.imageSha256}.json`;
    await writeJson(join(destination, acceptancePath), acceptance);
    const key = `${population.id}\u0000${population.style.id}\u0000${trajectory.split}`;
    if (!balances.has(key)) balances.set(key, blank());
    merge(balances.get(key), await sourceStats(corpusRoot, record, frameId, dictionary));
    records.push({ metadataPath: accepted.metadataPath, acceptancePath, acceptanceSha256: pilotAcceptanceSha256(acceptance), targetId: accepted.targetId, contentSha256: accepted.contentSha256, requestSha256: target.requestSha256, imageSha256: accepted.imageSha256, population: population.id, split: trajectory.split, sceneSeed: trajectory.sceneSeed, trajectoryId: trajectory.id, styleId: population.style.id, providerModel: target.provider.model, provenanceLicense: population.style.license });
  }
  const balance = { schemaVersion: "glyph-pilot-balance/v1", status: "complete", admittedOnly: true, populations: config.populations.map((population) => ({ population: population.id, styleId: population.style.id, splits: Object.fromEntries(["train", "validation", "test"].map((split) => [split, balances.get(`${population.id}\u0000${population.style.id}\u0000${split}`)])) })) };
  const manifest = { schemaVersion: "glyph-pilot-manifest/v1", status: "complete", datasetRoot: config.remoteRoot, admission: "B10", authoritativeCorpus: { config: "config/corpus.json", configSha256: sha256(configBytes), id: corpus.id, contentSha256: corpus.contentSha256 }, balanceReport: "pilot-balance.json", records };
  await Promise.all([writeJson(join(destination, "pilot-balance.json"), balance), writeJson(join(destination, "pilot-manifest.json"), manifest)]);
  return { manifest, balance, reportPath: join(destination, "pilot-manifest.json") };
}

// This fixture constructor is deliberately incapable of becoming a cheap live
// path: it only runs under the test environment with the offline provider.
export async function buildMockPilotDataset({ outputRoot, provider, configPath = join(root, "config/pilot.json") }) {
  if (process.env.NODE_ENV !== "test") throw new Error("PILOT_MOCK_DATASET_TEST_ONLY");
  if (!provider || provider.id !== "mock-deterministic/v2" || provider.apiVersion !== "offline/v1") throw new Error("PILOT_MOCK_PROVIDER_REQUIRED");
  const evaluator = evaluateMockTargetThroughB10;
  const config = await readJson(configPath), destination = resolve(outputRoot), corpusRoot = join(destination, "controls");
  const corpus = await generateCorpusAt("config/corpus.json", corpusRoot);
  const selections = [];
  for (const population of config.populations) {
    for (const record of [...corpus.trajectories].sort((a, b) => a.trajectory.controlTrajectory.id.localeCompare(b.trajectory.controlTrajectory.id))) {
      const trajectory = record.trajectory.controlTrajectory;
      let prior = null;
      for (const frame of trajectory.frames) {
        const upload = await encodeControlUploadManifest({ corpusRoot, record, frameId: frame.frameId, outputRoot: join(destination, "uploads"), providerReferences: refs(population.id, trajectory.id, frame.frameId) });
        let priorUpload = null;
        if (prior) {
          priorUpload = join(destination, "uploads", `prior-${population.id}-${trajectory.id.replaceAll("/", "-")}-${frame.frameId}.json`);
          await createTargetUploadManifest({ targetMetadataPath: join(destination, prior.metadataPath), artifactRoot: destination, outputPath: priorUpload, providerReference: { fileId: `pilot-prior-${prior.targetId.replaceAll("/", "-")}` } });
        }
        const request = await admitTrajectoryTarget({ corpusManifestPath: join(corpusRoot, "manifest.json"), trajectoryId: trajectory.id, nextFrameId: frame.frameId, style: population.style, controlUploadManifestPath: upload.path, controlUploadRoot: join(destination, "uploads"), priorTargetUploadManifestPath: priorUpload, priorArtifactRoot: prior ? destination : null, candidates: config.provider.candidatesPerRequest, output: config.provider.output });
        const publication = await persistTargetCandidates({ provider, request, outputRoot: destination, costCeilingUsd: 1, costPerCandidateUsd: .01, inputCostPerRequestUsd: 0 });
        const accepted = publication.targets[0], target = await readJson(join(destination, accepted.metadataPath));
        const acceptance = await evaluator({ target, corpusRoot, record, frameId: frame.frameId });
        selections.push({ population, record, frameId: frame.frameId, accepted, acceptance });
        prior = accepted;
      }
    }
  }
  return finalizePilotDataset({ outputRoot: destination, config, corpus, corpusRoot, selections });
}

// Kept as the explicit boundary name for callers that previously used it.
// It has the same test-only, offline-only contract as buildMockPilotDataset.
export const buildPilotDataset = buildMockPilotDataset;
