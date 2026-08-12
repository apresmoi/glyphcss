#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const [configArg = "config/spray-pass.json", reportArg = "reports/spray-pass.json", artifactsArg = "review/spray-pass"] = process.argv.slice(2);
const configPath = resolve(root, configArg);
const reportPath = resolve(root, reportArg);
const artifactsRoot = resolve(root, artifactsArg);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const fail = (message) => { throw new Error(`SPRAY_PASS_VALIDATION: ${message}`); };
const isHash = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const relativePath = (value, label) => {
  if (typeof value !== "string" || value.startsWith("/") || value.split("/").some((part) => !part || part === "." || part === "..")) fail(`${label} must be a safe relative path`);
  return value;
};
const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));
const checkedFile = async (path, expected, label) => {
  if (!isHash(expected)) fail(`${label} has no SHA-256`);
  let bytes;
  try { bytes = await readFile(path); } catch { fail(`${label} file is missing: ${path}`); }
  if (sha256(bytes) !== expected) fail(`${label} SHA-256 mismatch`);
};

const [config, report] = await Promise.all([readJson(configPath), readJson(reportPath)]);
if (config.schemaVersion !== "glyph-spray-pass/v1") fail("wrong config schema");
if (report.schemaVersion !== "glyph-spray-pass-report/v1") fail("wrong report schema");
if (report.disposition !== "proof-only-not-admissible") fail("disposition must be proof-only-not-admissible");
if (!report.config || report.config.sha256 !== sha256(await readFile(configPath))) fail("config hash mismatch");
if (!Array.isArray(config.views) || !config.views.length || !Array.isArray(config.subjects) || !Array.isArray(report.subjects)) fail("subjects/views are required");
const anchorToAuthoredRender = config.generation?.anchorToAuthoredRender ?? "seed-only";
if (!["off", "seed-only", "all-views"].includes(anchorToAuthoredRender)) fail("invalid authored-render anchor mode");
const expectedSubjects = new Map(config.subjects.map((subject) => [subject.key, subject]));
if (report.subjects.length !== expectedSubjects.size) fail("report must contain every configured subject exactly once");
let generatedSize = null;
const seenSubjects = new Set();
for (const subject of report.subjects) {
  const expected = expectedSubjects.get(subject?.key);
  if (!expected || seenSubjects.has(subject.key)) fail("unknown or duplicate subject");
  seenSubjects.add(subject.key);
  if (subject.assetId !== expected.assetId || subject.path !== expected.path) fail(`${subject.key} asset binding mismatch`);
  if (!Array.isArray(subject.views) || subject.views.length !== config.views.length) fail(`${subject.key} must contain every view`);
  let priorUnknown = Infinity;
  const seenViews = new Set();
  for (const [index, view] of subject.views.entries()) {
    if (!view || view.index !== index || view.id !== config.views[index].id || seenViews.has(view.id)) fail(`${subject.key} view schedule mismatch`);
    seenViews.add(view.id);
    const anchored = anchorToAuthoredRender === "all-views" || (anchorToAuthoredRender === "seed-only" && index === 0);
    const expectedMode = anchored || index > 0 ? "inpaint" : "text2img";
    if (view.mode !== expectedMode) fail(`${subject.key}/${view.id} generation mode mismatch`);
    const expectedBaseKind = index === 0
      ? (anchored ? "authored-render" : "none")
      : (anchorToAuthoredRender === "all-views" ? "texture-atlas-authored-render-blend" : "texture-atlas");
    if (expectedBaseKind === "none") {
      if (view.generationBase !== null) fail(`${subject.key}/${view.id} unexpectedly records an img2img base`);
    } else {
      if (!view.generationBase || view.generationBase.kind !== expectedBaseKind || !isHash(view.generationBase.sha256)) fail(`${subject.key}/${view.id} generation base provenance missing`);
      if (view.generationBase.sha256 !== view.knownInput?.knownImage?.sha256) fail(`${subject.key}/${view.id} generation base is not the persisted known image`);
      if (expectedBaseKind.includes("authored-render") && (!view.generationBase.authoredRender || !isHash(view.generationBase.authoredRender.sha256))) fail(`${subject.key}/${view.id} authored render provenance missing`);
    }
    // Do not hardcode a resolution: 1024 segfaults on this 16 GB laptop 4090, so the
    // pipeline generates at 512. Require a sane square that every view agrees on.
    const width = view.generatedImage?.width, height = view.generatedImage?.height;
    if (!Number.isInteger(width) || !Number.isInteger(height) || width !== height || width < 256 || width % 8 !== 0) fail(`${subject.key}/${view.id} generated image dimensions invalid: ${width}x${height}`);
    if (generatedSize === null) generatedSize = width;
    else if (generatedSize !== width) fail(`${subject.key}/${view.id} generated image size ${width} differs from ${generatedSize}`);
    await checkedFile(resolve(artifactsRoot, relativePath(view.generatedImage.path, "generated image")), view.generatedImage.sha256, `${subject.key}/${view.id} generated image`);
    if (!view.generateReport || !isHash(view.generateReport.sha256)) fail(`${subject.key}/${view.id} generate report hash missing`);
    if (!view.backProjection || typeof view.backProjection.texels_written !== "number" || typeof view.backProjection.cells_skipped_uncovered !== "number") fail(`${subject.key}/${view.id} back-projection stats missing`);
    const unknown = view.coverage?.after?.unknownTexels;
    if (!Number.isInteger(unknown) || unknown < 0) fail(`${subject.key}/${view.id} unknown-texel count missing`);
    if (unknown > priorUnknown) fail(`${subject.key}/${view.id} unknown texels increased across views`);
    priorUnknown = unknown;
  }
  if (!Array.isArray(subject.bakedFiles) || subject.bakedFiles.length !== subject.materials.length * 2) fail(`${subject.key} baked texture/state files missing`);
  for (const file of subject.bakedFiles) await checkedFile(resolve(artifactsRoot, relativePath(file.path, "baked file")), file.sha256, `${subject.key} baked file`);
  if (subject.key === "frog" && !subject.warnings?.some((warning) => typeof warning === "string" && /test split|never reach training/i.test(warning))) fail("frog test-split warning is not recorded");

  // A subject can bake the right number of files while having painted nothing.
  // The chicken did exactly that: its OBJ carries vt data but the unresolvable
  // Chicken_01.mtl means glyphcss surfaces no authored UVs, so every covered cell
  // is skipped as uv-invalid and the pages stay empty. That is a legitimate
  // negative result, but it must be declared, never passed off as a painted texture.
  const observed = subject.beforeFill?.observedTexels;
  if (!Number.isInteger(observed) || observed < 0) fail(`${subject.key} observedTexels missing`);
  if (observed === 0 && !subject.warnings?.some((warning) => typeof warning === "string" && /no authored (texture )?(material|uv)/i.test(warning))) {
    fail(`${subject.key} painted zero texels without declaring why (empty bake must not read as success)`);
  }
  const uvInvalid = subject.views.every((view) => view.backProjection.cells_valid_uv === 0);
  if (observed === 0 && !uvInvalid) fail(`${subject.key} painted zero texels despite having valid UVs`);
}
if (!report.warnings?.some((warning) => typeof warning === "string" && /proof-only/i.test(warning))) fail("proof-only warning is not recorded");
console.log(`Spray-pass proof report validated: ${report.subjects.length} subjects × ${config.views.length} views.`);
