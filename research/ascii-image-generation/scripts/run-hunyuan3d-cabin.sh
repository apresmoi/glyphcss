#!/usr/bin/env bash
# Run one image-conditioned cabin Paint attempt on the material-selected
# building mesh. Each container starts detached and its explicit SCRIPT_EXIT
# is verified before artifacts are copied back.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
repo_root="$(cd "$root/../.." && pwd)"
context="gpu-4090"
image="glyphcss-hunyuan3d:paint-v2-clean-cu124-r3"
run_prefix="glyph-hunyuan3d-paint-clean"
artifact_root="/mnt/docker-data/glyphcss-ascii-image-generation"
reference_source="${1:?usage: $0 TIGHT_RGBA_REFERENCE ATTEMPT_NAME}"
attempt="${2:?usage: $0 TIGHT_RGBA_REFERENCE ATTEMPT_NAME}"
safe_attempt="${attempt//[^a-zA-Z0-9_-]/-}"
remote_output="/artifacts/hunyuan3d/cabin/attempts/${safe_attempt}"
local_output="$root/review/hunyuan3d/cabin/attempts/${safe_attempt}"
log_dir="$local_output/logs"

[[ -f "$reference_source" ]] || { echo "Missing reference image: $reference_source" >&2; exit 2; }
[[ "$(python3 - "$reference_source" <<'PY'
from pathlib import Path
from PIL import Image
import sys
print(Image.open(Path(sys.argv[1])).mode)
PY
)" == "RGBA" ]] || {
  echo "Reference must be a prepared RGBA cabin-only image: $reference_source" >&2
  exit 2
}

mkdir -p "$local_output" "$log_dir" "$local_output/stages"
PYTHONDONTWRITEBYTECODE=1 python3 -B "$root/scripts/extract-cabin-object.py" \
  "$repo_root/website/public/examples/textured-house/cabin.obj" \
  "$local_output/cabin-building.obj"

wait_for_gpu() {
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
    used="${BASH_REMATCH[1]}"; total="${BASH_REMATCH[2]}"
    if (( used < 2000 )); then
      printf 'GPU_VRAM_READY:used=%sMiB,total=%sMiB\n' "$used" "$total"
      return
    fi
    printf 'GPU_VRAM_BUSY:used=%sMiB,total=%sMiB; waiting 30s\n' "$used" "$total"
    sleep 30
  done
}

# Do not rebuild the validated image.  Rebuilding changes the experiment and
# is not part of an image-conditioned reference comparison.
docker --context "$context" image inspect "$image" >/dev/null 2>&1 || {
  echo "HUNYUAN3D_IMAGE_MISSING:$image (refusing to rebuild)" >&2
  exit 1
}

staging="$(mktemp -d)"
trap 'rm -rf "$staging"' EXIT
mkdir -p "$staging/input"
cp "$local_output/cabin-building.obj" "$staging/input/cabin-building.obj"
cp "$reference_source" "$staging/input/reference.png"
cp "$root/docker/run_hunyuan_paint.py" "$staging/input/run_hunyuan_paint.py"

run_attempt() {
  local name="${run_prefix}-${safe_attempt}"
  local output="${remote_output}"
  local log="$log_dir/${name}.log"
  local args=(--stage cabin --output "$output" --subfolder hunyuan3d-paint-v2-0
    --mesh /work/input/cabin-building.obj --image /work/input/reference.png)

  wait_for_gpu
  if docker --context "$context" inspect "$name" >/dev/null 2>&1; then
    docker --context "$context" logs "$name" > "$log_dir/${name}-previous-$(date +%s).log" 2>&1 || true
    docker --context "$context" rm -f "$name" >/dev/null 2>&1 || true
  fi

  local command
  printf -v command 'set +e; python -B /work/input/run_hunyuan_paint.py'
  for arg in "${args[@]}"; do
    printf -v command '%s %q' "$command" "$arg"
  done
  printf -v command '%s; status=$?; printf "SCRIPT_EXIT=%%s\\n" "$status"; exit "$status"' "$command"

  local container
  container="$(docker --context "$context" create --gpus all --user 0:0 --shm-size=8g \
    --mount "type=bind,src=$artifact_root,dst=/artifacts" \
    --env "HF_HOME=/artifacts/cache/huggingface-hunyuan3d" \
    --env "HF_HUB_OFFLINE=1" --env "PYTHONDONTWRITEBYTECODE=1" \
    --env "HUNYUAN3D_PAINT_MODEL_PATH=/artifacts/cache/huggingface-hunyuan3d/hub/models--tencent--Hunyuan3D-2/snapshots/9cd649ba6913f7a852e3286bad86bfa9a2d83dcf" \
    --env "U2NET_HOME=/artifacts/cache/rembg" --env "NUMBA_DISABLE_JIT=1" \
    --env "PYTHONFAULTHANDLER=1" --env "PYTHONUNBUFFERED=1" \
    --name "$name" --entrypoint bash "$image" -lc "$command")"
  docker --context "$context" cp "$staging/input/." "$container:/work/input"
  docker --context "$context" start "$container" >/dev/null
  printf 'HUNYUAN3D_LAUNCHED:attempt=%s,name=%s,container=%s\n' "$safe_attempt" "$name" "$container"

  # Container execution remains detached; wait only observes its terminal
  # status and ensures the following stage cannot obscure this stage's result.
  docker --context "$context" wait "$name" >/dev/null || true
  docker --context "$context" logs "$name" > "$log" 2>&1 || true
  if ! grep -q '^SCRIPT_EXIT=0$' "$log"; then
    echo "HUNYUAN3D_ATTEMPT_FAILED:attempt=$safe_attempt; inspect $log" >&2
    grep 'SCRIPT_EXIT=' "$log" >&2 || true
    exit 1
  fi
  grep '^HUNYUAN_STAGE=' "$log" || true
  grep '^SCRIPT_EXIT=' "$log"

  # The Docker data mount is deliberately not SSH-visible to the login user;
  # copy through the same GPU Docker context that ran the stage instead.
  docker --context "$context" cp "$name:${output}/." "$local_output/"
}

run_attempt
printf 'HUNYUAN3D_COMPLETE:attempt=%s,reference=%s,outputs=%s\n' "$safe_attempt" "$reference_source" "$local_output"
