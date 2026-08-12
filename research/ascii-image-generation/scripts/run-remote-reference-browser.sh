#!/usr/bin/env bash
set -euo pipefail

context="${GLYPHCSS_DOCKER_CONTEXT:-gpu-4090}"
data_root="${GLYPHCSS_ARTIFACT_ROOT:-/mnt/docker-data/glyphcss-ascii-image-generation}"
image="glyphcss-reprojection-reference:chromium-140.0.7339.80"
# B37 is evidence reuse, never an image-selection mechanism.  The image was
# captured before the launcher-only amendment below; accepting a tag or a
# caller-supplied digest would make the evidence chain ambiguous.
immutable_reuse_image_id="sha256:b30a3fb9b2eb6d744ded1b7d4c5c9b0668273956a4ddcef98423f41238e90af7"
reuse_image_id="${GLYPHCSS_REFERENCE_REUSE_IMAGE_ID:-$immutable_reuse_image_id}"
reuse_provenance=""
contract_sha256="041dd4d9f126261adf00b541354251fef52fe938c83d9ba06fce4cba3cc7df9d"
event_sha256="7bff12fb2738ad116cc5ef93f9395785ef9071ac74569792322ad0855ac0af4f"
measurement_contract_sha256="122b3a42d75f9e9a0b473c9c2c38814cce3dc4239d27bb935af183c7e9fd43e9"
g5_signature_sha256="0fee24a6ca7019f5a92974476e606b89eb990695b240a1cdfbab437d92e8885e"
run_id="${GLYPHCSS_REFERENCE_RUN_ID:-reference-$(date -u +%Y%m%dt%H%M%Sz)}"
post_launch_started=0
post_launch_complete=0
post_launch_phase="not-started"
post_launch_exiting=0
post_launch_validator_published=0

cleanup_temporary_files() {
  local path
  for path in "${source_archive:-}" "${image_manifest:-}" "${local_manifest:-}" \
    "${reuse_diff:-}" "${reuse_provenance:-}" "${reuse_bundle_manifest:-}" \
    "${local_preflight_file:-}" "${remote_preflight_file:-}" "${clean_snapshot_file:-}" \
    "${reuse_validator_file:-}" "${preflight_parity_file:-}" "${recomputed_archive:-}" \
    "${post_archive:-}"; do
    [[ -z "$path" ]] || rm -f "$path" || :
  done
}

# This is deliberately an EXIT trap, not an ERR trap: an explicit `exit 1`
# and a command failure under `set -e` must have the same terminal evidence.
# It is activated only after the run directory and immutable preflight binding
# exist, so pre-launch failures can never manufacture a run result.
write_post_launch_blocked() {
  local status="$1" phase="$2"
  if [[ -n "${GLYPHCSS_REFERENCE_POSTLAUNCH_TEST_ROOT:-}" ]]; then
    TEST_ROOT="$GLYPHCSS_REFERENCE_POSTLAUNCH_TEST_ROOT" STATUS="$status" PHASE="$phase" node --input-type=module -e '
      import { existsSync, unlinkSync, writeFileSync } from "node:fs";
      const root = process.env.TEST_ROOT, blocked = `${root}/reuse-blocked.json`, integrity = `${root}/reuse-integrity.json`;
      if (!existsSync(blocked)) { if (existsSync(integrity)) unlinkSync(integrity); writeFileSync(blocked, `${JSON.stringify({ schemaVersion: "glyph-reprojection-reference-reuse-blocked/v3", authority: "reuse-wrapper-only", fullG5Pass: false, phase: process.env.PHASE, exitCode: Number(process.env.STATUS) }, null, 2)}\n`, { flag: "wx", mode: 0o400 }); }
    '
    return
  fi
  docker --context "$context" run --rm --user root --entrypoint node --volume "$data_root:/artifacts" --env "RUN_DIR=/artifacts/reference-browser/runs/$run_id" --env "STATUS=$status" --env "PHASE=$phase" mcr.microsoft.com/playwright@sha256:6446946a1d9fd62d9ae501312a2d76a43ee688542b21622056a372959b65d63d -e 'const fs=require("fs"),p=process.env.RUN_DIR,b=`${p}/reuse-blocked.json`,i=`${p}/reuse-integrity.json`;if(!fs.existsSync(b)){if(fs.existsSync(i))fs.unlinkSync(i);fs.writeFileSync(b,JSON.stringify({schemaVersion:"glyph-reprojection-reference-reuse-blocked/v3",authority:"reuse-wrapper-only",fullG5Pass:false,phase:process.env.PHASE,exitCode:Number(process.env.STATUS)},null,2)+"\n",{flag:"wx",mode:0o400});fs.chownSync(b,0,0)}' >/dev/null 2>&1 || printf 'REFERENCE_REUSE_BLOCKED_WRITE_FAILED phase=%s exit=%s\n' "$phase" "$status" >&2
}

post_launch_exit_handler() {
  local status="$1"
  trap - EXIT ERR
  set +e
  if (( status != 0 && post_launch_started && ! post_launch_complete && ! post_launch_exiting )); then
    post_launch_exiting=1
    write_post_launch_blocked "$status" "$post_launch_phase"
  fi
  cleanup_temporary_files
  exit "$status"
}

activate_post_launch_guard() {
  post_launch_started=1
  post_launch_complete=0
  post_launch_phase="benchmark"
  post_launch_validator_published=0
  trap 'post_launch_exit_handler $?' EXIT
  trap 'exit 129' HUP
  trap 'exit 130' INT
  trap 'exit 143' TERM
}

set_post_launch_phase() {
  post_launch_phase="$1"
}

validate_and_deactivate_post_launch_guard() {
  # Publication is the validator's final, write-once operation.  Nothing that
  # can fail remotely is permitted after it; changing trap state is local.
  (( post_launch_validator_published == 1 )) || return 1
  post_launch_complete=1
  post_launch_started=0
  trap - HUP INT TERM
  trap 'cleanup_temporary_files' EXIT
}

run_post_launch_self_test_case() {
  local test_case="$1"
  post_launch_started=1
  post_launch_complete=0
  post_launch_phase="$test_case"
  trap 'post_launch_exit_handler $?' EXIT
  trap 'exit 143' TERM
  if [[ "$test_case" == "success" ]]; then
    printf '{"validated":true}\n' >"$GLYPHCSS_REFERENCE_POSTLAUNCH_TEST_ROOT/reuse-integrity.json"
    post_launch_validator_published=1
    validate_and_deactivate_post_launch_guard
    exit 0
  fi
  if [[ "$test_case" == "post-integrity-failure" ]]; then
    printf '{"validated":true}\n' >"$GLYPHCSS_REFERENCE_POSTLAUNCH_TEST_ROOT/reuse-integrity.json"
    post_launch_validator_published=1
    exit 74
  fi
  if [[ "$test_case" == "signal-term" ]]; then
    post_launch_phase="benchmark"
    kill -TERM "$$"
  fi
  exit 73
}

run_post_launch_self_tests() {
  local test_root test_case status
  local phases=(benchmark bundle-recheck post-image-inspect archive-recompute post-preflight postflight-write validator integrity-validation)
  for test_case in "${phases[@]}"; do
    test_root="$(mktemp -d "${TMPDIR:-/tmp}/glyphcss-b37-postlaunch-${test_case}.XXXXXX")"
    if GLYPHCSS_REFERENCE_POSTLAUNCH_TEST_CASE="$test_case" GLYPHCSS_REFERENCE_POSTLAUNCH_TEST_ROOT="$test_root" "$0"; then
      rm -rf "$test_root"; echo "REFERENCE_REUSE_POSTLAUNCH_TEST_EXPECTED_FAILURE:$test_case" >&2; return 1
    else
      status=$?
    fi
    TEST_ROOT="$test_root" TEST_CASE="$test_case" STATUS="$status" node --input-type=module -e '
      import { existsSync, readFileSync } from "node:fs";
      const root=process.env.TEST_ROOT, blocked=`${root}/reuse-blocked.json`, integrity=`${root}/reuse-integrity.json`;
      if (process.env.STATUS !== "73" || !existsSync(blocked) || existsSync(integrity)) process.exit(1);
      const value=JSON.parse(readFileSync(blocked,"utf8"));
      if (value.schemaVersion !== "glyph-reprojection-reference-reuse-blocked/v3" || value.authority !== "reuse-wrapper-only" || value.fullG5Pass !== false || value.phase !== process.env.TEST_CASE || value.exitCode !== 73) process.exit(1);
    '
    rm -rf "$test_root"
  done
  test_root="$(mktemp -d "${TMPDIR:-/tmp}/glyphcss-b37-postlaunch-signal.XXXXXX")"
  if GLYPHCSS_REFERENCE_POSTLAUNCH_TEST_CASE=signal-term GLYPHCSS_REFERENCE_POSTLAUNCH_TEST_ROOT="$test_root" "$0"; then
    rm -rf "$test_root"; echo "REFERENCE_REUSE_POSTLAUNCH_TEST_EXPECTED_SIGNAL_FAILURE" >&2; return 1
  else
    status=$?
  fi
  TEST_ROOT="$test_root" STATUS="$status" node --input-type=module -e '
    import { existsSync, readFileSync } from "node:fs";
    const root=process.env.TEST_ROOT, blocked=`${root}/reuse-blocked.json`, integrity=`${root}/reuse-integrity.json`;
    if (process.env.STATUS !== "143" || !existsSync(blocked) || existsSync(integrity)) process.exit(1);
    const value=JSON.parse(readFileSync(blocked,"utf8")); if(value.phase!=="benchmark"||value.exitCode!==143)process.exit(1);
  '
  rm -rf "$test_root"
  test_root="$(mktemp -d "${TMPDIR:-/tmp}/glyphcss-b37-postlaunch-after-integrity.XXXXXX")"
  if GLYPHCSS_REFERENCE_POSTLAUNCH_TEST_CASE=post-integrity-failure GLYPHCSS_REFERENCE_POSTLAUNCH_TEST_ROOT="$test_root" "$0"; then
    rm -rf "$test_root"; echo "REFERENCE_REUSE_POSTLAUNCH_TEST_EXPECTED_POST_INTEGRITY_FAILURE" >&2; return 1
  else
    status=$?
  fi
  TEST_ROOT="$test_root" STATUS="$status" node --input-type=module -e 'import {existsSync,readFileSync} from "node:fs"; const root=process.env.TEST_ROOT,b=`${root}/reuse-blocked.json`; if(process.env.STATUS!=="74"||existsSync(`${root}/reuse-integrity.json`)||!existsSync(b)||JSON.parse(readFileSync(b,"utf8")).exitCode!==74)process.exit(1);'
  rm -rf "$test_root"
  test_root="$(mktemp -d "${TMPDIR:-/tmp}/glyphcss-b37-postlaunch-success.XXXXXX")"
  GLYPHCSS_REFERENCE_POSTLAUNCH_TEST_CASE=success GLYPHCSS_REFERENCE_POSTLAUNCH_TEST_ROOT="$test_root" "$0"
  TEST_ROOT="$test_root" node --input-type=module -e 'import {existsSync} from "node:fs"; const root=process.env.TEST_ROOT; if(!existsSync(`${root}/reuse-integrity.json`)||existsSync(`${root}/reuse-blocked.json`))process.exit(1);'
  rm -rf "$test_root"
  printf 'B37 post-launch EXIT guard self-tests: %s failure phases + signal + post-integrity failure + success\n' "${#phases[@]}"
}

# Exercises the exact validator heredoc used by the launcher.  It stops at
# binding checks before archive/artifact traversal, making cross-run and
# frozen-hash substitution fixtures cheap and deterministic.
run_validator_binding_self_tests() {
  local fixture validator err bundle_sha status
  fixture="$(mktemp -d "${TMPDIR:-/tmp}/glyphcss-b37-validator-binding.XXXXXX")"
  validator="$fixture/reuse-integrity-validator.mjs"
  node --input-type=module - "$0" "$validator" "$fixture" "$contract_sha256" "$event_sha256" "$measurement_contract_sha256" "$g5_signature_sha256" <<'NODE'
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const [scriptPath, validatorPath, root, contract, event, measurement, g5] = process.argv.slice(2);
const script = readFileSync(scriptPath, "utf8");
const marker = "cat >\"$reuse_validator_file\" <<'NODE'\n";
const start = script.indexOf(marker), end = script.indexOf("\nNODE\n", start);
if (start < 0 || end < 0) throw new Error("REFERENCE_REUSE_VALIDATOR_SELFTEST_EXTRACT");
writeFileSync(validatorPath, script.slice(start + marker.length, end));
const canonical = (value) => value === null || typeof value !== "object" ? JSON.stringify(value) : Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : `{${Object.keys(value).filter((key) => key !== "contentSha256").sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
const sha = (value) => createHash("sha256").update(value).digest("hex");
const image = `sha256:${"a".repeat(64)}`, runId = "run-good";
const writeFixture = (mode) => {
  const runDir = join(root, runId), bundleRoot = join(root, `bundle-${mode}`), evidence = join(runDir, "evidence");
  mkdirSync(evidence, { recursive: true }); mkdirSync(bundleRoot, { recursive: true });
  const environment = { runId, image: { id: image } };
  const manifest = { frozenTrace: { contractSha256: contract, eventSha256: event }, measurementContract: { sha256: measurement, g5SignatureSha256: g5 } };
  const trace = { frozenTrace: { contractSha256: contract, eventSha256: event, measurementContractSha256: measurement, g5SignatureSha256: g5 } };
  const partial = { provenance: { runId }, contract: { sha256: mode === "hash" ? "f".repeat(64) : contract, eventSha256: event }, measurementContract: { sha256: measurement, g5SignatureSha256: g5 } };
  const integrity = { runId, contractSha256: partial.contract.sha256, eventSha256: event, measurementContractSha256: measurement, g5SignatureSha256: g5 };
  for (const [name, value] of [["preflight.json", {}], ["environment-manifest.json", environment], ["run-manifest.json", manifest], ["trace.json", trace], ["evidence/reference-partial-evidence.json", partial], ["evidence/reference-partial-integrity.json", integrity]]) writeFileSync(join(runDir, name), JSON.stringify(value));
  writeFileSync(join(bundleRoot, "reuse-integrity-validator.mjs"), readFileSync(validatorPath));
  const files = Object.fromEntries(["clean-snapshot.json", "image-preflight.json", "image-source-files.json", "image-source.tar.gz", "local-preflight.json", "local-source-files.json", "preflight-parity.json", "reuse-allowed-differences.json", "reuse-provenance.json"].map((name) => [name, "0".repeat(64)]));
  files["reuse-integrity-validator.mjs"] = sha(readFileSync(validatorPath));
  const bare = { schemaVersion: "glyph-reprojection-reference-reuse-preflight/v3", runId: mode === "cross-run" ? "run-other" : runId, immutableImageId: image, recomputedArchiveSha256: "b".repeat(64), files };
  const bundle = { ...bare, contentSha256: sha(canonical(bare)) };
  writeFileSync(join(bundleRoot, "bundle-manifest.json"), JSON.stringify(bundle));
  return { runDir, bundleRoot, bundleSha: sha(JSON.stringify(bundle)) };
};
writeFileSync(join(root, "fixtures.json"), JSON.stringify({ image, runId, cases: { crossRun: writeFixture("cross-run"), hash: writeFixture("hash") } }));
NODE
  for test_case in crossRun hash; do
    read -r run_path bundle_path bundle_sha < <(TEST_ROOT="$fixture" TEST_CASE="$test_case" node --input-type=module -e 'import{readFile}from"node:fs/promises";const x=JSON.parse(await readFile(`${process.env.TEST_ROOT}/fixtures.json`,"utf8"));const v=x.cases[process.env.TEST_CASE];process.stdout.write(`${v.runDir} ${v.bundleRoot} ${v.bundleSha}\n`);')
    err="$fixture/$test_case.err"
    if node "$validator" "$run_path" "$bundle_path" "sha256:$(printf 'a%.0s' {1..64})" "$bundle_sha" "$(printf 'b%.0s' {1..64})" run-good "$contract_sha256" "$event_sha256" "$measurement_contract_sha256" "$g5_signature_sha256" 2>"$err"; then
      rm -rf "$fixture"; echo "REFERENCE_REUSE_VALIDATOR_SELFTEST_EXPECTED_REJECT:$test_case" >&2; return 1
    else
      status=$?
    fi
    (( status != 0 )) && rg -q "REFERENCE_REUSE_$( [[ "$test_case" == crossRun ]] && printf 'BUNDLE_RUN_ID_BINDING' || printf 'FROZEN_CONTRACT_BINDING' )" "$err"
  done
  rm -rf "$fixture"
  printf 'B37 validator binding self-tests: cross-run + frozen-hash substitution rejected\n'
}

if [[ -n "${GLYPHCSS_REFERENCE_POSTLAUNCH_TEST_CASE:-}" ]]; then
  run_post_launch_self_test_case "$GLYPHCSS_REFERENCE_POSTLAUNCH_TEST_CASE"
fi
if [[ "${GLYPHCSS_REFERENCE_POSTLAUNCH_SELF_TEST:-0}" == "1" ]]; then
  run_post_launch_self_tests
  exit 0
fi
if [[ "${GLYPHCSS_REFERENCE_VALIDATOR_BINDING_SELF_TEST:-0}" == "1" ]]; then
  run_validator_binding_self_tests
  exit 0
fi

node research/ascii-image-generation/scripts/validate-reference-run-id.mjs "$run_id" >/dev/null
archive="$data_root/reference-browser/chrome-linux64-140.0.7339.80.zip"
source_archive="$(mktemp "${TMPDIR:-/tmp}/glyphcss-b37-source.XXXXXX.tgz")"
trap 'cleanup_temporary_files' EXIT
research/ascii-image-generation/scripts/audit-red-reference.sh
docker --context "$context" run --rm --user root --entrypoint bash --volume "$data_root:/artifacts" mcr.microsoft.com/playwright@sha256:6446946a1d9fd62d9ae501312a2d76a43ee688542b21622056a372959b65d63d -lc 'install -d -m 0750 -o pwuser -g users /artifacts/reference-browser; install -d -m 0750 -o pwuser -g users /artifacts/reference-browser/runs; chown pwuser:users /artifacts/reference-browser; chmod 0750 /artifacts/reference-browser'
if ! docker --context "$context" run --rm --entrypoint bash --volume "$data_root:/artifacts" mcr.microsoft.com/playwright@sha256:6446946a1d9fd62d9ae501312a2d76a43ee688542b21622056a372959b65d63d -lc 'test -f /artifacts/reference-browser/chrome-linux64-140.0.7339.80.zip && echo "7184052e2155f270dd49503b1c9c7163204f3a7bc0fba9bd9e746dde04eb0546  /artifacts/reference-browser/chrome-linux64-140.0.7339.80.zip" | sha256sum --check --strict'; then
  docker --context "$context" run --rm --user 1001:1001 --volume "$data_root:/artifacts" curlimages/curl:8.11.1 --fail --location --retry 3 --output "/artifacts/reference-browser/chrome-linux64-140.0.7339.80.zip" "https://storage.googleapis.com/chrome-for-testing-public/140.0.7339.80/linux64/chrome-linux64.zip"
fi
source_kind="built-source-archive"
source_original_archive_reason=""
reuse_metadata=""
if [[ -n "$reuse_image_id" ]]; then
  [[ "$reuse_image_id" == "$immutable_reuse_image_id" ]] || { echo "REFERENCE_REUSE_IMAGE_NOT_B37_IMMUTABLE" >&2; exit 1; }
  image_id="$(docker --context "$context" image inspect "$reuse_image_id" --format '{{.Id}}')"
  [[ "$image_id" == "$reuse_image_id" ]] || { echo "REFERENCE_REUSE_IMAGE_ID_DRIFT" >&2; exit 1; }
  image="$image_id"
  image_manifest="$(mktemp "${TMPDIR:-/tmp}/glyphcss-b37-image-files.XXXXXX.json")"
  local_manifest="$(mktemp "${TMPDIR:-/tmp}/glyphcss-b37-local-files.XXXXXX.json")"
  reuse_diff="$(mktemp "${TMPDIR:-/tmp}/glyphcss-b37-reuse-diff.XXXXXX.json")"
  reuse_provenance="$(mktemp "${TMPDIR:-/tmp}/glyphcss-b37-reuse-provenance.XXXXXX.json")"
  reuse_bundle_manifest="$(mktemp "${TMPDIR:-/tmp}/glyphcss-b37-reuse-bundle-manifest.XXXXXX.json")"
  local_preflight_file="$(mktemp "${TMPDIR:-/tmp}/glyphcss-b37-local-preflight.XXXXXX.json")"
  remote_preflight_file="$(mktemp "${TMPDIR:-/tmp}/glyphcss-b37-remote-preflight.XXXXXX.json")"
  clean_snapshot_file="$(mktemp "${TMPDIR:-/tmp}/glyphcss-b37-clean-snapshot.XXXXXX.json")"
  reuse_validator_file="$(mktemp "${TMPDIR:-/tmp}/glyphcss-b37-reuse-validator.XXXXXX.mjs")"
  docker --context "$context" run --rm --entrypoint node "$image_id" --input-type=module -e 'import {createHash} from "node:crypto"; import {readdir,readFile,stat} from "node:fs/promises"; import {join} from "node:path"; const roots=["package.json","pnpm-lock.yaml","pnpm-workspace.yaml","packages/core","packages/glyphcss","packages/compile","research/ascii-image-generation"]; const sha=x=>createHash("sha256").update(x).digest("hex"); const out={}; async function walk(path){const info=await stat(path);if(!info.isDirectory()){out[path]=sha(await readFile(path));return}for(const name of (await readdir(path)).sort()){if(["node_modules","dist","coverage"].includes(name))continue;await walk(join(path,name));}} for(const root of roots)await walk(root); process.stdout.write(JSON.stringify(out));' >"$image_manifest"
  archive_image_source() {
    IMAGE_MANIFEST="$image_manifest" node --input-type=module -e 'import{readFile}from"node:fs/promises";const x=JSON.parse(await readFile(process.env.IMAGE_MANIFEST,"utf8"));process.stdout.write(Buffer.from(Object.keys(x).sort().join("\0")+"\0"));' | docker --context "$context" run --rm --interactive --entrypoint bash "$image_id" -lc 'tar --null --no-recursion --sort=name --mtime="@0" --owner=0 --group=0 --numeric-owner --format=gnu -c -f - --files-from=- | gzip -n'
  }
  node --input-type=module - <<'NODE' >"$local_manifest"
import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
const roots = ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "packages/core", "packages/glyphcss", "packages/compile", "research/ascii-image-generation"];
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex"); const files = {};
async function walk(path) { const info = await stat(path); if (!info.isDirectory()) { files[path] = sha(await readFile(path)); return; } for (const name of (await readdir(path)).sort()) { if (["node_modules", "dist", "coverage"].includes(name)) continue; await walk(join(path, name)); } }
for (const root of roots) await walk(root); process.stdout.write(JSON.stringify(files));
NODE
  IMAGE_MANIFEST="$image_manifest" LOCAL_MANIFEST="$local_manifest" node --input-type=module - <<'NODE' >"$reuse_diff"
import { readFile } from "node:fs/promises";
const [local, image] = await Promise.all([process.env.LOCAL_MANIFEST, process.env.IMAGE_MANIFEST].map(async (path) => JSON.parse(await readFile(path, "utf8"))));
const allowedDifferences = [
  "research/ascii-image-generation/scripts/run-remote-reference-browser.sh",
  "research/ascii-image-generation/licenses/base-model/._CompVis-CreativeML-OpenRAIL-M.txt",
  "research/ascii-image-generation/licenses/base-model/._nota-ai-bk-sdm-small-model-card.md",
  "research/ascii-image-generation/reports/._base-model-preflight.json",
].sort();
const allowed = new Set(allowedDifferences);
const differences = [...new Set([...Object.keys(local), ...Object.keys(image)])].sort()
  .filter((path) => local[path] !== image[path])
  .map((path) => ({ path, localSha256: local[path] ?? null, imageSha256: image[path] ?? null, allowed: allowed.has(path) }));
if (differences.length !== allowed.size || differences.some((difference) => !difference.allowed)
  || new Set(differences.map((difference) => difference.path)).size !== allowed.size) throw new Error("REFERENCE_REUSE_SOURCE_DIFF_REJECTED");
const canonical = (value) => value === null || typeof value !== "object" ? JSON.stringify(value) : Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
const report = { schemaVersion: "glyph-reprojection-reference-reuse-diff/v1", allowedDifferences, differences };
process.stdout.write(`${JSON.stringify({ ...report, contentSha256: (await import("node:crypto")).createHash("sha256").update(canonical(report)).digest("hex") })}\n`);
NODE
  archive_image_source >"$source_archive"
  source_archive_sha256="$(shasum -a 256 "$source_archive" | awk '{print $1}')"
  source_file_set_sha256="$(IMAGE_MANIFEST="$image_manifest" node --input-type=module -e 'import {createHash} from "node:crypto";import{readFile}from"node:fs/promises";const x=JSON.parse(await readFile(process.env.IMAGE_MANIFEST,"utf8"));const c=v=>v===null||typeof v!=="object"?JSON.stringify(v):Array.isArray(v)?`[${v.map(c).join(",")}]`:`{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${c(v[k])}`).join(",")}}`;process.stdout.write(createHash("sha256").update(c(x)).digest("hex"));')"
  source_kind="reconstructed-from-immutable-image"
  source_original_archive_reason="Original build-context archive was not retained; this deterministic snapshot was reconstructed from the verified immutable image."
  IMAGE_ID="$image_id" IMAGE_MANIFEST="$image_manifest" REUSE_DIFF="$reuse_diff" SOURCE_ARCHIVE="$source_archive" SOURCE_FILE_SET_SHA256="$source_file_set_sha256" SOURCE_REASON="$source_original_archive_reason" node --input-type=module - <<'NODE' >"$reuse_provenance"
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
const sha = async (path) => createHash("sha256").update(await readFile(path)).digest("hex");
const imageFileManifestSha256 = await sha(process.env.IMAGE_MANIFEST);
const sourceSnapshotSha256 = await sha(process.env.SOURCE_ARCHIVE);
const allowedDifferenceReportSha256 = await sha(process.env.REUSE_DIFF);
for (const value of [imageFileManifestSha256, sourceSnapshotSha256, allowedDifferenceReportSha256, process.env.SOURCE_FILE_SET_SHA256]) {
  if (!/^[a-f0-9]{64}$/.test(value ?? "")) throw new Error("REFERENCE_REUSE_RECONSTRUCTION_MISSING");
}
process.stdout.write(`${JSON.stringify({ schemaVersion: "glyph-reprojection-reference-reuse-provenance/v1", kind: "reconstructed-from-immutable-image", imageId: process.env.IMAGE_ID, originalBuildArchiveSha256: null, originalBuildArchiveUnavailableReason: process.env.SOURCE_REASON, sourceSnapshotSha256, sourceFileSetSha256: process.env.SOURCE_FILE_SET_SHA256, imageFileManifestSha256, allowedDifferenceReportSha256, reuseLauncherSha256: await sha("research/ascii-image-generation/scripts/run-remote-reference-browser.sh") })}\n`);
NODE
  reuse_metadata="$(cat "$reuse_provenance")"
else
  echo "REFERENCE_REUSE_IMAGE_REQUIRED" >&2
  exit 1
fi
render_group="$(docker --context "$context" run --rm --gpus all --entrypoint bash "$image_id" -lc 'stat -c %g /dev/dri/renderD*')"
host_os="$(docker --context "$context" info --format '{{.OperatingSystem}}')"
local_preflight="$(node research/ascii-image-generation/scripts/preflight-reference-corpus.mjs)"
remote_preflight="$(docker --context "$context" run --rm --entrypoint node "$image_id" research/ascii-image-generation/scripts/preflight-reference-corpus.mjs)"
printf '%s\n' "$local_preflight" >"$local_preflight_file"
printf '%s\n' "$remote_preflight" >"$remote_preflight_file"
preflight_evidence="$(IMAGE_ID="$image_id" LOCAL_PREFLIGHT="$local_preflight" REMOTE_PREFLIGHT="$remote_preflight" node --input-type=module -e '
const local = JSON.parse(process.env.LOCAL_PREFLIGHT);
const remote = JSON.parse(process.env.REMOTE_PREFLIGHT);
const expectedManifest = "f8300d29c4fb0a3938c1ced4ac6cb989dd0cec9134ab00f2899c5ff7d1768cd3";
const canonical = (value) => value === null || typeof value !== "object" ? JSON.stringify(value) : Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
if (local.node !== "v22.14.0" || remote.node !== local.node || local.manifestContentSha256 !== expectedManifest
  || remote.manifestContentSha256 !== expectedManifest || remote.treeSha256 !== local.treeSha256
  || canonical(remote.hashes) !== canonical(local.hashes)
  || canonical(remote.sourceTreeHashes) !== canonical(local.sourceTreeHashes)) throw new Error("REFERENCE_CORPUS_LOCAL_REMOTE_PREFLIGHT_MISMATCH");
process.stdout.write(`${JSON.stringify({ schemaVersion: "glyph-reference-corpus-preflight-parity/v1", imageId: process.env.IMAGE_ID, expectedManifestSha256: expectedManifest, local, remote })}\n`);
')"
preflight_parity_file="$(mktemp "${TMPDIR:-/tmp}/glyphcss-b37-preflight-parity.XXXXXX.json")"
printf '%s\n' "$preflight_evidence" >"$preflight_parity_file"
ghost_id="30461f32f7827616cdf4a0965c32b75232e0433239a7cf94def1e3d22f06d45c"
ghost_top="$(docker --context "$context" top "$ghost_id" -eo pid 2>/dev/null | tail -n +2 || true)"
clean_snapshot="$(RUNNING_CONTAINERS="$(docker --context "$context" ps --format '{{json .}}')" CONTAINER_STATS="$(docker --context "$context" stats --no-stream --format '{{json .}}')" GHOST_TOP="$ghost_top" GHOST_ID="$ghost_id" GPU_STATE="$(docker --context "$context" run --rm --gpus all --entrypoint nvidia-smi mcr.microsoft.com/playwright@sha256:6446946a1d9fd62d9ae501312a2d76a43ee688542b21622056a372959b65d63d --query-gpu=utilization.gpu,memory.used --format=csv,noheader)" GPU_COMPUTE_APPS="$(docker --context "$context" run --rm --gpus all --entrypoint nvidia-smi mcr.microsoft.com/playwright@sha256:6446946a1d9fd62d9ae501312a2d76a43ee688542b21622056a372959b65d63d --query-compute-apps=pid,process_name,used_memory --format=csv,noheader)" node --input-type=module -e '
const lines = (value) => value.split("\n").filter(Boolean).map((line) => JSON.parse(line));
const computeApps = process.env.GPU_COMPUTE_APPS.trim();
if (computeApps && !/No running compute processes found/i.test(computeApps)) throw new Error(`REFERENCE_GPU_COMPETITOR_DETECTED:${computeApps}`);
const containers = lines(process.env.RUNNING_CONTAINERS), stats = lines(process.env.CONTAINER_STATS), ghostId = process.env.GHOST_ID;
const allowed = [ghostId, "e5202a8a8436d43df568a9d9ef1971f457683c3aad8b424dadb9f28b9817cdba"];
const resolved = (short) => allowed.filter((full) => full.startsWith(short));
if (containers.some((entry) => resolved(entry.ID).length !== 1)) throw new Error(`REFERENCE_CONTAINER_COMPETITOR_DETECTED:${JSON.stringify(containers)}`);
const ghost = containers.find((entry) => ghostId.startsWith(entry.ID)); const ghostStat = stats.find((entry) => ghostId.startsWith(entry.ID));
if (!ghost || process.env.GHOST_TOP.trim() || !ghostStat || Number.parseFloat(ghostStat.CPUPerc) !== 0) throw new Error("REFERENCE_ZERO_PROCESS_GHOST_INVALID");
if (!/^0\s*%/.test(process.env.GPU_STATE.trim())) throw new Error(`REFERENCE_GPU_UTILIZATION_NONZERO:${process.env.GPU_STATE}`);
process.stdout.write(`${JSON.stringify({ schemaVersion: "glyph-reprojection-reference-clean-snapshot/v3", capturedAt: new Date().toISOString(), zeroProcessGhost: { id: ghostId, dockerTop: process.env.GHOST_TOP || null, cpuPercent: ghostStat.CPUPerc }, allowedContainers: [ghostId, "e5202a8a8436d43df568a9d9ef1971f457683c3aad8b424dadb9f28b9817cdba"], runningContainers: containers, containerStats: stats, gpu: { utilization: process.env.GPU_STATE, computeApps: computeApps || null } })}\n`);
')"
printf '%s\n' "$clean_snapshot" >"$clean_snapshot_file"
cat >"$reuse_validator_file" <<'NODE'
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, writeFileSync, chownSync } from "node:fs";
import { basename } from "node:path";

const [runDir, bundleRoot, immutableImageId, expectedBundleSha, expectedRecomputedArchiveSha, expectedRunId, expectedContractSha256, expectedEventSha256, expectedMeasurementContractSha256, expectedG5SignatureSha256] = process.argv.slice(2);
const sha = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const read = (path) => JSON.parse(readFileSync(path, "utf8"));
const canonical = (value) => value === null || typeof value !== "object" ? JSON.stringify(value) : Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : `{${Object.keys(value).filter((key) => key !== "contentSha256").sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
const fail = (code) => { throw new Error(code); };
const output = (name) => `${runDir}/${name}`;
const isHash = (value) => /^[a-f0-9]{64}$/.test(value ?? "");
if (![runDir, bundleRoot, immutableImageId, expectedBundleSha, expectedRecomputedArchiveSha, expectedRunId, expectedContractSha256, expectedEventSha256, expectedMeasurementContractSha256, expectedG5SignatureSha256].every(Boolean) || ![expectedBundleSha, expectedRecomputedArchiveSha, expectedContractSha256, expectedEventSha256, expectedMeasurementContractSha256, expectedG5SignatureSha256].every(isHash)) fail("REFERENCE_REUSE_VALIDATOR_ARGUMENTS");
if (basename(runDir) !== expectedRunId) fail("REFERENCE_REUSE_RUN_DIR_ID_BINDING");
if (existsSync(output("reuse-integrity.json"))) fail("REFERENCE_REUSE_INTEGRITY_EXISTS");
if (existsSync(output("reuse-blocked.json"))) fail("REFERENCE_REUSE_BLOCKED_EXISTS");
const bundleManifestPath = `${bundleRoot}/bundle-manifest.json`;
if (sha(bundleManifestPath) !== expectedBundleSha) fail("REFERENCE_REUSE_BUNDLE_MANIFEST_DRIFT");
const bundle = read(bundleManifestPath);
const bundleBare = { schemaVersion: bundle.schemaVersion, runId: bundle.runId, immutableImageId: bundle.immutableImageId, recomputedArchiveSha256: bundle.recomputedArchiveSha256, files: bundle.files };
const expectedBundleFiles = ["bundle-manifest.json", "clean-snapshot.json", "image-preflight.json", "image-source-files.json", "image-source.tar.gz", "local-preflight.json", "local-source-files.json", "preflight-parity.json", "reuse-allowed-differences.json", "reuse-integrity-validator.mjs", "reuse-provenance.json"];
if (bundle.contentSha256 !== createHash("sha256").update(canonical(bundleBare)).digest("hex") || JSON.stringify(Object.keys(bundle.files).sort()) !== JSON.stringify(expectedBundleFiles.filter((name) => name !== "bundle-manifest.json").sort()) || bundle.immutableImageId !== immutableImageId || bundle.files["reuse-integrity-validator.mjs"] !== sha(`${bundleRoot}/reuse-integrity-validator.mjs`)) fail("REFERENCE_REUSE_VALIDATOR_BINDING");
if (bundle.runId !== expectedRunId) fail("REFERENCE_REUSE_BUNDLE_RUN_ID_BINDING");
const preflight = read(output("preflight.json"));
const environment = read(output("environment-manifest.json"));
const manifest = read(output("run-manifest.json"));
const trace = read(output("trace.json"));
const partial = read(output("evidence/reference-partial-evidence.json"));
const partialIntegrity = read(output("evidence/reference-partial-integrity.json"));
const exactRunIds = [environment.runId, partial.provenance?.runId, partialIntegrity.runId];
for (const value of exactRunIds) if (value !== expectedRunId) fail("REFERENCE_REUSE_RUN_ID_BINDING");
for (const value of [preflight.runId, manifest.runId]) if (value !== undefined && value !== expectedRunId) fail("REFERENCE_REUSE_RUN_ID_BINDING");
const frozenBindings = [
  trace.frozenTrace?.contractSha256, trace.frozenTrace?.eventSha256, trace.frozenTrace?.measurementContractSha256, trace.frozenTrace?.g5SignatureSha256,
  manifest.frozenTrace?.contractSha256, manifest.frozenTrace?.eventSha256, manifest.measurementContract?.sha256, manifest.measurementContract?.g5SignatureSha256,
  partial.contract?.sha256, partial.contract?.eventSha256, partial.measurementContract?.sha256, partial.measurementContract?.g5SignatureSha256,
  partialIntegrity.contractSha256, partialIntegrity.eventSha256, partialIntegrity.measurementContractSha256, partialIntegrity.g5SignatureSha256,
];
const frozenExpected = [expectedContractSha256, expectedEventSha256, expectedMeasurementContractSha256, expectedG5SignatureSha256];
for (let index = 0; index < frozenBindings.length; index += 4) {
  if (frozenBindings.slice(index, index + 4).some((value, offset) => value !== frozenExpected[offset])) fail("REFERENCE_REUSE_FROZEN_CONTRACT_BINDING");
}
for (const [name, digest] of Object.entries(bundle.files)) if (sha(`${bundleRoot}/${name}`) !== digest) fail(`REFERENCE_REUSE_BUNDLE_FILE_DRIFT:${name}`);
const imageFiles = read(`${bundleRoot}/image-source-files.json`);
const imageFileSetSha256 = createHash("sha256").update(canonical(imageFiles)).digest("hex");
const archive = `${bundleRoot}/image-source.tar.gz`;
const listing = execFileSync("tar", ["-tzf", archive], { encoding: "utf8" }).trim().split("\n").filter(Boolean);
if (listing.some((name) => name.endsWith("/") || name.startsWith("/") || name.includes("../"))) fail("REFERENCE_REUSE_ARCHIVE_PATH_INVALID");
const actualNames = [...new Set(listing)].sort();
const expectedNames = Object.keys(imageFiles).sort();
if (actualNames.length !== listing.length || JSON.stringify(actualNames) !== JSON.stringify(expectedNames)) fail("REFERENCE_REUSE_ARCHIVE_FILESET_DRIFT");
for (const name of actualNames) {
  const bytes = execFileSync("tar", ["-xOzf", archive, name], { maxBuffer: 128 * 1024 * 1024 });
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== imageFiles[name]) fail(`REFERENCE_REUSE_ARCHIVE_CONTENT_DRIFT:${name}`);
}
if (bundle.files["image-source.tar.gz"] !== sha(archive) || bundle.files["image-source-files.json"] !== sha(`${bundleRoot}/image-source-files.json`)) fail("REFERENCE_REUSE_ARCHIVE_BUNDLE_DRIFT");
if (expectedRecomputedArchiveSha !== bundle.recomputedArchiveSha256) fail("REFERENCE_REUSE_ARCHIVE_RECOMPUTE_DRIFT");
const postflight = read(output("postflight.json"));
const required = ["preflight.json", "environment-manifest.json", "run-manifest.json", "postflight.json", "trace.json", "trace.json.cdp-profile.json", "evidence/reference-partial-evidence.json", "evidence/reference-partial-integrity.json"];
for (const name of required) if (!lstatSync(output(name)).isFile()) fail(`REFERENCE_REUSE_REQUIRED_ARTIFACT:${name}`);
if (preflight.reusePreflight?.path !== bundleRoot || preflight.reusePreflight?.manifestSha256 !== expectedBundleSha) fail("REFERENCE_REUSE_PREFLIGHT_BINDING");
const provenance = read(`${bundleRoot}/reuse-provenance.json`);
if (provenance.imageId !== immutableImageId || provenance.sourceSnapshotSha256 !== sha(archive) || provenance.sourceFileSetSha256 !== imageFileSetSha256 || provenance.imageFileManifestSha256 !== sha(`${bundleRoot}/image-source-files.json`) || provenance.allowedDifferenceReportSha256 !== sha(`${bundleRoot}/reuse-allowed-differences.json`) || environment.image.id !== immutableImageId || manifest.image.id !== immutableImageId || environment.source.archiveSha256 !== sha(archive) || manifest.source.archiveSha256 !== sha(archive) || environment.source.fileSetSha256 !== imageFileSetSha256 || manifest.source.fileSetSha256 !== imageFileSetSha256) fail("REFERENCE_REUSE_RUN_BINDING");
const imagePreflight = read(`${bundleRoot}/image-preflight.json`), parity = read(`${bundleRoot}/preflight-parity.json`), selected = { node: imagePreflight.node, manifestContentSha256: imagePreflight.manifestContentSha256, treeSha256: imagePreflight.treeSha256, hashes: imagePreflight.hashes, sourceTreeHashes: imagePreflight.sourceTreeHashes };
if (postflight.schemaVersion !== "glyph-reprojection-reference-reuse-postflight/v1" || postflight.imageId !== immutableImageId || postflight.recomputedArchiveSha256 !== expectedRecomputedArchiveSha || canonical(postflight.selected) !== canonical(selected) || postflight.selectedSha256 !== createHash("sha256").update(JSON.stringify(selected)).digest("hex") || canonical(parity.remote) !== canonical(imagePreflight)) fail("REFERENCE_REUSE_POSTFLIGHT_BINDING");
if (manifest.hashes?.trace !== sha(output("trace.json")) || manifest.hashes?.cdpProfile !== sha(output("trace.json.cdp-profile.json")) || manifest.hashes?.environmentManifest !== sha(output("environment-manifest.json")) || manifest.hashes?.partialEvidence !== sha(output("evidence/reference-partial-evidence.json")) || manifest.hashes?.partialIntegrity !== sha(output("evidence/reference-partial-integrity.json"))) fail("REFERENCE_REUSE_RUN_MANIFEST_HASHES");
if (partial.schemaVersion !== "glyph-reprojection-reference-partial-evidence/v1" || partial.status !== "partial-non-pass" || partial.fullG5Pass !== false || partial.traceSha256 !== sha(output("trace.json")) || partial.latencyGate?.operator !== "<=" || partial.latencyGate?.threshold !== 33.3 || partial.latencyGate?.pass !== true || !Number.isFinite(partial.latencyGate?.actual) || partial.latencyGate.actual > 33.3 || partialIntegrity.artifactSha256 !== sha(output("evidence/reference-partial-evidence.json")) || partialIntegrity.environmentManifestSha256 !== sha(output("environment-manifest.json")) || partialIntegrity.contractSha256 !== partial.contract?.sha256 || partialIntegrity.eventSha256 !== partial.contract?.eventSha256 || partialIntegrity.resultChainSha256 !== partial.contract?.resultChainSha256 || partialIntegrity.measurementContractSha256 !== partial.measurementContract?.sha256 || partialIntegrity.g5SignatureSha256 !== partial.measurementContract?.g5SignatureSha256 || partialIntegrity.runId !== partial.provenance?.runId || partialIntegrity.imageId !== immutableImageId || partialIntegrity.sourceArchiveSha256 !== sha(archive) || partialIntegrity.sourceFileSetSha256 !== imageFileSetSha256) fail("REFERENCE_REUSE_PARTIAL_EVIDENCE");
const report = { schemaVersion: "glyph-reprojection-reference-reuse-integrity/v3", authority: "reuse-wrapper-only", fullG5Pass: false, immutableImageId, reusePreflight: { path: bundleRoot, bundleManifestSha256: expectedBundleSha, validatorSha256: sha(`${bundleRoot}/reuse-integrity-validator.mjs`) }, archive: { sourceSha256: sha(archive), imageFileManifestSha256: sha(`${bundleRoot}/image-source-files.json`), entries: actualNames.length, recomputedArchiveSha256: expectedRecomputedArchiveSha }, inImageArtifacts: Object.fromEntries(required.map((name) => [name, sha(output(name))])), partialEvidence: { p95: partial.latencyGate.actual, pass: partial.latencyGate.pass, fullG5Pass: partial.fullG5Pass } };
writeFileSync(output("reuse-integrity.json"), `${JSON.stringify(report, null, 2)}\n`, { flag: "wx", mode: 0o400 });
chownSync(output("reuse-integrity.json"), 0, 0);
NODE

# The retained reconstruction belongs to an exclusive sibling.  The image only
# sees the small preflight binding, so its own artifact writer cannot modify or
# accidentally consume the host-side authority records.
recomputed_archive="$(mktemp "${TMPDIR:-/tmp}/glyphcss-b37-recomputed-source.XXXXXX.tgz")"
archive_image_source >"$recomputed_archive"
recomputed_archive_sha256="$(shasum -a 256 "$recomputed_archive" | awk '{print $1}')"
[[ "$recomputed_archive_sha256" == "$source_archive_sha256" ]] || { echo "REFERENCE_REUSE_ARCHIVE_RECOMPUTE_DRIFT" >&2; exit 1; }
bundle_root="/artifacts/reference-browser/reuse-preflight/$run_id"
bundle_stage="$bundle_root.staging.$$"
IMAGE_MANIFEST="$image_manifest" LOCAL_MANIFEST="$local_manifest" REUSE_DIFF="$reuse_diff" REUSE_PROVENANCE="$reuse_provenance" LOCAL_PREFLIGHT_FILE="$local_preflight_file" REMOTE_PREFLIGHT_FILE="$remote_preflight_file" PREFLIGHT_PARITY_FILE="$preflight_parity_file" CLEAN_SNAPSHOT_FILE="$clean_snapshot_file" REUSE_VALIDATOR_FILE="$reuse_validator_file" SOURCE_ARCHIVE="$source_archive" RECOMPUTED_ARCHIVE_SHA256="$recomputed_archive_sha256" IMAGE_ID="$image_id" RUN_ID="$run_id" node --input-type=module - <<'NODE' >"$reuse_bundle_manifest"
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
const canonical = (value) => value === null || typeof value !== "object" ? JSON.stringify(value) : Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
const sha = async (path) => createHash("sha256").update(await readFile(path)).digest("hex");
const files = Object.fromEntries(await Promise.all(Object.entries({
  "image-source.tar.gz": process.env.SOURCE_ARCHIVE,
  "image-source-files.json": process.env.IMAGE_MANIFEST,
  "local-source-files.json": process.env.LOCAL_MANIFEST,
  "reuse-allowed-differences.json": process.env.REUSE_DIFF,
  "reuse-provenance.json": process.env.REUSE_PROVENANCE,
  "local-preflight.json": process.env.LOCAL_PREFLIGHT_FILE,
  "image-preflight.json": process.env.REMOTE_PREFLIGHT_FILE,
  "preflight-parity.json": process.env.PREFLIGHT_PARITY_FILE,
  "clean-snapshot.json": process.env.CLEAN_SNAPSHOT_FILE,
  "reuse-integrity-validator.mjs": process.env.REUSE_VALIDATOR_FILE,
}).map(async ([name, path]) => [name, await sha(path)])));
const report = { schemaVersion: "glyph-reprojection-reference-reuse-preflight/v3", runId: process.env.RUN_ID, immutableImageId: process.env.IMAGE_ID, recomputedArchiveSha256: process.env.RECOMPUTED_ARCHIVE_SHA256, files };
process.stdout.write(`${JSON.stringify({ ...report, contentSha256: createHash("sha256").update(canonical(report)).digest("hex") }, null, 2)}\n`);
NODE
for artifact in "$source_archive:image-source.tar.gz" "$image_manifest:image-source-files.json" "$local_manifest:local-source-files.json" "$reuse_diff:reuse-allowed-differences.json" "$reuse_provenance:reuse-provenance.json" "$local_preflight_file:local-preflight.json" "$remote_preflight_file:image-preflight.json" "$preflight_parity_file:preflight-parity.json" "$clean_snapshot_file:clean-snapshot.json" "$reuse_validator_file:reuse-integrity-validator.mjs" "$reuse_bundle_manifest:bundle-manifest.json"; do
  local_path="${artifact%%:*}"; remote_name="${artifact#*:}"
  cat "$local_path" | docker --context "$context" run --rm --interactive --user root --entrypoint bash --volume "$data_root:/artifacts" --env "BUNDLE_STAGE=$bundle_stage" --env "REMOTE_NAME=$remote_name" mcr.microsoft.com/playwright@sha256:6446946a1d9fd62d9ae501312a2d76a43ee688542b21622056a372959b65d63d -lc 'install -d -m 0700 -o root -g root "$BUNDLE_STAGE"; target="$BUNDLE_STAGE/$REMOTE_NAME"; test ! -e "$target"; cat >"$target"; chown root:root "$target"; chmod 0400 "$target"'
done
bundle_manifest_sha256="$(shasum -a 256 "$reuse_bundle_manifest" | awk '{print $1}')"
docker --context "$context" run --rm --user root --entrypoint bash --volume "$data_root:/artifacts" --env "BUNDLE_STAGE=$bundle_stage" --env "BUNDLE_ROOT=$bundle_root" --env "EXPECTED_SHA=$bundle_manifest_sha256" mcr.microsoft.com/playwright@sha256:6446946a1d9fd62d9ae501312a2d76a43ee688542b21622056a372959b65d63d -lc 'test ! -e "$BUNDLE_ROOT"; test -d "$BUNDLE_STAGE"; test "$(find "$BUNDLE_STAGE" -mindepth 1 -maxdepth 1 -type f | wc -l | tr -d " ")" = 11; test -z "$(find "$BUNDLE_STAGE" -mindepth 1 -maxdepth 1 ! -type f -print -quit)"; test "$(sha256sum "$BUNDLE_STAGE/bundle-manifest.json" | awk "{print \$1}")" = "$EXPECTED_SHA"; chmod 0500 "$BUNDLE_STAGE"; mv "$BUNDLE_STAGE" "$BUNDLE_ROOT"'
preflight_evidence="$(PREFLIGHT_EVIDENCE="$preflight_evidence" BUNDLE_ROOT="$bundle_root" BUNDLE_SHA="$bundle_manifest_sha256" node --input-type=module -e 'const x=JSON.parse(process.env.PREFLIGHT_EVIDENCE); x.reusePreflight={path:process.env.BUNDLE_ROOT,manifestSha256:process.env.BUNDLE_SHA}; process.stdout.write(JSON.stringify(x));')"
printf '%s' "$preflight_evidence" | docker --context "$context" run --rm --interactive --user root --entrypoint bash --volume "$data_root:/artifacts" --env "GLYPHCSS_REFERENCE_RUN_ID=$run_id" mcr.microsoft.com/playwright@sha256:6446946a1d9fd62d9ae501312a2d76a43ee688542b21622056a372959b65d63d -lc 'run_dir="/artifacts/reference-browser/runs/$GLYPHCSS_REFERENCE_RUN_ID"; test ! -e "$run_dir"; install -d -m 0750 -o pwuser -g users "$run_dir"; (umask 027; cat >"$run_dir/preflight.json"); chown pwuser:users "$run_dir/preflight.json"'
diagnostic_env=()
if [[ "${GLYPHCSS_REFERENCE_PHASE_DIAGNOSTICS:-0}" == "1" ]]; then
  diagnostic_env+=(--env GLYPHCSS_REFERENCE_PHASE_DIAGNOSTICS=1 --env "GLYPHCSS_REFERENCE_DIAGNOSTIC_RUNS=${GLYPHCSS_REFERENCE_DIAGNOSTIC_RUNS:-1}")
fi
run_reference() {
  docker --context "$context" run --rm --gpus all --ipc=host --group-add "$render_group" --volume "$data_root:/artifacts" --env NODE_OPTIONS=--max-old-space-size=16384 --env GLYPHCSS_REFERENCE_TIMEOUT_MS=1800000 --env GLYPHCSS_WEBGPU_PRESENTATION=1 --env GLYPHCSS_REFERENCE_HEADFUL=1 --env VULKAN_ICD_FILENAMES=/etc/vulkan/icd.d/nvidia_icd.json --env "GLYPHCSS_REFERENCE_RUN_DIR=/artifacts/reference-browser/runs/$run_id" --env "GLYPHCSS_REFERENCE_IMAGE_ID=$image_id" --env "GLYPHCSS_REFERENCE_SOURCE_ARCHIVE_SHA256=$source_archive_sha256" --env "GLYPHCSS_REFERENCE_SOURCE_FILE_SET_SHA256=$source_file_set_sha256" --env "GLYPHCSS_REFERENCE_SOURCE_KIND=$source_kind" --env "GLYPHCSS_REFERENCE_SOURCE_ORIGINAL_ARCHIVE_REASON=$source_original_archive_reason" --env "GLYPHCSS_REFERENCE_REUSE_METADATA=$reuse_metadata" --env "GLYPHCSS_REFERENCE_HOST_OS=$host_os" --env "GLYPHCSS_REFERENCE_CONTRACT_SHA256=$contract_sha256" --env "GLYPHCSS_REFERENCE_EVENT_SHA256=$event_sha256" --env "GLYPHCSS_MEASUREMENT_CONTRACT_SHA256=$measurement_contract_sha256" --env "GLYPHCSS_G5_SIGNATURE_SHA256=$g5_signature_sha256" "$@" "$image_id"
}
verify_reuse_bundle() {
  docker --context "$context" run --rm --user root --entrypoint bash --volume "$data_root:/artifacts" --env "BUNDLE_ROOT=$bundle_root" --env "EXPECTED_IMAGE=$immutable_reuse_image_id" --env "EXPECTED_MANIFEST=$bundle_manifest_sha256" mcr.microsoft.com/playwright@sha256:6446946a1d9fd62d9ae501312a2d76a43ee688542b21622056a372959b65d63d -lc 'set -euo pipefail; names=(image-source.tar.gz image-source-files.json local-source-files.json reuse-allowed-differences.json reuse-provenance.json local-preflight.json image-preflight.json preflight-parity.json clean-snapshot.json reuse-integrity-validator.mjs bundle-manifest.json); test "$(stat -c "%u:%a" "$BUNDLE_ROOT")" = "0:500"; test "$(find "$BUNDLE_ROOT" -mindepth 1 -maxdepth 1 -printf "%f\n" | LC_ALL=C sort)" = "$(printf "%s\n" "${names[@]}" | LC_ALL=C sort)"; for n in "${names[@]}"; do test -f "$BUNDLE_ROOT/$n"; test ! -L "$BUNDLE_ROOT/$n"; test "$(stat -c "%u:%a" "$BUNDLE_ROOT/$n")" = "0:400"; done; test "$(sha256sum "$BUNDLE_ROOT/bundle-manifest.json" | awk "{print \$1}")" = "$EXPECTED_MANIFEST"; grep -Fq "\"immutableImageId\": \"$EXPECTED_IMAGE\"" "$BUNDLE_ROOT/bundle-manifest.json"; grep -Fq "glyph-reference-corpus-preflight-parity/v1" "$BUNDLE_ROOT/preflight-parity.json"; for p in research/ascii-image-generation/licenses/base-model/._CompVis-CreativeML-OpenRAIL-M.txt research/ascii-image-generation/licenses/base-model/._nota-ai-bk-sdm-small-model-card.md research/ascii-image-generation/reports/._base-model-preflight.json research/ascii-image-generation/scripts/run-remote-reference-browser.sh; do grep -Fq "\"path\":\"$p\"" "$BUNDLE_ROOT/reuse-allowed-differences.json"; done; test "$(grep -o "\"path\":" "$BUNDLE_ROOT/reuse-allowed-differences.json" | wc -l | tr -d " ")" = 4'
}
verify_reuse_bundle
reference_exit=0
activate_post_launch_guard
if (( ${#diagnostic_env[@]} )); then run_reference "${diagnostic_env[@]}" || reference_exit=$?; else run_reference || reference_exit=$?; fi
if [[ "$source_kind" == "reconstructed-from-immutable-image" ]]; then
  set_post_launch_phase "bundle-recheck"
  verify_reuse_bundle
  if (( reference_exit )); then
    set_post_launch_phase "benchmark"
    exit "$reference_exit"
  fi
  set_post_launch_phase "post-image-inspect"
  post_image_id="$(docker --context "$context" image inspect "$immutable_reuse_image_id" --format '{{.Id}}')"
  [[ "$post_image_id" == "$immutable_reuse_image_id" ]] || { echo "REFERENCE_REUSE_POST_IMAGE_DRIFT" >&2; exit 1; }
  set_post_launch_phase "archive-recompute"
  post_archive="$(mktemp "${TMPDIR:-/tmp}/glyphcss-b37-post-source.XXXXXX.tgz")"
  archive_image_source >"$post_archive"
  [[ "$(shasum -a 256 "$post_archive" | awk '{print $1}')" == "$recomputed_archive_sha256" ]] || { echo "REFERENCE_REUSE_POST_ARCHIVE_DRIFT" >&2; exit 1; }
  set_post_launch_phase "post-preflight"
  post_preflight="$(docker --context "$context" run --rm --entrypoint node "$image_id" research/ascii-image-generation/scripts/preflight-reference-corpus.mjs)"
  IMAGE_ID="$image_id" LOCAL_PREFLIGHT="$local_preflight" REMOTE_PREFLIGHT="$post_preflight" node --input-type=module -e 'const l=JSON.parse(process.env.LOCAL_PREFLIGHT),r=JSON.parse(process.env.REMOTE_PREFLIGHT),c=v=>v===null||typeof v!=="object"?JSON.stringify(v):Array.isArray(v)?`[${v.map(c).join(",")}]`:`{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${c(v[k])}`).join(",")}}`;if(l.node!==r.node||l.manifestContentSha256!==r.manifestContentSha256||l.treeSha256!==r.treeSha256||c(l.hashes)!==c(r.hashes)||c(l.sourceTreeHashes)!==c(r.sourceTreeHashes))throw Error("REFERENCE_REUSE_POST_PREFLIGHT_DRIFT");'
  set_post_launch_phase "postflight-write"
  postflight="$(IMAGE_ID="$post_image_id" PREFLIGHT="$post_preflight" ARCHIVE_SHA="$recomputed_archive_sha256" node --input-type=module -e 'import{createHash}from"node:crypto";const p=JSON.parse(process.env.PREFLIGHT);const selected={node:p.node,manifestContentSha256:p.manifestContentSha256,treeSha256:p.treeSha256,hashes:p.hashes,sourceTreeHashes:p.sourceTreeHashes};process.stdout.write(JSON.stringify({schemaVersion:"glyph-reprojection-reference-reuse-postflight/v1",imageId:process.env.IMAGE_ID,recomputedArchiveSha256:process.env.ARCHIVE_SHA,selected,selectedSha256:createHash("sha256").update(JSON.stringify(selected)).digest("hex")},null,2)+"\n");')"
  printf '%s' "$postflight" | docker --context "$context" run --rm --interactive --user root --entrypoint bash --volume "$data_root:/artifacts" --env "RUN_DIR=/artifacts/reference-browser/runs/$run_id" mcr.microsoft.com/playwright@sha256:6446946a1d9fd62d9ae501312a2d76a43ee688542b21622056a372959b65d63d -lc 'test -d "$RUN_DIR"; test ! -e "$RUN_DIR/postflight.json"; cat >"$RUN_DIR/postflight.json"; chown root:root "$RUN_DIR/postflight.json"; chmod 0400 "$RUN_DIR/postflight.json"'
  set_post_launch_phase "validator"
  docker --context "$context" run --rm --user root --entrypoint node --volume "$data_root:/artifacts" mcr.microsoft.com/playwright@sha256:6446946a1d9fd62d9ae501312a2d76a43ee688542b21622056a372959b65d63d "$bundle_root/reuse-integrity-validator.mjs" "/artifacts/reference-browser/runs/$run_id" "$bundle_root" "$image_id" "$bundle_manifest_sha256" "$recomputed_archive_sha256" "$run_id" "$contract_sha256" "$event_sha256" "$measurement_contract_sha256" "$g5_signature_sha256"
  post_launch_validator_published=1
  validate_and_deactivate_post_launch_guard
  exit 0
fi
exit "$reference_exit"
