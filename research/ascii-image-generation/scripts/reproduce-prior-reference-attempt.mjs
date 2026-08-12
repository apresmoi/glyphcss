#!/usr/bin/env node
import { deriveReferenceTraceContract, disposeReferenceTrace } from "../src/referenceTrace.mjs";

const id = process.argv[2];
const options = id === "b7-unframed-public-80x24"
  ? { cameraFraming: "unframed", atlasSize: 64 }
  : id === "b40-bounds-fitted-atlas8"
    ? { cameraFraming: "bounds-fitted", atlasSize: 8 }
    : null;
if (!options) throw new Error("USAGE: reproduce-prior-reference-attempt.mjs b7-unframed-public-80x24|b40-bounds-fitted-atlas8");
const trace = await deriveReferenceTraceContract({ verify: false, enforceStructural: false, ...options });
try {
  const expected = trace.contract.priorFailedAttempts.find((attempt) => attempt.id === id);
  const actual = { id, ...trace.structural, ...trace.expected };
  if (!expected || expected.coverage !== actual.coverage || expected.newlyRevealedArea !== actual.newlyRevealedArea
    || expected.inputSha256 !== actual.inputSha256 || expected.frameSha256 !== actual.frameSha256 || expected.eventSha256 !== actual.eventSha256) {
    throw new Error(`PRIOR_REFERENCE_ATTEMPT_DRIFT:${JSON.stringify(actual)}`);
  }
  console.log(JSON.stringify(actual, null, 2));
} finally {
  await disposeReferenceTrace(trace);
}
