#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
config="$root/config/native-training-feasibility.json"
report="$root/reports/native-training-feasibility.json"
context="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["runtime"]["dockerContext"])' "$config")"
image="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["runtime"]["image"])' "$config")"
digest="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["runtime"]["imageDigest"])' "$config")"
artifact_root="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["runtime"]["artifactRoot"])' "$config")"
container_repo="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["runtime"]["containerRepoRoot"])' "$config")"
actual="$(docker --context "$context" image inspect "$image" --format '{{.Id}}')"
[[ "$actual" == "$digest" ]] || { echo "B52_FEASIBILITY_CONTAINER_DIGEST:$actual" >&2; exit 1; }
container="$(docker --context "$context" create --gpus all --mount "type=bind,src=$artifact_root,dst=/artifacts" --env "GLYPH_IMAGE_DIGEST=$digest" --env HF_HOME=/artifacts/cache/huggingface --env HF_HUB_OFFLINE=1 --env HF_HUB_DISABLE_XET=1 --entrypoint bash "$image" -lc "mkdir -p '$container_repo/research/ascii-image-generation/config' '$container_repo/research/ascii-image-generation/schema' '$container_repo/research/ascii-image-generation/scripts' '$container_repo/research/ascii-image-generation/src' '$container_repo/research/ascii-image-generation/reports' && cp -R /tmp/b52-config/. '$container_repo/research/ascii-image-generation/config/' && cp -R /tmp/b52-schema/. '$container_repo/research/ascii-image-generation/schema/' && cp /tmp/b52-freeze-native-reference.py '$container_repo/research/ascii-image-generation/scripts/freeze-native-reference.py' && cp /tmp/b52-native-training-feasibility.py '$container_repo/research/ascii-image-generation/src/native_training_feasibility.py' && cp /tmp/b52-native-reference-model-preflight.json '$container_repo/research/ascii-image-generation/reports/native-reference-model-preflight.json' && python3 '$container_repo/research/ascii-image-generation/scripts/freeze-native-reference.py' --check --config '$container_repo/research/ascii-image-generation/config/native-reference-model.json' --cache-root /artifacts/models/native-reference --report '$container_repo/research/ascii-image-generation/reports/native-reference-model-preflight.json' && python3 '$container_repo/research/ascii-image-generation/src/native_training_feasibility.py' --config '$container_repo/research/ascii-image-generation/config/native-training-feasibility.json' --repo-root '$container_repo/research/ascii-image-generation' --report /tmp/b52-native-training-feasibility.json")"
trap 'docker --context "$context" rm -f "$container" >/dev/null 2>&1 || true' EXIT
docker --context "$context" cp "$root/config" "$container:/tmp/b52-config"
docker --context "$context" cp "$root/schema" "$container:/tmp/b52-schema"
docker --context "$context" cp "$root/scripts/freeze-native-reference.py" "$container:/tmp/b52-freeze-native-reference.py"
docker --context "$context" cp "$root/src/native_training_feasibility.py" "$container:/tmp/b52-native-training-feasibility.py"
docker --context "$context" cp "$root/reports/native-reference-model-preflight.json" "$container:/tmp/b52-native-reference-model-preflight.json"
docker --context "$context" start --attach "$container"
docker --context "$context" cp "$container:/tmp/b52-native-training-feasibility.json" "$report"
python3 "$root/scripts/check-native-training-feasibility.py" --root "$root" --config "$config" --report "$report" --schema "$root/schema/native-training-feasibility.schema.json"
echo "B52 native training feasibility passed: $report"
