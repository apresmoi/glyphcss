#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { generateCorpusAt } from "../src/generate-controls.mjs";

const root = resolve(import.meta.dirname, "..");
const sha = (value) => createHash("sha256").update(value).digest("hex");
const canonical = (value) => value === null || typeof value !== "object"
  ? JSON.stringify(value)
  : Array.isArray(value)
    ? `[${value.map(canonical).join(",")}]`
    : `{${Object.keys(value).filter((key) => key !== "contentSha256").sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
const treeHash = async (directory) => {
  const entries = [];
  const walk = async (path, relative = "") => {
    for (const name of (await readdir(path)).sort()) {
      const target = join(path, name);
      const next = relative ? `${relative}/${name}` : name;
      if ((await stat(target)).isDirectory()) await walk(target, next);
      else entries.push([next, sha(await readFile(target))]);
    }
  };
  await walk(directory);
  return sha(canonical(entries));
};
const files = [
  "config/reference-corpus.json",
  "src/generate-controls.mjs",
  "../../packages/compile/src/controlMaps.ts",
  "package.json",
  "../../packages/compile/package.json",
  "../../pnpm-lock.yaml",
];
const sourceTrees = [
  "../../packages/core/src",
  "../../packages/glyphcss/src",
  "../../packages/compile/src",
  "src",
  "config",
  "fixtures/reprojection",
];
const outputFlag = process.argv.indexOf("--output");
const retainedOutput = outputFlag >= 0 ? resolve(process.argv[outputFlag + 1] ?? "") : null;
if (outputFlag >= 0 && !process.argv[outputFlag + 1]) throw new Error("USAGE: preflight-reference-corpus.mjs [--output DIRECTORY]");
const output = retainedOutput ?? await mkdtemp(join(tmpdir(), "glyphcss-reference-preflight-"));
try {
  const manifest = await generateCorpusAt("config/reference-corpus.json", output);
  const hashes = Object.fromEntries(await Promise.all(files.map(async (relative) => [
    relative,
    sha(await readFile(resolve(root, relative))),
  ])));
  const sourceTreeHashes = Object.fromEntries(await Promise.all(sourceTrees.map(async (relative) => [
    relative,
    await treeHash(resolve(root, relative)),
  ])));
  process.stdout.write(`${JSON.stringify({
    schemaVersion: "glyph-reference-corpus-preflight/v1",
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    manifestContentSha256: manifest.contentSha256,
    treeSha256: await treeHash(output),
    hashes,
    sourceTreeHashes,
    manifest,
  })}\n`);
} finally {
  if (!retainedOutput) await rm(output, { recursive: true, force: true });
}
