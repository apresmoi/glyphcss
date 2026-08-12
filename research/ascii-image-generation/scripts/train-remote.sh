#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
config="$root/config/overfit-keyframe.yaml"
verify_report=""
resume=""
static_check=false
preallocation_check=false

while (($#)); do
  case "$1" in
    --config) config="$(cd "$(dirname "$2")" && pwd)/$(basename "$2")"; shift 2 ;;
    --verify-report) verify_report="$(cd "$(dirname "$2")" && pwd)/$(basename "$2")"; shift 2 ;;
    --resume) resume="$2"; shift 2 ;;
    --static-check) static_check=true; shift ;;
    --preallocation-check) preallocation_check=true; shift ;;
    *) echo "B12_UNKNOWN_ARGUMENT:$1" >&2; exit 2 ;;
  esac
done

python3 -m py_compile "$root/src/overfit_contract.py" "$root/src/eval_control.py" "$root/src/train_control.py"
python3 - "$config" <<'PY'
import json, sys
config = json.load(open(sys.argv[1]))
if config.get("architecture", {}).get("id") == "sdxl-glyph-control-adapter/pending-v1":
    raise SystemExit("B12_SDXL_ADAPTER_NOT_IMPLEMENTED")
PY
python3 "$root/src/eval_control.py" --config "$config" --repo-root "$root" --synthetic-wiring-check >/dev/null

if $static_check; then
  echo "B12_STATIC_READY: wiring-only; not acceptance evidence"
  exit 0
fi

runtime_value() {
  python3 - "$config" "$1" <<'PY'
import json, sys
print(json.load(open(sys.argv[1]))["runtime"][sys.argv[2]])
PY
}
context="$(runtime_value dockerContext)"
image="$(runtime_value image)"
expected_digest="$(runtime_value imageDigest)"
artifact_root="$(runtime_value artifactRoot)"
container_artifacts="$(runtime_value containerArtifactRoot)"
container_repo="$(runtime_value containerRepoRoot)"
[[ "$context" == "gpu-4090" && "$artifact_root" == "/mnt/docker-data/glyphcss-ascii-image-generation" && "$container_artifacts" == "/artifacts" && "$container_repo" == "/workspace/repo" ]] || {
  echo "B12_RUNTIME_POLICY" >&2
  exit 2
}

actual_digest="$(docker --context "$context" image inspect "$image" --format '{{.Id}}')"
[[ "$actual_digest" == "$expected_digest" ]] || { echo "B12_CONTAINER_DIGEST:$actual_digest" >&2; exit 1; }

staging="$(mktemp -d)"
active_container=""
cleanup() {
  [[ -z "$active_container" ]] || docker --context "$context" rm -f "$active_container" >/dev/null 2>&1 || true
  rm -rf "$staging"
}
trap cleanup EXIT
stage_research="$staging/research/ascii-image-generation"
mkdir -p "$stage_research/reports"
cp -R "$root/src" "$root/config" "$root/schema" "$root/scripts" "$stage_research/"
cp "$root/reports/native-reference-model-preflight.json" "$root/reports/eval-baseline.json" "$stage_research/reports/"
for authority in rendered-target-admission.json asset-corpus.json material-asset-corpus.json asset-registry.json; do
  [[ ! -f "$root/reports/$authority" ]] || cp "$root/reports/$authority" "$stage_research/reports/"
done
cp "$config" "$stage_research/config/$(basename "$config")"

if [[ -n "$verify_report" ]]; then
  node "$root/scripts/validate-overfit-report.mjs" "$verify_report"
  cp "$verify_report" "$stage_research/reports/verification-report.json"
  active_container="$(docker --context "$context" create \
    --mount "type=bind,src=$artifact_root,dst=$container_artifacts,readonly" \
    --entrypoint python3 "$image" "$container_repo/research/ascii-image-generation/src/eval_control.py" \
      --config "$container_repo/research/ascii-image-generation/config/$(basename "$config")" \
      --repo-root "$container_repo/research/ascii-image-generation" \
      --verify-report "$container_repo/research/ascii-image-generation/reports/verification-report.json" \
      --artifact-root "$container_artifacts")"
  docker --context "$context" cp "$staging/." "$active_container:$container_repo"
  docker --context "$context" start --attach "$active_container"
  exit 0
fi

trainer="$container_repo/research/ascii-image-generation/src/train_control.py"
container_config="$container_repo/research/ascii-image-generation/config/$(basename "$config")"
if $preallocation_check; then
  run_command="python3 '$trainer' --config '$container_config' --repo-root '$container_repo/research/ascii-image-generation' --preallocation-check"
else
run_command="python3 '$trainer' --config '$container_config' --repo-root '$container_repo/research/ascii-image-generation' --smoke-one-optimizer-step && python3 '$trainer' --config '$container_config' --repo-root '$container_repo/research/ascii-image-generation'"
[[ -z "$resume" ]] || run_command+=" --resume '$resume'"
fi

active_container="$(docker --context "$context" create --gpus all --user 0:0 \
  --mount "type=bind,src=$artifact_root,dst=$container_artifacts" \
  --mount "type=bind,src=$artifact_root,dst=$artifact_root,readonly" \
  --env "GLYPH_IMAGE_DIGEST=$expected_digest" \
  --env "B12_RUN_COMMAND=$run_command" \
  --entrypoint bash "$image" -lc "chown -R glyph:glyph '$container_repo'; exec runuser -u glyph -- bash -lc \"\$B12_RUN_COMMAND\"")"
docker --context "$context" cp "$staging/." "$active_container:$container_repo"
docker --context "$context" start --attach "$active_container"
if $preallocation_check; then
  exit 0
fi
docker --context "$context" cp "$active_container:$container_artifacts/runs/overfit-keyframe/overfit-keyframe.json" "$root/reports/overfit-keyframe.json"
"$0" --config "$config" --verify-report "$root/reports/overfit-keyframe.json"
