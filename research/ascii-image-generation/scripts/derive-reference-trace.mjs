#!/usr/bin/env node
import { deriveReferenceTraceContract, disposeReferenceTrace } from "../src/referenceTrace.mjs";

const trace = await deriveReferenceTraceContract({ verify: false, enforceStructural: false });
try {
  console.log(JSON.stringify({ corpus: { configSha256: trace.contract.corpus.configSha256, manifestSha256: trace.manifest.contentSha256 }, expected: trace.expected, structural: trace.structural }, null, 2));
} finally {
  await disposeReferenceTrace(trace);
}
