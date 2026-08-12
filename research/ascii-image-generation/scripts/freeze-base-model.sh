#!/usr/bin/env bash
set -euo pipefail

context=gpu-4090
image=glyphcss-ascii-trainer:b8
artifact_root=/mnt/docker-data/glyphcss-ascii-image-generation/models/base
report=research/ascii-image-generation/reports/base-model-preflight.json
check=0
while (($#)); do
  case "$1" in
    --check) check=1; report="$2"; shift ;;
    --context) context="$2"; shift ;;
    --image) image="$2"; shift ;;
    --artifact-root) artifact_root="$2"; shift ;;
    *) echo "unknown argument: $1" >&2; exit 64 ;;
  esac
  shift
done

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
config="$repo_root/research/ascii-image-generation/config/base-model.json"
schema="$repo_root/research/ascii-image-generation/schema/base-model.schema.json"
helper="$repo_root/research/ascii-image-generation/scripts/freeze_base_model.py"
checker="$repo_root/research/ascii-image-generation/scripts/check-base-model-preflight.mjs"
source_root="$repo_root/research/ascii-image-generation"
[[ -f "$config" && -f "$schema" && -f "$helper" && -f "$checker" ]] || { echo "B34 source contract is incomplete" >&2; exit 1; }

if ((check)); then
  node "$checker" "$schema" "$config" "$report" "$source_root"
  exit 0
fi

image_digest="$(docker --context "$context" image inspect "$image" --format '{{index .RepoDigests 0}}' 2>/dev/null || true)"
[[ -n "$image_digest" ]] || image_digest="$(docker --context "$context" image inspect "$image" --format '{{.Id}}')"
expected_context="$(node -e 'const c=require(process.argv[1]);process.stdout.write(c.execution.context)' "$config")"
expected_image="$(node -e 'const c=require(process.argv[1]);process.stdout.write(c.execution.image)' "$config")"
expected_digest="$(node -e 'const c=require(process.argv[1]);process.stdout.write(c.execution.digest)' "$config")"
[[ "$context" == "$expected_context" && "$image" == "$expected_image" && "$image_digest" == "$expected_digest" ]] || { echo "launcher context/image/digest differs from frozen B8 execution identity" >&2; exit 1; }
container="glyphcss-b34-freeze-$$"
completed=0
cleanup() {
  if ((completed)); then
    docker --context "$context" rm -f "$container" >/dev/null 2>&1 || true
  else
    echo "B34 failed container retained for diagnosis: $container" >&2
  fi
}
trap cleanup EXIT
artifact_parent="${artifact_root%/models/base}"
[[ "$artifact_parent" != "$artifact_root" ]] || { echo "artifact root must end in /models/base" >&2; exit 64; }
docker --context "$context" run --rm --user 0:0 --entrypoint sh --mount "type=bind,src=$artifact_parent,dst=/artifacts-parent" "$image" -c 'mkdir -p /artifacts-parent/models/base && chown 10001:10001 /artifacts-parent/models /artifacts-parent/models/base'
docker --context "$context" create --name "$container" --user 10001:10001 --entrypoint python3 --mount "type=bind,src=$artifact_root,dst=/artifacts" "$image" /workspace/freeze_base_model.py --config /workspace/base-model.json --source-root /workspace --artifact-root /artifacts --remote-artifact-root "$artifact_root" --container-digest "$image_digest" --container-image "$image" --docker-context "$context" >/dev/null
docker --context "$context" cp "$helper" "$container:/workspace/freeze_base_model.py"
docker --context "$context" cp "$config" "$container:/workspace/base-model.json"
docker --context "$context" cp "$source_root/licenses" "$container:/workspace/licenses"
docker --context "$context" start -a "$container"
remote_status="$(docker --context "$context" wait "$container")"
if [[ "$remote_status" != "0" ]]; then
  docker --context "$context" logs "$container" >&2
  echo "B34 remote freeze container failed" >&2
  exit 1
fi
remote_report="/artifacts/nota-ai-bk-sdm-small/572238db7ed3a10858900803f3fc8cca53e893e0/base-model-preflight.json"
mkdir -p "$(dirname "$report")"
docker --context "$context" cp "$container:$remote_report" "$report"
node "$checker" "$schema" "$config" "$report" "$source_root"
completed=1
