import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createCanvas } from "@napi-rs/canvas";
import { buildNodeTextureSamplerBundle, loadMeshFromFile } from "@glyphcss/compile";
import { buildGlyphControlFrame, computeGlyphControlContentSha256, computeGlyphControlGeometryHashes, createGlyphOrthographicCamera } from "glyphcss";

const root = resolve(import.meta.dirname, "..");
const repositoryRoot = resolve(root, "..", "..");
const sha = (value) => createHash("sha256").update(value).digest("hex");
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const canonical = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).filter((key) => key !== "contentSha256").sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
};

const DEFAULT_SUBJECTS = Object.freeze([
  { key: "cottage", assetId: "asset/a0a3b6ef57a641663445d4481ad359e479d69ccfa5ebab6bec58f7bfd171339e", path: "website/public/gallery/obj/cottage.obj", classId: 7, materials: ["cottage_texture"] },
  { key: "frog", assetId: "asset/8b66dc7c28ae0a64d146ee8e5ee82ece7202e8b0d70a715c2d3995fe739df687", path: "website/public/gallery/obj/opengameart/frog-guy/frog.obj", classId: 2, materials: ["frog"] },
  { key: "chicken", assetId: "asset/72c3d86fe7803f6cd8a7ae3e04ea63593ae644879a5d417261e2d5d5bb12c9ff", path: "website/public/gallery/obj/chicken.obj", classId: 2, materials: ["FF9800", "FFFFFF", "1A1A1A", "F44336", "455A64"] },
]);

const DEFAULT_VIEWS = Object.freeze([
  ...Array.from({ length: 12 }, (_, index) => ({ id: `orbit-${String(index).padStart(3, "0")}`, rotX: 61, rotY: index * 30 })),
  { id: "top", rotX: 15, rotY: 0 },
  { id: "bottom", rotX: 105, rotY: 0 },
]);

const DEFAULT_CONFIG = Object.freeze({
  schemaVersion: "glyph-spray-pass/v1",
  grid: { cols: 256, rows: 128, cellAspect: 2 },
  supersample: 1,
  framing: { margin: 0.05 },
  dictionary: "config/asset-object-dictionary.json",
  views: DEFAULT_VIEWS,
  lighting: {
    directional: { direction: [0.5, 0.7, 0.5], intensity: 1, color: "#ffffff" },
    ambient: { intensity: 0.4, color: "#ffffff" },
  },
  subjects: DEFAULT_SUBJECTS,
});

function bytesHash(view) {
  return sha(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
}

function cameraMetadata(camera) {
  return {
    kind: camera.kind, rotX: camera.rotX, rotY: camera.rotY, center: [...camera.center],
    mat: camera.mat ? [...camera.mat] : null, useMat: camera.useMat, distance: camera.distance,
    perspective: camera.perspective, zoom: camera.zoom, stretch: camera.stretch,
    fovScale: camera.fovScale, target: [...camera.target], eyeMode: camera.eyeMode,
  };
}

function boundsFor(polygons) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const polygon of polygons) for (const vertex of polygon.vertices) for (let axis = 0; axis < 3; axis++) {
    min[axis] = Math.min(min[axis], vertex[axis]);
    max[axis] = Math.max(max[axis], vertex[axis]);
  }
  const center = min.map((value, axis) => (value + max[axis]) / 2);
  const radius = Math.hypot(...max.map((value, axis) => value - min[axis])) / 2;
  if (!(radius > 0 && Number.isFinite(radius))) throw new Error("SPRAY_CLOSED_LOOP_ASSET_EMPTY_OR_DEGENERATE");
  return { center };
}

/** This intentionally mirrors W3's orthographic projected-bounds camera fit. */
export function fitSprayClosedLoopCamera(polygons, grid, view, margin = 0.05) {
  const { center } = boundsFor(polygons);
  const usable = 1 - margin * 2;
  const fitted = createGlyphOrthographicCamera({ rotX: view.rotX, rotY: view.rotY, zoom: 1, target: center, center: [0, 0] });
  const projected = polygons.flatMap((polygon) => polygon.vertices.map((vertex) => fitted.project(vertex, grid.cols, grid.rows, grid.cellAspect)));
  const minCol = Math.min(...projected.map((point) => point[0]));
  const maxCol = Math.max(...projected.map((point) => point[0]));
  const minRow = Math.min(...projected.map((point) => point[1]));
  const maxRow = Math.max(...projected.map((point) => point[1]));
  const spanCols = maxCol - minCol, spanRows = maxRow - minRow;
  if (!(spanCols > 0 && spanRows > 0 && [minCol, maxCol, minRow, maxRow].every(Number.isFinite))) {
    throw new Error("SPRAY_CLOSED_LOOP_PROJECTED_BOUNDS_INVALID");
  }
  fitted.zoom = Math.min(grid.cols * usable / spanCols, grid.rows * usable / spanRows);
  fitted.center = [
    0.5 - ((minCol + maxCol) / 2) * fitted.zoom / grid.cols,
    0.5 - ((minRow + maxRow) / 2) * fitted.zoom / grid.rows,
  ];
  return fitted;
}

// Match W3's geometry scene construction: only the real mesh owns surfaces;
// the second instance preserves the corpus-control scene shape for provenance.
function sceneFor(subject, polygons, dictionary, syntheticOccluderClassId) {
  const instanceId = `instance/${subject.assetId.slice("asset/".length)}`;
  const surfaces = polygons.map((_, index) => ({ id: `${instanceId}/surface-${index}`, instanceId }));
  const hashes = computeGlyphControlGeometryHashes(polygons);
  const raw = {
    schemaVersion: "control-scene/v1", id: `scene/${subject.assetId.slice("asset/".length)}`,
    dictionaryId: dictionary.id, dictionarySha256: dictionary.contentSha256, ...hashes,
    instances: [{ id: instanceId, classId: subject.classId }, { id: `${instanceId}/occluder`, classId: syntheticOccluderClassId }],
    surfaces, polygonSurfaceIds: surfaces.map((surface) => surface.id),
  };
  return { ...raw, contentSha256: computeGlyphControlContentSha256(raw) };
}

function stableFrameId(index) {
  return `frame-${String(index).padStart(3, "0")}`;
}

function normalizeSubjects(config) {
  const raw = config.subjects ?? DEFAULT_SUBJECTS;
  const subjects = Array.isArray(raw) ? raw : Object.entries(raw).map(([key, value]) => ({ key, ...value }));
  if (!subjects.length || new Set(subjects.map((subject) => subject.key)).size !== subjects.length) throw new Error("SPRAY_CLOSED_LOOP_SUBJECTS_INVALID");
  return subjects.map((candidate) => {
    const fallback = DEFAULT_SUBJECTS.find((subject) => subject.key === candidate?.key);
    const subject = fallback ? { ...fallback, ...candidate } : candidate;
    if (!subject || typeof subject.key !== "string" || !/^[a-z0-9_-]+$/.test(subject.key)
      || typeof subject.assetId !== "string" || !subject.assetId.startsWith("asset/")
      || typeof subject.path !== "string" || !Number.isInteger(subject.classId) || subject.classId < 1
      || !Array.isArray(subject.materials) || !subject.materials.length || subject.materials.some((name) => typeof name !== "string" || !name)) {
      throw new Error("SPRAY_CLOSED_LOOP_SUBJECT_INVALID");
    }
    return { key: subject.key, assetId: subject.assetId, path: subject.path, classId: subject.classId, materials: [...subject.materials] };
  });
}

function normalizeViews(config) {
  const schedule = config.views ?? config.viewSchedule ?? config.schedule?.views;
  const raw = Array.isArray(schedule) ? schedule : schedule?.views ?? DEFAULT_VIEWS;
  if (!Array.isArray(raw) || !raw.length) throw new Error("SPRAY_CLOSED_LOOP_SCHEDULE_INVALID");
  const views = raw.map((view, index) => ({ id: view?.id ?? stableFrameId(index), rotX: view?.rotX, rotY: view?.rotY }));
  if (new Set(views.map((view) => view.id)).size !== views.length
    || views.some((view) => typeof view.id !== "string" || !/^[a-z0-9._-]+$/.test(view.id) || !Number.isFinite(view.rotX) || !Number.isFinite(view.rotY))) {
    throw new Error("SPRAY_CLOSED_LOOP_SCHEDULE_INVALID");
  }
  return views;
}

function normalizeConfig(value) {
  const config = { ...DEFAULT_CONFIG, ...value };
  const grid = config.grid;
  if (config.schemaVersion !== "glyph-spray-pass/v1" || config.supersample !== 1
    || !grid || grid.cols !== 256 || grid.rows !== 128 || grid.cellAspect !== 2
    || !(config.framing?.margin >= 0 && config.framing.margin < 0.5)
    || !config.lighting?.directional || !config.lighting?.ambient) throw new Error("SPRAY_CLOSED_LOOP_CONFIG_INVALID");
  return { ...config, subjects: normalizeSubjects(config), views: normalizeViews(config) };
}

async function loadConfig(configPath, explicit) {
  try {
    return normalizeConfig(JSON.parse(await readFile(configPath, "utf8")));
  } catch (error) {
    if (!explicit && error?.code === "ENOENT") return normalizeConfig(DEFAULT_CONFIG);
    throw error;
  }
}

function configPath(rootRelativePath) {
  return resolve(root, rootRelativePath);
}

async function exists(path) {
  try { await access(path); return true; } catch { return false; }
}

async function bakedTexturePaths(sprayRoot, subject) {
  const out = [];
  for (let index = 0; index < subject.materials.length; index++) {
    const material = subject.materials[index];
    // W1 names pages texture-N.png. Accept W2's historical plural directory
    // too, while preferring the W5 contract's singular `texture` directory.
    const candidates = [
      join(sprayRoot, "subjects", subject.key, "texture", `texture-${index}.png`),
      join(sprayRoot, "subjects", subject.key, "texture", `texture-${material}.png`),
      join(sprayRoot, "subjects", subject.key, "textures", `texture-${index}.png`),
      join(sprayRoot, "subjects", subject.key, "textures", `texture-${material}.png`),
    ];
    const path = await (async () => {
      for (const candidate of candidates) if (await exists(candidate)) return candidate;
      return null;
    })();
    if (!path) throw new Error(`SPRAY_CLOSED_LOOP_BAKED_TEXTURE_MISSING: ${subject.key}/${material}; tried ${candidates.join(", ")}`);
    out.push(path);
  }
  return out;
}

function packedRgbStats(frame) {
  let coveredCells = 0, redDominantCells = 0, sumR = 0, sumG = 0, sumB = 0;
  for (let index = 0; index < frame.coverage.length; index++) {
    if (!frame.coverage[index]) continue;
    const color = frame.albedoRgb[index];
    const r = color >>> 16, g = (color >>> 8) & 0xff, b = color & 0xff;
    coveredCells++;
    sumR += r; sumG += g; sumB += b;
    if (r > g && r > b) redDominantCells++;
  }
  return {
    coveredCells,
    redDominantCells,
    averageRgb: coveredCells ? [sumR / coveredCells, sumG / coveredCells, sumB / coveredCells].map((value) => Number(value.toFixed(4))) : [0, 0, 0],
  };
}

function glyphRenderPng(frame) {
  const cellWidth = 8, cellHeight = 16;
  const canvas = createCanvas(frame.metadata.cols * cellWidth, frame.metadata.rows * cellHeight);
  const context = canvas.getContext("2d");
  context.fillStyle = "#101010";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.font = `${cellHeight}px monospace`;
  context.textBaseline = "top";
  const lines = frame.visibleAscii.split("\n");
  for (let row = 0; row < frame.metadata.rows; row++) {
    const characters = Array.from(lines[row] ?? "");
    for (let col = 0; col < frame.metadata.cols; col++) {
      const glyph = characters[col] ?? " ";
      if (glyph === " ") continue;
      const color = frame.visibleColor[row * frame.metadata.cols + col] & 0xffffff;
      context.fillStyle = `#${color.toString(16).padStart(6, "0")}`;
      context.fillText(glyph, col * cellWidth, row * cellHeight);
    }
  }
  return canvas.toBuffer("image/png");
}

function subjectManifest(subject, config, textureFiles, frames) {
  const raw = {
    schemaVersion: "glyph-spray-closed-loop/v1",
    disposition: "proof-only-not-admissible",
    renderer: "glyphcss buildGlyphControlFrame solid rasterizer; no diffusion invocation",
    subject: { key: subject.key, assetId: subject.assetId, path: subject.path, classId: subject.classId, materials: subject.materials },
    grid: config.grid,
    supersample: config.supersample,
    inputTextures: textureFiles.map((file, index) => ({ material: subject.materials[index], path: file.path, sha256: file.sha256 })),
    views: frames.map((entry, index) => ({
      id: stableFrameId(index), scheduleId: config.views[index].id, camera: entry.camera,
      visibleAscii: entry.visibleAscii, texturedRender: entry.texturedRender,
      visibleAsciiSha256: entry.visibleAscii.sha256,
      visibleColorSha256: entry.visibleColorSha256,
      albedoRgbSha256: entry.albedoRgbSha256,
      targetRgbSha256: entry.targetRgbSha256,
      albedo: entry.albedo,
    })),
  };
  return { ...raw, contentSha256: sha(canonical(raw)) };
}

export async function renderSprayClosedLoop(configOrOptions = {}, options = {}) {
  const requested = typeof configOrOptions === "string" ? { ...options, configPath: configOrOptions } : configOrOptions;
  const {
    configPath: requestedConfigPath = "config/spray-pass.json",
    sprayRoot: requestedSprayRoot = "review/spray-pass",
    outRoot: requestedOutRoot = "review/spray-pass/closed-loop",
    subjects: selectedKeys = null,
  } = requested;
  const config = await loadConfig(configPath(requestedConfigPath), requestedConfigPath !== "config/spray-pass.json");
  const dictionary = JSON.parse(await readFile(configPath(config.dictionary), "utf8"));
  const sprayRoot = resolve(requestedSprayRoot);
  const output = resolve(requestedOutRoot);
  const selected = selectedKeys === null ? config.subjects : config.subjects.filter((subject) => selectedKeys.includes(subject.key));
  if (!selected.length || (selectedKeys !== null && (new Set(selectedKeys).size !== selectedKeys.length || selected.length !== selectedKeys.length))) {
    throw new Error("SPRAY_CLOSED_LOOP_SUBJECT_SELECTION_INVALID");
  }
  const rendered = [];
  const skipped = [];
  // A subject whose spray pass observed zero texels has no painted texture to close
  // the loop with. The chicken is exactly that: its unresolvable Chicken_01.mtl means
  // glyphcss surfaces no authored UVs, so nothing was ever back-projected and only 1
  // of its 5 materials can bind a sampler. Declare that as a recorded outcome instead
  // of throwing - but keep it an explicit precondition, never a blanket catch that
  // could swallow a genuine rendering bug.
  const sprayReportPath = resolve(root, "reports/spray-pass.json");
  let sprayObserved = new Map();
  try {
    const sprayReport = JSON.parse(await readFile(sprayReportPath, "utf8"));
    sprayObserved = new Map(sprayReport.subjects.map((entry) => [entry.key, entry.beforeFill?.observedTexels ?? null]));
  } catch {
    sprayObserved = new Map();
  }
  for (const subject of selected) {
    const observed = sprayObserved.get(subject.key);
    if (observed === 0) {
      skipped.push({
        key: subject.key,
        status: "not-renderable",
        reason: "spray pass observed zero texels: no authored UVs, so there is no baked texture to render",
        observedTexels: 0,
      });
      continue;
    }
    const source = resolve(repositoryRoot, subject.path);
    const texturePaths = await bakedTexturePaths(sprayRoot, subject);
    const textureFiles = await Promise.all(texturePaths.map(async (path) => ({ path, sha256: sha(await readFile(path)) })));
    // Pass the baked page as the OBJ material texture *before* its normal mesh
    // optimization runs. This keeps the renderer's own texture-bearing polygon
    // construction and never builds a sampler for the source artwork.
    const loaded = await loadMeshFromFile(source, {
      preserveTextures: true,
      solidTextureSamples: false,
      objOptions: { materialTextures: Object.fromEntries(subject.materials.map((material, index) => [material, texturePaths[index]])) },
    });
    try {
      const syntheticOccluder = dictionary.classes?.find((entry) => entry.name === "synthetic-occluder");
      if (!syntheticOccluder) throw new Error("SPRAY_CLOSED_LOOP_SYNTHETIC_OCCLUDER_CLASS_REQUIRED");
      const polygons = loaded.polygons;
      // `preserveTextures` materializes Node-readable files to content-addressed
      // glyph-node-texture handles. Their digest is the baked PNG source-byte
      // digest recorded below, so this also proves no original texture handle
      // can enter the sampler bundle.
      const expectedTextureRefs = new Set(textureFiles.map((file) => `glyph-node-texture://${file.sha256}`));
      const renderTextureRefs = new Set(polygons.map((polygon) => polygon.material?.texture ?? polygon.texture).filter(Boolean));
      if (renderTextureRefs.size !== expectedTextureRefs.size || [...expectedTextureRefs].some((path) => !renderTextureRefs.has(path))) {
        throw new Error("SPRAY_CLOSED_LOOP_BAKED_TEXTURE_BINDING_INCOMPLETE");
      }
      const textureSamplers = (await buildNodeTextureSamplerBundle(polygons)).samplers;
      if (textureSamplers.size !== texturePaths.length) throw new Error(`SPRAY_CLOSED_LOOP_TEXTURE_SAMPLER_INCOMPLETE: ${textureSamplers.size}/${texturePaths.length}`);
      const scene = sceneFor(subject, polygons, dictionary, syntheticOccluder.id);
      const frames = [];
      for (let index = 0; index < config.views.length; index++) {
        const camera = fitSprayClosedLoopCamera(polygons, config.grid, config.views[index], config.framing.margin);
        const frame = buildGlyphControlFrame({
          polygons, scene, dictionary, camera, grid: config.grid, doubleSided: true, supersample: config.supersample, textureSamplers,
          directionalLight: config.lighting.directional, ambientLight: config.lighting.ambient, shadow: config.lighting.shadow,
          castShadowFlags: polygons.map(() => false), receiveShadowFlags: polygons.map(() => true),
        });
        const subjectOutput = join(output, subject.key);
        const asciiPath = join(subjectOutput, "ascii", `${stableFrameId(index)}.txt`);
        const renderPath = join(subjectOutput, "renders", `${stableFrameId(index)}.png`);
        const [asciiBytes, pngBytes] = [Buffer.from(frame.visibleAscii, "utf8"), glyphRenderPng(frame)];
        await mkdir(dirname(asciiPath), { recursive: true });
        await mkdir(dirname(renderPath), { recursive: true });
        await Promise.all([writeFile(asciiPath, asciiBytes), writeFile(renderPath, pngBytes)]);
        frames.push({
          camera: cameraMetadata(camera),
          visibleAscii: { path: `ascii/${stableFrameId(index)}.txt`, sha256: sha(asciiBytes) },
          texturedRender: { path: `renders/${stableFrameId(index)}.png`, sha256: sha(pngBytes), width: frame.metadata.cols * 8, height: frame.metadata.rows * 16 },
          visibleColorSha256: bytesHash(frame.visibleColor), albedoRgbSha256: bytesHash(frame.albedoRgb), targetRgbSha256: bytesHash(frame.targetRgb),
          albedo: packedRgbStats(frame),
        });
      }
      const manifest = subjectManifest(subject, config, textureFiles, frames);
      const manifestPath = join(output, subject.key, "manifest.json");
      await mkdir(dirname(manifestPath), { recursive: true });
      await writeFile(manifestPath, json(manifest));
      rendered.push({ subject: subject.key, manifestPath, contentSha256: manifest.contentSha256, inputTextures: manifest.inputTextures, views: manifest.views });
    } finally {
      loaded.dispose();
    }
  }
  return { outRoot: output, rendered, skipped };
}

/** A self-contained Mac/Node proof that a baked page, not source art, is sampled. */
export async function verifySprayClosedLoopSolidRed() {
  const temporary = await mkdtemp(join(tmpdir(), "glyphcss-spray-closed-loop-"));
  try {
    const texturePath = join(temporary, "subjects", "cottage", "texture", "texture-0.png");
    await mkdir(dirname(texturePath), { recursive: true });
    const red = createCanvas(4, 4);
    const context = red.getContext("2d");
    context.fillStyle = "#ff0000";
    context.fillRect(0, 0, 4, 4);
    await writeFile(texturePath, red.toBuffer("image/png"));
    const result = await renderSprayClosedLoop({ sprayRoot: temporary, outRoot: join(temporary, "closed-loop"), subjects: ["cottage"] });
    const first = result.rendered[0]?.views[0]?.albedo;
    assert.ok(first?.coveredCells > 0, "solid-red verification rendered no covered cells");
    assert.equal(first.redDominantCells, first.coveredCells, "solid-red baked page did not dominate every rendered albedo cell");
    assert.ok(first.averageRgb[0] > 240 && first.averageRgb[1] < 1 && first.averageRgb[2] < 1, `solid-red albedo was not sampled: ${first.averageRgb.join(",")}`);
    return { inputTextureSha256: sha(await readFile(texturePath)), firstViewAlbedo: first, assertion: "all covered albedo cells are red-dominant and average RGB is red" };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

function parseArgs() {
  const values = process.argv.slice(2);
  const readValue = (flag) => {
    const index = values.indexOf(flag);
    if (index < 0) return null;
    if (!values[index + 1]) throw new Error(`SPRAY_CLOSED_LOOP_${flag.slice(2).replaceAll("-", "_").toUpperCase()}_REQUIRED`);
    return values[index + 1];
  };
  const one = readValue("--subject"), many = readValue("--subjects");
  if (one && many) throw new Error("SPRAY_CLOSED_LOOP_SUBJECT_SELECTION_INVALID");
  return {
    verifySolidRed: values.includes("--verify-solid-red"),
    configPath: readValue("--config") ?? "config/spray-pass.json",
    sprayRoot: readValue("--spray-root") ?? "review/spray-pass",
    outRoot: readValue("--out-root") ?? "review/spray-pass/closed-loop",
    subjects: one ? [one] : many ? many.split(",").filter(Boolean) : null,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = parseArgs();
  process.stdout.write(json(args.verifySolidRed ? await verifySprayClosedLoopSolidRed() : await renderSprayClosedLoop(args)));
}
