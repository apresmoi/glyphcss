#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { buildReferenceSignals } from "../src/referenceSignals.mjs";

const root = resolve(import.meta.dirname, "..");
const [tracePath, evidenceRoot] = process.argv.slice(2);
if (!tracePath || !evidenceRoot) throw new Error("USAGE: prepare-reference-evidence.mjs TRACE_PATH EVIDENCE_ROOT");
const canonical = (value) => Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : value && typeof value === "object" ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}` : JSON.stringify(value);
const sha = (value) => createHash("sha256").update(value).digest("hex");
const isHash = (value) => /^[a-f0-9]{64}$/.test(value ?? "");
const finite = (value) => Number.isFinite(value) && value >= 0;
const b39ResultChainSha256 = "a804bbdb657fb2d66b263c7681ef2ade4688674070d3c491d9ba2fd2b6ff6297";
const traceBytes = await readFile(tracePath);
const trace = JSON.parse(traceBytes);
const contractPath = join(root, "fixtures/reprojection/reference-trace-v1.json");
const contractBytes = await readFile(contractPath);
const contract = JSON.parse(contractBytes);
const measurementContract = JSON.parse(await readFile(join(root, "config/measurement-gates.json"), "utf8"));
const measurementContractSha256 = sha(canonical(measurementContract));
const g5SignatureSha256 = sha(canonical(measurementContract.gates.find((gate) => gate.id === "G5")));
if (measurementContract.contractVersion !== "v3" || measurementContractSha256 !== "122b3a42d75f9e9a0b473c9c2c38814cce3dc4239d27bb935af183c7e9fd43e9" || g5SignatureSha256 !== "0fee24a6ca7019f5a92974476e606b89eb990695b240a1cdfbab437d92e8885e") throw new Error("REFERENCE_G5_CONTRACT_DRIFT");
if (trace.schemaVersion !== "glyph-reprojection-webgpu-benchmark/v2") throw new Error(`REFERENCE_B37_SCHEMA:${trace.schemaVersion}`);
if (trace.browser?.version !== "140.0.7339.80") throw new Error(`REFERENCE_BROWSER_MISMATCH:${trace.browser?.version}`);

const environmentManifestPath = trace.provenance?.environmentManifestPath;
if (typeof environmentManifestPath !== "string" || !environmentManifestPath) throw new Error("REFERENCE_ENVIRONMENT_MANIFEST_PATH");
const environmentManifestBytes = await readFile(environmentManifestPath);
if (trace.provenance.environmentManifestSha256 !== sha(environmentManifestBytes)) throw new Error("REFERENCE_ENVIRONMENT_MANIFEST_HASH");
const environment = JSON.parse(environmentManifestBytes);
if (environment.schemaVersion !== "glyph-reprojection-reference-environment/v1"
  || !/^(?=.{2,80}$)[a-z0-9][a-z0-9._-]*[a-z0-9]$/.test(environment.runId ?? "")
  || basename(dirname(environmentManifestPath)) !== environment.runId
  || !/^sha256:[a-f0-9]{64}$/.test(environment.image?.id ?? "")
  || environment.image?.base !== "mcr.microsoft.com/playwright@sha256:6446946a1d9fd62d9ae501312a2d76a43ee688542b21622056a372959b65d63d"
  || ![environment.source?.archiveSha256, environment.source?.fileSetSha256, environment.software?.packageSha256, environment.software?.lockfileSha256].every(isHash)
  || typeof environment.host?.os !== "string" || !environment.host.os
  || typeof environment.host?.containerOsRelease !== "string" || !environment.host.containerOsRelease
  || environment.gpu?.model !== "NVIDIA GeForce RTX 4090 Laptop GPU"
  || environment.gpu?.memory !== "16376 MiB"
  || !/^[0-9]+\.[0-9]+(?:\.[0-9]+)?$/.test(environment.gpu?.driver ?? "")
  || !/^GPU-[a-f0-9-]+$/i.test(environment.gpu?.uuid ?? "")) throw new Error("REFERENCE_ENVIRONMENT_MANIFEST_SHAPE");
if (environment.software.packageSha256 !== sha(await readFile(join(root, "package.json")))
  || environment.software.lockfileSha256 !== sha(await readFile(join(root, "../../pnpm-lock.yaml")))) throw new Error("REFERENCE_ENVIRONMENT_SOFTWARE_HASH");

const adapter = JSON.stringify(trace.webgpu?.adapter ?? {}).toLowerCase();
if (!adapter.includes("nvidia") || /swiftshader|llvmpipe|software|cpu|mesa/.test(adapter)) throw new Error(`REFERENCE_ADAPTER_REJECTED:${adapter}`);
if (trace.webgpu?.isFallbackAdapter !== false) throw new Error("REFERENCE_WEBGPU_FALLBACK_ADAPTER");
if (canonical(trace.hardware?.nvidiaSmi) !== canonical(environment.gpu)) throw new Error("REFERENCE_NVIDIA_SMI_MANIFEST_MISMATCH");
const activeDevices = trace.webgpu?.cdp?.devices?.filter((device) => device.active);
if (activeDevices?.length !== 1 || !String(activeDevices[0].deviceString).includes("NVIDIA GeForce RTX 4090 Laptop GPU")) throw new Error("REFERENCE_CDP_ACTIVE_GPU_IDENTITY");
if (/swiftshader|llvmpipe|software|cpu|mesa/.test(JSON.stringify(trace.webgpu.cdp.devices).toLowerCase())) throw new Error("REFERENCE_CDP_SOFTWARE_GPU");
if (trace.frozenTrace?.contract !== "fixtures/reprojection/reference-trace-v1.json"
  || trace.frozenTrace?.contractSha256 !== sha(contractBytes)
  || trace.frozenTrace?.inputSha256 !== contract.expected.inputSha256
  || trace.frozenTrace?.frameSha256 !== contract.expected.frameSha256
  || trace.frozenTrace?.eventSha256 !== contract.expected.eventSha256
  || trace.frozenTrace?.measurementContractSha256 !== measurementContractSha256
  || trace.frozenTrace?.g5SignatureSha256 !== g5SignatureSha256) throw new Error("REFERENCE_TRACE_CONTRACT_MISMATCH");

const expectedTransitions = contract.segments.flatMap((segment) => {
  const count = 1 + segment.subdivisionsPerLeg * 2 + (segment.kind === "reset" ? 1 : 0);
  return Array.from({ length: count }, (_, index) => ({
    frame: `${segment.id}/${String(index).padStart(2, "0")}`,
    reset: index === 0 || (segment.kind === "reset" && index === segment.subdivisionsPerLeg + 1),
  }));
});
const runs = trace.frozenTrace?.runs, framesPerRun = trace.frozenTrace?.framesPerRun, oracle = trace.frozenTrace?.oracle, resultHashes = oracle?.resultHashes;
if (runs !== 40 || framesPerRun !== 326 || expectedTransitions.length !== framesPerRun || !oracle?.exact
  || oracle.readbackCount !== framesPerRun || oracle.checkpointCount !== framesPerRun || oracle.presentationReadbackCount !== framesPerRun
  || !Array.isArray(resultHashes) || resultHashes.length !== framesPerRun || resultHashes.some((value) => !isHash(value))) throw new Error("REFERENCE_RESULT_CHAIN_SHAPE");
const resultChainSha256 = sha(canonical(resultHashes));
if (resultChainSha256 !== b39ResultChainSha256 || trace.frozenTrace.resultChainSha256 !== b39ResultChainSha256) throw new Error("REFERENCE_RESULT_CHAIN_HASH");

const proofs = oracle.proofs;
if (!Array.isArray(proofs) || proofs.length !== framesPerRun) throw new Error("REFERENCE_ORACLE_PROOF_SHAPE");
for (let index = 0; index < framesPerRun; index += 1) {
  const proof = proofs[index], expected = expectedTransitions[index];
  if (proof?.frame !== expected.frame || proof?.reset !== expected.reset || proof?.readbackExact !== true || proof?.checkpointExact !== true || proof?.presentationExact !== true
    || proof?.resultSha256 !== resultHashes[index] || !isHash(proof?.checkpointContentSha256) || !isHash(proof?.presentationSha256)
    || proof?.presentationBytes !== contract.measurementGrid.cols * contract.measurementGrid.rows * 4 || proof?.presentationMismatchBytes !== 0) throw new Error(`REFERENCE_ORACLE_PROOF_MISMATCH:${index}`);
}

const spans = trace.spans;
if (!Array.isArray(spans) || spans.length !== runs * framesPerRun) throw new Error("REFERENCE_TIMED_RUN_SHAPE");
const sampleIds = new Set();
for (let index = 0; index < spans.length; index += 1) {
  const span = spans[index], run = Math.floor(index / framesPerRun), expected = expectedTransitions[index % framesPerRun];
  const sampleId = `${String(run).padStart(2, "0")}:${expected.frame}`;
  if (span?.sampleId !== sampleId || span?.run !== run || span?.frame !== expected.frame || span?.reset !== expected.reset || sampleIds.has(span.sampleId)) throw new Error(`REFERENCE_TIMED_RUN_ORDER:${index}`);
  sampleIds.add(span.sampleId);
  if (span.timedInvariant?.readback !== false || span.timedInvariant?.checkpoint !== false || span.timedInvariant?.hash !== false || span.timedInvariant?.fullStateSerialization !== false || span.timedInvariant?.cpuReprojection !== false || span.timedInvariant?.evidenceDigest !== false || span.timedInvariant?.preTextContent !== false || span.timedInvariant?.persistentCanvas !== true) throw new Error(`REFERENCE_TIMED_PATH_CONTAMINATED:${span.sampleId}`);
}
if (sampleIds.size !== runs * framesPerRun) throw new Error("REFERENCE_TIMED_RUN_DUPLICATE_IDS");

const oracleMetrics = oracle.metrics;
if (!Array.isArray(oracleMetrics) || oracleMetrics.length !== framesPerRun) throw new Error("REFERENCE_ORACLE_METRIC_SHAPE");
const metricByFrame = new Map();
for (let index = 0; index < oracleMetrics.length; index += 1) {
  const metric = oracleMetrics[index], expected = expectedTransitions[index];
  if (metric?.frame !== expected.frame || metricByFrame.has(metric.frame) || ![metric.coveredCells, metric.validCells, metric.disoccludedCells].every((value) => Number.isSafeInteger(value) && value >= 0) || !finite(metric.validPixelError)) throw new Error(`REFERENCE_ORACLE_METRIC_SHAPE:${index}`);
  metricByFrame.set(metric.frame, metric);
}
for (const span of spans) {
  const metric = metricByFrame.get(span.frame);
  if (!metric || ![span.presentationMs, span.submitEnqueueMs, span.gpuCompletionMs, span.compositorPresentationMs].every(finite)
    || span.coveredCells !== metric.coveredCells || span.validCells !== metric.validCells || span.disoccludedCells !== metric.disoccludedCells || span.validPixelError !== metric.validPixelError) throw new Error(`REFERENCE_SPAN_METRIC_MISMATCH:${span.frame}`);
}
const derivedSignals = buildReferenceSignals(spans, framesPerRun, runs);
if (canonical(derivedSignals) !== canonical(trace.signals)) throw new Error("REFERENCE_SIGNAL_DERIVATION_MISMATCH");

const profiles = trace.profile?.transitions;
const profileCpuKeys = ["routingMs", "uploadEnqueueMs", "dispatchEncodingMs", "renderEncodingMs", "canvasSubmitMs", "gpuCompletionMs", "submitTotalMs"];
if (trace.profile?.boundedTransitions !== 8 || !Array.isArray(profiles) || profiles.length !== 8) throw new Error("REFERENCE_PROFILE_SHAPE");
const timestampQuery = trace.profile?.timestampQueryExposed === true;
if (!Array.isArray(trace.webgpu?.features) || trace.webgpu.features.includes("timestamp-query") !== timestampQuery) throw new Error("REFERENCE_PROFILE_TIMESTAMP_FEATURE_EXPOSURE");
for (let index = 0; index < profiles.length; index += 1) {
  const profile = profiles[index], expected = expectedTransitions[index], profileId = `profile-${String(index).padStart(2, "0")}`;
  if (profile?.profileId !== profileId || profile?.index !== index || profile?.frame !== expected.frame || profile?.reset !== expected.reset || !finite(profile?.compositorPresentationMs)
    || !profileCpuKeys.every((key) => finite(profile.cpu?.[key]))) throw new Error(`REFERENCE_PROFILE_CPU_PHASES:${index}`);
  const encodedTotal = profile.cpu.routingMs + profile.cpu.uploadEnqueueMs + profile.cpu.dispatchEncodingMs + profile.cpu.renderEncodingMs + profile.cpu.canvasSubmitMs;
  if (profile.cpu.submitTotalMs + 1e-6 < encodedTotal) throw new Error(`REFERENCE_PROFILE_CPU_TOTAL:${index}`);
  if (profile.gpu?.timestampQuery !== timestampQuery) throw new Error("REFERENCE_PROFILE_TIMESTAMP_FEATURE_DRIFT");
  if (timestampQuery && (![profile.gpu.computeNs, profile.gpu.renderNs, profile.gpu.totalNs].every(finite) || profile.gpu.totalNs !== profile.gpu.computeNs + profile.gpu.renderNs)) throw new Error(`REFERENCE_PROFILE_GPU_PHASES:${index}`);
  if (!timestampQuery && (profile.gpu.computeNs !== null || profile.gpu.renderNs !== null || profile.gpu.totalNs !== null || typeof profile.gpu.unavailableReason !== "string" || !profile.gpu.unavailableReason)) throw new Error("REFERENCE_PROFILE_GPU_UNAVAILABLE");
}

const cdpTraceBytes = await readFile(`${tracePath}.cdp-profile.json`);
if (trace.profile?.cdp?.path !== `${tracePath}.cdp-profile.json` || trace.profile.cdp.sha256 !== sha(cdpTraceBytes)) throw new Error("REFERENCE_CDP_TRACE_HASH");
let cdpPayload;
try { cdpPayload = JSON.parse(cdpTraceBytes); } catch { throw new Error("REFERENCE_CDP_TRACE_PARSE"); }
const cdpEvents = cdpPayload?.traceEvents;
if (!Array.isArray(cdpEvents) || cdpEvents.length === 0) throw new Error("REFERENCE_CDP_TRACE_EMPTY");
const presentationNames = /^(?:DrawFrame|Display::FrameDisplayed|SubmitCompositorFrame|SwapBuffers|FramePresented)$/;
const recomputedCorrelations = profiles.map((profile, index) => {
  const startName = `b37-profile/${profile.profileId}/${profile.frame}/start`, endName = `b37-profile/${profile.profileId}/${profile.frame}/end`;
  const starts = cdpEvents.filter((event) => event?.name === startName && Number.isFinite(event.ts));
  const ends = cdpEvents.filter((event) => event?.name === endName && Number.isFinite(event.ts));
  if (starts.length !== 1 || ends.length !== 1 || ends[0].ts <= starts[0].ts) throw new Error(`REFERENCE_CDP_MARK_PAIR:${index}`);
  const presentation = cdpEvents.find((event) => Number.isFinite(event?.ts) && event.ts >= starts[0].ts && event.ts <= ends[0].ts && presentationNames.test(event.name ?? "") && !String(event.cat ?? "").includes("user_timing"));
  if (!presentation) throw new Error(`REFERENCE_CDP_PRESENTATION_EVENT:${index}`);
  return { profileId: profile.profileId, index, frame: profile.frame, startTs: starts[0].ts, endTs: ends[0].ts, presentationEvent: presentation.name, presentationTs: presentation.ts };
});
if (canonical(trace.profile.cdp.correlations) !== canonical(recomputedCorrelations)) throw new Error("REFERENCE_PRESENTATION_CORRELATION");

const prior = contract.supersedes;
if (prior?.preserved !== true || prior.referenceImageSha256 !== "3a034dd9275e3451e190e0df50da9891e8fee611c5092aa0034a1de9d206148f" || prior.traceSha256 !== "4b9d7ef97a9d765067aa019f598e147117507c3e0e9530ac44ce206f89d35c7d" || prior.normalizedSummarySha256 !== "25a6b35665a89ef4999eb1259e40ab05c8a972164e0c4f5966d043d901a19e70" || prior.runManifestSha256 !== "7ae59aad465be911e46f0f5d2ef9514b24982439efaa25cf2d915dc88125ae25" || prior.redSignals?.coverage !== .5 || prior.redSignals?.["newly-revealed-area"] !== .5) throw new Error("REFERENCE_PRIOR_RED_EVIDENCE_DRIFT");
const deterministic = ["presentation-p95", "coverage", "valid-pixel-error", "newly-revealed-area", "temporal-warp-error", "reset-frequency"];
const unavailable = ["disocclusion-recovery-latency", "correction-magnitude", "stale-result-rejection"];
for (const id of deterministic) if (!Number.isFinite(trace.signals?.[id]?.value)) throw new Error(`MISSING_REFERENCE_SIGNAL:${id}`);
for (const id of unavailable) if (trace.signals?.[id]?.value !== null || !trace.signals[id].reason) throw new Error(`REFERENCE_SIGNAL_MUST_BE_UNAVAILABLE:${id}`);
const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
const decomposition = {
  boundedTransitions: profiles.length,
  timestampQuery,
  cpu: {
    routingMeanMs: mean(profiles.map((profile) => profile.cpu.routingMs)),
    uploadEnqueueMeanMs: mean(profiles.map((profile) => profile.cpu.uploadEnqueueMs)),
    dispatchEncodingMeanMs: mean(profiles.map((profile) => profile.cpu.dispatchEncodingMs)),
    renderEncodingMeanMs: mean(profiles.map((profile) => profile.cpu.renderEncodingMs)),
    canvasSubmitMeanMs: mean(profiles.map((profile) => profile.cpu.canvasSubmitMs)),
    gpuCompletionMeanMs: mean(profiles.map((profile) => profile.cpu.gpuCompletionMs)),
    compositorPresentationMeanMs: mean(profiles.map((profile) => profile.compositorPresentationMs)),
  },
  gpu: timestampQuery ? {
    computeMeanNs: mean(profiles.map((profile) => profile.gpu.computeNs)),
    renderMeanNs: mean(profiles.map((profile) => profile.gpu.renderNs)),
    totalMeanNs: mean(profiles.map((profile) => profile.gpu.totalNs)),
  } : { computeMeanNs: null, renderMeanNs: null, totalMeanNs: null, unavailableReason: profiles[0].gpu.unavailableReason },
  cdpCorrelatedTransitions: recomputedCorrelations.length,
};
const provenance = {
  runId: environment.runId,
  environmentManifestPath,
  environmentManifestSha256: sha(environmentManifestBytes),
  imageId: environment.image.id,
  sourceArchiveSha256: environment.source.archiveSha256,
  sourceFileSetSha256: environment.source.fileSetSha256,
  packageSha256: environment.software.packageSha256,
  lockfileSha256: environment.software.lockfileSha256,
  hostOs: environment.host.os,
  containerOsReleaseSha256: sha(environment.host.containerOsRelease),
  driver: environment.gpu.driver,
  gpuUuid: environment.gpu.uuid,
};
const p95 = trace.signals["presentation-p95"].value;
const artifact = {
  schemaVersion: "glyph-reprojection-reference-partial-evidence/v1",
  status: "partial-non-pass",
  fullG5Pass: false,
  contract: { path: trace.frozenTrace.contract, sha256: trace.frozenTrace.contractSha256, inputSha256: trace.frozenTrace.inputSha256, frameSha256: trace.frozenTrace.frameSha256, eventSha256: trace.frozenTrace.eventSha256, resultChainSha256 },
  measurementContract: { path: "config/measurement-gates.json", version: "v3", sha256: measurementContractSha256, g5SignatureSha256 },
  hardware: { browser: "Chromium 140.0.7339.80", gpu: "LeDeluge NVIDIA GeForce RTX 4090 Laptop GPU (16 GB)", runtime: "Browser WebGPU only; CPU fallback disabled" },
  provenance,
  signals: Object.fromEntries([...deterministic, ...unavailable].map((id) => [id, trace.signals[id]])),
  latencyGate: { metric: "presentation-p95", operator: "<=", threshold: 33.3, actual: p95, pass: p95 <= 33.3 },
  decomposition,
  priorRedEvidence: { preserved: true, traceSha256: prior.traceSha256, normalizedSummarySha256: prior.normalizedSummarySha256, referenceImageSha256: prior.referenceImageSha256, runManifestSha256: prior.runManifestSha256, coverage: prior.redSignals.coverage, newlyRevealedArea: prior.redSignals["newly-revealed-area"] },
  traceSha256: sha(traceBytes),
};
const schema = JSON.parse(await readFile(join(root, "config/reference-partial-evidence.schema.json"), "utf8"));
const validate = new Ajv2020({ strict: true }).compile(schema);
if (!validate(artifact)) throw new Error(`REFERENCE_PARTIAL_SCHEMA:${JSON.stringify(validate.errors)}`);
const artifactText = `${canonical(artifact)}\n`;
await mkdir(evidenceRoot, { recursive: true });
await writeFile(join(evidenceRoot, "reference-partial-evidence.json"), artifactText);
const integrity = {
  schemaVersion: "glyph-reprojection-reference-partial-integrity/v1",
  artifact: "reference-partial-evidence.json",
  artifactSha256: sha(artifactText),
  contractSha256: artifact.contract.sha256,
  eventSha256: artifact.contract.eventSha256,
  resultChainSha256,
  measurementContractSha256,
  g5SignatureSha256,
  environmentManifestSha256: provenance.environmentManifestSha256,
  runId: provenance.runId,
  imageId: provenance.imageId,
  sourceArchiveSha256: provenance.sourceArchiveSha256,
  sourceFileSetSha256: provenance.sourceFileSetSha256,
  packageSha256: provenance.packageSha256,
  lockfileSha256: provenance.lockfileSha256,
  driver: provenance.driver,
  gpuUuid: provenance.gpuUuid,
};
await writeFile(join(evidenceRoot, "reference-partial-integrity.json"), `${canonical(integrity)}\n`);
console.log(JSON.stringify(integrity));
