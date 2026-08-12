import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { deriveReferenceTraceContract, disposeReferenceTrace } from "../src/referenceTrace.mjs";
import { buildReferenceSignals } from "../src/referenceSignals.mjs";

const exec = promisify(execFile);
const root = resolve(import.meta.dirname, "..");
const canonical = (value: any, omit = new Set<string>()): string => Array.isArray(value) ? `[${value.map((item) => canonical(item, omit)).join(",")}]` : value && typeof value === "object" ? `{${Object.keys(value).filter((key) => !omit.has(key)).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key], omit)}`).join(",")}}` : JSON.stringify(value);
const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

describe("reference partial evidence", () => {
  it("independently freezes measurement-contract v3 and the unchanged G5 signature", async () => {
    const measurement = JSON.parse(await readFile(join(root, "config/measurement-gates.json"), "utf8"));
    expect(measurement.contractVersion).toBe("v3");
    expect(sha(canonical(measurement))).toBe("122b3a42d75f9e9a0b473c9c2c38814cce3dc4239d27bb935af183c7e9fd43e9");
    expect(sha(canonical(measurement.gates.find((gate: any) => gate.id === "G5")))).toBe("0fee24a6ca7019f5a92974476e606b89eb990695b240a1cdfbab437d92e8885e");
  });

  it("validates pinned provenance while remaining explicitly unable to pass G5", async () => {
    const directory = await mkdtemp(join(tmpdir(), "glyphcss-reference-partial-"));
    const derived = await deriveReferenceTraceContract({ verify: true, enforceStructural: false });
    try {
      const contractBytes = await readFile(join(root, "fixtures/reprojection/reference-trace-v1.json"));
      const contract = JSON.parse(contractBytes.toString());
      const expectedResultHashes = derived.events.map((event: { resultSha256: string }) => event.resultSha256);
      const resultChainSha256 = sha(canonical(expectedResultHashes));
      expect(resultChainSha256).toBe("a804bbdb657fb2d66b263c7681ef2ade4688674070d3c491d9ba2fd2b6ff6297");
      const oracleMetrics = derived.events.map((event: any) => ({ frame: event.id, coveredCells: event.coveredCells, validCells: event.validCells, disoccludedCells: event.disoccludedCells, validPixelError: .01 }));
      const oracleProofs = derived.events.map((event: any) => ({ frame: event.id, reset: event.reset, readbackExact: true, checkpointExact: true, presentationExact: true, resultSha256: event.resultSha256, checkpointContentSha256: sha(`checkpoint/${event.id}`), presentationSha256: sha(`presentation/${event.id}`), presentationBytes: 80 * 24 * 4, presentationMismatchBytes: 0 }));
      const invariant = { readback: false, checkpoint: false, hash: false, fullStateSerialization: false, cpuReprojection: false, evidenceDigest: false, preTextContent: false, persistentCanvas: true };
      const spans = Array.from({ length: 40 }, (_, run) => derived.events.map((event: any) => ({ sampleId: `${String(run).padStart(2, "0")}:${event.id}`, run, frame: event.id, reset: event.reset, presentationMs: 20, submitEnqueueMs: 1, gpuCompletionMs: 2, compositorPresentationMs: 17, ...oracleMetrics.find((metric: any) => metric.frame === event.id), timedInvariant: { ...invariant } }))).flat();
      const profileTransitions = Array.from({ length: 8 }, (_, index) => ({ profileId: `profile-${String(index).padStart(2, "0")}`, index, frame: derived.events[index].id, reset: derived.events[index].reset, compositorPresentationMs: 1, cpu: { routingMs: 1, uploadEnqueueMs: 1, dispatchEncodingMs: 1, renderEncodingMs: 1, canvasSubmitMs: 1, gpuCompletionMs: 1, submitTotalMs: 5 }, gpu: { timestampQuery: false, computeNs: null, renderNs: null, totalNs: null, unavailableReason: "The WebGPU device does not expose timestamp-query." } }));
      const correlations = profileTransitions.map((profile, index) => ({ profileId: profile.profileId, index, frame: profile.frame, startTs: index * 100 + 1, endTs: index * 100 + 90, presentationEvent: "DrawFrame", presentationTs: index * 100 + 50 }));
      const cdpTrace = { traceEvents: profileTransitions.flatMap((profile, index) => [{ name: `b37-profile/${profile.profileId}/${profile.frame}/start`, cat: "blink.user_timing", ts: index * 100 + 1 }, { name: "DrawFrame", cat: "cc", ts: index * 100 + 50 }, { name: `b37-profile/${profile.profileId}/${profile.frame}/end`, cat: "blink.user_timing", ts: index * 100 + 90 }]) };
      const cdpTraceText = JSON.stringify(cdpTrace);
      const tracePath = join(directory, "trace.json");
      const cdpTracePath = `${tracePath}.cdp-profile.json`;
      await writeFile(cdpTracePath, cdpTraceText);
      const runDirectory = join(directory, "fixture-run");
      await mkdir(runDirectory);
      const environmentManifestPath = join(runDirectory, "environment-manifest.json");
      const environmentManifest = {
        schemaVersion: "glyph-reprojection-reference-environment/v1",
        runId: "fixture-run",
        image: { id: `sha256:${"a".repeat(64)}`, base: "mcr.microsoft.com/playwright@sha256:6446946a1d9fd62d9ae501312a2d76a43ee688542b21622056a372959b65d63d" },
        source: { archiveSha256: "b".repeat(64), fileSetSha256: "c".repeat(64) },
        software: { packageSha256: sha(await readFile(join(root, "package.json"))), lockfileSha256: sha(await readFile(resolve(root, "../../pnpm-lock.yaml"))) },
        host: { os: "Ubuntu 24.04", containerOsRelease: "NAME=Ubuntu\nVERSION_ID=24.04\n" },
        gpu: { model: "NVIDIA GeForce RTX 4090 Laptop GPU", driver: "570.01", memory: "16376 MiB", uuid: "GPU-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" },
      };
      const environmentManifestText = `${JSON.stringify(environmentManifest, null, 2)}\n`;
      await writeFile(environmentManifestPath, environmentManifestText);
      const trace: any = {
        schemaVersion: "glyph-reprojection-webgpu-benchmark/v2",
        browser: { version: "140.0.7339.80" },
        provenance: { environmentManifestPath, environmentManifestSha256: sha(environmentManifestText) },
        hardware: { nvidiaSmi: { model: "NVIDIA GeForce RTX 4090 Laptop GPU", driver: "570.01", memory: "16376 MiB", uuid: "GPU-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" } },
        webgpu: { adapter: { vendor: "NVIDIA", device: "RTX 4090" }, isFallbackAdapter: false, features: [], cdp: { devices: [{ active: true, deviceString: "NVIDIA GeForce RTX 4090 Laptop GPU" }] } },
        frozenTrace: { contract: "fixtures/reprojection/reference-trace-v1.json", contractSha256: sha(contractBytes), measurementContractSha256: "122b3a42d75f9e9a0b473c9c2c38814cce3dc4239d27bb935af183c7e9fd43e9", g5SignatureSha256: "0fee24a6ca7019f5a92974476e606b89eb990695b240a1cdfbab437d92e8885e", runs: 40, framesPerRun: 326, oracle: { exact: true, readbackCount: 326, checkpointCount: 326, presentationReadbackCount: 326, resultHashes: expectedResultHashes, metrics: oracleMetrics, proofs: oracleProofs }, resultChainSha256, ...contract.expected },
        spans,
        signals: buildReferenceSignals(spans, 326, 40),
        profile: { boundedTransitions: 8, timestampQueryExposed: false, transitions: profileTransitions, cdp: { path: cdpTracePath, sha256: sha(cdpTraceText), correlations } },
      };
      const evidence = join(directory, "evidence");
      const runAdapter = async () => {
        await writeFile(tracePath, `${canonical(trace)}\n`);
        return exec(process.execPath, [join(root, "scripts/prepare-reference-evidence.mjs"), tracePath, evidence], { cwd: resolve(root, "../..") });
      };
      await runAdapter();
      const partial = JSON.parse(await readFile(join(evidence, "reference-partial-evidence.json"), "utf8"));
      expect(partial).toMatchObject({ schemaVersion: "glyph-reprojection-reference-partial-evidence/v1", status: "partial-non-pass", fullG5Pass: false, latencyGate: { pass: true, threshold: 33.3 } });
      expect(partial.measurementContract).toMatchObject({ version: "v3", sha256: "122b3a42d75f9e9a0b473c9c2c38814cce3dc4239d27bb935af183c7e9fd43e9", g5SignatureSha256: "0fee24a6ca7019f5a92974476e606b89eb990695b240a1cdfbab437d92e8885e" });
      expect(partial.contract.resultChainSha256).toBe(resultChainSha256);
      expect(partial.signals["correction-magnitude"]).toMatchObject({ value: null });
      expect(partial.priorRedEvidence.referenceImageSha256).toBe("3a034dd9275e3451e190e0df50da9891e8fee611c5092aa0034a1de9d206148f");
      expect(partial.decomposition).toMatchObject({ boundedTransitions: 8, cdpCorrelatedTransitions: 8 });
      expect(partial.provenance).toMatchObject({ runId: environmentManifest.runId, imageId: environmentManifest.image.id, driver: environmentManifest.gpu.driver, gpuUuid: environmentManifest.gpu.uuid });
      expect(partial).not.toHaveProperty("gates.G5.status", "pass");
      trace.spans[0].timedInvariant.readback = true;
      await expect(runAdapter()).rejects.toMatchObject({ stderr: expect.stringContaining("REFERENCE_TIMED_PATH_CONTAMINATED") });
      trace.spans[0].timedInvariant.readback = false;
      trace.profile.transitions[0].cpu.routingMs = null;
      await expect(runAdapter()).rejects.toMatchObject({ stderr: expect.stringContaining("REFERENCE_PROFILE_CPU_PHASES") });
      trace.profile.transitions[0].cpu.routingMs = 1;
      trace.spans[0].validCells += 1;
      await expect(runAdapter()).rejects.toMatchObject({ stderr: expect.stringContaining("REFERENCE_SPAN_METRIC_MISMATCH") });
      trace.spans[0].validCells -= 1;
      trace.spans[1].sampleId = trace.spans[0].sampleId;
      await expect(runAdapter()).rejects.toMatchObject({ stderr: expect.stringContaining("REFERENCE_TIMED_RUN_ORDER") });
      trace.spans[1].sampleId = `00:${trace.spans[1].frame}`;
      trace.frozenTrace.oracle.proofs[0].presentationMismatchBytes = 1;
      await expect(runAdapter()).rejects.toMatchObject({ stderr: expect.stringContaining("REFERENCE_ORACLE_PROOF_MISMATCH") });
      trace.frozenTrace.oracle.proofs[0].presentationMismatchBytes = 0;
      const validCdpTraceText = cdpTraceText;
      const emptyCdpTraceText = JSON.stringify({ traceEvents: [] });
      await writeFile(cdpTracePath, emptyCdpTraceText);
      trace.profile.cdp.sha256 = sha(emptyCdpTraceText);
      await expect(runAdapter()).rejects.toMatchObject({ stderr: expect.stringContaining("REFERENCE_CDP_TRACE_EMPTY") });
      await writeFile(cdpTracePath, validCdpTraceText);
      trace.profile.cdp.sha256 = sha(validCdpTraceText);
      trace.profile.cdp.correlations[0].presentationTs += 1;
      await expect(runAdapter()).rejects.toMatchObject({ stderr: expect.stringContaining("REFERENCE_PRESENTATION_CORRELATION") });
      trace.profile.cdp.correlations[0].presentationTs -= 1;
      trace.profile.timestampQueryExposed = true;
      await expect(runAdapter()).rejects.toMatchObject({ stderr: expect.stringContaining("REFERENCE_PROFILE_TIMESTAMP_FEATURE_EXPOSURE") });
      trace.webgpu.features = ["timestamp-query"];
      for (const profile of trace.profile.transitions) profile.gpu = { timestampQuery: true, computeNs: 10, renderNs: 20, totalNs: 30 };
      trace.profile.transitions[0].gpu.totalNs = 31;
      await expect(runAdapter()).rejects.toMatchObject({ stderr: expect.stringContaining("REFERENCE_PROFILE_GPU_PHASES") });
      trace.profile.timestampQueryExposed = false;
      trace.webgpu.features = [];
      for (const profile of trace.profile.transitions) profile.gpu = { timestampQuery: false, computeNs: null, renderNs: null, totalNs: null, unavailableReason: "The WebGPU device does not expose timestamp-query." };
      await writeFile(environmentManifestPath, `${environmentManifestText} `);
      await expect(runAdapter()).rejects.toMatchObject({ stderr: expect.stringContaining("REFERENCE_ENVIRONMENT_MANIFEST_HASH") });
      await writeFile(environmentManifestPath, environmentManifestText);
      environmentManifest.software.packageSha256 = "f".repeat(64);
      const tamperedManifestText = `${JSON.stringify(environmentManifest, null, 2)}\n`;
      await writeFile(environmentManifestPath, tamperedManifestText);
      trace.provenance.environmentManifestSha256 = sha(tamperedManifestText);
      await expect(runAdapter()).rejects.toMatchObject({ stderr: expect.stringContaining("REFERENCE_ENVIRONMENT_SOFTWARE_HASH") });
      environmentManifest.software.packageSha256 = sha(await readFile(join(root, "package.json")));
      await writeFile(environmentManifestPath, environmentManifestText);
      trace.provenance.environmentManifestSha256 = sha(environmentManifestText);
      environmentManifest.image.base = "mcr.microsoft.com/playwright@sha256:untrusted";
      const wrongBaseManifestText = `${JSON.stringify(environmentManifest, null, 2)}\n`;
      await writeFile(environmentManifestPath, wrongBaseManifestText);
      trace.provenance.environmentManifestSha256 = sha(wrongBaseManifestText);
      await expect(runAdapter()).rejects.toMatchObject({ stderr: expect.stringContaining("REFERENCE_ENVIRONMENT_MANIFEST_SHAPE") });
      environmentManifest.image.base = "mcr.microsoft.com/playwright@sha256:6446946a1d9fd62d9ae501312a2d76a43ee688542b21622056a372959b65d63d";
      await writeFile(environmentManifestPath, environmentManifestText);
      trace.provenance.environmentManifestSha256 = sha(environmentManifestText);
      trace.webgpu.cdp.devices.push({ active: false, deviceString: "SwiftShader software rasterizer" });
      await expect(runAdapter()).rejects.toMatchObject({ stderr: expect.stringContaining("REFERENCE_CDP_SOFTWARE_GPU") });
      trace.webgpu.cdp.devices.pop();
      const duplicateStart = { name: `b37-profile/${trace.profile.transitions[0].profileId}/${trace.profile.transitions[0].frame}/start`, cat: "blink.user_timing", ts: 2 };
      const duplicateCdpTraceText = JSON.stringify({ ...cdpTrace, traceEvents: [...cdpTrace.traceEvents, duplicateStart] });
      await writeFile(cdpTracePath, duplicateCdpTraceText);
      trace.profile.cdp.sha256 = sha(duplicateCdpTraceText);
      await expect(runAdapter()).rejects.toMatchObject({ stderr: expect.stringContaining("REFERENCE_CDP_MARK_PAIR:0") });
      await writeFile(cdpTracePath, validCdpTraceText);
      trace.profile.cdp.sha256 = sha(validCdpTraceText);
      trace.frozenTrace.oracle.resultHashes[0] = "f".repeat(64);
      await expect(runAdapter()).rejects.toMatchObject({ stderr: expect.stringContaining("REFERENCE_RESULT_CHAIN_HASH") });
      const invented = Array.from({ length: 326 }, (_, index) => sha(`result/${index}`));
      trace.frozenTrace.oracle.resultHashes = invented;
      trace.frozenTrace.resultChainSha256 = sha(canonical(invented));
      expect(trace.frozenTrace.resultChainSha256).toBe("276b50e19427774ddc728573d1ca2e2e2ed60e5694530a1d7f34644d77d1b117");
      await expect(runAdapter()).rejects.toMatchObject({ stderr: expect.stringContaining("REFERENCE_RESULT_CHAIN_HASH") });
    } finally {
      await disposeReferenceTrace(derived);
      await rm(directory, { recursive: true, force: true });
    }
  }, 300_000);

  it("rejects adversarial reference run ids before any shell path use", async () => {
    const validator = join(root, "scripts/validate-reference-run-id.mjs");
    await expect(exec(process.execPath, [validator, "reference-20260724t123456z"])).resolves.toMatchObject({ stdout: "reference-20260724t123456z" });
    for (const runId of ["../escape", "x;touch-pwned", "/absolute", "Uppercase", "a", `a${"b".repeat(80)}`]) {
      await expect(exec(process.execPath, [validator, runId])).rejects.toMatchObject({ stderr: expect.stringContaining("REFERENCE_RUN_ID_INVALID") });
    }
  });

  it("leaves the full B25 adapter fail-closed for null wired G5 metrics", async () => {
    const directory = await mkdtemp(join(tmpdir(), "glyphcss-full-g5-null-"));
    try {
      await cp(join(root, "fixtures/evidence/production"), directory, { recursive: true });
      const artifactPath = join(directory, "raw/artifacts/g5.json");
      const reportPath = join(directory, "raw/g5.json");
      const artifact = JSON.parse(await readFile(artifactPath, "utf8"));
      const report = JSON.parse(await readFile(reportPath, "utf8"));
      artifact.signals["correction-magnitude"] = { value: null, reason: "Partial B37 has no refinement." };
      report.signals = artifact.signals;
      const artifactText = `${canonical(artifact)}\n`;
      await writeFile(artifactPath, artifactText);
      report.source.sha256 = sha(artifactText);
      report.rawSha256 = sha(canonical(report, new Set(["rawSha256"])));
      await writeFile(reportPath, `${canonical(report)}\n`);
      await expect(exec(process.execPath, [join(root, "scripts/build-evidence.mjs"), "--evidence-root", directory], { cwd: resolve(root, "../..") })).rejects.toMatchObject({ stderr: expect.stringContaining("WIRED_NULL_SIGNAL") });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
