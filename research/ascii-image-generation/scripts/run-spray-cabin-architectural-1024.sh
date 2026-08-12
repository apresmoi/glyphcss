#!/usr/bin/env bash
# Fresh 1024px architectural SDXL + depth-ControlNet bake for the cabin only.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
repository_root="$(cd "$root/.." && pwd)"
context="gpu-4090"
image="glyphcss-ascii-trainer:b8"
expected_digest="sha256:015926d93d16a87eed48877405da596b4d3a6a799693cad6fa5072151b36b476"
artifact_root="/mnt/docker-data/glyphcss-ascii-image-generation"
container_repo_root="/workspace/repo"
controls_run_id="cabin-building-architectural-1024"
run_id="${SPRAY_RUN_ID:-$controls_run_id}"
output="${SPRAY_OUTPUT_ROOT:-/artifacts/spray-pass-${run_id}}"
name="${1:-glyph-spray-${run_id}}"
controls_root="$root/reports/glyph-scenes/${controls_run_id}-controls"
mesh_source="$root/review/hunyuan3d/cabin/cabin-building.obj"
mesh="$root/review/hunyuan3d/cabin/${run_id}.obj"
log_dir="$root/reports/glyph-scenes/cabin/logs"
prior_atlas="$root/review/glyph-scenes/cabin/textures/texture-0.png"

python3 -B "$root/scripts/prepare-cabin-building-spray-mesh.py" "$mesh_source" "$mesh"

# This config is deliberately materialised in a temporary root rather than
# editing the proof's historical cabin configuration.  Its 46-view schedule
# and 4096 packing remain identical; only the mesh, native SDXL resolution,
# art direction, and reproducible seeds change.
staging="$(mktemp -d)"
trap 'rm -rf "$staging"' EXIT
config="$staging/spray-pass-${run_id}.json"
SPRAY_MULTI_VIEW_MODE="${SPRAY_MULTI_VIEW_MODE:-per-view}" \
SPRAY_SYNCHRONIZED_VIEW_COUNT="${SPRAY_SYNCHRONIZED_VIEW_COUNT:-}" \
node --input-type=module - "$root/config/spray-pass.json" "$config" "$mesh" <<'NODE'
import { readFile, writeFile } from "node:fs/promises";
const [source, output, mesh] = process.argv.slice(2);
const config = JSON.parse(await readFile(source, "utf8"));
const prompt = "A high-end architectural photograph of a small handcrafted timber cabin, exact exterior view controlled by the supplied depth image, strictly preserve the compact gable silhouette, chimney, door and window openings; weathered honey-brown vertical cedar board-and-batten siding with individually visible straight boards and wood grain, dark cedar shingle roof with dense readable horizontal courses, low fieldstone foundation and stone step, solid timber door, crisp dark painted divided-light mullioned windows, subtle metal chimney cap, even neutral daylight, sharp 8k architectural magazine photography, tactile physically believable materials, clean pale background";
const negativePrompt = "blur, blurry, soft focus, mushy, low detail, low resolution, noisy, washed out, smooth plastic, cartoon, painterly, CGI render, deformed architecture, warped roof, extra doors, extra windows, open interior, furniture, shelving, people, text, watermark, logo, cropped building";
const multiViewMode = process.env.SPRAY_MULTI_VIEW_MODE;
const synchronizedViewCount = process.env.SPRAY_SYNCHRONIZED_VIEW_COUNT;
if (!new Set(["per-view", "synchronized"]).has(multiViewMode)) {
  throw new Error(`SPRAY_MULTI_VIEW_MODE:${multiViewMode}`);
}
config.id = `glyphcss/spray-paint-cabin-architectural-1024/${multiViewMode}/v1`;
config.outRoot = "reports/glyph-scenes/cabin-building-architectural-1024-controls";
// loadMeshFromFile applies its published OBJ normalization before control
// rendering.  These are the resulting horizontal bounds (verified against the
// loaded 46 triangulated polygons), not the old scene's plot coordinates.
const detailFootprints = {
  "detail-r0-c0": { min: [1, 1], max: [22.335, 31] },
  "detail-r0-c1": { min: [22.335, 1], max: [43.67, 31] },
  "detail-r1-c0": { min: [1, 31], max: [22.335, 61] },
  "detail-r1-c1": { min: [22.335, 31], max: [43.67, 61] },
};
config.views = config.views.map((view) => {
  const key = Object.keys(detailFootprints).find((prefix) => view.id.startsWith(prefix));
  return key ? { ...view, footprint: detailFootprints[key] } : view;
});
config.subjects = [{
  key: "cabin-building",
  assetId: "asset/cabin-building-48-face-architectural-1024",
  path: "research/ascii-image-generation/review/hunyuan3d/cabin/cabin-building-architectural-1024.obj",
  classId: 7,
  materials: ["building"],
  prompt,
  negativePrompt,
  seeds: Array.from({ length: config.views.length }, (_, index) => 23817 + index * 101),
}];
config.generation = {
  ...config.generation,
  steps: 36,
  guidance: 6.8,
  controlScale: 0.86,
  inpaintStrength: 0.85,
  anchorToAuthoredRender: "off",
  multiViewMode,
  synchronizationStartStep: 0,
  synchronizationBlend: 1.0,
};
if (synchronizedViewCount) {
  const count = Number.parseInt(synchronizedViewCount, 10);
  if (!Number.isSafeInteger(count) || count < 1 || count > config.views.length) {
    throw new Error(`SPRAY_SYNCHRONIZED_VIEW_COUNT:${synchronizedViewCount}`);
  }
  config.generation.synchronizedViewCount = count;
}
await writeFile(output, `${JSON.stringify(config, null, 2)}\n`);
NODE

# Re-render controls from the building-only mesh before starting Docker.  The
# command writes no model output and the new directory prevents stale sealed
# control frames from accidentally standing in for this subject.
if [[ ! -f "$controls_root/cabin-building/views/manifest.json" ]] \
  || [[ "$(find "$controls_root/cabin-building/views/frames" -name polygon-uv-image.json -type f 2>/dev/null | wc -l | tr -d ' ')" != 46 ]]; then
  node "$root/src/render-spray-views.mjs" --config "$config" --out-root "$controls_root" --subject cabin-building
else
  echo "SPRAY_CONTROLS_REUSED:exact-uv-controls=$controls_root"
fi
PYTHONDONTWRITEBYTECODE=1 python3 -B "$root/src/spray_pass.py" --config "$config" --controls-root "$controls_root" --subject cabin-building --verify-repaintable

# Mandatory queue gate: a 1024 SDXL+ControlNet worker is serial and must never
# race a live job on the 16 GiB 4090. This remains inside the launcher.
while :; do
  if ! memory="$(ssh -o ConnectTimeout=10 -o BatchMode=yes apresmoi@LeDeluge.fritz.box 'nvidia-smi --query-gpu=memory.used,memory.total --format=csv,noheader' 2>&1 | head -1 | tr -d '\r')"; then
    echo "GPU_VRAM_CHECK_FAILED:$memory" >&2; exit 1
  fi
  [[ "$memory" =~ ^[[:space:]]*([0-9]+)[[:space:]]+MiB,[[:space:]]*([0-9]+)[[:space:]]+MiB[[:space:]]*$ ]] || { echo "GPU_VRAM_CHECK_FAILED:$memory" >&2; exit 1; }
  used="${BASH_REMATCH[1]}"; total="${BASH_REMATCH[2]}"
  if (( used < 2000 )); then printf 'GPU_VRAM_READY:used=%sMiB,total=%sMiB\n' "$used" "$total"; break; fi
  printf 'GPU_VRAM_BUSY:used=%sMiB,total=%sMiB; waiting 30s\n' "$used" "$total"; sleep 30
done

actual_digest="$(docker --context "$context" image inspect "$image" --format '{{.Id}}')"
[[ "$actual_digest" == "$expected_digest" ]] || { echo "SPRAY_PASS_CONTAINER_DIGEST:$actual_digest" >&2; exit 1; }
mkdir -p "$log_dir"
if docker --context "$context" inspect "$name" >/dev/null 2>&1; then
  docker --context "$context" logs "$name" > "$log_dir/previous-$(date +%s).log" 2>&1 || true
  docker --context "$context" rm -f "$name" >/dev/null 2>&1 || true
fi

mkdir -p "$staging/research/ascii-image-generation/review/hunyuan3d/cabin"
cp -R "$root/src" "$root/docker" "$staging/research/ascii-image-generation/"
cp "$config" "$staging/research/ascii-image-generation/config.json"
cp -R "$controls_root" "$staging/research/ascii-image-generation/controls"
cp "$mesh" "$staging/research/ascii-image-generation/review/hunyuan3d/cabin/cabin-building-architectural-1024.obj"

container="$(docker --context "$context" create --gpus all --user 0:0 --shm-size=8g \
  --mount "type=bind,src=$artifact_root,dst=/artifacts" \
  --env "GLYPH_IMAGE_DIGEST=$expected_digest" --env "HF_HOME=/artifacts/cache/huggingface" --env "HF_HUB_OFFLINE=1" --env "HF_HUB_DISABLE_XET=1" \
  --env "GLYPH_SPRAY_WIDTH=1024" --env "GLYPH_SPRAY_HEIGHT=1024" --env "PYTHONDONTWRITEBYTECODE=1" --env "PYTHONFAULTHANDLER=1" --env "PYTHONUNBUFFERED=1" \
  --name "$name" --entrypoint bash "$image" -lc \
  "set +e; python3 -B $container_repo_root/research/ascii-image-generation/src/spray_pass.py --config $container_repo_root/research/ascii-image-generation/config.json --controls-root $container_repo_root/research/ascii-image-generation/controls --output-root $output --subject cabin-building; status=\$?; printf 'SCRIPT_EXIT=%s\\n' \"\$status\"; exit \"\$status\"")"
docker --context "$context" cp "$staging/." "$container:$container_repo_root" >/dev/null
docker --context "$context" start "$container" >/dev/null
printf 'SPRAY_PASS_LAUNCHED:name=%s,container=%s,output=%s,previousAtlasSha256=%s\n' "$name" "$container" "$output" "$(sha256sum "$prior_atlas" | awk '{print $1}')"
printf 'SPRAY_PASS_VERIFY: docker --context %s logs %s > %s 2>&1; grep SCRIPT_EXIT= %s\n' "$context" "$name" "$log_dir/$name.log" "$log_dir/$name.log"
