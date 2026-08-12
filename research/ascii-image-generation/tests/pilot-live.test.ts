import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { runPilotLive } from "../src/pilot-live.mjs";
import { generateTargetPlan } from "../src/targets/provider-core.mjs";
import { evaluateMockTargetThroughB10 } from "../src/pilot-admission.mjs";

const root = resolve(import.meta.dirname, "..");
const baseConfig = async (path: string, limit = 12, reserve = 3) => {
  const config = JSON.parse(await readFile(join(root, "tests/fixtures/pilot-legacy.json"), "utf8"));
  config.provider.providerSpendPrerequisite = { dedicatedProjectId: "proj_test_b11", hardLimitEnabled: true, monthlyHardLimitUsd: limit, trackedSpendBaselineUsd: 0, confirmation: "offline hostile test" };
  config.regenerationReserve.wholeTrajectorySlots = reserve;
  await writeFile(path, JSON.stringify(config));
};
const liveProvider = (usage: any, calls: { value: number }) => ({
  id: "openai-images/v1", model: "gpt-image-1.5", apiVersion: "openai-images/v1", projectId: "proj_test_b11",
  controlReference: ({ role, regeneration }: any) => ({ fileId: `offline-${role}-${regeneration}` }),
  async candidates(request: any) {
    calls.value += 1;
    return Array.from({ length: request.candidates }, (_, candidateIndex) => ({ image: Buffer.from(`${request.requestSha256}:${candidateIndex}`), candidateIndex, responseRequestId: `offline-${calls.value}`, attempts: [{ attempt: 1, outcome: "success", status: 200 }], reused: false, providerRequest: { apiVersion: "offline/v1", operation: "offline-test", endpoint: "offline://provider", method: "NONE", body: {}, prompt: "offline" }, usage }));
  },
});
const accepted = async ({ target, corpusRoot, record, frameId }: any) => evaluateMockTargetThroughB10({ target: { ...target, provider: { ...target.provider, id: "mock-deterministic/v2" } }, corpusRoot, record, frameId });

describe("B11 live-only pilot orchestration", () => {
  it("rejects the generic planner's former live billing route", async () => {
    await expect(generateTargetPlan({ provider: liveProvider({ textInputTokens: 0, imageInputTokens: 0 }, { value: 0 }), requests: [{}], outputRoot: "/tmp/never", costCeilingUsd: 1, costPerCandidateUsd: .034, maxConcurrent: 1, billing: {} })).rejects.toThrow("PILOT_LIVE_ORCHESTRATION_REQUIRED");
  });

  it("rejects a raw OpenAI provider at the generic publication boundary", async () => {
    const { persistTargetCandidates } = await import("../src/targets/provider-core.mjs");
    await expect(persistTargetCandidates({ provider: liveProvider({ textInputTokens: 0, imageInputTokens: 0 }, { value: 0 }), request: {}, outputRoot: "/tmp/never", costCeilingUsd: 1, costPerCandidateUsd: .034 })).rejects.toThrow("PILOT_LIVE_ORCHESTRATION_REQUIRED");
  });

  it("rejects a wrong model before any provider dispatch", async () => {
    const directory = await mkdtemp(join(tmpdir(), "glyph-b11-live-model-")), config = join(directory, "pilot.json"), calls = { value: 0 };
    try {
      await baseConfig(config);
      const provider = { ...liveProvider({ textInputTokens: 0, imageInputTokens: 0 }, calls), model: "wrong-model" };
      await expect(runPilotLive({ provider, evaluateTarget: accepted, outputRoot: join(directory, "dataset"), configPath: config })).rejects.toThrow("PILOT_PROVIDER_MODEL_MISMATCH");
      expect(calls.value).toBe(0);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it("stops after the first paid response when nested usage is absent", async () => {
    const directory = await mkdtemp(join(tmpdir(), "glyph-b11-live-usage-")), config = join(directory, "pilot.json"), calls = { value: 0 };
    try {
      await baseConfig(config);
      await expect(runPilotLive({ provider: liveProvider(null, calls), evaluateTarget: accepted, outputRoot: join(directory, "dataset"), configPath: config })).rejects.toThrow("PILOT_USAGE_RECONCILIATION_REQUIRED");
      expect(calls.value).toBe(1);
    } finally { await rm(directory, { recursive: true, force: true }); }
  }, 60_000);

  it("does not dispatch when the effective project allowance cannot cover one response", async () => {
    const directory = await mkdtemp(join(tmpdir(), "glyph-b11-live-allowance-")), config = join(directory, "pilot.json"), calls = { value: 0 };
    try {
      await baseConfig(config, .05);
      await expect(runPilotLive({ provider: liveProvider({ textInputTokens: 0, imageInputTokens: 0 }, calls), evaluateTarget: accepted, outputRoot: join(directory, "dataset"), configPath: config })).rejects.toThrow("PILOT_PROJECT_ALLOWANCE_INSUFFICIENT");
      expect(calls.value).toBe(0);
    } finally { await rm(directory, { recursive: true, force: true }); }
  }, 60_000);

  it("enforces the whole-trajectory regeneration reserve", async () => {
    const directory = await mkdtemp(join(tmpdir(), "glyph-b11-live-reserve-")), config = join(directory, "pilot.json"), calls = { value: 0 };
    try {
      await baseConfig(config, 12, 0);
      await expect(runPilotLive({ provider: liveProvider({ textInputTokens: 0, imageInputTokens: 0 }, calls), evaluateTarget: async (input: any) => {
        const result = await accepted(input); result.b10.metrics["visible-ascii-adherence"] = 1; return result;
      }, outputRoot: join(directory, "dataset"), configPath: config })).rejects.toThrow("PILOT_REGENERATION_RESERVE_EXHAUSTED");
      expect(calls.value).toBe(1);
    } finally { await rm(directory, { recursive: true, force: true }); }
  }, 60_000);

  it("assembles a complete dataset only from sequentially accounted B10 results", async () => {
    const directory = await mkdtemp(join(tmpdir(), "glyph-b11-live-accounted-")), config = join(directory, "pilot.json"), calls = { value: 0 };
    try {
      await baseConfig(config);
      const result = await runPilotLive({ provider: liveProvider({ textInputTokens: 0, imageInputTokens: 0 }, calls), evaluateTarget: accepted, outputRoot: join(directory, "dataset"), configPath: config });
      expect(calls.value).toBe(90);
      expect(result.dispatched).toBe(90);
      expect(result.manifest.records).toHaveLength(90);
      expect(result.accountedUsd).toBe(6.12);
      const target = JSON.parse(await readFile(join(directory, "dataset", result.manifest.records[0].metadataPath), "utf8"));
      expect(target.provider.id).toBe("openai-images/v1");
      expect(result.manifest).toMatchObject({ schemaVersion: "glyph-pilot-manifest/v1", status: "complete", admission: "B10" });
      expect(result.balance.populations).toHaveLength(3);
    } finally { await rm(directory, { recursive: true, force: true }); }
  }, 180_000);
});
