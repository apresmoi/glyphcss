#!/usr/bin/env bash
set -uo pipefail

: "${GLYPHCSS_ASSET_SEMANTIC_PARITY_RUN_DIR:?GLYPHCSS_ASSET_SEMANTIC_PARITY_RUN_DIR is required}"
: "${GLYPHCSS_ASSET_SEMANTIC_PARITY_IMAGE_ID:?GLYPHCSS_ASSET_SEMANTIC_PARITY_IMAGE_ID is required}"
run_dir="$GLYPHCSS_ASSET_SEMANTIC_PARITY_RUN_DIR"
if [[ -e "$run_dir" ]]; then echo "Semantic parity run directory already exists: $run_dir" >&2; exit 1; fi
mkdir -p "$run_dir"
hash_file() { sha256sum "$1" | awk '{print $1}'; }
archive="$run_dir/source-tree.tar"
tar --sort=name --mtime='UTC 1970-01-01' --owner=0 --group=0 --numeric-owner --exclude='*/node_modules' --exclude='*/dist' --exclude='*/.astro' -cf "$archive" package.json pnpm-lock.yaml pnpm-workspace.yaml packages research/ascii-image-generation website
hash_file "$archive" >"$run_dir/source-tree.sha256"
(
  printf 'node='; node --version
  printf 'pnpm='; pnpm --version
  printf 'playwright='; pnpm --dir research/ascii-image-generation exec playwright --version
  printf 'chromium='; chromium_path="$(pnpm --dir research/ascii-image-generation exec node --input-type=module -e 'import { chromium } from "playwright"; process.stdout.write(chromium.executablePath())')"; "$chromium_path" --version
) >"$run_dir/environment.txt" 2>&1

server_pid=""
cleanup() { if [[ -n "$server_pid" ]]; then kill "$server_pid" 2>/dev/null || true; wait "$server_pid" 2>/dev/null || true; fi; }
trap cleanup EXIT
pnpm --filter @glyphcss/website exec astro dev --host 127.0.0.1 --port 43219 --strictPort >"$run_dir/server.log" 2>&1 &
server_pid=$!
node --input-type=module <<'NODE' >"$run_dir/server-ready.log" 2>&1
import net from "node:net";
const deadline = Date.now() + 30_000;
await new Promise((resolve, reject) => { const poll = () => { const probe = net.connect(43219, "127.0.0.1"); probe.once("connect", () => { probe.destroy(); resolve(); }); probe.once("error", () => Date.now() >= deadline ? reject(new Error("website server did not start")) : setTimeout(poll, 100)); }; poll(); });
NODE
server_ready=$?
export GLYPHCSS_GALLERY_URL=http://127.0.0.1:43219 GLYPHCSS_REPO_ROOT=/workspace PLAYWRIGHT_JSON_OUTPUT_NAME="$run_dir/results.json"
test_exit=1
if [[ "$server_ready" -eq 0 ]]; then
  pnpm --dir research/ascii-image-generation exec playwright test --config playwright.config.ts browser/asset-semantic-parity.spec.ts --list >"$run_dir/test-discovery.log" 2>&1
  discovery_exit=$?
  if [[ "$discovery_exit" -eq 0 ]] && grep -q 'asset-semantic-parity-browser' "$run_dir/test-discovery.log"; then
    pnpm --dir research/ascii-image-generation exec playwright test --config playwright.config.ts browser/asset-semantic-parity.spec.ts --workers=1 --output "$run_dir/test-results" --reporter=line,json >"$run_dir/test.log" 2>&1
    test_exit=$?
  else cp "$run_dir/test-discovery.log" "$run_dir/test.log"; fi
else discovery_exit=1; cp "$run_dir/server-ready.log" "$run_dir/test.log"; fi
printf '%s\n' "$discovery_exit" >"$run_dir/discovery-exit.txt"
printf '%s\n' "$test_exit" >"$run_dir/exit-code.txt"

pnpm --dir research/ascii-image-generation exec node --input-type=module - "$run_dir" <<'NODE'
import { createHash } from "node:crypto";
import { readFile, readdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
process.chdir("/workspace");
const [runDir] = process.argv.slice(2), sha = (value) => createHash("sha256").update(value).digest("hex");
const canonical = (value) => Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : value && typeof value === "object" ? `{${Object.keys(value).filter((key) => key !== "contentSha256").sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}` : JSON.stringify(value);
const exists = async (path) => { try { await readFile(path); return true; } catch { return false; } };
const jsonFiles = async (path) => { try { return (await Promise.all((await readdir(path, { withFileTypes: true })).map(async (entry) => entry.isDirectory() ? jsonFiles(join(path, entry.name)) : entry.name.endsWith(".json") ? [join(path, entry.name)] : []))).flat(); } catch { return []; } };
const attachments = [], findAttachment = (value) => { if (value && typeof value === "object") { if (value.name === "asset-semantic-parity-evidence" && typeof value.body === "string") attachments.push(value); for (const child of Array.isArray(value) ? value : Object.values(value)) findAttachment(child); } };
for (const path of new Set([join(runDir, "results.json"), ...(await jsonFiles(join(runDir, "test-results")))])) try { findAttachment(JSON.parse(await readFile(path, "utf8"))); } catch { /* reporter diagnostics are not parity evidence */ }
let evidence = null, error = null;
try { if (attachments.length !== 1) throw new Error(`expected one parity attachment, found ${attachments.length}`); evidence = JSON.parse(Buffer.from(attachments[0].body, "base64").toString("utf8")); if (evidence.schemaVersion !== "glyph-asset-semantic-parity-browser/v1") throw new Error("unexpected browser evidence schema"); } catch (cause) { error = cause.message; }
const [registry, dictionary, mapping] = await Promise.all(["asset-registry.json", "asset-object-dictionary.json", "asset-class-mapping.json"].map(async (name) => JSON.parse(await readFile(name === "asset-registry.json" ? `research/ascii-image-generation/reports/${name}` : `research/ascii-image-generation/config/${name}`, "utf8"))));
const cases = evidence?.cases ?? [];
const expectedClasses = dictionary.classes.filter((entry) => mapping.mappings.some((mappingEntry) => mappingEntry.classId === entry.id));
if (!error && (mapping.contentSha256 !== sha(canonical(mapping)) || dictionary.contentSha256 !== sha(canonical(dictionary)) || mapping.registry.contentSha256 !== registry.contentSha256 || mapping.dictionary.contentSha256 !== dictionary.contentSha256)) error = "authority hash is stale or rebound";
if (!error && (cases.length !== expectedClasses.length || new Set(cases.map((entry) => entry.classId)).size !== expectedClasses.length || new Set(cases.map((entry) => entry.assetId)).size !== expectedClasses.length)) error = "representative cases do not cover each populated class exactly once";
if (!error && cases.some((entry) => entry.verdict !== "pass" || entry.actual?.semanticAsciiSha256 !== entry.expected?.semanticAsciiSha256 || entry.actual?.semanticColorSha256 !== entry.expected?.semanticColorSha256 || entry.actual?.classIdSha256 !== entry.expected?.classIdSha256 || entry.actual?.controlIdentitySha256 !== entry.expected?.controlIdentitySha256)) error = "Node/browser semantic glyph, color, class, or control identity parity failed";
const environment = await readFile(join(runDir, "environment.txt"), "utf8"), testLog = await readFile(join(runDir, "test.log"), "utf8"), exitCode = Number((await readFile(join(runDir, "exit-code.txt"), "utf8")).trim());
if (!/^node=v\S+/m.test(environment) || !/^pnpm=\S+/m.test(environment) || !/^playwright=Version \S+/m.test(environment) || !/^chromium=\S.+\d/m.test(environment)) error ??= "browser/runtime versions are incomplete";
const runtime = Object.fromEntries(["node", "pnpm", "playwright", "chromium"].map((key) => [key, environment.match(new RegExp(`^${key}=(.+)$`, "m"))?.[1] ?? ""]));
const frameHash = (record) => sha(canonical(record));
const raw = { schemaVersion: "glyph-asset-semantic-parity-run/v1", runId: runDir.split("/").pop(), verdict: exitCode === 0 && !error ? "pass" : "fail", overallVerdict: exitCode === 0 && !error ? "pass" : "fail", command: "pnpm --dir research/ascii-image-generation exec playwright test --config playwright.config.ts browser/asset-semantic-parity.spec.ts --workers=1", authorities: { registrySha256: registry.contentSha256, dictionary: { id: dictionary.id, contentSha256: dictionary.contentSha256 }, mapping: { id: mapping.id, contentSha256: mapping.contentSha256 } }, sourceArchive: { path: "source-tree.tar", sha256: sha(await readFile(join(runDir, "source-tree.tar")) ) }, image: { digest: process.env.GLYPHCSS_ASSET_SEMANTIC_PARITY_IMAGE_ID }, runtime, testOutput: { exitCode, sha256: sha(testLog) }, cases: cases.map((entry) => ({ assetId: entry.assetId, canonicalPath: entry.canonicalPath, classId: entry.classId, semanticGlyph: entry.semanticGlyph, controlColor: entry.controlColor, nodeFrameSha256: frameHash(entry.expected), browserFrameSha256: frameHash(entry.actual), controlIdentitySha256: entry.actual?.controlIdentitySha256 ?? "0".repeat(64), verdict: entry.verdict })), contentSha256: "" };
raw.contentSha256 = sha(canonical(raw));
const [schema, dictionarySchema] = await Promise.all([readFile("research/ascii-image-generation/schema/asset-semantic-parity-run.schema.json", "utf8"), readFile("research/ascii-image-generation/schema/glyph-object-dictionary.schema.json", "utf8")]);
const ajv = new Ajv2020({ allErrors: true, strict: true }); ajv.addSchema(JSON.parse(dictionarySchema)); const validate = ajv.compile(JSON.parse(schema));
if (!validate(raw) || raw.contentSha256 !== sha(canonical(raw))) { raw.verdict = raw.overallVerdict = "fail"; raw.contentSha256 = sha(canonical(raw)); }
await writeFile(join(runDir, `.run-manifest-${process.pid}.tmp`), `${JSON.stringify(raw, null, 2)}\n`); await rename(join(runDir, `.run-manifest-${process.pid}.tmp`), join(runDir, "run-manifest.json"));
if (raw.verdict !== "pass") process.exitCode = 1;
NODE
manifest_exit=$?
if [[ "$manifest_exit" -ne 0 ]]; then
  pnpm --dir research/ascii-image-generation exec node --input-type=module - "$run_dir" <<'NODE'
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
process.chdir("/workspace");
const [runDir] = process.argv.slice(2), sha = (value) => createHash("sha256").update(value).digest("hex");
const canonical = (value) => Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : value && typeof value === "object" ? `{${Object.keys(value).filter((key) => key !== "contentSha256").sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}` : JSON.stringify(value);
const [registry, dictionary, mapping, environment, testLog, archive] = await Promise.all([
  readFile("research/ascii-image-generation/reports/asset-registry.json", "utf8").then(JSON.parse), readFile("research/ascii-image-generation/config/asset-object-dictionary.json", "utf8").then(JSON.parse), readFile("research/ascii-image-generation/config/asset-class-mapping.json", "utf8").then(JSON.parse), readFile(join(runDir, "environment.txt"), "utf8"), readFile(join(runDir, "test.log"), "utf8"), readFile(join(runDir, "source-tree.tar")),
]);
const runtime = Object.fromEntries(["node", "pnpm", "playwright", "chromium"].map((key) => [key, environment.match(new RegExp(`^${key}=(.+)$`, "m"))?.[1] ?? "unavailable"]));
const cases = dictionary.classes.filter((entry) => mapping.mappings.some((candidate) => candidate.classId === entry.id)).map((entry) => {
  const representative = mapping.mappings.find((candidate) => candidate.classId === entry.id && candidate.canonicalPath.endsWith(".glb"));
  return { assetId: representative?.assetId ?? `asset/${"0".repeat(64)}`, canonicalPath: representative?.canonicalPath ?? "website/public/gallery/glb/unavailable.glb", classId: entry.id, semanticGlyph: entry.semanticGlyph, controlColor: entry.controlColor.toLowerCase(), nodeFrameSha256: "0".repeat(64), browserFrameSha256: "0".repeat(64), controlIdentitySha256: "0".repeat(64), verdict: "fail" };
});
const raw = { schemaVersion: "glyph-asset-semantic-parity-run/v1", runId: runDir.split("/").pop(), verdict: "fail", overallVerdict: "fail", command: "pnpm --dir research/ascii-image-generation exec playwright test --config playwright.config.ts browser/asset-semantic-parity.spec.ts --workers=1", authorities: { registrySha256: registry.contentSha256, dictionary: { id: dictionary.id, contentSha256: dictionary.contentSha256 }, mapping: { id: mapping.id, contentSha256: mapping.contentSha256 } }, sourceArchive: { path: "source-tree.tar", sha256: sha(archive) }, image: { digest: process.env.GLYPHCSS_ASSET_SEMANTIC_PARITY_IMAGE_ID }, runtime, testOutput: { exitCode: Number((await readFile(join(runDir, "exit-code.txt"), "utf8")).trim()), sha256: sha(testLog) }, cases, contentSha256: "" };
raw.contentSha256 = sha(canonical(raw));
await writeFile(join(runDir, "run-manifest.json"), `${JSON.stringify(raw, null, 2)}\n`);
NODE
fi
cat "$run_dir/test.log"
if [[ "$test_exit" -ne 0 || "$manifest_exit" -ne 0 ]]; then exit 1; fi
