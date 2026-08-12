import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildFixtureAdmissions } from "../src/generate-targets.mjs";
import {
  admitTrajectoryTarget, buildOpenAIRequest, contentSha256, createMockTargetProvider, createOpenAIImageProvider, generateTargetPlan,
  persistTargetCandidates, validateTargetRecord,
} from "../src/targets/provider-core.mjs";
import { ASCII_RASTER_CONFIG, decodeRgbaPng, encodeControlUploadManifest, rasterizePinnedAsciiGlyph } from "../src/targets/control-png.mjs";

let fixtureRoot: string;
let fixture: any;
let edit: any;
let acceptedRoot: string;
let acceptedKeyframe: any;
const hash = (value: string) => value.repeat(64);
const response = (count = 2, id = "req-test") => ({
  ok: true, status: 200, headers: { get: (name: string) => name === "x-request-id" ? id : null },
  json: async () => ({ data: Array.from({ length: count }, (_, index) => ({ b64_json: Buffer.from(`image-${index}`).toString("base64") })) }),
});
async function scopedKey(value: string | undefined, run: () => Promise<void>) {
  const before = process.env.OPENAI_API_KEY;
  if (value === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = value;
  try { await run(); } finally { if (before === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = before; }
}

beforeAll(async () => {
  fixtureRoot = await mkdtemp(join(tmpdir(), "glyph-b9-fixture-"));
  fixture = await buildFixtureAdmissions(fixtureRoot);
  acceptedRoot = join(fixtureRoot, "accepted");
  acceptedKeyframe = await persistTargetCandidates({ provider: createMockTargetProvider(), request: fixture.keyframe, outputRoot: acceptedRoot, costCeilingUsd: 1, costPerCandidateUsd: .01 });
  edit = await fixture.editFromTarget({ artifactRoot: acceptedRoot, target: acceptedKeyframe.targets[0] });
}, 30_000);
afterAll(async () => { await rm(fixtureRoot, { recursive: true, force: true }); });

describe("B9 provenance-safe trajectory targets", () => {
  it("admits the actual B7 trajectory and complete hash-verified B6 control trees", () => {
    expect(fixture.keyframe.trajectory.corpusSha256).toBe(fixture.corpus.contentSha256);
    expect(fixture.keyframe.trajectory.trajectorySha256).toBe(fixture.record.trajectory.contentSha256);
    expect(fixture.keyframe.bundles.visible.manifestSha256).toBe(fixture.record.visibleBundleSha256);
    expect(fixture.keyframe.bundles.semantic.manifestSha256).toBe(fixture.record.semanticBundleSha256);
    expect(fixture.keyframe.controls.map((item: any) => item.role)).toEqual(["visible-ascii", "semantic-ascii", "semantic-color", "depth", "normal", "world-position", "surface-uv", "coverage", "shade"]);
    expect(new Set(fixture.keyframe.controls.map((item: any) => item.sourceSha256)).size).toBeGreaterThan(5);
  });

  it("rejects incomplete, stale, and unbound B7/B6 upload manifests before a provider exists", async () => {
    const original = fixture.keyframeUploads.manifest;
    const incomplete = structuredClone(original); incomplete.controls.pop(); incomplete.contentSha256 = contentSha256(incomplete);
    const incompletePath = join(fixture.uploadRoot, "incomplete.json"); await writeFile(incompletePath, JSON.stringify(incomplete));
    await expect(admitTrajectoryTarget({ corpusManifestPath: join(fixture.corpusRoot, "manifest.json"), trajectoryId: fixture.keyframe.trajectory.trajectoryId, nextFrameId: "f000", style: fixture.style, controlUploadManifestPath: incompletePath, controlUploadRoot: fixture.uploadRoot })).rejects.toThrow("invalid");
    const stale = structuredClone(original); stale.controls[0].sourceSha256 = hash("d"); stale.contentSha256 = contentSha256(stale);
    const stalePath = join(fixture.uploadRoot, "stale.json"); await writeFile(stalePath, JSON.stringify(stale));
    await expect(admitTrajectoryTarget({ corpusManifestPath: join(fixture.corpusRoot, "manifest.json"), trajectoryId: fixture.keyframe.trajectory.trajectoryId, nextFrameId: "f000", style: fixture.style, controlUploadManifestPath: stalePath, controlUploadRoot: fixture.uploadRoot })).rejects.toThrow("not bound");
    const escaped = structuredClone(original); escaped.controls[0].pngPath = "../arbitrary.png"; escaped.contentSha256 = contentSha256(escaped);
    const escapedPath = join(fixture.uploadRoot, "escaped.json"); await writeFile(escapedPath, JSON.stringify(escaped));
    await expect(admitTrajectoryTarget({ corpusManifestPath: join(fixture.corpusRoot, "manifest.json"), trajectoryId: fixture.keyframe.trajectory.trajectoryId, nextFrameId: "f000", style: fixture.style, controlUploadManifestPath: escapedPath, controlUploadRoot: fixture.uploadRoot })).rejects.toThrow("escapes");
    const arbitrary = structuredClone(original); arbitrary.controls[0].providerReference = { fileId: "file-arbitrary", extra: true }; arbitrary.contentSha256 = contentSha256(arbitrary);
    const arbitraryPath = join(fixture.uploadRoot, "arbitrary.json"); await writeFile(arbitraryPath, JSON.stringify(arbitrary));
    await expect(admitTrajectoryTarget({ corpusManifestPath: join(fixture.corpusRoot, "manifest.json"), trajectoryId: fixture.keyframe.trajectory.trajectoryId, nextFrameId: "f000", style: fixture.style, controlUploadManifestPath: arbitraryPath, controlUploadRoot: fixture.uploadRoot })).rejects.toThrow("reference");
    const fontDrift = structuredClone(original); fontDrift.controls[0].legend.font.sha256 = hash("f"); fontDrift.contentSha256 = contentSha256(fontDrift);
    const fontDriftPath = join(fixture.uploadRoot, "font-drift.json"); await writeFile(fontDriftPath, JSON.stringify(fontDrift));
    await expect(admitTrajectoryTarget({ corpusManifestPath: join(fixture.corpusRoot, "manifest.json"), trajectoryId: fixture.keyframe.trajectory.trajectoryId, nextFrameId: "f000", style: fixture.style, controlUploadManifestPath: fontDriftPath, controlUploadRoot: fixture.uploadRoot })).rejects.toThrow("font/raster provenance drift");
    const rasterDrift = structuredClone(original); rasterDrift.controls[1].legend.raster.cellWidth += 1; rasterDrift.contentSha256 = contentSha256(rasterDrift);
    const rasterDriftPath = join(fixture.uploadRoot, "raster-drift.json"); await writeFile(rasterDriftPath, JSON.stringify(rasterDrift));
    await expect(admitTrajectoryTarget({ corpusManifestPath: join(fixture.corpusRoot, "manifest.json"), trajectoryId: fixture.keyframe.trajectory.trajectoryId, nextFrameId: "f000", style: fixture.style, controlUploadManifestPath: rasterDriftPath, controlUploadRoot: fixture.uploadRoot })).rejects.toThrow("font/raster provenance drift");
    await expect(admitTrajectoryTarget({ corpusManifestPath: join(fixture.corpusRoot, "manifest.json"), trajectoryId: "trajectory/missing", nextFrameId: "f000", style: fixture.style, controlUploadManifestPath: fixture.keyframeUploads.path, controlUploadRoot: fixture.uploadRoot })).rejects.toThrow("absent");
  });

  it("deterministically encodes valid PNG pixels from the exact B6 maps and records legends", async () => {
    const coverage = fixture.keyframeUploads.manifest.controls.find((item: any) => item.role === "coverage");
    const source = await readFile(join(fixture.corpusRoot, fixture.record.visibleBundle, coverage.sourcePath));
    const png = decodeRgbaPng(await readFile(join(fixture.uploadRoot, coverage.pngPath)));
    expect(png.width).toBe(coverage.width); expect(png.height).toBe(coverage.height);
    for (let index = 0; index < source.length; index++) expect(png.rgba[index * 4]).toBe(source[index] ? 255 : 0);
    expect(coverage.legend.encoding).toBe("u8-binary-to-grayscale");
    const visibleAscii = fixture.keyframeUploads.manifest.controls.find((item: any) => item.role === "visible-ascii");
    expect(visibleAscii.legend).toMatchObject({ encoding: "pinned-font-cell-raster-grayscale", font: { id: "font/ibm-plex-mono-regular", sha256: "fe11304a5fe956d5744e9b6a246cc83d90425245e75a62230044966ca96a7f50" }, raster: ASCII_RASTER_CONFIG });
    expect(visibleAscii.width).toBe(coverage.width * ASCII_RASTER_CONFIG.cellWidth);
    expect(visibleAscii.height).toBe(coverage.height * ASCII_RASTER_CONFIG.cellHeight);
    expect(createHash("sha256").update(rasterizePinnedAsciiGlyph("A")).digest("hex")).toBe("4628443efd69d5dba6fa58283d6112ddbc12899314c39579cbb6b2410560c9ca");
    const repeatRoot = join(fixtureRoot, "repeat-uploads");
    const references = fixture.keyframeUploads.manifest.controls.map((item: any) => ({ role: item.role, ...item.providerReference }));
    const repeated = await encodeControlUploadManifest({ corpusRoot: fixture.corpusRoot, record: fixture.record, frameId: "f000", outputRoot: repeatRoot, providerReferences: references });
    expect(repeated.manifest.controls.map((item: any) => item.pngSha256)).toEqual(fixture.keyframeUploads.manifest.controls.map((item: any) => item.pngSha256));
  });

  it("builds spatially conditioned control-only keyframe and prior-frame edit shapes", () => {
    const keyframe = buildOpenAIRequest(fixture.keyframe);
    expect(keyframe).toMatchObject({ operation: "control-keyframe-edit", endpoint: "https://api.openai.com/v1/images/edits", body: { model: "gpt-image-1.5", n: 2, output_format: "png" } });
    expect(keyframe.body.images).toHaveLength(9);
    expect(keyframe.body.images).toEqual(fixture.keyframe.controls.map((control: any) => ({ file_id: control.providerReference.fileId })));
    expect(keyframe.prompt).toContain("actual cell-aligned glyph bitmap");
    const edited = buildOpenAIRequest(edit);
    expect(edited.operation).toBe("temporal-edit");
    expect(edited.endpoint).toBe("https://api.openai.com/v1/images/edits");
    expect(edited.body.images).toHaveLength(10);
    expect(edited.body.images[0]).toEqual({ file_id: edit.priorAcceptedTarget.providerReference.fileId });
    expect(edited.prompt).toContain(edit.next.frameId);
  });

  it("loads prior state from an actual emitted target and rejects corrupted target bytes", async () => {
    expect(edit.priorAcceptedTarget.targetId).toBe(acceptedKeyframe.targets[0].targetId);
    expect(edit.current.frameId).toBe("f000");
    const hostileRoot = join(fixtureRoot, "hostile-prior"); await mkdir(join(hostileRoot, "targets"), { recursive: true });
    const target = acceptedKeyframe.targets[0];
    await copyFile(join(acceptedRoot, target.metadataPath), join(hostileRoot, target.metadataPath));
    await writeFile(join(hostileRoot, target.imagePath), Buffer.from("corrupted-prior"));
    await expect(fixture.editFromTarget({ artifactRoot: hostileRoot, target })).rejects.toThrow("image hash");
  });

  it("reads credentials only from scoped process.env and never persists or describes them", async () => {
    const missingRoot = await mkdtemp(join(tmpdir(), "glyph-b9-ledger-"));
    const fetchImpl = vi.fn();
    await scopedKey(undefined, async () => {
      const provider = createOpenAIImageProvider({ ledgerRoot: missingRoot, fetchImpl });
      expect(JSON.stringify(provider.describe(fixture.keyframe))).not.toContain("Authorization");
      await expect(provider.candidates(fixture.keyframe)).rejects.toThrow("OPENAI_API_KEY");
      expect(fetchImpl).not.toHaveBeenCalled();
    });
    expect(JSON.stringify(await readFile(join(missingRoot, "requests", `${fixture.keyframe.requestSha256}.json`), "utf8"))).not.toContain("test-runtime-key");
    await rm(missingRoot, { recursive: true, force: true });
  });

  it("binds reconciled live requests to a dedicated OpenAI project and rejects missing usage", async () => {
    const ledgerRoot = await mkdtemp(join(tmpdir(), "glyph-b11-ledger-"));
    const missingUsage = vi.fn().mockResolvedValue(response());
    await scopedKey("test-runtime-key", async () => {
      await expect(createOpenAIImageProvider({ ledgerRoot, projectId: "proj_b11", requireUsageReconciliation: true, fetchImpl: missingUsage }).candidates(fixture.keyframe)).rejects.toThrow("PILOT_USAGE_RECONCILIATION_REQUIRED");
    });
    expect(missingUsage.mock.calls[0][1].headers["OpenAI-Project"]).toBe("proj_b11");
    await rm(ledgerRoot, { recursive: true, force: true });

    const attributedRoot = await mkdtemp(join(tmpdir(), "glyph-b11-ledger-"));
    const attributed = vi.fn().mockResolvedValue({
      ...response(), headers: { get: (name: string) => name === "x-request-id" ? "req-b11" : name === "openai-project" ? "proj_b11" : null },
      json: async () => ({ data: Array.from({ length: 2 }, (_, index) => ({ b64_json: Buffer.from(`image-${index}`).toString("base64") })), usage: { input_tokens_details: { text_tokens: 100, image_tokens: 200 } } }),
    });
    await scopedKey("test-runtime-key", async () => {
      const candidates = await createOpenAIImageProvider({ ledgerRoot: attributedRoot, projectId: "proj_b11", requireUsageReconciliation: true, fetchImpl: attributed }).candidates(fixture.keyframe);
      expect(candidates[0].usage).toEqual({ textInputTokens: 100, imageInputTokens: 200 });
    });
    await rm(attributedRoot, { recursive: true, force: true });
  });

  it("counts API calls separately from candidates and computes aggregate dry-run cost", async () => {
    const dry = await generateTargetPlan({ provider: createMockTargetProvider(), requests: [fixture.keyframe, edit], outputRoot: fixtureRoot, costCeilingUsd: 1, inputCostPerRequestUsd: .005, costPerCandidateUsd: .01, maxConcurrent: 2, dryRun: true });
    expect(dry).toMatchObject({ apiCalls: 2, candidateCount: 4, inputCostPerRequestUsd: .005, outputCostPerCandidateUsd: .01, estimatedCostUsd: .05 });
    expect(dry.requests).toEqual(expect.arrayContaining([expect.objectContaining({ apiCalls: 1, candidateCount: 2, estimatedCostUsd: .025 })]));
  });

  it("enforces live concurrency and the aggregate ceiling before any provider work", async () => {
    let active = 0; let peak = 0; let calls = 0;
    const provider = {
      id: "bounded-test", model: "bounded-test", apiVersion: "offline/v1",
      async candidates(request: any) {
        calls++; active++; peak = Math.max(peak, active); await new Promise((done) => setTimeout(done, 10)); active--;
        return Array.from({ length: request.candidates }, (_, candidateIndex) => ({ image: Buffer.from(`${request.requestSha256}-${candidateIndex}`), candidateIndex, responseRequestId: `req-${calls}-${candidateIndex}`, attempts: [{ attempt: 1, outcome: "success", status: 0 }], reused: false, providerRequest: { apiVersion: "offline/v1", operation: "test", endpoint: "offline://test", method: "NONE", body: {}, prompt: "test" } }));
      },
    };
    const output = await mkdtemp(join(tmpdir(), "glyph-b9-output-"));
    await generateTargetPlan({ provider, requests: [fixture.keyframe, edit], outputRoot: output, costCeilingUsd: 1, costPerCandidateUsd: .01, maxConcurrent: 1 });
    expect(peak).toBe(1); expect(calls).toBe(2);
    calls = 0;
    await expect(generateTargetPlan({ provider, requests: [fixture.keyframe, edit], outputRoot: output, costCeilingUsd: .049, inputCostPerRequestUsd: .005, costPerCandidateUsd: .01, maxConcurrent: 2 })).rejects.toThrow("cost ceiling exceeded");
    expect(calls).toBe(0);
    await rm(output, { recursive: true, force: true });
  });

  it("resumes completed target publication without another provider call", async () => {
    let calls = 0; const mock = createMockTargetProvider();
    const provider = { ...mock, async candidates(request: any) { calls++; return mock.candidates(request); } };
    const output = await mkdtemp(join(tmpdir(), "glyph-b9-output-"));
    await persistTargetCandidates({ provider, request: fixture.keyframe, outputRoot: output, costCeilingUsd: 1, costPerCandidateUsd: .01 });
    const resumed = await persistTargetCandidates({ provider, request: fixture.keyframe, outputRoot: output, costCeilingUsd: 1, costPerCandidateUsd: .01 });
    expect(resumed.resumed).toBe(true); expect(calls).toBe(1);
    await rm(output, { recursive: true, force: true });
  });

  it("validates publication target/image/tree hashes before resume and rejects corruption", async () => {
    const output = await mkdtemp(join(tmpdir(), "glyph-b9-output-"));
    const result = await persistTargetCandidates({ provider: createMockTargetProvider(), request: fixture.keyframe, outputRoot: output, costCeilingUsd: 1, costPerCandidateUsd: .01 });
    await writeFile(join(output, result.targets[0].imagePath), Buffer.from("publication-corruption"));
    await expect(persistTargetCandidates({ provider: createMockTargetProvider(), request: fixture.keyframe, outputRoot: output, costCeilingUsd: 1, costPerCandidateUsd: .01 })).rejects.toThrow("binding invalid");
    await rm(output, { recursive: true, force: true });
  });

  it("separates provider ledger/publication roots and rejects ledger/publication confusion", async () => {
    const shared = await mkdtemp(join(tmpdir(), "glyph-b9-shared-"));
    const provider = createOpenAIImageProvider({ ledgerRoot: shared, fetchImpl: vi.fn() });
    await expect(persistTargetCandidates({ provider, request: fixture.keyframe, outputRoot: shared, costCeilingUsd: 1, costPerCandidateUsd: .01 })).rejects.toThrow("must be separate");
    const publicationRoot = await mkdtemp(join(tmpdir(), "glyph-b9-publication-"));
    const publication = await persistTargetCandidates({ provider: createMockTargetProvider(), request: fixture.keyframe, outputRoot: publicationRoot, costCeilingUsd: 1, costPerCandidateUsd: .01 });
    const ledgerRoot = await mkdtemp(join(tmpdir(), "glyph-b9-ledger-")); await mkdir(join(ledgerRoot, "requests"));
    await writeFile(join(ledgerRoot, "requests", `${fixture.keyframe.requestSha256}.json`), JSON.stringify(publication));
    const fetchImpl = vi.fn();
    await scopedKey("test-runtime-key", async () => {
      await expect(createOpenAIImageProvider({ ledgerRoot, fetchImpl }).candidates(fixture.keyframe)).rejects.toThrow("LEDGER_CONFUSION");
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    await rm(shared, { recursive: true, force: true }); await rm(publicationRoot, { recursive: true, force: true }); await rm(ledgerRoot, { recursive: true, force: true });
  });

  it("fails closed on an unresolved pending/crash ledger instead of duplicating the request", async () => {
    const ledger = await mkdtemp(join(tmpdir(), "glyph-b9-ledger-"));
    await mkdir(join(ledger, "requests"));
    await writeFile(join(ledger, "requests", `${fixture.keyframe.requestSha256}.json`), JSON.stringify({ schemaVersion: "glyph-provider-request-ledger/v1", status: "pending", attempts: [] }));
    const fetchImpl = vi.fn();
    await scopedKey("test-runtime-key", async () => {
      await expect(createOpenAIImageProvider({ ledgerRoot: ledger, fetchImpl }).candidates(fixture.keyframe)).rejects.toThrow("PENDING_REQUEST_REQUIRES_RECONCILIATION");
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    await rm(ledger, { recursive: true, force: true });
  });

  it("does not retry permanent errors and rejects malformed successful responses", async () => {
    await scopedKey("test-runtime-key", async () => {
      const permanentRoot = await mkdtemp(join(tmpdir(), "glyph-b9-ledger-"));
      const permanent = vi.fn().mockResolvedValue({ ok: false, status: 400, headers: { get: () => "req-bad" }, json: async () => ({ error: { code: "bad_request" } }) });
      await expect(createOpenAIImageProvider({ ledgerRoot: permanentRoot, fetchImpl: permanent }).candidates(fixture.keyframe)).rejects.toThrow("400");
      expect(permanent).toHaveBeenCalledTimes(1);
      const malformedRoot = await mkdtemp(join(tmpdir(), "glyph-b9-ledger-"));
      const malformed = vi.fn().mockResolvedValue({ ok: true, status: 200, headers: { get: () => "req-malformed" }, json: async () => ({ data: [] }) });
      await expect(createOpenAIImageProvider({ ledgerRoot: malformedRoot, fetchImpl: malformed }).candidates(fixture.keyframe)).rejects.toThrow("malformed");
      expect(malformed).toHaveBeenCalledTimes(1);
      await rm(permanentRoot, { recursive: true, force: true }); await rm(malformedRoot, { recursive: true, force: true });
    });
  });

  it("records documented transient retry attempts and reuses the completed response", async () => {
    const ledger = await mkdtemp(join(tmpdir(), "glyph-b9-ledger-"));
    const fetchImpl = vi.fn().mockResolvedValueOnce({ ok: false, status: 429, headers: { get: () => "req-rate" }, json: async () => ({}) }).mockResolvedValueOnce(response());
    await scopedKey("test-runtime-key", async () => {
      const first = await createOpenAIImageProvider({ ledgerRoot: ledger, fetchImpl, sleep: async () => {} }).candidates(fixture.keyframe);
      const reused = await createOpenAIImageProvider({ ledgerRoot: ledger, fetchImpl, sleep: async () => {} }).candidates(fixture.keyframe);
      expect(first[0].attempts.map((item: any) => item.outcome)).toEqual(["transient", "success"]);
      expect(reused[0].reused).toBe(true);
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    await rm(ledger, { recursive: true, force: true });
  });

  it("emits schema-valid provenance accepted by the strict Python consumer and rejects hostile records", async () => {
    const output = await mkdtemp(join(tmpdir(), "glyph-b9-output-"));
    const result = await persistTargetCandidates({ provider: createMockTargetProvider(), request: fixture.keyframe, outputRoot: output, costCeilingUsd: 1, costPerCandidateUsd: .01 });
    const metadataPath = join(output, result.targets[0].metadataPath);
    const record = JSON.parse(await readFile(metadataPath, "utf8"));
    await expect(validateTargetRecord(record)).resolves.toBe(record);
    const trainingEligible = structuredClone(record);
    trainingEligible.modelRaster = {
      id: "glyph-model-raster/physical-cell-letterbox-v1",
      width: 256, height: 256,
      source: { cols: 256, rows: 128, cellAspect: 2 },
      fit: "contain",
      targetSampling: "nearest",
      discreteControlSampling: "nearest",
      continuousControlSampling: "nearest",
      latentContinuousSampling: "bilinear",
    };
    trainingEligible.contentSha256 = contentSha256(trainingEligible);
    await expect(validateTargetRecord(trainingEligible)).resolves.toBe(trainingEligible);
    const consumerDir = resolve("docker");
    const accepted = spawnSync("python3", ["-c", "import sys;sys.path.insert(0,sys.argv[1]);from training_target_consumer import load_training_target;load_training_target(sys.argv[2],sys.argv[3])", consumerDir, metadataPath, output], { encoding: "utf8" });
    expect(accepted.status, accepted.stderr).toBe(0);
    const rehashRequest = (value: any) => {
      const raw = structuredClone(value.request);
      delete raw.requestSha256;
      value.request.requestSha256 = contentSha256(raw);
      value.requestSha256 = value.request.requestSha256;
      value.contentSha256 = contentSha256(value);
      return value;
    };
    const hostileRecords = [
      (() => { const value = structuredClone(record); value.lineage.controls.pop(); return value; })(),
      (() => { const value = structuredClone(record); value.imagePath = "../escape.bin"; return value; })(),
      (() => { const value = structuredClone(record); value.unexpected = true; return value; })(),
      rehashRequest((() => { const value = structuredClone(record); value.request.output.format = "gif"; return value; })()),
      rehashRequest((() => {
        const value = structuredClone(record);
        value.request.trajectory.trajectoryId = "INVALID TRAJECTORY";
        value.lineage.trajectory = value.request.trajectory;
        return value;
      })()),
      rehashRequest((() => {
        const value = structuredClone(record);
        value.request.controls[0].providerReference = { fileId: 42 };
        value.lineage.controls = value.request.controls;
        return value;
      })()),
      rehashRequest((() => {
        const value = structuredClone(record);
        value.request.controls[0].bundle = "semantic";
        value.lineage.controls = value.request.controls;
        return value;
      })()),
      (() => { const value = structuredClone(record); value.provider.attempts[0].attempt = true; return value; })(),
      (() => { const value = structuredClone(record); value.provider.attempts[0].outcome = "maybe"; return value; })(),
      (() => { const value = structuredClone(record); value.provider.id = 42; return value; })(),
      (() => { const value = structuredClone(record); value.lineage.candidateIndex = true; return value; })(),
      (() => { const value = structuredClone(record); value.imageSha256 = "not-a-hash"; return value; })(),
    ];
    for (let index = 0; index < hostileRecords.length; index++) {
      const hostile = hostileRecords[index]; hostile.contentSha256 = contentSha256(hostile);
      const hostilePath = join(output, `hostile-${index}.json`); await writeFile(hostilePath, JSON.stringify(hostile));
      const rejected = spawnSync("python3", ["-c", "import sys;sys.path.insert(0,sys.argv[1]);from training_target_consumer import load_training_target;load_training_target(sys.argv[2],sys.argv[3])", consumerDir, hostilePath, output], { encoding: "utf8" });
      expect(rejected.status).not.toBe(0);
      await expect(validateTargetRecord(hostile)).rejects.toThrow();
    }
    await rm(output, { recursive: true, force: true });
  });
});
