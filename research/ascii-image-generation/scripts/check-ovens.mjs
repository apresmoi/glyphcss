#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const repo = resolve(root, "../..");
const evidenceRootFlag = process.argv.indexOf("--evidence-root");
const evidenceRoot = evidenceRootFlag >= 0 ? resolve(process.argv[evidenceRootFlag + 1] ?? "") : null;
const canonical = (value) => Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : value && typeof value === "object" ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}` : JSON.stringify(value);
const sha = (value) => createHash("sha256").update(value).digest("hex");
const json = (path) => JSON.parse(readFileSync(path, "utf8"));
const at = (...parts) => resolve(root, ...parts);
const fail = (code, detail) => { throw new Error(`${code}: ${detail}`); };
const assert = (value, code, detail) => { if (!value) fail(code, detail); };
const run = (...args) => execFileSync("burnlist", args, { cwd: repo, encoding: "utf8" });
const set = (id, path) => run("oven", "set", id, path, "--repo", repo);

if (evidenceRoot) {
  execFileSync(process.execPath, [at("scripts/build-evidence.mjs"), "--evidence-root", evidenceRoot, "--check"], { cwd: root, stdio: "pipe" });
  execFileSync(process.execPath, [at("scripts/build-oven-payloads.mjs"), "--evidence-root", evidenceRoot, "--check"], { cwd: root, stdio: "pipe" });
  console.log(`Remote Oven payloads checked against ${evidenceRoot}.`);
  process.exit(0);
}

execFileSync(process.execPath, [at("scripts/build-evidence.mjs"), "--fixtures", "--check"], { cwd: root, stdio: "pipe" });
execFileSync(process.execPath, [at("scripts/build-oven-payloads.mjs"), "--fixtures", "--check"], { cwd: root, stdio: "pipe" });

const expected = json(at("fixtures/ovens/expected-ovens.json"));
const builtins = new Map(JSON.parse(run("oven", "list", "--json")).map((oven) => [oven.id, oven]));
for (const [id, expectedOven] of Object.entries(expected.builtIns)) {
  const oven = builtins.get(id);
  assert(oven?.builtIn === true, "BUILTIN_OVEN_MISSING", id);
  assert(oven.ovenRevision === expectedOven.revision && oven.version === expectedOven.version, "BUILTIN_OVEN_REVISION", id);
}
const custom = JSON.parse(run("oven", "view", expected.custom.id, "--json", "--repo", repo));
assert(custom.builtIn === false && custom.ovenRevision === expected.custom.revision, "CUSTOM_OVEN_REVISION", expected.custom.id);
assert(custom.oven === readFileSync(resolve(repo, expected.custom.source), "utf8"), "CUSTOM_OVEN_SOURCE", expected.custom.id);

const fixture = (name) => at("fixtures/ovens/production", name);
const bindings = json(resolve(repo, ".local/burnlist/bindings.json"));
const names = ["differential-testing", "visual-parity", "performance-tracing", "glyph-generation-gates"];
for (const name of names) {
  const expectedPath = `.local/burnlist/data/${name}.json`;
  assert(bindings.bindings?.[name]?.path === expectedPath, "OVEN_BINDING_PATH", name);
  const bound = json(resolve(repo, expectedPath));
  const source = json(fixture(name === "glyph-generation-gates" ? "generation-gates.json" : `${name}.json`));
  assert(canonical(bound) === canonical(source), "OVEN_BOUND_BYTES", name);
}
assert(Object.keys(bindings.bindings ?? {}).length === names.length, "UNEXPECTED_OVEN_BINDING", "exactly B26 Ovens are required");

const summaries = {
  "differential-testing": json(at("fixtures/evidence/production/generated/differential-testing.json")),
  "visual-parity": json(at("fixtures/evidence/production/generated/visual-parity.json")),
  "performance-tracing": json(at("fixtures/evidence/production/generated/performance-tracing.json")),
  "glyph-generation-gates": json(at("fixtures/evidence/production/generated/summary.json")),
};
for (const [id, summary] of Object.entries(summaries)) {
  const source = json(fixture(id === "glyph-generation-gates" ? "generation-gates.json" : `${id}.json`));
  const differential = id === "visual-parity" ? source.differentialTesting : id === "performance-tracing" ? null : source;
  if (differential) {
    assert(differential.scenarioCatalog.scenarios[0].replaySha256 === sha(canonical(summary)), "OVEN_SOURCE_HASH", id);
    const expectedMetrics = summary.gates.flatMap((gate) => gate.metrics.map((metric) => `${gate.id.toLowerCase()}-${metric.id}`));
    assert(canonical(differential.fields.map((field) => field.id).sort()) === canonical(expectedMetrics.sort()), "OVEN_METRIC_COVERAGE", id);
    for (const gate of summary.gates) for (const metric of gate.metrics) {
      const field = differential.fields.find((entry) => entry.id === `${gate.id.toLowerCase()}-${metric.id}`);
      const derivation = gate.source.derivation ? `; derived from ${gate.source.derivation.baseline.path}#${gate.source.derivation.baseline.sha256} with ${canonical(gate.source.derivation.metric.inputs)} => ${canonical(gate.source.derivation.metric.result)}` : "";
      assert(field?.semantics?.meaning === `B25 ${gate.id} ${metric.id}; source ${gate.source.path}#${gate.evidence}${derivation}`, "OVEN_SOURCE_LINK", `${id}:${metric.id}`);
      assert(field.samples[0][2] === metric.value, "OVEN_VALUE_INVENTED", `${id}:${metric.id}`);
    }
  }
}
const performance = json(fixture("performance-tracing.json"));
const performanceText = readFileSync(at("fixtures/evidence/production/generated/performance-tracing.json"), "utf8");
assert(performance.provenance.files["research/ascii-image-generation/fixtures/evidence/production/generated/performance-tracing.json"].sha256 === sha(performanceText), "PERFORMANCE_SOURCE_HASH", "B25 performance payload");
assert(performance.provenance.files["research/ascii-image-generation/fixtures/evidence/production/generated/performance-tracing.json"].bytes === Buffer.byteLength(performanceText), "PERFORMANCE_SOURCE_BYTES", "B25 performance payload");

for (const [id, path] of [["differential-testing", fixture("differential-testing.json")], ["visual-parity", fixture("visual-parity.json")], ["performance-tracing", fixture("performance-tracing.json")], ["glyph-generation-gates", fixture("generation-gates.json")]]) set(id, path);
run("differential-testing", "validate", fixture("differential-testing.json"));
run("differential-testing", "validate", fixture("generation-gates.json"));

set("visual-parity", at("fixtures/ovens/non-green/visual-parity.json"));
assert(json(resolve(repo, ".local/burnlist/data/visual-parity.json")).comparisons[0].status === "fail", "FAIL_FIXTURE_GREEN", "visual-parity");
set("glyph-generation-gates", at("fixtures/ovens/non-green/generation-gates.json"));
assert(json(resolve(repo, ".local/burnlist/data/glyph-generation-gates.json")).summary.fields.failed > 0, "FAIL_FIXTURE_GREEN", "glyph-generation-gates");
set("visual-parity", fixture("visual-parity.json"));
set("glyph-generation-gates", fixture("generation-gates.json"));
let staleRejected = false;
try { set("performance-tracing", at("fixtures/ovens/non-green/performance-tracing-stale.json")); } catch (error) { staleRejected = /stale/i.test(String(error?.stderr ?? error)); }
assert(staleRejected, "STALE_FIXTURE_ACCEPTED", "performance-tracing");
console.log("Oven bindings checked: 3 built-ins + glyph-generation-gates; stale/failing fixtures are non-green.");
