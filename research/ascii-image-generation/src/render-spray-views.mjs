import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { buildNodeTextureSamplerBundle, loadMeshFromFile, writeGlyphControlMaps } from "@glyphcss/compile";
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
  {
    key: "cottage",
    assetId: "asset/a0a3b6ef57a641663445d4481ad359e479d69ccfa5ebab6bec58f7bfd171339e",
    path: "website/public/gallery/obj/cottage.obj",
    classId: 7,
  },
  {
    key: "frog",
    assetId: "asset/8b66dc7c28ae0a64d146ee8e5ee82ece7202e8b0d70a715c2d3995fe739df687",
    path: "website/public/gallery/obj/opengameart/frog-guy/frog.obj",
    classId: 2,
  },
  {
    key: "chicken",
    assetId: "asset/72c3d86fe7803f6cd8a7ae3e04ea63593ae644879a5d417261e2d5d5bb12c9ff",
    path: "website/public/gallery/obj/chicken.obj",
    classId: 2,
  },
]);

const DEFAULT_VIEWS = Object.freeze([
  ...Array.from({ length: 12 }, (_, index) => ({ id: `orbit-${String(index).padStart(3, "0")}`, rotX: 61, rotY: index * 30 })),
  { id: "top", rotX: 15, rotY: 0 },
  { id: "bottom", rotX: 105, rotY: 0 },
]);

const DEFAULT_CONFIG = Object.freeze({
  schemaVersion: "glyph-spray-pass/v1",
  outRoot: "reports/spray-views",
  grid: { cols: 256, rows: 128, cellAspect: 2 },
  supersample: 1,
  framing: { margin: 0.05 },
  dictionary: "config/asset-object-dictionary.json",
  controlNormalization: "config/control-normalization.json",
  views: DEFAULT_VIEWS,
  subjects: DEFAULT_SUBJECTS,
  lighting: {
    directional: { direction: [0.5, 0.7, 0.5], intensity: 1, color: "#ffffff" },
    ambient: { intensity: 0.4, color: "#ffffff" },
  },
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
  if (!(radius > 0 && Number.isFinite(radius))) throw new Error("SPRAY_VIEWS_ASSET_EMPTY_OR_DEGENERATE");
  return { min, max, center };
}

function normalizedFootprint(footprint, bounds) {
  if (footprint == null) return null;
  const min = footprint?.min, max = footprint?.max;
  if (!Array.isArray(min) || !Array.isArray(max) || min.length !== 2 || max.length !== 2
    || ![...min, ...max].every(Number.isFinite)
    || !(min[0] >= bounds.min[0] && max[0] <= bounds.max[0] && min[1] >= bounds.min[1] && max[1] <= bounds.max[1])
    || !(min[0] < max[0] && min[1] < max[1])) {
    throw new Error("SPRAY_VIEWS_FOOTPRINT_INVALID");
  }
  return { min: [...min], max: [...max] };
}

function intersectsFootprint(polygon, footprint) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of polygon.vertices) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  // A box side can collapse to a line in its footprint axis. Keep boundary
  // faces in both adjacent close-ups; otherwise the tile seams would omit
  // exactly those narrow charts from refinement.
  return minX <= footprint.max[0] && maxX >= footprint.min[0]
    && minY <= footprint.max[1] && maxY >= footprint.min[1];
}

/**
 * The orthographic projected-bounds fit used by the asset corpus, with the
 * spray schedule supplying the absolute rotations directly instead of its
 * trace-bound anchor offsets.
 */
export function fitSprayViewCamera(polygons, grid, view, margin = 0.05) {
  const bounds = boundsFor(polygons);
  const footprint = normalizedFootprint(view.footprint, bounds);
  const center = footprint
    ? [(footprint.min[0] + footprint.max[0]) / 2, (footprint.min[1] + footprint.max[1]) / 2, bounds.center[2]]
    : bounds.center;
  const fittedPolygons = footprint ? polygons.filter((polygon) => intersectsFootprint(polygon, footprint)) : polygons;
  if (!fittedPolygons.length) throw new Error("SPRAY_VIEWS_FOOTPRINT_EMPTY");
  const usable = 1 - margin * 2;
  const fitted = createGlyphOrthographicCamera({ rotX: view.rotX, rotY: view.rotY, zoom: 1, target: center, center: [0, 0] });
  // A close-up footprint must crop a large spanning face (notably the yard
  // plane) before fitting.  Feeding that face's complete bounds back into the
  // fit would silently turn every "detail" view into another whole-subject
  // view.  This only affects the camera fit; rasterization still uses the
  // original, unmodified mesh and its real depth ordering.
  const fitVertex = footprint
    ? (vertex) => [Math.max(footprint.min[0], Math.min(footprint.max[0], vertex[0])), Math.max(footprint.min[1], Math.min(footprint.max[1], vertex[1])), vertex[2]]
    : (vertex) => vertex;
  const projected = fittedPolygons.flatMap((polygon) => polygon.vertices.map((vertex) => fitted.project(fitVertex(vertex), grid.cols, grid.rows, grid.cellAspect)));
  const minCol = Math.min(...projected.map((point) => point[0]));
  const maxCol = Math.max(...projected.map((point) => point[0]));
  const minRow = Math.min(...projected.map((point) => point[1]));
  const maxRow = Math.max(...projected.map((point) => point[1]));
  const spanCols = maxCol - minCol, spanRows = maxRow - minRow;
  if (!(spanCols > 0 && spanRows > 0 && [minCol, maxCol, minRow, maxRow].every(Number.isFinite))) {
    throw new Error("SPRAY_VIEWS_PROJECTED_BOUNDS_INVALID");
  }
  fitted.zoom = Math.min(grid.cols * usable / spanCols, grid.rows * usable / spanRows);
  fitted.center = [
    0.5 - ((minCol + maxCol) / 2) * fitted.zoom / grid.cols,
    0.5 - ((minRow + maxRow) / 2) * fitted.zoom / grid.rows,
  ];
  return fitted;
}

// `sceneFor` is intentionally private to render-asset-corpus.mjs. Keep its
// instance/surface construction byte-for-byte equivalent for the real mesh.
function sceneFor(subject, polygons, dictionary, sourcePolygonCount, syntheticOccluderClassId) {
  const instanceId = `instance/${subject.assetId.slice("asset/".length)}`;
  const surfaces = polygons.map((_, index) => ({ id: `${instanceId}/surface-${index}`, instanceId: index < sourcePolygonCount ? instanceId : `${instanceId}/occluder` }));
  const hashes = computeGlyphControlGeometryHashes(polygons);
  const raw = {
    schemaVersion: "control-scene/v1", id: `scene/${subject.assetId.slice("asset/".length)}`,
    dictionaryId: dictionary.id, dictionarySha256: dictionary.contentSha256, ...hashes,
    instances: [{ id: instanceId, classId: subject.classId }, { id: `${instanceId}/occluder`, classId: syntheticOccluderClassId }], surfaces,
    polygonSurfaceIds: surfaces.map((surface) => surface.id),
  };
  return { ...raw, contentSha256: computeGlyphControlContentSha256(raw) };
}

function stableFrameId(index) {
  return `frame-${String(index).padStart(3, "0")}`;
}

function viewScheduleMetadata(view) {
  return {
    scheduleId: view.id,
    tier: view.tier,
    footprint: view.footprint ?? null,
  };
}

/**
 * Preserve the exact mesh-to-control-image correspondence for the texel
 * projector.  Falling back to the depth-winning cells is intentionally only a
 * compatibility path: this sidecar lets spray_texture reconstruct every UV
 * triangle at the full 4096² atlas resolution.
 */
function polygonUvImageTable(polygons, camera, grid) {
  const project = (vertex) => {
    const [col, row] = camera.project(vertex, grid.cols, grid.rows, grid.cellAspect);
    return [col, row * 2];
  };
  return {
    schemaVersion: "glyph-spray-polygon-uv-image/v1",
    controlGrid: {
      cols: grid.cols,
      rows: grid.rows,
      modelCols: grid.cols,
      modelRows: grid.rows * 2,
    },
    polygons: polygons.map((polygon, polygonIndex) => {
      const projected = polygon.vertices.map(project);
      const triangles = [];
      for (let corner = 1; corner + 1 < polygon.vertices.length; corner++) {
        triangles.push({
          uv: [polygon.uvs[0], polygon.uvs[corner], polygon.uvs[corner + 1]],
          image: [projected[0], projected[corner], projected[corner + 1]],
        });
      }
      return { polygon: polygonIndex, triangles };
    }),
  };
}

function normalizeSubjects(config) {
  const raw = config.subjects ?? DEFAULT_SUBJECTS;
  const subjects = Array.isArray(raw)
    ? raw
    : Object.entries(raw).map(([key, value]) => ({ key, ...value }));
  if (!subjects.length || new Set(subjects.map((subject) => subject.key)).size !== subjects.length) throw new Error("SPRAY_VIEWS_SUBJECTS_INVALID");
  return subjects.map((subject) => {
    const defaultSubject = DEFAULT_SUBJECTS.find((candidate) => candidate.key === subject?.key);
    subject = defaultSubject ? { ...defaultSubject, ...subject } : subject;
    if (!subject || typeof subject.key !== "string" || !/^[a-z0-9_-]+$/.test(subject.key)
      || typeof subject.assetId !== "string" || !subject.assetId.startsWith("asset/")
      || typeof subject.path !== "string" || !Number.isInteger(subject.classId) || subject.classId < 1) {
      throw new Error("SPRAY_VIEWS_SUBJECT_INVALID");
    }
    return { key: subject.key, assetId: subject.assetId, path: subject.path, classId: subject.classId };
  });
}

function normalizeViews(config) {
  const schedule = config.views ?? config.viewSchedule ?? config.schedule?.views;
  const raw = Array.isArray(schedule) ? schedule : schedule?.views ?? DEFAULT_VIEWS;
  if (!Array.isArray(raw) || !raw.length) throw new Error("SPRAY_VIEWS_SCHEDULE_INVALID");
  const views = raw.map((view, index) => ({
    id: view?.id ?? stableFrameId(index), rotX: view?.rotX, rotY: view?.rotY,
    tier: view?.tier ?? "base", footprint: view?.footprint,
  }));
  if (new Set(views.map((view) => view.id)).size !== views.length
    || views.some((view) => typeof view.id !== "string" || !/^[a-z0-9._-]+$/.test(view.id) || !Number.isFinite(view.rotX) || !Number.isFinite(view.rotY)
      || !["base", "detail"].includes(view.tier))) {
    throw new Error("SPRAY_VIEWS_SCHEDULE_INVALID");
  }
  return views;
}

function normalizeConfig(value) {
  const config = { ...DEFAULT_CONFIG, ...value };
  const grid = config.grid;
  if (config.supersample !== 1 || !grid || grid.cols !== 256 || grid.rows !== 128 || grid.cellAspect !== 2
    || !(config.framing?.margin >= 0 && config.framing.margin < 0.5)
    || !config.lighting?.directional || !config.lighting?.ambient) throw new Error("SPRAY_VIEWS_CONFIG_INVALID");
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

function subjectManifest(subject, config, controls, frames, views) {
  const raw = {
    schemaVersion: "glyph-spray-views/v1",
    subject: { key: subject.key, assetId: subject.assetId, path: subject.path, classId: subject.classId },
    grid: config.grid, supersample: config.supersample,
    controls: { path: "views/manifest.json", contentSha256: controls.manifest.contentSha256 },
    views: views.map((view, index) => {
      const control = controls.manifest.frames[index];
      const files = Object.fromEntries(Object.entries(control.files).map(([name, path]) => [name, { path, sha256: controls.manifest.files[path] }]));
      return {
        id: stableFrameId(index), ...viewScheduleMetadata(view), camera: frames[index].metadata.camera,
        visibleAsciiSha256: sha(frames[index].visibleAscii), semanticAsciiSha256: sha(frames[index].semanticAscii),
        albedoRgbSha256: bytesHash(frames[index].albedoRgb), targetRgbSha256: bytesHash(frames[index].targetRgb),
        coverageSha256: bytesHash(frames[index].coverage), surfaceUvSha256: bytesHash(frames[index].surfaceUv),
        files,
      };
    }),
  };
  return { ...raw, contentSha256: sha(canonical(raw)) };
}

export async function renderSprayViews(configOrOptions = {}, options = {}) {
  const { configPath: requestedConfigPath = "config/spray-pass.json", outRoot: requestedOutRoot = null, subjects: selectedKeys = null } = typeof configOrOptions === "string"
    ? { ...options, configPath: configOrOptions }
    : configOrOptions;
  const explicitConfig = requestedConfigPath !== "config/spray-pass.json";
  const config = await loadConfig(configPath(requestedConfigPath), explicitConfig);
  const dictionary = JSON.parse(await readFile(configPath(config.dictionary), "utf8"));
  const normalization = JSON.parse(await readFile(configPath(config.controlNormalization), "utf8"));
  const output = requestedOutRoot === null ? resolve(root, config.outRoot ?? config.output ?? config.outputRoot) : resolve(requestedOutRoot);
  const selected = selectedKeys === null ? config.subjects : config.subjects.filter((subject) => selectedKeys.includes(subject.key));
  if (!selected.length || (selectedKeys !== null && (new Set(selectedKeys).size !== selectedKeys.length || selected.length !== selectedKeys.length))) {
    throw new Error("SPRAY_VIEWS_SUBJECT_SELECTION_INVALID");
  }
  const rendered = [];
  for (const subject of selected) {
    const source = resolve(repositoryRoot, subject.path);
    const loaded = await loadMeshFromFile(source, { preserveTextures: true, solidTextureSamples: false });
    try {
      const polygons = loaded.polygons;
      const syntheticOccluder = dictionary.classes?.find((entry) => entry.name === "synthetic-occluder");
      if (!syntheticOccluder) throw new Error("SPRAY_VIEWS_SYNTHETIC_OCCLUDER_CLASS_REQUIRED");
      const scene = sceneFor(subject, polygons, dictionary, polygons.length, subject.classId, syntheticOccluder.id);
      const textureSamplers = (await buildNodeTextureSamplerBundle(polygons)).samplers;
      const frames = config.views.map((view) => {
        const camera = fitSprayViewCamera(polygons, config.grid, view, config.framing.margin);
        // Match the corpus renderer's full control-frame invocation. This is
        // intentionally one geometry scene with every source polygon receiving
        // shadow, even when the configured light has no shadow options.
        return buildGlyphControlFrame({
          polygons, scene, dictionary, camera, grid: config.grid, doubleSided: true,
          supersample: config.supersample, textureSamplers,
          directionalLight: config.lighting.directional, ambientLight: config.lighting.ambient,
          shadow: config.lighting.shadow,
          castShadowFlags: polygons.map(() => false), receiveShadowFlags: polygons.map(() => true),
        });
      });
      const viewsRoot = join(output, subject.key, "views");
      const trajectory = {
        id: "spray-multi-view/v1", assetId: subject.assetId,
        views: config.views.map((view, index) => ({ id: stableFrameId(index), ...viewScheduleMetadata(view), camera: cameraMetadata(fitSprayViewCamera(polygons, config.grid, view, config.framing.margin)) })),
      };
      const controls = await writeGlyphControlMaps({
        destination: viewsRoot,
        frames: frames.map((frame, index) => ({ frame, id: stableFrameId(index) })),
        normalization, trajectory, appearanceRgb: "albedo-and-target",
      });
      await Promise.all(config.views.map(async (view, index) => {
        const frameRoot = join(viewsRoot, "frames", stableFrameId(index));
        const camera = fitSprayViewCamera(polygons, config.grid, view, config.framing.margin);
        await writeFile(join(frameRoot, "polygon-uv-image.json"), json(polygonUvImageTable(polygons, camera, config.grid)));
      }));
      const manifest = subjectManifest(subject, config, controls, frames, config.views);
      const manifestPath = join(output, subject.key, "manifest.json");
      await mkdir(dirname(manifestPath), { recursive: true });
      await writeFile(manifestPath, json(manifest));
      rendered.push({ subject: subject.key, manifestPath, contentSha256: manifest.contentSha256, controlsManifestSha256: controls.manifest.contentSha256 });
    } finally {
      loaded.dispose();
    }
  }
  return { outRoot: output, rendered };
}

function parseArgs() {
  const values = process.argv.slice(2);
  const readValue = (flag) => {
    const index = values.indexOf(flag);
    if (index < 0) return null;
    if (!values[index + 1]) throw new Error(`SPRAY_VIEWS_${flag.slice(2).replaceAll("-", "_").toUpperCase()}_REQUIRED`);
    return values[index + 1];
  };
  const one = readValue("--subject"), many = readValue("--subjects");
  if (one && many) throw new Error("SPRAY_VIEWS_SUBJECT_SELECTION_INVALID");
  return {
    configPath: readValue("--config") ?? "config/spray-pass.json",
    outRoot: readValue("--out-root"),
    subjects: one ? [one] : many ? many.split(",").filter(Boolean) : null,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.stdout.write(json(await renderSprayViews(parseArgs())));
}
