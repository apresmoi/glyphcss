import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export const canonical = (value) => Array.isArray(value)
  ? `[${value.map(canonical).join(",")}]`
  : value && typeof value === "object"
    ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`
    : JSON.stringify(value);
export const sha256 = (value) => createHash("sha256").update(
  typeof value === "string" || Buffer.isBuffer(value) ? value : canonical(value),
).digest("hex");
const mean = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
const mismatch = (left, right) => left.reduce((sum, value, index) => sum + (value !== right[index] ? 1 : 0), 0);
const edge = (depth) => depth.map((value, index) => index + 1 === depth.length || value === null || depth[index + 1] === null ? 0 : Math.abs(value - depth[index + 1]));
const rgbError = (left, right, mask = null) => {
  const errors = [];
  for (let cell = 0; cell < left.length / 3; cell++) if (!mask || mask[cell]) {
    errors.push((Math.abs(left[cell * 3] - right[cell * 3])
      + Math.abs(left[cell * 3 + 1] - right[cell * 3 + 1])
      + Math.abs(left[cell * 3 + 2] - right[cell * 3 + 2])) / 3);
  }
  return mean(errors);
};
const merged = (reference, patch) => ({ ...reference, ...patch });
const compact = (value) => value.replace(/\n/g, "");

function project(camera, worldPosition, coverage) {
  const matrix = camera.viewProjection;
  return coverage.map((covered, cell) => {
    if (!covered) return null;
    const x = worldPosition[cell * 3], y = worldPosition[cell * 3 + 1], z = worldPosition[cell * 3 + 2];
    const clip = [0, 1, 2, 3].map((row) => matrix[row] * x + matrix[row + 4] * y + matrix[row + 8] * z + matrix[row + 12]);
    const w = clip[3] || 1;
    return [clip[0] / w, clip[1] / w, clip[2] / w];
  });
}

function projectedGeometryError(reference, candidate) {
  const expected = project(reference.camera, reference.worldPosition, reference.coverage);
  const actual = project(candidate.camera, candidate.worldPosition, candidate.coverage);
  const pointErrors = [];
  for (let cell = 0; cell < expected.length; cell++) {
    if (!expected[cell] || !actual[cell]) continue;
    pointErrors.push(Math.hypot(
      expected[cell][0] - actual[cell][0],
      expected[cell][1] - actual[cell][1],
      expected[cell][2] - actual[cell][2],
    ));
  }
  const expectedDepth = expected.map((point) => point?.[2] ?? null);
  const actualDepth = actual.map((point) => point?.[2] ?? null);
  return mean(pointErrors) + mean(edge(expectedDepth).map((value, index) => Math.abs(value - edge(actualDepth)[index])));
}

function surfaceBleed(reference, candidate) {
  let crossings = 0;
  for (let cell = 0; cell < reference.coverage.length; cell++) {
    if (!reference.coverage[cell] || candidate.sampleSourceSurfaceId[cell] === -1) continue;
    if (candidate.sampleSourceSurfaceId[cell] !== candidate.surfaceId[cell]) crossings++;
  }
  return crossings;
}

function metrics(reference, candidate, dictionary) {
  let semantic = 0, confusion = 0;
  const referenceSemantic = compact(reference.semanticAscii), candidateSemantic = compact(candidate.semanticAscii);
  for (let cell = 0; cell < reference.coverage.length; cell++) {
    if (!reference.coverage[cell]) continue;
    semantic += candidateSemantic[cell] !== referenceSemantic[cell] ? 1 : 0;
    confusion += dictionary[candidateSemantic[cell]] !== reference.classId[cell] ? 1 : 0;
  }
  const valid = reference.reprojectionValid, disoccluded = reference.disocclusion;
  return {
    "visible-ascii-adherence": mismatch([...reference.visibleAscii], [...candidate.visibleAscii]),
    "semantic-class-presence": semantic,
    "dictionary-class-confusion": confusion,
    "instance-surface-preservation": mismatch(reference.instanceId, candidate.instanceId) + mismatch(reference.surfaceId, candidate.surfaceId),
    "depth-edge-agreement": projectedGeometryError(reference, candidate),
    "unintended-additions": candidate.coverage.reduce((sum, value, index) => sum + (value && !reference.coverage[index] ? 1 : 0), 0),
    "style-match": Math.hypot(...reference.style.map((value, index) => value - candidate.style[index])) / Math.sqrt(reference.style.length),
    "cross-view-identity": mismatch(reference.crossViewIds, candidate.crossViewIds) + (candidate.stateVersion === reference.stateVersion ? 0 : 1),
    "reprojection-valid-error": rgbError(reference.warpRgb, candidate.warpRgb, valid),
    "disocclusion-recovery": rgbError(reference.targetRgb, candidate.correctedRgb, disoccluded) + surfaceBleed(reference, candidate),
    "temporal-warp-error": rgbError(candidate.targetRgb, candidate.warpRgb, valid),
    "correction-magnitude": rgbError(candidate.correctedRgb, candidate.warpRgb),
  };
}

const thresholdKey = {
  "visible-ascii-adherence": "visibleAsciiMismatch",
  "semantic-class-presence": "semanticClassMismatch",
  "dictionary-class-confusion": "dictionaryConfusion",
  "instance-surface-preservation": "instanceSurfaceMismatch",
  "depth-edge-agreement": "depthEdgeError",
  "unintended-additions": "unintendedAddition",
  "style-match": "styleDistance",
  "cross-view-identity": "crossViewIdentityMismatch",
  "reprojection-valid-error": "reprojectionValidError",
  "disocclusion-recovery": "disocclusionRecoveryError",
  "temporal-warp-error": "temporalWarpError",
  "correction-magnitude": "correctionMagnitude",
};

export function evaluateAdmissionFixture(fixture) {
  const cases = fixture.cases.map((entry) => {
    const reference = merged(fixture.reference, entry.reference ?? {});
    const candidate = merged(reference, entry.candidate);
    const scored = metrics(reference, candidate, fixture.dictionary);
    const results = Object.fromEntries(Object.entries(scored).map(([id, value]) => [
      id,
      { value, threshold: fixture.thresholds[thresholdKey[id]], pass: value <= fixture.thresholds[thresholdKey[id]] },
    ]));
    const failed = Object.entries(results).filter(([, value]) => !value.pass).map(([id]) => id);
    const setupAssertions = entry.kind === "good"
      ? entry.id === "good-same-rgb-distinct-surfaces"
        ? [
            { id: "distinct-target-surfaces", pass: new Set(reference.surfaceId.filter((value) => value >= 0)).size > 1 },
            { id: "same-rgb-across-distinct-surfaces", pass: reference.targetRgb.slice(0, 3).every((value, index) => value === reference.targetRgb[index + 6]) },
            { id: "sample-lineage-stays-on-target-surface", pass: reference.sampleSourceSurfaceId.every((value, index) => value === -1 || value === reference.surfaceId[index]) },
          ]
        : [{ id: "good-has-no-candidate-delta", pass: Object.keys(entry.candidate).length === 0 }]
      : [
          { id: "candidate-differs-from-reference", pass: canonical(candidate) !== canonical(reference) },
          { id: "intended-metric-positive", pass: results[entry.expectedFailMetric]?.value > 0 },
          { id: "intended-branch-fails", pass: failed.includes(entry.expectedFailMetric) },
          ...(entry.id === "wrong-camera" ? [
            { id: "camera-matrix-differs", pass: canonical(candidate.camera.viewProjection) !== canonical(reference.camera.viewProjection) },
          ] : []),
          ...(entry.id === "cross-surface-bleed" ? [
            { id: "bleed-rgb-is-identical", pass: canonical(candidate.correctedRgb) === canonical(reference.correctedRgb) },
            { id: "bleed-source-surface-is-valid", pass: candidate.sampleSourceSurfaceId.some((value, index) => value !== -1 && value !== candidate.surfaceId[index] && reference.surfaceId.includes(value)) },
          ] : []),
        ];
    const setup = setupAssertions.every((assertion) => assertion.pass);
    return {
      id: entry.id,
      kind: entry.kind,
      expectedPass: entry.expectedPass ?? false,
      expectedFailMetric: entry.expectedFailMetric ?? null,
      setup,
      setupAssertions,
      failed,
      metrics: results,
      trace: {
        provenance: fixture.provenance,
        frames: [
          { id: `${entry.id}/source`, controls: reference },
          { id: `${entry.id}/candidate`, controls: candidate },
        ],
      },
    };
  });
  const good = cases.filter((entry) => entry.kind === "good");
  const bad = cases.filter((entry) => entry.kind === "adversarial");
  const passed = good.every((entry) => entry.setup && entry.failed.length === 0)
    && bad.every((entry) => entry.setup && entry.failed.includes(entry.expectedFailMetric));
  return {
    schemaVersion: "glyph-eval-baseline/v2",
    fixtureId: fixture.id,
    fixtureSha256: sha256(fixture),
    passed,
    cases,
    numericThresholds: fixture.thresholds,
  };
}

export function deriveAdmissionEvidence(baseline, baselineText) {
  const allCases = [...baseline.cases, ...baseline.provenanceCases];
  const good = allCases.filter((entry) => entry.kind === "good");
  const adversarial = allCases.filter((entry) => entry.kind === "adversarial");
  const setup = adversarial.filter((entry) => entry.setup);
  const intendedFailures = adversarial.filter((entry) => entry.failed.includes(entry.expectedFailMetric));
  const inputs = {
    goodFixtureCount: good.length,
    adversarialFixtureCount: adversarial.length,
    positiveSetupCount: setup.length,
    intendedFailureCount: intendedFailures.length,
    metricResultCount: allCases.reduce((sum, entry) => sum + Object.keys(entry.metrics).length, 0),
  };
  const result = {
    allGoodPassed: good.every((entry) => entry.failed.length === 0),
    allAdversarialSetupsPositive: setup.length === adversarial.length,
    allIntendedBranchesFailed: intendedFailures.length === adversarial.length,
  };
  const value = Number(Object.values(result).every(Boolean));
  return {
    baseline: { path: "reports/eval-baseline.json", sha256: sha256(baselineText) },
    metric: { id: "admission", inputs, result: { ...result, value } },
  };
}

export function validateAdmissionEvidence({ baseline, baselineText, artifact, report }) {
  const expected = deriveAdmissionEvidence(baseline, baselineText);
  if (canonical(artifact.derivation) !== canonical(expected) || canonical(report.derivation) !== canonical(expected)) throw new Error("G1_DERIVATION_MISMATCH");
  if (artifact.derivation.baseline.sha256 !== sha256(baselineText)) throw new Error("G1_BASELINE_HASH_MISMATCH");
  if (artifact.derivation.metric.result.value !== artifact.signals.admission.value || report.signals.admission.value !== artifact.signals.admission.value) throw new Error("G1_RESULT_SIGNAL_MISMATCH");
  return expected;
}

export function reconstructContractSnapshot(snapshot, current) {
  if (sha256(current) !== snapshot.baseContractSha256) throw new Error("V2_SNAPSHOT_BASE_DRIFT");
  const value = structuredClone(current);
  value.contractVersion = snapshot.contractVersion;
  for (const replacement of snapshot.replacements) {
    const gate = value.gates.find((entry) => entry.id === replacement.gateId);
    const index = gate.metrics.findIndex((entry) => entry.id === replacement.metric.id);
    if (index < 0) throw new Error(`V2_SNAPSHOT_METRIC_MISSING: ${replacement.metric.id}`);
    gate.metrics[index] = replacement.metric;
  }
  if (sha256(value) !== snapshot.contractSha256) throw new Error("V2_SNAPSHOT_HASH_MISMATCH");
  return value;
}

export async function loadAdmissionFixture(path) {
  return JSON.parse(await readFile(resolve(path), "utf8"));
}
