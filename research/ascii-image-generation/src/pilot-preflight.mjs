import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { generateCorpusAt } from "./generate-controls.mjs";
import { CONTROL_ROLES, admitTrajectoryTarget, buildOpenAIRequest, canonicalJson } from "./targets/provider-core.mjs";
import { encodeControlUploadManifest } from "./targets/control-png.mjs";
import { validatePilotPricing, validateProviderSpendPrerequisite } from "./pilot-billing.mjs";

const root = resolve(dirname(new URL(import.meta.url).pathname), "..");
const hash = (value) => createHash("sha256").update(typeof value === "string" ? value : canonicalJson(value)).digest("hex");
const json = (path) => readFile(path, "utf8").then(JSON.parse);
const redact = (value) => Array.isArray(value) ? value.map(redact) : value && typeof value === "object"
  ? Object.fromEntries(Object.entries(value).map(([key, item]) => /authorization|api[_-]?key|token|secret/i.test(key) ? [key, "[REDACTED]"] : [key, redact(item)])) : value;
const uploadRef = (population, trajectoryId, frameId, role) => ({ role, fileId: `planned-upload:${hash({ population, trajectoryId, frameId, role }).slice(0, 24)}` });
const trajectorySort = (left, right) => left.trajectory.controlTrajectory.id.localeCompare(right.trajectory.controlTrajectory.id);

function assert(value, message) { if (!value) throw new Error(`PILOT_PREFLIGHT_INVALID: ${message}`); }
function splitChecks(corpus, config) {
  const seen = new Map();
  for (const record of corpus.trajectories) {
    const trajectory = record.trajectory.controlTrajectory;
    const prior = seen.get(trajectory.sceneSeed);
    assert(!prior || prior === trajectory.split, `scene seed ${trajectory.sceneSeed} leaks ${prior}/${trajectory.split}`);
    seen.set(trajectory.sceneSeed, trajectory.split);
  }
  for (const split of config.admission.requiredSplits) assert([...seen.values()].includes(split), `missing ${split} scene-seed split`);
  return Object.fromEntries([...seen].sort());
}
function populationPlan(population, corpus, config) {
  const trajectories = [...corpus.trajectories].sort(trajectorySort);
  const frames = trajectories.flatMap((record) => record.trajectory.controlTrajectory.frames.map((frame) => ({
    population: population.id, styleId: population.style.id, trajectoryId: record.trajectory.controlTrajectory.id,
    sceneSeed: record.trajectory.controlTrajectory.sceneSeed, split: record.trajectory.controlTrajectory.split,
    frameId: frame.frameId, frameIndex: frame.index, mode: frame.index === 0 ? "keyframe" : "edit",
  })));
  const counts = Object.fromEntries(config.admission.requiredSplits.map((split) => [split, frames.filter((frame) => frame.split === split).length]));
  for (const [split, minimum] of Object.entries(config.admission.minAcceptedFramesPerPopulation)) assert(counts[split] >= minimum, `${population.id} ${split} has ${counts[split]}, needs ${minimum}`);
  return { population: population.id, styleId: population.style.id, frames, counts };
}
async function requestsForPopulation({ population, corpus, corpusRoot, uploadRoot, config }) {
  const requests = [];
  for (const record of [...corpus.trajectories].sort(trajectorySort)) {
    const trajectory = record.trajectory.controlTrajectory;
    for (const frame of trajectory.frames) {
      const references = CONTROL_ROLES.map((role) => uploadRef(population.id, trajectory.id, frame.frameId, role));
      const control = await encodeControlUploadManifest({ corpusRoot, record, frameId: frame.frameId, outputRoot: uploadRoot, providerReferences: references });
      // Edit requests deliberately stop here: an accepted prior target is a B10 result,
      // so preflight represents its provider handle without pretending an image exists.
      const prior = frame.index === 0 ? null : { providerReference: { fileId: `planned-accepted-prior:${hash({ population: population.id, trajectory: trajectory.id, frame: trajectory.frames[frame.index - 1].frameId }).slice(0, 24)}` } };
      if (prior) await writeFile(join(uploadRoot, `${population.id}-${trajectory.id.replaceAll("/", "-")}-${frame.frameId}-prior.json`), `${JSON.stringify({ schemaVersion: "glyph-target-upload-manifest/v1", placeholder: true })}\n`);
      if (prior) {
        // The B9 admission constructor correctly refuses invented prior targets. Constructing
        // this preflight request from its immutable admitted keyframe shape retains every
        // outbound field while marking the prior reference as an unspent placeholder.
        const startFrame = trajectory.frames[0];
        const startControl = await encodeControlUploadManifest({ corpusRoot, record, frameId: startFrame.frameId, outputRoot: uploadRoot, providerReferences: CONTROL_ROLES.map((role) => uploadRef(population.id, trajectory.id, startFrame.frameId, role)) });
        const keyframe = await admitTrajectoryTarget({ corpusManifestPath: join(corpusRoot, "manifest.json"), trajectoryId: trajectory.id, nextFrameId: startFrame.frameId, style: population.style, controlUploadManifestPath: startControl.path, controlUploadRoot: uploadRoot, candidates: config.provider.candidatesPerRequest, output: config.provider.output });
        const next = structuredClone(keyframe);
        next.mode = "edit"; next.current = { frameId: trajectory.frames[frame.index - 1].frameId, index: frame.index - 1, controlSha256: `planned:${hash({ trajectory: trajectory.id, frame: frame.index - 1 })}` };
        next.next = { frameId: frame.frameId, index: frame.index, controlSha256: `planned:${hash({ trajectory: trajectory.id, frame: frame.index })}` };
        next.priorAcceptedTarget = { targetId: `planned/${population.id}/${trajectory.id.replaceAll("/", "-")}/${frame.index - 1}`, contentSha256: hash(`planned-content:${population.id}:${trajectory.id}:${frame.index - 1}`), imageSha256: hash(`planned-image:${population.id}:${trajectory.id}:${frame.index - 1}`), sequenceId: trajectory.id, frameId: trajectory.frames[frame.index - 1].frameId, providerReference: prior.providerReference };
        delete next.requestSha256; next.requestSha256 = hash(next); requests.push(next);
      } else {
        requests.push(await admitTrajectoryTarget({ corpusManifestPath: join(corpusRoot, "manifest.json"), trajectoryId: trajectory.id, nextFrameId: frame.frameId, style: population.style, controlUploadManifestPath: control.path, controlUploadRoot: uploadRoot, candidates: config.provider.candidatesPerRequest, output: config.provider.output }));
      }
    }
  }
  return requests;
}
export async function preparePilotDryRun({ configPath = join(root, "config/pilot.json") } = {}) {
  const config = await json(configPath);
  assert(config.schemaVersion === "glyph-pilot-config/v1", "config schema");
  validatePilotPricing(config.provider.pricing, config.provider.outputCostPerCandidateUsd);
  assert(config.provider.inputCostStatus === "unpriced-fail-closed; dedicated project hard-limit confirmation and tracked-spend baseline required", "input billing policy");
  assert(config.populations.map((value) => value.id).join(",") === "base,style-a,style-b", "population separation");
  const temporary = await mkdtemp(join(tmpdir(), "glyph-b11-preflight-"));
  try {
    const corpusRoot = join(temporary, "controls");
    const corpus = await generateCorpusAt(resolve(root, config.corpusConfig), corpusRoot);
    const seedSplit = splitChecks(corpus, config);
    const populations = config.populations.map((population) => populationPlan(population, corpus, config));
    const all = [];
    for (const population of config.populations) all.push(...await requestsForPopulation({ population, corpus, corpusRoot, uploadRoot: join(temporary, "uploads"), config }));
    const plannedCalls = all.length;
    const plannedCandidates = all.reduce((total, request) => total + request.candidates, 0);
    assert(new Set(all.map((request) => request.requestSha256)).size === all.length, "duplicate request lineage");
    for (const request of all) assert(config.populations.some((population) => population.style.id === request.style.id), `unknown request style ${request.style.id}`);
    const reserveCalls = config.regenerationReserve.wholeTrajectorySlots * corpus.trajectories[0].trajectory.controlTrajectory.frames.length;
    const reserveCandidates = reserveCalls * config.provider.candidatesPerRequest;
    const outputCost = (count) => Math.round(count * config.provider.outputCostPerCandidateUsd * 1e6) / 1e6;
    let spendPrerequisite = null;
    try { spendPrerequisite = validateProviderSpendPrerequisite(config.provider.providerSpendPrerequisite); } catch (error) { if (error.message !== "PILOT_PROVIDER_HARD_LIMIT_CONFIRMATION_REQUIRED") throw error; }
    const report = {
      schemaVersion: "glyph-pilot-preflight/v1", status: "hold", configSha256: hash(config), provider: config.provider,
      remoteLayout: { root: config.remoteRoot, controls: "controls/", uploads: "uploads/", ledger: "ledger/requests/", targets: "targets/<population>/<split>/<trajectory>/<frame>/", manifests: "manifests/" },
      seedSplit, populations,
      inputShapes: { keyframe: { controlImages: 9, dimensions: { "192x192": 2, "24x16": 7 } }, edit: { controlImages: 9, priorTargetImages: 1, dimensions: { "1024x1024": 1, "192x192": 2, "24x16": 7 } }, promptText: "exact strings are included in each redacted outbound request; token count is provider-reconciled, never estimated" },
      planned: { apiCalls: plannedCalls, candidateCount: plannedCandidates, outputOnlyCostUsd: outputCost(plannedCandidates) },
      regenerationReserve: { apiCalls: reserveCalls, candidateCount: reserveCandidates, outputOnlyCostUsd: outputCost(reserveCandidates), ...config.regenerationReserve },
      maximum: { apiCalls: plannedCalls + reserveCalls, candidateCount: plannedCandidates + reserveCandidates, outputOnlyCostUsd: outputCost(plannedCandidates + reserveCandidates), fullHardApprovalCeilingUsd: spendPrerequisite?.effectiveRemainingProjectAllowanceUsd ?? null, maxConcurrent: 1, currency: "USD" },
      providerSpendPrerequisite: { ...config.provider.providerSpendPrerequisite, effectiveRemainingProjectAllowanceUsd: spendPrerequisite?.effectiveRemainingProjectAllowanceUsd ?? null },
      billingGate: "REJECT_LIVE_RUN: GPT Image 1.5 image-input tokenization/max charge is not documented. OpenAI project hard-limit confirmation plus the current tracked-spend baseline are required; limits can slightly overshoot, so post-response text/image-token reconciliation is audit-only and missing/unknown usage stops continuation.",
      requests: all.map((request) => ({ requestSha256: request.requestSha256, population: config.populations.find((entry) => entry.style.id === request.style.id).id, sceneSeed: corpus.trajectories.find((entry) => entry.trajectory.controlTrajectory.id === request.trajectory.trajectoryId).trajectory.controlTrajectory.sceneSeed, split: corpus.trajectories.find((entry) => entry.trajectory.controlTrajectory.id === request.trajectory.trajectoryId).trajectory.controlTrajectory.split, outbound: redact(buildOpenAIRequest(request, { model: config.provider.model })), placeholderReferences: true })),
      reconstruction: { command: "pnpm --filter @glyphcss/ascii-image-generation pilot:dry-run -- --check", mockOnly: true, secretsRead: false, providerCalls: 0, admittedImages: 0 },
      verdict: "HOLD"
    };
    return report;
  } finally { await rm(temporary, { recursive: true, force: true }); }
}
if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  const args = new Set(process.argv.slice(2));
  if (!args.has("--dry-run")) throw new Error("PILOT_PREFLIGHT_INVALID: only --dry-run is permitted");
  const report = await preparePilotDryRun();
  if (!args.has("--check")) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else process.stdout.write(`${JSON.stringify({ verdict: report.verdict, apiCalls: report.maximum.apiCalls, candidateCount: report.maximum.candidateCount, outputOnlyCostUsd: report.maximum.outputOnlyCostUsd, fullHardApprovalCeilingUsd: report.maximum.fullHardApprovalCeilingUsd, providerHardLimitConfirmed: report.providerSpendPrerequisite.hardLimitEnabled === true && report.providerSpendPrerequisite.confirmation !== null, providerCalls: report.reconstruction.providerCalls }, null, 2)}\n`);
}
