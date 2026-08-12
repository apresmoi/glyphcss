import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const researchRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const checker = resolve(researchRoot, "scripts/check-base-model-preflight.mjs");
const schema = resolve(researchRoot, "schema/base-model.schema.json");
const configPath = resolve(researchRoot, "config/base-model.json");
const reportPath = resolve(researchRoot, "reports/base-model-preflight.json");
const config = JSON.parse(readFileSync(configPath, "utf8"));
const report = JSON.parse(readFileSync(reportPath, "utf8"));

function check(candidate: unknown, sourceRoot = researchRoot) {
  const directory = mkdtempSync(resolve(tmpdir(), "glyph-b34-check-"));
  const path = resolve(directory, "report.json");
  writeFileSync(path, `${JSON.stringify(candidate)}\n`);
  return () => execFileSync(process.execPath, [checker, schema, configPath, path, sourceRoot], { encoding: "utf8", stdio: "pipe" });
}

function mutate(mutator: (candidate: any) => void) {
  const candidate = structuredClone(report);
  mutator(candidate);
  return candidate;
}

describe("B34 immutable base-model preflight", () => {
  it("accepts only the finalized report and checked-in source texts", () => {
    expect(check(report)).not.toThrow();
  });

  it.each([
    ["config hash", (value: any) => { value.configSha256 = "0".repeat(64); }],
    ["container context", (value: any) => { value.container.context = "default"; }],
    ["container image", (value: any) => { value.container.image = "glyphcss-ascii-trainer:other"; }],
    ["container digest", (value: any) => { value.container.digest = `sha256:${"0".repeat(64)}`; }],
    ["model path", (value: any) => { value.model.files[0].path = "other.json"; }],
    ["model URL", (value: any) => { value.model.files[0].url += "?mutable=1"; }],
    ["model hash", (value: any) => { value.model.files[0].sha256 = "0".repeat(64); }],
    ["model size", (value: any) => { value.model.files[0].bytes += 1; }],
    ["round files", (value: any) => { value.verification.rounds[0].files[0].bytes += 1; }],
    ["round tree hash", (value: any) => { value.verification.rounds[0].treeSha256 = "0".repeat(64); }],
    ["forced round", (value: any) => { value.verification.rounds[1].forceDownload = false; }],
    ["parameter claim", (value: any) => { value.model.parameterCount.exactArtifacts.unet += 1; }],
    ["parameter evidence", (value: any) => { value.model.recomputedParameterCount.unet += 1; }],
    ["generator payload", (value: any) => { value.model.browserPayload.generatorCore.weightsBytes += 1; }],
    ["safety payload", (value: any) => { value.model.browserPayload.requiredLocalDemo.paths.pop(); }],
    ["disposition", (value: any) => { value.disposition.browserBundle = "allowed"; }],
    ["source manifest", (value: any) => { value.sourceTexts[0].sha256 = "0".repeat(64); }],
    ["artifact root", (value: any) => { value.artifactRoot += "-other"; }],
  ])("rejects hostile %s drift", (_label, mutator) => {
    expect(check(mutate(mutator))).toThrow();
  });

  it("rejects changed checked-in source-text bytes even when the report is unchanged", () => {
    const sourceRoot = mkdtempSync(resolve(tmpdir(), "glyph-b34-source-"));
    for (const source of config.sourceTexts) {
      const destination = resolve(sourceRoot, source.path);
      mkdirSync(dirname(destination), { recursive: true });
      copyFileSync(resolve(researchRoot, source.path), destination);
    }
    const modelCard = resolve(sourceRoot, config.sourceTexts[0].path);
    writeFileSync(modelCard, `${readFileSync(modelCard, "utf8")}\ndrift\n`);
    expect(check(report, sourceRoot)).toThrow();
  });
});
