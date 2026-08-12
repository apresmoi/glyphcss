import { mkdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { generateCorpusAt } from "./generate-controls.mjs";
import { finalizePilotDataset } from "./pilot-dataset.mjs";
import { loadPilotB10Authority, validatePilotB10Acceptance } from "./pilot-acceptance.mjs";
import { reconcilePilotUsage, validatePilotPricing, validateProviderSpendPrerequisite } from "./pilot-billing.mjs";
import { CONTROL_ROLES, admitTrajectoryTarget, createTargetUploadManifest, persistPilotLiveTargetCandidates } from "./targets/provider-core.mjs";
import { encodeControlUploadManifest } from "./targets/control-png.mjs";

const root = resolve(dirname(new URL(import.meta.url).pathname), "..");
const sortRecords = (left, right) => left.trajectory.controlTrajectory.id.localeCompare(right.trajectory.controlTrajectory.id);

function assertLiveProvider(provider, projectId, model) {
  if (!provider || provider.id !== "openai-images/v1" || provider.apiVersion !== "openai-images/v1" || provider.projectId !== projectId) throw new Error("OPENAI_PROJECT_ATTRIBUTION_MISMATCH");
  if (provider.model !== model) throw new Error("PILOT_PROVIDER_MODEL_MISMATCH");
  if (typeof provider.controlReference !== "function") throw new Error("PILOT_CONTROL_UPLOAD_PROVIDER_REQUIRED");
}

// This is the sole production route. It constructs each next-view request only
// after the prior frame has passed B10, and reconciles usage before advancing.
export async function runPilotLive({ provider, evaluateTarget, outputRoot, configPath = join(root, "config/pilot.json") }) {
  if (typeof evaluateTarget !== "function") throw new Error("PILOT_LIVE_IMAGE_ADMISSION_EVALUATOR_REQUIRED");
  const config = JSON.parse(await readFile(configPath, "utf8"));
  if (config.schemaVersion !== "glyph-pilot-config/v1") throw new Error("PILOT_PREFLIGHT_INVALID: config schema");
  validatePilotPricing(config.provider.pricing, config.provider.outputCostPerCandidateUsd);
  const prerequisite = validateProviderSpendPrerequisite(config.provider.providerSpendPrerequisite);
  const b10Authority = await loadPilotB10Authority();
  assertLiveProvider(provider, config.provider.providerSpendPrerequisite.dedicatedProjectId, config.provider.model);
  const destination = resolve(outputRoot), corpusRoot = join(destination, "controls"), uploadRoot = join(destination, "uploads");
  await mkdir(destination, { recursive: true });
  const corpus = await generateCorpusAt(join(root, config.corpusConfig), corpusRoot);
  const selections = [];
  let accountedUsd = 0, reserveUsed = 0, dispatched = 0;
  const reserveByPopulation = new Map();
  const dispatch = async ({ population, record, frame, prior, regeneration }) => {
    const trajectory = record.trajectory.controlTrajectory;
    const providerReferences = CONTROL_ROLES.map((role) => ({ role, ...provider.controlReference({ population: population.id, trajectoryId: trajectory.id, frameId: frame.frameId, role, regeneration }) }));
    const upload = await encodeControlUploadManifest({ corpusRoot, record, frameId: frame.frameId, outputRoot: uploadRoot, providerReferences });
    let priorUpload = null;
    if (prior) {
      priorUpload = join(uploadRoot, `prior-${population.id}-${trajectory.id.replaceAll("/", "-")}-${frame.frameId}-${regeneration}.json`);
      await createTargetUploadManifest({ targetMetadataPath: join(destination, prior.metadataPath), artifactRoot: destination, outputPath: priorUpload, providerReference: provider.controlReference({ population: population.id, trajectoryId: trajectory.id, frameId: frame.frameId, role: "prior", regeneration }) });
    }
    const request = await admitTrajectoryTarget({ corpusManifestPath: join(corpusRoot, "manifest.json"), trajectoryId: trajectory.id, nextFrameId: frame.frameId, style: population.style, controlUploadManifestPath: upload.path, controlUploadRoot: uploadRoot, priorTargetUploadManifestPath: priorUpload, priorArtifactRoot: prior ? destination : null, candidates: config.provider.candidatesPerRequest, output: config.provider.output });
    const outputFloor = request.candidates * config.provider.outputCostPerCandidateUsd;
    if (accountedUsd + outputFloor > prerequisite.effectiveRemainingProjectAllowanceUsd) throw new Error("PILOT_PROJECT_ALLOWANCE_INSUFFICIENT");
    const publication = await persistPilotLiveTargetCandidates({ provider, request, outputRoot: destination, costCeilingUsd: prerequisite.effectiveRemainingProjectAllowanceUsd - accountedUsd, costPerCandidateUsd: config.provider.outputCostPerCandidateUsd });
    const reconciliation = reconcilePilotUsage({ pricing: config.provider.pricing, outputCostPerCandidateUsd: config.provider.outputCostPerCandidateUsd }, accountedUsd, request.candidates, publication.usage);
    if (reconciliation.accountedUsd > prerequisite.effectiveRemainingProjectAllowanceUsd) throw new Error("PILOT_PROJECT_ALLOWANCE_INSUFFICIENT");
    accountedUsd = reconciliation.accountedUsd;
    dispatched += 1;
    for (const candidate of publication.targets) {
      const target = JSON.parse(await readFile(join(destination, candidate.metadataPath), "utf8"));
      try { return { accepted: candidate, acceptance: await validatePilotB10Acceptance(await evaluateTarget({ target, corpusRoot, record, frameId: frame.frameId }), target, b10Authority) }; } catch (error) {
        if (!String(error?.message).startsWith("PILOT_B10_REJECTED_")) throw error;
      }
    }
    return null;
  };
  for (const population of config.populations) for (const record of [...corpus.trajectories].sort(sortRecords)) {
    const trajectory = record.trajectory.controlTrajectory;
    let prior = null, acceptedTrajectory = null;
    for (let regeneration = 0; acceptedTrajectory === null; regeneration += 1) {
      if (regeneration > 0) {
        const allocation = config.regenerationReserve.allocation?.[population.id] ?? 0;
        if (reserveUsed >= config.regenerationReserve.wholeTrajectorySlots || (reserveByPopulation.get(population.id) ?? 0) >= allocation) throw new Error("PILOT_REGENERATION_RESERVE_EXHAUSTED");
        reserveUsed += 1;
        reserveByPopulation.set(population.id, (reserveByPopulation.get(population.id) ?? 0) + 1);
      }
      const attempt = [];
      prior = null;
      for (const frame of trajectory.frames) {
        const selected = await dispatch({ population, record, frame, prior, regeneration });
        if (!selected) break;
        attempt.push({ population, record, frameId: frame.frameId, ...selected });
        prior = selected.accepted;
      }
      if (attempt.length === trajectory.frames.length) acceptedTrajectory = attempt;
    }
    selections.push(...acceptedTrajectory);
  }
  const built = await finalizePilotDataset({ outputRoot: destination, config, corpus, corpusRoot, selections });
  return { ...built, accountedUsd, effectiveRemainingProjectAllowanceUsd: prerequisite.effectiveRemainingProjectAllowanceUsd, dispatched, reserveUsed, reserveByPopulation: Object.fromEntries(reserveByPopulation), maxConcurrent: 1 };
}
