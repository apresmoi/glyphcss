import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  canonical,
  deriveAdmissionEvidence,
  evaluateAdmissionFixture,
  reconstructContractSnapshot,
  sha256,
  validateAdmissionEvidence,
} from "../src/eval/admission.mjs";
import { evaluateB9Provenance } from "../src/eval/provenance.mjs";

const root = resolve(import.meta.dirname, "..");
const fixture = JSON.parse(readFileSync(resolve(root, "fixtures/eval/admission-v1.json"), "utf8"));

describe("B10 pair and trajectory admission", () => {
  it("passes good controls and gives every visual/temporal adversarial a positive non-tautological branch", () => {
    const result = evaluateAdmissionFixture(fixture);
    expect(result.passed).toBe(true);
    for (const entry of result.cases) {
      expect(entry.setup).toBe(true);
      expect(entry.setupAssertions.every((assertion: { pass: boolean }) => assertion.pass)).toBe(true);
      expect(entry.trace.frames).toHaveLength(2);
      if (entry.kind === "good") expect(entry.failed).toEqual([]);
      else expect(entry.failed).toContain(entry.expectedFailMetric);
    }
    expect(result.cases.find((entry: { id: string }) => entry.id === "wrong-camera").metrics["depth-edge-agreement"].value).toBeGreaterThan(0);
    expect(result.cases.find((entry: { id: string }) => entry.id === "good-same-rgb-distinct-surfaces").failed).toEqual([]);
    expect(result.cases.find((entry: { id: string }) => entry.id === "cross-surface-bleed").metrics["disocclusion-recovery"].value).toBeGreaterThan(0);
  });

  it("validates real B9 v2 target/control/upload bytes and rejects recomputed hostile lineage hashes", async () => {
    const cases = await evaluateB9Provenance();
    for (const entry of cases) {
      expect(entry.setup).toBe(true);
      expect(entry.setupAssertions.every((assertion: { pass: boolean }) => assertion.pass)).toBe(true);
      expect(entry.trace.frames).toHaveLength(2);
      if (entry.kind === "good") expect(entry.failed).toEqual([]);
      else expect(entry.failed).toContain("provenance-corruption");
    }
    expect(cases.map((entry: { id: string }) => entry.id)).toEqual([
      "valid-b9-target-control-upload",
      "corrupted-control-png-bytes",
      "rehashed-control-source-rebind",
      "rehashed-target-lineage-rebind",
      "rehashed-target-upload-rebind",
      "corrupted-target-image-bytes",
    ]);
  }, 30_000);

  it("derives G1 from baseline inputs/results and fails closed on baseline, hash, or result tampering", () => {
    const evaluated = evaluateAdmissionFixture(fixture);
    const baseline = { ...evaluated, provenanceCases: [], contractVersion: "v3" };
    const baselineText = `${canonical(baseline)}\n`;
    const derivation = deriveAdmissionEvidence(baseline, baselineText);
    const artifact = { signals: { admission: { value: derivation.metric.result.value } }, derivation };
    const report = structuredClone(artifact);
    expect(validateAdmissionEvidence({ baseline, baselineText, artifact, report })).toEqual(derivation);

    const changedBaseline = structuredClone(baseline);
    changedBaseline.cases[0].failed.push("visible-ascii-adherence");
    expect(() => validateAdmissionEvidence({ baseline: changedBaseline, baselineText, artifact, report })).toThrow(/DERIVATION_MISMATCH/);
    const badHash = structuredClone(artifact); badHash.derivation.baseline.sha256 = "0".repeat(64);
    expect(() => validateAdmissionEvidence({ baseline, baselineText, artifact: badHash, report })).toThrow(/DERIVATION_MISMATCH/);
    const badResult = structuredClone(report); badResult.derivation.metric.result.value = 0;
    expect(() => validateAdmissionEvidence({ baseline, baselineText, artifact, report: badResult })).toThrow(/DERIVATION_MISMATCH/);
  });

  it("reconstructs the exact v2 source, pins the v3 contract, and proves G5 unchanged", () => {
    const contract = JSON.parse(readFileSync(resolve(root, "config/measurement-gates.json"), "utf8"));
    const freeze = JSON.parse(readFileSync(resolve(root, "fixtures/eval/frozen-contract-v3.json"), "utf8"));
    const snapshot = JSON.parse(readFileSync(resolve(root, "fixtures/eval/measurement-gates-v2.snapshot.json"), "utf8"));
    const v2 = reconstructContractSnapshot(snapshot, contract);
    expect(sha256(v2)).toBe("d9629d90761fbc855ce796efd1a309f488c7ff3fbe8d07220f9154887d87449d");
    expect(freeze.contractSha256).toBe(sha256(contract));
    expect(freeze.g5Sha256).toBe(sha256(contract.gates.find((gate: { id: string }) => gate.id === "G5")));
    expect(sha256(v2.gates.find((gate: { id: string }) => gate.id === "G5"))).toBe(freeze.g5Sha256);
    expect(freeze.v2SnapshotSha256).toBe(sha256(readFileSync(resolve(root, "fixtures/eval/measurement-gates-v2.snapshot.json"))));
    expect(freeze.v2V3DiffSha256).toBe(sha256(readFileSync(resolve(root, "reports/measurement-gates-v2-v3-diff.json"))));
  });

  it("publishes every complete trace with controls, lineage, metrics, and setup evidence", () => {
    const baseline = JSON.parse(readFileSync(resolve(root, "reports/eval-baseline.json"), "utf8"));
    const contact = readFileSync(resolve(root, "reports/eval-contact-sheet.html"), "utf8");
    const cases = [...baseline.cases, ...baseline.provenanceCases];
    expect(cases).toHaveLength(22);
    for (const entry of cases) {
      expect(entry.trace.frames).toHaveLength(2);
      expect(contact).toContain(`id="${entry.id}"`);
      expect(contact).toContain(`${entry.id}/source`);
      expect(contact).toContain(`${entry.id}/candidate`);
    }
    expect(contact).toContain("Per-frame source/candidate controls and lineage");
    expect(contact).toContain("Setup assertions");
    expect(contact).toContain("Per-frame metrics");
  });
});
