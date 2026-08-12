#!/usr/bin/env node
// THE single Oven payload for this work. Per view it carries glyphcss's REAL text output
// (characters + per-cell colour, never rasterised) plus every image actually fed to the
// model and the image it produced. Columns say FED or NOT FED so what the model really
// receives is never ambiguous.
import { readFile, writeFile, mkdir, access, readdir, stat } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import sharp from "sharp";

const root = resolve(new URL("..", import.meta.url).pathname);
const repoRoot = resolve(root, "..", "..");
const sceneKey = process.argv[2] ?? "building";
const sceneRoot = resolve(root, "reports/glyph-scenes", sceneKey);

const outPath = resolve(repoRoot, ".local/burnlist/data/glyph-scene-inputs.json");
const THUMB = 256, COLS = 256, ROWS = 128;
const PIXEL_CHANGE_DELTA = 8;
const PARITY_MEAN_ABSOLUTE_DELTA_LIMIT = 12;
const MESH_PAD_RGB = [128, 128, 128];
const COVERED_MASK_BACKGROUND_DELTA = 12;

const exists = async (p) => { try { await access(p); return true; } catch { return false; } };
const hex = (v) => `#${(v & 0xffffff).toString(16).padStart(6, "0")}`;

async function filesUnder(dir) {
  if (!(await exists(dir))) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = resolve(dir, entry.name);
    return entry.isDirectory() ? filesUnder(path) : entry.isFile() ? [path] : [];
  }));
  return nested.flat();
}

function firstMatchingFile(files, names) {
  const wanted = new Set(names.filter(Boolean).map((name) => basename(name)));
  return files.filter((path) => wanted.has(basename(path)))
    .sort((a, b) => a.length - b.length || a.localeCompare(b))[0] ?? null;
}

async function glyphText(textPath, colorPath, label) {
  if (!(await exists(textPath))) return null;
  const lines = (await readFile(textPath, "utf8")).split("\n").filter((l) => l.length);
  let colors = null;
  if (await exists(colorPath)) {
    const buffer = await readFile(colorPath);
    colors = lines.map((line, row) =>
      Array.from({ length: line.length }, (_, col) => hex(buffer.readUInt32LE((row * COLS + col) * 4))));
  }
  return { text: lines.join("\n"), colors, label, cols: lines[0]?.length ?? 0, rows: lines.length };
}

async function pngTile(png, label) {
  const thumbnail = await sharp(png)
    .flatten({ background: "#000000" })
    .resize(THUMB, THUMB, { fit: "cover", position: "centre" })
    .png()
    .toBuffer();
  return { src: `data:image/png;base64,${thumbnail.toString("base64")}`, width: THUMB, height: THUMB, label };
}

async function pngThumb(path, label) {
  if (!(await exists(path))) return null;
  return pngTile(path, label);
}

async function cellThumb(path, label) {
  if (!(await exists(path))) return null;
  const buffer = await readFile(path);
  const image = Buffer.alloc(THUMB * THUMB * 4, 255);
  for (let y = 0; y < THUMB; y++) {
    const row = Math.min(ROWS - 1, Math.floor((y / THUMB) * ROWS));
    for (let x = 0; x < THUMB; x++) {
      const col = Math.min(COLS - 1, Math.floor((x / THUMB) * COLS));
      const value = buffer.readFloatLE((row * COLS + col) * 4);
      const v = Number.isFinite(value) ? Math.round(Math.max(0, Math.min(1, 1 - value)) * 255) : 0;
      const o = (y * THUMB + x) * 4;
      image[o] = v; image[o + 1] = v; image[o + 2] = v;
    }
  }
  return pngTile(await sharp(image, { raw: { width: THUMB, height: THUMB, channels: 4 } }).png().toBuffer(), label);
}


async function cellArgbThumb(path, label) {
  if (!(await exists(path))) return null;
  const buffer = await readFile(path);
  const image = Buffer.alloc(THUMB * THUMB * 4, 255);
  for (let y = 0; y < THUMB; y++) {
    const row = Math.min(ROWS - 1, Math.floor((y / THUMB) * ROWS));
    for (let x = 0; x < THUMB; x++) {
      const col = Math.min(COLS - 1, Math.floor((x / THUMB) * COLS));
      const packed = buffer.readUInt32LE((row * COLS + col) * 4);
      const o = (y * THUMB + x) * 4;
      image[o] = (packed >> 16) & 255; image[o + 1] = (packed >> 8) & 255;
      image[o + 2] = packed & 255;
    }
  }
  return pngTile(await sharp(image, { raw: { width: THUMB, height: THUMB, channels: 4 } }).png().toBuffer(), label);
}

async function readMetricImage(png, { width, height } = {}) {
  const image = sharp(png);
  if (width !== undefined || height !== undefined) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
      throw new Error("GLYPH_SCENE_PARITY_RESIZE_INVALID");
    }
    // The atlas base is 256px while SDXL writes 512px. They are the same
    // camera framing, so evaluate on the atlas's native raster using Sharp's
    // cubic downsampling rather than cropping either image.
    image.resize(width, height, { fit: "fill", kernel: sharp.kernel.cubic });
  }
  const { data, info } = await image
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.channels !== 3 || (width !== undefined && (info.width !== width || info.height !== height))) {
    throw new Error("GLYPH_SCENE_PARITY_NORMALIZATION_INVALID");
  }
  return { data, width: info.width, height: info.height };
}

function coveredMask(atlasBase) {
  if (atlasBase.data.length !== atlasBase.width * atlasBase.height * 3) {
    throw new Error("GLYPH_SCENE_COVERED_MASK_PIXEL_BUFFER_INVALID");
  }
  const mask = new Uint8Array(atlasBase.width * atlasBase.height);
  let pixels = 0;
  for (let index = 0, offset = 0; index < mask.length; index++, offset += 3) {
    const delta = Math.max(
      Math.abs(atlasBase.data[offset] - MESH_PAD_RGB[0]),
      Math.abs(atlasBase.data[offset + 1] - MESH_PAD_RGB[1]),
      Math.abs(atlasBase.data[offset + 2] - MESH_PAD_RGB[2]),
    );
    if (delta > COVERED_MASK_BACKGROUND_DELTA) { mask[index] = 1; pixels++; }
  }
  return { mask, pixels };
}

function comparePixels(atlasBase, output, mask) {
  if (atlasBase.data.length !== output.data.length || atlasBase.width !== output.width || atlasBase.height !== output.height) {
    throw new Error("GLYPH_SCENE_PARITY_PIXEL_BUFFER_INVALID");
  }
  if (mask.length !== atlasBase.width * atlasBase.height) {
    throw new Error("GLYPH_SCENE_PARITY_MASK_BUFFER_INVALID");
  }
  let changedPixels = 0, absoluteTotal = 0, maximumAbsoluteDelta = 0;
  let totalPixels = 0;
  for (let pixel = 0, offset = 0; pixel < mask.length; pixel++, offset += 3) {
    if (!mask[pixel]) continue;
    totalPixels++;
    const r = Math.abs(atlasBase.data[offset] - output.data[offset]);
    const g = Math.abs(atlasBase.data[offset + 1] - output.data[offset + 1]);
    const b = Math.abs(atlasBase.data[offset + 2] - output.data[offset + 2]);
    absoluteTotal += r + g + b;
    maximumAbsoluteDelta = Math.max(maximumAbsoluteDelta, r, g, b);
    if (Math.max(r, g, b) > PIXEL_CHANGE_DELTA) changedPixels++;
  }
  if (!totalPixels) throw new Error("GLYPH_SCENE_PARITY_MASK_EMPTY");
  return {
    totalPixels,
    changedPixels,
    ratio: changedPixels / totalPixels,
    meanAbsoluteDelta: absoluteTotal / (totalPixels * 3),
    maximumAbsoluteDelta,
    mask: { kind: "atlas-base-covered", backgroundRgb: MESH_PAD_RGB, backgroundDelta: COVERED_MASK_BACKGROUND_DELTA, coveredPixels: totalPixels },
  };
}

function summarize(frames) {
  const total = frames.length;
  const passed = frames.filter((frame) => frame.status === "pass").length;
  return {
    passed,
    total,
    ratio: total ? passed / total : 0,
    meanAbsoluteDelta: total
      ? frames.reduce((sum, frame) => sum + frame.difference.meanAbsoluteDelta, 0) / total
      : 0,
    maximumAbsoluteDelta: frames.reduce((max, frame) => Math.max(max, frame.difference.maximumAbsoluteDelta), 0),
  };
}

const liveRunDir = resolve(root, "review/glyph-scenes", sceneKey);
const runsDir = resolve(sceneRoot, "runs");
const runVariants = [];

if (await exists(resolve(liveRunDir, "subject-report.json"))) {
  const info = await stat(resolve(liveRunDir, "subject-report.json"));
  runVariants.push({
    id: sceneKey,
    label: `${sceneKey} (current)`,
    dir: liveRunDir,
    modifiedAt: info.mtimeMs,
    isLive: true,
  });
}

if (await exists(runsDir)) {
  const entries = await readdir(runsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = resolve(runsDir, entry.name);
    const reportPath = resolve(dir, "subject-report.json");
    const info = await stat(await exists(reportPath) ? reportPath : dir);
    runVariants.push({
      id: entry.name,
      label: entry.name,
      dir,
      modifiedAt: info.mtimeMs,
      isLive: false,
    });
  }
}

runVariants.sort((a, b) => b.modifiedAt - a.modifiedAt || a.id.localeCompare(b.id));
if (!runVariants.length) {
  throw new Error(`No runs found in ${runsDir} and no live run found in ${liveRunDir}`);
}
if (!runVariants.some((variant) => variant.isLive)) runVariants[0].isLive = true;
if (new Set(runVariants.map((variant) => variant.id)).size !== runVariants.length) {
  throw new Error(`Run ids must be unique; "${sceneKey}" is reserved for the live review`);
}

const manifest = JSON.parse(await readFile(resolve(sceneRoot, "manifest.json"), "utf8"));
const controlsManifest = JSON.parse(await readFile(resolve(sceneRoot, manifest.controls.path), "utf8"));
const frameCount = controlsManifest.frames.length;
const trajectoryViews = controlsManifest.trajectory?.views;
if (!Array.isArray(trajectoryViews) || trajectoryViews.length !== frameCount
  || trajectoryViews.some((view, index) => view?.id !== `frame-${String(index).padStart(3, "0")}`)) {
  throw new Error("GLYPH_SCENE_PARITY_TRAJECTORY_INVALID");
}

const domains = [];
const byDomain = {};

for (const variant of runVariants) {
  let reportViews = new Map();
  try {
    const report = JSON.parse(await readFile(resolve(variant.dir, "subject-report.json"), "utf8"));
    reportViews = new Map((report.views ?? []).map((view) => [view.index, view]));
  } catch {
    // A missing historical run report remains inspectable; its input tile uses
    // the legacy label rather than inventing provenance.
  }
  const views = [];
  for (let index = 0; index < frameCount; index++) {
    const stem = `frame-${String(index).padStart(3, "0")}`;
    const dir = resolve(sceneRoot, "views/frames", stem);
    const semantic = await glyphText(resolve(dir, "semantic.txt"), resolve(dir, "semantic-color-argb.bin"), "glyphcss SEMANTIC frame - authored class characters - NOT FED");
    const visible = await glyphText(resolve(dir, "visible.txt"), resolve(dir, "visible-color-argb.bin"), "glyphcss VISIBLE frame - authored shaded material source");
    if (!semantic || !visible) continue;
    const generationBase = reportViews.get(index)?.generationBase;
    const baseLabel = generationBase
      ? `${generationBase.kind} base - FED`
      : "no img2img base - text2img";
    const targetPath = resolve(variant.dir, "generated", `${stem}.png`);
    if (!(await exists(targetPath))) throw new Error(`GLYPH_SCENE_PARITY_TARGET_MISSING:${targetPath}`);
    const atlasBasePath = resolve(variant.dir, "inputs", `${stem}-known.png`);
    if (!(await exists(atlasBasePath))) throw new Error(`GLYPH_SCENE_PARITY_ATLAS_BASE_MISSING:${atlasBasePath}`);
    const atlasBase = await readMetricImage(atlasBasePath);
    const output = await readMetricImage(targetPath, { width: atlasBase.width, height: atlasBase.height });
    const covered = coveredMask(atlasBase);
    const difference = comparePixels(atlasBase, output, covered.mask);
    const atlasBaseTile = await pngTile(atlasBasePath, "baked atlas reprojected to this view");
    const images = (await Promise.all([
      cellArgbThumb(resolve(dir, "visible-color-argb.bin"), "glyphcss visible - authored shaded material source"),
      cellThumb(resolve(dir, "depth-normalized-f32.bin"), "depth - FED (ControlNet)"),
      pngThumb(atlasBasePath, baseLabel),
      pngThumb(resolve(variant.dir, "inputs", `${stem}-unknown-mask.png`), "regenerate mask - FED"),
      pngThumb(targetPath, "SDXL output"),
    ])).filter(Boolean);
    images.push(atlasBaseTile);
    const coverage = await readFile(resolve(dir, "coverage-u8.bin"));
    views.push({ id: stem, frame: index, title: `view ${index}`, semantic, visible, images,
      coveredCells: coverage.reduce((sum, v) => sum + (v ? 1 : 0), 0), difference,
      status: difference.meanAbsoluteDelta <= PARITY_MEAN_ABSOLUTE_DELTA_LIMIT ? "pass" : "fail" });
  }
  if (!views.length) continue;
  const rationale = [
    `${variant.label}: ${manifest.input.grid ? `authored ${manifest.input.grid.cols}x${manifest.input.grid.rows} grid` : `authored mesh (${manifest.input.scenePath})`} -> ${manifest.input.polygonCount} polygons -> ${views.length} views.`,
    "FED = sent to SDXL. NOT FED = we render it, the model never sees it.",
    "1 glyphcss SEMANTIC - your authored characters, real text with per-cell colour. NOT FED (no segmentation ControlNet offline).",
    "2 glyphcss visible - glyphcss's own shaded render. When the per-view report says authored-render, it seeds the FED base; otherwise it remains provenance only.",
    "3 depth - FED structural signal. Per-view min/max normalised, near = bright.",
    "4 named base - FED: the report distinguishes atlas-only, authored-render, and their blend. Ours, not generated.",
    "5 regenerate mask - FED, white = may repaint, black = locked. Ours, not generated.",
    "6 SDXL output - what the model produced.",
    "7 baked atlas reprojected to this view - the same image as the FED base, repeated beside the SDXL output so the scored comparison is visible. NOT FED as a separate signal.",
    `Parity is a CPU-only, covered-mask-only RGB comparison of the reprojected baked atlas against the SDXL output at the same camera. The atlas base defines coverage: flat rgb(128,128,128) pad pixels with maximum channel delta at most ${COVERED_MASK_BACKGROUND_DELTA} are excluded. SDXL's 512px output is cubically resampled to the atlas base's native raster; there is no browser render or camera fitting. A pixel changes when any RGB channel differs by more than ${PIXEL_CHANGE_DELTA}/255. A view passes only when masked mean absolute RGB delta is at most ${PARITY_MEAN_ABSOLUTE_DELTA_LIMIT}/255.`,
    "CIRCULARITY CAVEAT: the atlas base is itself the img2img input for that view. Low denoise strength therefore makes the SDXL output partly resemble the input by construction, so this measures multi-view consistency of the bake rather than independent generation quality.",
  ].join("  ·  ");
  const frames = views.map((view) => ({
    status: view.status, frame: view.frame, label: view.title,
    difference: view.difference,
    tiles: [{ kind: "ascii", ...view.semantic }, ...view.images],
    images: view.images,
  }));
  const summary = summarize(frames);
  domains.push({ id: variant.id, label: variant.label, isolation: "render-pass",
    qualification: variant.isLive ? "target" : "context", failed: summary.total - summary.passed, rationale });
  byDomain[variant.id] = {
    summary,
    note: { isTarget: variant.isLive, rationale },
    frames,
  };
}

// This calibration is deliberately a separate context domain: Hunyuan paints a
// mesh from an image, whereas the cabin domain evaluates SDXL's atlas reprojection.
// The one current result is always the evidence in latest/. Do not rank the entire
// review tree: doing that let old root/attempt artifacts silently replace the latest
// condition image and diagnostics in this Oven.
const hunyuanDir = resolve(root, "review/hunyuan3d", sceneKey);
const hunyuanLatestDir = resolve(hunyuanDir, "latest");
const hunyuanFiles = await filesUnder(hunyuanDir);
const hunyuanTileSpecs = [
  ["conditioning-rgba.png", "CONDITION IMAGE — FED to Hunyuan3D-Paint"],
  ["cabin-hunyuan3d-paint-albedo.png", "ALBEDO — produced by Hunyuan3D-Paint"],
  ["uv-islands-over-texture.png", "UV-ISLANDS-OVER-TEXTURE diagnostic"],
  ["polycss-side-by-side.png", "PolyCSS side-by-side render — Hunyuan left, SDXL atlas right"],
];

async function hunyuanEvidenceTiles(dir, context, missing) {
  const files = await filesUnder(dir);
  const tiles = [];
  const absent = [];
  for (const [name, label] of hunyuanTileSpecs) {
    const path = firstMatchingFile(files, [name]);
    if (!path) {
      absent.push(name);
      missing.push(`${context}: ${name} MISSING — omitted; no substitute was selected.`);
      continue;
    }
    tiles.push(await pngThumb(path, label));
  }
  return { tiles: tiles.filter(Boolean), absent };
}

function unscoredHunyuanFrame(frame, label, tiles) {
  // FrameCard requires a difference shape for layout, but this is deliberately
  // unscored: zero pixels and the explicit status prevent it from becoming a
  // fabricated Hunyuan parity result.
  return {
    status: "unscored",
    frame,
    label,
    difference: { totalPixels: 0, changedPixels: 0, ratio: 0, meanAbsoluteDelta: 0, maximumAbsoluteDelta: 0, unscored: true },
    tiles,
    images: tiles,
  };
}

const hunyuanFrames = [];
const hunyuanMissing = [];
if (await exists(hunyuanLatestDir)) {
  const latest = await hunyuanEvidenceTiles(hunyuanLatestDir, "LATEST RUN", hunyuanMissing);
  if (latest.tiles.length) {
    const suffix = latest.absent.length ? ` — missing: ${latest.absent.join(", ")}` : "";
    hunyuanFrames.push(unscoredHunyuanFrame(0, `LATEST run — unscored diagnostic evidence${suffix}`, latest.tiles));
  }
} else {
  hunyuanMissing.push("LATEST RUN DIRECTORY MISSING: review/hunyuan3d/cabin/latest/ was not found; no older artifact was promoted in its place.");
}

// Attempts are intentionally retained as context, never promoted to the current
// result. Discover their directories dynamically so future cleanup or additions do
// not make this builder fail; missing latest-only diagnostics are stated on each card.
const attemptsDir = resolve(hunyuanDir, "attempts");
if (await exists(attemptsDir)) {
  const attempts = (await readdir(attemptsDir, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
  for (const attempt of attempts) {
    const evidence = await hunyuanEvidenceTiles(resolve(attemptsDir, attempt), `OLDER ATTEMPT ${attempt}`, hunyuanMissing);
    if (!evidence.tiles.length) continue;
    const suffix = evidence.absent.length ? ` — missing: ${evidence.absent.join(", ")}` : "";
    hunyuanFrames.push(unscoredHunyuanFrame(hunyuanFrames.length, `OLDER ATTEMPT context — ${attempt}${suffix}`, evidence.tiles));
  }
}

if (hunyuanFiles.length) {
  const latestNote = await exists(hunyuanLatestDir)
    ? "Current evidence is read only from review/hunyuan3d/cabin/latest/; attempts remain clearly labelled context and cannot replace it."
    : "LATEST RUN DIRECTORY MISSING: no historical root or attempt artifact was substituted for it.";
  const attemptsNote = await exists(attemptsDir)
    ? "Older entries discovered under review/hunyuan3d/cabin/attempts/ are retained as explicitly labelled, unscored context."
    : "OLDER ATTEMPTS DIRECTORY MISSING: there is no retained attempt context to show.";
  const rationale = [
    "Hunyuan3D-Paint calibration — IMAGE-CONDITIONED mesh texturing, shown as context rather than a qualified parity target.",
    "Hunyuan3D-Paint is IMAGE-CONDITIONED: it reproduces the reference. Early runs used a whole-scene lawn-dominated reference and produced a green texture; the model did what it was told.",
    "The larger fixed error was texturing the WRONG MESH: the old extractor selected the 24x18 m ground plane and dropped the gable roof (maximum height 3.0 m versus the cabin ridge at 5.7 m), so every run painted a slab. extract-cabin-object.py now selects by material and asserts a building-sized result with a ridge.",
    "UV mapping is NOT broken: Hunyuan generates the mesh UVs and texture together, and they are self-consistent. The islands span u/v 0..1 and cover 76% of the 2048 map. The failure is CONTENT: the albedo hallucinates interior objects (a typewriter and shelving) instead of cabin exterior, while the unwrap scatters 92 triangles into small charts across that collage, so each face samples an unrelated fragment.",
    "This domain remains UNSCORED. Do not infer or reuse cabin's parity threshold: cabin compares a reprojected atlas against the SDXL view it came from and is partly circular; Hunyuan has no equivalent per-view target.",
    "Metric tiles intentionally show 0/0 because no Hunyuan frames are metric samples; each frame card is explicitly marked unscored.",
    latestNote,
    attemptsNote,
    ...hunyuanMissing,
  ].join("  ·  ");
  const domainId = "hunyuan3d-paint";
  domains.push({ id: domainId, label: "Hunyuan3D-Paint cabin", isolation: "render-pass", qualification: "context", failed: 0, rationale });
  byDomain[domainId] = {
    summary: { passed: 0, total: 0, ratio: 0, meanAbsoluteDelta: 0, maximumAbsoluteDelta: 0, unscoredFrames: hunyuanFrames.length },
    note: { isTarget: false, rationale },
    frames: hunyuanFrames,
  };
}

const targetDomain = domains.find((domain) => domain.qualification === "target");
if (!targetDomain) throw new Error(`No renderable live run found for "${sceneKey}"`);
const targetFrames = byDomain[targetDomain.id].frames;
console.log(JSON.stringify({
  parityMaskedDeltas: targetFrames.map((frame) => ({
    frame: frame.frame,
    maskedMeanAbsoluteDelta: frame.difference.meanAbsoluteDelta,
    changedPixels: frame.difference.changedPixels,
    maskedPixels: frame.difference.totalPixels,
  })),
}));

const payload = {
  schema: "burnlist-visual-parity-data@1",
  initialDomainId: domains[0].id,
  domains,
  verdict: { targetPass: targetFrames.every((frame) => frame.status === "pass"), framesCount: targetFrames.length, error: "" },
  byDomain,
  comparisons: [],
};

await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, JSON.stringify(payload), "utf8");
console.log(JSON.stringify({ payload: outPath, domains: domains.map((d) => d.id), frames: targetFrames.length, tilesPerFrame: targetFrames[0]?.tiles.length ?? 0, megabytes: +((await readFile(outPath)).length / 1048576).toFixed(1) }));
