#!/usr/bin/env bash
set -euo pipefail

: "${GLYPHCSS_REFERENCE_RUN_DIR:?GLYPHCSS_REFERENCE_RUN_DIR is required}"
: "${GLYPHCSS_REFERENCE_CHROMIUM_ARCHIVE:?GLYPHCSS_REFERENCE_CHROMIUM_ARCHIVE is required}"
: "${GLYPHCSS_REFERENCE_CONTRACT_SHA256:?GLYPHCSS_REFERENCE_CONTRACT_SHA256 is required}"
: "${GLYPHCSS_REFERENCE_EVENT_SHA256:?GLYPHCSS_REFERENCE_EVENT_SHA256 is required}"
: "${GLYPHCSS_MEASUREMENT_CONTRACT_SHA256:?GLYPHCSS_MEASUREMENT_CONTRACT_SHA256 is required}"
: "${GLYPHCSS_G5_SIGNATURE_SHA256:?GLYPHCSS_G5_SIGNATURE_SHA256 is required}"
: "${GLYPHCSS_REFERENCE_SOURCE_FILE_SET_SHA256:?GLYPHCSS_REFERENCE_SOURCE_FILE_SET_SHA256 is required}"
: "${GLYPHCSS_REFERENCE_SOURCE_ARCHIVE_SHA256:?GLYPHCSS_REFERENCE_SOURCE_ARCHIVE_SHA256 is required}"
: "${GLYPHCSS_REFERENCE_IMAGE_ID:?GLYPHCSS_REFERENCE_IMAGE_ID is required}"
: "${GLYPHCSS_REFERENCE_HOST_OS:?GLYPHCSS_REFERENCE_HOST_OS is required}"
run_dir="$GLYPHCSS_REFERENCE_RUN_DIR"
run_id="${run_dir##*/}"
node research/ascii-image-generation/scripts/validate-reference-run-id.mjs "$run_id" >/dev/null
if [[ "$run_dir" != "/artifacts/reference-browser/runs/$run_id" ]]; then
  echo "Reference run directory is outside the fixed artifact root: $run_dir" >&2
  exit 1
fi
trace_path="$run_dir/trace.json"
evidence_root="$run_dir/evidence"
if [[ -d "$run_dir" ]] && [[ -n "$(find "$run_dir" -mindepth 1 -maxdepth 1 ! -name preflight.json -print -quit)" ]]; then
  echo "Reference run directory is not empty; refusing stale evidence reuse: $run_dir" >&2
  exit 1
fi
mkdir -p "$run_dir"
printf '%s\n' '{"nodeOptions":"--max-old-space-size=16384","playwrightTimeoutMs":1800000}' >"$run_dir/execution-parameters.json"
echo "7184052e2155f270dd49503b1c9c7163204f3a7bc0fba9bd9e746dde04eb0546  $GLYPHCSS_REFERENCE_CHROMIUM_ARCHIVE" | sha256sum --check --strict
chrome_root="$(mktemp -d)"
unzip -q "$GLYPHCSS_REFERENCE_CHROMIUM_ARCHIVE" -d "$chrome_root"
export GLYPHCSS_REFERENCE_CHROMIUM="$chrome_root/chrome-linux64/chrome"
export GLYPHCSS_REFERENCE_OUTPUT="$trace_path"
"$GLYPHCSS_REFERENCE_CHROMIUM" --version | grep -Ex 'Google Chrome for Testing 140\.0\.7339\.80 *'
nvidia-smi --query-gpu=name,driver_version,memory.total,uuid --format=csv,noheader >"$run_dir/gpu.txt"
export GLYPHCSS_REFERENCE_GPU_IDENTITY="$run_dir/gpu.txt"
export GLYPHCSS_REFERENCE_ENVIRONMENT_MANIFEST="$run_dir/environment-manifest.json"
node --input-type=module - "$run_dir" <<'NODE'
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
const [runDir] = process.argv.slice(2);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const [model, driver, memory, uuid] = (await readFile(join(runDir, "gpu.txt"), "utf8")).trim().split(",").map((value) => value.trim());
const manifest = {
  schemaVersion: "glyph-reprojection-reference-environment/v1",
  runId: runDir.split("/").at(-1),
  image: { id: process.env.GLYPHCSS_REFERENCE_IMAGE_ID, base: "mcr.microsoft.com/playwright@sha256:6446946a1d9fd62d9ae501312a2d76a43ee688542b21622056a372959b65d63d" },
  source: { archiveSha256: process.env.GLYPHCSS_REFERENCE_SOURCE_ARCHIVE_SHA256, fileSetSha256: process.env.GLYPHCSS_REFERENCE_SOURCE_FILE_SET_SHA256 },
  software: { packageSha256: sha(await readFile("research/ascii-image-generation/package.json")), lockfileSha256: sha(await readFile("pnpm-lock.yaml")) },
  host: { os: process.env.GLYPHCSS_REFERENCE_HOST_OS, containerOsRelease: await readFile("/etc/os-release", "utf8") },
  gpu: { model, driver, memory, uuid },
};
await writeFile(join(runDir, "environment-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
NODE
vulkaninfo --summary >"$run_dir/vulkan-summary.txt" 2>&1 || true
if [[ "${GLYPHCSS_REFERENCE_HEADFUL:-0}" == "1" ]]; then
  Xvfb :99 -screen 0 1280x720x24 >"$run_dir/xvfb.log" 2>&1 &
  export DISPLAY=:99
  sleep 1
  glxinfo -B >"$run_dir/gl-renderer.txt" 2>&1 || true
fi

if ! pnpm --filter @glyphcss/ascii-image-generation test:browser -- reprojection-reference >"$run_dir/test.log" 2>&1; then
  node --input-type=module - "$run_dir" <<'NODE'
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
const [runDir] = process.argv.slice(2);
const bytes = await readFile(`${runDir}/test.log`);
const report = {
  schemaVersion: "glyph-reprojection-reference-blocked/v1",
  verdict: "blocked-no-g5-evidence",
  reason: "The exact Chromium reference test did not complete. Inspect the retained test log and any diagnostics before treating this run as evidence.",
  chromium: "140.0.7339.80",
  testLogSha256: createHash("sha256").update(bytes).digest("hex"),
  diagnostics: { webgpu: `${runDir}/trace.json.diagnostic.json`, vulkan: `${runDir}/vulkan-summary.txt` },
};
await writeFile(`${runDir}/blocked.json`, `${JSON.stringify(report, null, 2)}\n`);
NODE
  cat "$run_dir/test.log"
  exit 1
fi
node research/ascii-image-generation/scripts/prepare-reference-evidence.mjs "$trace_path" "$evidence_root"

node --input-type=module - "$run_dir" "$trace_path" "$evidence_root" <<'NODE'
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
const [runDir, tracePath, evidenceRoot] = process.argv.slice(2);
const sha = async (path) => createHash("sha256").update(await readFile(path)).digest("hex");
const osRelease = await readFile("/etc/os-release", "utf8");
const command = "pnpm --filter @glyphcss/ascii-image-generation test:browser -- reprojection-reference";
const referenceContractBytes = await readFile("research/ascii-image-generation/fixtures/reprojection/reference-trace-v1.json");
const referenceContract = JSON.parse(referenceContractBytes);
const referenceContractSha256 = createHash("sha256").update(referenceContractBytes).digest("hex");
if (referenceContractSha256 !== process.env.GLYPHCSS_REFERENCE_CONTRACT_SHA256 || referenceContract.expected.eventSha256 !== process.env.GLYPHCSS_REFERENCE_EVENT_SHA256) throw new Error("REFERENCE_LAUNCHER_CONTRACT_DRIFT");
const measurementContract = JSON.parse(await readFile("research/ascii-image-generation/config/measurement-gates.json", "utf8"));
const canonical = (value) => value === null || typeof value !== "object" ? JSON.stringify(value) : Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
const measurementContractSha256 = createHash("sha256").update(canonical(measurementContract)).digest("hex");
const g5SignatureSha256 = createHash("sha256").update(canonical(measurementContract.gates.find((gate) => gate.id === "G5"))).digest("hex");
if (measurementContractSha256 !== process.env.GLYPHCSS_MEASUREMENT_CONTRACT_SHA256 || g5SignatureSha256 !== process.env.GLYPHCSS_G5_SIGNATURE_SHA256) throw new Error("REFERENCE_G5_CONTRACT_DRIFT");
if (![process.env.GLYPHCSS_REFERENCE_SOURCE_FILE_SET_SHA256, process.env.GLYPHCSS_REFERENCE_SOURCE_ARCHIVE_SHA256].every((value) => /^[a-f0-9]{64}$/.test(value ?? ""))) throw new Error("REFERENCE_SOURCE_MANIFEST_INVALID");
const manifest = {
  schemaVersion: "glyph-reprojection-webgpu-benchmark-run/v2",
  command,
  image: { id: process.env.GLYPHCSS_REFERENCE_IMAGE_ID ?? null, base: "mcr.microsoft.com/playwright@sha256:6446946a1d9fd62d9ae501312a2d76a43ee688542b21622056a372959b65d63d", chromium: "140.0.7339.80", chromiumSha256: "7184052e2155f270dd49503b1c9c7163204f3a7bc0fba9bd9e746dde04eb0546" },
  source: { archiveSha256: process.env.GLYPHCSS_REFERENCE_SOURCE_ARCHIVE_SHA256, fileSetSha256: process.env.GLYPHCSS_REFERENCE_SOURCE_FILE_SET_SHA256 },
  host: { os: process.env.GLYPHCSS_REFERENCE_HOST_OS ?? null, containerOsRelease: osRelease, nvidiaSmi: (await readFile(join(runDir, "gpu.txt"), "utf8")).trim() },
  frozenTrace: { contract: "fixtures/reprojection/reference-trace-v1.json", contractSha256: referenceContractSha256, eventSha256: referenceContract.expected.eventSha256 },
  measurementContract: { path: "config/measurement-gates.json", version: measurementContract.contractVersion, sha256: measurementContractSha256, g5SignatureSha256 },
  benchmark: { session: "B47 GPU-resident atlas", oracle: "one untimed exact readback/checkpoint pass", timed: "40 × 326 persistent-canvas transitions; no readback, checkpoint, hash, full-state serialization, CPU reprojection, evidence digest, or pre text output" },
  hashes: { trace: await sha(tracePath), cdpProfile: await sha(`${tracePath}.cdp-profile.json`), environmentManifest: await sha(join(runDir, "environment-manifest.json")), gpuIdentity: await sha(join(runDir, "gpu.txt")), vulkanSummary: await sha(join(runDir, "vulkan-summary.txt")), partialEvidence: await sha(join(evidenceRoot, "reference-partial-evidence.json")), partialIntegrity: await sha(join(evidenceRoot, "reference-partial-integrity.json")), package: await sha("research/ascii-image-generation/package.json"), lockfile: await sha("pnpm-lock.yaml") },
};
await writeFile(join(runDir, "run-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
NODE

node --input-type=module - "$evidence_root" <<'NODE'
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
const [root] = process.argv.slice(2);
const artifactBytes = await readFile(join(root, "reference-partial-evidence.json"));
const artifact = JSON.parse(artifactBytes);
const integrity = JSON.parse(await readFile(join(root, "reference-partial-integrity.json"), "utf8"));
const actualSha256 = createHash("sha256").update(artifactBytes).digest("hex");
if (integrity.artifactSha256 !== actualSha256 || integrity.contractSha256 !== artifact.contract?.sha256 || integrity.eventSha256 !== artifact.contract?.eventSha256
  || integrity.resultChainSha256 !== artifact.contract?.resultChainSha256
  || integrity.measurementContractSha256 !== artifact.measurementContract?.sha256 || integrity.g5SignatureSha256 !== artifact.measurementContract?.g5SignatureSha256
  || integrity.environmentManifestSha256 !== artifact.provenance?.environmentManifestSha256 || integrity.runId !== artifact.provenance?.runId || integrity.imageId !== artifact.provenance?.imageId
  || integrity.sourceArchiveSha256 !== artifact.provenance?.sourceArchiveSha256 || integrity.sourceFileSetSha256 !== artifact.provenance?.sourceFileSetSha256
  || integrity.packageSha256 !== artifact.provenance?.packageSha256 || integrity.lockfileSha256 !== artifact.provenance?.lockfileSha256
  || integrity.driver !== artifact.provenance?.driver || integrity.gpuUuid !== artifact.provenance?.gpuUuid) {
  console.error("Reference partial-evidence integrity failed.");
  process.exit(1);
}
if (artifact.schemaVersion !== "glyph-reprojection-reference-partial-evidence/v1" || artifact.status !== "partial-non-pass" || artifact.fullG5Pass !== false) {
  console.error("Reference evidence attempted to masquerade as full G5.");
  process.exit(1);
}
if (artifact.latencyGate?.pass !== true || artifact.latencyGate?.actual > 33.3) {
  console.error(`Reference presentation p95 failed: ${JSON.stringify(artifact.latencyGate)}`);
  process.exit(1);
}
NODE
