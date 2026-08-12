#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import ts from "typescript";

const repositoryRoot = resolve(import.meta.dirname, "../../..");
const researchRoot = resolve(import.meta.dirname, "..");
const defaultConfigPath = join(researchRoot, "config/asset-registry.json");
const defaultReportPath = join(researchRoot, "reports/asset-registry.json");
const historicalSourceCensusPath = join(researchRoot, "reports/asset-registry.b43-source-census.json");
const schemaPath = join(researchRoot, "asset-registry.schema.json");
const generatorVersion = "glyph-asset-registry-builder/v1";
const meshPattern = /\.(obj|gltf|glb)$/i;
const imageMime = Object.freeze({ ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" });

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const canonical = (value) => Array.isArray(value)
  ? `[${value.map(canonical).join(",")}]`
  : value && typeof value === "object"
    ? `{${Object.keys(value).filter((key) => key !== "contentSha256").sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`
    : JSON.stringify(value);
const unique = (values) => [...new Set(values)].sort();
const repoPath = (path) => relative(repositoryRoot, path).split(sep).join("/");
const slug = (value) => value.toLowerCase().replace(/\.[^.]+$/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "asset";
const json = (value) => `${JSON.stringify(value)}\n`;

function fail(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  throw error;
}

async function walk(directory, excludeSegments, output = []) {
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    if (excludeSegments.includes(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await walk(path, excludeSegments, output);
    else if (meshPattern.test(entry.name)) output.push(path);
  }
  return output;
}

function dataUriBytes(uri) {
  const match = /^data:([^;,]+)?(?:;base64)?,(.*)$/s.exec(uri);
  if (!match) return null;
  return { mimeType: match[1] || "application/octet-stream", bytes: Buffer.from(match[2], uri.includes(";base64,") ? "base64" : "utf8") };
}

function glbDocument(bytes) {
  if (bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(4) !== 2) fail("ASSET_GLB_INVALID", "invalid GLB header");
  let offset = 12, document = null, binary = null;
  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32LE(offset), type = bytes.readUInt32LE(offset + 4);
    const chunk = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === 0x4e4f534a) document = JSON.parse(chunk.toString("utf8").replace(/\0+$/g, ""));
    if (type === 0x004e4942) binary = chunk;
    offset += 8 + length;
  }
  if (!document) fail("ASSET_GLB_INVALID", "GLB JSON chunk is missing");
  return { document, binary };
}

async function gltfBuffer(document, index, meshPath, binary) {
  const buffer = document.buffers?.[index];
  if (!buffer) return null;
  if (!buffer.uri && index === 0 && binary) return binary;
  if (typeof buffer.uri !== "string") return null;
  const data = dataUriBytes(buffer.uri);
  if (data) return data.bytes;
  try { return await readFile(resolve(dirname(meshPath), decodeURIComponent(buffer.uri))); } catch { return null; }
}

async function gltfImage(document, imageIndex, meshPath, binary) {
  const image = document.images?.[imageIndex];
  if (!image) return { issue: `image ${imageIndex} is missing` };
  if (typeof image.uri === "string") {
    const data = dataUriBytes(image.uri);
    if (data) return { bytes: data.bytes, mimeType: image.mimeType || data.mimeType, location: `${repoPath(meshPath)}#image-${imageIndex}` };
    const path = resolve(dirname(meshPath), decodeURIComponent(image.uri));
    try {
      return { bytes: await readFile(path), mimeType: image.mimeType || imageMime[extname(path).toLowerCase()] || "application/octet-stream", location: repoPath(path) };
    } catch {
      return { issue: `image ${imageIndex} URI ${image.uri} does not resolve` };
    }
  }
  if (Number.isInteger(image.bufferView)) {
    const view = document.bufferViews?.[image.bufferView];
    if (!view) return { issue: `image ${imageIndex} bufferView ${image.bufferView} is missing` };
    const buffer = await gltfBuffer(document, view.buffer ?? 0, meshPath, binary);
    if (!buffer) return { issue: `image ${imageIndex} buffer ${view.buffer ?? 0} does not resolve` };
    const start = view.byteOffset ?? 0, end = start + view.byteLength;
    return { bytes: buffer.subarray(start, end), mimeType: image.mimeType || "application/octet-stream", location: `${repoPath(meshPath)}#image-${imageIndex}` };
  }
  return { issue: `image ${imageIndex} has no URI or bufferView` };
}

function textureSlots(material) {
  return [
    ["baseColor", material.pbrMetallicRoughness?.baseColorTexture],
    ["metallicRoughness", material.pbrMetallicRoughness?.metallicRoughnessTexture],
    ["normal", material.normalTexture],
    ["occlusion", material.occlusionTexture],
    ["emissive", material.emissiveTexture],
  ].filter(([, value]) => Number.isInteger(value?.index));
}

async function inspectGltf(path, bytes, textureStore) {
  const parsed = extname(path).toLowerCase() === ".glb" ? glbDocument(bytes) : { document: JSON.parse(bytes), binary: null };
  const document = parsed.document;
  const primitives = (document.meshes ?? []).flatMap((mesh) => mesh.primitives ?? []);
  const images = new Map();
  const resolveTexture = async (textureIndex) => {
    const texture = document.textures?.[textureIndex];
    const source = texture?.extensions?.KHR_texture_basisu?.source ?? texture?.source;
    if (!Number.isInteger(source)) return { textureId: null, issue: `texture ${textureIndex} has no image source` };
    if (!images.has(source)) images.set(source, await gltfImage(document, source, path, parsed.binary));
    const image = images.get(source);
    if (!image.bytes) return { textureId: null, issue: image.issue };
    const hash = sha256(image.bytes), id = `texture/${hash}`;
    const existing = textureStore.get(hash) ?? { id, sha256: hash, mimeType: image.mimeType, byteLength: image.bytes.length, locations: [] };
    existing.locations = unique([...existing.locations, image.location]);
    textureStore.set(hash, existing);
    return { textureId: id, issue: null };
  };
  const issues = [], materials = [];
  let texturedPrimitiveCount = 0;
  for (let index = 0; index < (document.materials ?? []).length; index++) {
    const material = document.materials[index], textures = [];
    for (const [role, slot] of textureSlots(material)) {
      const resolved = await resolveTexture(slot.index);
      textures.push({ role, textureId: resolved.textureId });
      if (resolved.issue) issues.push(`material ${material.name || index} ${role}: ${resolved.issue}`);
    }
    materials.push({ name: material.name ?? `material-${index}`, baseColor: material.pbrMetallicRoughness?.baseColorFactor ?? null, textures });
  }
  for (const primitive of primitives) {
    const material = document.materials?.[primitive.material];
    if (material?.pbrMetallicRoughness?.baseColorTexture) {
      texturedPrimitiveCount++;
      if (!Number.isInteger(primitive.attributes?.TEXCOORD_0)) issues.push(`textured primitive ${texturedPrimitiveCount - 1} lacks TEXCOORD_0`);
    }
  }
  const coordinateCount = primitives.reduce((sum, primitive) => sum + (Number.isInteger(primitive.attributes?.TEXCOORD_0) ? 1 : 0), 0);
  const baseTextures = materials.flatMap((material) => material.textures.filter((texture) => texture.role === "baseColor"));
  const exact = baseTextures.length > 0 && baseTextures.every((texture) => texture.textureId) && texturedPrimitiveCount > 0 && coordinateCount === primitives.length && issues.every((issue) => !issue.includes("TEXCOORD_0"));
  const uvStatus = coordinateCount === 0 ? "none" : coordinateCount === primitives.length ? "all" : "partial";
  return {
    appearanceBearing: materials.length > 0,
    materials,
    textureIds: unique(materials.flatMap((material) => material.textures.map((texture) => texture.textureId).filter(Boolean))),
    uv: { status: uvStatus, coordinateCount, texturedPrimitiveCount, primitiveCount: primitives.length },
    appearanceDisposition: issues.length ? "blocked" : exact ? "exact-rgb" : "material-only",
    bindingIssues: unique(issues),
  };
}

function mtlMapPath(value) {
  const quoted = /"([^"]+)"\s*$/.exec(value);
  if (quoted) return quoted[1];
  return value.trim().split(/\s+/).at(-1);
}

async function inspectMtl(path, textureStore) {
  const source = await readFile(path, "utf8");
  const materials = new Map();
  let current = null;
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim();
    const named = /^newmtl\s+(.+)$/i.exec(line);
    if (named) {
      current = named[1].trim();
      if (!materials.has(current)) materials.set(current, { name: current, baseColor: null, textures: [] });
      continue;
    }
    if (!current) continue;
    const color = /^Kd\s+(\S+)\s+(\S+)\s+(\S+)/i.exec(line);
    if (color) materials.get(current).baseColor = color.slice(1).map(Number);
    const diffuse = /^map_Kd\s+(.+)$/i.exec(line);
    if (diffuse) {
      const imagePath = resolve(dirname(path), mtlMapPath(diffuse[1]));
      try {
        const bytes = await readFile(imagePath), hash = sha256(bytes), id = `texture/${hash}`;
        const existing = textureStore.get(hash) ?? { id, sha256: hash, mimeType: imageMime[extname(imagePath).toLowerCase()] || "application/octet-stream", byteLength: bytes.length, locations: [] };
        existing.locations = unique([...existing.locations, repoPath(imagePath)]);
        textureStore.set(hash, existing);
        materials.get(current).textures.push({ role: "baseColor", textureId: id });
      } catch {
        materials.get(current).textures.push({ role: "baseColor", textureId: null, missingPath: repoPath(imagePath) });
      }
    }
  }
  return [...materials.values()];
}

async function inspectObj(path, bytes, config, textureStore) {
  const source = bytes.toString("utf8");
  const coordinateCount = (source.match(/^vt\s+/gm) ?? []).length;
  const groups = unique([...source.matchAll(/^usemtl\s+(.+)$/gm)].map((match) => match[1].trim()));
  const facesByMaterial = new Map();
  let activeMaterial = null;
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim();
    const use = /^usemtl\s+(.+)$/i.exec(line);
    if (use) { activeMaterial = use[1].trim(); continue; }
    if (!activeMaterial || !/^f\s+/i.test(line)) continue;
    const record = facesByMaterial.get(activeMaterial) ?? { faces: 0, allHaveUv: true };
    record.faces++;
    if (!line.slice(2).trim().split(/\s+/).every((vertex) => /^-?\d+\/-?\d+(?:\/[-+]?\d*)?$/.test(vertex))) record.allHaveUv = false;
    facesByMaterial.set(activeMaterial, record);
  }
  const declared = [...source.matchAll(/^mtllib\s+(.+)$/gm)].map((match) => match[1].trim());
  const override = config.objMaterialOverrides[repoPath(path)];
  const mtlPaths = [];
  const issues = [];
  for (const value of declared) {
    const candidate = resolve(dirname(path), value);
    try { await stat(candidate); mtlPaths.push(candidate); } catch { issues.push(`declared MTL ${value} does not resolve`); }
  }
  if (override) {
    const candidate = resolve(repositoryRoot, override);
    try {
      await stat(candidate);
      mtlPaths.length = 0;
      mtlPaths.push(candidate);
      for (let index = issues.length - 1; index >= 0; index--) if (issues[index].startsWith("declared MTL ")) issues.splice(index, 1);
    } catch { issues.push(`configured MTL override ${override} does not resolve`); }
  }
  const materials = [];
  for (const mtlPath of unique(mtlPaths)) materials.push(...await inspectMtl(resolve(repositoryRoot, mtlPath), textureStore));
  for (const material of materials) for (const texture of material.textures) if (!texture.textureId) issues.push(`material ${material.name} baseColor texture ${texture.missingPath} does not resolve`);
  if (declared.length > 0 && mtlPaths.length === 0 && !override) issues.push("authored material library is unavailable");
  const baseTextures = materials.flatMap((material) => material.textures.filter((texture) => texture.role === "baseColor"));
  const usedMaterials = groups.map((name) => materials.find((material) => material.name === name)).filter(Boolean);
  const texturedUsedMaterials = usedMaterials.filter((material) => material.textures.some((texture) => texture.role === "baseColor" && texture.textureId));
  const texturedFacesHaveUv = texturedUsedMaterials.every((material) => {
    const faces = facesByMaterial.get(material.name);
    return !!faces && faces.faces > 0 && faces.allHaveUv;
  });
  const exact = texturedUsedMaterials.length > 0 && texturedFacesHaveUv;
  if (!texturedFacesHaveUv) issues.push("a textured OBJ material has a face without texture coordinates");
  const materialRecords = materials.length > 0
    ? materials.map((material) => ({ name: material.name, baseColor: material.baseColor, textures: material.textures.map(({ role, textureId }) => ({ role, textureId })) }))
    : groups.map((name) => ({ name, baseColor: null, textures: [] }));
  return {
    appearanceBearing: groups.length > 0 || materials.length > 0,
    materials: materialRecords,
    textureIds: unique(materialRecords.flatMap((material) => material.textures.map((texture) => texture.textureId).filter(Boolean))),
    uv: { status: coordinateCount > 0 ? "all" : "none", coordinateCount, texturedPrimitiveCount: exact ? 1 : 0, primitiveCount: groups.length },
    appearanceDisposition: issues.length ? "blocked" : exact ? "exact-rgb" : "material-only",
    bindingIssues: unique(issues),
  };
}

function ruleMatches(rule, path) {
  if (!path.startsWith(rule.pathPrefix)) return false;
  if (!rule.directChildrenOnly) return true;
  return !path.slice(rule.pathPrefix.length).includes("/");
}

function evidenceToken(rule, path) {
  if (rule.assetEvidenceToken === "stem") return basename(path, extname(path));
  if (rule.assetEvidenceToken === "basename") return basename(path);
  return null;
}

function attributionRecord(records, path, attribution, evidenceToken, evidenceSources) {
  if (!attribution || typeof attribution.creator !== "string" || typeof attribution.license !== "string" || typeof attribution.sourceUrl !== "string") return;
  const record = {
    creator: attribution.creator,
    license: attribution.license,
    sourceUrl: attribution.sourceUrl,
    evidenceToken,
    evidenceSources,
  };
  const existing = records.get(path);
  if (existing && canonical(existing) !== canonical(record)) fail("ASSET_ATTRIBUTION_CONFLICT", path);
  records.set(path, record);
}

async function loadGalleryAttributions(config, sourceBytes) {
  const attributionsPath = config.attributionSources.find((path) => path.endsWith("/attributions.ts"));
  const presetFilesPath = config.attributionSources.find((path) => path.endsWith("/presetFiles.ts"));
  if (!attributionsPath || !presetFilesPath) fail("ASSET_ATTRIBUTION_SOURCE_MISSING", "attributions.ts and presetFiles.ts are required");
  const transpile = (bytes) => ts.transpileModule(bytes.toString("utf8"), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const attributionsUrl = `data:text/javascript;base64,${Buffer.from(transpile(sourceBytes.get(attributionsPath))).toString("base64")}`;
  const attributions = await import(attributionsUrl);
  const presetImport = /from\s+["']\.\/attributions["'];/;
  const presetSource = transpile(sourceBytes.get(presetFilesPath));
  if (!presetImport.test(presetSource)) fail("ASSET_ATTRIBUTION_IMPORT_MISSING", presetFilesPath);
  const presets = await import(`data:text/javascript;base64,${Buffer.from(presetSource.replace(presetImport, `from ${JSON.stringify(attributionsUrl)};`)).toString("base64")}`);
  const records = new Map();
  const evidenceSources = [attributionsPath, presetFilesPath];
  for (const [file, attribution] of Object.entries(attributions.GLB_PRESET_ATTRIBUTIONS ?? {})) {
    attributionRecord(records, `website/public/gallery/glb/${file}`, attribution, file, evidenceSources);
  }
  for (const entry of [...(presets.GLB_PRESET_FILES ?? []), ...(presets.POLY_PIZZA_PRESET_FILES ?? [])]) {
    const attribution = entry.attribution ?? attributions.GLB_PRESET_ATTRIBUTIONS?.[entry.file];
    attributionRecord(records, `website/public/gallery/glb/${entry.file}`, attribution, entry.file, evidenceSources);
  }
  for (const entry of presets.OBJ_PRESET_FILES ?? []) {
    const token = evidenceSources.some((sourcePath) => sourceBytes.get(sourcePath).toString("utf8").includes(entry.file))
      ? entry.file
      : basename(entry.file, extname(entry.file));
    attributionRecord(records, `website/public/gallery/obj/${entry.file}`, entry.attribution, token, evidenceSources);
  }
  const presetListPath = config.attributionSources.find((path) => path.endsWith("/presetList.ts"));
  for (const [path, attribution] of Object.entries(config.assetAttributionOverrides ?? {})) {
    attributionRecord(records, path, attribution, attribution.evidenceToken, [attributionsPath, presetListPath].filter(Boolean));
  }
  return records;
}

async function loadHistoricalSourceCensus() {
  const census = JSON.parse(await readFile(historicalSourceCensusPath, "utf8"));
  const raw = { ...census }; delete raw.contentSha256;
  if (census.schemaVersion !== "glyph-asset-registry-historical-source-census/v1"
    || census.contentSha256 !== sha256(canonical(raw))
    || census.sourceFiles.length !== 77
    || census.sourceLedgerSha256 !== sha256(JSON.stringify(census.sourceFiles))) fail("ASSET_HISTORICAL_CENSUS_INVALID", historicalSourceCensusPath);
  return census;
}

function evidenceRecord(path, bytes) {
  return { kind: "repository-file", path, sha256: sha256(bytes) };
}

function registerEvidence(store, evidence) {
  const id = `evidence/${sha256(canonical(evidence))}`;
  const existing = store.get(id);
  if (existing) {
    const { id: existingId, ...existingEvidence } = existing;
    if (existingId !== id || canonical(existingEvidence) !== canonical(evidence)) fail("ASSET_EVIDENCE_HASH_COLLISION", id);
  }
  store.set(id, { id, ...evidence });
  return id;
}

async function provenanceFor(path, config, sourceBytes, attributionRecords) {
  const rule = config.sourcePacks.find((candidate) => ruleMatches(candidate, path));
  if (!rule) return [];
  const attribution = attributionRecords.get(path);
  if (attribution) {
    const licenseEvidence = config.licenseEvidence?.[attribution.license];
    let disposition = licenseEvidence ? "verified" : "attribution-only";
    if (licenseEvidence?.creatorPrefix && !attribution.creator.startsWith(licenseEvidence.creatorPrefix)) disposition = "blocked";
    if (licenseEvidence?.sourceHost && new URL(attribution.sourceUrl).host !== licenseEvidence.sourceHost) disposition = "blocked";
    const evidence = attribution.evidenceSources.map((sourcePath) => {
      const bytes = sourceBytes.get(sourcePath);
      if (!bytes) fail("ASSET_EVIDENCE_MISSING", sourcePath);
      return evidenceRecord(sourcePath, bytes);
    });
    if (licenseEvidence) evidence.push(...licenseEvidence.evidence);
    if (!attribution.evidenceSources.some((sourcePath) => sourceBytes.get(sourcePath).toString("utf8").includes(attribution.evidenceToken))) disposition = "unverified";
    return [{
      sourcePackId: rule.id,
      sourceId: `source/${sha256(attribution.sourceUrl)}`,
      creator: attribution.creator,
      license: attribution.license,
      sourceUrl: attribution.sourceUrl,
      assetEvidenceToken: attribution.evidenceToken,
      disposition,
      admissionScope: disposition === "verified" ? licenseEvidence.admissionScope : null,
      evidence: evidence.sort((a, b) => a.path.localeCompare(b.path)),
    }];
  }
  const evidence = [];
  let disposition = rule.provenanceDisposition;
  for (const sourcePath of rule.evidenceSources ?? []) {
    const bytes = sourceBytes.get(sourcePath);
    if (!bytes) fail("ASSET_EVIDENCE_MISSING", sourcePath);
    evidence.push(evidenceRecord(sourcePath, bytes));
  }
  if (rule.licenseTextPath) {
    const bytes = await readFile(resolve(repositoryRoot, rule.licenseTextPath));
    evidence.push(evidenceRecord(rule.licenseTextPath, bytes));
  }
  const token = evidenceToken(rule, path);
  if (token && !(rule.evidenceSources ?? []).some((sourcePath) => sourceBytes.get(sourcePath).toString("utf8").includes(token))) disposition = "unverified";
  return [{
    sourcePackId: rule.id,
    sourceId: `source/${sha256(rule.sourceUrl)}`,
    creator: rule.creator,
    license: rule.license,
    sourceUrl: rule.sourceUrl,
    assetEvidenceToken: token,
    disposition,
    admissionScope: disposition === "verified" ? "general" : null,
    evidence: evidence.sort((a, b) => a.path.localeCompare(b.path)),
  }];
}

function worseDisposition(values) {
  const order = ["verified", "attribution-only", "unverified", "blocked"];
  return order[Math.max(0, ...values.map((value) => order.indexOf(value)))];
}

class UnionFind {
  constructor(values) { this.parent = new Map(values.map((value) => [value, value])); }
  find(value) {
    const parent = this.parent.get(value);
    if (parent === value) return value;
    const root = this.find(parent);
    this.parent.set(value, root);
    return root;
  }
  union(left, right) {
    const a = this.find(left), b = this.find(right);
    if (a !== b) this.parent.set(a < b ? b : a, a < b ? a : b);
  }
}

function splitFor(groupId, authority) {
  const bucket = Number.parseInt(sha256(`${authority.salt}\0${groupId}`).slice(0, 8), 16) % 100;
  return bucket < authority.trainBelow ? "train" : bucket < authority.validationBelow ? "validation" : "test";
}

export async function buildAssetRegistry(configPath = defaultConfigPath) {
  const configBytes = await readFile(configPath), config = JSON.parse(configBytes);
  if (config.schemaVersion !== "glyph-asset-registry-config/v1") fail("ASSET_CONFIG_INVALID", "unsupported schema version");
  const sourceBytes = new Map();
  for (const path of config.attributionSources) sourceBytes.set(path, await readFile(resolve(repositoryRoot, path)));
  const attributionRecords = await loadGalleryAttributions(config, sourceBytes);
  const historicalCensus = await loadHistoricalSourceCensus();
  const historicalUsablePaths = new Set(historicalCensus.sourceFiles.map((source) => source.path));
  const entries = [], textureStore = new Map();
  let scannedMeshFiles = 0;
  for (const root of config.inventoryRoots) {
    const absolute = resolve(repositoryRoot, root.path);
    for (const path of await walk(absolute, root.excludeSegments ?? [])) {
      scannedMeshFiles++;
      const bytes = await readFile(path), relativePath = repoPath(path), format = extname(path).slice(1).toLowerCase();
      const appearance = format === "obj"
        ? await inspectObj(path, bytes, config, textureStore)
        : await inspectGltf(path, bytes, textureStore);
      if (!appearance.appearanceBearing) continue;
      entries.push({
        path: relativePath,
        authority: root.authority,
        bytes,
        geometrySha256: sha256(bytes),
        format,
        ...appearance,
        provenanceEvidence: root.authority === "primary" ? await provenanceFor(relativePath, config, sourceBytes, attributionRecords) : [],
      });
    }
  }
  const byGeometry = new Map();
  for (const entry of entries) {
    const values = byGeometry.get(entry.geometrySha256) ?? [];
    values.push(entry);
    byGeometry.set(entry.geometrySha256, values);
  }
  const assets = [];
  const sourceFiles = [];
  for (const [geometrySha256, values] of [...byGeometry].sort(([a], [b]) => a.localeCompare(b))) {
    values.sort((left, right) => (left.authority === right.authority ? left.path.localeCompare(right.path) : left.authority === "primary" ? -1 : 1));
    const primary = values.filter((entry) => entry.authority === "primary");
    // A content-addressed geometry may have several repository paths.  For an
    // exact-RGB asset its canonical loader path must itself carry the verified
    // texture binding; a lexically earlier research alias without its MTL is
    // only an alias, never the render target authority.
    const canonicalEntry = primary.find((entry) => entry.appearanceDisposition === "exact-rgb") ?? values[0];
    const evidence = primary.flatMap((entry) => entry.provenanceEvidence);
    const provenanceDisposition = evidence.length ? worseDisposition(evidence.map((entry) => entry.disposition)) : "unverified";
    const verifiedScopes = evidence.filter((entry) => entry.disposition === "verified").map((entry) => entry.admissionScope);
    const admissionScope = provenanceDisposition === "verified"
      ? verifiedScopes.includes("local-research-only") ? "local-research-only" : "general"
      : null;
    const renderDisposition = primary.some((entry) => entry.appearanceDisposition === "exact-rgb")
      ? "exact-rgb"
      : primary.some((entry) => entry.appearanceDisposition === "material-only")
        ? "material-only"
        : canonicalEntry.appearanceDisposition;
    const bindingIssues = unique(primary.flatMap((entry) => entry.bindingIssues));
    const textureIds = unique(primary.flatMap((entry) => entry.textureIds));
    const admitted = renderDisposition !== "blocked" && provenanceDisposition === "verified";
    const admissionReasons = [];
    if (renderDisposition === "blocked") admissionReasons.push("appearance bindings are blocked");
    if (provenanceDisposition !== "verified") admissionReasons.push(`provenance is ${provenanceDisposition}`);
    const label = basename(canonicalEntry.path, extname(canonicalEntry.path)).replace(/[-_]+/g, " ").trim();
    const hintSegments = canonicalEntry.path.split("/").slice(-4, -1).map(slug);
    assets.push({
      id: `asset/${geometrySha256}`,
      canonicalPath: canonicalEntry.path,
      aliases: values.slice(1).map((entry) => entry.path).sort(),
      geometry: { format: canonicalEntry.format, sha256: geometrySha256, byteLength: canonicalEntry.bytes.length },
      sourcePackIds: unique(evidence.map((entry) => entry.sourcePackId)),
      sourceIds: unique(evidence.map((entry) => entry.sourceId)),
      label,
      classHints: unique([slug(label), ...hintSegments]),
      uv: canonicalEntry.uv,
      materials: canonicalEntry.materials,
      textureIds,
      appearanceDisposition: renderDisposition,
      bindingIssues,
      provenanceDisposition,
      provenanceEvidence: evidence.sort((a, b) => a.sourcePackId.localeCompare(b.sourcePackId)),
      admitted,
      admissionScope,
      admissionReasons,
      splitGroupId: "",
      split: null,
    });
    const assetId = `asset/${geometrySha256}`;
    for (const entry of primary.filter((candidate) => candidate.appearanceDisposition === "exact-rgb" || historicalUsablePaths.has(candidate.path))) {
      sourceFiles.push({
        path: entry.path,
        canonicalAssetId: assetId,
        textureIds: entry.textureIds,
        appearanceDisposition: entry.appearanceDisposition,
        census: "usable-texture-uv-v1",
      });
    }
  }
  const evidenceStore = new Map();
  for (const [path, bytes] of sourceBytes) registerEvidence(evidenceStore, evidenceRecord(path, bytes));
  for (const asset of assets) for (const provenance of asset.provenanceEvidence) {
    provenance.evidenceIds = provenance.evidence.map((evidence) => registerEvidence(evidenceStore, evidence));
    delete provenance.evidence;
  }
  const union = new UnionFind(assets.map((asset) => asset.id));
  for (const field of ["sourcePackIds", "textureIds"]) {
    const owner = new Map();
    for (const asset of assets) for (const key of asset[field]) {
      if (owner.has(key)) union.union(asset.id, owner.get(key));
      else owner.set(key, asset.id);
    }
  }
  const components = new Map();
  for (const asset of assets) {
    const root = union.find(asset.id), values = components.get(root) ?? [];
    values.push(asset);
    components.set(root, values);
  }
  const splitGroups = [...components.values()].map((values) => {
    values.sort((a, b) => a.id.localeCompare(b.id));
    const id = `split-group/${sha256(values.map((asset) => asset.id).join("\n"))}`;
    const admittedAssetIds = values.filter((asset) => asset.admitted).map((asset) => asset.id);
    const split = admittedAssetIds.length ? splitFor(id, config.splitAuthority) : null;
    for (const asset of values) {
      asset.splitGroupId = id;
      asset.split = asset.admitted ? split : null;
    }
    return {
      id,
      assetIds: values.map((asset) => asset.id),
      sourcePackIds: unique(values.flatMap((asset) => asset.sourcePackIds)),
      textureIds: unique(values.flatMap((asset) => asset.textureIds)),
      admittedAssetIds,
      split,
    };
  }).sort((a, b) => a.id.localeCompare(b.id));
  assets.sort((a, b) => a.canonicalPath.localeCompare(b.canonicalPath));
  const primary = entries.filter((entry) => entry.authority === "primary");
  const usableTextureUvSourceFiles = primary.filter((entry) => entry.appearanceDisposition === "exact-rgb" || historicalUsablePaths.has(entry.path)).length;
  for (const path of historicalUsablePaths) if (!primary.some((entry) => entry.path === path)) fail("ASSET_HISTORICAL_CENSUS_PATH_INVALID", path);
  const currentHistoricalLedger = sourceFiles.map(({ path, canonicalAssetId, textureIds }) => ({ path, canonicalAssetId, textureIds })).sort((left, right) => left.path.localeCompare(right.path));
  if (canonical(currentHistoricalLedger) !== canonical(historicalCensus.sourceFiles)) fail("ASSET_HISTORICAL_CENSUS_IDENTITY_DRIFT", "path, canonical asset, or texture identity changed");
  if (usableTextureUvSourceFiles !== config.expected.usableTextureUvSourceFiles) {
    fail("ASSET_EXPECTATION_DRIFT", `expected ${config.expected.usableTextureUvSourceFiles} usable texture+UV source files, found ${usableTextureUvSourceFiles}`);
  }
  const admittedExactRgbBySplit = Object.fromEntries(["train", "validation", "test"].map((split) => [
    split,
    assets.filter((asset) => asset.admitted && asset.appearanceDisposition === "exact-rgb" && asset.split === split).length,
  ]));
  if (canonical(admittedExactRgbBySplit) !== canonical(config.expected.admittedExactRgbBySplit)) {
    fail("ASSET_SPLIT_EXPECTATION_DRIFT", `expected ${canonical(config.expected.admittedExactRgbBySplit)} admitted exact-RGB assets by split, found ${canonical(admittedExactRgbBySplit)}`);
  }
  const raw = {
    schemaVersion: "glyph-asset-registry/v1",
    generatorVersion,
    registryId: config.id,
    config: { path: repoPath(configPath), sha256: sha256(configBytes) },
    evidenceSources: [...evidenceStore.values()].sort((a, b) => a.id.localeCompare(b.id)),
    stats: {
      scannedMeshFiles,
      appearanceSourceFiles: entries.length,
      primaryAppearanceSourceFiles: primary.length,
      usableTextureUvSourceFiles,
      canonicalAssets: assets.length,
      aliasPaths: entries.length - assets.length,
      exactRgbCanonicalAssets: assets.filter((asset) => asset.appearanceDisposition === "exact-rgb").length,
      materialOnlyCanonicalAssets: assets.filter((asset) => asset.appearanceDisposition === "material-only").length,
      blockedCanonicalAssets: assets.filter((asset) => asset.appearanceDisposition === "blocked").length,
      admittedCanonicalAssets: assets.filter((asset) => asset.admitted).length,
      admittedExactRgbCanonicalAssets: assets.filter((asset) => asset.admitted && asset.appearanceDisposition === "exact-rgb").length,
      admittedMaterialOnlyCanonicalAssets: assets.filter((asset) => asset.admitted && asset.appearanceDisposition === "material-only").length,
      localResearchOnlyCanonicalAssets: assets.filter((asset) => asset.admissionScope === "local-research-only").length,
      splitGroups: splitGroups.length,
    },
    textures: [...textureStore.values()].sort((a, b) => a.id.localeCompare(b.id)),
    assets,
    sourceFiles: sourceFiles.sort((a, b) => a.path.localeCompare(b.path)),
    splitGroups,
  };
  return { ...raw, contentSha256: sha256(canonical(raw)) };
}

export async function validateAssetRegistry(report, schema = null) {
  const resolvedSchema = schema ?? JSON.parse(await readFile(schemaPath, "utf8"));
  const validate = new Ajv2020({ allErrors: true, strict: true }).compile(resolvedSchema);
  if (!validate(report)) fail("ASSET_REGISTRY_SCHEMA_INVALID", validate.errors?.map((error) => `${error.instancePath} ${error.message}`).join("; ") || "unknown schema failure");
  const assetIds = new Set(report.assets.map((asset) => asset.id));
  if (assetIds.size !== report.assets.length) fail("ASSET_REGISTRY_DUPLICATE_ID", "canonical asset IDs repeat");
  const evidenceSources = new Map(report.evidenceSources.map((evidence) => [evidence.id, evidence]));
  for (const evidence of report.evidenceSources) {
    if (evidence.kind === "policy-snapshot" && (!evidence.assertion || evidence.sha256 !== sha256(evidence.assertion))) fail("ASSET_REGISTRY_POLICY_SNAPSHOT_MISMATCH", evidence.path);
    if (evidence.kind !== "repository-file" && !evidence.retrievedAt) fail("ASSET_REGISTRY_REMOTE_EVIDENCE_DATE_MISSING", evidence.path);
  }
  const paths = new Set();
  for (const asset of report.assets) {
    for (const path of [asset.canonicalPath, ...asset.aliases]) {
      if (paths.has(path)) fail("ASSET_REGISTRY_DUPLICATE_PATH", path);
      paths.add(path);
    }
    if (asset.admitted && asset.provenanceDisposition !== "verified") fail("ASSET_REGISTRY_UNVERIFIED_ADMISSION", asset.id);
    if (asset.admitted && asset.appearanceDisposition === "blocked") fail("ASSET_REGISTRY_BLOCKED_ADMISSION", asset.id);
    if (asset.admitted !== (asset.admissionScope !== null)) fail("ASSET_REGISTRY_SCOPE_MISMATCH", asset.id);
    if (canonical(asset.sourcePackIds) !== canonical(unique(asset.provenanceEvidence.map((provenance) => provenance.sourcePackId)))) fail("ASSET_REGISTRY_SOURCE_PACK_MISMATCH", asset.id);
    if (canonical(asset.sourceIds) !== canonical(unique(asset.provenanceEvidence.map((provenance) => provenance.sourceId)))) fail("ASSET_REGISTRY_SOURCE_MISMATCH", asset.id);
    for (const provenance of asset.provenanceEvidence) {
      if ((provenance.disposition === "verified") !== (provenance.admissionScope !== null)) fail("ASSET_REGISTRY_PROVENANCE_SCOPE_MISMATCH", asset.id);
      for (const evidenceId of provenance.evidenceIds) if (!evidenceSources.has(evidenceId)) fail("ASSET_REGISTRY_EVIDENCE_REFERENCE_MISSING", evidenceId);
    }
  }
  if (report.sourceFiles.length !== report.stats.usableTextureUvSourceFiles) fail("ASSET_REGISTRY_SOURCE_CENSUS_MISMATCH", "usable source-file census differs from stats");
  const sourcePaths = new Set();
  for (const source of report.sourceFiles) {
    if (source.census !== "usable-texture-uv-v1") fail("ASSET_REGISTRY_SOURCE_CENSUS_INVALID", source.path);
    if (!paths.has(source.path) || !assetIds.has(source.canonicalAssetId) || sourcePaths.has(source.path)) fail("ASSET_REGISTRY_SOURCE_CENSUS_INVALID", source.path);
    sourcePaths.add(source.path);
  }
  const groups = new Map(report.splitGroups.map((group) => [group.id, group]));
  for (const asset of report.assets) {
    const group = groups.get(asset.splitGroupId);
    if (!group || !group.assetIds.includes(asset.id)) fail("ASSET_REGISTRY_SPLIT_GROUP_MISMATCH", asset.id);
    if (asset.admitted && asset.split !== group.split) fail("ASSET_REGISTRY_SPLIT_MISMATCH", asset.id);
  }
  for (const key of ["sourcePackIds", "textureIds"]) {
    const owners = new Map();
    for (const asset of report.assets) for (const value of asset[key]) {
      const owner = owners.get(value);
      if (owner && owner !== asset.splitGroupId) fail("ASSET_REGISTRY_SPLIT_LEAKAGE", `${value} crosses ${owner} and ${asset.splitGroupId}`);
      owners.set(value, asset.splitGroupId);
    }
  }
  if (report.contentSha256 !== sha256(canonical(report))) fail("ASSET_REGISTRY_HASH_MISMATCH", "canonical content hash differs");
  return report;
}

async function main() {
  const checkIndex = process.argv.indexOf("--check"), writeIndex = process.argv.indexOf("--write");
  const configIndex = process.argv.indexOf("--config");
  const configPath = configIndex >= 0 ? resolve(process.argv[configIndex + 1]) : defaultConfigPath;
  const built = await buildAssetRegistry(configPath);
  await validateAssetRegistry(built);
  if (checkIndex >= 0) {
    const target = resolve(process.argv[checkIndex + 1] ?? defaultReportPath);
    const existing = JSON.parse(await readFile(target, "utf8"));
    await validateAssetRegistry(existing);
    if (json(existing) !== json(built)) fail("ASSET_REGISTRY_REPORT_DRIFT", repoPath(target));
    console.log(`Asset registry is current: ${built.stats.canonicalAssets} canonical assets, ${built.stats.usableTextureUvSourceFiles} usable texture+UV source files, ${built.stats.admittedCanonicalAssets} admitted.`);
    return;
  }
  if (writeIndex >= 0) {
    const target = resolve(process.argv[writeIndex + 1] ?? defaultReportPath);
    await writeFile(target, json(built));
    console.log(`Wrote ${repoPath(target)}.`);
    return;
  }
  process.stdout.write(json(built));
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
