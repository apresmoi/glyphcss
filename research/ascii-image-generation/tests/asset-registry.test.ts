import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildAssetRegistry,
  validateAssetRegistry,
} from "../scripts/build-asset-registry.mjs";
import { verifyAssetRenderBindings } from "../scripts/verify-asset-render-bindings.mjs";

const root = resolve(import.meta.dirname, "..");
const canonical = (value: unknown): string => Array.isArray(value)
  ? `[${value.map(canonical).join(",")}]`
  : value && typeof value === "object"
    ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`
    : JSON.stringify(value);

describe("B43 appearance asset registry", () => {
  it("accounts for every appearance-bearing mesh and all usable texture+UV sources", async () => {
    const report = await buildAssetRegistry();
    await validateAssetRegistry(report);

    expect(report.stats.primaryAppearanceSourceFiles).toBe(347);
    expect(report.stats.usableTextureUvSourceFiles).toBe(77);
    expect(report.stats.admittedCanonicalAssets).toBe(179);
    expect(report.stats.admittedExactRgbCanonicalAssets).toBe(45);
    expect(report.stats.admittedMaterialOnlyCanonicalAssets).toBe(134);
    expect(report.stats.localResearchOnlyCanonicalAssets).toBe(13);
    const exactBySplit = Object.fromEntries(["train", "validation", "test"].map((split) => [
      split,
      report.assets.filter((asset) => asset.admitted && asset.appearanceDisposition === "exact-rgb" && asset.split === split).length,
    ]));
    expect(exactBySplit).toEqual({ train: 25, validation: 5, test: 15 });
    expect(report.sourceFiles).toHaveLength(77);
    expect(report.sourceFiles.find((source) => source.path.endsWith("/rock1.obj"))).toMatchObject({ appearanceDisposition: "exact-rgb", census: "usable-texture-uv-v1" });
    expect(report.assets.some((asset) => asset.aliases.length > 0)).toBe(true);
    expect(report.assets.every((asset) => asset.geometry.sha256 === asset.id.slice("asset/".length))).toBe(true);
  });

  it("admits pinned per-asset evidence while keeping ambiguous and broken records fail-closed", async () => {
    const report = await buildAssetRegistry();
    const hubble = report.assets.find((asset) => asset.canonicalPath.endsWith("/nasa/hubble-space-telescope.glb"));
    const apocalypse = report.assets.find((asset) => asset.canonicalPath.endsWith("/apocalypse/car.glb"));
    const nasa = report.assets.find((asset) => asset.canonicalPath.endsWith("/nasa/icesat-a.glb"));
    const nasaThirdParty = report.assets.find((asset) => asset.canonicalPath.endsWith("/nasa/crew-lock-bag.glb"));
    const smithsonian = report.assets.find((asset) => asset.canonicalPath.endsWith("/smithsonian/morse-telegraph-key.glb"));
    const openGameArt = report.assets.find((asset) => asset.canonicalPath.endsWith("/opengameart/grandfather-clock/grandfather-clock.obj"));
    const ambiguous = report.assets.find((asset) => asset.canonicalPath.endsWith("/model-viewer/astronaut.glb"));

    expect(hubble?.appearanceDisposition).toBe("blocked");
    expect(hubble?.bindingIssues).toEqual(expect.arrayContaining([expect.stringMatching(/no image source/)]));
    expect(apocalypse?.provenanceDisposition).toBe("blocked");
    expect(nasa).toMatchObject({ admitted: true, admissionScope: "local-research-only" });
    expect(nasaThirdParty).toMatchObject({ admitted: false, provenanceDisposition: "blocked" });
    expect(smithsonian).toMatchObject({ admitted: true, admissionScope: "general" });
    expect(openGameArt).toMatchObject({ admitted: true, appearanceDisposition: "exact-rgb", admissionScope: "general" });
    expect(ambiguous).toMatchObject({ admitted: false, provenanceDisposition: "attribution-only" });
    expect(report.assets.filter((asset) => asset.admitted).every((asset) => asset.provenanceDisposition === "verified")).toBe(true);
    expect(report.assets.filter((asset) => ["attribution-only", "unverified"].includes(asset.provenanceDisposition)).every((asset) => !asset.admitted)).toBe(true);
  });

  it("keeps aliases, source-pack siblings, geometry, and shared textures in one split group", async () => {
    const report = await buildAssetRegistry();
    const config = JSON.parse(await readFile(resolve(root, "config/asset-registry.json"), "utf8")) as {
      sourcePacks: Array<{ id: string; pathPrefix: string; directChildrenOnly?: boolean }>;
    };
    for (const field of ["sourcePackIds", "textureIds"] as const) {
      const owners = new Map<string, string>();
      for (const asset of report.assets) for (const value of asset[field]) {
        expect(owners.get(value) ?? asset.splitGroupId).toBe(asset.splitGroupId);
        owners.set(value, asset.splitGroupId);
      }
    }
    for (const asset of report.assets) {
      const group = report.splitGroups.find((candidate) => candidate.id === asset.splitGroupId);
      expect(group?.assetIds).toContain(asset.id);
      expect(asset.admitted ? asset.split : null).toBe(asset.admitted ? group?.split : null);
    }
    const namedAuthorities = new Set([
      "quaternius-ultimate-nature",
      "nasa-3d-resources",
      "quaternius-medieval-village",
    ]);
    for (const rule of config.sourcePacks) {
      const matches = report.assets.filter((asset) => [asset.canonicalPath, ...asset.aliases].some((path) => {
        if (!path.startsWith(rule.pathPrefix)) return false;
        return !rule.directChildrenOnly || !path.slice(rule.pathPrefix.length).includes("/");
      }));
      expect(matches.length, rule.id).toBeGreaterThan(0);
      expect(matches.every((asset) => asset.sourcePackIds.includes(rule.id)), rule.id).toBe(true);
      expect(new Set(matches.map((asset) => asset.splitGroupId)).size, rule.id).toBe(1);
      if (namedAuthorities.has(rule.id)) expect(matches.length, rule.id).toBeGreaterThan(1);
    }
  });

  it("rejects optimistic admission and disconnected shared-texture ownership", async () => {
    const report = await buildAssetRegistry();
    const attributionOnly = report.assets.find((asset) => asset.provenanceDisposition === "attribution-only" && asset.appearanceDisposition !== "blocked");
    expect(attributionOnly).toBeDefined();
    if (!attributionOnly) return;

    const optimistic = structuredClone(report);
    const optimisticAsset = optimistic.assets.find((asset) => asset.id === attributionOnly.id)!;
    optimisticAsset.admitted = true;
    optimisticAsset.split = "train";
    await expect(validateAssetRegistry(optimistic)).rejects.toThrow(/ASSET_REGISTRY_UNVERIFIED_ADMISSION/);

    const textured = report.assets.filter((asset) => asset.textureIds.length > 0);
    const pair = textured.flatMap((asset, index) => textured.slice(index + 1).map((candidate) => [asset, candidate] as const))
      .find(([left, right]) => left.textureIds.some((texture) => right.textureIds.includes(texture)));
    expect(pair).toBeDefined();
    if (!pair) return;
    const leaked = structuredClone(report);
    leaked.assets.find((asset) => asset.id === pair[1].id)!.splitGroupId = `${pair[1].splitGroupId}-detached`;
    await expect(validateAssetRegistry(leaked)).rejects.toThrow(/ASSET_REGISTRY_SPLIT_GROUP_MISMATCH/);

    const packLeak = structuredClone(report);
    const nasaAsset = packLeak.assets.find((asset) => asset.sourcePackIds.includes("nasa-3d-resources") && asset.admitted)!;
    const originalGroup = packLeak.splitGroups.find((group) => group.id === nasaAsset.splitGroupId)!;
    const targetGroup = packLeak.splitGroups.find((group) => group.id !== originalGroup.id && group.split !== null)!;
    originalGroup.assetIds = originalGroup.assetIds.filter((id) => id !== nasaAsset.id);
    originalGroup.admittedAssetIds = originalGroup.admittedAssetIds.filter((id) => id !== nasaAsset.id);
    targetGroup.assetIds.push(nasaAsset.id);
    targetGroup.admittedAssetIds.push(nasaAsset.id);
    nasaAsset.splitGroupId = targetGroup.id;
    nasaAsset.split = targetGroup.split;
    await expect(validateAssetRegistry(packLeak)).rejects.toThrow(/ASSET_REGISTRY_SPLIT_LEAKAGE/);

    const policy = structuredClone(report);
    const snapshot = policy.evidenceSources.find((evidence) => evidence.kind === "policy-snapshot");
    expect(snapshot).toBeDefined();
    if (!snapshot) return;
    snapshot.assertion = `${snapshot.assertion} altered`;
    await expect(validateAssetRegistry(policy)).rejects.toThrow(/ASSET_REGISTRY_POLICY_SNAPSHOT_MISMATCH/);
  });

  it("matches the checked-in content-addressed report", async () => {
    const built = await buildAssetRegistry();
    const checkedIn = JSON.parse(await readFile(resolve(root, "reports/asset-registry.json"), "utf8"));
    expect(checkedIn).toEqual(built);
  });

  it("keeps the B43 authority identifiable after B49 replaces the live registry", async () => {
    const superseded = JSON.parse(await readFile(resolve(root, "reports/asset-registry.b43-superseded.json"), "utf8"));
    const { contentSha256, ...unsigned } = superseded;
    expect(superseded.supersededReport).toMatchObject({
      path: "research/ascii-image-generation/reports/asset-registry.json",
      contentSha256: "2cb92babadc754a1bc706b8ede193218f0a4aa317ebb578c8e1b62c996a8be12",
      stats: { usableTextureUvSourceFiles: 77, admittedExactRgbCanonicalAssets: 45, admittedMaterialOnlyCanonicalAssets: 134 },
    });
    expect(contentSha256).toBe(createHash("sha256").update(JSON.stringify(unsigned)).digest("hex"));
    const census = JSON.parse(await readFile(resolve(root, "reports/asset-registry.b43-source-census.json"), "utf8"));
    const { contentSha256: censusSeal, ...censusUnsigned } = census;
    expect(censusSeal).toBe(createHash("sha256").update(canonical(censusUnsigned)).digest("hex"));
    expect(createHash("sha256").update(JSON.stringify(census.sourceFiles)).digest("hex")).toBe(census.sourceLedgerSha256);
    expect(census.sourceFiles).toHaveLength(77);
    const currentLedger = (await buildAssetRegistry()).sourceFiles.map(({ path, canonicalAssetId, textureIds }) => ({ path, canonicalAssetId, textureIds })).sort((left, right) => left.path.localeCompare(right.path));
    expect(currentLedger).toEqual(census.sourceFiles);
  });

  it("binds every B49 exact-RGB canonical through the production loader and keeps all 77 source dispositions sealed", async () => {
    const built = await verifyAssetRenderBindings();
    const checked = JSON.parse(await readFile(resolve(root, "reports/asset-render-bindings.json"), "utf8"));
    expect(checked).toEqual(built);
    expect(built).toMatchObject({ pass: true });
    expect(built.assets).toHaveLength(76);
    expect(built.assets.every((asset: { pass: boolean }) => asset.pass)).toBe(true);
    expect(built.sourceCoverage.every((source: { baseColorSources: unknown[] }) => source.baseColorSources.length > 0)).toBe(true);
    expect(built.sourceCoverage.filter((source: { corpusDisposition: string }) => source.corpusDisposition === "render-bound-base-color")).toHaveLength(45);
    expect(built.sourceCoverage.filter((source: { corpusDisposition: string }) => source.corpusDisposition === "alias-of-rendered")).toHaveLength(1);
    expect(built.sourceCoverage.filter((source: { corpusDisposition: string; admissionFailure: string[] | null }) => source.corpusDisposition === "admission-failure").every((source: { admissionFailure: string[] | null }) => (source.admissionFailure?.length ?? 0) > 0)).toBe(true);
  }, 180_000);
});
