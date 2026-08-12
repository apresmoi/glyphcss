import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const directory = dirname(fileURLToPath(import.meta.url));
const research = resolve(directory, "..");
const script = resolve(research, "scripts/build-evidence.mjs");
const canonical = (value: unknown, omit = new Set<string>()): string => Array.isArray(value) ? `[${value.map((item) => canonical(item, omit)).join(",")}]` : value && typeof value === "object" ? `{${Object.keys(value as object).filter((key) => !omit.has(key)).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key], omit)}`).join(",")}}` : JSON.stringify(value);
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const run = (root: string, ...args: string[]) => execFileSync(process.execPath, [script, "--evidence-root", root, ...args], { cwd: research, encoding: "utf8" });
function fixtureRoot() {
  const target = mkdtempSync(resolve(tmpdir(), "glyph-evidence-"));
  cpSync(resolve(research, "fixtures/evidence/production"), target, { recursive: true });
  rmSync(resolve(target, "generated"), { recursive: true, force: true });
  return target;
}
function rehash(path: string) {
  const raw = JSON.parse(readFileSync(path, "utf8"));
  raw.rawSha256 = sha(canonical(raw, new Set(["rawSha256"])));
  writeFileSync(path, `${canonical(raw)}\n`);
}
function syncSource(reportPath: string, artifactPath: string) {
  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  report.source.sha256 = sha(readFileSync(artifactPath, "utf8"));
  report.rawSha256 = sha(canonical(report, new Set(["rawSha256"])));
  writeFileSync(reportPath, `${canonical(report)}\n`);
}

describe("B25 measurement evidence", () => {
  it("ingests production-shaped raw reports and atomically emits/checks all payloads", () => {
    const root = fixtureRoot();
    try {
      expect(run(root)).toContain("Evidence passed");
      expect(run(root, "--check")).toContain("Evidence passed");
      for (const name of ["summary.json", "differential-testing.json", "visual-parity.json", "performance-tracing.json"]) expect(readFileSync(resolve(root, "generated", name), "utf8")).toContain("payloadSha256");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("fails closed for missing, stale, tampered, traversing, symlinked, and null-wired evidence", () => {
    const root = fixtureRoot(); const g0 = resolve(root, "raw/g0.json");
    try {
      expect(() => run(root, "--check")).toThrow(/MISSING_GENERATED_OUTPUT/);
      run(root);
      writeFileSync(resolve(root, "generated/summary.json"), "{}");
      expect(() => run(root, "--check")).toThrow(/STALE_GENERATED_OUTPUT/);
      const source = resolve(root, "raw/artifacts/g0.json"); writeFileSync(source, "tampered");
      expect(() => run(root)).toThrow(/SOURCE_HASH_MISMATCH/);
      rmSync(source); cpSync(resolve(research, "fixtures/evidence/production/raw/artifacts/g0.json"), source);
      const pathRaw = JSON.parse(readFileSync(g0, "utf8")); pathRaw.source.path = "reports/evidence/raw/artifacts/../../outside.json"; writeFileSync(g0, `${canonical(pathRaw)}\n`); rehash(g0);
      expect(() => run(root)).toThrow(/SOURCE_PATH_ESCAPE/);
      cpSync(resolve(research, "fixtures/evidence/production/raw/g0.json"), g0);
      const outside = resolve(root, "outside.json"); writeFileSync(outside, "outside"); rmSync(source); symlinkSync(outside, source); 
      expect(() => run(root)).toThrow(/SOURCE_PATH_ESCAPE/);
      cpSync(resolve(research, "fixtures/evidence/production/raw/artifacts/g0.json"), source);
      const mismatchRaw = JSON.parse(readFileSync(g0, "utf8")); mismatchRaw.signals["visible-bytes"] = { value: 1 }; writeFileSync(g0, `${canonical(mismatchRaw)}\n`); rehash(g0);
      expect(() => run(root)).toThrow(/ARTIFACT_SIGNAL_MISMATCH/);
      cpSync(resolve(research, "fixtures/evidence/production/raw/g0.json"), g0);
      const hardwareRaw = JSON.parse(readFileSync(g0, "utf8")); hardwareRaw.hardware.gpu = "different GPU"; writeFileSync(g0, `${canonical(hardwareRaw)}\n`); rehash(g0);
      expect(() => run(root)).toThrow(/SCHEMA_VALIDATION_FAILED/);
      cpSync(resolve(research, "fixtures/evidence/production/raw/g0.json"), g0);
      const nullRaw = JSON.parse(readFileSync(g0, "utf8")); nullRaw.signals["visible-bytes"] = { value: null, reason: "not allowed" }; writeFileSync(g0, `${canonical(nullRaw)}\n`); rehash(g0);
      const nullArtifact = JSON.parse(readFileSync(source, "utf8")); nullArtifact.signals["visible-bytes"] = { value: null, reason: "not allowed" }; writeFileSync(source, `${canonical(nullArtifact)}\n`); syncSource(g0, source);
      expect(() => run(root)).toThrow(/WIRED_NULL_SIGNAL/);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("fails closed when the evaluated G1 baseline, its bound hash, or its derived result is tampered", () => {
    const root = fixtureRoot();
    const baseline = resolve(root, "eval-baseline.json");
    const artifactPath = resolve(root, "raw/artifacts/g1.json");
    const reportPath = resolve(root, "raw/g1.json");
    try {
      cpSync(resolve(research, "reports/eval-baseline.json"), baseline);
      expect(run(root, "--baseline-path", baseline)).toContain("Evidence passed");

      const changed = JSON.parse(readFileSync(baseline, "utf8"));
      changed.cases[0].failed.push("visible-ascii-adherence");
      writeFileSync(baseline, `${canonical(changed)}\n`);
      expect(() => run(root, "--baseline-path", baseline)).toThrow(/G1_DERIVATION_INVALID/);
      cpSync(resolve(research, "reports/eval-baseline.json"), baseline);

      for (const path of [artifactPath, reportPath]) {
        const value = JSON.parse(readFileSync(path, "utf8"));
        value.derivation.baseline.sha256 = "0".repeat(64);
        if ("rawSha256" in value) value.rawSha256 = sha(canonical(value, new Set(["rawSha256"])));
        writeFileSync(path, `${canonical(value)}\n`);
      }
      syncSource(reportPath, artifactPath);
      expect(() => run(root, "--baseline-path", baseline)).toThrow(/G1_DERIVATION_INVALID/);

      cpSync(resolve(research, "fixtures/evidence/production/raw/artifacts/g1.json"), artifactPath);
      cpSync(resolve(research, "fixtures/evidence/production/raw/g1.json"), reportPath);
      for (const path of [artifactPath, reportPath]) {
        const value = JSON.parse(readFileSync(path, "utf8"));
        value.derivation.metric.result.value = 0;
        if ("rawSha256" in value) value.rawSha256 = sha(canonical(value, new Set(["rawSha256"])));
        writeFileSync(path, `${canonical(value)}\n`);
      }
      syncSource(reportPath, artifactPath);
      expect(() => run(root, "--baseline-path", baseline)).toThrow(/G1_DERIVATION_INVALID/);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
