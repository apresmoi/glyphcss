import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
const checkerState = vi.hoisted(() => ({ calls: 0 }));
vi.mock("../scripts/admit-rendered-targets.mjs", () => ({
  checkRenderedTargetAdmission: async () => { checkerState.calls++; return {}; },
}));
import { buildNativePilotDataset, validateNativePilotDataset, validateNativePilotLeakage } from "../src/native-pilot.mjs";

const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const canonical = (value: any): string => Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : value && typeof value === "object" ? `{${Object.keys(value).filter((key) => key !== "contentSha256").sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}` : JSON.stringify(value);
const raster = { id: "glyph-model-raster/physical-cell-letterbox-v1", width: 256, height: 256, source: { cols: 256, rows: 128, cellAspect: 2 }, fit: "contain", targetSampling: "nearest", discreteControlSampling: "nearest", continuousControlSampling: "nearest", latentContinuousSampling: "bilinear" };
const metrics = Object.fromEntries(["visible-ascii-adherence", "semantic-class-presence", "dictionary-class-confusion", "instance-surface-preservation", "depth-edge-agreement", "unintended-additions", "style-match", "cross-view-identity", "reprojection-valid-error", "disocclusion-recovery", "temporal-warp-error", "correction-magnitude"].map((key) => [key, 0]));

describe("B11 native asset-first pilot", () => {
  it("consumes only B45 exact-RGB records, preserves B43 groups, and rejects a changed source target", async () => {
    const directory = await mkdtemp(join(tmpdir(), "glyph-native-pilot-")), assets = join(directory, "assets"), pilot = join(directory, "pilot");
    try {
      const accepted: any[] = [], sourceFiles: any[] = [];
      for (const [split, token] of [["train", "a"], ["validation", "b"], ["test", "c"]]) {
        const id = `asset/${token.repeat(64)}`, bare = id.slice(6), variantId = "static--none", frameId = "frame-000";
        const variantRoot = join(assets, bare, "variants", variantId), targetPath = join(variantRoot, "target-000.png"), controls = join(variantRoot, "controls", "manifest.json");
        const controlRoot = join(variantRoot, "controls"), semanticPath = `frames/${frameId}/semantic.txt`, lookupPath = `frames/${frameId}/index-lookups.json`;
        await mkdir(join(controlRoot, "frames", frameId), { recursive: true }); await writeFile(targetPath, split);
        await writeFile(join(controlRoot, semanticPath), "A"); await writeFile(join(controlRoot, lookupPath), JSON.stringify({ instanceLookup: [`instance/${split}`], surfaceLookup: [`surface/${split}`] }));
        const controlRaw: any = { files: { [semanticPath]: hash("A"), [lookupPath]: hash(JSON.stringify({ instanceLookup: [`instance/${split}`], surfaceLookup: [`surface/${split}`] })) }, frames: [{ id: frameId, files: { semantic: semanticPath, indexLookups: lookupPath } }] }; controlRaw.contentSha256 = hash(canonical(controlRaw));
        await writeFile(controls, JSON.stringify(controlRaw));
        const assetLineage = { id, split, splitGroupId: `group/${split}`, sourceGeometrySha256: hash(`geometry:${split}`), textureIds: [`texture/${split}`], sourcePackIds: [`pack/${split}`] };
        const assetManifest: any = { asset: assetLineage, renderer: { classId: 7 }, variants: [{ id: variantId, pose: { id: "static", kind: "static" }, occlusion: { id: "none" }, frames: [{ id: frameId, cameraId: "orbit-a", lightingId: "key-a" }] }] }; assetManifest.contentSha256 = hash(canonical(assetManifest));
        const assetManifestBytes = JSON.stringify(assetManifest); await writeFile(join(assets, bare, "asset-manifest.json"), assetManifestBytes);
        accepted.push({ assetId: id, variantId, frameId, split, splitGroupId: `group/${split}`, target: { path: `${bare}/variants/${variantId}/target-000.png`, sha256: hash(split), decodedPixelsSha256: hash(`pixels:${split}`), width: 256, height: 128 }, controls: { manifestSha256: controlRaw.contentSha256, sceneSha256: hash(`scene:${split}`), trajectorySha256: hash(`trajectory:${split}`), visibleAsciiSha256: hash(`visible:${split}`), semanticAsciiSha256: hash("A"), targetRgbSha256: hash(`rgb:${split}`), coverageSha256: hash(`coverage:${split}`) }, provenance: { aggregateReportSha256: hash("aggregate"), assetManifestSha256: hash(assetManifestBytes), sourceGeometrySha256: hash(`geometry:${split}`), textureIds: [`texture/${split}`], sourcePackIds: [`pack/${split}`], cameraSha256: hash(`camera:${split}`), seed: "seed", renderer: { id: "renderer" } }, b10: { evaluator: "admission-v1", contractVersion: "v3", accepted: true, transition: { sourceFrameId: frameId, targetFrameId: frameId, sourceCameraSha256: hash(`camera:${split}`), targetCameraSha256: hash(`camera:${split}`), cameraChanged: false, validCellCount: 1, disoccludedCellCount: 0, oracleStateSha256: hash(`oracle:${split}`) }, metrics } });
        sourceFiles.push({ path: `${split}.glb`, canonicalAssetId: id, census: "usable-texture-uv-v1" });
      }
      while (sourceFiles.length < 77) sourceFiles.push({ path: `blocked-${sourceFiles.length}.glb`, canonicalAssetId: `asset/blocked-${sourceFiles.length}`, census: "usable-texture-uv-v1" });
      const materialAsset = { id: `asset/${"d".repeat(64)}`, admitted: true, appearanceDisposition: "material-only", split: "train", splitGroupId: "group/material", geometry: { sha256: hash("material-geometry") }, textureIds: [], sourcePackIds: ["pack/material"], admissionReasons: [] };
      const registry: any = { stats: { usableTextureUvSourceFiles: 77 }, sourceFiles, assets: [...accepted.map((entry) => ({ id: entry.assetId, admitted: true, appearanceDisposition: "exact-rgb", split: entry.split, splitGroupId: entry.splitGroupId, geometry: { sha256: entry.provenance.sourceGeometrySha256 }, textureIds: entry.provenance.textureIds, sourcePackIds: entry.provenance.sourcePackIds, admissionReasons: [] })), materialAsset] }; registry.contentSha256 = hash(canonical(registry));
      const registryPath = join(directory, "registry.json"), reportPath = join(directory, "admission.json");
      await writeFile(registryPath, JSON.stringify(registry));
      const report: any = { schemaVersion: "glyph-rendered-target-admission/v1", status: "admitted", population: "exact-rgb", b10: { evaluator: "admission-v1", contractVersion: "v3", contractPath: "config/derivations/admission-v1.json", contractSha256: "d".repeat(64), evaluatorPath: "src/eval/admission.mjs", evaluatorSha256: "e".repeat(64), baselinePath: "reports/eval-baseline.json", baselineSha256: "f".repeat(64) }, exactRgb: { reportSha256: hash("exact-report"), admittedFrameCount: accepted.length, accepted }, materialOnly: { status: "excluded-from-exact-rgb-b10", reportSha256: hash("material-report"), records: [{ assetId: materialAsset.id, split: materialAsset.split, splitGroupId: materialAsset.splitGroupId, targetStatus: "material-only-not-exact-rgb", disposition: "excluded-from-exact-rgb-b10", controlFrameCount: 1, assetManifestSha256: hash("material-manifest"), sourceGeometrySha256: materialAsset.geometry.sha256, textureIds: [], sourcePackIds: materialAsset.sourcePackIds, materialProvenance: {} }] } }; report.contentSha256 = hash(canonical(report));
      await writeFile(reportPath, JSON.stringify(report));
      const floorNames = ["sourcePacks", "classes", "semanticGlyphs", "instances", "surfaces", "cameras", "motions", "occlusions", "lighting", "geometry", "textures", "textureStatus", "appearance", "scenes", "trajectories", "splitGroups"];
      const config: any = { remoteRoot: "/mnt/docker-data/glyphcss-ascii-image-generation/datasets/pilot", assetCorpusRoot: assets, admissionReport: reportPath, assetRegistry: registryPath, assetReport: "fixture-exact.json", materialReport: "fixture-material.json", materialDatasetRoot: join(directory, "material"), heldOutAppearance: { splits: ["validation", "test"], minAssetsPerSplit: 1, minAppearancePopulationsPerSplit: 1 }, nativePrompt: "native prompt", modelRaster: raster, balance: { floors: Object.fromEntries(floorNames.map((name) => [name, 1])) } };
      checkerState.calls = 0;
      const built = await buildNativePilotDataset({ outputRoot: pilot, config, admissionReportPath: reportPath, assetCorpusRoot: assets, assetRegistryPath: registryPath });
      expect(checkerState.calls).toBe(1);
      expect(built.manifest.records).toHaveLength(3);
      expect(built.manifest.sourceCoverage).toHaveLength(77);
      expect(built.manifest.sourceCoverage.filter((entry: any) => entry.disposition === "admission-failure").every((entry: any) => entry.reasons.length > 0)).toBe(true);
      await expect(validateNativePilotDataset({ datasetRoot: pilot, reportPath: built.reportPath, config })).resolves.toMatchObject({ records: 3 });
      expect(checkerState.calls).toBe(2);
      const originalManifest = JSON.parse(await readFile(built.reportPath, "utf8"));
      const writeManifestMutation = async (mutate: (value: any) => void) => {
        const value = structuredClone(originalManifest); mutate(value);
        value.contentSha256 = hash(canonical(value));
        await writeFile(built.reportPath, `${JSON.stringify(value, null, 2)}\n`);
      };
      await writeManifestMutation((value) => {
        value.records[0].prompt = "rebound";
        value.records[0].contentSha256 = hash(canonical(value.records[0]));
      });
      await expect(validateNativePilotDataset({ datasetRoot: pilot, reportPath: built.reportPath, config })).rejects.toThrow("PILOT_NATIVE_RECORD_RECONSTRUCTION_MISMATCH");
      await writeManifestMutation((value) => { value.records[2] = structuredClone(value.records[0]); });
      await expect(validateNativePilotDataset({ datasetRoot: pilot, reportPath: built.reportPath, config })).rejects.toThrow("PILOT_NATIVE_DUPLICATE_FRAME");
      await writeManifestMutation((value) => { value.records.splice(2, 1); });
      await expect(validateNativePilotDataset({ datasetRoot: pilot, reportPath: built.reportPath, config })).rejects.toThrow("PILOT_NATIVE_B45_RECORD_COUNT_MISMATCH");
      await writeManifestMutation((value) => { value.materialOnly[0].split = "test"; });
      await expect(validateNativePilotDataset({ datasetRoot: pilot, reportPath: built.reportPath, config })).rejects.toThrow("PILOT_NATIVE_MATERIAL_AUTHORITY_REBOUND");
      await writeManifestMutation((value) => { value.materialOnly.push(structuredClone(value.materialOnly[0])); });
      await expect(validateNativePilotDataset({ datasetRoot: pilot, reportPath: built.reportPath, config })).rejects.toThrow("PILOT_NATIVE_MATERIAL_AUTHORITY_REBOUND");
      await writeManifestMutation((value) => { value.materialOnly = []; });
      await expect(validateNativePilotDataset({ datasetRoot: pilot, reportPath: built.reportPath, config })).rejects.toThrow("PILOT_NATIVE_MATERIAL_AUTHORITY_REBOUND");
      await writeManifestMutation((value) => { value.blockedAssets.push({ assetId: "asset/rebound", appearanceDisposition: "blocked", reasons: ["rebound"] }); });
      await expect(validateNativePilotDataset({ datasetRoot: pilot, reportPath: built.reportPath, config })).rejects.toThrow("PILOT_NATIVE_BLOCKED_ASSETS_REBOUND");
      await writeManifestMutation((value) => { value.sourceCoverage[0].disposition = "admission-failure"; value.sourceCoverage[0].reasons = ["rebound"]; });
      await expect(validateNativePilotDataset({ datasetRoot: pilot, reportPath: built.reportPath, config })).rejects.toThrow("PILOT_NATIVE_SOURCE_CENSUS_DRIFT");
      await writeManifestMutation((value) => { value.heldOutAppearance.test.assetIds = ["asset/rebound"]; });
      await expect(validateNativePilotDataset({ datasetRoot: pilot, reportPath: built.reportPath, config })).rejects.toThrow("PILOT_NATIVE_HELD_OUT_APPEARANCE_REBOUND");
      await writeFile(built.reportPath, `${JSON.stringify(originalManifest, null, 2)}\n`);
      const originalAdmission = JSON.parse(await readFile(reportPath, "utf8"));
      const duplicateAdmission = structuredClone(originalAdmission);
      duplicateAdmission.exactRgb.accepted[2] = structuredClone(duplicateAdmission.exactRgb.accepted[0]);
      duplicateAdmission.contentSha256 = hash(canonical(duplicateAdmission));
      const duplicateAdmissionBytes = `${JSON.stringify(duplicateAdmission, null, 2)}\n`;
      await writeFile(reportPath, duplicateAdmissionBytes);
      await writeManifestMutation((value) => { value.authority.admissionReportSha256 = hash(duplicateAdmissionBytes); });
      await expect(validateNativePilotDataset({ datasetRoot: pilot, reportPath: built.reportPath, config })).rejects.toThrow("PILOT_NATIVE_B45_ACCEPTED_DUPLICATE");
      await writeFile(reportPath, JSON.stringify(originalAdmission));
      await writeFile(built.reportPath, `${JSON.stringify(originalManifest, null, 2)}\n`);
      const semantic = join(assets, accepted[0].assetId.slice(6), "variants", accepted[0].variantId, "controls", "frames", accepted[0].frameId, "semantic.txt");
      await writeFile(semantic, "B");
      await expect(validateNativePilotDataset({ datasetRoot: pilot, reportPath: built.reportPath, config })).rejects.toThrow("PILOT_NATIVE_CONTROL_FILE_HASH_MISMATCH");
      await writeFile(semantic, "A");
      expect(() => validateNativePilotLeakage([{ ...built.manifest.records[0] }, { ...built.manifest.records[1], asset: { ...built.manifest.records[1].asset, textureIds: built.manifest.records[0].asset.textureIds } }])).toThrow("PILOT_NATIVE_CROSS_SPLIT_LEAKAGE");
      await writeFile(join(assets, accepted[0].target.path), "tampered");
      await expect(validateNativePilotDataset({ datasetRoot: pilot, reportPath: built.reportPath, config })).rejects.toThrow("PILOT_NATIVE_ARTIFACT_HASH_MISMATCH");
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
