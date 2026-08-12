import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { deflateSync, inflateSync } from "node:zlib";
import { createCanvas, GlobalFonts } from "@napi-rs/canvas";
import { contentSha256, CONTROL_ROLES } from "./provider-core.mjs";

const ROLE_SOURCE = Object.freeze({
  "visible-ascii": ["visible", "visible"], "semantic-ascii": ["semantic", "semantic"], "semantic-color": ["semantic", "semantic-color-argb"],
  depth: ["visible", "depth-normalized-f32"], normal: ["visible", "normal-normalized-f32"], "world-position": ["visible", "world-position-normalized-f32"],
  "surface-uv": ["visible", "surface-uv-normalized-f32"], coverage: ["visible", "coverage-u8"], shade: ["visible", "shade-f32"],
});
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));
const projectRoot = resolve(dirname(new URL(import.meta.url).pathname), "../..");
const fontPath = join(projectRoot, "fonts/ibm-plex-mono/IBMPlexMono-Regular.ttf");
const fontSourcePath = join(projectRoot, "fonts/ibm-plex-mono/SOURCE.json");
const rendererProvenancePath = join(projectRoot, "config/glyph-rasterizer-provenance.json");
const fontFamily = "GlyphcssConditioningMono";
export const ASCII_RASTER_CONFIG = Object.freeze({
  id: "cell-8x12", sourceWidth: 64, sourceHeight: 72, sourcePx: 48,
  baselineOffsetPx: 2, cellWidth: 8, cellHeight: 12, quantization: 16,
  smoothing: "bilinear", foreground: "white", background: "black",
});
let asciiRasterProvenance;
async function loadAsciiRasterProvenance() {
  if (asciiRasterProvenance) return asciiRasterProvenance;
  const [fontBytes, fontSourceBytes, rendererBytes] = await Promise.all([readFile(fontPath), readFile(fontSourcePath), readFile(rendererProvenancePath)]);
  const fontSource = JSON.parse(fontSourceBytes), renderer = JSON.parse(rendererBytes);
  if (sha256(fontBytes) !== fontSource.fontSha256) throw new Error("pinned B4 conditioning font hash drift");
  if (renderer.renderer?.package?.name !== "@napi-rs/canvas" || renderer.renderer.package.version !== "1.0.2") throw new Error("pinned B4 rasterizer provenance drift");
  if (!GlobalFonts.registerFromPath(fontPath, fontFamily)) throw new Error("could not register pinned B4 conditioning font");
  asciiRasterProvenance = Object.freeze({
    font: { id: fontSource.fontId, sha256: fontSource.fontSha256 },
    raster: ASCII_RASTER_CONFIG,
    rasterConfigSha256: contentSha256(ASCII_RASTER_CONFIG),
    rendererProvenanceSha256: sha256(rendererBytes),
  });
  return asciiRasterProvenance;
}
export function rasterizePinnedAsciiGlyph(glyph) {
  if (typeof glyph !== "string" || [...glyph].length !== 1 || glyph.codePointAt(0) < 32 || glyph.codePointAt(0) > 126) throw new Error("conditioning glyph must be one printable ASCII character");
  const source = createCanvas(ASCII_RASTER_CONFIG.sourceWidth, ASCII_RASTER_CONFIG.sourceHeight);
  const context = source.getContext("2d");
  context.fillStyle = "#ffffff"; context.fillRect(0, 0, source.width, source.height);
  context.fillStyle = "#000000"; context.font = `${ASCII_RASTER_CONFIG.sourcePx}px ${fontFamily}`;
  context.textAlign = "center"; context.textBaseline = "middle";
  context.fillText(glyph, source.width / 2, source.height / 2 + ASCII_RASTER_CONFIG.baselineOffsetPx);
  const target = createCanvas(ASCII_RASTER_CONFIG.cellWidth, ASCII_RASTER_CONFIG.cellHeight);
  const targetContext = target.getContext("2d");
  targetContext.imageSmoothingEnabled = true;
  targetContext.drawImage(source, 0, 0, target.width, target.height);
  const pixels = targetContext.getImageData(0, 0, target.width, target.height).data;
  return Buffer.from(Array.from({ length: target.width * target.height }, (_, index) => Math.min(255, Math.round((255 - pixels[index * 4]) / ASCII_RASTER_CONFIG.quantization) * ASCII_RASTER_CONFIG.quantization)));
}
function confined(root, path) {
  if (typeof path !== "string" || !path || path.startsWith("/")) throw new Error("control PNG path invalid");
  const base = resolve(root), candidate = resolve(base, path);
  if (candidate !== base && !candidate.startsWith(`${base}${sep}`)) throw new Error("control PNG path escapes upload root");
  return candidate;
}
function uploadReference(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("control provider reference invalid");
  const keys = Object.keys(value);
  if (keys.length !== 1 || (keys[0] !== "fileId" && keys[0] !== "imageUrl")) throw new Error("control provider reference invalid");
  if (typeof value[keys[0]] !== "string" || !value[keys[0]]) throw new Error("control provider reference invalid");
  if (keys[0] === "imageUrl" && !value.imageUrl.startsWith("https://")) throw new Error("control provider reference URL invalid");
  return keys[0] === "fileId" ? { fileId: value.fileId } : { imageUrl: value.imageUrl };
}
const u32 = (value) => { const bytes = Buffer.alloc(4); bytes.writeUInt32BE(value >>> 0); return bytes; };
let crcTable;
function crc32(bytes) {
  crcTable ??= Array.from({ length: 256 }, (_, n) => { let value = n; for (let bit = 0; bit < 8; bit++) value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1; return value >>> 0; });
  let crc = 0xffffffff; for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8); return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) { const name = Buffer.from(type); const body = Buffer.concat([name, data]); return Buffer.concat([u32(data.length), body, u32(crc32(body))]); }
export function encodeRgbaPng(width, height, rgba) {
  if (rgba.length !== width * height * 4) throw new Error("RGBA byte count does not match PNG dimensions");
  const scanlines = Buffer.alloc(height * (1 + width * 4));
  for (let row = 0; row < height; row++) { const offset = row * (1 + width * 4); scanlines[offset] = 0; rgba.copy(scanlines, offset + 1, row * width * 4, (row + 1) * width * 4); }
  const ihdr = Buffer.concat([u32(width), u32(height), Buffer.from([8, 6, 0, 0, 0])]);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(scanlines, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}
export function decodeRgbaPng(bytes) {
  if (!Buffer.from(bytes.subarray(0, 8)).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error("invalid PNG signature");
  let offset = 8, width, height; const idat = [];
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset); const type = bytes.subarray(offset + 4, offset + 8).toString(); const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (crc32(Buffer.concat([Buffer.from(type), data])) !== bytes.readUInt32BE(offset + 8 + length)) throw new Error("PNG CRC mismatch");
    if (type === "IHDR") { width = data.readUInt32BE(0); height = data.readUInt32BE(4); if (data[8] !== 8 || data[9] !== 6) throw new Error("PNG must be RGBA8"); }
    if (type === "IDAT") idat.push(data);
    offset += 12 + length;
  }
  const scanlines = inflateSync(Buffer.concat(idat)); const rgba = Buffer.alloc(width * height * 4);
  for (let row = 0; row < height; row++) { const source = row * (1 + width * 4); if (scanlines[source] !== 0) throw new Error("unsupported PNG filter"); scanlines.copy(rgba, row * width * 4, source + 1, source + 1 + width * 4); }
  return { width, height, rgba };
}
const byte = (value) => Math.round(Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0)) * 255);
function encodeRole(role, source, width, height, asciiProvenance) {
  const cells = width * height;
  let rgba = Buffer.alloc(cells * 4), outputWidth = width, outputHeight = height, legend;
  if (role.endsWith("ascii")) {
    const text = source.toString("utf8").replaceAll("\n", ""); if ([...text].length !== cells) throw new Error(`${role} cell count mismatch`);
    outputWidth = width * ASCII_RASTER_CONFIG.cellWidth; outputHeight = height * ASCII_RASTER_CONFIG.cellHeight;
    rgba = Buffer.alloc(outputWidth * outputHeight * 4);
    [...text].forEach((glyph, cellIndex) => {
      const bitmap = rasterizePinnedAsciiGlyph(glyph), cellX = cellIndex % width, cellY = Math.floor(cellIndex / width);
      for (let y = 0; y < ASCII_RASTER_CONFIG.cellHeight; y++) for (let x = 0; x < ASCII_RASTER_CONFIG.cellWidth; x++) {
        const value = bitmap[y * ASCII_RASTER_CONFIG.cellWidth + x], offset = ((cellY * ASCII_RASTER_CONFIG.cellHeight + y) * outputWidth + cellX * ASCII_RASTER_CONFIG.cellWidth + x) * 4;
        rgba.set([value, value, value, 255], offset);
      }
    });
    legend = { encoding: "pinned-font-cell-raster-grayscale", ...asciiProvenance };
  } else if (role === "semantic-color") {
    const view = new DataView(source.buffer, source.byteOffset, source.byteLength);
    for (let index = 0; index < cells; index++) { const argb = view.getUint32(index * 4, true); rgba[index * 4] = (argb >>> 16) & 255; rgba[index * 4 + 1] = (argb >>> 8) & 255; rgba[index * 4 + 2] = argb & 255; rgba[index * 4 + 3] = (argb >>> 24) & 255; }
    legend = { encoding: "argb-u32-little-endian-to-rgba8" };
  } else if (role === "coverage") {
    for (let index = 0; index < cells; index++) rgba.set([source[index] ? 255 : 0, source[index] ? 255 : 0, source[index] ? 255 : 0, 255], index * 4);
    legend = { encoding: "u8-binary-to-grayscale", zero: 0, covered: 255 };
  } else {
    const components = ["normal", "world-position"].includes(role) ? 3 : role === "surface-uv" ? 2 : 1;
    if (source.byteLength !== cells * components * 4) throw new Error(`${role} float map shape mismatch`);
    const view = new DataView(source.buffer, source.byteOffset, source.byteLength);
    for (let index = 0; index < cells; index++) {
      const values = Array.from({ length: components }, (_, component) => view.getFloat32((component * cells + index) * 4, true));
      const valid = values.every(Number.isFinite); rgba[index * 4] = byte(values[0]); rgba[index * 4 + 1] = byte(values[1] ?? values[0]); rgba[index * 4 + 2] = byte(values[2] ?? 0); rgba[index * 4 + 3] = valid ? 255 : 0;
    }
    legend = { encoding: components === 1 ? "normalized-f32-little-endian-to-grayscale" : components === 2 ? "normalized-f32x2-little-endian-to-rg" : "normalized-f32x3-little-endian-to-rgb", clamp: [0, 1], nonFiniteAlpha: 0 };
  }
  return { rgba, width: outputWidth, height: outputHeight, legend };
}

export async function encodeControlUploadManifest({ corpusRoot, record, frameId, outputRoot, providerReferences }) {
  const asciiProvenance = await loadAsciiRasterProvenance();
  const manifests = {
    visible: await readJson(join(corpusRoot, record.visibleBundle, "manifest.json")),
    semantic: await readJson(join(corpusRoot, record.semanticBundle, "manifest.json")),
  };
  const metadataFrame = manifests.visible.frames.find((entry) => entry.id === frameId); if (!metadataFrame) throw new Error("control frame missing");
  const metadata = await readJson(join(corpusRoot, record.visibleBundle, metadataFrame.files.metadata));
  const width = metadata.cols, height = metadata.rows, cells = width * height;
  const byRole = new Map(providerReferences.map((entry) => [entry.role, entry]));
  if (byRole.size !== CONTROL_ROLES.length || CONTROL_ROLES.some((role) => !byRole.has(role))) throw new Error("complete upload reference role set required");
  const controls = [];
  for (const role of CONTROL_ROLES) {
    const [bundle, key] = ROLE_SOURCE[role], manifest = manifests[bundle], frame = manifest.frames.find((entry) => entry.id === frameId);
    const sourcePath = frame?.files[key], sourceSha256 = manifest.files[sourcePath];
    if (!sourcePath || !sourceSha256) throw new Error(`B6 source missing for ${role}`);
    const source = await readFile(join(corpusRoot, bundle === "visible" ? record.visibleBundle : record.semanticBundle, sourcePath));
    if (sha256(source) !== sourceSha256) throw new Error(`B6 source hash mismatch for ${role}`);
    const encoded = encodeRole(role, source, width, height, asciiProvenance);
    const { rgba, legend } = encoded, png = encodeRgbaPng(encoded.width, encoded.height, rgba); decodeRgbaPng(png);
    const pngSha256 = sha256(png), pngPath = `controls/${frameId}/${role}-${pngSha256.slice(0, 16)}.png`, target = join(outputRoot, pngPath);
    await mkdir(dirname(target), { recursive: true }); await writeFile(target, png);
    const reference = byRole.get(role); const providerReference = uploadReference(reference.fileId !== undefined ? { fileId: reference.fileId } : { imageUrl: reference.imageUrl });
    controls.push({ role, bundle, sourcePath, sourceSha256, pngPath, pngSha256, width: encoded.width, height: encoded.height, legend, providerReference });
  }
  const raw = { schemaVersion: "glyph-control-upload-manifest/v1", trajectoryId: record.trajectory.controlTrajectory.id, trajectorySha256: record.trajectory.contentSha256, frameId, bundles: { visible: record.visibleBundleSha256, semantic: record.semanticBundleSha256 }, controls };
  const manifest = { ...raw, contentSha256: contentSha256(raw) }, path = join(outputRoot, `control-upload-${frameId}.json`);
  const temporary = `${path}.tmp`; await writeFile(temporary, json(manifest)); await rename(temporary, path);
  return { path, manifest };
}

export async function validateControlUploadManifest(path, root) {
  const manifest = await readJson(path);
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)
    || Object.keys(manifest).sort().join(",") !== ["bundles", "contentSha256", "controls", "frameId", "schemaVersion", "trajectoryId", "trajectorySha256"].sort().join(",")
    || manifest.schemaVersion !== "glyph-control-upload-manifest/v1"
    || typeof manifest.trajectoryId !== "string" || typeof manifest.frameId !== "string"
    || !/^[a-f0-9]{64}$/.test(manifest.trajectorySha256)
    || !manifest.bundles || Object.keys(manifest.bundles).sort().join(",") !== "semantic,visible"
    || !Object.values(manifest.bundles).every((value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value))
    || contentSha256(manifest) !== manifest.contentSha256
    || !Array.isArray(manifest.controls) || manifest.controls.length !== CONTROL_ROLES.length) throw new Error("control upload manifest invalid");
  for (let index = 0; index < CONTROL_ROLES.length; index++) {
    const control = manifest.controls[index];
    if (!control || typeof control !== "object" || Array.isArray(control)
      || Object.keys(control).sort().join(",") !== ["bundle", "height", "legend", "pngPath", "pngSha256", "providerReference", "role", "sourcePath", "sourceSha256", "width"].sort().join(",")
      || control.role !== CONTROL_ROLES[index]
      || control.bundle !== ROLE_SOURCE[control.role][0]
      || typeof control.sourcePath !== "string" || !control.sourcePath
      || !/^[a-f0-9]{64}$/.test(control.sourceSha256)
      || !/^[a-f0-9]{64}$/.test(control.pngSha256)
      || !Number.isInteger(control.width) || control.width < 1
      || !Number.isInteger(control.height) || control.height < 1
      || !control.legend || typeof control.legend !== "object" || Array.isArray(control.legend)) throw new Error("control upload provenance invalid");
    if (control.role.endsWith("ascii")) {
      const expected = await loadAsciiRasterProvenance();
      if (control.legend.encoding !== "pinned-font-cell-raster-grayscale"
        || JSON.stringify(control.legend.font) !== JSON.stringify(expected.font)
        || JSON.stringify(control.legend.raster) !== JSON.stringify(expected.raster)
        || control.legend.rasterConfigSha256 !== expected.rasterConfigSha256
        || control.legend.rendererProvenanceSha256 !== expected.rendererProvenanceSha256) throw new Error("ASCII font/raster provenance drift");
    }
    uploadReference(control.providerReference);
    const png = await readFile(confined(root, control.pngPath)); if (sha256(png) !== control.pngSha256) throw new Error("control PNG hash mismatch");
    const decoded = decodeRgbaPng(png); if (decoded.width !== control.width || decoded.height !== control.height) throw new Error("control PNG dimensions mismatch");
  }
  return manifest;
}
