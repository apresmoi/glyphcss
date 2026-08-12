import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { sha256 as canonicalSha256 } from "./eval/admission.mjs";

const root = resolve(dirname(new URL(import.meta.url).pathname), "..");
const metricThresholdKey = Object.freeze({
  "visible-ascii-adherence": "visibleAsciiMismatch", "semantic-class-presence": "semanticClassMismatch",
  "dictionary-class-confusion": "dictionaryConfusion", "instance-surface-preservation": "instanceSurfaceMismatch",
  "depth-edge-agreement": "depthEdgeError", "unintended-additions": "unintendedAddition",
  "style-match": "styleDistance", "cross-view-identity": "crossViewIdentityMismatch",
  "reprojection-valid-error": "reprojectionValidError", "disocclusion-recovery": "disocclusionRecoveryError",
  "temporal-warp-error": "temporalWarpError", "correction-magnitude": "correctionMagnitude",
});
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const assert = (value, code) => { if (!value) throw new Error(code); };
let schemaValidator;

async function acceptanceSchema() {
  schemaValidator ??= readFile(join(root, "schema/pilot-target-admission.schema.json"), "utf8").then(JSON.parse).then((schema) => new Ajv2020({ strict: true, allErrors: true }).compile(schema));
  return schemaValidator;
}

export async function loadPilotB10Authority() {
  const [baselineText, contract] = await Promise.all([readFile(join(root, "reports/eval-baseline.json"), "utf8"), readFile(join(root, "config/measurement-gates.json"), "utf8").then(JSON.parse)]);
  const baseline = JSON.parse(baselineText);
  assert(baseline.passed === true && baseline.contractVersion === "v3", "PILOT_B10_BASELINE_INVALID");
  return Object.freeze({ baselineSha256: sha256(baselineText), contractSha256: canonicalSha256(contract), thresholds: Object.freeze({ ...baseline.numericThresholds }) });
}

export async function validatePilotB10Acceptance(acceptance, target, authority = null) {
  const resolvedAuthority = authority ?? await loadPilotB10Authority();
  const validate = await acceptanceSchema();
  assert(validate(acceptance), "PILOT_B10_ACCEPTANCE_SCHEMA_INVALID");
  assert(acceptance.targetId === target.targetId && acceptance.targetContentSha256 === target.contentSha256 && acceptance.targetImageSha256 === target.imageSha256, "PILOT_B10_TARGET_BINDING_MISMATCH");
  const b10 = acceptance.b10;
  assert(b10.contractSha256 === resolvedAuthority.contractSha256 && b10.baselineSha256 === resolvedAuthority.baselineSha256, "PILOT_B10_AUTHORITY_HASH_MISMATCH");
  for (const [metric, thresholdKey] of Object.entries(metricThresholdKey)) assert(Number.isFinite(b10.metrics[metric]) && b10.metrics[metric] <= resolvedAuthority.thresholds[thresholdKey], `PILOT_B10_REJECTED_${metric}`);
  return acceptance;
}
