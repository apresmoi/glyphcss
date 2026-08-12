#!/usr/bin/env bash
set -uo pipefail

: "${GLYPHCSS_ASSET_BINDING_RUN_DIR:?GLYPHCSS_ASSET_BINDING_RUN_DIR is required}"
run_dir="$GLYPHCSS_ASSET_BINDING_RUN_DIR"
if ! mkdir "$run_dir"; then
  echo "Asset binding browser run directory already exists: $run_dir" >&2
  exit 1
fi

hash_file() { sha256sum "$1" | awk '{print $1}'; }
provenance_errors="$run_dir/provenance-errors.txt"
: >"$provenance_errors"
record_provenance_error() { printf '%s\n' "$1" >>"$provenance_errors"; }
archive="$run_dir/source-tree.tar"
if ! tar --sort=name --mtime='UTC 1970-01-01' --owner=0 --group=0 --numeric-owner \
  --exclude='*/node_modules' --exclude='*/dist' --exclude='*/.astro' \
  -cf "$archive" package.json pnpm-lock.yaml pnpm-workspace.yaml packages research/ascii-image-generation website; then
  record_provenance_error "source archive creation failed"
fi
if [[ -s "$archive" ]]; then hash_file "$archive" >"$run_dir/source-tree.sha256" || record_provenance_error "source archive hashing failed"; else record_provenance_error "source archive is missing or empty"; fi
if ! (set -o pipefail; find package.json pnpm-lock.yaml pnpm-workspace.yaml packages research/ascii-image-generation website \
  -path '*/node_modules' -prune -o -path '*/dist' -prune -o -path '*/.astro' -prune -o -type f -print0 \
  | sort -z | xargs -0 sha256sum >"$run_dir/transitive-source.sha256"); then record_provenance_error "transitive source hashing failed"; fi
(
  env_exit=0
  printf 'image_id=%s\n' "${GLYPHCSS_ASSET_BINDING_IMAGE_ID:-unknown}"
  printf 'node='; node --version || env_exit=1
  printf 'pnpm='; pnpm --version || env_exit=1
  printf 'playwright='; pnpm --dir research/ascii-image-generation exec playwright --version || env_exit=1
  printf 'chromium_executable='; chromium_path="$(pnpm --dir research/ascii-image-generation exec node --input-type=module -e 'import { chromium } from "playwright"; process.stdout.write(chromium.executablePath())')" || env_exit=1; printf '%s\n' "${chromium_path:-}"
  printf 'chromium='; if [[ -n "${chromium_path:-}" ]]; then "$chromium_path" --version || env_exit=1; else env_exit=1; fi
  uname -a || env_exit=1
  cat /etc/os-release || env_exit=1
  exit "$env_exit"
) >"$run_dir/environment.txt" 2>&1 || record_provenance_error "browser environment capture failed"

server_pid=""
cleanup() {
  if [[ -n "$server_pid" ]]; then kill "$server_pid" 2>/dev/null || true; wait "$server_pid" 2>/dev/null || true; fi
}
trap cleanup EXIT

pnpm --filter @glyphcss/website exec astro dev --host 127.0.0.1 --port 43219 --strictPort >"$run_dir/server.log" 2>&1 &
server_pid=$!
server_ready=0
node --input-type=module <<'NODE' >"$run_dir/server-ready.log" 2>&1
import net from "node:net";
const deadline = Date.now() + 30_000;
await new Promise((resolve, reject) => {
  const poll = () => {
    const probe = net.connect(43219, "127.0.0.1");
    probe.once("connect", () => { probe.destroy(); resolve(); });
    probe.once("error", () => Date.now() >= deadline ? reject(new Error("website server did not start")) : setTimeout(poll, 100));
  };
  poll();
});
NODE
server_ready=$?

export GLYPHCSS_GALLERY_URL=http://127.0.0.1:43219
export GLYPHCSS_REPO_ROOT=/workspace
export PLAYWRIGHT_JSON_OUTPUT_NAME="$run_dir/results.json"
test_exit=1
if [[ "$server_ready" -eq 0 ]]; then
  pnpm --dir research/ascii-image-generation exec playwright test \
    --config playwright.config.ts \
    browser/asset-render-binding.spec.ts \
    --list >"$run_dir/test-discovery.log" 2>&1
  discovery_exit=$?
  if [[ "$discovery_exit" -eq 0 ]] && grep -q 'asset-render-binding-browser' "$run_dir/test-discovery.log"; then
    pnpm --dir research/ascii-image-generation exec playwright test \
      --config playwright.config.ts \
      browser/asset-render-binding.spec.ts \
      --workers=1 \
      --output "$run_dir/test-results" \
      --reporter=line,json >"$run_dir/test.log" 2>&1
    test_exit=$?
  else
    test_exit=1
    cat "$run_dir/test-discovery.log" >"$run_dir/test.log"
  fi
else
  discovery_exit=1
  cp "$run_dir/server-ready.log" "$run_dir/test.log"
fi
printf '%s\n' "$discovery_exit" >"$run_dir/discovery-exit.txt"
printf '%s\n' "$test_exit" >"$run_dir/exit-code.txt"

node --input-type=module - "$run_dir" <<'NODE'
import { createHash } from "node:crypto";
import { readFile, readdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

const [runDir] = process.argv.slice(2);
const hash = async (path) => createHash("sha256").update(await readFile(path)).digest("hex");
const exists = async (path) => { try { await readFile(path); return true; } catch { return false; } };
const files = ["source-tree.tar", "source-tree.sha256", "transitive-source.sha256", "environment.txt", "provenance-errors.txt", "server.log", "server-ready.log", "test-discovery.log", "discovery-exit.txt", "test.log", "results.json", "exit-code.txt"];
const reportPath = "research/ascii-image-generation/reports/asset-render-bindings.json";
const report = JSON.parse(await readFile(reportPath, "utf8"));
const readJsonFiles = async (path) => {
  let entries = [];
  try { entries = await readdir(path, { withFileTypes: true }); } catch { return []; }
  return (await Promise.all(entries.map(async (entry) => entry.isDirectory() ? readJsonFiles(join(path, entry.name)) : entry.name.endsWith(".json") ? [join(path, entry.name)] : []))).flat();
};
const findAttachment = (value, found = []) => {
  if (value && typeof value === "object") {
    if (value.name === "asset-render-binding-evidence" && value.contentType === "application/json" && typeof value.body === "string") found.push(value);
    for (const child of Array.isArray(value) ? value : Object.values(value)) findAttachment(child, found);
  }
  return found;
};
const evidencePaths = [];
for (const path of new Set([join(runDir, "results.json"), ...(await readJsonFiles(join(runDir, "test-results")))])) if (await exists(path)) evidencePaths.push(path);
const attachments = [];
for (const path of evidencePaths) {
  try { findAttachment(JSON.parse(await readFile(path, "utf8")), attachments); } catch { /* an unrelated JSON reporter file is not evidence */ }
}
const exitCode = (await readFile(join(runDir, "exit-code.txt"), "utf8")).trim();
let evidenceError = null;
if (attachments.length !== 1) evidenceError = `expected one browser evidence attachment, found ${attachments.length}`;
let attachment = null, attachmentBytes = null;
if (!evidenceError) {
  try {
    attachmentBytes = Buffer.from(attachments[0].body, "base64");
    attachment = JSON.parse(attachmentBytes.toString("utf8"));
    if (attachment.schemaVersion !== "glyph-asset-render-binding-browser/v2") evidenceError = "browser evidence attachment has an unexpected schema";
  } catch (error) { evidenceError = `browser evidence attachment is not valid base64 JSON: ${error.message}`; }
}
if (!evidenceError && attachment.reportSha256 !== report.contentSha256) evidenceError = "browser evidence report hash does not match sealed Node report";
if (!evidenceError && (!Array.isArray(attachment.records) || attachment.records.length !== report.sourceCoverage.length)) evidenceError = "browser evidence source count does not match sealed Node report";
if (!evidenceError) {
  const expectedPaths = new Set(report.sourceCoverage.map((source) => source.sourcePath));
  const actualPaths = attachment.records.map((record) => record.sourcePath);
  if (new Set(actualPaths).size !== expectedPaths.size || actualPaths.some((path) => !expectedPaths.has(path))) evidenceError = "browser evidence source paths do not match sealed Node report";
}
let decoderParity = null;
if (!evidenceError) {
  const parityRecords = [];
  for (const source of report.sourceCoverage) {
    const actual = attachment.records.find((record) => record.sourcePath === source.sourcePath);
    const expectedBytes = source.baseColorSources.map((entry) => entry.byteSha256).sort();
    if (JSON.stringify(actual.samplerByteSha256s) !== JSON.stringify(expectedBytes)) { evidenceError = `browser sampler byte set differs: ${source.sourcePath}`; break; }
    for (const expected of source.baseColorSources) {
      const browser = actual.records.find((record) => record.textureId === expected.textureId);
      if (!browser || browser.width !== expected.width || browser.height !== expected.height || browser.uvBound !== true || JSON.stringify(browser.sampleUv) !== JSON.stringify(expected.sample.uv)) { evidenceError = `browser texture binding differs: ${source.sourcePath}/${expected.textureId}`; break; }
      if (!browser.directSample || !Array.isArray(browser.directSample.rgba) || browser.directSample.rgba.length !== 4) { evidenceError = `browser direct sample is missing: ${source.sourcePath}/${expected.textureId}`; break; }
      if (!browser.rendererSample || browser.rendererSample.coverage !== 1 || JSON.stringify(browser.rendererSample.rgb) !== JSON.stringify(browser.directSample.rgba.slice(0, 3))) { evidenceError = `browser renderer/native sampler transport differs: ${source.sourcePath}/${expected.textureId}`; break; }
      const decodedMatches = browser.decodedPixelSha256 === expected.decodedPixelSha256;
      const exactUvSampleMatches = browser.directSample.rgba.every((value, index) => value === expected.sample.rgba[index]);
      parityRecords.push({ sourcePath: source.sourcePath, canonicalAssetId: source.canonicalAssetId, textureId: expected.textureId, sampleUv: expected.sample.uv, node: { decodedPixelSha256: expected.decodedPixelSha256, rgba: expected.sample.rgba }, browser: { decodedPixelSha256: browser.decodedPixelSha256, rgba: browser.directSample.rgba }, decodedMatches, exactUvSampleMatches });
    }
    if (evidenceError) break;
  }
  const unique = (records) => [...new Map(records.map((record) => [record.textureId, record])).values()];
  const derivedBase = {
    sourceRecords: parityRecords.length,
    uniqueTextures: unique(parityRecords).length,
    sourceDecodedHashMismatches: parityRecords.filter((record) => !record.decodedMatches),
    uniqueDecodedHashMismatches: unique(parityRecords.filter((record) => !record.decodedMatches)),
    sourceExactUvSampleMismatches: parityRecords.filter((record) => !record.exactUvSampleMatches),
    uniqueExactUvSampleMismatches: unique(parityRecords.filter((record) => !record.exactUvSampleMatches)),
  };
  const derived = {
    ...derivedBase,
    b44ExactSharedDecoderStatus: derivedBase.sourceDecodedHashMismatches.length === 0
      && derivedBase.uniqueDecodedHashMismatches.length === 0
      && derivedBase.sourceExactUvSampleMismatches.length === 0
      && derivedBase.uniqueExactUvSampleMismatches.length === 0 ? "pass" : "fail",
    browserNodeDecoderStatus: derivedBase.sourceDecodedHashMismatches.length === 0
      && derivedBase.uniqueDecodedHashMismatches.length === 0
      && derivedBase.sourceExactUvSampleMismatches.length === 0
      && derivedBase.uniqueExactUvSampleMismatches.length === 0 ? "pass" : "fail",
  };
  if (!evidenceError && JSON.stringify(attachment.decoderParity) !== JSON.stringify(derived)) evidenceError = "browser decoder parity summary does not exactly describe the attached records";
  decoderParity = derived;
}
const artifactHashes = {};
for (const file of files) if (await exists(join(runDir, file))) artifactHashes[file] = await hash(join(runDir, file));
for (const path of evidencePaths) artifactHashes[path.slice(runDir.length + 1)] = await hash(path);
const provenanceError = [];
for (const file of ["source-tree.tar", "source-tree.sha256", "transitive-source.sha256", "environment.txt", "test-discovery.log", "discovery-exit.txt", "test.log", "results.json", "exit-code.txt"]) {
  if (!artifactHashes[file]) provenanceError.push(`mandatory artifact missing or empty: ${file}`);
}
if ((await readFile(join(runDir, "provenance-errors.txt"), "utf8")).trim()) provenanceError.push(...(await readFile(join(runDir, "provenance-errors.txt"), "utf8")).trim().split("\n"));
const archiveDeclaredHash = await exists(join(runDir, "source-tree.sha256")) ? (await readFile(join(runDir, "source-tree.sha256"), "utf8")).trim().split(/\s+/)[0] : null;
if (archiveDeclaredHash !== artifactHashes["source-tree.tar"]) provenanceError.push("source archive hash does not match source-tree.sha256");
const environment = await exists(join(runDir, "environment.txt")) ? await readFile(join(runDir, "environment.txt"), "utf8") : "";
if (!/^playwright=Version \S+/m.test(environment) || !/^chromium=\S.+\d/m.test(environment)) provenanceError.push("environment does not contain exact Playwright and Chromium product/version lines");
if ((process.env.GLYPHCSS_ASSET_BINDING_IMAGE_ID ?? "") === "" || (process.env.GLYPHCSS_ASSET_BINDING_IMAGE_ID ?? "") === "unknown") provenanceError.push("immutable image ID is missing");
if ((await readFile(join(runDir, "discovery-exit.txt"), "utf8")).trim() !== "0") provenanceError.push("exact browser test discovery did not succeed");
const raw = {
  schemaVersion: "glyph-asset-render-binding-browser-run/v3",
  verdict: exitCode === "0" && !evidenceError && provenanceError.length === 0 ? "pass" : "fail",
  exitCode: Number(exitCode),
  reportSha256: await hash(reportPath),
  reportContentSha256: report.contentSha256,
  imageId: process.env.GLYPHCSS_ASSET_BINDING_IMAGE_ID ?? null,
  sourceArchive: { path: "source-tree.tar", sha256: artifactHashes["source-tree.tar"] ?? null },
  transitiveSourceSha256: artifactHashes["transitive-source.sha256"] ?? null,
  browserEvidence: attachment ? { records: attachment.records.length, attachmentName: attachments[0].name, attachmentPaths: evidencePaths.map((path) => path.slice(runDir.length + 1)), sha256: createHash("sha256").update(attachmentBytes).digest("hex") } : null,
  decoderParity,
  evidenceError,
  provenanceError,
  artifactHashes,
};
const manifest = { ...raw, contentSha256: createHash("sha256").update(JSON.stringify(raw)).digest("hex") };
const temporary = join(runDir, `.run-manifest-${process.pid}.tmp`);
await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`);
await rename(temporary, join(runDir, "run-manifest.json"));
if (manifest.verdict !== "pass") process.exitCode = 1;
NODE
manifest_exit=$?
cat "$run_dir/test.log"
if [[ "$test_exit" -ne 0 || "$manifest_exit" -ne 0 ]]; then exit 1; fi
