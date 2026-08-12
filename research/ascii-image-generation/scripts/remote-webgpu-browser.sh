#!/usr/bin/env bash
set -euo pipefail

# Diagnostic-only B47 runner. It intentionally has no B37 evidence adapter,
# measurement contract, or G5 acceptance path.
: "${GLYPHCSS_WEBGPU_RUN_DIR:?GLYPHCSS_WEBGPU_RUN_DIR is required}"
: "${GLYPHCSS_REFERENCE_CHROMIUM_ARCHIVE:?pinned Chrome archive is required}"
run_dir="$GLYPHCSS_WEBGPU_RUN_DIR"
mkdir -p "$run_dir"
if [[ -n "$(find "$run_dir" -mindepth 1 -maxdepth 1 -print -quit)" ]]; then
  echo "WebGPU diagnostic directory is not empty" >&2
  exit 1
fi
echo "7184052e2155f270dd49503b1c9c7163204f3a7bc0fba9bd9e746dde04eb0546  $GLYPHCSS_REFERENCE_CHROMIUM_ARCHIVE" | sha256sum --check --strict
chrome_root="$(mktemp -d)"
trap 'rm -rf "$chrome_root"' EXIT
unzip -q "$GLYPHCSS_REFERENCE_CHROMIUM_ARCHIVE" -d "$chrome_root"
export GLYPHCSS_REFERENCE_CHROMIUM="$chrome_root/chrome-linux64/chrome"
"$GLYPHCSS_REFERENCE_CHROMIUM" --version | grep -Ex 'Google Chrome for Testing 140\.0\.7339\.80 *'
nvidia-smi --query-gpu=name,driver_version,memory.total --format=csv,noheader >"$run_dir/gpu.txt"
if pnpm --filter @glyphcss/ascii-image-generation test:browser -- reprojection-webgpu >"$run_dir/test.log" 2>&1; then
  node --input-type=module - "$run_dir" <<'NODE'
import { createHash } from "node:crypto"; import { readFile, writeFile } from "node:fs/promises";
const [dir] = process.argv.slice(2); const sha = async (name) => createHash("sha256").update(await readFile(`${dir}/${name}`)).digest("hex");
await writeFile(`${dir}/report.json`, `${JSON.stringify({ schemaVersion: "glyph-webgpu-parity-diagnostic/v1", acceptance: false, browser: "140.0.7339.80", testLogSha256: await sha("test.log"), gpuSha256: await sha("gpu.txt"), note: "Diagnostic-only B47 runner; never B37/G5 evidence." }, null, 2)}\n`);
NODE
else
  cat "$run_dir/test.log"; exit 1
fi
