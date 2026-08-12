import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { buildAssetTaxonomyReport, loadAssetTaxonomy, resolveAssetTaxonomyClass, validateAssetTaxonomy } from "../scripts/asset-taxonomy.mjs";
import { mapAssetCorpusWorkersOrdered, renderAssetCorpus, renderAssetCorpusWorkerTask, runStagedAssetCorpus, validateAssetCorpusVariantSchedule, validateAssetDecoderParityAuthority, validateAssetRenderBindingAuthority, validateControlNormalizationManifest, validateMaterialArtifacts, validateRenderedAssetAuthority } from "../src/render-asset-corpus.mjs";

const root = resolve(import.meta.dirname, "..");
const canonical = (value: unknown): string => Array.isArray(value)
  ? `[${value.map(canonical).join(",")}]`
  : value && typeof value === "object"
    ? `{${Object.keys(value as Record<string, unknown>).filter((key) => key !== "contentSha256").sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`
    : JSON.stringify(value);
const reseal = <T extends { contentSha256: string }>(value: T): T => ({ ...value, contentSha256: createHash("sha256").update(canonical(value)).digest("hex") });
async function treeBytes(directory: string, prefix = ""): Promise<Array<[string, string]>> {
  const output: Array<[string, string]> = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relativePath = join(prefix, entry.name), path = join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await treeBytes(path, relativePath));
    else output.push([relativePath, createHash("sha256").update(await readFile(path)).digest("hex")]);
  }
  return output.sort(([a], [b]) => a.localeCompare(b));
}

describe("B50 asset taxonomy", () => {
  it("renders in actual worker threads without changing canonical report order", async () => {
    const workerUrl = new URL("./fixtures/asset-corpus-pool-worker.mjs", import.meta.url);
    const values = Array.from({ length: 12 }, (_, id) => ({ id, delay: (11 - id) % 4 }));
    const result = await mapAssetCorpusWorkersOrdered(values, { concurrency: 4, workerUrl });
    expect(result.map((entry: { id: number }) => entry.id)).toEqual(values.map(({ id }) => id));
    expect(new Set(result.map((entry: { threadId: number }) => entry.threadId)).size).toBeGreaterThan(1);
    expect(new Set(result.map((entry: { pid: number }) => entry.pid))).toEqual(new Set([process.pid]));

    const cpuStarted = performance.now();
    const cpuParallel = await mapAssetCorpusWorkersOrdered(
      Array.from({ length: 4 }, (_, id) => ({ id, cpuMs: 250 })),
      { concurrency: 4, workerUrl },
    );
    expect(new Set(cpuParallel.map((entry: { threadId: number }) => entry.threadId)).size).toBe(4);
    expect(performance.now() - cpuStarted).toBeLessThan(850);

    await expect(mapAssetCorpusWorkersOrdered([{ id: 0, delay: 20 }, { id: 1, fail: true }], { concurrency: 2, workerUrl })).rejects.toThrow("sentinel");
    await expect(mapAssetCorpusWorkersOrdered([{ id: 0, malformed: "missing" }], { concurrency: 1, workerUrl })).rejects.toThrow("ASSET_CORPUS_WORKER_PROTOCOL_INVALID");
    await expect(mapAssetCorpusWorkersOrdered([{ id: 0, malformed: "both" }], { concurrency: 1, workerUrl })).rejects.toThrow("ASSET_CORPUS_WORKER_PROTOCOL_INVALID");
    await expect(mapAssetCorpusWorkersOrdered([], { concurrency: 0, workerUrl })).rejects.toThrow("ASSET_CORPUS_CONCURRENCY_INVALID");
    await expect(mapAssetCorpusWorkersOrdered([], { concurrency: 1, workerUrl })).resolves.toEqual([]);
    const one = await mapAssetCorpusWorkersOrdered([{ id: 7 }], { concurrency: 8, workerUrl });
    expect(one).toHaveLength(1);
    expect(one[0]).toMatchObject({ id: 7, pid: process.pid });
    expect(one[0].threadId).toBeGreaterThan(0);

    const routes = await mapAssetCorpusWorkersOrdered([
      { id: "exact", population: "exact-rgb" },
      { id: "material", population: "material-only" },
    ], { concurrency: 2, workerUrl });
    expect(routes.map((entry: { population: string }) => entry.population)).toEqual(["exact-rgb", "material-only"]);

    const fixtureRoot = await mkdtemp(join(tmpdir(), "glyph-worker-parity-"));
    try {
      for (const population of ["exact-rgb", "material-only"]) {
        const serialOutput = join(fixtureRoot, `${population}-serial`);
        const parallelOutput = join(fixtureRoot, `${population}-parallel`);
        const tasks = Array.from({ length: 6 }, (_, id) => ({ id, population }));
        const serial = await mapAssetCorpusWorkersOrdered(tasks.map((task) => ({ ...task, output: serialOutput })), { concurrency: 1, workerUrl });
        const parallel = await mapAssetCorpusWorkersOrdered(tasks.map((task) => ({ ...task, output: parallelOutput })), { concurrency: 4, workerUrl });
        expect(serial.map(({ threadId: _threadId, pid: _pid, ...entry }: Record<string, unknown>) => entry))
          .toEqual(parallel.map(({ threadId: _threadId, pid: _pid, ...entry }: Record<string, unknown>) => entry));
        const names = await readdir(serialOutput);
        expect(names).toEqual(await readdir(parallelOutput));
        for (const name of names) expect(await readFile(join(serialOutput, name))).toEqual(await readFile(join(parallelOutput, name)));
      }
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true });
    }

    const failureRoot = await mkdtemp(join(tmpdir(), "glyph-worker-failure-"));
    try {
      const finalOutput = join(failureRoot, "final");
      await expect(runStagedAssetCorpus(finalOutput, (stagingOutput: string) => mapAssetCorpusWorkersOrdered([
        { id: 0, population: "exact-rgb", output: stagingOutput, delay: 30 },
        { id: 1, population: "exact-rgb", output: stagingOutput, failAfterWrite: true },
      ], { concurrency: 2, workerUrl }), async () => {})).rejects.toThrow("mid-write-sentinel");
      expect(await readdir(failureRoot)).toEqual([]);
      await mkdir(join(finalOutput, "missing"), { recursive: true });
      await writeFile(join(finalOutput, "missing", "sentinel"), "original");
      await expect(runStagedAssetCorpus(finalOutput, async () => [{ assetId: "asset/missing" }], async () => {})).rejects.toThrow();
      expect(await readdir(failureRoot)).toEqual(["final"]);
      expect(await readFile(join(finalOutput, "missing", "sentinel"), "utf8")).toBe("original");
    } finally {
      await rm(failureRoot, { recursive: true, force: true });
    }
  });

  it("keeps genuine exact and material production artifacts byte-identical across direct and worker execution", async () => {
    const fixtureRoot = await mkdtemp(join(tmpdir(), "glyph-real-worker-parity-"));
    const directOutput = join(fixtureRoot, "direct"), workerOutput = join(fixtureRoot, "worker");
    const runtime = { imageId: `sha256:${"9".repeat(64)}`, baseImage: "test-fixture", nodeVersion: process.version, sourceFileSetSha256: "8".repeat(64) };
    const fixtureConfigPath = join(fixtureRoot, "asset-corpus.json");
    const fixtureConfig = JSON.parse(await readFile(resolve(root, "config/asset-corpus.json"), "utf8"));
    fixtureConfig.trajectory = {
      ...fixtureConfig.trajectory,
      occlusionSchedule: ["none"],
      occlusions: [fixtureConfig.trajectory.occlusions[0]],
    };
    await writeFile(fixtureConfigPath, `${JSON.stringify(fixtureConfig, null, 2)}\n`);
    const tasks = [
      { population: "exact-rgb", configPath: fixtureConfigPath, assetId: "asset/c15ee1ca253975a5fc0a106f118200c967937457c1c0d1cca874b017bbf26b19", runtime },
      { population: "material-only", configPath: fixtureConfigPath, assetId: "asset/6eafcf7b79e0ed698dd51f77a98abf9231a3fe9553658dc20e428cac64a83413", runtime },
    ];
    try {
      const [direct, worker] = await Promise.all([
        (async () => {
          const rendered = [];
          for (const task of tasks) rendered.push(await renderAssetCorpusWorkerTask({ ...task, output: directOutput }));
          return rendered;
        })(),
        mapAssetCorpusWorkersOrdered(tasks.map((task) => ({ ...task, output: workerOutput })), { concurrency: 2 }),
      ]);
      expect(worker).toEqual(direct);
      expect(await treeBytes(workerOutput)).toEqual(await treeBytes(directOutput));
      const taxonomy = await loadAssetTaxonomy();
      const materialRendered: any = worker[1], materialAsset = taxonomy.registry.assets.find((entry: any) => entry.id === materialRendered.assetId)!;
      const registry = { ...taxonomy.registry, assets: [materialAsset] };
      const configBytes = await readFile(fixtureConfigPath), validationConfig = { ...fixtureConfig, __bytes: configBytes, output: workerOutput };
      const normalizationPath = resolve(root, fixtureConfig.controlNormalization), normalizationBytes = await readFile(normalizationPath), normalizationValue = JSON.parse(normalizationBytes.toString("utf8"));
      const normalization = { path: `research/ascii-image-generation/${fixtureConfig.controlNormalization}`, contentSha256: createHash("sha256").update(canonical(normalizationValue)).digest("hex"), fileSha256: createHash("sha256").update(normalizationBytes).digest("hex"), value: normalizationValue };
      const reportFor = (rendered: any) => ({ population: "material-only", populationSummary: { targetStatus: "material-only-not-exact-rgb", exactRgbEvaluation: "excluded", expectedAdmittedMaterialOnly: 1 }, runtime, rendered: [rendered] });
      await expect(validateMaterialArtifacts(reportFor(materialRendered), validationConfig, registry, taxonomy.dictionary, taxonomy, normalization)).resolves.toBeUndefined();
      const bare = materialRendered.assetId.slice("asset/".length), directAssetRoot = join(directOutput, bare), workerAssetRoot = join(workerOutput, bare);
      const cascade = async (kind: "camera" | "scene" | "geometry") => {
        await rm(workerAssetRoot, { recursive: true, force: true }); await cp(directAssetRoot, workerAssetRoot, { recursive: true });
        const manifestPath = join(workerAssetRoot, "asset-manifest.json"), manifest = JSON.parse(await readFile(manifestPath, "utf8"));
        const variant = manifest.variants[0], controlsRoot = join(workerAssetRoot, "variants", variant.id, "controls");
        const controlsPath = join(controlsRoot, "manifest.json"), controls = JSON.parse(await readFile(controlsPath, "utf8"));
        const metadataRelative = controls.frames[0].files.metadata, metadataPath = join(controlsRoot, metadataRelative), metadata = JSON.parse(await readFile(metadataPath, "utf8"));
        const scenePath = join(controlsRoot, "scene.json"), scene = JSON.parse(await readFile(scenePath, "utf8"));
        if (kind === "camera") {
          // Rebind every fitted camera component, including those that could
          // otherwise preserve an angle-only fixture while changing framing.
          metadata.camera.rotX = 999; metadata.camera.rotY = 998; metadata.camera.zoom = 997;
          metadata.camera.center = [996, 995]; metadata.camera.target = [994, 993, 992];
          variant.frames[0].camera = structuredClone(metadata.camera);
        }
        else if (kind === "scene") {
          scene.id = `${scene.id}/rebound`; scene.contentSha256 = createHash("sha256").update(canonical(scene)).digest("hex");
          metadata.scene = structuredClone(scene); variant.frames[0].controlSceneSha256 = scene.contentSha256;
        } else {
          scene.geometrySha256 = "0".repeat(64); scene.contentSha256 = createHash("sha256").update(canonical(scene)).digest("hex");
          metadata.scene = structuredClone(scene); variant.frames[0].controlSceneSha256 = scene.contentSha256; variant.renderGeometrySha256 = scene.geometrySha256;
        }
        if (kind !== "camera") {
          const sceneBytes = Buffer.from(`${JSON.stringify(scene, null, 2)}\n`); await writeFile(scenePath, sceneBytes);
          controls.files["scene.json"] = createHash("sha256").update(sceneBytes).digest("hex");
        }
        const metadataBytes = Buffer.from(`${JSON.stringify(metadata, null, 2)}\n`); await writeFile(metadataPath, metadataBytes);
        controls.files[metadataRelative] = createHash("sha256").update(metadataBytes).digest("hex");
        controls.contentSha256 = createHash("sha256").update(canonical(controls)).digest("hex");
        await writeFile(controlsPath, `${JSON.stringify(controls, null, 2)}\n`);
        variant.controlsManifestSha256 = controls.contentSha256;
        manifest.contentSha256 = createHash("sha256").update(canonical(manifest)).digest("hex");
        const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`); await writeFile(manifestPath, manifestBytes);
        const rebound = { ...materialRendered, variants: structuredClone(manifest.variants), provenanceSha256: createHash("sha256").update(manifestBytes).digest("hex") };
        return validateMaterialArtifacts(reportFor(rebound), validationConfig, registry, taxonomy.dictionary, taxonomy, normalization);
      };
      await expect(cascade("camera")).rejects.toThrow("ASSET_CORPUS_MATERIAL_FRAME_METADATA_REBOUND");
      await expect(cascade("scene")).rejects.toThrow("ASSET_CORPUS_MATERIAL_FRAME_METADATA_REBOUND");
      await expect(cascade("geometry")).rejects.toThrow("ASSET_CORPUS_MATERIAL_RENDER_GEOMETRY_REBOUND");
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  }, 300_000);

  it("maps every B49-admitted real asset once through a sealed non-tautological authority", async () => {
    const taxonomy = await loadAssetTaxonomy();
    expect(taxonomy.admitted).toHaveLength(179);
    expect(taxonomy.mapping.mappings).toHaveLength(179);
    expect(taxonomy.mapping.mappings.filter((entry: { appearanceDisposition: string }) => entry.appearanceDisposition === "exact-rgb")).toHaveLength(45);
    expect(taxonomy.mapping.mappings.filter((entry: { appearanceDisposition: string }) => entry.appearanceDisposition === "material-only")).toHaveLength(134);
    expect(Object.keys(taxonomy.coverage)).toHaveLength(11);
    expect(taxonomy.dictionary.classes.find((entry: { name: string }) => entry.name === "synthetic-occluder")).toMatchObject({ id: 12, semanticGlyph: "\\" });
    expect(resolveAssetTaxonomyClass(taxonomy, taxonomy.admitted.find((asset: { canonicalPath: string }) => asset.canonicalPath.endsWith("/Frog.glb"))!)).toMatchObject({ name: "animal" });
    expect(resolveAssetTaxonomyClass(taxonomy, taxonomy.admitted.find((asset: { canonicalPath: string }) => asset.canonicalPath.endsWith("/nasa/opportunity.glb"))!)).toMatchObject({ name: "ground-vehicle" });
    expect(taxonomy.admitted.map((asset: { id: string }) => resolveAssetTaxonomyClass(taxonomy, asset).name)).not.toContain("cube");
  });

  it("fails closed for stale registry or dictionary bindings and unknown class mappings", async () => {
    const taxonomy = await loadAssetTaxonomy();
    expect(() => validateAssetTaxonomy({ ...taxonomy, mapping: { ...taxonomy.mapping, registry: { ...taxonomy.mapping.registry, contentSha256: "0".repeat(64) } } })).toThrow("ASSET_TAXONOMY_REGISTRY_REBOUND");
    const mapping = structuredClone(taxonomy.mapping); mapping.mappings[0].classId = 999;
    expect(() => validateAssetTaxonomy({ ...taxonomy, mapping: reseal(mapping) })).toThrow("ASSET_TAXONOMY_MAPPING_DUPLICATE_OR_UNKNOWN_CLASS");
    const unknownSchema = structuredClone(taxonomy.mapping); unknownSchema.schemaVersion = "glyph-asset-class-mapping/v0";
    expect(() => validateAssetTaxonomy({ ...taxonomy, mapping: reseal(unknownSchema) })).toThrow("ASSET_TAXONOMY_MAPPING_SCHEMA_INVALID");
    const extraMapping = structuredClone(taxonomy.mapping) as typeof taxonomy.mapping & { extra: boolean }; extraMapping.extra = true;
    expect(() => validateAssetTaxonomy({ ...taxonomy, mapping: reseal(extraMapping) })).toThrow("ASSET_TAXONOMY_MAPPING_SCHEMA_INVALID");
    const extraDictionary = structuredClone(taxonomy.dictionary) as typeof taxonomy.dictionary & { extra: boolean }; extraDictionary.extra = true;
    expect(() => validateAssetTaxonomy({ ...taxonomy, dictionary: reseal(extraDictionary) })).toThrow("ASSET_TAXONOMY_DICTIONARY_SCHEMA_INVALID");
    expect(() => resolveAssetTaxonomyClass(taxonomy, { id: "asset/not-admitted" })).toThrow("ASSET_TAXONOMY_ASSET_CLASS_ABSENT");
  });

  it("rejects re-sealed rendered provenance rebound from its B50 authority", async () => {
    const taxonomy = await loadAssetTaxonomy();
    const asset = taxonomy.registry.assets.find((entry: { admitted: boolean; appearanceDisposition: string }) => entry.admitted && entry.appearanceDisposition === "exact-rgb")!;
    const classId = resolveAssetTaxonomyClass(taxonomy, asset).id;
    const controlNormalization = { path: "research/ascii-image-generation/config/control-normalization.json", contentSha256: "d".repeat(64), fileSha256: "e".repeat(64) };
    const assetDecoderParity = { path: "research/ascii-image-generation/reports/asset-render-binding-decoder-parity.json", contentSha256: "f".repeat(64), fileSha256: "1".repeat(64) };
    const runtime = { imageId: `sha256:${"9".repeat(64)}`, baseImage: "node@sha256:example", nodeVersion: "v22.14.0", sourceFileSetSha256: "8".repeat(64) };
    const authority = { runtime, registry: taxonomy.registry, dictionary: taxonomy.dictionary, taxonomy, assetRenderBindingsSha256: "c".repeat(64), assetDecoderParity, controlNormalization, configSha256: "a".repeat(64), rendererContractSha256: "b".repeat(64) };
    const manifest = { asset: { id: asset.id, canonicalPath: asset.canonicalPath, aliases: asset.aliases, sourcePackIds: asset.sourcePackIds, sourceIds: asset.sourceIds, textureIds: asset.textureIds, sourceGeometrySha256: asset.geometry.sha256, split: asset.split, splitGroupId: asset.splitGroupId }, renderer: { runtime, mappingSha256: taxonomy.mapping.contentSha256, dictionarySha256: taxonomy.dictionary.contentSha256, registrySha256: taxonomy.registry.contentSha256, assetRenderBindingsSha256: authority.assetRenderBindingsSha256, assetDecoderParity, controlNormalization, configSha256: authority.configSha256, rendererContractSha256: authority.rendererContractSha256, classId } };
    const rendered = { assetId: asset.id };
    expect(() => validateRenderedAssetAuthority(rendered, manifest, authority)).not.toThrow();
    for (const key of ["mappingSha256", "dictionarySha256", "registrySha256", "assetRenderBindingsSha256", "configSha256", "rendererContractSha256", "classId"] as const) {
      const rebound = structuredClone(manifest); (rebound.renderer as Record<string, unknown>)[key] = key === "classId" ? 999 : "0".repeat(64);
      expect(() => validateRenderedAssetAuthority(rendered, rebound, authority)).toThrow("ASSET_CORPUS_RENDERED_AUTHORITY_REBOUND");
    }
    const reboundLineage = structuredClone(manifest); reboundLineage.asset.canonicalPath = "website/public/gallery/rebound.glb";
    expect(() => validateRenderedAssetAuthority(rendered, reboundLineage, authority)).toThrow("ASSET_CORPUS_RENDERED_LINEAGE_REBOUND");
    const reboundNormalization = structuredClone(manifest); reboundNormalization.renderer.controlNormalization.fileSha256 = "0".repeat(64);
    expect(() => validateRenderedAssetAuthority(rendered, reboundNormalization, authority)).toThrow("ASSET_CORPUS_RENDERED_AUTHORITY_REBOUND");
    const missingParity = structuredClone(manifest); delete (missingParity.renderer as Record<string, unknown>).assetDecoderParity;
    expect(() => validateRenderedAssetAuthority(rendered, missingParity, authority)).toThrow("ASSET_CORPUS_RENDERED_AUTHORITY_REBOUND");
    const reboundRuntime = structuredClone(manifest); reboundRuntime.renderer.runtime.imageId = `sha256:${"0".repeat(64)}`;
    expect(() => validateRenderedAssetAuthority(rendered, reboundRuntime, authority)).toThrow("ASSET_CORPUS_RENDERED_AUTHORITY_REBOUND");
  });

  it("rejects a re-sealed render-binding authority whose source dispositions no longer derive from the registry", async () => {
    const registry = (await loadAssetTaxonomy()).registry;
    const binding = JSON.parse(await readFile(resolve(root, "reports/asset-render-bindings.json"), "utf8"));
    expect(() => validateAssetRenderBindingAuthority(binding, registry, binding.contentSha256)).not.toThrow();
    const rebound = structuredClone(binding);
    const source = rebound.sourceCoverage.find((entry: { corpusDisposition: string }) => entry.corpusDisposition === "admission-failure");
    source.corpusDisposition = "render-bound-base-color";
    expect(() => validateAssetRenderBindingAuthority(reseal(rebound), registry, binding.contentSha256)).toThrow("ASSET_CORPUS_RENDER_BINDING_DISPOSITION_REBOUND");
  }, 30_000);

  it("rejects every re-sealed texture-role and decoded base-color substitution", async () => {
    const registry = (await loadAssetTaxonomy()).registry;
    const binding = JSON.parse(await readFile(resolve(root, "reports/asset-render-bindings.json"), "utf8"));
    const source = binding.sourceCoverage.find((entry: { baseColorSources: unknown[] }) => entry.baseColorSources.length > 0);
    const substitutions: Array<[string, (value: typeof binding) => void, string]> = [
      ["texture role", (value) => { value.sourceCoverage.find((entry: { sourcePath: string }) => entry.sourcePath === source.sourcePath).textureRoles[0].role = "normal"; }, "ASSET_CORPUS_RENDER_BINDING_TEXTURE_ROLES_REBOUND"],
      ["texture id", (value) => { value.sourceCoverage.find((entry: { sourcePath: string }) => entry.sourcePath === source.sourcePath).baseColorSources[0].textureId = `texture/${"0".repeat(64)}`; }, "ASSET_CORPUS_RENDER_BINDING_BASE_COLOR_CENSUS_REBOUND"],
      ["byte hash", (value) => { value.sourceCoverage.find((entry: { sourcePath: string }) => entry.sourcePath === source.sourcePath).baseColorSources[0].byteSha256 = "0".repeat(64); }, "ASSET_CORPUS_RENDER_BINDING_BASE_COLOR_INVALID"],
      ["decoded hash", (value) => { value.sourceCoverage.find((entry: { sourcePath: string }) => entry.sourcePath === source.sourcePath).baseColorSources[0].decodedPixelSha256 = "0".repeat(64); }, "ASSET_CORPUS_RENDER_BINDING_BASE_COLOR_SOURCE_REBOUND"],
      ["dimensions", (value) => { value.sourceCoverage.find((entry: { sourcePath: string }) => entry.sourcePath === source.sourcePath).baseColorSources[0].width = 0; }, "ASSET_CORPUS_RENDER_BINDING_BASE_COLOR_INVALID"],
      ["sample", (value) => { value.sourceCoverage.find((entry: { sourcePath: string }) => entry.sourcePath === source.sourcePath).baseColorSources[0].sample.rgba[0] = 256; }, "ASSET_CORPUS_RENDER_BINDING_BASE_COLOR_INVALID"],
    ];
    for (const [label, substitute, error] of substitutions) {
      const rebound = structuredClone(binding); substitute(rebound);
      expect(() => validateAssetRenderBindingAuthority(reseal(rebound), registry, binding.contentSha256), label).toThrow(error === "ASSET_CORPUS_RENDER_BINDING_BASE_COLOR_SOURCE_REBOUND" ? "ASSET_CORPUS_RENDER_BINDING_SOURCE_TRUTH_REBOUND" : error);
    }
  });

  it("accepts the sealed passing decoder parity and rejects re-sealed partial or stale parity", async () => {
    const taxonomy = await loadAssetTaxonomy();
    const binding = JSON.parse(await readFile(resolve(root, "reports/asset-render-bindings.json"), "utf8"));
    const parity = JSON.parse(await readFile(resolve(root, "reports/asset-render-binding-decoder-parity.json"), "utf8"));
    expect(() => validateAssetDecoderParityAuthority(parity, binding, taxonomy.registry)).not.toThrow();
    const partial = structuredClone(parity); partial.browserRun = null;
    expect(() => validateAssetDecoderParityAuthority(reseal(partial), binding, taxonomy.registry)).toThrow("ASSET_CORPUS_DECODER_PARITY_INCOMPLETE_OR_STALE");
    const stale = structuredClone(parity); stale.assetRenderBindingsSha256 = "0".repeat(64);
    expect(() => validateAssetDecoderParityAuthority(reseal(stale), binding, taxonomy.registry)).toThrow("ASSET_CORPUS_DECODER_PARITY_AUTHORITY_INVALID");
  });

  it("promotes B44 render readiness only after the sealed complete parity authority", async () => {
    const readiness = await renderAssetCorpus("config/asset-corpus.json");
    expect(readiness.assetDecoderParity).toMatchObject({ status: "pass", pass: true, complete: true });
    expect(readiness.assets.exactRgbTargets).toBe("ready-for-remote-render");
    expect(readiness.rendered).toEqual([]);
  }, 30_000);

  it("rejects a re-sealed trajectory pose whose stable variation id was left unchanged", () => {
    const expected = [{ id: "clip-0--none", pose: { id: "clip-0", kind: "animated", clip: 0, timeSeconds: 1 }, occlusion: { id: "none" } }];
    const persisted = structuredClone(expected);
    expect(() => validateAssetCorpusVariantSchedule("asset/example", persisted, persisted, expected)).not.toThrow();
    persisted[0].pose.timeSeconds = 0.5;
    expect(() => validateAssetCorpusVariantSchedule("asset/example", persisted, persisted, expected)).toThrow("ASSET_CORPUS_RENDERED_SCHEDULE_REBOUND");
  });

  it("rejects controls whose normalization value is not the sealed normalization authority", () => {
    const authority = { value: { depth: { near: -4, far: 8 }, world: { min: [-3, -3, -3], max: [3, 3, 3] } } };
    const manifest = { normalization: structuredClone(authority.value) };
    expect(() => validateControlNormalizationManifest(manifest, authority)).not.toThrow();
    manifest.normalization.depth.far = 9;
    expect(() => validateControlNormalizationManifest(manifest, authority)).toThrow("ASSET_CORPUS_CONTROL_NORMALIZATION_REBOUND");
  });

  it("keeps the B50 report reproducible", async () => {
    const report = await buildAssetTaxonomyReport();
    expect(report.counts).toMatchObject({ admitted: 179, byDisposition: { "exact-rgb": 45, "material-only": 134 } });
    expect(report.texturedSourceAudit).toHaveLength(77);
    expect(new Set(report.texturedSourceAudit.map((entry: { canonicalAssetId: string }) => entry.canonicalAssetId)).size).toBe(76);
    expect(report.texturedSourceAudit.filter((entry: { disposition: string }) => entry.disposition === "first-population-exact-rgb")).toHaveLength(46);
    expect(report.texturedSourceAudit.filter((entry: { disposition: string; exclusionReasons: string[] }) => entry.disposition === "excluded").every((entry: { exclusionReasons: string[] }) => entry.exclusionReasons.length > 0)).toBe(true);
    expect(report.classificationNotes).toContainEqual(expect.objectContaining({ className: "synthetic-occluder", assetPath: null, rationale: expect.stringContaining("map zero source assets") }));
    expect(JSON.parse(await readFile(resolve(root, "reports/asset-taxonomy.json"), "utf8"))).toMatchObject(report);
  });
});
