/**
 * Render the authored cabin spray subject using the frozen control-map layout.
 *
 * Unlike the retired unit-box grid, this builder deliberately keeps architectural
 * planes as large polygons.  The same source mesh supplies the control frames,
 * exact polygon-to-image UV sidecars, and the upstream OBJ exporter.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { deflateSync } from "node:zlib";
import { writeGlyphControlMaps } from "@glyphcss/compile";
import { buildGlyphControlFrame, computeGlyphControlContentSha256, computeGlyphControlGeometryHashes } from "glyphcss";
import { fitSprayViewCamera } from "./render-spray-views.mjs";

const root = resolve(import.meta.dirname, "..");
const sha = (value) => createHash("sha256").update(value).digest("hex");
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const DEFAULT_SCENE_PATH = "config/authored-cabin.json";
const DEFAULT_OUT_ROOT = "reports/glyph-scenes";
const GRID = Object.freeze({ cols: 256, rows: 128, cellAspect: 2 });
const LIGHTING = Object.freeze({
  directional: { direction: [0.5, 0.7, 0.5], intensity: 1, color: "#ffffff" },
  ambient: { intensity: 0.4, color: "#ffffff" },
});
const SPRAY_BASE_VIEWS = Object.freeze([
  ...Array.from({ length: 12 }, (_, index) => ({ id: `orbit-${String(index).padStart(3, "0")}`, rotX: 61, rotY: index * 30 })),
  ...Array.from({ length: 12 }, (_, index) => ({ id: `orbit-low-${String(index).padStart(3, "0")}`, rotX: 40, rotY: index * 30 })),
  ...Array.from({ length: 12 }, (_, index) => ({ id: `orbit-high-${String(index).padStart(3, "0")}`, rotX: 82, rotY: index * 30 })),
  { id: "top", rotX: 15, rotY: 0 },
  { id: "bottom", rotX: 105, rotY: 0 },
]);
// Generation consumes this strictly in order: whole-subject palette views,
// followed by cabin-only close-ups which repaint the shared atlas.
const SPRAY_DETAIL_VIEWS = Object.freeze(
  [
    { row: 0, col: 0, min: [-4, -3], max: [0, 0] },
    { row: 0, col: 1, min: [0, -3], max: [4, 0] },
    { row: 1, col: 0, min: [-4, 0], max: [0, 3] },
    { row: 1, col: 1, min: [0, 0], max: [4, 3] },
  ].flatMap((tile) => [
    { id: `detail-r${tile.row}-c${tile.col}-low`, tier: "detail", rotX: 45, rotY: 45, footprint: { min: tile.min, max: tile.max } },
    { id: `detail-r${tile.row}-c${tile.col}-high`, tier: "detail", rotX: 78, rotY: 225, footprint: { min: tile.min, max: tile.max } },
  ]),
);
const SPRAY_VIEWS = Object.freeze([...SPRAY_BASE_VIEWS.map((view) => ({ ...view, tier: "base" })), ...SPRAY_DETAIL_VIEWS]);
const DICTIONARY_FONT = Object.freeze({
  id: "font/ibm-plex-mono-regular",
  version: "2.004@plex-v6.4.0",
  sha256: "fe11304a5fe956d5744e9b6a246cc83d90425245e75a62230044966ca96a7f50",
});
const COLOR = /^#[0-9a-f]{6}$/i;

const u32 = (value) => { const bytes = Buffer.alloc(4); bytes.writeUInt32BE(value >>> 0); return bytes; };
let crcTable;
function crc32(bytes) {
  crcTable ??= Array.from({ length: 256 }, (_, n) => { let value = n; for (let bit = 0; bit < 8; bit++) value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 0; return value >>> 0; });
  let value = 0xffffffff; for (const byte of bytes) value = crcTable[(value ^ byte) & 255] ^ (value >>> 8); return (value ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) { const name = Buffer.from(type); const body = Buffer.concat([name, data]); return Buffer.concat([u32(data.length), body, u32(crc32(body))]); }
function encodeRgbaPng(width, height, rgba) {
  if (rgba.length !== width * height * 4) throw new Error("GLYPH_SCENE_RGBA_PNG_SIZE_INVALID");
  const scanlines = Buffer.alloc(height * (1 + width * 4));
  for (let row = 0; row < height; row++) {
    const offset = row * (1 + width * 4); scanlines[offset] = 0;
    rgba.copy(scanlines, offset + 1, row * width * 4, (row + 1) * width * 4);
  }
  const ihdr = Buffer.concat([u32(width), u32(height), Buffer.from([8, 6, 0, 0, 0])]);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk("IHDR", ihdr), pngChunk("IDAT", deflateSync(scanlines, { level: 9 })), pngChunk("IEND", Buffer.alloc(0))]);
}

function stableFrameId(index) { return `frame-${String(index).padStart(3, "0")}`; }
function vector(a, b) { return [b[0] - a[0], b[1] - a[1], b[2] - a[2]]; }
function length(value) { return Math.hypot(...value); }
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function centroid(vertices) {
  const center = [0, 0, 0];
  for (const vertex of vertices) for (let axis = 0; axis < 3; axis++) center[axis] += vertex[axis] / vertices.length;
  return center;
}
function normal(vertices) {
  for (let corner = 1; corner + 1 < vertices.length; corner++) {
    const value = cross(vector(vertices[0], vertices[corner]), vector(vertices[0], vertices[corner + 1]));
    if (length(value) > 1e-9) return value;
  }
  throw new Error("GLYPH_CABIN_FACE_DEGENERATE");
}

/**
 * Reverse every per-corner field with its vertex.  In particular, an atlas UV
 * is a property of a vertex corner, not of its face-list position: changing
 * winding without changing UV order mirrors/scrambles the packed texture.
 */
function reverseFaceWinding(polygon) {
  polygon.vertices.reverse();
  if (polygon.uvs) polygon.uvs.reverse();
}

function normalizeScene(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || value.schemaVersion !== "glyph-authored-cabin/v1" || value.units !== "metres"
    || !value.atlas || value.atlas.referenceSize !== 4096 || value.atlas.gutterTexels !== 2
    || !Array.isArray(value.classes) || !value.classes.length) throw new Error("GLYPH_CABIN_SCENE_INVALID");
  const classes = value.classes.map((entry) => {
    if (!entry || typeof entry !== "object" || !Number.isInteger(entry.id) || entry.id < 1
      || typeof entry.name !== "string" || !/^[a-z][a-z0-9-]*$/.test(entry.name)
      || typeof entry.semanticGlyph !== "string" || entry.semanticGlyph.length !== 1
      || typeof entry.controlColor !== "string" || !COLOR.test(entry.controlColor)) throw new Error("GLYPH_CABIN_CLASS_INVALID");
    return { id: entry.id, name: entry.name, semanticGlyph: entry.semanticGlyph, controlColor: entry.controlColor.toLowerCase() };
  });
  if (new Set(classes.map((entry) => entry.id)).size !== classes.length
    || new Set(classes.map((entry) => entry.name)).size !== classes.length
    || new Set(classes.map((entry) => entry.semanticGlyph)).size !== classes.length
    || new Set(classes.map((entry) => entry.controlColor)).size !== classes.length) throw new Error("GLYPH_CABIN_CLASSES_NOT_UNIQUE");
  return { atlas: value.atlas, classes };
}

/** Build the cabin and backyard from large, intentional architectural faces. */
function cabinPolygons(sceneKey, classes) {
  const classByName = new Map(classes.map((entry) => [entry.name, entry]));
  const polygons = [], instances = [], surfaces = [], polygonSurfaceIds = [], winding = [];
  const instanceByName = new Map();
  // `visibleNormal` is deliberately supplied by each primitive, rather than
  // inferred from the scene center. Ground and fence panels are open surfaces;
  // the global-centroid heuristic classifies their intentional front sides as
  // wrong even when they are exactly what the camera should see.
  const add = (name, className, vertices, visibleNormal, group) => {
    const entry = classByName.get(className);
    if (!entry || !group || !visibleNormal || length(visibleNormal) <= 1e-9 || vertices.length < 3 || vertices.some((vertex) => !Array.isArray(vertex) || vertex.length !== 3 || !vertex.every(Number.isFinite))) {
      throw new Error(`GLYPH_CABIN_POLYGON_INVALID:${name}`);
    }
    let instanceId = instanceByName.get(name);
    if (!instanceId) {
      instanceId = `instance/${sceneKey}/${name}`;
      instanceByName.set(name, instanceId);
      instances.push({ id: instanceId, classId: entry.id });
    }
    const surfaceId = `${instanceId}/surface-${polygons.length}`;
    polygons.push({ vertices, color: entry.controlColor });
    winding.push({ group, visibleNormal: [...visibleNormal] });
    surfaces.push({ id: surfaceId, instanceId });
    polygonSurfaceIds.push(surfaceId);
  };
  const quad = (name, className, a, b, c, d, visibleNormal, group) => add(name, className, [a, b, c, d], visibleNormal, group);
  const box = (name, className, x0, x1, y0, y1, z0, z1) => {
    const p = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
    const shellCenter = [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2];
    const group = name.includes("trunk") ? "tree-trunks" : name.includes("fence-post") ? "fence-posts" : name === "chimney" ? "chimney" : "front-step";
    for (const face of [[4, 5, 6, 7], [1, 0, 3, 2], [5, 1, 2, 6], [0, 4, 7, 3], [7, 6, 2, 3], [0, 1, 5, 4]]) {
      const vertices = face.map((index) => p[index]);
      add(name, className, vertices, vector(shellCenter, centroid(vertices)), group);
    }
  };

  // 24 m × 18 m backyard, with the 8 m × 6 m cabin centered inside it.
  quad("yard", "ground", [-12, -9, 0], [12, -9, 0], [12, 9, 0], [-12, 9, 0], [0, 0, 1], "ground");
  quad("path", "path", [-0.6, -9, 0.02], [0.6, -9, 0.02], [0.6, -3, 0.02], [-0.6, -3, 0.02], [0, 0, 1], "path");

  // Four walls stay whole except where a real door/window opening requires a
  // small set of surrounding coplanar quads. No flat architectural plane is gridded.
  quad("front-wall", "wall", [-4, -3, 0], [-1.1, -3, 0], [-1.1, -3, 3], [-4, -3, 3], [0, -1, 0], "cabin-shell");
  quad("front-wall", "wall", [1.1, -3, 0], [4, -3, 0], [4, -3, 3], [1.1, -3, 3], [0, -1, 0], "cabin-shell");
  quad("front-wall", "wall", [-1.1, -3, 2.2], [1.1, -3, 2.2], [1.1, -3, 3], [-1.1, -3, 3], [0, -1, 0], "cabin-shell");
  quad("back-wall", "wall", [-4, 3, 0], [-1.3, 3, 0], [-1.3, 3, 3], [-4, 3, 3], [0, 1, 0], "cabin-shell");
  quad("back-wall", "wall", [1.3, 3, 0], [4, 3, 0], [4, 3, 3], [1.3, 3, 3], [0, 1, 0], "cabin-shell");
  quad("back-wall", "wall", [-1.3, 3, 0], [1.3, 3, 0], [1.3, 3, 1.1], [-1.3, 3, 1.1], [0, 1, 0], "cabin-shell");
  quad("back-wall", "wall", [-1.3, 3, 2.2], [1.3, 3, 2.2], [1.3, 3, 3], [-1.3, 3, 3], [0, 1, 0], "cabin-shell");
  quad("left-wall", "wall", [-4, -3, 0], [-4, 3, 0], [-4, 3, 3], [-4, -3, 3], [-1, 0, 0], "cabin-shell");
  quad("right-wall", "wall", [4, -3, 0], [4, -1.2, 0], [4, -1.2, 3], [4, -3, 3], [1, 0, 0], "cabin-shell");
  quad("right-wall", "wall", [4, 1.2, 0], [4, 3, 0], [4, 3, 3], [4, 1.2, 3], [1, 0, 0], "cabin-shell");
  quad("right-wall", "wall", [4, -1.2, 0], [4, 1.2, 0], [4, 1.2, 1.1], [4, -1.2, 1.1], [1, 0, 0], "cabin-shell");
  quad("right-wall", "wall", [4, -1.2, 2.2], [4, 1.2, 2.2], [4, 1.2, 3], [4, -1.2, 3], [1, 0, 0], "cabin-shell");
  quad("door", "door", [-1.1, -3.015, 0], [1.1, -3.015, 0], [1.1, -3.015, 2.2], [-1.1, -3.015, 2.2], [0, -1, 0], "cabin-shell");
  quad("back-window", "window", [-1.3, 3.015, 1.1], [1.3, 3.015, 1.1], [1.3, 3.015, 2.2], [-1.3, 3.015, 2.2], [0, 1, 0], "cabin-shell");
  quad("side-window", "window", [4.015, -1.2, 1.1], [4.015, 1.2, 1.1], [4.015, 1.2, 2.2], [4.015, -1.2, 2.2], [1, 0, 0], "cabin-shell");
  add("front-gable", "wall", [[-4, -3, 3], [4, -3, 3], [0, -3, 5]], [0, -1, 0], "cabin-shell");
  add("back-gable", "wall", [[4, 3, 3], [-4, 3, 3], [0, 3, 5]], [0, 1, 0], "cabin-shell");
  quad("roof-left", "roof", [-4, -3, 3], [0, -3, 5], [0, 3, 5], [-4, 3, 3], [-1, 0, 1], "cabin-shell");
  quad("roof-right", "roof", [0, -3, 5], [4, -3, 3], [4, 3, 3], [0, 3, 5], [1, 0, 1], "cabin-shell");
  box("chimney", "chimney", 2.2, 2.8, 0.7, 1.3, 3, 5.7);
  box("front-step", "stone", -1.5, 1.5, -3.7, -3, 0, 0.35);

  const panel = (name, a, b) => {
    const middle = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0];
    quad(name, "fence", [a[0], a[1], 0.25], [b[0], b[1], 0.25], [b[0], b[1], 1.45], [a[0], a[1], 1.45], vector(middle, [0, 0, 0]), "fence-panels");
  };
  const post = (name, point) => box(name, "post", point[0] - 0.1, point[0] + 0.1, point[1] - 0.1, point[1] + 0.1, 0, 1.7);
  const postPoints = new Map();
  const fence = (name, a, b) => { panel(name, a, b); postPoints.set(a.join(","), a); postPoints.set(b.join(","), b); };
  for (let x = -12; x < 12; x += 4) fence(`rear-fence-${x}`, [x, 9], [x + 4, 9]);
  for (const x of [-12, 12]) for (let y = -9; y < 9; y += 4) fence(`side-fence-${x}-${y}`, [x, y], [x, Math.min(y + 4, 9)]);
  for (const [start, end, id] of [[-12, -7, "front-left-a"], [-7, -2, "front-left-b"], [2, 7, "front-right-a"], [7, 12, "front-right-b"]]) fence(`front-fence-${id}`, [start, -9], [end, -9]);
  for (const [index, point] of [...postPoints.values()].entries()) post(`fence-post-${index}`, point);

  const tree = (name, x, y) => {
    box(`${name}-trunk`, "trunk", x - 0.23, x + 0.23, y - 0.23, y + 0.23, 0, 2.4);
    const z = 2.0, radius = 1.7, top = [x, y, 5.5];
    const canopyCenter = [x, y, (z * 4 + top[2]) / 5];
    for (const vertices of [
      [[x - radius, y - radius, z], [x + radius, y - radius, z], top],
      [[x + radius, y - radius, z], [x + radius, y + radius, z], top],
      [[x + radius, y + radius, z], [x - radius, y + radius, z], top],
      [[x - radius, y + radius, z], [x - radius, y - radius, z], top],
    ]) add(`${name}-canopy`, "foliage", vertices, vector(canopyCenter, centroid(vertices)), "tree-canopies");
  };
  tree("tree-west", -8, 4.5); tree("tree-east", 8, 4.8); tree("tree-southwest", -8, -4.5);
  return { polygons, instances, surfaces, polygonSurfaceIds, winding };
}

function polygonArea(vertices) {
  let area = 0;
  for (let corner = 1; corner + 1 < vertices.length; corner++) area += length(cross(vector(vertices[0], vertices[corner]), vector(vertices[0], vertices[corner + 1]))) / 2;
  return area;
}

function chartShape(polygon) {
  const edge = vector(polygon.vertices[0], polygon.vertices[1]);
  const width = length(edge);
  if (!(width > 0)) throw new Error("GLYPH_CABIN_FACE_DEGENERATE");
  const axis = edge.map((value) => value / width);
  let height = 0;
  for (const vertex of polygon.vertices.slice(2)) {
    const offset = vector(polygon.vertices[0], vertex);
    const projection = dot(offset, axis);
    const perpendicular = offset.map((value, index) => value - projection * axis[index]);
    height = Math.max(height, length(perpendicular));
  }
  if (!(height > 0)) throw new Error("GLYPH_CABIN_FACE_DEGENERATE");
  return { width, height, triangle: polygon.vertices.length === 3, worldArea: polygonArea(polygon.vertices) };
}

function packCharts(shapes, size, gutterTexels, scale) {
  const pending = shapes.map((shape, face) => ({
    face, ...shape,
    innerWidth: Math.max(1, Math.round(shape.width * scale)), innerHeight: Math.max(1, Math.round(shape.height * scale)),
  })).map((chart) => ({ ...chart, outerWidth: chart.innerWidth + gutterTexels, outerHeight: chart.innerHeight + gutterTexels }))
    .sort((a, b) => b.outerHeight - a.outerHeight || b.outerWidth - a.outerWidth || a.face - b.face);
  let x = 0, y = 0, rowHeight = 0;
  const packed = [];
  for (const chart of pending) {
    if (chart.outerWidth > size || chart.outerHeight > size) return null;
    if (x + chart.outerWidth > size) { x = 0; y += rowHeight; rowHeight = 0; }
    if (y + chart.outerHeight > size) return null;
    packed.push({ ...chart, x, y });
    x += chart.outerWidth; rowHeight = Math.max(rowHeight, chart.outerHeight);
  }
  return packed.sort((a, b) => a.face - b.face);
}

/**
 * Deterministic shelf packing with world-area-proportional texel density.
 * `cell` is a stable chart slot, not a uniform grid coordinate: face i owns
 * chart/cell i even though its rectangle may be much larger than face i-1.
 */
function assignAuthoredUvAtlas(polygons, atlas) {
  const shapes = polygons.map(chartShape);
  let low = 0, high = atlas.referenceSize;
  for (let iteration = 0; iteration < 28; iteration++) {
    const middle = (low + high) / 2;
    if (packCharts(shapes, atlas.referenceSize, atlas.gutterTexels, middle)) low = middle;
    else high = middle;
  }
  const charts = packCharts(shapes, atlas.referenceSize, atlas.gutterTexels, low);
  if (!charts || charts.length !== polygons.length) throw new Error("GLYPH_CABIN_ATLAS_PACK_FAILED");
  const border = atlas.gutterTexels / 2;
  for (const chart of charts) {
    const polygon = polygons[chart.face];
    const u0 = (chart.x + border) / atlas.referenceSize, v0 = (chart.y + border) / atlas.referenceSize;
    const u1 = (chart.x + chart.outerWidth - border) / atlas.referenceSize, v1 = (chart.y + chart.outerHeight - border) / atlas.referenceSize;
    // TOP-ORIGIN V: v grows downward in atlas raster coordinates. The website
    // continues to consume [u, 1 - v], exactly as before.
    polygon.uvs = chart.triangle ? [[u0, v0], [u1, v0], [u0, v1]] : [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
    chart.uv = { min: [u0, v0], max: [u1, v1] };
    chart.faceAreaTexels = chart.innerWidth * chart.innerHeight * (chart.triangle ? 0.5 : 1);
    chart.cell = chart.face;
  }
  const occupiedTexels = charts.reduce((sum, chart) => sum + chart.faceAreaTexels, 0);
  const layout = {
    schemaVersion: "glyph-authored-atlas-layout/v1", referenceSize: atlas.referenceSize, gutterTexels: atlas.gutterTexels,
    vConvention: "top-origin", packing: "area-proportional-shelf/v1", faceToCell: "identity",
    occupiedTexels, charts: charts.map((chart) => ({
      face: chart.face, cell: chart.cell, worldArea: chart.worldArea, faceAreaTexels: chart.faceAreaTexels,
      triangle: chart.triangle, outer: { x: chart.x, y: chart.y, width: chart.outerWidth, height: chart.outerHeight }, uv: chart.uv,
    })),
  };
  assertAuthoredUvs(polygons, layout);
  return layout;
}

function assertAuthoredUvs(polygons, layout) {
  const occupied = new Set();
  for (const [face, polygon] of polygons.entries()) {
    const chart = layout.charts[face];
    if (!chart || chart.face !== face || chart.cell !== face || occupied.has(chart.cell)
      || !polygon.uvs || polygon.uvs.length !== polygon.vertices.length
      || polygon.uvs.some(([u, v]) => !Number.isFinite(u) || !Number.isFinite(v) || u < 0 || u > 1 || v < 0 || v > 1)) {
      throw new Error(`GLYPH_CABIN_AUTHORED_UVS_INVALID:${face}`);
    }
    occupied.add(chart.cell);
  }
  for (let a = 0; a < layout.charts.length; a++) for (let b = a + 1; b < layout.charts.length; b++) {
    const left = layout.charts[a].outer, right = layout.charts[b].outer;
    if (left.x < right.x + right.width && left.x + left.width > right.x && left.y < right.y + right.height && left.y + left.height > right.y) {
      throw new Error("GLYPH_CABIN_AUTHORED_UV_CHARTS_OVERLAP");
    }
  }
}

/**
 * Apply each primitive's declared CCW side after chart allocation.  Keeping
 * atlas allocation first is intentional: the published SDXL sheet was baked
 * with these exact face-indexed chart rectangles. Reversing the vertex and UV
 * arrays together preserves every vertex's existing atlas location while
 * changing only the face's front side.
 */
export function orientCabinPrimitiveWinding(polygons, winding) {
  if (polygons.length !== winding.length) throw new Error("GLYPH_CABIN_WINDING_COUNT_MISMATCH");
  let flipped = 0;
  for (const [face, polygon] of polygons.entries()) {
    const specification = winding[face];
    const before = new Map(polygon.vertices.map((vertex, corner) => [vertex.join(","), [...polygon.uvs[corner]]]));
    if (dot(normal(polygon.vertices), specification.visibleNormal) < 0) {
      reverseFaceWinding(polygon);
      flipped++;
    }
    for (const [corner, vertex] of polygon.vertices.entries()) {
      const expectedUv = before.get(vertex.join(","));
      const actualUv = polygon.uvs[corner];
      if (!expectedUv || expectedUv[0] !== actualUv[0] || expectedUv[1] !== actualUv[1]) {
        throw new Error(`GLYPH_CABIN_WINDING_UV_LOCKSTEP_FAILED:${face}:${corner}`);
      }
    }
  }
  return { flipped, verification: verifyCabinPrimitiveWinding(polygons, winding) };
}

/** Per-primitive validation deliberately avoids any scene-centroid heuristic. */
export function verifyCabinPrimitiveWinding(polygons, winding) {
  if (polygons.length !== winding.length) throw new Error("GLYPH_CABIN_WINDING_COUNT_MISMATCH");
  const groups = new Map();
  for (const [face, polygon] of polygons.entries()) {
    const specification = winding[face];
    const group = groups.get(specification.group) ?? { faceCount: 0, outwardFaceCount: 0 };
    group.faceCount++;
    if (dot(normal(polygon.vertices), specification.visibleNormal) > 1e-9) group.outwardFaceCount++;
    groups.set(specification.group, group);
  }
  const result = Object.fromEntries([...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([group, value]) => [group, {
    ...value,
    outwardPercent: (value.outwardFaceCount / value.faceCount) * 100,
  }]));
  if (Object.values(result).some((value) => value.outwardFaceCount !== value.faceCount)) throw new Error("GLYPH_CABIN_WINDING_VERIFICATION_FAILED");
  return result;
}

export function buildGlyphScene(sceneKey, specification) {
  const { atlas, classes } = normalizeScene(specification);
  const { polygons, instances, surfaces, polygonSurfaceIds, winding } = cabinPolygons(sceneKey, classes);
  const atlasLayout = assignAuthoredUvAtlas(polygons, atlas);
  const windingVerification = orientCabinPrimitiveWinding(polygons, winding);
  const dictionaryRaw = { schemaVersion: "glyph-object-dictionary/v2", id: `dictionary/${sceneKey}`, font: DICTIONARY_FONT, classes: [...classes].sort((a, b) => a.id - b.id) };
  const dictionary = { ...dictionaryRaw, contentSha256: computeGlyphControlContentSha256(dictionaryRaw) };
  const hashes = computeGlyphControlGeometryHashes(polygons);
  const sceneRaw = {
    schemaVersion: "control-scene/v1", id: `scene/${sceneKey}`,
    dictionaryId: dictionary.id, dictionarySha256: dictionary.contentSha256, ...hashes,
    instances, surfaces, polygonSurfaceIds,
  };
  return { polygons, atlasLayout, winding: windingVerification, dictionary, scene: { ...sceneRaw, contentSha256: computeGlyphControlContentSha256(sceneRaw) } };
}

export async function loadGlyphScene({ scenePath = DEFAULT_SCENE_PATH, sceneKey = "cabin" } = {}) {
  if (typeof sceneKey !== "string" || !/^[a-z][a-z0-9_-]*$/.test(sceneKey)) throw new Error("GLYPH_SCENE_KEY_INVALID");
  const sceneText = await readFile(resolve(root, scenePath), "utf8");
  const specification = JSON.parse(sceneText);
  return { sceneText, specification, ...buildGlyphScene(sceneKey, specification) };
}

function cameraMetadata(camera) {
  return { kind: camera.kind, rotX: camera.rotX, rotY: camera.rotY, center: [...camera.center], mat: camera.mat ? [...camera.mat] : null, useMat: camera.useMat, distance: camera.distance, perspective: camera.perspective, zoom: camera.zoom, stretch: camera.stretch, fovScale: camera.fovScale, target: [...camera.target], eyeMode: camera.eyeMode };
}
function viewScheduleMetadata(view) { return { scheduleId: view.id, tier: view.tier, footprint: view.footprint ?? null }; }
function assertEmittedScheduleOrdering(manifest, schedule) {
  const emitted = manifest.trajectory?.views;
  if (!Array.isArray(emitted) || emitted.length !== schedule.length || emitted.some((entry, index) => entry?.scheduleId !== schedule[index].id || entry?.tier !== schedule[index].tier) || emitted.some((entry, index) => JSON.stringify(entry?.footprint ?? null) !== JSON.stringify(schedule[index].footprint ?? null))) throw new Error("GLYPH_SCENE_EMITTED_SCHEDULE_MISMATCH");
  const firstDetail = emitted.findIndex((entry) => entry.tier === "detail");
  if (firstDetail < 0 || emitted.slice(0, firstDetail).some((entry) => entry.tier !== "base") || emitted.slice(firstDetail).some((entry) => entry.tier !== "detail")) throw new Error("GLYPH_SCENE_EMITTED_SCHEDULE_ORDER_INVALID");
}
function semanticColorPng(frame) {
  const rgba = Buffer.alloc(frame.semanticColor.length * 4);
  for (let index = 0; index < frame.semanticColor.length; index++) { const argb = frame.semanticColor[index]; rgba[index * 4] = (argb >>> 16) & 0xff; rgba[index * 4 + 1] = (argb >>> 8) & 0xff; rgba[index * 4 + 2] = argb & 0xff; rgba[index * 4 + 3] = (argb >>> 24) & 0xff; }
  return encodeRgbaPng(frame.metadata.cols, frame.metadata.rows, rgba);
}
function polygonUvImageTable(polygons, camera) {
  const project = (vertex) => { const [col, row] = camera.project(vertex, GRID.cols, GRID.rows, GRID.cellAspect); return [col, row * 2]; };
  return { schemaVersion: "glyph-spray-polygon-uv-image/v1", controlGrid: { cols: GRID.cols, rows: GRID.rows, modelCols: GRID.cols, modelRows: GRID.rows * 2 }, polygons: polygons.map((polygon, polygonIndex) => {
    const projected = polygon.vertices.map(project), triangles = [];
    for (let corner = 1; corner + 1 < polygon.vertices.length; corner++) triangles.push({ uv: [polygon.uvs[0], polygon.uvs[corner], polygon.uvs[corner + 1]], image: [projected[0], projected[corner], projected[corner + 1]] });
    return { polygon: polygonIndex, triangles };
  }) };
}
function frameVerification(frame) {
  let covered = 0, finiteAuthoredUv = 0;
  const glyphs = new Set(), semantic = frame.semanticAscii.replaceAll("\n", "");
  for (let index = 0; index < frame.coverage.length; index++) if (frame.coverage[index]) { covered++; const u = frame.surfaceUv[index * 2], v = frame.surfaceUv[index * 2 + 1]; if (Number.isFinite(u) && Number.isFinite(v) && u >= 0 && u <= 1 && v >= 0 && v <= 1) finiteAuthoredUv++; glyphs.add(semantic[index]); }
  return { coveredCells: covered, finiteAuthoredUvCells: finiteAuthoredUv, semanticGlyphs: [...glyphs].sort() };
}
function frameMeasurement(frame, id, tier) {
  const visible = new Set(); let coveredCells = 0;
  for (let cell = 0; cell < frame.coverage.length; cell++) if (frame.coverage[cell]) { coveredCells++; if (frame.winnerPolygon[cell] >= 0) visible.add(frame.winnerPolygon[cell]); }
  const coveredModelPixels = coveredCells * 2, visibleFaces = visible.size;
  return { id, tier, coveredModelPixels, visibleFaces, pixelsPerVisibleFace: coveredModelPixels / visibleFaces, effectivePixelsAcross: Math.sqrt(coveredModelPixels / visibleFaces) };
}
async function verifyPublishedFrames(viewsRoot, frames) {
  const checks = [];
  for (let index = 0; index < frames.length; index++) { const id = stableFrameId(index), frameRoot = join(viewsRoot, "frames", id); const [coverage, uv] = await Promise.all([stat(join(frameRoot, "coverage-u8.bin")), stat(join(frameRoot, "surface-uv-f32.bin"))]); const summary = frameVerification(frames[index]); if (coverage.size !== 32768 || uv.size !== 262144 || summary.coveredCells !== summary.finiteAuthoredUvCells) throw new Error(`GLYPH_SCENE_CONTROL_FRAME_VERIFICATION_FAILED:${id}`); checks.push({ id, coverageBytes: coverage.size, surfaceUvBytes: uv.size, ...summary }); }
  return checks;
}

/** Produce CPU-only control frames and OBJ-ready atlas metadata; never invokes a model. */
export async function renderGlyphScene({ scenePath = DEFAULT_SCENE_PATH, outRoot = DEFAULT_OUT_ROOT, sceneKey = "cabin" } = {}) {
  const authoredScene = await loadGlyphScene({ scenePath, sceneKey });
  const { sceneText, polygons, atlasLayout, dictionary, scene } = authoredScene;
  const frames = SPRAY_VIEWS.map((view) => {
    const camera = fitSprayViewCamera(polygons, GRID, view, 0.05);
    return buildGlyphControlFrame({ polygons, scene, dictionary, camera, grid: GRID, doubleSided: true, supersample: 1, directionalLight: LIGHTING.directional, ambientLight: LIGHTING.ambient, castShadowFlags: polygons.map(() => false), receiveShadowFlags: polygons.map(() => true) });
  });
  const output = outRoot === DEFAULT_OUT_ROOT ? resolve(root, outRoot) : resolve(outRoot);
  const sceneRoot = join(output, sceneKey), viewsRoot = join(sceneRoot, "views"), assetId = `asset/${sha(sceneText)}`;
  const trajectory = { id: "spray-multi-view/v1", assetId, views: SPRAY_VIEWS.map((view, index) => ({ id: stableFrameId(index), ...viewScheduleMetadata(view), camera: cameraMetadata(fitSprayViewCamera(polygons, GRID, view, 0.05)) })) };
  const controls = await writeGlyphControlMaps({ destination: viewsRoot, frames: frames.map((frame, index) => ({ frame, id: stableFrameId(index) })), normalization: JSON.parse(await readFile(resolve(root, "config/control-normalization.json"), "utf8")), trajectory, appearanceRgb: "albedo-and-target" });
  assertEmittedScheduleOrdering(JSON.parse(await readFile(join(viewsRoot, "manifest.json"), "utf8")), SPRAY_VIEWS);
  const previewRoot = join(sceneRoot, "semantic-preview");
  await mkdir(previewRoot, { recursive: true });
  await Promise.all(frames.map(async (frame, index) => { const id = stableFrameId(index), frameRoot = join(viewsRoot, "frames", id), camera = fitSprayViewCamera(polygons, GRID, SPRAY_VIEWS[index], 0.05); await Promise.all([writeFile(join(previewRoot, `${id}.txt`), frame.semanticAscii), writeFile(join(previewRoot, `${id}.png`), semanticColorPng(frame)), writeFile(join(frameRoot, "polygon-uv-image.json"), json(polygonUvImageTable(polygons, camera)))]); }));
  const verification = await verifyPublishedFrames(viewsRoot, frames);
  const atlasAreas = atlasLayout.charts.map((chart) => chart.faceAreaTexels).sort((a, b) => a - b);
  const measurements = { schemaVersion: "glyph-cabin-subject-measurements/v1", modelImage: { width: 512, height: 512 }, method: "covered model pixels / unique depth-winning polygon faces; effectivePixelsAcross = sqrt(pixelsPerVisibleFace)", base: frameMeasurement(frames[0], SPRAY_VIEWS[0].id, "base"), closeup: frameMeasurement(frames[SPRAY_BASE_VIEWS.length], SPRAY_VIEWS[SPRAY_BASE_VIEWS.length].id, "detail"), atlas: { referenceSize: 4096, faceCount: polygons.length, minFaceAreaTexels: atlasAreas[0], medianFaceAreaTexels: atlasAreas[Math.floor(atlasAreas.length / 2)], maxFaceAreaTexels: atlasAreas.at(-1), occupiedTexels: atlasLayout.occupiedTexels } };
  const manifest = { schemaVersion: "glyph-authored-cabin-views/v1", sceneKey, assetId, input: { scenePath, units: "metres", polygonCount: polygons.length }, viewSchedule: { baseViewCount: SPRAY_BASE_VIEWS.length, detailViewCount: SPRAY_DETAIL_VIEWS.length, ordering: "all-base-then-all-detail", views: SPRAY_VIEWS.map(viewScheduleMetadata) }, controls: { path: "views/manifest.json", contentSha256: controls.manifest.contentSha256 }, atlas: { path: "atlas-layout.json", schemaVersion: atlasLayout.schemaVersion, vConvention: "top-origin", faceToCell: "identity" }, polygonUvImage: { path: "views/frames/<frame-id>/polygon-uv-image.json", schemaVersion: "glyph-spray-polygon-uv-image/v1", format: "authored UV triangles paired with exact control-image projections" }, semanticPreview: { path: "semantic-preview", format: "one .txt and one RGBA8 semantic-control-color PNG per frame" }, measurements: { path: "measurements.json", schemaVersion: measurements.schemaVersion }, verification };
  await mkdir(sceneRoot, { recursive: true });
  await Promise.all([writeFile(join(sceneRoot, "atlas-layout.json"), json(atlasLayout)), writeFile(join(sceneRoot, "measurements.json"), json(measurements)), writeFile(join(sceneRoot, "manifest.json"), json(manifest))]);
  return { outRoot: output, sceneKey, controlsManifestPath: controls.manifestPath, polygonCount: polygons.length, atlasLayout, measurements, verification };
}

function parseArgs() { const values = process.argv.slice(2); const value = (flag) => { const index = values.indexOf(flag); if (index < 0) return undefined; if (!values[index + 1]) throw new Error(`GLYPH_SCENE_${flag.slice(2).replaceAll("-", "_").toUpperCase()}_REQUIRED`); return values[index + 1]; }; return { scenePath: value("--scene"), outRoot: value("--out-root"), sceneKey: value("--scene-key") }; }
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.stdout.write(json(await renderGlyphScene(parseArgs())));
