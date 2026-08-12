#!/usr/bin/env bash
set -euo pipefail

context="${GLYPHCSS_DOCKER_CONTEXT:-gpu-4090}"
data_root="${GLYPHCSS_ARTIFACT_ROOT:-/mnt/docker-data/glyphcss-ascii-image-generation}"
image="glyphcss-webgpu-parity:chromium-140.0.7339.80"
run_id="${GLYPHCSS_WEBGPU_PARITY_RUN_ID:-webgpu-parity-$(date -u +%Y%m%dT%H%M%SZ)}"
archive="$data_root/reference-browser/chrome-linux64-140.0.7339.80.zip"
run_dir="$data_root/reference-browser/runs/$run_id"
source_archive="$(mktemp "${TMPDIR:-/tmp}/glyphcss-webgpu-parity-source.XXXXXX.tgz")"
trap 'rm -f "$source_archive"' EXIT

docker --context "$context" run --rm --user root --entrypoint bash --volume "$data_root:/artifacts" mcr.microsoft.com/playwright@sha256:6446946a1d9fd62d9ae501312a2d76a43ee688542b21622056a372959b65d63d -lc 'install -d -m 0750 -o pwuser -g users /artifacts/reference-browser/runs'
if ! docker --context "$context" run --rm --entrypoint bash --volume "$data_root:/artifacts" mcr.microsoft.com/playwright@sha256:6446946a1d9fd62d9ae501312a2d76a43ee688542b21622056a372959b65d63d -lc 'test -f /artifacts/reference-browser/chrome-linux64-140.0.7339.80.zip && echo "7184052e2155f270dd49503b1c9c7163204f3a7bc0fba9bd9e746dde04eb0546  /artifacts/reference-browser/chrome-linux64-140.0.7339.80.zip" | sha256sum --check --strict'; then
  docker --context "$context" run --rm --user 1001:1001 --volume "$data_root:/artifacts" curlimages/curl:8.11.1 --fail --location --retry 3 --output "/artifacts/reference-browser/chrome-linux64-140.0.7339.80.zip" "https://storage.googleapis.com/chrome-for-testing-public/140.0.7339.80/linux64/chrome-linux64.zip"
fi
docker --context "$context" run --rm --user root --entrypoint bash --volume "$data_root:/artifacts" mcr.microsoft.com/playwright@sha256:6446946a1d9fd62d9ae501312a2d76a43ee688542b21622056a372959b65d63d -lc "test ! -e '/artifacts/reference-browser/runs/$run_id'; install -d -m 0750 -o pwuser -g users '/artifacts/reference-browser/runs/$run_id'"
source_file_set_sha256="$(find package.json pnpm-lock.yaml pnpm-workspace.yaml packages/core packages/glyphcss packages/compile research/ascii-image-generation -type f ! -path '*/node_modules/*' ! -path '*/dist/*' ! -path '*/coverage/*' -print | LC_ALL=C sort | while IFS= read -r file; do shasum -a 256 "$file"; done | shasum -a 256 | awk '{print $1}')"
tar -czf "$source_archive" --exclude='node_modules' --exclude='dist' --exclude='coverage' package.json pnpm-lock.yaml pnpm-workspace.yaml packages/core packages/glyphcss packages/compile research/ascii-image-generation
source_sha256="$(sha256sum "$source_archive" | awk '{print $1}')"
docker --context "$context" build --file research/ascii-image-generation/browser/Dockerfile.webgpu-parity --tag "$image" - <"$source_archive"
image_id="$(docker --context "$context" image inspect --format '{{.Id}}' "$image")"
render_group="$(docker --context "$context" run --rm --gpus all --entrypoint bash "$image_id" -lc 'stat -c %g /dev/dri/renderD*')"
docker --context "$context" run --rm --gpus all --ipc=host --group-add "$render_group" --volume "$data_root:/artifacts" --env NODE_OPTIONS=--max-old-space-size=16384 --env GLYPHCSS_REFERENCE_TIMEOUT_MS=1800000 --env GLYPHCSS_WEBGPU_PRESENTATION=1 --env GLYPHCSS_REFERENCE_HEADFUL=1 --env VULKAN_ICD_FILENAMES=/etc/vulkan/icd.d/nvidia_icd.json --env "GLYPHCSS_WEBGPU_RUN_DIR=/artifacts/reference-browser/runs/$run_id" --env "GLYPHCSS_WEBGPU_SOURCE_ARCHIVE_SHA256=$source_sha256" --env "GLYPHCSS_WEBGPU_SOURCE_FILE_SET_SHA256=$source_file_set_sha256" --env "GLYPHCSS_WEBGPU_IMAGE_ID=$image_id" --entrypoint bash "$image_id" -lc 'Xvfb :99 -screen 0 1280x720x24 -nolisten tcp >/tmp/glyph-webgpu-xvfb.log 2>&1 & xvfb_pid=$!; trap "kill $xvfb_pid" EXIT; for _ in {1..100}; do test -S /tmp/.X11-unix/X99 && break; sleep .1; done; test -S /tmp/.X11-unix/X99; DISPLAY=:99 bash research/ascii-image-generation/scripts/remote-webgpu-parity.sh'
printf 'WebGPU parity diagnostic: %s\n' "$run_dir"
