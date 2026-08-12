#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
runtime="$root/config/native-training-feasibility.json"
context="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["runtime"]["dockerContext"])' "$runtime")"
image="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["runtime"]["image"])' "$runtime")"
expected="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["runtime"]["imageDigest"])' "$runtime")"
artifact_root="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["runtime"]["artifactRoot"])' "$runtime")"
container_repo="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["runtime"]["containerRepoRoot"])' "$runtime")"
actual="$(docker --context "$context" image inspect "$image" --format '{{.Id}}')"
[[ "$actual" == "$expected" ]] || { echo "B52_CONTAINER_DIGEST:$actual" >&2; exit 1; }
remote_report="$container_repo/research/ascii-image-generation/reports/native-reference-model-preflight.json"
container="$(docker --context "$context" create --mount "type=bind,src=$artifact_root,dst=/artifacts" --env HF_HOME=/artifacts/cache/huggingface --env HF_HUB_DISABLE_XET=1 --entrypoint bash "$image" -lc "mkdir -p '$container_repo/research/ascii-image-generation/config' '$container_repo/research/ascii-image-generation/scripts' '$container_repo/research/ascii-image-generation/schema' '$container_repo/research/ascii-image-generation/reports' && cp /tmp/b52-native-reference-model.json '$container_repo/research/ascii-image-generation/config/native-reference-model.json' && cp /tmp/b52-freeze-native-reference.py '$container_repo/research/ascii-image-generation/scripts/freeze-native-reference.py' && cp /tmp/b52-native-reference-model.schema.json '$container_repo/research/ascii-image-generation/schema/native-reference-model.schema.json' && python3 '$container_repo/research/ascii-image-generation/scripts/freeze-native-reference.py' --download --config '$container_repo/research/ascii-image-generation/config/native-reference-model.json' --cache-root /artifacts/models/native-reference --report '$remote_report' && python3 '$container_repo/research/ascii-image-generation/scripts/freeze-native-reference.py' --check --config '$container_repo/research/ascii-image-generation/config/native-reference-model.json' --cache-root /artifacts/models/native-reference --report '$remote_report' --schema '$container_repo/research/ascii-image-generation/schema/native-reference-model.schema.json'")"
trap 'docker --context "$context" rm -f "$container" >/dev/null 2>&1 || true' EXIT
docker --context "$context" cp "$root/config/native-reference-model.json" "$container:/tmp/b52-native-reference-model.json"
docker --context "$context" cp "$root/scripts/freeze-native-reference.py" "$container:/tmp/b52-freeze-native-reference.py"
docker --context "$context" cp "$root/schema/native-reference-model.schema.json" "$container:/tmp/b52-native-reference-model.schema.json"
docker --context "$context" start --attach "$container"
docker --context "$context" cp "$container:$remote_report" "$root/reports/native-reference-model-preflight.json"
echo "B52 native-reference preflight frozen: $root/reports/native-reference-model-preflight.json"
