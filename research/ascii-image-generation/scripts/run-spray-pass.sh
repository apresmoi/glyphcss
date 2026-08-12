#!/usr/bin/env bash
# Launch the complete cabin spray pass detached in the gpu-4090 container.
# The cabin's controls are deliberately staged separately from the older
# 14-view imported-asset controls, so no subject can silently lose new views.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
context="gpu-4090"
image="glyphcss-ascii-trainer:b8"
expected_digest="sha256:015926d93d16a87eed48877405da596b4d3a6a799693cad6fa5072151b36b476"
artifact_root="/mnt/docker-data/glyphcss-ascii-image-generation"
container_repo_root="/workspace/repo"
output="${SPRAY_OUTPUT_ROOT:-/artifacts/spray-pass-cabin-atlas-4096-coarse-to-fine}"
name="${1:-glyph-spray-cabin-atlas-4096-coarse-to-fine}"
log_dir="$root/reports/glyph-scenes/cabin/logs"
controls_source="$root/reports/glyph-scenes/cabin"

# This must happen before any GPU container is created. Detail frames must
# actually receive a substantial repaintable mask, not the historic ~0.5%.
PYTHONDONTWRITEBYTECODE=1 python3 -B "$root/src/spray_pass.py" \
  --config "$root/config/spray-pass.json" \
  --controls-root "$controls_source/.." \
  --subject cabin --verify-repaintable

# A single SDXL worker needs about 10 GiB on this 16 GiB card.  This guard is
# intentionally inside the launcher: it must queue rather than race a busy GPU.
while :; do
  if ! memory="$(ssh -o ConnectTimeout=10 -o BatchMode=yes apresmoi@LeDeluge.fritz.box \
    'nvidia-smi --query-gpu=memory.used,memory.total --format=csv,noheader' 2>&1 | head -1 | tr -d '\r')"; then
    echo "GPU_VRAM_CHECK_FAILED:$memory" >&2
    exit 1
  fi
  [[ "$memory" =~ ^[[:space:]]*([0-9]+)[[:space:]]+MiB,[[:space:]]*([0-9]+)[[:space:]]+MiB[[:space:]]*$ ]] || {
    echo "GPU_VRAM_CHECK_FAILED:$memory" >&2
    exit 1
  }
  used="${BASH_REMATCH[1]}"
  total="${BASH_REMATCH[2]}"
  if (( used < 2000 )); then
    printf 'GPU_VRAM_READY:used=%sMiB,total=%sMiB\n' "$used" "$total"
    break
  fi
  printf 'GPU_VRAM_BUSY:used=%sMiB,total=%sMiB; waiting 30s\n' "$used" "$total"
  sleep 30
done

actual_digest="$(docker --context "$context" image inspect "$image" --format '{{.Id}}')"
[[ "$actual_digest" == "$expected_digest" ]] || {
  echo "SPRAY_PASS_CONTAINER_DIGEST:$actual_digest" >&2
  exit 1
}

mkdir -p "$log_dir"
if docker --context "$context" inspect "$name" >/dev/null 2>&1; then
  docker --context "$context" logs "$name" > "$log_dir/previous-$(date +%s).log" 2>&1 || true
  docker --context "$context" rm -f "$name" >/dev/null 2>&1 || true
fi

staging="$(mktemp -d)"
trap 'rm -rf "$staging"' EXIT
mkdir -p "$staging/research/ascii-image-generation"/{src,config,docker,reports/glyph-scenes} \
  "$staging/website/public/gallery/obj/opengameart/frog-guy"
cp "$root/src/spray_texture.py" "$root/src/spray_generate.py" "$root/src/spray_pass.py" \
  "$staging/research/ascii-image-generation/src/"
cp "$root/config/spray-pass.json" "$root/config/authored-cabin.json" "$staging/research/ascii-image-generation/config/"
cp "$root/docker/requirements.lock" "$staging/research/ascii-image-generation/docker/"
[[ -d "$controls_source/views/frames" ]] || { echo "SPRAY_PASS_CABIN_CONTROLS_MISSING:$controls_source" >&2; exit 1; }
cp -R "$controls_source" "$staging/research/ascii-image-generation/reports/glyph-scenes/cabin"

container="$(docker --context "$context" create --gpus all --user 0:0 --shm-size=8g \
  --mount "type=bind,src=$artifact_root,dst=/artifacts" \
  --env "GLYPH_IMAGE_DIGEST=$expected_digest" \
  --env "HF_HOME=/artifacts/cache/huggingface" \
  --env "HF_HUB_OFFLINE=1" \
  --env "HF_HUB_DISABLE_XET=1" \
  --env "PYTHONDONTWRITEBYTECODE=1" \
  --env "PYTHONFAULTHANDLER=1" \
  --env "PYTHONUNBUFFERED=1" \
  --name "$name" --entrypoint bash "$image" -lc \
  "set +e; python3 -B $container_repo_root/research/ascii-image-generation/src/spray_pass.py \\
    --config $container_repo_root/research/ascii-image-generation/config/spray-pass.json \\
    --controls-root $container_repo_root/research/ascii-image-generation/reports/glyph-scenes \\
    --output-root $output --subject cabin; status=\$?; printf 'SCRIPT_EXIT=%s\\n' \"\$status\"; exit \"\$status\"")"
docker --context "$context" cp "$staging/." "$container:$container_repo_root" >/dev/null
docker --context "$context" start "$container" >/dev/null
printf 'SPRAY_PASS_LAUNCHED:name=%s,container=%s,log=%s\n' "$name" "$container" "$log_dir/$name.log"
printf 'SPRAY_PASS_VERIFY: docker --context %s logs %s > %s 2>&1; grep SCRIPT_EXIT= %s\n' "$context" "$name" "$log_dir/$name.log" "$log_dir/$name.log"
