#!/usr/bin/env bash
set -euo pipefail

context="${GLYPHCSS_DOCKER_CONTEXT:-gpu-4090}"
artifact_root="${GLYPHCSS_ARTIFACT_ROOT:-/mnt/docker-data/glyphcss-ascii-image-generation}"
docker --context "$context" run --rm --entrypoint bash \
  --volume "$artifact_root:/artifacts:ro" \
  mcr.microsoft.com/playwright@sha256:6446946a1d9fd62d9ae501312a2d76a43ee688542b21622056a372959b65d63d \
  -lc 'set -euo pipefail
root=/artifacts/reference-browser/preserved-red/reference-g5-contract-20260723T002000Z
printf "%s  %s\n" \
  4b9d7ef97a9d765067aa019f598e147117507c3e0e9530ac44ce206f89d35c7d "$root/trace.json" \
  ae10ce5527d6b305ad97ccbd4ada3e3d2ceb499b3fc46471b04e953e0492ac0c "$root/trace.json.diagnostic.json" \
  25a6b35665a89ef4999eb1259e40ab05c8a972164e0c4f5966d043d901a19e70 "$root/evidence/generated/summary.json" \
  7ae59aad465be911e46f0f5d2ef9514b24982439efaa25cf2d915dc88125ae25 "$root/run-manifest.json" | sha256sum --check --strict'
docker --context "$context" run --rm --entrypoint bash \
  --volume "$artifact_root:/artifacts:ro" \
  mcr.microsoft.com/playwright@sha256:6446946a1d9fd62d9ae501312a2d76a43ee688542b21622056a372959b65d63d \
  -lc 'set -euo pipefail
root=/artifacts/reference-browser/preserved-red/reference-g5-contract-20260723T002000Z
node -e '"'"'const manifest = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")); if (manifest?.image?.id !== "sha256:3a034dd9275e3451e190e0df50da9891e8fee611c5092aa0034a1de9d206148f") process.exit(1);'"'"' "$root/run-manifest.json"'
