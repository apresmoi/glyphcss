import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCanvas, ImageData } from "@napi-rs/canvas";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { fitAssetCorpusCamera, materialOnlyProvenance, targetBytes, validateMaterialAssetManifest, validateMaterialControlFrameAuthority, verifyTargetPngAgainstControls } from "../src/render-asset-corpus.mjs";

const canonical = (value: any): string => Array.isArray(value) ? `[${value.map(canonical).join(",")}]`
  : value && typeof value === "object" ? `{${Object.keys(value).filter((key) => key !== "contentSha256").sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`
    : JSON.stringify(value);
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "glyph-asset-target-"));
  const target = join(directory, "target.png"), rgb = join(directory, "target-rgb-u32.bin"), coverage = join(directory, "coverage-u8.bin");
  const colors = [0x112233, 0], mask = Buffer.from([1, 0]);
  const canvas = createCanvas(2, 1), context = canvas.getContext("2d");
  context.putImageData(new ImageData(new Uint8ClampedArray([0x11, 0x22, 0x33, 255, 0x44, 0x55, 0x66, 0]), 2, 1), 0, 0);
  const maps = Buffer.alloc(colors.length * 4);
  colors.forEach((color, index) => maps.writeUInt32LE(color, index * 4));
  await Promise.all([writeFile(target, canvas.toBuffer("image/png")), writeFile(rgb, maps), writeFile(coverage, mask)]);
  return { directory, target, rgb, coverage, mask };
}

describe("B44 target/control reconciliation", () => {
  it("centers and margin-fits the actual rotated silhouette rather than its unrotated AABB sphere", () => {
    const polygons = [
      { vertices: [[-4, -1, -0.2], [3, -1, -0.2], [3, 0.3, -0.2]], color: "#fff" },
      { vertices: [[-4, -1, -0.2], [3, 0.3, -0.2], [-1, 2.5, 1.7]], color: "#fff" },
    ];
    const config = {
      grid: { cols: 256, rows: 128, cellAspect: 2 },
      trajectory: {
        margin: 0.05, seed: "fit-test", rotX: 61,
        traceAuthority: { id: "b39-slow-trace-32-subdivision-v1", path: "fixtures/reprojection/reference-trace-v1.json", contentSha256: "e6e62a8300ffbbd7b8df2fffbfb2a72d87adf62eed47aa1ba97cb322f714657c", segmentId: "slow", traceModule: "src/generate-controls.mjs" },
        anchors: [{ id: "orbit-a", rotXOffset: 0, rotYOffset: 17 }],
      },
    };
    const camera = fitAssetCorpusCamera(polygons, config, 1, "asset/asymmetric", { id: "orbit-a", rotXOffset: 0, rotYOffset: 17 });
    const points = polygons.flatMap((polygon) => polygon.vertices.map((vertex) => camera.project(vertex, config.grid.cols, config.grid.rows, config.grid.cellAspect)));
    const cols = points.map((point) => point[0]), rows = points.map((point) => point[1]);
    const bounds = { minCol: Math.min(...cols), maxCol: Math.max(...cols), minRow: Math.min(...rows), maxRow: Math.max(...rows) };
    expect((bounds.minCol + bounds.maxCol) / 2).toBeCloseTo(config.grid.cols / 2, 10);
    expect((bounds.minRow + bounds.maxRow) / 2).toBeCloseTo(config.grid.rows / 2, 10);
    expect(bounds.minCol).toBeGreaterThanOrEqual(config.grid.cols * config.trajectory.margin - 1e-10);
    expect(bounds.maxCol).toBeLessThanOrEqual(config.grid.cols * (1 - config.trajectory.margin) + 1e-10);
    expect(bounds.minRow).toBeGreaterThanOrEqual(config.grid.rows * config.trajectory.margin - 1e-10);
    expect(bounds.maxRow).toBeLessThanOrEqual(config.grid.rows * (1 - config.trajectory.margin) + 1e-10);
    const limitingFill = Math.max(
      (bounds.maxCol - bounds.minCol) / config.grid.cols,
      (bounds.maxRow - bounds.minRow) / config.grid.rows,
    );
    expect(limitingFill).toBeCloseTo(1 - 2 * config.trajectory.margin, 10);
  });

  it("encodes all packed RGB channels without Uint8ClampedArray saturation", async () => {
    const image = await import("@napi-rs/canvas").then(({ loadImage }) => loadImage(targetBytes({
      metadata: { cols: 1, rows: 1 },
      targetRgb: new Uint32Array([0x684012]),
      coverage: new Uint8Array([1]),
    })));
    const canvas = createCanvas(1, 1), context = canvas.getContext("2d");
    context.drawImage(image, 0, 0);
    expect(Array.from(context.getImageData(0, 0, 1, 1).data)).toEqual([0x68, 0x40, 0x12, 0xff]);
  });

  it("accepts the PNG only when dimensions and every RGBA cell agree with targetRgb and coverage", async () => {
    const files = await fixture();
    try {
      await expect(verifyTargetPngAgainstControls(files.target, files.rgb, files.coverage, 2, 1)).resolves.toBeUndefined();
      files.mask[1] = 1;
      await writeFile(files.coverage, files.mask);
      await expect(verifyTargetPngAgainstControls(files.target, files.rgb, files.coverage, 2, 1)).rejects.toThrow("ASSET_CORPUS_TARGET_PIXEL_RECONCILIATION_FAILED");
    } finally {
      await rm(files.directory, { recursive: true, force: true });
    }
  });
});

describe("B48 material-only provenance", () => {
  const asset = {
    id: "asset/material", admitted: true, appearanceDisposition: "material-only", textureIds: ["texture/normal"],
    materials: [{ name: "bronze", baseColor: [0.73, 0.33, 0.05, 1], textures: [{ textureId: "texture/normal", role: "normal" }] }],
  };

  it("records authored material colors without treating them as decoded base-color textures", () => {
    expect(materialOnlyProvenance(asset)).toMatchObject({
      targetStatus: "material-only-not-exact-rgb", disposition: "material-only-control-derived", colorSource: "authored-material-base-color",
      textureIds: ["texture/normal"], nonBaseColorTextureIds: ["texture/normal"],
    });
  });

  it("fails closed when B43 authority says a material-only asset gained a base-color texture", () => {
    expect(() => materialOnlyProvenance({ ...asset, materials: [{ ...asset.materials[0], textures: [{ textureId: "texture/color", role: "baseColor" }] }] }))
      .toThrow("ASSET_CORPUS_MATERIAL_ONLY_TEXTURE_RECLASSIFICATION_REQUIRED");
  });

  it("pins a missing material factor to the renderer's documented white default", () => {
    const provenance = materialOnlyProvenance({ ...asset, materials: [{ name: "fallback", textures: [] }] });
    expect(provenance.baseColorsSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects every re-sealed material renderer and lineage authority rebound", () => {
    const authoritativeAsset = {
      ...asset, aliases: ["alias"], sourceIds: ["source"], sourcePackIds: ["pack"],
      canonicalPath: "website/public/gallery/material.glb", split: "train", splitGroupId: "group",
      geometry: { sha256: "1".repeat(64) },
    };
    const runtime = { imageId: `sha256:${"2".repeat(64)}`, baseImage: "node@sha256:test", nodeVersion: "v22.14.0", sourceFileSetSha256: "3".repeat(64) };
    const controlNormalization = { path: "normalization.json", contentSha256: "4".repeat(64), fileSha256: "5".repeat(64) };
    const texturePolicy = { decoder: "pinned", colorSpace: "source-srgb", filter: "nearest", wrap: "clamp-to-edge" };
    const dictionaryClass = { id: 9, name: "fixture" };
    const authority = {
      runtime, registry: { contentSha256: "6".repeat(64), assets: [authoritativeAsset] },
      dictionary: { contentSha256: "7".repeat(64), classes: [dictionaryClass] },
      taxonomy: { mapping: { contentSha256: "8".repeat(64) }, dictionary: { classes: [dictionaryClass] }, byAsset: new Map([[asset.id, { classId: 9 }]]) },
      configSha256: "a".repeat(64), rendererContractSha256: "b".repeat(64), controlNormalization, supersample: 1, texturePolicy,
    };
    const material = materialOnlyProvenance(authoritativeAsset);
    const rawManifest: any = {
      schemaVersion: "glyph-material-asset-trajectory/v1", population: "material-only", target: material, variants: [],
      asset: {
        id: asset.id, canonicalPath: authoritativeAsset.canonicalPath, aliases: authoritativeAsset.aliases,
        sourceIds: authoritativeAsset.sourceIds, sourcePackIds: authoritativeAsset.sourcePackIds,
        textureIds: authoritativeAsset.textureIds, sourceGeometrySha256: authoritativeAsset.geometry.sha256,
        split: authoritativeAsset.split, splitGroupId: authoritativeAsset.splitGroupId,
      },
      renderer: {
        runtime, configSha256: authority.configSha256, rendererContractSha256: authority.rendererContractSha256,
        controlNormalization, supersample: 1, texturePolicy, mappingSha256: authority.taxonomy.mapping.contentSha256,
        dictionarySha256: authority.dictionary.contentSha256, registrySha256: authority.registry.contentSha256, classId: 9,
        materialProvenance: material,
      },
    };
    const seal = (manifest: any) => ({ ...manifest, contentSha256: hash(canonical(manifest)) });
    const bytes = (manifest: any) => Buffer.from(`${JSON.stringify(seal(manifest), null, 2)}\n`);
    const positiveBytes = bytes(rawManifest);
    const rendered = { assetId: asset.id, sourceGeometrySha256: authoritativeAsset.geometry.sha256, variants: [], provenanceSha256: hash(positiveBytes) };
    expect(() => validateMaterialAssetManifest(rendered, positiveBytes, authority)).not.toThrow();
    const mutations: Array<[string, (manifest: any) => void]> = [
      ["runtime.imageId", (value) => { value.renderer.runtime.imageId = `sha256:${"0".repeat(64)}`; }],
      ["runtime.baseImage", (value) => { value.renderer.runtime.baseImage = "rebound"; }],
      ["runtime.nodeVersion", (value) => { value.renderer.runtime.nodeVersion = "v0.0.0"; }],
      ["runtime.sourceFileSetSha256", (value) => { value.renderer.runtime.sourceFileSetSha256 = "0".repeat(64); }],
      ["configSha256", (value) => { value.renderer.configSha256 = "0".repeat(64); }],
      ["rendererContractSha256", (value) => { value.renderer.rendererContractSha256 = "0".repeat(64); }],
      ["normalization.path", (value) => { value.renderer.controlNormalization.path = "rebound"; }],
      ["normalization.contentSha256", (value) => { value.renderer.controlNormalization.contentSha256 = "0".repeat(64); }],
      ["normalization.fileSha256", (value) => { value.renderer.controlNormalization.fileSha256 = "0".repeat(64); }],
      ["supersample", (value) => { value.renderer.supersample = 2; }],
      ...Object.keys(texturePolicy).map((key) => [`texturePolicy.${key}`, (value: any) => { value.renderer.texturePolicy[key] = "rebound"; }] as [string, (manifest: any) => void]),
      ["mappingSha256", (value) => { value.renderer.mappingSha256 = "0".repeat(64); }],
      ["dictionarySha256", (value) => { value.renderer.dictionarySha256 = "0".repeat(64); }],
      ["registrySha256", (value) => { value.renderer.registrySha256 = "0".repeat(64); }],
      ["classId", (value) => { value.renderer.classId = 10; }],
      ["asset.id", (value) => { value.asset.id = "asset/rebound"; }],
      ["canonicalPath", (value) => { value.asset.canonicalPath = "rebound.glb"; }],
      ["aliases", (value) => { value.asset.aliases = ["rebound"]; }],
      ["sourceIds", (value) => { value.asset.sourceIds = ["rebound"]; }],
      ["sourcePackIds", (value) => { value.asset.sourcePackIds = ["rebound"]; }],
      ["textureIds", (value) => { value.asset.textureIds = ["rebound"]; }],
      ["sourceGeometrySha256", (value) => { value.asset.sourceGeometrySha256 = "0".repeat(64); }],
      ["split", (value) => { value.asset.split = "test"; }],
      ["splitGroupId", (value) => { value.asset.splitGroupId = "rebound"; }],
    ];
    for (const [field, mutate] of mutations) {
      const rebound = structuredClone(rawManifest); mutate(rebound);
      const reboundBytes = bytes(rebound);
      const aggregateUpdated = { ...rendered, provenanceSha256: hash(reboundBytes) };
      expect(aggregateUpdated.provenanceSha256).not.toBe(rendered.provenanceSha256);
      expect(() => validateMaterialAssetManifest(aggregateUpdated, reboundBytes, authority), field)
        .toThrow(/ASSET_CORPUS_MATERIAL_(AUTHORITY|LINEAGE|GEOMETRY)_REBOUND/);
    }
    const aggregateGeometryRebound = { ...rendered, sourceGeometrySha256: "0".repeat(64) };
    expect(() => validateMaterialAssetManifest(aggregateGeometryRebound, positiveBytes, authority))
      .toThrow("ASSET_CORPUS_MATERIAL_GEOMETRY_REBOUND");
  });

  it("rejects re-sealed material control frame ids and metadata authority cascades", () => {
    const camera = { kind: "orthographic", rotX: 61, rotY: 12 };
    const bindings = [{ id: "frame-000", cameraId: "orbit-a", lightingId: "key-a", poseId: "static", occlusionId: "none" }];
    const variant: any = { id: "static--none", renderGeometrySha256: "a".repeat(64), frames: [{ ...bindings[0], camera, controlSceneSha256: "b".repeat(64) }] };
    const controls: any = { frames: [{ id: "frame-000", files: { metadata: "frames/frame-000/metadata.json" } }] };
    const metadata: any = { camera, supersample: 1, scene: { contentSha256: "b".repeat(64), geometrySha256: "a".repeat(64) } };
    const independent = { cameras: [camera], scene: metadata.scene };
    expect(() => validateMaterialControlFrameAuthority("asset/material", variant, controls, bindings, 0, metadata, 1, independent)).not.toThrow();
    const cases: Array<[string, () => [any, any, any]]> = [
      ["frame id", () => [variant, { ...controls, frames: [{ ...controls.frames[0], id: "frame-999" }] }, metadata]],
      ["camera", () => [variant, controls, { ...metadata, camera: { ...camera, rotY: 99 } }]],
      ["scene", () => [variant, controls, { ...metadata, scene: { ...metadata.scene, contentSha256: "0".repeat(64) } }]],
      ["geometry", () => [variant, controls, { ...metadata, scene: { ...metadata.scene, geometrySha256: "0".repeat(64) } }]],
      ["camera cascade", () => [{ ...variant, frames: [{ ...variant.frames[0], camera: { ...camera, rotX: 999, rotY: 999 } }] }, controls, { ...metadata, camera: { ...camera, rotX: 999, rotY: 999 } }]],
      ["scene cascade", () => [{ ...variant, frames: [{ ...variant.frames[0], controlSceneSha256: "1".repeat(64) }] }, controls, { ...metadata, scene: { ...metadata.scene, contentSha256: "1".repeat(64) } }]],
      ["geometry cascade", () => [{ ...variant, renderGeometrySha256: "0".repeat(64) }, controls, { ...metadata, scene: { ...metadata.scene, geometrySha256: "0".repeat(64) } }]],
    ];
    for (const [field, build] of cases) {
      const [reboundVariant, reboundControls, reboundMetadata] = build();
      expect(() => validateMaterialControlFrameAuthority("asset/material", reboundVariant, reboundControls, bindings, 0, reboundMetadata, 1, independent), field)
        .toThrow(/ASSET_CORPUS_MATERIAL_(CONTROL_TRAJECTORY|FRAME_METADATA)_REBOUND/);
    }
  });
});
