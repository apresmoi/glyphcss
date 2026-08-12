import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { loadAssetTaxonomy } from "../scripts/asset-taxonomy.mjs";

const root = resolve(import.meta.dirname, "..");

describe("B50 remote semantic browser-parity contract", () => {
  it("selects a real GLB representative for every populated corpus class", async () => {
    const taxonomy = await loadAssetTaxonomy();
    const populated = taxonomy.dictionary.classes.filter((entry: { id: number }) => (taxonomy.coverage[entry.id] ?? 0) > 0);
    const representatives = populated.map((entry: { id: number }) => taxonomy.mapping.mappings.find((mapping: { classId: number; canonicalPath: string }) => mapping.classId === entry.id && mapping.canonicalPath.endsWith(".glb")));
    expect(populated).toHaveLength(11);
    expect(representatives).toHaveLength(11);
    expect(representatives.every(Boolean)).toBe(true);
    expect(new Set(representatives.map((entry: { classId: number } | undefined) => entry!.classId)).size).toBe(11);
    expect(new Set(representatives.map((entry: { assetId: string } | undefined) => entry!.assetId)).size).toBe(11);
    expect(representatives.every((entry: { canonicalPath: string } | undefined) => entry!.canonicalPath.startsWith("website/public/gallery/"))).toBe(true);
  });

  it("requires sealed remote evidence with browser/runtime, source, image, output, and per-case hashes", async () => {
    const [schema, dictionarySchema] = await Promise.all([
      readFile(resolve(root, "schema/asset-semantic-parity-run.schema.json"), "utf8"),
      readFile(resolve(root, "schema/glyph-object-dictionary.schema.json"), "utf8"),
    ]);
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    ajv.addSchema(JSON.parse(dictionarySchema));
    const validate = ajv.compile(JSON.parse(schema));
    const sample = {
      schemaVersion: "glyph-asset-semantic-parity-run/v1", runId: "b50-contract", verdict: "pass", overallVerdict: "pass",
      command: "pnpm --dir research/ascii-image-generation exec playwright test --config playwright.config.ts browser/asset-semantic-parity.spec.ts --workers=1",
      authorities: { registrySha256: "a".repeat(64), dictionary: { id: "dictionary/asset-corpus-v1", contentSha256: "b".repeat(64) }, mapping: { id: "asset-class-mapping/asset-corpus-v1", contentSha256: "c".repeat(64) } },
      sourceArchive: { path: "source-tree.tar", sha256: "d".repeat(64) }, image: { digest: `sha256:${"e".repeat(64)}` }, runtime: { node: "v22", pnpm: "10", playwright: "Version 1", chromium: "Chromium 140" }, testOutput: { exitCode: 0, sha256: "f".repeat(64) },
      cases: Array.from({ length: 11 }, (_, classId) => ({ assetId: `asset/${String(classId + 1).padStart(64, "0")}`, canonicalPath: `website/public/gallery/glb/class-${classId + 1}.glb`, classId: classId + 1, semanticGlyph: "A", controlColor: "#abcdef", nodeFrameSha256: "1".repeat(64), browserFrameSha256: "2".repeat(64), controlIdentitySha256: "3".repeat(64), verdict: "pass" })),
      contentSha256: "4".repeat(64),
    };
    expect(validate(sample), ajv.errorsText(validate.errors)).toBe(true);
    expect(validate({ ...sample, image: { digest: "mutable-tag" } })).toBe(false);
  });

  it("creates a first-run artifact parent but refuses to reuse an existing run leaf", async () => {
    const runner = await readFile(resolve(root, "scripts/remote-asset-semantic-parity-browser.sh"), "utf8");
    expect(runner).toContain('if [[ -e "$run_dir" ]]; then');
    expect(runner).toContain('mkdir -p "$run_dir"');
  });

  it("builds remotely from an allowlisted immutable temporary context", async () => {
    const launcher = await readFile(resolve(root, "scripts/run-remote-asset-semantic-parity-browser.sh"), "utf8");
    expect(launcher).toContain('mktemp -d "${TMPDIR:-/tmp}/glyphcss-asset-semantic-parity.XXXXXX"');
    expect(launcher).toContain("tar --exclude='*/node_modules' --exclude='*/dist' --exclude='*/.astro' -cf -");
    expect(launcher).toContain('package.json pnpm-lock.yaml pnpm-workspace.yaml packages research/ascii-image-generation website');
    expect(launcher).toContain('--file "$build_context/research/ascii-image-generation/browser/Dockerfile.website"');
    expect(launcher).toContain('--tag "$image" "$build_context"');
    expect(launcher).toContain('rm -rf "$build_context"');
  });

  it("uses research-local Node resolution, preserves a fail manifest, and keeps the browser probe inert", async () => {
    const [runner, browser] = await Promise.all([
      readFile(resolve(root, "scripts/remote-asset-semantic-parity-browser.sh"), "utf8"),
      readFile(resolve(root, "browser/asset-semantic-parity.spec.ts"), "utf8"),
    ]);
    expect(runner).toContain('pnpm --dir research/ascii-image-generation exec node --input-type=module - "$run_dir"');
    expect(runner).toContain('process.chdir("/workspace");');
    expect(runner).toContain('if [[ "$manifest_exit" -ne 0 ]]; then');
    expect(runner).toContain('verdict: "fail", overallVerdict: "fail"');
    expect(browser).toContain('await page.goto(`${galleryOrigin}/robots.txt`);');
    expect(browser).toContain('asset load failed ${representative.assetId} ${representative.canonicalPath}');
    expect(browser).toContain('request failures: ${requestFailures.join(" | ") || "none"}');
  });
});
