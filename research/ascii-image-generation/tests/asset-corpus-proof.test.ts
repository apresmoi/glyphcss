import { createHash } from "node:crypto";
import { execFile as execFileCallback, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
  checkAssetCorpusProof,
  loadInputs,
  renderAssetCorpusProof,
  runStagedAssetCorpus,
  selectAssetCorpusPopulation,
  validateArtifacts,
} from "../src/render-asset-corpus.mjs";
import { checkRenderedTargetAdmission } from "../scripts/admit-rendered-targets.mjs";

const execFile = promisify(execFileCallback);
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const spawnCollected = (command: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv }) => new Promise<{ code: number | null; stdout: Buffer; stderr: Buffer }>((resolveResult, reject) => {
  const child = spawn(command, args, { ...options, stdio: ["ignore", "pipe", "pipe"] }), stdout: Buffer[] = [], stderr: Buffer[] = [];
  child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk))); child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
  child.on("error", reject); child.on("close", (code) => resolveResult({ code, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) }));
});

async function nativeAuthorities() {
  const config = JSON.parse(await readFile("config/asset-corpus.json", "utf8"));
  const [registry, dictionary, mapping] = await Promise.all([
    readFile(config.assetRegistry, "utf8").then(JSON.parse),
    readFile(config.dictionary, "utf8").then(JSON.parse),
    readFile(config.assetClassMapping, "utf8").then(JSON.parse),
  ]);
  return {
    config,
    registry,
    taxonomy: {
      dictionary,
      byAsset: new Map(mapping.mappings.map((entry: { assetId: string; classId: number }) => [entry.assetId, entry])),
    },
  };
}

describe("B54 bounded proof corpus", () => {
  it("documents the cottage and high-frequency woodcrate candidates as exact-RGB proof selections", async () => {
    const { config, registry } = await nativeAuthorities();
    const candidates = Object.values(config.proofCandidates) as string[];
    expect(Object.keys(config.proofCandidates).sort()).toEqual(["cottage", "highFrequencyTextured"]);
    expect(candidates).toHaveLength(2);
    expect(new Set(candidates).size).toBe(candidates.length);
    for (const assetId of candidates) {
      const asset = registry.assets.find((candidate: { id: string }) => candidate.id === assetId);
      expect(asset).toMatchObject({ id: assetId, admitted: true, appearanceDisposition: "exact-rgb" });
    }
  });

  it("selects only admitted exact-RGB assets and preserves selection authority", async () => {
    const { registry, taxonomy, config } = await nativeAuthorities();
    const exact = selectAssetCorpusPopulation(registry, taxonomy, "exact-rgb");
    const material = selectAssetCorpusPopulation(registry, taxonomy, "material-only");
    const candidateIds = Object.values(config.proofCandidates) as string[];
    expect(candidateIds.every((id) => exact.some(({ asset }: { asset: { id: string } }) => asset.id === id))).toBe(true);
    expect(material.some(({ asset }: { asset: { id: string } }) => candidateIds.includes(asset.id))).toBe(false);
    expect(() => selectAssetCorpusPopulation(registry, taxonomy, "unknown" as "exact-rgb")).toThrow("ASSET_CORPUS_POPULATION_INVALID");
  });

  it("fails proof creation before rendering for duplicate, unknown, and non-exact selections", async () => {
    const { registry, config } = await nativeAuthorities();
    const exact = registry.assets.find((asset: { admitted: boolean; appearanceDisposition: string }) => asset.admitted && asset.appearanceDisposition === "exact-rgb");
    const material = registry.assets.find((asset: { admitted: boolean; appearanceDisposition: string }) => asset.admitted && asset.appearanceDisposition === "material-only");
    expect(exact).toBeTruthy();
    expect(material).toBeTruthy();
    const output = join(config.output, "proofs", "glyph-proof-never-written.json");
    await expect(renderAssetCorpusProof("config/asset-corpus.json", [exact.id, exact.id], output, { write: true }))
      .rejects.toThrow("ASSET_CORPUS_PROOF_ARGUMENTS_INVALID");
    await expect(renderAssetCorpusProof("config/asset-corpus.json", ["asset/" + "0".repeat(64)], output, { write: true }))
      .rejects.toThrow("ASSET_CORPUS_PROOF_ASSET_SELECTION_INVALID");
    await expect(renderAssetCorpusProof("config/asset-corpus.json", [material.id], output, { write: true }))
      .rejects.toThrow("ASSET_CORPUS_PROOF_ASSET_SELECTION_INVALID");
    await expect(renderAssetCorpusProof("config/asset-corpus.json", [exact.id], join(tmpdir(), "glyph-proof-external.json"), { write: true }))
      .rejects.toThrow("ASSET_CORPUS_PROOF_OUTPUT_OUTSIDE_DATASET_ROOT");
    expect(config.proofCandidates.cottage).not.toBe(config.proofCandidates.highFrequencyTextured);
  });

  it("rejects every forbidden CLI mode combination before any corpus job is dispatched", async () => {
    const script = resolve("src/render-asset-corpus.mjs");
    const args = [script, "--render", "--asset-ids", "asset/" + "0".repeat(64), "--proof-output", "proof.json", "--check-proof", "proof.json"];
    await expect(execFile(process.execPath, args, { cwd: process.cwd() })).rejects.toMatchObject({ stderr: expect.stringContaining("ASSET_CORPUS_PROOF_ARGUMENTS_INVALID") });
  });

  it("dispatches proof rendering from a relative CLI script path and writes the requested in-root proof", async () => {
    const directory = await mkdtemp(join(tmpdir(), "glyph-proof-relative-cli-")), configPath = join(directory, "asset-corpus.json"), output = join(directory, "assets"), proofPath = join(output, "proofs", "relative-cli.json");
    const prior = process.env.GLYPHCSS_ASSET_CORPUS_IMAGE_ID;
    try {
      const { config } = await nativeAuthorities();
      await writeFile(configPath, JSON.stringify({ ...config, output }, null, 2));
      const result = await spawnCollected(process.execPath, ["src/render-asset-corpus.mjs", "--render", "--config", configPath, "--asset-ids", config.proofCandidates.cottage, "--proof-output", proofPath], { cwd: process.cwd(), env: { ...process.env, GLYPHCSS_ASSET_CORPUS_IMAGE_ID: `sha256:${"8".repeat(64)}` } });
      if (result.code !== 0) throw new Error(`PROOF_CLI_EXIT:${result.code}:${result.stderr.toString("utf8")}`);
      const stdout = result.stdout.toString("utf8");
      let stdoutProof;
      try { stdoutProof = JSON.parse(stdout); }
      catch (error) {
        const bytes = result.stdout, offset = 8192, start = Math.max(0, offset - 96), end = Math.min(bytes.length, offset + 96);
        throw new Error(`PROOF_CLI_STDOUT_JSON_INVALID:length=${bytes.length}:window=${bytes.subarray(start, end).toString("hex")}:error=${error instanceof Error ? error.message : String(error)}`);
      }
      expect(stdout).toBe(`${JSON.stringify(stdoutProof, null, 2)}\n`);
      expect(stdoutProof).toMatchObject({ schemaVersion: "glyph-asset-corpus-proof/v1", productionAdmissible: false });
      expect(JSON.parse(await readFile(proofPath, "utf8"))).toMatchObject({ schemaVersion: "glyph-asset-corpus-proof/v1", selectedAssetIds: [config.proofCandidates.cottage] });
    } finally {
      if (prior === undefined) delete process.env.GLYPHCSS_ASSET_CORPUS_IMAGE_ID; else process.env.GLYPHCSS_ASSET_CORPUS_IMAGE_ID = prior;
      await rm(directory, { recursive: true, force: true });
    }
  }, 300_000);

  it("requires the non-admissible proof seal and selection binding before deep artifact verification", async () => {
    const directory = await mkdtemp(join(tmpdir(), "glyph-proof-seal-"));
    const path = join(directory, "proof.json");
    const selectedAssetIds = ["asset/" + "a".repeat(64)];
    try {
      const proof = { schemaVersion: "glyph-asset-corpus-proof/v1", productionAdmissible: false, selectedAssetIds, rendered: [], contentSha256: sha("forged") };
      await writeFile(path, JSON.stringify(proof));
      await expect(checkAssetCorpusProof("config/asset-corpus.json", selectedAssetIds, path)).rejects.toThrow("ASSET_CORPUS_PROOF_REBOUND");
      proof.productionAdmissible = true;
      await writeFile(path, JSON.stringify(proof));
      await expect(checkAssetCorpusProof("config/asset-corpus.json", selectedAssetIds, path)).rejects.toThrow("ASSET_CORPUS_PROOF_REBOUND");
      await expect(checkAssetCorpusProof("config/asset-corpus.json", [...selectedAssetIds].reverse(), path)).rejects.toThrow("ASSET_CORPUS_PROOF_REBOUND");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("does not let a proof-shaped artifact enter the B45 production-admission schema", async () => {
    const directory = await mkdtemp(join(tmpdir(), "glyph-proof-b45-"));
    const path = join(directory, "proof.json");
    try {
      await writeFile(path, JSON.stringify({
        schemaVersion: "glyph-asset-corpus-proof/v1",
        productionAdmissible: false,
        selectedAssetIds: ["asset/" + "a".repeat(64)],
        rendered: [],
        contentSha256: sha("proof"),
      }));
      await expect(checkRenderedTargetAdmission(path)).rejects.toThrow("RENDERED_TARGET_ADMISSION_SCHEMA_INVALID");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("uses the normal staged renderer/checker for the two bounded proof assets, rejects a deep control mutation, and leaves ordinary aggregate cardinality strict", async () => {
    const directory = await mkdtemp(join(tmpdir(), "glyph-proof-real-")), configPath = join(directory, "asset-corpus.json"), output = join(directory, "assets"), proofPath = join(output, "proofs", "proof.json");
    const originalImageId = process.env.GLYPHCSS_ASSET_CORPUS_IMAGE_ID;
    try {
      const { config } = await nativeAuthorities();
      await writeFile(configPath, JSON.stringify({ ...config, output }, null, 2));
      process.env.GLYPHCSS_ASSET_CORPUS_IMAGE_ID = `sha256:${"9".repeat(64)}`;
      const ids = [config.proofCandidates.cottage, config.proofCandidates.highFrequencyTextured];
      const proof = await renderAssetCorpusProof(configPath, ids, proofPath, { write: true });
      expect(proof).toMatchObject({ schemaVersion: "glyph-asset-corpus-proof/v1", productionAdmissible: false, selectedAssetIds: ids });
      expect(proof.rendered).toHaveLength(2);
      await expect(checkAssetCorpusProof(configPath, ids, proofPath)).resolves.toMatchObject({ contentSha256: proof.contentSha256 });
      const inputs = await loadInputs(configPath);
      const normalReport = { ...proof, population: { floor: { pass: true } }, assets: { expectedAdmittedExactRgb: 45 } };
      await expect(validateArtifacts(normalReport, inputs.config, inputs.registry, inputs.dictionary, inputs.taxonomy, inputs.controlNormalization))
        .rejects.toThrow("ASSET_CORPUS_AGGREGATE_PARTIAL_OR_REJECTED");
      await expect(validateArtifacts(normalReport, inputs.config, inputs.registry, inputs.dictionary, inputs.taxonomy, inputs.controlNormalization, ids)).resolves.toBeUndefined();
      const frame = proof.rendered[0].variants[0].frames[0];
      const control = join(output, proof.rendered[0].assetId.slice("asset/".length), "variants", proof.rendered[0].variants[0].id, "controls", frame.coverageMapPath);
      await writeFile(control, Buffer.from([0]));
      await expect(checkAssetCorpusProof(configPath, ids, proofPath)).rejects.toThrow(/CONTROL_PAYLOAD_STALE|CONTROL_HASH_MISMATCH/);
      // The full aggregate validator continues to demand all 45 entries; a
      // proof never grants a cardinality exception to ordinary reports.
      await expect(checkAssetCorpusProof(configPath, [ids[0]], proofPath)).rejects.toThrow("ASSET_CORPUS_PROOF_REBOUND");
    } finally {
      if (originalImageId === undefined) delete process.env.GLYPHCSS_ASSET_CORPUS_IMAGE_ID; else process.env.GLYPHCSS_ASSET_CORPUS_IMAGE_ID = originalImageId;
      await rm(directory, { recursive: true, force: true });
    }
  }, 300_000);

  it("preserves staged reuse and rollback semantics used by proof rendering", async () => {
    const directory = await mkdtemp(join(tmpdir(), "glyph-proof-stage-")), finalOutput = join(directory, "final");
    try {
      await mkdir(join(finalOutput, "asset-a"), { recursive: true }); await writeFile(join(finalOutput, "asset-a", "old"), "old");
      await runStagedAssetCorpus(finalOutput, async (staging: string) => { await mkdir(join(staging, "asset-a"), { recursive: true }); await writeFile(join(staging, "asset-a", "new"), "new"); return [{ assetId: "asset/asset-a" }]; }, async () => {});
      await expect(readFile(join(finalOutput, "asset-a", "new"), "utf8")).resolves.toBe("new");
      await expect(runStagedAssetCorpus(finalOutput, async (staging: string) => { await mkdir(join(staging, "asset-a"), { recursive: true }); await writeFile(join(staging, "asset-a", "bad"), "bad"); return [{ assetId: "asset/asset-a" }]; }, async () => { throw new Error("proof validation rejected"); })).rejects.toThrow("proof validation rejected");
      await expect(readFile(join(finalOutput, "asset-a", "new"), "utf8")).resolves.toBe("new");
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
