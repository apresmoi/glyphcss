import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "glyphcss-release-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const script = join(root, ".github/scripts/bump-versions.mjs");
  mkdirSync(join(root, ".github/scripts"), { recursive: true });
  copyFileSync(new URL("./bump-versions.mjs", import.meta.url), script);
  const sources = new Map();
  // Different historical versions and a future package must all follow core.
  for (const [name, version] of Object.entries({
    alphabeticallyFirst: "9.0.0", core: "0.2.0", glyphcss: "0.2.0",
    react: "0.2.0", vue: "0.2.0", fonts: "0.2.0", compile: "0.2.0",
    effects: "0.2.0", charts: "0.2.0", diagrams: "0.2.0", maps: "0.1.6",
  })) {
    const file = join(root, "packages", name, "package.json");
    mkdirSync(join(root, "packages", name), { recursive: true });
    const source = `{\n  "name": "${name}",\n  "version": "${version}",\n  "keywords": ["keep", "formatting"]\n}\n`;
    writeFileSync(file, source);
    sources.set(file, source);
  }
  const envFile = join(root, "github-env");
  const outputFile = join(root, "github-output");
  return {
    sources, envFile, outputFile,
    run: (bump) => spawnSync(process.execPath, [script, bump], {
      encoding: "utf8", env: { ...process.env, GITHUB_ENV: envFile, GITHUB_OUTPUT: outputFile },
    }),
  };
}

for (const [bump, expected] of Object.entries({ patch: "0.2.1", minor: "0.3.0", major: "1.0.0" })) {
  test(`${bump} bumps every package from core and preserves formatting`, (t) => {
    const f = fixture(t);
    const result = f.run(bump);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, `bumped 0.2.0 -> ${expected}\n`);
    for (const [file, source] of f.sources) {
      assert.equal(readFileSync(file, "utf8"), source.replace(/"version": "[^"]+"/, `"version": "${expected}"`));
    }
    assert.equal(readFileSync(f.envFile, "utf8"), `NEXT_VERSION=${expected}\n`);
    assert.equal(readFileSync(f.outputFile, "utf8"), `version=${expected}\n`);
  });
}

test("invalid bump leaves all manifests untouched", (t) => {
  const f = fixture(t);
  const result = f.run("invalid");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /usage:/);
  for (const [file, source] of f.sources) assert.equal(readFileSync(file, "utf8"), source);
});

test("invalid manifest is rejected before any version is written", (t) => {
  const f = fixture(t);
  const file = [...f.sources.keys()].find((path) => path.includes("/vue/"));
  const invalid = f.sources.get(file).replace('"0.2.0"', '"invalid"');
  writeFileSync(file, invalid);
  f.sources.set(file, invalid);
  const result = f.run("patch");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /no "version" field/);
  for (const [path, source] of f.sources) assert.equal(readFileSync(path, "utf8"), source);
});
