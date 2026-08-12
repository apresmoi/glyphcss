#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
context="gpu-4090"
image="glyphcss-ascii-trainer:b8"
expected_digest="sha256:015926d93d16a87eed48877405da596b4d3a6a799693cad6fa5072151b36b476"
artifact_root="/mnt/docker-data/glyphcss-ascii-image-generation"
output="$artifact_root/coarse-b57/native-teacher/capture-v1"
actual_digest="$(docker --context "$context" image inspect "$image" --format '{{.Id}}')"
[[ "$actual_digest" == "$expected_digest" ]] || {
  echo "B57_NATIVE_TEACHER_CONTAINER_DIGEST:$actual_digest" >&2
  exit 1
}

staging="$(mktemp -d)"
container=""
cleanup() {
  [[ -z "$container" ]] || docker --context "$context" rm -f "$container" >/dev/null 2>&1 || true
  rm -rf "$staging"
}
trap cleanup EXIT
mkdir -p "$staging/research/ascii-image-generation/src"
mkdir -p "$staging/research/ascii-image-generation/config"
mkdir -p "$staging/research/ascii-image-generation/reports"
mkdir -p "$staging/research/ascii-image-generation/fixtures/coarse/native-teacher-control"
cp "$root/src/capture_native_teacher_latents.py" "$staging/research/ascii-image-generation/src/"
cp "$root/config/native-reference-model.json" "$staging/research/ascii-image-generation/config/"
cp "$root/reports/native-reference-model-preflight.json" "$staging/research/ascii-image-generation/reports/"
cp "$root/fixtures/coarse/native-teacher-control/"* "$staging/research/ascii-image-generation/fixtures/coarse/native-teacher-control/"

container="$(docker --context "$context" create --gpus all --user 0:0 \
  --mount "type=bind,src=$artifact_root,dst=/artifacts" \
  --env "GLYPH_IMAGE_DIGEST=$expected_digest" \
  --entrypoint bash "$image" -lc \
  "python3 /workspace/research/ascii-image-generation/src/capture_native_teacher_latents.py \
    --model-root /artifacts/models/native-reference/sdxl-base-1.0/462165984030d82259a11f4367a4eed129e94a7b \
    --control-root /artifacts/models/native-reference/controlnet-depth-sdxl-1.0/17bb97973f29801224cd66f192c5ffacf82648b4 \
    --preflight /workspace/research/ascii-image-generation/reports/native-reference-model-preflight.json \
    --native-config /workspace/research/ascii-image-generation/config/native-reference-model.json \
    --control-manifest /workspace/research/ascii-image-generation/fixtures/coarse/native-teacher-control/manifest.json \
    --output /artifacts/coarse-b57/native-teacher/capture-v1")"
docker --context "$context" cp "$staging/." "$container:/workspace"
docker --context "$context" start --attach "$container"
mkdir -p "$root/review/coarse-teacher-native"
docker --context "$context" cp "$container:/artifacts/coarse-b57/native-teacher/capture-v1/manifest.json" "$root/reports/coarse-native-teacher.json"
for branch in 00 01 02; do
  docker --context "$context" cp "$container:/artifacts/coarse-b57/native-teacher/capture-v1/branch-$branch.png" "$root/review/coarse-teacher-native/branch-$branch.png"
done
printf 'B57_NATIVE_TEACHER_CAPTURE:%s\n' "$output"
