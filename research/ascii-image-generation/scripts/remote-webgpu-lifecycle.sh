#!/usr/bin/env bash
set -euo pipefail

: "${GLYPHCSS_WEBGPU_RUN_DIR:?GLYPHCSS_WEBGPU_RUN_DIR is required}"
: "${GLYPHCSS_REFERENCE_CHROMIUM_ARCHIVE:?GLYPHCSS_REFERENCE_CHROMIUM_ARCHIVE is required}"
: "${GLYPHCSS_WEBGPU_SOURCE_ARCHIVE_SHA256:?GLYPHCSS_WEBGPU_SOURCE_ARCHIVE_SHA256 is required}"
: "${GLYPHCSS_WEBGPU_SOURCE_FILE_SET_SHA256:?GLYPHCSS_WEBGPU_SOURCE_FILE_SET_SHA256 is required}"
: "${GLYPHCSS_WEBGPU_IMAGE_ID:?GLYPHCSS_WEBGPU_IMAGE_ID is required}"
: "${GLYPHCSS_WEBGPU_PARITY_MANIFEST_SHA256:?GLYPHCSS_WEBGPU_PARITY_MANIFEST_SHA256 is required}"
: "${GLYPHCSS_WEBGPU_PARITY_RUN_ID:?GLYPHCSS_WEBGPU_PARITY_RUN_ID is required}"
run_dir="$GLYPHCSS_WEBGPU_RUN_DIR"
if [[ ! -d "$run_dir" ]] || [[ -n "$(find "$run_dir" -mindepth 1 -maxdepth 1 -print -quit)" ]]; then
  echo "WebGPU lifecycle run directory must exist and be empty" >&2
  exit 1
fi
echo "7184052e2155f270dd49503b1c9c7163204f3a7bc0fba9bd9e746dde04eb0546  $GLYPHCSS_REFERENCE_CHROMIUM_ARCHIVE" | sha256sum --check --strict
chrome_root="$(mktemp -d)"
trap 'rm -rf "$chrome_root"' EXIT
unzip -q "$GLYPHCSS_REFERENCE_CHROMIUM_ARCHIVE" -d "$chrome_root"
export GLYPHCSS_REFERENCE_CHROMIUM="$chrome_root/chrome-linux64/chrome"
"$GLYPHCSS_REFERENCE_CHROMIUM" --version | grep -Ex 'Google Chrome for Testing 140\.0\.7339\.80 *'
nvidia-smi --query-gpu=name,driver_version,memory.total,uuid --format=csv,noheader >"$run_dir/gpu.txt"
if ! pnpm --filter @glyphcss/ascii-image-generation test:browser -- '^reprojection-webgpu$' >"$run_dir/lifecycle-test.log" 2>&1; then
  cat "$run_dir/lifecycle-test.log"
  exit 1
fi
node --input-type=module - "$run_dir" <<'NODE'
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
const [runDir] = process.argv.slice(2);
const shaFile = async (name) => createHash("sha256").update(await readFile(`${runDir}/${name}`)).digest("hex");
const sourceArchiveSha256 = process.env.GLYPHCSS_WEBGPU_SOURCE_ARCHIVE_SHA256;
const sourceFileSetSha256 = process.env.GLYPHCSS_WEBGPU_SOURCE_FILE_SET_SHA256;
const imageId = process.env.GLYPHCSS_WEBGPU_IMAGE_ID;
const parityManifestSha256 = process.env.GLYPHCSS_WEBGPU_PARITY_MANIFEST_SHA256;
const parityRunId = process.env.GLYPHCSS_WEBGPU_PARITY_RUN_ID;
if (![sourceArchiveSha256, sourceFileSetSha256, parityManifestSha256].every((value) => /^[a-f0-9]{64}$/.test(value ?? "")) || !/^sha256:[a-f0-9]{64}$/.test(imageId ?? "")) throw new Error("WEBGPU_LIFECYCLE_PROVENANCE_INVALID");
const report = { schemaVersion: "glyph-webgpu-lifecycle-diagnostic/v1", diagnosticOnly: true, acceptance: false, browser: { version: "140.0.7339.80" }, test: { title: "reprojection-webgpu", passed: true }, parity: { runId: parityRunId, manifestSha256: parityManifestSha256 }, source: { archiveSha256: sourceArchiveSha256, fileSetSha256: sourceFileSetSha256, imageId }, hashes: { testLog: await shaFile("lifecycle-test.log"), gpu: await shaFile("gpu.txt") } };
const text = `${JSON.stringify(report, null, 2)}\n`;
const reportSha256 = createHash("sha256").update(text).digest("hex");
await writeFile(`${runDir}/lifecycle-report.json`, text);
await writeFile(`${runDir}/lifecycle-report.json.sha256`, `${reportSha256}  ${runDir}/lifecycle-report.json\n`);
await writeFile(`${runDir}/run-manifest.json`, `${JSON.stringify({ schemaVersion: "glyph-webgpu-lifecycle-run/v1", diagnosticOnly: true, acceptance: false, command: "pnpm --filter @glyphcss/ascii-image-generation test:browser -- '^reprojection-webgpu$'", reportSha256, ...report }, null, 2)}\n`);
NODE
