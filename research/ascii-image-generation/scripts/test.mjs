import { spawnSync } from "node:child_process";

const requested = process.argv.slice(2).filter((value) => value !== "--");
const routes = new Map([
  ["targets", "tests/targets.test.ts"],
  ["pilot-billing", "tests/pilot-billing.test.ts"],
  ["eval", "tests/eval-admission.test.ts"],
  ["reference-corpus-framing", "probes/reference-corpus-framing.test.ts"],
  ["reference-trace-contract", "probes/reference-trace-contract.test.ts"],
  ["reference-partial-evidence", "probes/reference-partial-evidence.test.ts"],
  ["reference-signals", "probes/reference-signals.test.ts"],
  ["reference-prior-attempts", "probes/reference-prior-attempts.test.ts"],
  ["reference-lifecycle", "probes/reference-lifecycle.test.ts"],
  ["website-generative", "tests/website-generative.test.ts"],
  ["asset-registry", "tests/asset-registry.test.ts"],
  ["asset-taxonomy", "tests/asset-taxonomy.test.ts"],
  ["asset-semantic-parity", "tests/asset-semantic-parity-run.test.ts"],
  ["rendered-target-admission", "tests/rendered-target-admission.test.ts"],
  ["native-pilot", "tests/native-pilot.test.ts"],
]);
const files = [...new Set(requested.map((name) => routes.get(name)).filter(Boolean))];
const result = spawnSync("vitest", ["run", ...files], { stdio: "inherit", shell: process.platform === "win32" });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
