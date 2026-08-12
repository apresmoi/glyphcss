export type AssetRegistryAppearanceDisposition = "exact-rgb" | "material-only" | "blocked";
export type AssetRegistryProvenanceDisposition = "verified" | "attribution-only" | "unverified" | "blocked";
export type AssetRegistrySplit = "train" | "validation" | "test";
export type AssetRegistryAdmissionScope = "general" | "local-research-only";

export interface AssetRegistryAsset {
  id: string;
  canonicalPath: string;
  aliases: string[];
  geometry: {
    format: "obj" | "gltf" | "glb";
    sha256: string;
    byteLength: number;
  };
  sourcePackIds: string[];
  sourceIds: string[];
  label: string;
  classHints: string[];
  uv: {
    status: "none" | "partial" | "all";
    coordinateCount: number;
    texturedPrimitiveCount: number;
    primitiveCount: number;
  };
  materials: Array<{
    name: string;
    baseColor: number[] | null;
    textures: Array<{
      role: "baseColor" | "metallicRoughness" | "normal" | "occlusion" | "emissive";
      textureId: string | null;
    }>;
  }>;
  textureIds: string[];
  appearanceDisposition: AssetRegistryAppearanceDisposition;
  bindingIssues: string[];
  provenanceDisposition: AssetRegistryProvenanceDisposition;
  provenanceEvidence: Array<{
    sourcePackId: string;
    sourceId: string;
    creator: string;
    license: string;
    sourceUrl: string;
    assetEvidenceToken: string | null;
    disposition: AssetRegistryProvenanceDisposition;
    admissionScope: AssetRegistryAdmissionScope | null;
    evidenceIds: string[];
  }>;
  admitted: boolean;
  admissionScope: AssetRegistryAdmissionScope | null;
  admissionReasons: string[];
  splitGroupId: string;
  split: AssetRegistrySplit | null;
}

export interface AssetRegistrySplitGroup {
  id: string;
  assetIds: string[];
  sourcePackIds: string[];
  textureIds: string[];
  admittedAssetIds: string[];
  split: AssetRegistrySplit | null;
}

export interface AssetRegistryReport {
  schemaVersion: "glyph-asset-registry/v1";
  generatorVersion: "glyph-asset-registry-builder/v1";
  registryId: string;
  config: { path: string; sha256: string };
  evidenceSources: Array<{
    id: string;
    kind: "repository-file" | "remote-content" | "policy-snapshot";
    path: string;
    sha256: string;
    retrievedAt?: string;
    assertion?: string;
  }>;
  stats: {
    scannedMeshFiles: number;
    appearanceSourceFiles: number;
    primaryAppearanceSourceFiles: number;
    usableTextureUvSourceFiles: number;
    canonicalAssets: number;
    aliasPaths: number;
    exactRgbCanonicalAssets: number;
    materialOnlyCanonicalAssets: number;
    blockedCanonicalAssets: number;
    admittedCanonicalAssets: number;
    admittedExactRgbCanonicalAssets: number;
    admittedMaterialOnlyCanonicalAssets: number;
    localResearchOnlyCanonicalAssets: number;
    splitGroups: number;
  };
  textures: Array<{
    id: string;
    sha256: string;
    mimeType: string;
    byteLength: number;
    locations: string[];
  }>;
  sourceFiles: Array<{
    path: string;
    canonicalAssetId: string;
    textureIds: string[];
    appearanceDisposition: "exact-rgb" | "material-only" | "blocked";
    census: "usable-texture-uv-v1";
  }>;
  assets: AssetRegistryAsset[];
  splitGroups: AssetRegistrySplitGroup[];
  contentSha256: string;
}

export function buildAssetRegistry(configPath?: string): Promise<AssetRegistryReport>;
export function validateAssetRegistry(
  report: AssetRegistryReport,
  schema?: unknown,
): Promise<AssetRegistryReport>;
