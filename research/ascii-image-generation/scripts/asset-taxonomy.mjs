#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";

const root = resolve(import.meta.dirname, "..");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const canonical = (value) => Array.isArray(value)
  ? `[${value.map(canonical).join(",")}]`
  : value && typeof value === "object"
    ? `{${Object.keys(value).filter((key) => key !== "contentSha256").sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`
    : JSON.stringify(value);
const stableJson = (value) => `${JSON.stringify(value, null, 2)}\n`;
const readJson = async (path) => JSON.parse(await readFile(resolve(root, path), "utf8"));
const fail = (code) => { throw new Error(`ASSET_TAXONOMY_${code}`); };
const [dictionarySchema, mappingSchema] = await Promise.all([
  readJson("schema/glyph-object-dictionary.schema.json"),
  readJson("schema/asset-class-mapping.schema.json"),
]);
const ajv = new Ajv2020({ allErrors: true, strict: true });
ajv.addSchema(dictionarySchema); ajv.addSchema(mappingSchema);
const validateDictionarySchema = ajv.getSchema(dictionarySchema.$id);
const validateMappingSchema = ajv.getSchema(mappingSchema.$id);
function schema(validate, value, code) { if (!validate(value)) fail(`${code}:${ajv.errorsText(validate.errors)}`); }

export function validateAssetTaxonomy({ registry, dictionary, mapping }) {
  schema(validateDictionarySchema, dictionary, "DICTIONARY_SCHEMA_INVALID");
  schema(validateMappingSchema, mapping, "MAPPING_SCHEMA_INVALID");
  if (mapping.schemaVersion !== "glyph-asset-class-mapping/v1") fail("MAPPING_SCHEMA_INVALID");
  if (mapping.contentSha256 !== sha256(canonical(mapping))) fail("MAPPING_SEAL_STALE");
  if (dictionary.contentSha256 !== sha256(canonical(dictionary))) fail("DICTIONARY_SEAL_STALE");
  if (mapping.registry.id !== registry.registryId || mapping.registry.contentSha256 !== registry.contentSha256) fail("REGISTRY_REBOUND");
  if (mapping.dictionary.id !== dictionary.id || mapping.dictionary.contentSha256 !== dictionary.contentSha256) fail("DICTIONARY_REBOUND");
  const classIds = new Set(); const classNames = new Set(); const glyphs = new Set(); const colors = new Set();
  for (const entry of dictionary.classes) {
    if (classIds.has(entry.id) || classNames.has(entry.name) || glyphs.has(entry.semanticGlyph) || colors.has(entry.controlColor.toLowerCase())) fail("DICTIONARY_NOT_ONE_TO_ONE");
    classIds.add(entry.id); classNames.add(entry.name); glyphs.add(entry.semanticGlyph); colors.add(entry.controlColor.toLowerCase());
  }
  const admitted = registry.assets.filter((asset) => asset.admitted && ["exact-rgb", "material-only"].includes(asset.appearanceDisposition));
  if (admitted.length !== 179 || admitted.filter((asset) => asset.appearanceDisposition === "exact-rgb").length !== 45 || admitted.filter((asset) => asset.appearanceDisposition === "material-only").length !== 134) fail("B49_POPULATION_DRIFT");
  const byAsset = new Map(); const coverage = new Map();
  for (const entry of mapping.mappings) {
    if (byAsset.has(entry.assetId) || !classIds.has(entry.classId)) fail("MAPPING_DUPLICATE_OR_UNKNOWN_CLASS");
    const asset = admitted.find((candidate) => candidate.id === entry.assetId);
    if (!asset || asset.canonicalPath !== entry.canonicalPath || asset.appearanceDisposition !== entry.appearanceDisposition) fail("MAPPING_UNKNOWN_OR_STALE_ASSET");
    byAsset.set(entry.assetId, entry); coverage.set(entry.classId, (coverage.get(entry.classId) ?? 0) + 1);
  }
  if (byAsset.size !== admitted.length || admitted.some((asset) => !byAsset.has(asset.id))) fail("MAPPING_INCOMPLETE");
  const synthetic = dictionary.classes.find((entry) => entry.name === "synthetic-occluder");
  if (dictionary.classes.filter((entry) => entry !== synthetic).some((entry) => !coverage.has(entry.id)) || (synthetic && coverage.has(synthetic.id))) fail("CLASS_COVERAGE_INVALID");
  if (mapping.mappings.some((entry) => dictionary.classes.find((candidate) => candidate.id === entry.classId)?.name === "cube")) fail("TAUTOLOGICAL_CUBE_CLASS");
  return { admitted, byAsset, coverage: Object.fromEntries([...coverage].sort(([a], [b]) => a - b)) };
}

export async function loadAssetTaxonomy({ registryPath = "reports/asset-registry.json", dictionaryPath = "config/asset-object-dictionary.json", mappingPath = "config/asset-class-mapping.json" } = {}) {
  const [registry, dictionary, mapping] = await Promise.all([readJson(registryPath), readJson(dictionaryPath), readJson(mappingPath)]);
  return { registry, dictionary, mapping, ...validateAssetTaxonomy({ registry, dictionary, mapping }) };
}

export function resolveAssetTaxonomyClass(taxonomy, asset) {
  const entry = taxonomy.byAsset.get(asset.id);
  if (!entry) fail("ASSET_CLASS_ABSENT");
  const dictionaryClass = taxonomy.dictionary.classes.find((candidate) => candidate.id === entry.classId);
  if (!dictionaryClass || dictionaryClass.name === "synthetic-occluder") fail("ASSET_CLASS_INVALID");
  return dictionaryClass;
}

export async function buildAssetTaxonomyReport() {
  const { registry, dictionary, mapping, coverage, byAsset } = await loadAssetTaxonomy();
  const countByDisposition = Object.fromEntries(["exact-rgb", "material-only"].map((disposition) => [disposition, mapping.mappings.filter((entry) => entry.appearanceDisposition === disposition).length]));
  const texturedSourceAudit = registry.sourceFiles.map((source) => {
    const asset = registry.assets.find((candidate) => candidate.id === source.canonicalAssetId);
    if (!asset) fail("TEXTURED_SOURCE_UNKNOWN_ASSET");
    const mappingEntry = byAsset.get(asset.id);
    return { sourcePath: source.path, canonicalAssetId: asset.id, mappedClassId: mappingEntry?.classId ?? null, disposition: asset.admitted && asset.appearanceDisposition === "exact-rgb" ? "first-population-exact-rgb" : "excluded", exclusionReasons: asset.admitted && asset.appearanceDisposition === "exact-rgb" ? [] : asset.admissionReasons };
  });
  if (texturedSourceAudit.length !== 77 || new Set(texturedSourceAudit.map((entry) => entry.canonicalAssetId)).size !== 76 || texturedSourceAudit.filter((entry) => entry.mappedClassId !== null).length !== texturedSourceAudit.filter((entry) => registry.assets.find((asset) => asset.id === entry.canonicalAssetId)?.admitted).length) fail("TEXTURED_SOURCE_AUDIT_DRIFT");
  const raw = {
    schemaVersion: "glyph-asset-taxonomy-report/v1", registry: mapping.registry, dictionary: mapping.dictionary,
    mapping: { id: mapping.id, contentSha256: mapping.contentSha256 }, counts: { admitted: mapping.mappings.length, byDisposition: countByDisposition, byClassId: coverage },
    texturedSourceAudit,
    classificationNotes: [
      { assetPath: null, className: "synthetic-occluder", rationale: "Reserved solely for B44-generated overlap-occlusion geometry; it must map zero source assets and is excluded from admitted-real-asset class coverage." },
      { assetPath: "website/public/gallery/glb/Frog.glb", className: "animal", rationale: "A frog is a non-human animal; the prior filename-only rule incorrectly grouped it with a character fixture." },
      { assetPath: "website/public/gallery/glb/poly-pizza/animated-enemy-small.glb", className: "character", rationale: "An animated game enemy is a character role, not a biological animal." },
      { assetPath: "website/public/gallery/glb/poly-pizza/animated-slime-enemy.glb", className: "character", rationale: "The animated enemy role is semantic character identity even when its body is synthetic." }
    ]
  };
  return { ...raw, contentSha256: sha256(canonical(raw)) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const check = process.argv.includes("--check"); const reportPath = "reports/asset-taxonomy.json";
  const report = await buildAssetTaxonomyReport(); const bytes = Buffer.from(stableJson(report));
  if (check) { const actual = await readFile(resolve(root, reportPath)); if (!actual.equals(bytes)) fail("REPORT_STALE"); }
  else await writeFile(resolve(root, reportPath), bytes);
  process.stdout.write(`asset taxonomy verified report=${sha256(bytes)}\n`);
}
