import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { cubePolygons } from "@glyphcss/core";
import {
  buildGlyphControlFrame,
  computeGlyphControlContentSha256,
  computeGlyphControlGeometryHashes,
  createGlyphOrthographicCamera,
  packGlyphControlTensor,
  reprojectGlyphSurfaceAtlas,
} from "glyphcss";
import { writeGlyphControlMaps } from "@glyphcss/compile";
import { stableControlBytes } from "./stable-control-bytes.mjs";

const here = resolve(dirname(new URL(import.meta.url).pathname), "..");
const GENERATOR_VERSION = "glyph-control-corpus-generator/v2";
const sha = (value) => createHash("sha256").update(value).digest("hex");
const canonical = (value) => value === null || typeof value !== "object"
  ? JSON.stringify(value)
  : Array.isArray(value)
    ? `[${value.map(canonical).join(",")}]`
    : `{${Object.keys(value).filter((key) => key !== "contentSha256").sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
const digest = (value) => sha(canonical(value));
const seeded = (seed) => {
  let state = Number.parseInt(sha(seed).slice(0, 8), 16) >>> 0;
  return () => ((state = (state * 1664525 + 1013904223) >>> 0) / 0x100000000);
};
const json = async (path) => JSON.parse(await readFile(path, "utf8"));
const writeJson = async (path, value) => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
};

function splitAssignments(config) {
  const assignments = new Map();
  for (const split of ["train", "validation", "test"]) {
    for (const seed of config.splits[split] ?? []) {
      if (!config.sceneSeeds.includes(seed)) throw new Error(`split references unknown scene seed ${seed}`);
      if (assignments.has(seed)) throw new Error(`scene seed ${seed} leaks across ${assignments.get(seed)} and ${split}`);
      assignments.set(seed, split);
    }
  }
  for (const seed of config.sceneSeeds) if (!assignments.has(seed)) throw new Error(`scene seed ${seed} has no split`);
  if (assignments.size !== new Set(config.sceneSeeds).size || assignments.size !== config.sceneSeeds.length) throw new Error("duplicate scene seeds are forbidden");
  return assignments;
}

function transformCube(polygons, center, angle, scale) {
  const radians = angle * Math.PI / 180, c = Math.cos(radians), s = Math.sin(radians);
  return polygons.map((polygon) => ({
    ...polygon,
    vertices: polygon.vertices.map(([x, y, z]) => {
      const dx = x - center[0], dy = y - center[1];
      return [center[0] + (dx * c - dy * s) * scale, center[1] + (dx * s + dy * c) * scale, center[2] + (z - center[2]) * scale];
    }),
    uvs: [[0, 0], [1, 0], [1, 1], [0, 1]],
  }));
}

function floorTile(center, size, color) {
  const [x, y, z] = center, h = size / 2;
  return {
    vertices: [[x - h, y - h, z], [x + h, y - h, z], [x + h, y + h, z], [x - h, y + h, z]],
    uvs: [[0, 0], [1, 0], [1, 1], [0, 1]],
    color,
  };
}

function sceneFor(seed, dictionary, seedIndex, backgroundOverride) {
  const random = seeded(seed);
  const cubeCount = 2 + seedIndex % 2;
  const floorCount = 1 + (seedIndex + 1) % 2;
  const polygons = [], instances = [], surfaces = [], polygonSurfaceIds = [];
  const id = `scene/corpus-${sha(seed).slice(0, 12)}`;
  for (let index = 0; index < cubeCount; index++) {
    const center = [-.75 + index * .72 + random() * .12, -.18 + index * .11, .42 + random() * .18];
    const size = .58 + random() * .25, pose = -18 + random() * 36, scale = .82 + random() * .36;
    const cube = transformCube(cubePolygons({ center, size, color: ["#d6a83d", "#6ca0dc", "#bd6bd6"][index] }), center, pose, scale);
    const instanceId = `${id}/cube-${index}`;
    instances.push({ id: instanceId, classId: 1 });
    for (let surfaceIndex = 0; surfaceIndex < cube.length; surfaceIndex++) {
      const surfaceId = `${instanceId}/surface-${surfaceIndex}`;
      surfaces.push({ id: surfaceId, instanceId }); polygonSurfaceIds.push(surfaceId);
    }
    polygons.push(...cube);
  }
  const backgroundColor = backgroundOverride?.color ?? (seedIndex % 2 ? "#253653" : "#374151");
  const backgroundSize = 1.55 + (backgroundOverride?.sizeDelta ?? 0);
  for (let index = 0; index < floorCount; index++) {
    const instanceId = `${id}/floor-${index}`, surfaceId = `${instanceId}/surface-0`;
    instances.push({ id: instanceId, classId: 2 }); surfaces.push({ id: surfaceId, instanceId }); polygonSurfaceIds.push(surfaceId);
    polygons.push(floorTile([-.75 + index * 1.5, 0, -.03 - index * .01], backgroundSize, backgroundColor));
  }
  const hashes = computeGlyphControlGeometryHashes(polygons);
  const raw = { schemaVersion: "control-scene/v1", id, dictionaryId: dictionary.id, dictionarySha256: dictionary.contentSha256, ...hashes, instances, surfaces, polygonSurfaceIds };
  return { polygons, scene: { ...raw, contentSha256: computeGlyphControlContentSha256(raw) }, shape: { cubeCount, floorCount, backgroundColor } };
}

const trajectoryKinds = ["slow", "fast", "occlusion-swap", "reveal", "reset"];
const REFERENCE_GRID = Object.freeze({ cols: 80, rows: 24, cellAspect: 2 });
const B7_PATH_BASELINE = Object.freeze({ rotX: 61, rotY: 24 });

function cameraFor(kind, index, random) {
  const angles = {
    slow: [24, 30, 36],
    fast: [16, 68, 124],
    "occlusion-swap": [20, 78, 148],
    reveal: [12, 54, 102],
    reset: [28, 42, 58],
  }[kind];
  return createGlyphOrthographicCamera({
    rotX: kind === "reveal" ? 52 + index * 10 : 61,
    rotY: angles[index] + Math.round(random() * 2),
    zoom: kind === "reveal" ? 15 + index * 2 : 18,
    target: [0, 0, .22],
  });
}

function boundsFor(polygons) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const polygon of polygons) for (const vertex of polygon.vertices) for (let axis = 0; axis < 3; axis++) {
    min[axis] = Math.min(min[axis], vertex[axis]); max[axis] = Math.max(max[axis], vertex[axis]);
  }
  if (!Number.isFinite(min[0])) throw new Error("cannot frame an empty control scene");
  return { min, max, center: min.map((value, axis) => (value + max[axis]) / 2), radius: Math.hypot(...max.map((value, axis) => value - min[axis])) / 2 };
}

/**
 * Frames a world-space bounding sphere, not rendered coverage. The sphere makes
 * the result invariant to the later trajectory rotation; the fixed margin was
 * selected as a source contract, independently of downstream measurements.
 */
export function fitReferenceCamera(polygons, grid, framing) {
  if (!framing || framing.rule !== "world-bounds-sphere/v1") throw new Error("reference framing requires world-bounds-sphere/v1");
  if (grid.cols !== REFERENCE_GRID.cols || grid.rows !== REFERENCE_GRID.rows || grid.cellAspect !== REFERENCE_GRID.cellAspect) throw new Error("reference framing requires glyphcss public 80x24 grid");
  if (!(framing.margin > 0 && framing.margin < .5)) throw new Error("reference framing margin must be in (0, .5)");
  if (!framing.baseline || !Number.isFinite(framing.baseline.rotX) || !Number.isFinite(framing.baseline.rotY) || !(framing.baseline.zoom > 0)) {
    throw new Error("reference framing requires a finite positive declared camera baseline");
  }
  const bounds = boundsFor(polygons);
  if (!(bounds.radius > 0)) throw new Error("reference framing requires non-degenerate world bounds");
  const usable = 1 - framing.margin * 2;
  // Glyphcss's headless projection metrics are 50/cellAspect × 50 CSS px.
  const zoom = Math.min(
    grid.cols * usable * (50 / grid.cellAspect) / (bounds.radius * 2),
    grid.rows * usable * 50 / (bounds.radius * 2),
  );
  return Object.freeze({
    rule: framing.rule,
    margin: framing.margin,
    bounds: Object.freeze({ min: Object.freeze([...bounds.min]), max: Object.freeze([...bounds.max]), center: Object.freeze([...bounds.center]), radius: bounds.radius }),
    zoom,
  });
}

export function framedCameraFor(kind, index, random, generated, grid, framing) {
  const original = cameraFor(kind, index, random);
  if (!framing) return original;
  const fitted = fitReferenceCamera(generated.polygons, grid, framing);
  // Preserve the authored path as a delta from the original B7 baseline.
  original.rotX = framing.baseline.rotX + (original.rotX - B7_PATH_BASELINE.rotX);
  original.rotY = framing.baseline.rotY + (original.rotY - B7_PATH_BASELINE.rotY);
  original.zoom = fitted.zoom * (original.zoom / framing.baseline.zoom);
  original.target = [...fitted.bounds.center];
  return original;
}

const expansions = [
  { id: "cool-dark", direction: [1, .45, .8], directionalIntensity: .55, ambientColor: "#0b1736", ambientIntensity: .12, palette: " .:-=+*#%@" },
  { id: "warm-bright", direction: [-.4, 1, .65], directionalIntensity: 1.1, ambientColor: "#3b1c08", ambientIntensity: .42, palette: " .:-=+*#%@" },
];

function rgb(frame) {
  const n = frame.coverage.length, out = new Float32Array(n * 3);
  for (let cell = 0; cell < n; cell++) {
    const value = frame.semanticColor[cell] >>> 0;
    out[cell * 3] = ((value >>> 16) & 255) / 255;
    out[cell * 3 + 1] = ((value >>> 8) & 255) / 255;
    out[cell * 3 + 2] = (value & 255) / 255;
  }
  return out;
}

const bytesHash = (value) => sha(stableControlBytes(value));
function prospectiveIdentity(frames, normalization, glyphOutput, trajectory, config) {
  const raw = {
    generatorVersion: GENERATOR_VERSION,
    glyphOutput,
    normalization,
    config: {
      grid: config.grid,
      framesPerTrajectory: config.framesPerTrajectory,
      expansionsPerScene: config.expansionsPerScene,
      cameraOffset: config.cameraOffset ?? 0,
    },
    trajectory,
    frames: frames.map((entry) => {
      const packed = packGlyphControlTensor(entry.frame, normalization, entry.temporal);
      return {
        id: entry.id,
        metadata: entry.frame.metadata,
        indexLookups: { instanceLookup: entry.frame.instanceLookup, surfaceLookup: entry.frame.surfaceLookup },
        visibleAsciiSha256: sha(entry.frame.visibleAscii),
        semanticAsciiSha256: sha(entry.frame.semanticAscii),
        visibleColorSha256: bytesHash(entry.frame.visibleColor),
        semanticColorSha256: bytesHash(entry.frame.semanticColor),
        coverageSha256: bytesHash(entry.frame.coverage),
        winnerPolygonSha256: bytesHash(entry.frame.winnerPolygon),
        classIdSha256: bytesHash(entry.frame.classId),
        instanceIdSha256: bytesHash(entry.frame.instanceId),
        surfaceIdSha256: bytesHash(entry.frame.surfaceId),
        depthSha256: bytesHash(entry.frame.depth),
        shadeSha256: bytesHash(entry.frame.shade),
        normalSha256: bytesHash(entry.frame.normal),
        worldPositionSha256: bytesHash(entry.frame.worldPosition),
        surfaceUvSha256: bytesHash(entry.frame.surfaceUv),
        tensorSpec: packed.spec,
        tensorKeyframeSha256: bytesHash(packed.keyframe),
        tensorTemporalSha256: packed.temporal ? bytesHash(packed.temporal) : null,
        temporal: entry.temporal ? {
          warpRgbSha256: bytesHash(entry.temporal.warpRgb),
          reprojectionValidSha256: bytesHash(entry.temporal.reprojectionValid),
          disocclusionSha256: bytesHash(entry.temporal.disocclusion),
          atlasConfidenceSha256: bytesHash(entry.temporal.atlasConfidence),
        } : null,
        transition: entry.transition ?? null,
      };
    }),
  };
  return { ...raw, contentSha256: digest(raw) };
}

function compactAscii(value) {
  return value.replace(/\n/g, "");
}

function classVisibleColorHash(frame, classId) {
  const colors = [];
  for (let cell = 0; cell < frame.coverage.length; cell++) if (frame.classId[cell] === classId) colors.push(frame.visibleColor[cell]);
  return digest(colors);
}

function classCellCount(frame, classId) {
  let count = 0;
  for (const value of frame.classId) if (value === classId) count++;
  return count;
}

function assertLineage(frame, dictionary) {
  const semantic = compactAscii(frame.semanticAscii);
  for (let cell = 0; cell < frame.coverage.length; cell++) {
    if (!frame.coverage[cell]) continue;
    const winner = frame.winnerPolygon[cell], surface = frame.surfaceLookup[frame.surfaceId[cell]], instance = frame.instanceLookup[frame.instanceId[cell]];
    if (winner < 0 || frame.metadata.scene.polygonSurfaceIds[winner] !== surface || !surface || !instance || !surface.startsWith(`${instance}/surface-`)) throw new Error("corpus lineage does not resolve winner → surface → instance");
    const entry = dictionary.classes.find((item) => item.id === frame.classId[cell]);
    if (!entry || semantic[cell] !== entry.semanticGlyph) throw new Error("corpus lineage does not resolve class → dictionary glyph");
  }
}

function buildFrame(generated, dictionary, camera, expansion, grid) {
  return buildGlyphControlFrame({
    polygons: generated.polygons,
    scene: generated.scene,
    dictionary,
    camera,
    grid,
    glyphPalette: expansion.palette,
    doubleSided: true,
    directionalLight: { direction: expansion.direction, intensity: expansion.directionalIntensity, color: "#ffffff" },
    ambientLight: { intensity: expansion.ambientIntensity, color: expansion.ambientColor },
  });
}

function mapDelta(source, target) {
  let coverageReveal = 0, winnerSwap = 0;
  for (let cell = 0; cell < source.coverage.length; cell++) {
    if (!source.coverage[cell] && target.coverage[cell]) coverageReveal++;
    if (source.coverage[cell] && target.coverage[cell] && source.instanceId[cell] !== target.instanceId[cell]) winnerSwap++;
  }
  return { coverageReveal, winnerSwap };
}

async function publishBundle(destination, options) {
  try {
    return await writeGlyphControlMaps({ destination, ...options });
  } catch (error) {
    if (!String(error).includes("refusing to overwrite")) throw error;
    const stagingRoot = await mkdtemp(join(dirname(destination), ".glyph-resume-candidate-"));
    try {
      const candidate = await writeGlyphControlMaps({ destination: join(stagingRoot, "bundle"), ...options });
      const [existingTree, candidateTree] = await Promise.all([treeHash(destination), treeHash(candidate.destination)]);
      if (existingTree !== candidateTree) throw new Error("content-addressed corpus destination tree does not match freshly staged B6 candidate");
      const manifest = await json(join(destination, "manifest.json"));
      if (manifest.contentSha256 !== candidate.manifest.contentSha256 || manifest.trajectory?.resumeIdentity?.contentSha256 !== options.trajectory.resumeIdentity.contentSha256) {
        throw new Error("content-addressed corpus destination manifest does not match freshly staged B6 candidate");
      }
      return { manifest };
    } finally {
      await rm(stagingRoot, { recursive: true, force: true });
    }
  }
}

async function generate(config, output) {
  const dictionary = await json(resolve(here, config.dictionary));
  const normalization = config.normalizationOverride ?? await json(resolve(here, config.normalization));
  const assigned = splitAssignments(config), records = [], scenes = [];
  const glyphCells = Object.fromEntries(dictionary.classes.map((entry) => [entry.semanticGlyph, 0]));
  const glyphSamples = Object.fromEntries(dictionary.classes.map((entry) => [entry.semanticGlyph, 0]));
  const objectKeys = new Set();
  for (let seedIndex = 0; seedIndex < config.sceneSeeds.length; seedIndex++) {
    const seed = config.sceneSeeds[seedIndex], split = assigned.get(seed), generated = sceneFor(seed, dictionary, seedIndex);
    for (const instance of generated.scene.instances) {
      if (objectKeys.has(instance.id)) throw new Error(`object key ${instance.id} leaks across scenes/splits`);
      objectKeys.add(instance.id);
    }
    const probeCamera = framedCameraFor("slow", 2, seeded(`${seed}/lighting-probe`), generated, config.grid, config.framing);
    const lightingProbes = expansions.map((expansion) => buildFrame(generated, dictionary, probeCamera, expansion, config.grid));
    if (sha(Buffer.from(lightingProbes[0].visibleColor.buffer)) === sha(Buffer.from(lightingProbes[1].visibleColor.buffer))) throw new Error("varied lights did not alter B5 visible controls at a fixed camera");
    const alternate = sceneFor(seed, dictionary, seedIndex, { color: generated.shape.backgroundColor === "#253653" ? "#374151" : "#253653", sizeDelta: .45 });
    let backgroundVaries = false;
    backgroundProbe: for (const kind of trajectoryKinds) for (let frameIndex = 0; frameIndex < config.framesPerTrajectory; frameIndex++) {
      const camera = framedCameraFor(kind, frameIndex, seeded(`${seed}/${kind}/background-probe`), generated, config.grid, config.framing);
      const originalBackground = buildFrame(generated, dictionary, camera, expansions[0], config.grid);
      const alternateBackground = buildFrame(alternate, dictionary, camera, expansions[0], config.grid);
      if (classCellCount(originalBackground, 2) > 0 && classCellCount(alternateBackground, 2) > 0 && classVisibleColorHash(originalBackground, 2) !== classVisibleColorHash(alternateBackground, 2)) { backgroundVaries = true; break backgroundProbe; }
    }
    if (!backgroundVaries) throw new Error("varied background geometry/color did not alter B5 floor controls at a fixed camera/light");
    scenes.push({ ...generated.scene, sceneSeed: seed, split, shape: generated.shape, proofs: { lightingVariesB5: true, backgroundVariesB5: true } });
    for (let expansionIndex = 0; expansionIndex < config.expansionsPerScene; expansionIndex++) {
      const expansion = expansions[expansionIndex], kind = trajectoryKinds[(seedIndex + expansionIndex) % trajectoryKinds.length], random = seeded(`${seed}/${kind}`);
      const frames = [];
      for (let index = 0; index < config.framesPerTrajectory; index++) {
        const camera = framedCameraFor(kind, index, random, generated, config.grid, config.framing);
        camera.rotY += config.cameraOffset ?? 0;
        const frame = buildFrame(generated, dictionary, camera, expansion, config.grid);
        assertLineage(frame, dictionary);
        const present = new Set();
        for (const glyph of compactAscii(frame.semanticAscii)) if (glyphCells[glyph] !== undefined) { glyphCells[glyph]++; present.add(glyph); }
        for (const glyph of present) glyphSamples[glyph]++;
        frames.push(frame);
      }
      const frameIds = frames.map((_, index) => `f${String(index).padStart(3, "0")}`);
      let state = null;
      const deltas = [], disocclusionCells = [];
      const exportFrames = frames.map((frame, index) => {
        if (index === 0 || (kind === "reset" && index === 1)) {
          state = null;
          if (index) disocclusionCells.push(frame.coverage.reduce((sum, value) => sum + value, 0));
          return { id: frameIds[index], frame };
        }
        const previous = frames[index - 1];
        const result = reprojectGlyphSurfaceAtlas({ state, sourceFrame: previous, sourceRgb: rgb(previous), sourceStateVersion: index - 1, targetFrame: frame, targetStateVersion: index });
        state = result.state;
        deltas.push(mapDelta(previous, frame));
        disocclusionCells.push(result.disocclusion.reduce((sum, value) => sum + value, 0));
        return {
          id: frameIds[index],
          frame,
          temporal: result.temporal,
          transition: { sourceFrameId: frameIds[index - 1], sourceSceneSha256: generated.scene.contentSha256, sourcePolygonOrderSha256: generated.scene.polygonOrderSha256 },
        };
      });
      const trajectoryId = `trajectory/${sha(`${seed}/${kind}/${expansion.id}`).slice(0, 16)}`;
      const controlRaw = {
        schemaVersion: "control-trajectory/v2",
        id: trajectoryId,
        sceneId: generated.scene.id,
        sceneSha256: generated.scene.contentSha256,
        sceneSeed: seed,
        split,
        dictionaryId: dictionary.id,
        dictionarySha256: dictionary.contentSha256,
        frames: frameIds.map((frameId, index) => ({
          frameId,
          cameraId: `camera/${trajectoryId.slice(11)}-${index}`,
          index,
          ...(index ? { previousFrameId: frameIds[index - 1] } : {}),
          ...(index + 1 < frameIds.length ? { nextFrameId: frameIds[index + 1] } : {}),
        })),
      };
      const controlTrajectory = { ...controlRaw, contentSha256: digest(controlRaw) };
      const bundleRaw = {
        schemaVersion: "glyph-control-corpus-trajectory/v1",
        controlTrajectory,
        kind,
        expansion,
        keyframes: [
          { frameId: frameIds[0], reason: "trajectory-start" },
          ...(kind === "reset" ? [{ frameId: frameIds[1], reason: "explicit-history-reset" }] : []),
        ],
      };
      const cameraMotion = frames.slice(1).map((frame, index) => {
        const previous = frames[index].metadata.camera, current = frame.metadata.camera;
        return Math.abs(current.rotX - previous.rotX) + Math.abs(current.rotY - previous.rotY) + Math.abs(current.zoom - previous.zoom);
      });
      const motion = { deltas: cameraMotion, total: cameraMotion.reduce((sum, value) => sum + value, 0), mean: cameraMotion.reduce((sum, value) => sum + value, 0) / cameraMotion.length };
      const stem = trajectoryId.replace("/", "-");
      const trajectoryFor = (glyphOutput) => {
        const resumeIdentity = prospectiveIdentity(exportFrames, normalization, glyphOutput, { ...bundleRaw, motion }, config);
        const raw = { ...bundleRaw, motion, resumeIdentity };
        return { ...raw, contentSha256: digest(raw) };
      };
      const visibleTrajectory = trajectoryFor("visible"), semanticTrajectory = trajectoryFor("semantic");
      const visible = await publishBundle(join(output, "bundles", `${stem}-visible`), { frames: exportFrames, normalization, glyphOutput: "visible", trajectory: visibleTrajectory });
      const semantic = await publishBundle(join(output, "bundles", `${stem}-semantic`), { frames: exportFrames, normalization, glyphOutput: "semantic", trajectory: semanticTrajectory });
      for (let index = 0; index < frames.length; index++) {
        const visibleSelected = await readFile(join(output, "bundles", `${stem}-visible`, "frames", frameIds[index], "selected.txt"), "utf8");
        const semanticSelected = await readFile(join(output, "bundles", `${stem}-semantic`, "frames", frameIds[index], "selected.txt"), "utf8");
        if (visibleSelected !== frames[index].visibleAscii || semanticSelected !== frames[index].semanticAscii) throw new Error("public B6 visible/semantic selector byte parity failed");
        if (!frames[index].coverage.some((value) => value === 0)) throw new Error("corpus frame lacks empty background cells");
      }
      if (kind === "reset" && (exportFrames[1].temporal || exportFrames[1].transition || visibleTrajectory.keyframes[1]?.reason !== "explicit-history-reset")) throw new Error("reset frame is not a downstream-visible keyframe");
      if (kind === "occlusion-swap" && !deltas.some((delta) => delta.winnerSwap > 0)) throw new Error("occlusion-swap has no measured winner-instance exchange");
      if (kind === "reveal" && (!deltas.some((delta) => delta.coverageReveal > 0) || disocclusionCells.every((value) => value === 0))) throw new Error("reveal has no measured newly covered/disoccluded cells");
      records.push({
        trajectory: visibleTrajectory,
        kind,
        motion,
        split,
        sceneSeed: seed,
        expansionId: expansion.id,
        visibleBundle: `bundles/${stem}-visible`,
        semanticBundle: `bundles/${stem}-semantic`,
        visibleBundleSha256: visible.manifest.contentSha256,
        semanticBundleSha256: semantic.manifest.contentSha256,
        properties: {
          winnerSwapCells: deltas.reduce((sum, delta) => sum + delta.winnerSwap, 0),
          revealCells: deltas.reduce((sum, delta) => sum + delta.coverageReveal, 0),
          disocclusionCells: disocclusionCells.reduce((sum, value) => sum + value, 0),
          reset: kind === "reset",
          visibleColorSha256: sha(Buffer.concat(frames.map((frame) => Buffer.from(frame.visibleColor.buffer, frame.visibleColor.byteOffset, frame.visibleColor.byteLength)))),
        },
      });
    }
  }
  const glyphTotal = Object.values(glyphCells).reduce((sum, value) => sum + value, 0);
  const sampleTotal = config.sceneSeeds.length * config.expansionsPerScene * config.framesPerTrajectory;
  const glyphShares = Object.fromEntries(Object.entries(glyphCells).map(([glyph, count]) => [glyph, count / glyphTotal]));
  const glyphSampleShares = Object.fromEntries(Object.entries(glyphSamples).map(([glyph, count]) => [glyph, count / sampleTotal]));
  for (const entry of dictionary.classes) {
    if (!glyphCells[entry.semanticGlyph] || glyphShares[entry.semanticGlyph] < config.minimumGlyphCellShare || glyphSampleShares[entry.semanticGlyph] < config.minimumGlyphSampleShare) throw new Error(`rendered glyph ${entry.semanticGlyph} is below the cell/sample balance floor (cells=${glyphShares[entry.semanticGlyph]}, samples=${glyphSampleShares[entry.semanticGlyph]})`);
  }
  if (new Set(scenes.map((scene) => scene.shape.backgroundColor)).size < 2) throw new Error("procedural background geometry/color did not vary through B5");
  for (let seedIndex = 0; seedIndex < config.sceneSeeds.length; seedIndex++) {
    const pair = records.slice(seedIndex * config.expansionsPerScene, (seedIndex + 1) * config.expansionsPerScene);
    if (new Set(pair.map((record) => record.expansionId)).size !== config.expansionsPerScene || new Set(pair.map((record) => record.visibleBundleSha256)).size !== config.expansionsPerScene || new Set(pair.map((record) => record.properties.visibleColorSha256)).size !== config.expansionsPerScene) {
      throw new Error("camera/light/background expansions did not produce controlled B5/B6 differences");
    }
  }
  if (!records.some((record) => record.properties.winnerSwapCells > 0) || !records.some((record) => record.properties.revealCells > 0 && record.properties.disocclusionCells > 0) || !records.some((record) => record.properties.reset)) {
    throw new Error("fixture lacks measured swap, reveal/disocclusion, or reset proof");
  }
  const slow = records.filter((record) => record.kind === "slow").map((record) => record.motion.mean);
  const fast = records.filter((record) => record.kind === "fast").map((record) => record.motion.mean);
  if (!slow.length || !fast.length || Math.max(...slow) >= Math.min(...fast)) throw new Error("measured camera motion does not distinguish slow from fast trajectories");
  const raw = {
    schemaVersion: "glyph-control-corpus/v1",
    id: config.id,
    dictionary: { id: dictionary.id, contentSha256: dictionary.contentSha256 },
    splitRule: "scene-seed-before-camera-or-style-expansion",
    grid: config.grid,
    ...(config.framing ? { framing: { ...config.framing, fitRule: "world-bounds-sphere/v1" } } : {}),
    scenes,
    trajectories: records,
    lineageValidated: true,
    renderedBalance: { glyphCells, glyphShares, glyphSamples, glyphSampleShares, minimumGlyphCellShare: config.minimumGlyphCellShare, minimumGlyphSampleShare: config.minimumGlyphSampleShare },
  };
  const manifest = { ...raw, contentSha256: digest(raw) };
  await writeJson(join(output, "manifest.json"), manifest);
  return manifest;
}

async function treeHash(root) {
  const entries = [];
  const walk = async (path, relative = "") => {
    for (const name of (await readdir(path)).sort()) {
      const target = join(path, name), next = relative ? `${relative}/${name}` : name;
      if ((await stat(target)).isDirectory()) await walk(target, next);
      else entries.push([next, sha(await readFile(target))]);
    }
  };
  await walk(root);
  return digest(entries);
}

export async function generateCorpusAt(configPath, output) {
  const config = await json(resolve(here, configPath));
  return generate(config, resolve(output));
}

export { buildFrame, cameraFor, expansions, sceneFor, seeded };

export async function runCorpus(configPath, { fixture = false, check = false } = {}) {
  const config = await json(resolve(here, configPath));
  const root = fixture ? await mkdtemp(join(tmpdir(), "glyphcss-corpus-")) : resolve(here, config.output);
  try {
    const first = await generate(config, root);
    if (fixture) {
      const secondRoot = await mkdtemp(join(tmpdir(), "glyphcss-corpus-repeat-"));
      const second = await generate(config, secondRoot);
      if (first.contentSha256 !== second.contentSha256 || await treeHash(root) !== await treeHash(secondRoot)) throw new Error("same seed corpus is not byte-identical");
      const changedRoot = await mkdtemp(join(tmpdir(), "glyphcss-corpus-changed-"));
      const changed = { ...config, sceneSeeds: config.sceneSeeds.map((seed, index) => index ? seed : `${seed}-changed`), splits: { ...config.splits, train: config.splits.train.map((seed, index) => index ? seed : `${seed}-changed`) } };
      const changedManifest = await generate(changed, changedRoot);
      if (first.contentSha256 === changedManifest.contentSha256) throw new Error("changed seed did not change corpus");
      let hostileRejected = false;
      try { splitAssignments({ ...config, splits: { ...config.splits, test: [...config.splits.test, config.splits.train[0]] } }); } catch { hostileRejected = true; }
      if (!hostileRejected) throw new Error("hostile cross-split scene leakage was accepted");
      const staleCases = [
        { ...config, grid: { ...config.grid, cols: config.grid.cols + 1 } },
        { ...config, normalizationOverride: { depth: { near: -5, far: 8 }, world: { min: [-3, -3, -3], max: [3, 3, 3] } } },
        { ...config, cameraOffset: 1 },
      ];
      for (const stale of staleCases) {
        let rejected = false;
        try { await generate(stale, root); } catch { rejected = true; }
        if (!rejected) throw new Error("hostile stale-resume control/config change was accepted");
      }
      if (config.framing) {
        const baselineCases = ["zoom", "rotX", "rotY"].map((field) => ({
          ...config,
          framing: { ...config.framing, baseline: { ...config.framing.baseline, [field]: config.framing.baseline[field] + (field === "zoom" ? 1 : .25) } },
        }));
        for (const stale of baselineCases) {
          let rejected = false;
          try { await generate(stale, root); } catch (error) { rejected = String(error).includes("freshly staged B6 candidate"); }
          if (!rejected) throw new Error("hostile declared camera-baseline drift did not change the published corpus tree");
        }
      }
      const firstVisible = join(root, first.trajectories[0].visibleBundle, "frames", "f000");
      for (const relative of ["index-lookups.json", "tensor-spec.json", "depth-f64.bin"]) {
        const path = join(firstVisible, relative), original = await readFile(path);
        await writeFile(path, Buffer.concat([original, Buffer.from([0])]));
        let rejected = false;
        try { await generate(config, root); } catch (error) { rejected = String(error).includes("freshly staged B6 candidate"); }
        finally { await writeFile(path, original); }
        if (!rejected) throw new Error(`hostile corrupted resume file ${relative} was accepted`);
      }
      if (check) {
        const expected = await json(resolve(here, "fixtures/corpus/fixture-manifest.json"));
        const measured = {
          contentSha256: first.contentSha256,
          sceneCount: first.scenes.length,
          trajectoryCount: first.trajectories.length,
          selectors: [...new Set(first.trajectories.flatMap(() => ["visible", "semantic"]))],
          hasSwap: first.trajectories.some((record) => record.properties.winnerSwapCells > 0),
          hasReveal: first.trajectories.some((record) => record.properties.revealCells > 0 && record.properties.disocclusionCells > 0),
          hasReset: first.trajectories.some((record) => record.properties.reset && record.trajectory.keyframes.some((keyframe) => keyframe.reason === "explicit-history-reset")),
          lineageValidated: first.lineageValidated,
          glyphs: Object.keys(first.renderedBalance.glyphCells).sort(),
          kinds: [...new Set(first.trajectories.map((record) => record.kind))].sort(),
          slowBelowFast: Math.max(...first.trajectories.filter((record) => record.kind === "slow").map((record) => record.motion.mean)) < Math.min(...first.trajectories.filter((record) => record.kind === "fast").map((record) => record.motion.mean)),
        };
        if (canonical(measured) !== canonical(expected)) throw new Error("corpus fixture structural proof drift");
      }
      await rm(secondRoot, { recursive: true, force: true });
      await rm(changedRoot, { recursive: true, force: true });
    }
    return first;
  } finally {
    if (fixture) await rm(root, { recursive: true, force: true });
  }
}
