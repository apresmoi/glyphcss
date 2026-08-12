import { createHash } from "node:crypto";
import { lstat, readdir, readFile, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";

const roots = [
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "packages/core",
  "packages/glyphcss",
  "packages/compile",
  "research/ascii-image-generation",
  "website/public/gallery",
  "website/src/components/GalleryWorkbench/presets",
];

const omittedDirectoryNames = new Set(["node_modules", "dist", ".astro", "__pycache__", "test-results", "coverage", "playwright-report", ".pytest_cache", ".vitest", "review"]);
const omittedFileNames = new Set([".DS_Store"]);
const generatedManifestPath = "research/ascii-image-generation/reports/image-source-manifest.json";
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const canonical = (value) => value === null || typeof value !== "object"
  ? JSON.stringify(value)
  : Array.isArray(value)
    ? `[${value.map(canonical).join(",")}]`
    : `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;

function argument(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? null : process.argv[index + 1] ?? null;
}

async function collect(root, current, files) {
  const stat = await lstat(current);
  if (stat.isSymbolicLink()) throw new Error(`ASSET_CORPUS_IMAGE_SOURCE_SYMLINK: ${relative(root, current)}`);
  if (stat.isFile()) {
    const bytes = await readFile(current);
    const path = relative(root, current).replaceAll("\\", "/");
    const name = path.split("/").at(-1);
    if (path !== generatedManifestPath && !omittedFileNames.has(name) && !name.endsWith(".pyc") && !name.endsWith(".pyo")) files.push({ path, bytes: bytes.byteLength, sha256: sha256(bytes) });
    return;
  }
  if (!stat.isDirectory()) throw new Error(`ASSET_CORPUS_IMAGE_SOURCE_NON_REGULAR: ${relative(root, current)}`);
  for (const entry of await readdir(current, { withFileTypes: true })) {
    if (entry.isDirectory() && omittedDirectoryNames.has(entry.name)) continue;
    await collect(root, resolve(current, entry.name), files);
  }
}

const workspace = resolve(argument("--root") ?? ".");
const expected = argument("--expected");
const output = argument("--write");
const print = process.argv.includes("--print");
if (!print && !/^[a-f0-9]{64}$/.test(expected ?? "")) throw new Error("ASSET_CORPUS_IMAGE_SOURCE_EXPECTED_SHA256_REQUIRED");
if (!print && !output) throw new Error("ASSET_CORPUS_IMAGE_SOURCE_OUTPUT_REQUIRED");

const files = [];
for (const path of roots) await collect(workspace, resolve(workspace, path), files);
files.sort((left, right) => left.path.localeCompare(right.path));
if (new Set(files.map((file) => file.path)).size !== files.length) throw new Error("ASSET_CORPUS_IMAGE_SOURCE_DUPLICATE_PATH");
const raw = { schemaVersion: "glyph-asset-corpus-image-source/v1", roots, files };
const contentSha256 = sha256(canonical(raw));
if (print) {
  process.stdout.write(`${contentSha256}\n`);
  process.exit(0);
}
if (contentSha256 !== expected) throw new Error(`ASSET_CORPUS_IMAGE_SOURCE_FILE_SET_MISMATCH: expected ${expected}, got ${contentSha256}`);
const manifest = { ...raw, contentSha256 };
await writeFile(resolve(workspace, output), `${JSON.stringify(manifest, null, 2)}\n`);
