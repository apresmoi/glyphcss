#!/usr/bin/env bash
set -euo pipefail
context=gpu-4090; image=glyphcss-ascii-trainer:b8; root=/mnt/docker-data/glyphcss-ascii-image-generation; check=0; resume=""
while (($#)); do case "$1" in --check) check=1;; --context) context="$2"; shift;; --image) image="$2"; shift;; --artifact-root) root="$2"; shift;; --resume-run) resume="$2"; shift;; *) echo "unknown argument: $1" >&2; exit 64;; esac; shift; done
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
docker --context "$context" build --pull --file "$repo_root/research/ascii-image-generation/docker/Dockerfile" --tag "$image" "$repo_root/research/ascii-image-generation/docker"
context_manifest="$(docker --context "$context" run --rm --entrypoint cat "$image" /usr/local/share/glyphcss-context-audit.txt)"
expected_context_manifest=$'.dockerignore\nDockerfile\nentrypoint.py\nrequirements.lock\nsmoke.py\ntest_training_target_consumer.py\ntraining_target_consumer.py'
[[ "$context_manifest" == "$expected_context_manifest" ]] || { echo "unexpected Docker build context manifest" >&2; printf '%s\n' "$context_manifest" >&2; exit 1; }
digest="$(docker --context "$context" image inspect "$image" --format '{{index .RepoDigests 0}}' 2>/dev/null || true)"; [[ -n "$digest" ]] || digest="$(docker --context "$context" image inspect "$image" --format '{{.Id}}')"
run_id="remote-smoke-$(date -u +%Y%m%dT%H%M%SZ)"
docker --context "$context" run --rm --user 0:0 --entrypoint sh --mount "type=bind,src=$root,dst=/artifacts" "$image" -c 'mkdir -p /artifacts/runs /artifacts/evidence /artifacts/cache/huggingface && chown 10001:10001 /artifacts/runs /artifacts/evidence /artifacts/cache /artifacts/cache/huggingface'
if [[ -n "$resume" ]]; then
  docker --context "$context" run --rm --gpus all --user 10001:10001 --mount "type=bind,src=$root,dst=/artifacts" --env "GLYPH_IMAGE_DIGEST=$digest" "$image" --artifact-root /artifacts --run-id "$run_id" --resume "/artifacts/runs/$resume/checkpoint.pt"
else
  docker --context "$context" run --rm --gpus all --user 10001:10001 --mount "type=bind,src=$root,dst=/artifacts" --env "GLYPH_IMAGE_DIGEST=$digest" "$image" --artifact-root /artifacts --run-id "$run_id"
fi
if ((check)); then docker --context "$context" run --rm --entrypoint python3 --mount "type=bind,src=$root,dst=/artifacts,readonly" "$image" -c 'import json,pathlib; root=pathlib.Path("/artifacts"); runs=sorted((root/"runs").glob("remote-smoke-*/training-smoke.json")); reports=sorted((root/"evidence").glob("remote-smoke-*/raw/g7.json")); assert runs and reports,"missing B8 artifacts"; run=json.loads(runs[-1].read_text()); report=json.loads(reports[-1].read_text()); assert run["schemaVersion"]=="glyph-training-smoke/v1" and run["gpu"]["peakAllocatedMiB"]>0 and run["mixedPrecision"]=="fp16" and not run["baseModel"]["downloaded"]; assert report["schemaVersion"]=="metric-report/v2" and report["reportId"]=="raw/g7" and report["signals"]["peak-vram-mib"]["value"]==run["gpu"]["peakAllocatedMiB"]; assert report["signals"]["secret-audit"]["value"]==0 and report["signals"]["large-artifact-audit"]["value"]==0; print("B8 remote smoke evidence check passed")'; fi

if ((check)); then
  stage="$(mktemp -d)"
  roundtrip="$(mktemp -d)"
  helper="glyphcss-b8-evidence-$run_id"
  cleanup() {
    docker --context "$context" rm -f "$helper" >/dev/null 2>&1 || true
    rm -rf "$stage" "$roundtrip"
  }
  trap cleanup EXIT
  cp -R "$repo_root/research/ascii-image-generation/fixtures/evidence/production/." "$stage/"
  docker --context "$context" create --name "$helper" --entrypoint sh --mount "type=bind,src=$root,dst=/artifacts" "$image" -c true >/dev/null
  docker --context "$context" cp "$helper:/artifacts/evidence/$run_id/raw/g7.json" "$stage/raw/g7.json"
  docker --context "$context" cp "$helper:/artifacts/evidence/$run_id/raw/artifacts/g7.json" "$stage/raw/artifacts/g7.json"
  pnpm --dir "$repo_root/research/ascii-image-generation" build:evidence -- --evidence-root "$stage"
  node "$repo_root/research/ascii-image-generation/scripts/build-oven-payloads.mjs" --evidence-root "$stage"
  pnpm --dir "$repo_root/research/ascii-image-generation" build:evidence -- --evidence-root "$stage" --check
  pnpm --dir "$repo_root/research/ascii-image-generation" check:ovens -- --evidence-root "$stage"
  docker --context "$context" cp "$stage/." "$helper:/artifacts/evidence/$run_id/"
  docker --context "$context" cp "$helper:/artifacts/evidence/$run_id/." "$roundtrip/"
  pnpm --dir "$repo_root/research/ascii-image-generation" build:evidence -- --evidence-root "$roundtrip" --check
  pnpm --dir "$repo_root/research/ascii-image-generation" check:ovens -- --evidence-root "$roundtrip"
  echo "B8 remote B25 adapter and Oven round-trip passed"
fi
