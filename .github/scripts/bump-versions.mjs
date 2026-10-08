#!/usr/bin/env node
/**
 * Bump the version of every package under `packages/*` in lockstep.
 *
 * Usage:
 *   node .github/scripts/bump-versions.mjs <patch|minor|major>
 *
 * Reads the current version from core, applies the requested
 * semver bump, writes the new version back to every package.json with a
 * regex (so unrelated formatting — e.g. inline `keywords` arrays — survives
 * untouched), and prints the new version to stdout (also exported as
 * NEXT_VERSION when running inside GitHub Actions).
 */
import { readFileSync, readdirSync, writeFileSync, appendFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
// __dirname is .github/scripts — repo root is two levels up.
const root = resolve(__dirname, "..", "..");
const packagesRoot = resolve(root, "packages");
const packages = readdirSync(packagesRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => resolve(packagesRoot, entry.name, "package.json"));

const bump = process.argv[2];
if (!["patch", "minor", "major"].includes(bump)) {
  console.error(`usage: ${process.argv[1]} <patch|minor|major>`);
  process.exit(1);
}

const versionRe = /^(\s*"version":\s*")(\d+)\.(\d+)\.(\d+)(")/m;

const core = resolve(packagesRoot, "core", "package.json");
const first = readFileSync(core, "utf8");
const m = first.match(versionRe);
if (!m) {
  console.error(`could not find a "version" field in ${core}`);
  process.exit(1);
}
const [maj, min, pat] = [Number(m[2]), Number(m[3]), Number(m[4])];

const next =
  bump === "major" ? `${maj + 1}.0.0`
  : bump === "minor" ? `${maj}.${min + 1}.0`
  : `${maj}.${min}.${pat + 1}`;

const updates = packages.map((file) => {
  const src = readFileSync(file, "utf8");
  if (!versionRe.test(src)) {
    console.error(`no "version" field in ${file}`);
    process.exit(1);
  }
  return [file, src.replace(versionRe, `$1${next}$5`)];
});
for (const [file, source] of updates) writeFileSync(file, source);

console.log(`bumped ${maj}.${min}.${pat} -> ${next}`);

if (process.env.GITHUB_ENV) {
  appendFileSync(process.env.GITHUB_ENV, `NEXT_VERSION=${next}\n`);
}
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `version=${next}\n`);
}
