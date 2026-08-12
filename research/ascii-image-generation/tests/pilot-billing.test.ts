import { beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { preparePilotDryRun } from "../src/pilot-preflight.mjs";
import { parseOpenAIImageUsage, reconcilePilotUsage, validatePilotPricing, validateProviderSpendPrerequisite } from "../src/pilot-billing.mjs";

const pricing = { textInputUsdPerMillionTokens: 5, imageInputUsdPerMillionTokens: 8 };
const validPrerequisite = {
  dedicatedProjectId: "proj_b11_dedicated",
  hardLimitEnabled: true,
  monthlyHardLimitUsd: 12,
  trackedSpendBaselineUsd: 1.25,
  confirmation: "project console reviewed",
};

describe("B11 pilot billing preflight", () => {
  let report: Awaited<ReturnType<typeof preparePilotDryRun>>;

  beforeAll(async () => { report = await preparePilotDryRun({ configPath: resolve("tests/fixtures/pilot-legacy.json") }); }, 60_000);

  it("fails closed for missing, partial, and non-enforced provider hard-limit confirmation", () => {
    expect(() => validateProviderSpendPrerequisite({})).toThrow("PILOT_PROVIDER_HARD_LIMIT_CONFIRMATION_REQUIRED");
    expect(() => validateProviderSpendPrerequisite({ ...validPrerequisite, confirmation: null })).toThrow("PILOT_PROVIDER_HARD_LIMIT_CONFIRMATION_REQUIRED");
    expect(() => validateProviderSpendPrerequisite({ ...validPrerequisite, hardLimitEnabled: false })).toThrow("PILOT_PROVIDER_HARD_LIMIT_CONFIRMATION_REQUIRED");
    expect(() => validateProviderSpendPrerequisite({ ...validPrerequisite, trackedSpendBaselineUsd: 12 })).toThrow("PILOT_PROVIDER_HARD_LIMIT_CONFIRMATION_REQUIRED");
  });

  it("binds executable pricing to the pinned official model rates", () => {
    const official = { sources: ["https://developers.openai.com/api/docs/pricing", "https://developers.openai.com/api/docs/guides/image-generation#calculating-costs"], checkedOn: "2026-07-23", textInputUsdPerMillionTokens: 5, imageInputUsdPerMillionTokens: 8, outputUsdPerMedium1024Png: .034, outputCostPerCandidateUsd: .034 };
    expect(validatePilotPricing(official)).toEqual(official);
    expect(() => validatePilotPricing({ ...official, imageInputUsdPerMillionTokens: 7.99 })).toThrow("PILOT_PRICING_CONFIG_DRIFT");
    expect(() => validatePilotPricing({ ...official, sources: ["https://example.test"] })).toThrow("PILOT_PRICING_CONFIG_DRIFT");
    expect(() => validatePilotPricing(official, .033)).toThrow("PILOT_PRICING_CONFIG_DRIFT");
  });

  it("computes the dedicated-project remaining allowance exactly", () => {
    expect(validateProviderSpendPrerequisite(validPrerequisite)).toEqual({ effectiveRemainingProjectAllowanceUsd: 10.75 });
  });

  it("fails closed on missing or malformed provider usage", () => {
    const policy = { pricing, outputCostPerCandidateUsd: .034 };
    expect(() => reconcilePilotUsage(policy, 0, 2, null)).toThrow("PILOT_USAGE_RECONCILIATION_REQUIRED");
    expect(() => reconcilePilotUsage(policy, 0, 2, { textInputTokens: 1, imageInputTokens: -1 })).toThrow("PILOT_USAGE_RECONCILIATION_REQUIRED");
    expect(() => reconcilePilotUsage(policy, 0, 2, { textInputTokens: Number.NaN, imageInputTokens: 1 })).toThrow("PILOT_USAGE_RECONCILIATION_REQUIRED");
  });

  it("parses only documented nested Images API input usage fields", () => {
    expect(parseOpenAIImageUsage({ input_tokens_details: { text_tokens: 12, image_tokens: 34 } })).toEqual({ textInputTokens: 12, imageInputTokens: 34 });
    expect(() => parseOpenAIImageUsage({ text_input_tokens: 12, image_input_tokens: 34 })).toThrow("PILOT_USAGE_RECONCILIATION_REQUIRED");
    expect(() => parseOpenAIImageUsage({ input_tokens_details: { text_tokens: 12, image_tokens: -1 } })).toThrow("PILOT_USAGE_RECONCILIATION_REQUIRED");
  });

  it("reconciles official GPT Image 1.5 text, image, and output rates", () => {
    expect(reconcilePilotUsage({ pricing, outputCostPerCandidateUsd: .034 }, .25, 2, { textInputTokens: 1_000, imageInputTokens: 2_000 })).toEqual({ textUsd: .005, imageUsd: .016, outputUsd: .068, totalUsd: .089, accountedUsd: .339 });
  });

  it("keeps the default preflight hold and exact bounded dry-run totals", async () => {
    const config = JSON.parse(await readFile(resolve("tests/fixtures/pilot-legacy.json"), "utf8"));
    expect(config.provider.pricing).toMatchObject({ textInputUsdPerMillionTokens: 5, imageInputUsdPerMillionTokens: 8, outputUsdPerMedium1024Png: .034, checkedOn: "2026-07-23" });
    expect(report.verdict).toBe("HOLD");
    expect(report.planned).toMatchObject({ apiCalls: 90, candidateCount: 180, outputOnlyCostUsd: 6.12 });
    expect(report.regenerationReserve).toMatchObject({ apiCalls: 9, candidateCount: 18, outputOnlyCostUsd: .612 });
    expect(report.maximum).toEqual({ apiCalls: 99, candidateCount: 198, outputOnlyCostUsd: 6.732, fullHardApprovalCeilingUsd: null, maxConcurrent: 1, currency: "USD" });
    expect(report.providerSpendPrerequisite).toMatchObject({ hardLimitEnabled: null, trackedSpendBaselineUsd: null, effectiveRemainingProjectAllowanceUsd: null });
    expect(report.reconstruction).toMatchObject({ mockOnly: true, secretsRead: false, providerCalls: 0, admittedImages: 0 });
  });

  it("uses exactly nine control inputs for keyframes and ten inputs for edits", () => {
    expect(report.inputShapes).toEqual({
      keyframe: { controlImages: 9, dimensions: { "192x192": 2, "24x16": 7 } },
      edit: { controlImages: 9, priorTargetImages: 1, dimensions: { "1024x1024": 1, "192x192": 2, "24x16": 7 } },
      promptText: "exact strings are included in each redacted outbound request; token count is provider-reconciled, never estimated",
    });
    const requests = report.requests as Array<{ outbound: { operation: string; body: { images: unknown } }; placeholderReferences: boolean }>;
    const keyframes = requests.filter((request) => request.outbound.operation === "control-keyframe-edit");
    const edits = requests.filter((request) => request.outbound.operation === "temporal-edit");
    expect(keyframes).toHaveLength(30);
    expect(edits).toHaveLength(60);
    expect(keyframes.every((request) => (request.outbound.body.images as unknown[]).length === 9)).toBe(true);
    expect(edits.every((request) => (request.outbound.body.images as unknown[]).length === 10)).toBe(true);
    expect(requests.every((request) => request.placeholderReferences)).toBe(true);
  });

  it("rejects hostile complete manifests that bypass provenance, split, style, or hash checks", async () => {
    const temporary = await mkdtemp(join(tmpdir(), "glyph-b11-validation-"));
    const root = "/mnt/docker-data/glyphcss-ascii-image-generation/datasets/pilot";
    const h = (letter: string) => letter.repeat(64);
    const authority = { config: "config/corpus.json", configSha256: "55111b81843ee1eca39bd1c1b55770dd85a64fe3b44a7938ad73facf72d3ca0f", id: "corpus/mvp-v1", contentSha256: "6ea8859a1afbf923a501a5d8e83831dc696ba8a107904b44024d2c58ee4da795" };
    const record = { acceptancePath: "admission/a.json", acceptanceSha256: h("d"), targetId: "target/a", contentSha256: h("a"), requestSha256: h("b"), imageSha256: h("c"), population: "base", split: "train", sceneSeed: "seed-a", trajectoryId: "trajectory/a", styleId: "style/base", providerModel: "gpt-image-1.5", provenanceLicense: "recorded" };
    const run = async (records: unknown[]) => {
      const path = join(temporary, "manifest.json");
      await writeFile(join(temporary, "pilot-balance.json"), "{}");
      await writeFile(path, JSON.stringify({ schemaVersion: "glyph-pilot-manifest/v1", status: "complete", datasetRoot: root, admission: "B10", authoritativeCorpus: authority, balanceReport: "pilot-balance.json", records }));
      return spawnSync("node", ["scripts/validate-pilot.mjs", root, "--report", path, "--check"], { cwd: resolve("."), encoding: "utf8" });
    };
    try {
      expect((await run([record])).stderr).toContain("PILOT_NATIVE_MANIFEST_SCHEMA");
      expect((await run([{}])).stderr).toContain("PILOT_NATIVE_MANIFEST_SCHEMA");
      expect((await run([{ ...record, metadataPath: "../escape.json" }])).stderr).toContain("PILOT_NATIVE_MANIFEST_SCHEMA");
      expect((await run([{ ...record, metadataPath: "targets/a.json" }])).stderr).toContain("PILOT_NATIVE_MANIFEST_SCHEMA");
    } finally { await rm(temporary, { recursive: true, force: true }); }
  });
});
