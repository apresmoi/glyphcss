import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { parseOpenAIImageUsage } from "../pilot-billing.mjs";

export const TARGET_SCHEMA_VERSION = "glyph-image-target/v2";
export const PROVIDER_CONTRACT_VERSION = "glyph-target-provider/v2";
export const OPENAI_API_VERSION = "openai-images/v1";
export const CONTROL_ROLES = Object.freeze([
  "visible-ascii", "semantic-ascii", "semantic-color", "depth", "normal",
  "world-position", "surface-uv", "coverage", "shade",
]);

const ROLE_SOURCE = Object.freeze({
  "visible-ascii": ["visible", "visible"],
  "semantic-ascii": ["semantic", "semantic"],
  "semantic-color": ["semantic", "semantic-color-argb"],
  depth: ["visible", "depth-normalized-f32"],
  normal: ["visible", "normal-normalized-f32"],
  "world-position": ["visible", "world-position-normalized-f32"],
  "surface-uv": ["visible", "surface-uv-normalized-f32"],
  coverage: ["visible", "coverage-u8"],
  shade: ["visible", "shade-f32"],
});
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const PILOT_LIVE_CAPABILITY = Symbol("pilot-live-capability");
export const canonicalJson = (value) => value === null || typeof value !== "object"
  ? JSON.stringify(value)
  : Array.isArray(value)
    ? `[${value.map(canonicalJson).join(",")}]`
    : `{${Object.keys(value).filter((key) => key !== "contentSha256").sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
export const contentSha256 = (value) => sha256(canonicalJson(value));
const requestSha256 = (value) => { const raw = { ...value }; delete raw.requestSha256; return contentSha256(raw); };
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

function confined(root, path) {
  const base = resolve(root);
  const candidate = resolve(base, path);
  if (candidate !== base && !candidate.startsWith(`${base}${sep}`)) throw new Error(`path escapes artifact root: ${path}`);
  return candidate;
}
async function readJson(path) { return JSON.parse(await readFile(path, "utf8")); }
async function atomicWrite(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, value);
  await rename(temporary, path);
}
function assertHash(value, label) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) throw new Error(`${label} must be sha256`);
}
function assertId(value, label) {
  if (typeof value !== "string" || !/^[a-z][a-z0-9._/-]*$/.test(value)) throw new Error(`${label} must be a stable lowercase id`);
}
function providerReference(value, label) {
  if (!value || typeof value !== "object" || (typeof value.fileId !== "string" && typeof value.imageUrl !== "string")) throw new Error(`${label} requires fileId or HTTPS imageUrl`);
  if (value.imageUrl && !/^https:\/\//.test(value.imageUrl)) throw new Error(`${label}.imageUrl must be HTTPS`);
  return value.fileId ? { fileId: value.fileId } : { imageUrl: value.imageUrl };
}
function wireReference(value) { return value.fileId ? { file_id: value.fileId } : { image_url: value.imageUrl }; }
function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key, /authorization|api[_-]?key|token|secret/i.test(key) ? "[REDACTED]" : redact(item),
  ]));
}

async function treeHash(root) {
  const entries = [];
  const walk = async (directory) => {
    for (const name of (await readdir(directory)).sort()) {
      const path = join(directory, name);
      if ((await stat(path)).isDirectory()) await walk(path);
      else entries.push([relative(root, path).replaceAll("\\", "/"), sha256(await readFile(path))]);
    }
  };
  await walk(root);
  return contentSha256(entries);
}
async function validateBundle(root, expectedContentSha256, expectedTrajectorySha256, expectedControlTrajectorySha256, label) {
  const manifestPath = join(root, "manifest.json");
  const manifest = await readJson(manifestPath);
  if (manifest.schemaVersion !== "glyph-control-export/v1" || manifest.contentSha256 !== expectedContentSha256 || contentSha256(manifest) !== manifest.contentSha256) throw new Error(`${label} B6 manifest hash mismatch`);
  if ((expectedTrajectorySha256 && manifest.trajectory?.contentSha256 !== expectedTrajectorySha256) || manifest.trajectory?.controlTrajectory?.contentSha256 !== expectedControlTrajectorySha256) throw new Error(`${label} B6 trajectory binding mismatch`);
  for (const [path, expected] of Object.entries(manifest.files)) {
    const source = confined(root, path);
    if (sha256(await readFile(source)) !== expected) throw new Error(`${label} B6 file hash mismatch: ${path}`);
  }
  return { root, manifest, treeSha256: await treeHash(root) };
}
function frameById(bundle, frameId) {
  const frame = bundle.manifest.frames.find((item) => item.id === frameId);
  if (!frame) throw new Error(`B6 bundle has no frame ${frameId}`);
  return frame;
}
function frameControlSha256(visible, semantic, frameId) {
  const v = frameById(visible, frameId); const s = frameById(semantic, frameId);
  return contentSha256({ visibleManifestSha256: visible.manifest.contentSha256, semanticManifestSha256: semantic.manifest.contentSha256, visibleFiles: v.files, semanticFiles: s.files });
}

export async function admitTrajectoryTarget({
  corpusManifestPath, trajectoryId, nextFrameId, style, controlUploadManifestPath, controlUploadRoot,
  priorTargetUploadManifestPath = null, priorArtifactRoot = null, candidates = 1, output = {},
}) {
  const corpusPath = resolve(corpusManifestPath);
  const corpusRoot = dirname(corpusPath);
  const corpus = await readJson(corpusPath);
  if (corpus.schemaVersion !== "glyph-control-corpus/v1" || contentSha256(corpus) !== corpus.contentSha256) throw new Error("B7 corpus manifest hash mismatch");
  const record = corpus.trajectories.find((item) => item.trajectory.controlTrajectory.id === trajectoryId);
  if (!record || contentSha256(record.trajectory) !== record.trajectory.contentSha256) throw new Error("B7 trajectory is absent or hash-invalid");
  const ordered = [...record.trajectory.controlTrajectory.frames].sort((a, b) => a.index - b.index);
  const next = ordered.find((frame) => frame.frameId === nextFrameId);
  if (!next) throw new Error("next frame is absent from B7 trajectory");
  const current = next.index > 0 ? ordered[next.index - 1] : null;
  if (current && next.previousFrameId !== current.frameId) throw new Error("B7 trajectory adjacency mismatch");
  if ((next.index === 0) !== (priorTargetUploadManifestPath === null)) throw new Error(next.index === 0 ? "trajectory-start keyframe cannot have prior state" : "non-start frame requires prior accepted target");
  const visibleRoot = confined(corpusRoot, record.visibleBundle);
  const semanticRoot = confined(corpusRoot, record.semanticBundle);
  const [visible, semantic] = await Promise.all([
    validateBundle(visibleRoot, record.visibleBundleSha256, record.trajectory.contentSha256, record.trajectory.controlTrajectory.contentSha256, "visible"),
    validateBundle(semanticRoot, record.semanticBundleSha256, null, record.trajectory.controlTrajectory.contentSha256, "semantic"),
  ]);
  frameById(visible, next.frameId); frameById(semantic, next.frameId);
  if (current) { frameById(visible, current.frameId); frameById(semantic, current.frameId); }
  if (!style || typeof style.prompt !== "string" || !style.prompt || typeof style.license !== "string" || !style.license) throw new Error("style prompt and license provenance are required");
  assertId(style.id, "style.id");
  if (style.sourceSha256 !== undefined && style.sourceSha256 !== null) assertHash(style.sourceSha256, "style.sourceSha256");
  if (!Number.isInteger(candidates) || candidates < 1 || candidates > 10) throw new Error("candidates must be 1..10");
  if (!controlUploadManifestPath || !controlUploadRoot) throw new Error("hash-bound control upload manifest is required");
  const { validateControlUploadManifest } = await import("./control-png.mjs");
  const uploadManifest = await validateControlUploadManifest(resolve(controlUploadManifestPath), resolve(controlUploadRoot));
  if (uploadManifest.trajectoryId !== trajectoryId || uploadManifest.trajectorySha256 !== record.trajectory.contentSha256 || uploadManifest.frameId !== nextFrameId || uploadManifest.bundles.visible !== record.visibleBundleSha256 || uploadManifest.bundles.semantic !== record.semanticBundleSha256) throw new Error("control upload manifest is not bound to admitted B7/B6 lineage");
  const controls = CONTROL_ROLES.map((role, index) => {
    const supplied = uploadManifest.controls[index]; const [bundleName, fileKey] = ROLE_SOURCE[role];
    const bundle = bundleName === "visible" ? visible : semantic;
    const frame = frameById(bundle, next.frameId);
    const sourcePath = frame.files[fileKey];
    if (!sourcePath) throw new Error(`B6 frame lacks source for ${role}`);
    const sourceSha256 = bundle.manifest.files[sourcePath];
    if (supplied.role !== role || !sourceSha256 || supplied.sourceSha256 !== sourceSha256 || supplied.sourcePath !== sourcePath || supplied.bundle !== bundleName) throw new Error(`control reference ${role} is not bound to its B6 source`);
    return { role, bundle: bundleName, sourcePath, sourceSha256, pngPath: supplied.pngPath, pngSha256: supplied.pngSha256, width: supplied.width, height: supplied.height, legend: supplied.legend, providerReference: providerReference(supplied.providerReference, `control ${role}`) };
  });
  let prior = null;
  if (priorTargetUploadManifestPath) {
    if (!priorArtifactRoot) throw new Error("priorArtifactRoot is required");
    const upload = await readJson(resolve(priorTargetUploadManifestPath));
    if (upload.schemaVersion !== "glyph-target-upload-manifest/v1" || contentSha256(upload) !== upload.contentSha256) throw new Error("prior target upload manifest invalid");
    const metadataPath = confined(priorArtifactRoot, upload.metadataPath), target = await validateTargetRecord(await readJson(metadataPath));
    const imagePath = confined(priorArtifactRoot, target.imagePath), image = await readFile(imagePath);
    if (sha256(image) !== target.imageSha256 || upload.targetId !== target.targetId || upload.targetContentSha256 !== target.contentSha256 || upload.imageSha256 !== target.imageSha256) throw new Error("prior target upload/image binding invalid");
    if (target.request.trajectory.trajectoryId !== trajectoryId || target.request.trajectory.trajectorySha256 !== record.trajectory.contentSha256 || target.request.next.frameId !== current.frameId || target.request.next.index !== current.index) throw new Error("prior emitted target does not match current B7 frame");
    prior = { targetId: target.targetId, contentSha256: target.contentSha256, imageSha256: target.imageSha256, sequenceId: trajectoryId, frameId: current.frameId, providerReference: providerReference(upload.providerReference, "prior") };
  }
  const raw = {
    schemaVersion: PROVIDER_CONTRACT_VERSION,
    mode: prior ? "edit" : "keyframe",
    trajectory: {
      corpusId: corpus.id, corpusSha256: corpus.contentSha256, trajectoryId, trajectorySha256: record.trajectory.contentSha256, controlTrajectorySha256: record.trajectory.controlTrajectory.contentSha256,
      sceneId: record.trajectory.controlTrajectory.sceneId, sceneSha256: record.trajectory.controlTrajectory.sceneSha256,
      dictionaryId: record.trajectory.controlTrajectory.dictionaryId, dictionarySha256: record.trajectory.controlTrajectory.dictionarySha256,
    },
    bundles: {
      visible: { manifestSha256: visible.manifest.contentSha256, treeSha256: visible.treeSha256, glyphOutput: visible.manifest.glyphOutput },
      semantic: { manifestSha256: semantic.manifest.contentSha256, treeSha256: semantic.treeSha256, glyphOutput: semantic.manifest.glyphOutput },
    },
    current: current ? { frameId: current.frameId, index: current.index, controlSha256: frameControlSha256(visible, semantic, current.frameId) } : null,
    next: { frameId: next.frameId, index: next.index, controlSha256: frameControlSha256(visible, semantic, next.frameId) },
    controls, priorAcceptedTarget: prior,
    style: { id: style.id, prompt: style.prompt, license: style.license, sourceSha256: style.sourceSha256 ?? null },
    candidates,
    output: { size: output.size ?? "1024x1024", quality: output.quality ?? "medium", format: output.format ?? "png" },
  };
  return { ...raw, requestSha256: requestSha256(raw) };
}

export async function createTargetUploadManifest({ targetMetadataPath, artifactRoot, outputPath, providerReference: reference }) {
  const root = resolve(artifactRoot), metadataPath = resolve(targetMetadataPath);
  if (confined(root, relative(root, metadataPath)) !== metadataPath) throw new Error("target metadata escapes artifact root");
  const target = await validateTargetRecord(await readJson(metadataPath));
  const image = await readFile(confined(root, target.imagePath));
  if (sha256(image) !== target.imageSha256) throw new Error("target image hash mismatch before upload binding");
  const raw = { schemaVersion: "glyph-target-upload-manifest/v1", targetId: target.targetId, targetContentSha256: target.contentSha256, imageSha256: target.imageSha256, metadataPath: relative(root, metadataPath).replaceAll("\\", "/"), providerReference: providerReference(reference, "target upload") };
  const manifest = { ...raw, contentSha256: contentSha256(raw) };
  await atomicWrite(resolve(outputPath), json(manifest));
  return manifest;
}

export function composeMultiviewPrompt(request) {
  const controlLegend = request.controls.map((control, index) => `${index + 1}:${control.role}:source=${control.sourceSha256}:png=${control.pngSha256}`).join(", ");
  const ascii = request.controls.filter((control) => control.role.endsWith("ascii")).map((control) => `${control.role} is an actual cell-aligned glyph bitmap rendered with ${control.legend.font.id}@${control.legend.font.sha256} using raster ${control.legend.rasterConfigSha256}`).join("; ");
  const identity = request.priorAcceptedTarget
    ? `Edit the accepted prior frame ${request.priorAcceptedTarget.targetId}; preserve all object identities, materials, and style across the camera move.`
    : "Create the trajectory-start keyframe and establish stable object identities, materials, and style for later views.";
  return `Trajectory ${request.trajectory.trajectoryId}; next frame ${request.next.frameId}. ${identity} Style: ${request.style.prompt}. ASCII controls: ${ascii}. Admitted next-view control lineage: ${controlLegend}. Do not introduce objects absent from the semantic controls.`;
}
export function buildOpenAIRequest(request, { model = "gpt-image-1.5" } = {}) {
  if (request.schemaVersion !== PROVIDER_CONTRACT_VERSION || request.requestSha256 !== requestSha256(request)) throw new Error("provider request was not admitted or was mutated");
  const prompt = composeMultiviewPrompt(request);
  const common = { model, prompt, n: request.candidates, size: request.output.size, quality: request.output.quality, output_format: request.output.format };
  const images = [...(request.priorAcceptedTarget ? [wireReference(request.priorAcceptedTarget.providerReference)] : []), ...request.controls.map((control) => wireReference(control.providerReference))];
  return { apiVersion: OPENAI_API_VERSION, operation: request.mode === "keyframe" ? "control-keyframe-edit" : "temporal-edit", endpoint: "https://api.openai.com/v1/images/edits", method: "POST", body: { ...common, images }, prompt };
}

function retryable(error) {
  const status = Number(error?.status ?? error?.statusCode);
  return status === 429 || status >= 500 || error?.code === "ECONNRESET" || error?.code === "ETIMEDOUT";
}
async function readOptional(path) { try { return await readJson(path); } catch (error) { if (error?.code === "ENOENT") return null; throw error; } }
async function acquireLedger(path, initial) {
  await mkdir(dirname(path), { recursive: true });
  try {
    const handle = await open(path, "wx");
    await handle.writeFile(json(initial)); await handle.close();
    return initial;
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const existing = await readJson(path);
    if (existing.status === "complete") return existing;
    throw new Error(`${String(existing.status).toUpperCase()}_REQUEST_REQUIRES_RECONCILIATION`);
  }
}
function parseOpenAIResponse(body, request, responseRequestId) {
  if (!responseRequestId || !Array.isArray(body?.data) || body.data.length !== request.candidates) throw new Error("malformed OpenAI image response");
  return body.data.map((entry, index) => {
    if (typeof entry?.b64_json !== "string") throw new Error("malformed OpenAI image candidate");
    const image = Buffer.from(entry.b64_json, "base64");
    if (!image.length) throw new Error("empty OpenAI image candidate");
    return { imageBase64: entry.b64_json, candidateIndex: index, responseRequestId };
  });
}
async function ledgeredOpenAI({ outbound, request, fetchImpl, ledgerRoot, attempts, sleep, projectId = null, requireUsageReconciliation = false }) {
  const path = confined(ledgerRoot, `requests/${request.requestSha256}.json`);
  const base = { schemaVersion: "glyph-provider-request-ledger/v1", requestSha256: request.requestSha256, request: redact({ ...outbound, projectId, controls: request.controls, trajectory: request.trajectory, bundles: request.bundles, priorAcceptedTarget: request.priorAcceptedTarget }), status: "pending", attempts: [] };
  const ledger = await acquireLedger(path, base);
  if (ledger.status === "complete") {
    if (ledger.schemaVersion !== "glyph-provider-request-ledger/v1" || ledger.requestSha256 !== request.requestSha256 || canonicalJson(ledger.request) !== canonicalJson(base.request) || !Array.isArray(ledger.attempts) || !Array.isArray(ledger.response?.candidates) || ledger.response.candidates.length !== request.candidates) throw new Error("PROVIDER_LEDGER_CONFUSION");
    parseOpenAIResponse({ data: ledger.response.candidates.map((candidate) => ({ b64_json: candidate.imageBase64 })) }, request, ledger.response.responseRequestId);
    if (requireUsageReconciliation && (ledger.response.usageSchema !== "openai-images-input_tokens_details/v1" || !ledger.response.usage || !Number.isSafeInteger(ledger.response.usage.textInputTokens) || ledger.response.usage.textInputTokens < 0 || !Number.isSafeInteger(ledger.response.usage.imageInputTokens) || ledger.response.usage.imageInputTokens < 0)) throw new Error("PILOT_USAGE_RECONCILIATION_REQUIRED");
    return { candidates: ledger.response.candidates, attempts: ledger.attempts, reused: true, usage: ledger.response.usage ?? null };
  }
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) { const failed = { ...ledger, status: "failed", failure: { code: "MISSING_OPENAI_API_KEY" } }; await atomicWrite(path, json(failed)); throw new Error("OPENAI_API_KEY is required for live OpenAI target generation"); }
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const headers = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", ...(projectId ? { "OpenAI-Project": projectId } : {}) };
      const response = await fetchImpl(outbound.endpoint, { method: outbound.method, headers, body: JSON.stringify(outbound.body) });
      const body = await response.json().catch(() => null);
      if (!response.ok) { const error = new Error(`OpenAI image request failed: ${response.status}`); error.status = response.status; throw error; }
      const responseRequestId = response.headers?.get?.("x-request-id") ?? body?.request_id;
      const candidates = parseOpenAIResponse(body, request, responseRequestId);
      const responseProject = response.headers?.get?.("openai-project") ?? body?.project_id ?? null;
      if (projectId && responseProject !== null && responseProject !== projectId) throw new Error("OPENAI_PROJECT_ATTRIBUTION_MISMATCH");
      let usage = null;
      if (requireUsageReconciliation) usage = parseOpenAIImageUsage(body?.usage);
      else if (body?.usage?.input_tokens_details) {
        try { usage = parseOpenAIImageUsage(body.usage); } catch { usage = null; }
      }
      ledger.attempts.push({ attempt, outcome: "success", status: response.status, responseRequestId });
      const complete = { ...ledger, status: "complete", response: { responseRequestId, projectId: responseProject, ...(usage ? { usageSchema: "openai-images-input_tokens_details/v1" } : {}), usage, candidates } };
      await atomicWrite(path, json(complete));
      return { candidates, attempts: complete.attempts, reused: false, usage };
    } catch (error) {
      const canRetry = retryable(error) && attempt < attempts;
      ledger.attempts.push({ attempt, outcome: canRetry ? "transient" : "failed", status: Number.isFinite(Number(error?.status)) ? Number(error.status) : null, code: error?.code ?? null });
      if (!canRetry) { await atomicWrite(path, json({ ...ledger, status: "failed", failure: { message: String(error?.message ?? error) } })); throw error; }
      await atomicWrite(path, json(ledger));
      await sleep(2 ** (attempt - 1) * 100);
    }
  }
  throw new Error("unreachable request retry state");
}

export function createMockTargetProvider() {
  return {
    id: "mock-deterministic/v2", model: "mock-deterministic/v2", apiVersion: "offline/v1",
    async candidates(request) {
      const providerRequest = { apiVersion: "offline/v1", operation: "mock", endpoint: "offline://mock-targets", method: "NONE", body: { candidateCount: request.candidates, controls: request.controls }, prompt: composeMultiviewPrompt(request) };
      return Array.from({ length: request.candidates }, (_, candidateIndex) => {
        const image = Buffer.from(`GLYPH-MOCK-TARGET\n${request.requestSha256}\n${candidateIndex}\n${request.next.controlSha256}\n`);
        return { image, candidateIndex, responseRequestId: `mock-${request.requestSha256.slice(0, 20)}`, attempts: [{ attempt: 1, outcome: "success", status: 0 }], reused: false, providerRequest };
      });
    },
  };
}
export function createOpenAIImageProvider({ model = "gpt-image-1.5", fetchImpl = globalThis.fetch, ledgerRoot, attempts = 3, sleep = async () => {}, projectId = null, requireUsageReconciliation = false } = {}) {
  if (!ledgerRoot) throw new Error("durable provider ledgerRoot is required");
  if (typeof fetchImpl !== "function") throw new Error("fetch implementation is required");
  if (projectId !== null && (typeof projectId !== "string" || !projectId)) throw new Error("dedicated OpenAI project id is required");
  if (requireUsageReconciliation && !projectId) throw new Error("dedicated OpenAI project id is required for billing reconciliation");
  return {
    id: "openai-images/v1", model, apiVersion: OPENAI_API_VERSION, ledgerRoot: resolve(ledgerRoot), projectId, requireUsageReconciliation,
    describe(request) { return redact(buildOpenAIRequest(request, { model })); },
    async candidates(request) {
      const outbound = buildOpenAIRequest(request, { model });
      const result = await ledgeredOpenAI({ outbound, request, fetchImpl, ledgerRoot, attempts, sleep, projectId, requireUsageReconciliation });
      return result.candidates.map((candidate) => ({ image: Buffer.from(candidate.imageBase64, "base64"), candidateIndex: candidate.candidateIndex, responseRequestId: candidate.responseRequestId, attempts: result.attempts, reused: result.reused, providerRequest: redact(outbound), usage: result.usage ?? null }));
    },
  };
}

function rootsOverlap(first, second) {
  const a = resolve(first), b = resolve(second);
  return a === b || a.startsWith(`${b}${sep}`) || b.startsWith(`${a}${sep}`);
}
async function validateCompletedPublication(publication, request, outputRoot) {
  if (publication.status !== "complete" || publication.requestSha256 !== request.requestSha256 || canonicalJson(publication.request) !== canonicalJson(redact(request)) || !Array.isArray(publication.targets) || publication.targets.length !== request.candidates) throw new Error("completed publication request binding invalid");
  const tree = [];
  const candidateIndexes = new Set();
  for (const item of publication.targets) {
    const metadataPath = confined(outputRoot, item.metadataPath), target = await validateTargetRecord(await readJson(metadataPath));
    const imagePath = confined(outputRoot, item.imagePath), imageSha256 = sha256(await readFile(imagePath));
    if (target.contentSha256 !== item.contentSha256 || target.targetId !== item.targetId || target.imageSha256 !== item.imageSha256 || imageSha256 !== item.imageSha256 || target.requestSha256 !== request.requestSha256) throw new Error("completed publication target/image binding invalid");
    if (candidateIndexes.has(target.lineage.candidateIndex)) throw new Error("completed publication candidate lineage duplicated");
    candidateIndexes.add(target.lineage.candidateIndex);
    tree.push({ metadataPath: item.metadataPath, contentSha256: item.contentSha256, imagePath: item.imagePath, imageSha256: item.imageSha256 });
  }
  if (contentSha256(tree) !== publication.publicationTreeSha256) throw new Error("completed publication tree hash mismatch");
  return publication;
}
async function persistTargetCandidatesInternal({ provider, request, outputRoot, costCeilingUsd, inputCostPerRequestUsd = 0, costPerCandidateUsd, dryRun = false }, pilotLiveCapability) {
  if (provider?.ledgerRoot && rootsOverlap(provider.ledgerRoot, outputRoot)) throw new Error("provider ledger and publication roots must be separate");
  if (provider?.id === "openai-images/v1" && pilotLiveCapability !== PILOT_LIVE_CAPABILITY) throw new Error("PILOT_LIVE_ORCHESTRATION_REQUIRED");
  if (request.schemaVersion !== PROVIDER_CONTRACT_VERSION || request.requestSha256 !== requestSha256(request)) throw new Error("target request is not admitted");
  if (!Number.isFinite(costCeilingUsd) || costCeilingUsd < 0 || !Number.isFinite(inputCostPerRequestUsd) || inputCostPerRequestUsd < 0 || !Number.isFinite(costPerCandidateUsd) || costPerCandidateUsd < 0) throw new Error("cost values must be finite and non-negative");
  const estimatedCostUsd = Math.round((inputCostPerRequestUsd + request.candidates * costPerCandidateUsd) * 1e6) / 1e6;
  if (estimatedCostUsd > costCeilingUsd) throw new Error(`cost ceiling exceeded: estimated $${estimatedCostUsd} > $${costCeilingUsd}`);
  const report = { schemaVersion: "glyph-target-dry-run/v2", provider: { id: provider.id, model: provider.model, apiVersion: provider.apiVersion }, requestSha256: request.requestSha256, request: redact(request), apiCalls: 1, candidateCount: request.candidates, inputCostPerRequestUsd, outputCostPerCandidateUsd: costPerCandidateUsd, estimatedCostUsd, costCeilingUsd };
  if (dryRun) return { ...report, dryRun: true };
  const manifestPath = confined(outputRoot, `requests/${request.requestSha256}.json`);
  const existing = await readOptional(manifestPath);
  if (existing?.status === "complete") return { ...await validateCompletedPublication(existing, request, outputRoot), resumed: true };
  const candidates = await provider.candidates(request);
  if (candidates.length !== request.candidates) throw new Error("provider returned wrong candidate count");
  const targets = [];
  for (const candidate of candidates) {
    const imageSha256 = sha256(candidate.image);
    const imagePath = confined(outputRoot, `targets/${imageSha256}.bin`);
    await mkdir(dirname(imagePath), { recursive: true });
    try { const handle = await open(imagePath, "wx"); await handle.writeFile(candidate.image); await handle.close(); } catch (error) { if (error?.code !== "EEXIST" || sha256(await readFile(imagePath)) !== imageSha256) throw error; }
    const raw = {
      schemaVersion: TARGET_SCHEMA_VERSION,
      targetId: `target/${imageSha256.slice(0, 24)}`, imageSha256, imagePath: relative(resolve(outputRoot), imagePath).replaceAll("\\", "/"),
      provider: { id: provider.id, model: provider.model, apiVersion: provider.apiVersion, responseRequestId: candidate.responseRequestId, attempts: candidate.attempts, reusedResponse: candidate.reused },
      providerRequest: candidate.providerRequest,
      requestSha256: request.requestSha256, request: redact(request),
      lineage: { trajectory: request.trajectory, bundles: request.bundles, current: request.current, next: request.next, priorAcceptedTarget: request.priorAcceptedTarget, controls: request.controls, style: request.style, candidateIndex: candidate.candidateIndex },
    };
    const target = { ...raw, contentSha256: contentSha256(raw) };
    await validateTargetRecord(target);
    const metadataPath = confined(outputRoot, `targets/${imageSha256}.json`);
    const prior = await readOptional(metadataPath);
    if (prior && prior.contentSha256 !== target.contentSha256) throw new Error("content-addressed target metadata conflict");
    if (!prior) await atomicWrite(metadataPath, json(target));
    targets.push({ targetId: target.targetId, contentSha256: target.contentSha256, imageSha256, imagePath: target.imagePath, metadataPath: relative(resolve(outputRoot), metadataPath).replaceAll("\\", "/") });
  }
  const publicationTreeSha256 = contentSha256(targets.map(({ metadataPath, contentSha256, imagePath, imageSha256 }) => ({ metadataPath, contentSha256, imagePath, imageSha256 })));
  const usages = candidates.map((candidate) => candidate.usage ?? null);
  const usage = usages[0] ?? null;
  if (usages.some((candidateUsage) => canonicalJson(candidateUsage) !== canonicalJson(usage))) throw new Error("PILOT_USAGE_RECONCILIATION_REQUIRED");
  const complete = { ...report, dryRun: false, status: "complete", request: redact(request), targets, publicationTreeSha256, usage };
  await atomicWrite(manifestPath, json(complete));
  return complete;
}

export const persistTargetCandidates = (options) => persistTargetCandidatesInternal(options, false);

// Deliberately not re-exported by provider.ts. B11's sole orchestrator is the
// only repo caller; keeping the capability out of target records preserves the
// real OpenAI provider id as provenance.
export const persistPilotLiveTargetCandidates = (options) => persistTargetCandidatesInternal(options, PILOT_LIVE_CAPABILITY);

export async function generateTargetPlan({ provider, requests, outputRoot, costCeilingUsd, inputCostPerRequestUsd = 0, costPerCandidateUsd, maxConcurrent = 2, dryRun = false, billing = null }) {
  if (!Array.isArray(requests) || !requests.length) throw new Error("target plan requires requests");
  if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1 || maxConcurrent > 16) throw new Error("maxConcurrent must be 1..16");
  // B11 must not acquire a second paid route through this generic B9 planner.
  // Live pilot dispatch, accounting, B10 selection, and reserve handling live
  // together in runPilotLive, where a next frame cannot bypass its prior gate.
  if (billing !== null) throw new Error("PILOT_LIVE_ORCHESTRATION_REQUIRED");
  const candidateCount = requests.reduce((sum, request) => sum + request.candidates, 0);
  const estimatedCostUsd = Math.round((requests.length * inputCostPerRequestUsd + candidateCount * costPerCandidateUsd) * 1e6) / 1e6;
  if (estimatedCostUsd > costCeilingUsd) throw new Error(`cost ceiling exceeded: estimated $${estimatedCostUsd} > $${costCeilingUsd}`);
  if (dryRun) return { schemaVersion: "glyph-target-plan-dry-run/v2", provider: { id: provider.id, model: provider.model, apiVersion: provider.apiVersion }, apiCalls: requests.length, candidateCount, inputCostPerRequestUsd, outputCostPerCandidateUsd: costPerCandidateUsd, estimatedCostUsd, costCeilingUsd, requests: requests.map((request) => ({ requestSha256: request.requestSha256, mode: request.mode, trajectoryId: request.trajectory.trajectoryId, nextFrameId: request.next.frameId, apiCalls: 1, candidateCount: request.candidates, estimatedCostUsd: Math.round((inputCostPerRequestUsd + request.candidates * costPerCandidateUsd) * 1e6) / 1e6 })) };
  const results = new Array(requests.length); let cursor = 0;
  const worker = async () => { while (true) { const index = cursor++; if (index >= requests.length) return; results[index] = await persistTargetCandidates({ provider, request: requests[index], outputRoot, costCeilingUsd, inputCostPerRequestUsd, costPerCandidateUsd }); } };
  await Promise.all(Array.from({ length: Math.min(maxConcurrent, requests.length) }, worker));
  return results;
}

let targetValidatorPromise;
async function targetValidator() {
  targetValidatorPromise ??= readJson(resolve(dirname(new URL(import.meta.url).pathname), "../../schema/target-record.schema.json")).then((schema) => {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    return ajv.compile(schema);
  });
  return targetValidatorPromise;
}
export async function validateTargetRecord(record) {
  const validate = await targetValidator();
  if (!validate(record)) throw new Error(`target schema invalid: ${validate.errors.map((error) => `${error.instancePath} ${error.message}`).join("; ")}`);
  if (contentSha256(record) !== record.contentSha256) throw new Error("target content hash mismatch");
  if (record.request.requestSha256 !== requestSha256(record.request) || record.requestSha256 !== record.request.requestSha256) throw new Error("target request hash mismatch");
  if (record.request.controls.some((control, index) => control.role !== CONTROL_ROLES[index])) throw new Error("target control role set/order mismatch");
  if (record.request.controls.some((control) => control.bundle !== ROLE_SOURCE[control.role][0])) throw new Error("target control role/bundle mismatch");
  for (const key of ["trajectory", "bundles", "current", "next", "priorAcceptedTarget", "controls", "style"]) if (canonicalJson(record.lineage[key]) !== canonicalJson(record.request[key])) throw new Error(`target lineage ${key} mismatch`);
  if (record.lineage.candidateIndex >= record.request.candidates) throw new Error("target candidate lineage out of range");
  if (record.request.mode === "keyframe" && (record.request.current !== null || record.request.priorAcceptedTarget !== null || record.request.next.index !== 0)) throw new Error("target keyframe lineage invalid");
  if (record.request.mode === "edit" && (!record.request.current || !record.request.priorAcceptedTarget || record.request.next.index !== record.request.current.index + 1)) throw new Error("target edit lineage invalid");
  if (/authorization|api[_-]?key/i.test(JSON.stringify(record.providerRequest))) throw new Error("target provider request contains credentials");
  return record;
}
