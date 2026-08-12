#!/usr/bin/env bash
set -euo pipefail

context="${GLYPHCSS_GPU_DOCKER_CONTEXT:-gpu-4090}"
data_root="${GLYPHCSS_DATA_ROOT:-/mnt/docker-data/glyphcss-ascii-image-generation}"
run_id="${1:?run id required}"
if [[ ! "$run_id" =~ ^[a-z0-9][a-z0-9._-]{0,80}$ ]]; then
  echo "run id must be a lowercase slug (letters, digits, dot, underscore, dash; no slash)" >&2
  exit 2
fi
image="glyphcss-asset-semantic-parity-browser:${run_id}"
build_context="$(mktemp -d "${TMPDIR:-/tmp}/glyphcss-asset-semantic-parity.XXXXXX")"
cleanup() {
  if [[ "$build_context" == "${TMPDIR:-/tmp}"/glyphcss-asset-semantic-parity.* && -d "$build_context" ]]; then
    rm -rf "$build_context"
  fi
}
trap cleanup EXIT
tar --exclude='*/node_modules' --exclude='*/dist' --exclude='*/.astro' -cf - \
  package.json pnpm-lock.yaml pnpm-workspace.yaml packages research/ascii-image-generation website \
  | tar -xf - -C "$build_context"
docker --context "$context" build \
  --file "$build_context/research/ascii-image-generation/browser/Dockerfile.website" \
  --tag "$image" "$build_context"
image_id="$(docker --context "$context" image inspect --format '{{.Id}}' "$image")"
docker --context "$context" run --rm \
  --volume "$data_root:/artifacts" \
  --env "GLYPHCSS_ASSET_SEMANTIC_PARITY_RUN_DIR=/artifacts/asset-semantic-parity-browser/$run_id" \
  --env "GLYPHCSS_ASSET_SEMANTIC_PARITY_IMAGE_ID=$image_id" \
  --entrypoint bash \
  "$image" research/ascii-image-generation/scripts/remote-asset-semantic-parity-browser.sh
