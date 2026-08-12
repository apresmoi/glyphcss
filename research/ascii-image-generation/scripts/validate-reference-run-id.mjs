#!/usr/bin/env node

const [runId] = process.argv.slice(2);
if (typeof runId !== "string" || !/^(?=.{2,80}$)[a-z0-9][a-z0-9._-]*[a-z0-9]$/.test(runId)) {
  throw new Error("REFERENCE_RUN_ID_INVALID: use 2-80 lowercase ASCII letters, digits, dots, underscores, or hyphens, with an alphanumeric first and last character");
}
process.stdout.write(runId);
