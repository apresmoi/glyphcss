#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, join, resolve } from "node:path";
import { createCanvas, GlobalFonts } from "@napi-rs/canvas";

const root = resolve(import.meta.dirname, "..");
const require = createRequire(import.meta.url);
const fontDirectory = join(root, "fonts", "ibm-plex-mono");
const fontPath = join(fontDirectory, "IBMPlexMono-Regular.ttf");
const licensePath = join(fontDirectory, "OFL-1.1.txt");
const sourcePath = join(fontDirectory, "SOURCE.json");
const defaultDictionaryPath = join(root, "config", "glyph-object-dictionary.json");
const rendererProvenancePath = join(root, "config", "glyph-rasterizer-provenance.json");
const defaultReportPath = join(root, "reports", "glyph-confusion.json");
const contactSheetPath = join(root, "reports", "glyph-contact-sheet.png");
const fontFamily = "GlyphcssConditioningMono";
const printableAscii = Array.from({ length: 95 }, (_, index) => String.fromCodePoint(index + 32));
const semanticAscii = printableAscii.filter((glyph) => glyph !== " ");
const variants = [
  { id: "cell-8x12", sourcePx: 48, width: 8, height: 12, quantization: 16 },
  { id: "cell-12x18", sourcePx: 48, width: 12, height: 18, quantization: 16 },
  { id: "cell-16x24", sourcePx: 48, width: 16, height: 24, quantization: 16 },
];

function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).filter((key) => key !== "contentSha256").sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
function stableJson(value) { return `${JSON.stringify(value, null, 2)}\n`; }
function fail(message) { throw new Error(`glyph-confusion: ${message}`); }
function hex(codePoint) { return `U+${codePoint.toString(16).toUpperCase().padStart(4, "0")}`; }

async function rendererProvenance(expected) {
  const canvasPackagePath = require.resolve("@napi-rs/canvas/package.json");
  const loadedBindings = Object.keys(require.cache).filter((path) => /[/\\]skia\.[^/\\]+\.node$/.test(path));
  if (loadedBindings.length !== 1) fail(`expected one loaded native renderer binding, found ${loadedBindings.length}`);
  const nativeBinaryPath = loadedBindings[0];
  const nativePackagePath = join(dirname(nativeBinaryPath), "package.json");
  const lockfilePath = join(root, "..", "..", "pnpm-lock.yaml");
  const [canvasPackageBytes, nativePackageBytes, nativeBinaryBytes, lockfileBytes] = await Promise.all([
    readFile(canvasPackagePath), readFile(nativePackagePath), readFile(nativeBinaryPath), readFile(lockfilePath),
  ]);
  const canvasPackage = JSON.parse(canvasPackageBytes);
  const nativePackage = JSON.parse(nativePackageBytes);
  const actual = {
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
    package: { name: canvasPackage.name, version: canvasPackage.version, packageJsonSha256: sha256(canvasPackageBytes) },
    lockfileSha256: sha256(lockfileBytes),
    native: {
      package: { name: nativePackage.name, version: nativePackage.version, packageJsonSha256: sha256(nativePackageBytes) },
      binaryFile: basename(nativeBinaryPath),
      binarySha256: sha256(nativeBinaryBytes),
    },
  };
  const pinned = expected.supportedReproductionPlatform;
  if (actual.platform !== pinned.platform || actual.arch !== pinned.arch || actual.nodeVersion !== pinned.nodeVersion) fail(`unsupported renderer platform ${actual.platform}/${actual.arch} ${actual.nodeVersion}; expected ${pinned.platform}/${pinned.arch} ${pinned.nodeVersion}`);
  if (JSON.stringify(actual.package) !== JSON.stringify(expected.renderer.package) || actual.lockfileSha256 !== expected.renderer.lockfileSha256 || JSON.stringify(actual.native) !== JSON.stringify(expected.renderer.native)) fail("renderer provenance differs from the pinned package, lockfile, or loaded native binary");
  return actual;
}

function registerFont() {
  if (!GlobalFonts.registerFromPath(fontPath, fontFamily)) fail(`could not load ${fontPath}`);
}

function rasterize(glyph, variant) {
  const source = createCanvas(64, 72);
  const context = source.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, source.width, source.height);
  context.fillStyle = "#000000";
  context.font = `${variant.sourcePx}px ${fontFamily}`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(glyph, source.width / 2, source.height / 2 + 2);
  const target = createCanvas(variant.width, variant.height);
  const targetContext = target.getContext("2d");
  targetContext.imageSmoothingEnabled = true;
  targetContext.drawImage(source, 0, 0, target.width, target.height);
  const pixels = targetContext.getImageData(0, 0, target.width, target.height).data;
  const values = [];
  for (let index = 0; index < pixels.length; index += 4) {
    const foreground = 255 - pixels[index];
    values.push(Math.round(foreground / variant.quantization) * variant.quantization);
  }
  return values;
}

function distance(left, right) {
  let total = 0;
  for (let index = 0; index < left.length; index += 1) total += Math.abs(left[index] - right[index]) / 255;
  return total / left.length;
}

function renderContactSheet() {
  const columns = 19;
  const cellWidth = 68;
  const cellHeight = 82;
  const canvas = createCanvas(columns * cellWidth, Math.ceil(printableAscii.length / columns) * cellHeight);
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  printableAscii.forEach((glyph, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x = column * cellWidth;
    const y = row * cellHeight;
    context.strokeStyle = "#c9c9c9";
    context.strokeRect(x, y, cellWidth, cellHeight);
    context.fillStyle = "#111111";
    context.font = `42px ${fontFamily}`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(glyph, x + cellWidth / 2, y + 31);
    context.fillStyle = "#555555";
    context.font = `10px ${fontFamily}`;
    context.fillText(hex(glyph.codePointAt(0)), x + cellWidth / 2, y + 68);
  });
  return canvas.toBuffer("image/png");
}

function confusionReport(fontSource, verifiedLicenseSha256, renderer, dictionary, rasters) {
  const pairs = [];
  for (const variant of variants) {
    for (let left = 0; left < printableAscii.length; left += 1) {
      for (let right = left + 1; right < printableAscii.length; right += 1) {
        const leftGlyph = printableAscii[left];
        const rightGlyph = printableAscii[right];
        pairs.push({
          variant: variant.id,
          left: leftGlyph,
          right: rightGlyph,
          distance: Number(distance(rasters.get(variant.id).get(leftGlyph), rasters.get(variant.id).get(rightGlyph)).toFixed(8)),
        });
      }
    }
  }
  const minimumDistanceByPair = new Map();
  for (const pair of pairs) {
    const key = `${pair.left}\u0000${pair.right}`;
    minimumDistanceByPair.set(key, Math.min(minimumDistanceByPair.get(key) ?? Infinity, pair.distance));
  }
  const selectedGlyphs = dictionary.classes.map((entry) => entry.semanticGlyph);
  const selectedPairs = [];
  for (let left = 0; left < selectedGlyphs.length; left += 1) {
    for (let right = left + 1; right < selectedGlyphs.length; right += 1) {
      const [first, second] = [selectedGlyphs[left], selectedGlyphs[right]].sort((a, b) => a.codePointAt(0) - b.codePointAt(0));
      const key = `${first}\u0000${second}`;
      const minimumDistance = minimumDistanceByPair.get(key);
      if (minimumDistance === undefined) fail(`selected glyph pair ${JSON.stringify(selectedGlyphs[left])}/${JSON.stringify(selectedGlyphs[right])} is not printable ASCII`);
      selectedPairs.push({ left: selectedGlyphs[left], right: selectedGlyphs[right], minimumDistance });
    }
  }
  const selectedMinimumDistance = Math.min(...selectedPairs.map((pair) => pair.minimumDistance));
  const collisionThreshold = 0.05;
  if (!Number.isFinite(selectedMinimumDistance) || selectedMinimumDistance < collisionThreshold) fail(`selected semantic glyphs collide below ${collisionThreshold}`);
  return {
    schemaVersion: "glyph-confusion-report/v1",
    font: {
      id: fontSource.fontId,
      sha256: fontSource.fontSha256,
      sourceRevision: fontSource.upstreamRevision,
      license: fontSource.license,
      licenseSha256: verifiedLicenseSha256,
      verifiedLicenseSha256,
    },
    vocabulary: { firstCodePoint: "U+0020", lastCodePoint: "U+007E", count: printableAscii.length },
    plannedVariants: variants,
    method: {
      renderer: "@napi-rs/canvas with vendored IBM Plex Mono bytes and pinned loaded native binding",
      raster: "64x72 white source, centered 48px glyph, bilinear resize, 8-bit foreground quantized to 16",
      distance: "mean absolute foreground difference divided by 255 over every degraded cell pixel",
      semanticCollisionThreshold: collisionThreshold,
    },
    renderer,
    dictionary: {
      id: dictionary.id,
      sha256: dictionary.contentSha256,
      entries: dictionary.classes.map(({ id, name, semanticGlyph, controlColor }) => ({ id, name, semanticGlyph, controlColor })),
      selectedPairs,
      selectedMinimumDistance,
    },
    pairCount: pairs.length,
    pairs,
  };
}

async function main() {
  const values = process.argv.slice(2);
  const option = (name, fallback) => {
    const index = values.indexOf(name);
    if (index < 0) return fallback;
    if (!values[index + 1]) fail(`${name} requires a path`);
    return resolve(values[index + 1]);
  };
  const dictionaryPath = option("--dictionary", defaultDictionaryPath);
  const reportPath = option("--report", defaultReportPath);
  const checkPath = option("--check", null);
  registerFont();
  const [fontSource, dictionary, expectedRenderer, fontBytes, licenseBytes] = await Promise.all([readFile(sourcePath, "utf8").then(JSON.parse), readFile(dictionaryPath, "utf8").then(JSON.parse), readFile(rendererProvenancePath, "utf8").then(JSON.parse), readFile(fontPath), readFile(licensePath)]);
  if (sha256(fontBytes) !== fontSource.fontSha256 || dictionary.font.sha256 !== fontSource.fontSha256 || dictionary.font.id !== fontSource.fontId) fail("font provenance does not agree with dictionary");
  const verifiedLicenseSha256 = sha256(licenseBytes);
  if (verifiedLicenseSha256 !== fontSource.licenseSha256) fail("bundled OFL-1.1.txt hash differs from SOURCE.json");
  const renderer = await rendererProvenance(expectedRenderer);
  if (dictionary.contentSha256 !== sha256(canonical(dictionary))) fail("dictionary contentSha256 is stale");
  const classIds = new Set(); const classNames = new Set(); const glyphs = new Set(); const colors = new Set();
  for (const entry of dictionary.classes) {
    if (classIds.has(entry.id) || classNames.has(entry.name) || glyphs.has(entry.semanticGlyph) || colors.has(entry.controlColor.toLowerCase())) fail("dictionary IDs, names, glyphs, and colors must each be one-to-one");
    if (!semanticAscii.includes(entry.semanticGlyph)) fail(`semantic glyph ${JSON.stringify(entry.semanticGlyph)} is outside non-space printable ASCII`);
    classIds.add(entry.id); classNames.add(entry.name); glyphs.add(entry.semanticGlyph); colors.add(entry.controlColor.toLowerCase());
  }
  const rasters = new Map(variants.map((variant) => [variant.id, new Map(printableAscii.map((glyph) => [glyph, rasterize(glyph, variant)]))]));
  const report = confusionReport(fontSource, verifiedLicenseSha256, renderer, dictionary, rasters);
  const reportBytes = Buffer.from(stableJson(report));
  const contactSheet = renderContactSheet();
  if (checkPath) {
    const [actualReport, actualSheet] = await Promise.all([readFile(checkPath), readFile(contactSheetPath)]);
    if (!actualReport.equals(reportBytes)) fail(`report differs; expected sha256 ${sha256(reportBytes)}, got ${sha256(actualReport)}`);
    if (!actualSheet.equals(contactSheet)) fail(`contact sheet differs; expected sha256 ${sha256(contactSheet)}, got ${sha256(actualSheet)}`);
    console.log(`glyph confusion verified report=${sha256(reportBytes)} contactSheet=${sha256(contactSheet)}`);
    return;
  }
  await Promise.all([writeFile(reportPath, reportBytes), writeFile(contactSheetPath, contactSheet)]);
  console.log(`glyph confusion generated report=${sha256(reportBytes)} contactSheet=${sha256(contactSheet)}`);
}

await main();
