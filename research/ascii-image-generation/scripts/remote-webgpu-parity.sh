#!/usr/bin/env bash
set -euo pipefail

: "${GLYPHCSS_WEBGPU_RUN_DIR:?GLYPHCSS_WEBGPU_RUN_DIR is required}"
: "${GLYPHCSS_REFERENCE_CHROMIUM_ARCHIVE:?GLYPHCSS_REFERENCE_CHROMIUM_ARCHIVE is required}"
: "${GLYPHCSS_WEBGPU_SOURCE_ARCHIVE_SHA256:?GLYPHCSS_WEBGPU_SOURCE_ARCHIVE_SHA256 is required}"
: "${GLYPHCSS_WEBGPU_SOURCE_FILE_SET_SHA256:?GLYPHCSS_WEBGPU_SOURCE_FILE_SET_SHA256 is required}"
: "${GLYPHCSS_WEBGPU_IMAGE_ID:?GLYPHCSS_WEBGPU_IMAGE_ID is required}"
run_dir="$GLYPHCSS_WEBGPU_RUN_DIR"
if [[ ! -d "$run_dir" ]] || [[ -n "$(find "$run_dir" -mindepth 1 -maxdepth 1 -print -quit)" ]]; then
  echo "WebGPU parity run directory must exist and be empty" >&2
  exit 1
fi
echo "7184052e2155f270dd49503b1c9c7163204f3a7bc0fba9bd9e746dde04eb0546  $GLYPHCSS_REFERENCE_CHROMIUM_ARCHIVE" | sha256sum --check --strict
chrome_root="$(mktemp -d)"
trap 'rm -rf "$chrome_root"' EXIT
unzip -q "$GLYPHCSS_REFERENCE_CHROMIUM_ARCHIVE" -d "$chrome_root"
export GLYPHCSS_REFERENCE_CHROMIUM="$chrome_root/chrome-linux64/chrome"
export GLYPHCSS_WEBGPU_PARITY_OUTPUT="$run_dir/parity-report.json"
"$GLYPHCSS_REFERENCE_CHROMIUM" --version | grep -Ex 'Google Chrome for Testing 140\.0\.7339\.80 *'
nvidia-smi --query-gpu=name,driver_version,memory.total,uuid --format=csv,noheader >"$run_dir/gpu.txt"
if ! pnpm --filter @glyphcss/ascii-image-generation test:browser -- reprojection-webgpu-parity >"$run_dir/test.log" 2>&1; then
  node --input-type=module - "$run_dir" <<'NODE'
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
const [runDir] = process.argv.slice(2);
const testLog = await readFile(`${runDir}/test.log`);
await writeFile(`${runDir}/blocked.json`, `${JSON.stringify({ schemaVersion: "glyph-webgpu-parity-blocked/v1", diagnosticOnly: true, acceptance: false, reason: "Remote WebGPU parity test failed before a complete diagnostic report.", testLogSha256: createHash("sha256").update(testLog).digest("hex") }, null, 2)}\n`);
NODE
  cat "$run_dir/test.log"
  exit 1
fi
node --input-type=module - "$run_dir" <<'NODE'
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
const [runDir] = process.argv.slice(2);
const reportPath = `${runDir}/parity-report.json`;
const report = JSON.parse(await readFile(reportPath, "utf8"));
const reportBytes = await readFile(reportPath);
const reportSha256 = createHash("sha256").update(reportBytes).digest("hex");
const sidecar = await readFile(`${reportPath}.sha256`, "utf8");
if (sidecar !== `${reportSha256}  ${reportPath}\n`) throw new Error("WEBGPU_PARITY_REPORT_HASH_MISMATCH");
if (report.schemaVersion !== "glyph-webgpu-parity-diagnostic/v2" || report.diagnosticOnly !== true || report.acceptance !== false
  || report.browser?.version !== "140.0.7339.80" || report.frozenTrace?.transitions !== 326 || report.frozenTrace?.atlasSize !== 64
  || report.frozenTrace?.resultChainSha256 !== "a804bbdb657fb2d66b263c7681ef2ade4688674070d3c491d9ba2fd2b6ff6297"
  || report.frozenTrace?.matchedEveryTransition !== true || report.checkpoints?.count !== 326
  || report.webgpu?.isFallbackAdapter !== false || report.webgpuErrors?.validation?.length !== 0 || report.webgpuErrors?.uncaptured?.length !== 0 || report.webgpuErrors?.deviceLoss?.length !== 0
  || report.cleanup?.readbackRejectedAfterDestroy !== true || report.cleanup?.checkpointRejectedAfterDestroy !== true || report.cleanup?.presentationRejectedAfterDestroy !== true
  || report.canvas?.screenshotMismatchesAboveTolerance !== 0 || report.canvas?.screenshotTolerance !== 1) throw new Error("WEBGPU_PARITY_REPORT_CONTRACT_MISMATCH");
const testLog = await readFile(`${runDir}/test.log`), gpu = await readFile(`${runDir}/gpu.txt`);
const sourceArchiveSha256 = process.env.GLYPHCSS_WEBGPU_SOURCE_ARCHIVE_SHA256;
const sourceFileSetSha256 = process.env.GLYPHCSS_WEBGPU_SOURCE_FILE_SET_SHA256;
const imageId = process.env.GLYPHCSS_WEBGPU_IMAGE_ID;
if (!/^[a-f0-9]{64}$/.test(sourceArchiveSha256 ?? "") || !/^[a-f0-9]{64}$/.test(sourceFileSetSha256 ?? "") || !/^sha256:[a-f0-9]{64}$/.test(imageId ?? "")) throw new Error("WEBGPU_PARITY_SOURCE_PROVENANCE_INVALID");
const manifest = { schemaVersion: "glyph-webgpu-parity-run/v1", diagnosticOnly: true, acceptance: false, command: "pnpm --filter @glyphcss/ascii-image-generation test:browser -- reprojection-webgpu-parity", chromium: { version: "140.0.7339.80", archiveSha256: "7184052e2155f270dd49503b1c9c7163204f3a7bc0fba9bd9e746dde04eb0546" }, source: { archiveSha256: sourceArchiveSha256, fileSetSha256: sourceFileSetSha256, imageId }, hashes: { report: reportSha256, testLog: createHash("sha256").update(testLog).digest("hex"), gpu: createHash("sha256").update(gpu).digest("hex") } };
await writeFile(`${runDir}/run-manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
NODE
