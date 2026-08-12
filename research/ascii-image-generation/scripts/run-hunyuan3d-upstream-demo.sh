#!/usr/bin/env bash
# Execute Tencent Hunyuan3D-2's minimal_demo.py unchanged, in the validated
# CUDA 12.4 image.  This launcher intentionally contains no model or texture
# pipeline code: the Python process is upstream's file at /opt/hunyuan3d.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
context="gpu-4090"
image="glyphcss-hunyuan3d:paint-v2-clean-cu124-r3"
name="glyph-hunyuan3d-upstream-demo"
artifact_root="/mnt/docker-data/glyphcss-ascii-image-generation"
remote_output="/artifacts/hunyuan3d/vanilla/upstream-demo"
local_output="$root/review/hunyuan3d/upstream-demo"
log="$local_output/upstream-demo.log"

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
    used="${BASH_REMATCH[1]}"
    total="${BASH_REMATCH[2]}"
    if (( used < 2000 )); then
      printf 'GPU_VRAM_READY:used=%sMiB,total=%sMiB\n' "$used" "$total"
      return
    fi
    printf 'GPU_VRAM_BUSY:used=%sMiB,total=%sMiB; waiting 30s\n' "$used" "$total"
    sleep 30
  done
}

docker --context "$context" image inspect "$image" >/dev/null
mkdir -p "$local_output"
wait_for_gpu

if docker --context "$context" inspect "$name" >/dev/null 2>&1; then
  docker --context "$context" rm -f "$name" >/dev/null
fi

# Run upstream's own file from its own working directory: its relative
# assets/demo.png and its demo.glb output therefore retain their documented
# paths exactly.
command="set +e; cd /opt/hunyuan3d; python -B minimal_demo.py; status=\$?; if [ \$status -eq 0 ]; then mkdir -p '$remote_output'; cp demo.glb '$remote_output/demo.glb'; fi; printf 'SCRIPT_EXIT=%s\\n' \"\$status\"; exit \"\$status\""
container="$(docker --context "$context" create --gpus all --user 0:0 --shm-size=8g \
  --mount "type=bind,src=$artifact_root,dst=/artifacts" \
  --env "HF_HOME=/artifacts/cache/huggingface-hunyuan3d" \
  --env "HF_HUB_OFFLINE=1" --env "PYTHONDONTWRITEBYTECODE=1" \
  --env "U2NET_HOME=/artifacts/cache/rembg" --env "NUMBA_DISABLE_JIT=1" \
  --env "PYTHONFAULTHANDLER=1" --env "PYTHONUNBUFFERED=1" \
  --name "$name" --entrypoint bash "$image" -lc "$command")"
docker --context "$context" start "$container" >/dev/null
printf 'HUNYUAN3D_LAUNCHED:step=upstream-demo,name=%s,container=%s\n' "$name" "$container"
docker --context "$context" wait "$name" >/dev/null || true
docker --context "$context" logs "$name" > "$log" 2>&1 || true
grep '^SCRIPT_EXIT=' "$log" || true
if ! grep -q '^SCRIPT_EXIT=0$' "$log"; then
  echo "HUNYUAN3D_UPSTREAM_DEMO_FAILED: inspect $log" >&2
  exit 1
fi
docker --context "$context" cp "$name:${remote_output}/." "$local_output/"
printf 'HUNYUAN3D_UPSTREAM_DEMO_COMPLETE:%s\n' "$local_output"
