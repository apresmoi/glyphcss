#!/usr/bin/env bash
set -euo pipefail

context="${GLYPHCSS_GPU_DOCKER_CONTEXT:-gpu-4090}"
data_root="${GLYPHCSS_DATA_ROOT:-/mnt/docker-data/glyphcss-ascii-image-generation}"
run_id="${1:?run id required}"
if [[ ! "$run_id" =~ ^[a-z0-9][a-z0-9._-]{0,80}$ ]]; then
  echo "run id must be a lowercase slug (letters, digits, dot, underscore, dash; no slash)" >&2
  exit 2
fi
image="glyphcss-asset-render-binding-browser:${run_id}"
docker --context "$context" build --file research/ascii-image-generation/browser/Dockerfile.website --tag "$image" .
image_id="$(docker --context "$context" image inspect --format '{{.Id}}' "$image")"
docker --context "$context" run --rm \
  --volume "$data_root:/artifacts" \
  --env "GLYPHCSS_ASSET_BINDING_RUN_DIR=/artifacts/asset-render-binding-browser/$run_id" \
  --env "GLYPHCSS_ASSET_BINDING_IMAGE_ID=$image_id" \
  --entrypoint bash \
  "$image" research/ascii-image-generation/scripts/remote-asset-render-binding-browser.sh
