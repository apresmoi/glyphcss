#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { buildNodeTextureSamplerBundle, loadMeshFromFile } from "@glyphcss/compile";
import { polygonTexture, sampleTexel } from "@glyphcss/core";

const root = resolve(import.meta.dirname, "..");
const sha = (value) => createHash("sha256").update(value).digest("hex");
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const canonical = (value) => Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : value && typeof value === "object" ? `{${Object.keys(value).filter((key) => key !== "contentSha256").sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}` : JSON.stringify(value);
const readJson = async (path) => JSON.parse(await readFile(resolve(root, path), "utf8"));

function rolesForTextureIds(textureRoleIds) {
  return new Map(Object.entries(textureRoleIds).flatMap(([role, textureIds]) => textureIds.map((textureId) => [textureId, role])).reduce((records, [textureId, role]) => {
    const roles = records.get(textureId) ?? new Set(); roles.add(role); records.set(textureId, roles); return records;
  }, new Map()));
}

function textureRoleIdsForAsset(asset) {
  return Object.fromEntries(["baseColor", "metallicRoughness", "normal", "occlusion", "emissive"].map((role) => [
    role,
    asset.materials.flatMap((material) => material.textures.filter((texture) => texture.role === role).map((texture) => texture.textureId).filter(Boolean)),
  ]));
}

function authoredUvForTexture(polygon, texture) {
  if (polygonTexture(polygon) === texture && polygon.uvs?.[0] && Number.isFinite(polygon.uvs[0][0]) && Number.isFinite(polygon.uvs[0][1])) return polygon.uvs[0];
  return polygon.textureTriangles?.find((triangle) => triangle.texture === texture)?.uvs[0] ?? null;
}

async function verifyPath(asset, path, textureRoleIds) {
  const loaded = await loadMeshFromFile(resolve(root, "../..", path), { preserveTextures: true, solidTextureSamples: false });
  try {
    const bundle = await buildNodeTextureSamplerBundle(loaded.polygons), sourceByHash = new Map(bundle.sources.map((source) => [source.byteSha256, source]));
    const roles = rolesForTextureIds(textureRoleIds), records = [...roles].sort(([a], [b]) => a.localeCompare(b)).map(([textureId, values]) => {
      const byteSha256 = textureId.slice("texture/".length), source = sourceByHash.get(byteSha256), roleList = [...values].sort();
      return values.has("baseColor")
        ? source ? { textureId, roles: roleList, disposition: "render-bound-base-color", byteSha256: source.byteSha256, decodedPixelSha256: source.decodedPixelSha256, width: source.width, height: source.height }
          : { textureId, roles: roleList, disposition: "admission-failure", reason: "production loader did not bind a decoded base-color sampler" }
        : { textureId, roles: roleList, disposition: "unused-or-non-rgb" };
    });
    const unexpected = bundle.sources.filter((source) => !roles.has(`texture/${source.byteSha256}`));
    if (unexpected.length) records.push(...unexpected.map((source) => ({ textureId: `texture/${source.byteSha256}`, roles: [], disposition: "admission-failure", reason: "production loader bound an unregistered texture" })));
    const sourceByHandle = new Map(bundle.sources.map((source) => [source.handle, source]));
    for (const record of records) if (record.disposition === "render-bound-base-color") {
      const polygon = loaded.polygons.find((candidate) => {
        const source = sourceByHandle.get(polygonTexture(candidate) ?? "");
        const uv = authoredUvForTexture(candidate, polygonTexture(candidate) ?? "");
        return source?.byteSha256 === record.byteSha256 && !!uv && Number.isFinite(uv[0]) && Number.isFinite(uv[1]);
      });
      const uv = polygon ? authoredUvForTexture(polygon, polygonTexture(polygon) ?? "") : null;
      const sampler = polygon ? bundle.samplers.get(polygonTexture(polygon) ?? "") : null;
      if (!uv || !sampler) {
        record.disposition = "admission-failure";
        record.reason = "production loader did not bind finite authored UVs to the decoded base-color sampler";
      } else {
        const sampled = sampleTexel(sampler, uv[0], uv[1]);
        if (!sampled) throw new Error(`ASSET_RENDER_BINDING_SAMPLE_FAILED: ${path}`);
        record.sample = { uv: [uv[0], uv[1]], rgba: [sampled.r, sampled.g, sampled.b, sampled.a] };
      }
    }
    const failure = records.find((record) => record.disposition === "admission-failure");
    return { assetId: asset.id, sourcePath: path, polygonCount: loaded.polygons.length, renderBinding: records, pass: !failure };
  } finally { loaded.dispose(); }
}

export async function verifyAssetRenderBindings(registryPath = "reports/asset-registry.json") {
  const registry = await readJson(registryPath), assets = registry.assets.filter((asset) => asset.appearanceDisposition === "exact-rgb");
  const sourceBindings = [];
  for (const source of registry.sourceFiles) {
    const asset = registry.assets.find((candidate) => candidate.id === source.canonicalAssetId);
    if (!asset) throw new Error(`ASSET_RENDER_BINDING_UNKNOWN_SOURCE_ASSET: ${source.path}`);
    sourceBindings.push(await verifyPath(asset, source.path, textureRoleIdsForAsset(asset)));
  }
  const byPath = new Map(sourceBindings.map((binding) => [binding.sourcePath, binding]));
  const bindings = assets.map((asset) => {
    const binding = byPath.get(asset.canonicalPath);
    if (!binding) throw new Error(`ASSET_RENDER_BINDING_CANONICAL_NOT_IN_HISTORICAL_CENSUS: ${asset.canonicalPath}`);
    return binding;
  });
  const sourceCoverage = registry.sourceFiles.map((source, index) => {
    const asset = registry.assets.find((candidate) => candidate.id === source.canonicalAssetId);
    const binding = sourceBindings[index];
    const productionDisposition = binding.pass ? source.path === asset.canonicalPath ? "render-bound-base-color" : "alias-of-rendered" : "binding-failure";
    return {
      sourcePath: source.path, canonicalAssetId: source.canonicalAssetId, textureRoles: Object.entries(textureRoleIdsForAsset(asset)).flatMap(([role, textureIds]) => textureIds.map((textureId) => ({ textureId, role }))).sort((left, right) => left.textureId.localeCompare(right.textureId) || left.role.localeCompare(right.role)),
      productionDisposition,
      baseColorSources: binding.renderBinding.filter((record) => record.roles.includes("baseColor")).map(({ textureId, byteSha256, decodedPixelSha256, width, height, disposition, sample }) => ({ textureId, byteSha256, decodedPixelSha256, width, height, disposition, sample })),
      productionFailure: binding.pass ? null : binding.renderBinding.filter((record) => record.disposition === "admission-failure").map((record) => record.reason),
      corpusDisposition: binding.pass && asset.admitted
        ? source.path === asset.canonicalPath ? "render-bound-base-color" : "alias-of-rendered"
        : "admission-failure",
      admissionFailure: asset.admitted ? null : asset.admissionReasons.length ? asset.admissionReasons : [`appearance is ${asset.appearanceDisposition}`],
    };
  });
  const raw = {
    schemaVersion: "glyph-asset-render-binding/v2", registrySha256: registry.contentSha256,
    assets: bindings.map((binding) => ({ assetId: binding.assetId, canonicalPath: binding.sourcePath, pass: binding.pass })),
    sourceCoverage,
    pass: bindings.length === 76 && bindings.every((binding) => binding.pass) && sourceBindings.length === 77 && sourceBindings.every((binding) => binding.pass) && sourceCoverage.length === 77 && sourceCoverage.every((source) => source.baseColorSources.length > 0 && source.productionDisposition !== "binding-failure" && (source.corpusDisposition !== "admission-failure" || source.admissionFailure?.length)),
  };
  return { ...raw, contentSha256: sha(canonical(raw)) };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const check = process.argv.indexOf("--check"), write = process.argv.indexOf("--write"), target = check >= 0 ? resolve(process.argv[check + 1]) : write >= 0 ? resolve(process.argv[write + 1]) : null;
  const report = await verifyAssetRenderBindings();
  if (!report.pass) throw new Error("ASSET_RENDER_BINDING_FAILED");
  if (check >= 0) { if ((await readFile(target, "utf8")) !== json(report)) throw new Error(`ASSET_RENDER_BINDING_REPORT_DRIFT: ${target}`); }
  else if (write >= 0) {
    const temporary = `${target}.tmp-${process.pid}`;
    await writeFile(temporary, json(report));
    await rename(temporary, target);
  }
  else process.stdout.write(json(report));
}
