#!/usr/bin/env node
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { deriveAdmissionEvidence, validateAdmissionEvidence } from "../src/eval/admission.mjs";

const root = resolve(import.meta.dirname, "..");
const fixture = process.argv.includes("--fixtures");
const check = process.argv.includes("--check");
const writeFixtures = process.argv.includes("--write-fixtures");
const evidenceRootFlag = process.argv.indexOf("--evidence-root");
const evidenceRoot = evidenceRootFlag >= 0 ? resolve(process.argv[evidenceRootFlag + 1] ?? "") : fixture ? join(root, "fixtures/evidence/production") : join(root, "reports/evidence");
const baselinePathFlag = process.argv.indexOf("--baseline-path");
const admissionBaselinePath = baselinePathFlag >= 0 ? resolve(process.argv[baselinePathFlag + 1] ?? "") : join(root, "reports/eval-baseline.json");
const rawRoot = join(evidenceRoot, "raw");
const artifactRoot = join(rawRoot, "artifacts");
const outputRoot = join(evidenceRoot, "generated");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const canonical = (value, omit = new Set()) => Array.isArray(value) ? `[${value.map((item) => canonical(item, omit)).join(",")}]` : value && typeof value === "object" ? `{${Object.keys(value).filter((key) => !omit.has(key)).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key], omit)}`).join(",")}}` : JSON.stringify(value);
const fail = (code, message) => { const error = new Error(`${code}: ${message}`); error.code = code; throw error; };
const assert = (value, code, message) => { if (!value) fail(code, message); };
const json = async (path) => JSON.parse(await readFile(path, "utf8"));
const inside = (candidate, directory) => candidate === directory || candidate.startsWith(`${directory}${sep}`);
async function confined(path, directory, code) {
  assert(!path.includes("\\"), code, path);
  const lexical = resolve(path);
  assert(inside(lexical, directory), code, path);
  const stat = await lstat(lexical).catch(() => fail(code, path));
  assert(!stat.isSymbolicLink(), code, path);
  const resolved = await realpath(lexical).catch(() => fail(code, path));
  assert(inside(resolved, await realpath(directory)), code, path);
  return resolved;
}
const [gateSchema, reportSchema, artifactSchema, summarySchema, differentialSchema, visualSchema, performanceSchema, derivationSchema, contract, derivations] = await Promise.all([
  json(join(root, "schema/measurement-gates.schema.json")), json(join(root, "schema/metric-report.schema.json")),
  json(join(root, "schema/metric-source-artifact.schema.json")),
  json(join(root, "schema/normalized-summary.schema.json")), json(join(root, "schema/differential-testing.schema.json")),
  json(join(root, "schema/visual-parity.schema.json")), json(join(root, "schema/performance-tracing.schema.json")),
  json(join(root, "schema/derivation-registry.schema.json")), json(join(root, "config/measurement-gates.json")), json(join(root, "config/derivation-registry.json")),
]);
const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true });
for (const value of [gateSchema, reportSchema, artifactSchema, summarySchema, differentialSchema, visualSchema, performanceSchema, derivationSchema]) ajv.addSchema(value);
const validators = new Map([["contract", ajv.getSchema(gateSchema.$id)], ["report", ajv.getSchema(reportSchema.$id)], ["artifact", ajv.getSchema(artifactSchema.$id)], ["summary", ajv.getSchema(summarySchema.$id)], ["differentialTesting", ajv.getSchema(differentialSchema.$id)], ["visualParity", ajv.getSchema(visualSchema.$id)], ["performanceTracing", ajv.getSchema(performanceSchema.$id)], ["derivations", ajv.getSchema(derivationSchema.$id)]]);
function schema(name, value) { const validate = validators.get(name); if (!validate(value)) fail("SCHEMA_VALIDATION_FAILED", `${name}: ${ajv.errorsText(validate.errors)}`); }
schema("contract", contract); schema("derivations", derivations);
const contractSha256 = sha256(canonical(contract));
const derivationSha256 = sha256(canonical(derivations));
const hardware = contract.hardwareScope;
const forbidden = /(^|[-_])(pass|fail|status|verdict)([-_]|$)/i;
const outputFiles = { summary: "summary.json", differentialTesting: "differential-testing.json", visualParity: "visual-parity.json", performanceTracing: "performance-tracing.json" };

function validateContractSemantics() {
  assert(new Set(contract.gates.map((gate) => gate.id)).size === 8, "GATE_CONTRACT", "G0-G7 exactly once");
  const ids = contract.gates.flatMap((gate) => gate.metrics.map((metric) => metric.id));
  assert(new Set(ids).size === ids.length, "DUPLICATE_METRIC_ID", "metric ids must be unique");
  for (const gate of contract.gates) for (const metric of gate.metrics) {
    assert(metric.evidence === `reports/evidence/raw/${gate.id.toLowerCase()}.json`, "METRIC_EVIDENCE_PATH", metric.id);
    assert((metric.direction === "fixture") === (typeof metric.threshold === "string"), "DIRECTION_THRESHOLD_PAIR", metric.id);
    if (typeof metric.threshold === "string") assert(derivations.derivations.some((entry) => `fixture:${entry.id}` === metric.threshold), "UNKNOWN_DERIVATION", metric.id);
  }
  assert(canonical(hardware) === canonical({ browser: "Chromium 140.0.7339.80", gpu: "LeDeluge NVIDIA GeForce RTX 4090 Laptop GPU (16 GB)", runtime: "Browser WebGPU only; CPU fallback disabled" }), "HARDWARE_SCOPE", "pinned browser target required");
}
validateContractSemantics();
async function validateDerivationFiles() {
  const directory = join(root, "config/derivations");
  for (const entry of derivations.derivations) {
    const path = await confined(join(root, entry.definitionPath), directory, "DERIVATION_PATH_ESCAPE");
    const bytes = await readFile(path);
    assert(sha256(bytes) === entry.definitionSha256, "DERIVATION_HASH_MISMATCH", entry.id);
    const definition = JSON.parse(bytes);
    assert(definition.id === entry.id && definition.evaluator === entry.evaluator && definition.expected === entry.expected, "DERIVATION_DEFINITION_MISMATCH", entry.id);
  }
}

async function sourceArtifact(report) {
  const expectedPrefix = "reports/evidence/raw/artifacts/";
  assert(report.source.path.startsWith(expectedPrefix), "SOURCE_PATH_ESCAPE", report.source.path);
  const local = join(evidenceRoot, "raw/artifacts", report.source.path.slice(expectedPrefix.length));
  const real = await confined(local, artifactRoot, "SOURCE_PATH_ESCAPE");
  const bytes = await readFile(real);
  assert(sha256(bytes) === report.source.sha256, "SOURCE_HASH_MISMATCH", report.reportId);
  const artifact = JSON.parse(bytes);
  schema("artifact", artifact);
  return artifact;
}
function validateReport(raw, gate) {
  schema("report", raw);
  assert(raw.contractSha256 === contractSha256, "CONTRACT_HASH_MISMATCH", raw.reportId);
  assert(raw.rawSha256 === sha256(canonical(raw, new Set(["rawSha256"]))), "RAW_HASH_MISMATCH", raw.reportId);
  assert(raw.reportId === `raw/${gate.id.toLowerCase()}`, "STALE_EVIDENCE_PATH", raw.reportId);
  assert(canonical(raw.hardware) === canonical(hardware), "REPORT_HARDWARE_MISMATCH", raw.reportId);
  for (const key of Object.keys(raw.signals)) assert(!forbidden.test(key), "HAND_AUTHORED_STATUS", `${raw.reportId}.${key}`);
}
function evaluateDerivation(metric, signal) {
  const entry = derivations.derivations.find((value) => `fixture:${value.id}` === metric.threshold);
  assert(entry, "UNKNOWN_DERIVATION", metric.id);
  const pass = entry.evaluator === "eq" ? signal.value === entry.expected : entry.evaluator === "lte" ? signal.value <= entry.expected : entry.evaluator === "gte" ? signal.value >= entry.expected : false;
  return { value: signal.value, threshold: metric.threshold, status: pass ? "pass" : "fail", derivation: entry.id };
}
function metricStatus(metric, signal) {
  if (!signal) { if (metric.unwired) return { value: null, reason: "unwired source has no raw signal", status: "unwired" }; fail("MISSING_REQUIRED_SIGNAL", metric.id); }
  if (signal.value === null) { assert(metric.unwired, "WIRED_NULL_SIGNAL", metric.id); assert(typeof signal.reason === "string" && signal.reason.length > 0, "UNWIRED_REASON_REQUIRED", metric.id); return { value: null, reason: signal.reason, status: "unwired" }; }
  assert(!metric.unwired, "UNWIRED_HAS_VALUE", metric.id);
  if (typeof metric.threshold === "string") return evaluateDerivation(metric, signal);
  const pass = metric.direction === "eq" ? signal.value === metric.threshold : metric.direction === "lte" ? signal.value <= metric.threshold : signal.value >= metric.threshold;
  return { value: signal.value, threshold: metric.threshold, status: pass ? "pass" : "fail" };
}
async function readReports() {
  await confined(rawRoot, evidenceRoot, "RAW_ROOT_MISSING");
  const names = (await readdir(rawRoot)).filter((name) => /^g[0-7]\.json$/.test(name)).sort();
  assert(names.length === 8, "MISSING_RAW_REPORTS", "G0-G7 reports required");
  const reports = [];
  for (const name of names) {
    const path = await confined(join(rawRoot, name), rawRoot, "RAW_PATH_ESCAPE");
    const report = await json(path);
    const gate = contract.gates.find((value) => value.id.toLowerCase() === name.slice(0, -5));
    validateReport(report, gate); const artifact = await sourceArtifact(report);
    assert(artifact.gate === gate.id, "ARTIFACT_GATE_MISMATCH", report.reportId);
    assert(canonical(artifact.hardware) === canonical(hardware), "ARTIFACT_HARDWARE_MISMATCH", report.reportId);
    assert(canonical(artifact.signals) === canonical(report.signals), "ARTIFACT_SIGNAL_MISMATCH", report.reportId);
    if (gate.id === "G1") {
      assert(artifact.derivation && report.derivation, "G1_DERIVATION_MISSING", report.reportId);
      const baselineText = await readFile(admissionBaselinePath, "utf8");
      const baseline = JSON.parse(baselineText);
      try { validateAdmissionEvidence({ baseline, baselineText, artifact, report }); }
      catch (error) { fail("G1_DERIVATION_INVALID", String(error?.message ?? error)); }
    } else {
      assert(!artifact.derivation && !report.derivation, "UNEXPECTED_GATE_DERIVATION", report.reportId);
    }
    reports.push(report);
  }
  return reports;
}
async function bootstrapFixtures() {
  const seed = await json(join(root, "fixtures/evidence/seed-signals.json"));
  await mkdir(artifactRoot, { recursive: true });
  for (const gate of contract.gates) {
    const signals = seed[gate.id]; assert(signals, "FIXTURE_SEED_MISSING", gate.id);
    let derivation;
    if (gate.id === "G1") {
      const baselineText = await readFile(admissionBaselinePath, "utf8");
      derivation = deriveAdmissionEvidence(JSON.parse(baselineText), baselineText);
      assert(signals.admission?.value === derivation.metric.result.value, "G1_FIXTURE_SIGNAL_DRIFT", gate.id);
    }
    const artifact = { schemaVersion: "metric-source-artifact/v1", artifactVersion: "v1", gate: gate.id, fixture: gate.id === "G1" ? "B10 evaluated baseline; no hand-authored gate result" : "B25 deterministic production-shaped input", hardware, signals, ...(derivation ? { derivation } : {}) };
    const artifactPath = join(artifactRoot, `${gate.id.toLowerCase()}.json`);
    const bytes = `${canonical(artifact)}\n`; await writeFile(artifactPath, bytes);
    const report = { schemaVersion: "metric-report/v2", reportId: `raw/${gate.id.toLowerCase()}`, contractSha256, source: { kind: gate.id === "G0" || gate.id === "G1" ? "differential" : gate.id === "G5" || gate.id === "G6" ? "performance-trace" : gate.id === "G7" ? "reproducibility" : "visual-parity", path: `reports/evidence/raw/artifacts/${gate.id.toLowerCase()}.json`, sha256: sha256(bytes) }, hardware, signals, ...(derivation ? { derivation } : {}) };
    report.rawSha256 = sha256(canonical(report));
    await writeFile(join(rawRoot, `${gate.id.toLowerCase()}.json`), `${canonical(report)}\n`);
  }
}
function payload(schemaVersion, gates) { const value = { schemaVersion, contractSha256, derivationSha256, gates }; value.payloadSha256 = sha256(canonical(value, new Set(["payloadSha256"]))); return value; }
function build(raws) {
  const byGate = new Map(raws.map((raw) => [raw.reportId.slice(4).toUpperCase(), raw]));
  const gates = contract.gates.map((gate) => {
    const raw = byGate.get(gate.id); assert(raw, "MISSING_RAW_REPORT", gate.id);
    const metrics = gate.metrics.map((metric) => ({ id: metric.id, ...metricStatus(metric, raw.signals[metric.id]) }));
    const statuses = metrics.map((metric) => metric.status);
    return { id: gate.id, status: statuses.includes("fail") ? "fail" : statuses.every((status) => status === "pass") ? "pass" : "unwired", evidence: raw.rawSha256, source: { ...raw.source, ...(raw.derivation ? { derivation: raw.derivation } : {}) }, metrics };
  });
  return {
    summary: payload("glyph-generation-evidence/v2", gates),
    differentialTesting: payload("differential-testing/v2", gates.filter((gate) => ["G0", "G1", "G2", "G3", "G4"].includes(gate.id))),
    visualParity: payload("visual-parity/v2", gates.filter((gate) => ["G0", "G5", "G6"].includes(gate.id))),
    performanceTracing: payload("performance-tracing/v2", gates.filter((gate) => ["G5", "G6", "G7"].includes(gate.id))),
  };
}
function validateOutputs(outputs) { for (const [key, value] of Object.entries(outputs)) { schema(key, value); assert(value.payloadSha256 === sha256(canonical(value, new Set(["payloadSha256"]))), "PAYLOAD_HASH_MISMATCH", key); } }
async function emit(outputs) {
  const stage = `${outputRoot}.tmp-${process.pid}`; await rm(stage, { recursive: true, force: true }); await mkdir(stage, { recursive: true });
  try { for (const [key, name] of Object.entries(outputFiles)) await writeFile(join(stage, name), `${canonical(outputs[key])}\n`); await mkdir(dirname(outputRoot), { recursive: true }); await rm(outputRoot, { recursive: true, force: true }); await rename(stage, outputRoot); } catch (error) { await rm(stage, { recursive: true, force: true }); throw error; }
}
async function checkOutputs(outputs) { for (const [key, name] of Object.entries(outputFiles)) { const actual = await json(join(outputRoot, name)).catch(() => fail("MISSING_GENERATED_OUTPUT", name)); assert(canonical(actual) === canonical(outputs[key]), "STALE_GENERATED_OUTPUT", name); } }
async function run() {
  assert(fixture || !writeFixtures, "USAGE", "--write-fixtures requires --fixtures");
  await validateDerivationFiles();
  if (process.argv.includes("--bootstrap-fixtures")) { assert(fixture, "USAGE", "--bootstrap-fixtures requires --fixtures"); await bootstrapFixtures(); }
  const reports = await readReports(); const outputs = build(reports); validateOutputs(outputs);
  if (check) await checkOutputs(outputs); else await emit(outputs);
  if (writeFixtures) await emit(outputs);
  console.log(`${fixture ? "Evidence fixtures" : "Evidence"} passed; summary sha256 ${outputs.summary.payloadSha256}.`);
}
await run();
