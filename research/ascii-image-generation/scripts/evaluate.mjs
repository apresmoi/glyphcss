#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  canonical,
  deriveAdmissionEvidence,
  evaluateAdmissionFixture,
  loadAdmissionFixture,
  reconstructContractSnapshot,
  sha256,
  validateAdmissionEvidence,
} from "../src/eval/admission.mjs";
import { evaluateB9Provenance } from "../src/eval/provenance.mjs";

const root = resolve(import.meta.dirname, "..");
const required = (flag) => {
  const index = process.argv.indexOf(flag);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`USAGE: ${flag} is required`);
  return process.argv[index + 1];
};
const json = async (path) => JSON.parse(await readFile(path, "utf8"));
const check = process.argv.includes("--check");
if (!process.argv.includes("--fixtures")) throw new Error("USAGE: only --fixtures is allowed before B11");

const fixture = await loadAdmissionFixture(resolve(root, "fixtures/eval/admission-v1.json"));
const contractPath = resolve(required("--contract"));
const contract = await json(contractPath);
const freeze = await json(resolve(root, "fixtures/eval/frozen-contract-v3.json"));
const snapshotPath = resolve(root, "fixtures/eval/measurement-gates-v2.snapshot.json");
const snapshot = await json(snapshotPath);
const v2 = reconstructContractSnapshot(snapshot, contract);
const g5 = contract.gates.find((gate) => gate.id === "G5");
const g5v2 = v2.gates.find((gate) => gate.id === "G5");
if (contract.contractVersion !== "v3"
  || freeze.contractVersion !== contract.contractVersion
  || freeze.contractSha256 !== sha256(contract)
  || freeze.g5Sha256 !== sha256(g5)
  || sha256(g5v2) !== sha256(g5)
  || !/^\d{4}-\d{2}-\d{2}$/.test(freeze.frozenAt)
  || !freeze.replacementPolicy.includes("new dated contract version")) throw new Error("B10_CONTRACT_FREEZE_DRIFT");

const changed = [];
function diff(left, right, path = "") {
  if (canonical(left) === canonical(right)) return;
  if (Array.isArray(left) && Array.isArray(right)) {
    for (let index = 0; index < Math.max(left.length, right.length); index++) diff(left[index], right[index], `${path}/${index}`);
    return;
  }
  if (left && right && typeof left === "object" && typeof right === "object") {
    for (const key of [...new Set([...Object.keys(left), ...Object.keys(right)])].sort()) diff(left[key], right[key], `${path}/${key}`);
    return;
  }
  changed.push({ path: path || "/", v2: left ?? null, v3: right ?? null });
}
diff(v2, contract);
const contractDiff = {
  schemaVersion: "measurement-gates-diff/v1",
  source: {
    v2: { path: "fixtures/eval/measurement-gates-v2.snapshot.json", snapshotSha256: sha256(await readFile(snapshotPath)), contractSha256: sha256(v2) },
    v3: { path: "config/measurement-gates.json", contractSha256: sha256(contract) },
  },
  changed,
  unchangedG5: { value: true, v2Sha256: sha256(g5v2), v3Sha256: sha256(g5) },
};
const diffText = `${canonical(contractDiff)}\n`;
if (freeze.v2SnapshotSha256 !== sha256(await readFile(snapshotPath)) || freeze.v2V3DiffSha256 !== sha256(diffText)) throw new Error("B10_CONTRACT_SNAPSHOT_BINDING_DRIFT");

const result = evaluateAdmissionFixture(fixture);
const provenanceCases = await evaluateB9Provenance();
if (!result.passed
  || !provenanceCases.filter((entry) => entry.kind === "good").every((entry) => entry.setup && entry.failed.length === 0)
  || !provenanceCases.filter((entry) => entry.kind === "adversarial").every((entry) => entry.setup && entry.failed.includes(entry.expectedFailMetric))) throw new Error("B10_ADMISSION_FIXTURE_FAILED");
const corpus = await json(resolve(root, fixture.provenance.corpusFixture));
if (!corpus.lineageValidated || !corpus.hasSwap || !corpus.hasReveal || !corpus.hasReset) throw new Error("B10_B7_CORPUS_PROVENANCE_FAILED");
for (const path of Object.values(fixture.provenance).filter((value) => typeof value === "string" && value !== fixture.provenance.corpusFixture)) await readFile(resolve(root, path), "utf8");
const reprojection = await json(resolve(root, fixture.provenance.reprojectionFixture));
if (createHash("sha256").update(Buffer.from(new Float32Array(reprojection.expectedWarpRgbNchw).buffer)).digest("hex") !== reprojection.expectedWarpRgbNchwSha256) throw new Error("B10_B24_REPROJECTION_PROVENANCE_FAILED");

const baseline = {
  ...result,
  provenanceCases,
  passed: result.passed && provenanceCases.every((entry) => entry.setup && (entry.kind === "good" ? entry.failed.length === 0 : entry.failed.includes(entry.expectedFailMetric))),
  contractVersion: contract.contractVersion,
  contractSha256: sha256(contract),
  contractDiffSha256: sha256(diffText),
  corpusFixtureSha256: sha256(corpus),
};
const baselineText = `${canonical(baseline)}\n`;
const derivation = deriveAdmissionEvidence(baseline, baselineText);
const signals = { admission: { value: derivation.metric.result.value } };
const hardware = contract.hardwareScope;
const artifact = {
  schemaVersion: "metric-source-artifact/v1",
  artifactVersion: "v1",
  gate: "G1",
  fixture: "B10 evaluated baseline; no hand-authored gate result",
  hardware,
  signals,
  derivation,
};
const artifactText = `${canonical(artifact)}\n`;
const report = {
  schemaVersion: "metric-report/v2",
  reportId: "raw/g1",
  contractSha256: sha256(contract),
  source: {
    kind: "differential",
    path: "reports/evidence/raw/artifacts/g1.json",
    sha256: sha256(artifactText),
  },
  hardware,
  signals,
  derivation,
};
report.rawSha256 = sha256(canonical(report));
const reportText = `${canonical(report)}\n`;
validateAdmissionEvidence({ baseline, baselineText, artifact, report });

const escape = (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const metricRows = (entry) => Object.entries(entry.metrics).map(([id, metric]) =>
  `<tr><td>${escape(id)}</td><td>${metric.value}</td><td>${metric.threshold}</td><td>${metric.pass}</td></tr>`).join("");
const section = (entry) => `<section id="${escape(entry.id)}"><h2>${escape(entry.id)}</h2><dl><dt>kind</dt><dd>${entry.kind}</dd><dt>intended branch</dt><dd>${escape(entry.expectedFailMetric ?? "all-pass")}</dd><dt>setup</dt><dd>${entry.setup}</dd></dl><h3>Setup assertions</h3><pre>${escape(JSON.stringify(entry.setupAssertions, null, 2))}</pre><h3>Per-frame source/candidate controls and lineage</h3><pre>${escape(JSON.stringify(entry.trace, null, 2))}</pre><h3>Per-frame metrics</h3><table><thead><tr><th>metric</th><th>value</th><th>threshold</th><th>pass</th></tr></thead><tbody>${metricRows(entry)}</tbody></table></section>`;
const allCases = [...baseline.cases, ...baseline.provenanceCases];
const contactSheet = `<!doctype html><html><head><meta charset="utf-8"><title>Glyph admission complete traces</title><style>body{font:14px system-ui;max-width:1100px;margin:auto;padding:24px}section{border-top:2px solid #222;padding:16px 0}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f3f3f3;padding:12px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #aaa;padding:5px;text-align:left}</style></head><body><h1>Glyph admission complete traces</h1><p>Baseline ${derivation.baseline.sha256}; contract ${baseline.contractSha256}; B7/B9/B24 provenance and every source/candidate frame are shown below.</p>${allCases.map(section).join("")}</body></html>`;

const outputs = [
  [resolve(root, "reports/eval-baseline.json"), baselineText],
  [resolve(root, "reports/eval-contact-sheet.html"), contactSheet],
  [resolve(root, "reports/measurement-gates-v2-v3-diff.json"), diffText],
  [resolve(root, "fixtures/evidence/production/raw/artifacts/g1.json"), artifactText],
  [resolve(root, "fixtures/evidence/production/raw/g1.json"), reportText],
];
for (const [path, text] of outputs) {
  const actual = await readFile(path, "utf8").catch(() => null);
  if (check) {
    if (actual !== text) throw new Error(`STALE_B10_OUTPUT: ${path}`);
  } else {
    await writeFile(path, text);
  }
}
if (check) {
  execFileSync(process.execPath, [resolve(root, "scripts/build-evidence.mjs"), "--fixtures", "--check"], { cwd: root, stdio: "pipe" });
  execFileSync(process.execPath, [resolve(root, "scripts/build-oven-payloads.mjs"), "--fixtures", "--check"], { cwd: root, stdio: "pipe" });
} else {
  execFileSync(process.execPath, [resolve(root, "scripts/build-evidence.mjs"), "--fixtures"], { cwd: root, stdio: "pipe" });
  execFileSync(process.execPath, [resolve(root, "scripts/build-oven-payloads.mjs"), "--fixtures"], { cwd: root, stdio: "pipe" });
}
console.log(`B10 admission evaluation passed; ${allCases.length} complete traces; baseline sha256 ${derivation.baseline.sha256}.`);
