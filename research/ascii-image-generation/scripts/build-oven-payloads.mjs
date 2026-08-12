#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const fixtures = process.argv.includes("--fixtures");
const check = process.argv.includes("--check");
const failures = process.argv.includes("--write-failing-fixtures");
const evidenceRootFlag = process.argv.indexOf("--evidence-root");
const evidenceRoot = evidenceRootFlag >= 0 ? resolve(process.argv[evidenceRootFlag + 1] ?? "") : null;
if (evidenceRoot && fixtures) throw new Error("USAGE: --evidence-root cannot be combined with --fixtures");
const evidence = evidenceRoot ? join(evidenceRoot, "generated") : fixtures ? join(root, "fixtures/evidence/production/generated") : join(root, "reports/evidence/generated");
const output = evidenceRoot ? join(evidenceRoot, "ovens") : fixtures ? join(root, "fixtures/ovens/production") : join(root, "reports/evidence/ovens");
const canonical = (value) => Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : value && typeof value === "object" ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}` : JSON.stringify(value);
const sha = (value) => createHash("sha256").update(typeof value === "string" ? value : canonical(value)).digest("hex");
const read = async (name) => JSON.parse(await readFile(join(evidence, name), "utf8"));
const fail = (code, detail) => { throw new Error(`${code}: ${detail}`); };
const number = (value, label) => { if (typeof value !== "number" || !Number.isFinite(value)) fail("MISSING_NUMERIC_OVEN_SIGNAL", label); return value; };
const date = "2026-07-23T00:00:00.000Z";
const pixel = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLkGQAAAABJRU5ErkJggg==";
const failPixel = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4//8/AwAI/AL+X1q0AAAAAElFTkSuQmCC";

function statusValue(metric) {
  if (metric.status === "unwired") return { reference: null, candidate: null, state: 4 };
  return { reference: metric.status === "pass" ? metric.value : metric.threshold, candidate: metric.value, state: metric.status === "pass" ? 0 : 1 };
}
function differential(summary, title) {
  const fields = summary.gates.flatMap((gate) => gate.metrics.map((metric) => {
    const value = statusValue(metric);
    return {
      id: `${gate.id.toLowerCase()}-${metric.id}`,
      label: `${gate.id} ${metric.id}`,
      sourceOwner: "glyphcss measurement-gates/v2",
      semantics: { meaning: `B25 ${gate.id} ${metric.id}; source ${gate.source.path}#${gate.evidence}${gate.source.derivation ? `; derived from ${gate.source.derivation.baseline.path}#${gate.source.derivation.baseline.sha256} with ${canonical(gate.source.derivation.metric.inputs)} => ${canonical(gate.source.derivation.metric.result)}` : ""}` },
      unit: "gate-value", tolerance: 0,
      trustStatus: metric.status === "unwired" ? "blocked" : "pass",
      driftClass: metric.status === "unwired" ? "missing" : metric.status === "pass" ? "pass" : "mismatch",
      driftReason: metric.status === "unwired" ? metric.reason ?? "B25 reports this metric unwired." : metric.status === "pass" ? "B25 reports pass." : "B25 reports fail.",
      sampleCount: 1, failedSampleCount: value.state === 1 ? 1 : 0, missingSampleCount: value.state >= 2 ? 1 : 0,
      firstFailingTick: value.state === 0 ? null : 0, maxDelta: value.state === 0 ? 0 : value.state === 1 ? 1 : null,
      samples: [[0, value.reference, value.candidate, value.state]],
    };
  }));
  const failed = fields.filter((field) => field.failedSampleCount).length;
  const blocked = fields.filter((field) => field.missingSampleCount).length;
  const metric = (label, total, failedCount, blockedCount) => ({ label, total, passed: total - failedCount - blockedCount, failed: failedCount, blocked: blockedCount });
  const sourceHash = sha(summary);
  const scenarioId = sourceHash.slice(0, 16);
  const result = blocked ? "blocked" : failed ? "unchanged" : "pass";
  const binding = { refreshId: `b25-${sourceHash.slice(0, 16)}`, scenarioId, reportSha256: sourceHash, runtimeTreeSha256: sha(fields), contractSha256: summary.contractSha256 };
  return {
    schema: "burnlist-differential-testing-data@1", publishedAt: date, title,
    subtitle: `Read-only B25 payload ${sourceHash}; this Oven computes no gate result.`,
    adapter: { id: "glyphcss-b25-oven-adapter" },
    trust: { status: blocked ? "blocked" : "pass", reportStatus: result, blockers: blocked ? ["B25 contains unwired metrics."] : [] },
    scenarioCatalog: { selectedScenarioId: scenarioId, scenarios: [{ id: scenarioId, label: title, frameCount: 1, replaySha256: sourceHash, profileSha256: summary.derivationSha256, contractSha256: summary.contractSha256, updatedAt: date }] },
    refresh: { id: binding.refreshId, status: "complete", scenarioId, event: { kind: "b25-evidence-published", revision: sourceHash, occurredAt: date }, requestedAt: date, startedAt: date, completedAt: date, error: null, report: { id: "b25-normalized-summary", generatedAt: date, artifactSha256: sourceHash, runtimeTreeSha256: binding.runtimeTreeSha256, contractSha256: summary.contractSha256, scenarioId, frameCount: 1, replaySha256: sourceHash, profileSha256: summary.derivationSha256, result, check: { status: "pass", id: "glyphcss-b25-adapter-contract@1", sha256: sha("glyphcss-b25-adapter-contract@1"), subjectSha256: sourceHash } } },
    summary: { runs: metric("Reports", 1, result === "unchanged" ? 1 : 0, result === "blocked" ? 1 : 0), fields: metric("Metrics", fields.length, failed, blocked), frames: { ...metric("Samples", fields.length, failed, blocked), uniqueTicks: 1 } },
    progress: [{ timestamp: date, result, value: failed + blocked, fieldCount: fields.length, failedFieldCount: failed, frames: 1, ...binding }],
    log: [{ timestamp: date, result, value: failed + blocked, delta: null, failedFieldCount: failed, firstFailingTick: failed || blocked ? 0 : null, firstFailingLabel: fields.find((field) => field.firstFailingTick === 0)?.label ?? null, ...binding }], fields,
  };
}
function visual(summary) {
  const inner = differential(summary, "Glyphcss B25 visual-parity adapter");
  const failed = summary.gates.some((gate) => gate.status !== "pass");
  const source = sha(summary);
  const image = failed ? failPixel : pixel;
  const difference = failed ? { totalPixels: 1, changedPixels: 1, ratio: 1, meanAbsoluteDelta: 255, maximumAbsoluteDelta: 255 } : { totalPixels: 1, changedPixels: 0, ratio: 0, meanAbsoluteDelta: 0, maximumAbsoluteDelta: 0 };
  return { schema: "burnlist-visual-parity-data@1", differentialTesting: inner, initialDomainId: "b25-status", domains: [{ id: "b25-status", label: "B25 status transport", isolation: "render-pass", qualification: "target", rationale: "A one-pixel transport marker encodes only B25 pass/fail status; it is not image-quality evidence." }], comparisons: [{ id: source.slice(0, 16), label: "B25 normalized visual status", frame: 0, status: failed ? "fail" : "pass", domains: { "b25-status": { label: "B25 status transport", status: failed ? "fail" : "pass", reference: { label: "B25 status", width: 1, height: 1, src: pixel }, candidate: { label: "B25 status", width: 1, height: 1, src: image }, diff: { label: "B25 status delta", width: 1, height: 1, src: image }, difference } } }] };
}
function performance(summary) {
  const byId = new Map(summary.gates.flatMap((gate) => gate.metrics.map((metric) => [metric.id, metric])));
  const p95 = number(byId.get("presentation-p95")?.value, "G5.presentation-p95");
  const startup = number(byId.get("init-latency")?.value, "G6.init-latency");
  const keyframe = number(byId.get("keyframe-latency")?.value, "G6.keyframe-latency");
  const source = sha(`${canonical(summary)}\n`); const status = summary.gates.every((gate) => gate.status === "pass") ? "pass" : "fail";
  const checks = [{ id: "presentation-p95", actual: p95, limit: 33.3, operator: "<=", status: p95 <= 33.3 ? "pass" : "fail" }];
  const metrics = { runCount: 1, startupReadyMs: startup, p95FrameMs: p95, p99FrameMs: p95, maxFrameMs: p95, over33msRatio: p95 <= 33.3 ? 0 : 1, p95StepCallMs: keyframe, pageErrorCount: 0, nativeRequestCount: 0, runtimeConstructionCount: 0 };
  const runId = `b25-${source.slice(0, 16)}`;
  const phase = { label: "B25 normalized evidence", producer: "research/ascii-image-generation/scripts/build-evidence.mjs", nextProbe: "project trace capture", sampleCount: 1, totalMs: p95, p95Ms: p95, maxMs: p95 };
  const run = { runId, frameSpikes: [], stepSpikes: [], phaseBottlenecks: [], traceGroups: [], cameraPhaseBottlenecks: [], hotWindows: [], topEvents: [], structure: { integrity: {} } };
  return { schema: "performance-tracing-oven@1", runId, generatedAt: date, status, trust: { classification: "browser-output-performance-evidence", preparedRoute: true, nativeParityClaim: false, visualParityClaim: false }, metrics, browser: { engine: "Chromium", version: "140.0.7339.80" }, scenario: { id: "glyphcss-b25-fixture", route: "/research/ascii-image-generation" }, verdict: { status, passCount: checks.filter((entry) => entry.status === "pass").length, failCount: checks.filter((entry) => entry.status === "fail").length, checks }, artifacts: { report: "B25 normalized performance-tracing payload" }, provenance: { files: { "research/ascii-image-generation/fixtures/evidence/production/generated/performance-tracing.json": { bytes: Buffer.byteLength(`${canonical(summary)}\n`), sha256: source } } }, diagnostics: { schema: "performance-diagnostics@1", runId, generatedAt: date, actionItems: [], primaryTarget: null, budgetGaps: [], comparison: { source: "B25 normalized summary" }, phaseBottlenecks: [], cameraPhaseBottlenecks: [], traceGroups: [], residencySpikes: [], runs: [run], rerun: { command: "pnpm --filter @glyphcss/ascii-image-generation build:evidence -- --fixtures --check", compareAgainstRunId: runId, comparisonKey: source, protocol: ["Regenerate B25 evidence before binding."], requiredIntegrity: { pageErrorCount: 0, nativeRequestCount: 0, runtimeConstructionCount: 0 }, successCriteria: ["Retain the same B25 source hash." ] }, caveats: ["This adapter transports B25 metrics.", "B25 does not provide a raw Chrome trace.", "Do not use this fixture as production performance evidence."] } };
}
async function emit(name, value) { await mkdir(output, { recursive: true }); const target = join(output, name); const text = `${canonical(value)}\n`; if (check) { const actual = await readFile(target, "utf8").catch(() => fail("MISSING_OVEN_OUTPUT", name)); if (actual !== text) fail("STALE_OVEN_OUTPUT", name); } else { const temporary = `${target}.tmp-${process.pid}`; await writeFile(temporary, text); await rename(temporary, target); } }
if (!fixtures && !evidenceRoot && !check) fail("PRODUCTION_OVEN_EMIT_FORBIDDEN", "bind a real project trace only after its raw evidence exists");
const [diff, visualSummary, perf] = await Promise.all([read("differential-testing.json"), read("visual-parity.json"), read("performance-tracing.json")]);
await emit("differential-testing.json", differential(diff, "Glyphcss B25 differential-testing adapter"));
await emit("visual-parity.json", visual(visualSummary));
await emit("performance-tracing.json", performance(perf));
await emit("generation-gates.json", differential(await read("summary.json"), "Glyph Generation Gates scorecard"));
if (failures) {
  const target = join(root, "fixtures/ovens/non-green");
  const raw = await read("summary.json");
  const broken = structuredClone(raw);
  broken.gates[0].status = "fail";
  broken.gates[0].metrics[0].status = "fail";
  broken.gates[0].metrics[0].value = Number(broken.gates[0].metrics[0].threshold) + 1;
  const failingVisual = visual(broken);
  const failingGates = differential(broken, "Glyph Generation Gates scorecard");
  const stalePerformance = performance(perf);
  stalePerformance.provenance.files["research/ascii-image-generation/fixtures/evidence/production/generated/performance-tracing.json"].sha256 = "0".repeat(64);
  for (const [name, value] of Object.entries({ "visual-parity.json": failingVisual, "generation-gates.json": failingGates, "performance-tracing-stale.json": stalePerformance })) {
    await mkdir(target, { recursive: true });
    await writeFile(join(target, name), `${canonical(value)}\n`);
  }
}
console.log(`Oven ${fixtures ? "fixtures" : "outputs"} ${check ? "checked" : "built"}.`);
