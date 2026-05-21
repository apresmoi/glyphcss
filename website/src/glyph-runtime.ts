/**
 * GlyphDemo runtime — imported once by GlyphDemo.astro. Lives in a standalone
 * .ts file (instead of inline `<script>`) so Astro's template parser never sees
 * generic angle brackets or `{ ... }` blocks and mis-classifies them as JSX /
 * template expressions.
 */

import GUI from 'lil-gui';
import {
  buildRasterizeContext,
  createGlyphPerspectiveCamera,
  createGlyphOrthographicCamera,
  bakeFrames,
  projectHotspots,
  rasterize,
  loadMesh,
} from 'glyphcss';
import type { Hotspot, Vec3, WireframeEdge, TextureTriangle, GlyphCamera, ParseAnimationClip } from 'glyphcss';

type GeometryName = 'cuboctahedron' | 'icosahedron' | 'cube';

/** Compute the face normal (unnormalized) of a triangle. */
function faceNormal(t: TextureTriangle): [number, number, number] {
  const [a, b, c] = [t.vertices[0], t.vertices[1], t.vertices[2]];
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
}

function dotNorm(na: [number, number, number], nb: [number, number, number]): number {
  const la = Math.hypot(na[0], na[1], na[2]);
  const lb = Math.hypot(nb[0], nb[1], nb[2]);
  if (la === 0 || lb === 0) return 1;
  return (na[0]*nb[0] + na[1]*nb[1] + na[2]*nb[2]) / (la * lb);
}

/** Derive a feature-edge list: only emit edges where adjacent face normals diverge > threshold.
 *  Color is copied from the first triangle encountered for each edge. */
function trianglesToEdges(triangles: TextureTriangle[], featureAngleDeg = 20): WireframeEdge[] {
  const THRESH = Math.cos((featureAngleDeg * Math.PI) / 180);
  // Map each edge (sorted vertex key) → list of face normals sharing it, plus color from first tri.
  const edgeFaces = new Map<string, { normals: Array<[number, number, number]>; from: Vec3; to: Vec3; color?: string }>();
  const pairs: [number, number][] = [[0, 1], [1, 2], [2, 0]];
  for (const t of triangles) {
    const n = faceNormal(t);
    for (const [i, j] of pairs) {
      const a = t.vertices[i], b = t.vertices[j];
      const k1 = `${a[0]},${a[1]},${a[2]}`;
      const k2 = `${b[0]},${b[1]},${b[2]}`;
      const key = k1 < k2 ? `${k1}|${k2}` : `${k2}|${k1}`;
      const existing = edgeFaces.get(key);
      if (existing) {
        existing.normals.push(n);
      } else {
        edgeFaces.set(key, { normals: [n], from: a, to: b, color: t.color });
      }
    }
  }
  const edges: WireframeEdge[] = [];
  for (const { normals, from, to, color } of edgeFaces.values()) {
    // Boundary edges (only one adjacent face) are always feature edges.
    if (normals.length < 2) {
      const edge: WireframeEdge = { from, to, weight: 2 };
      if (color) edge.color = color;
      edges.push(edge);
      continue;
    }
    // Check if any pair of adjacent normals diverges more than the threshold.
    let isFeature = false;
    outer: for (let i = 0; i < normals.length; i++) {
      for (let j = i + 1; j < normals.length; j++) {
        if (dotNorm(normals[i]!, normals[j]!) < THRESH) {
          isFeature = true;
          break outer;
        }
      }
    }
    if (isFeature) {
      const edge: WireframeEdge = { from, to, weight: 2 };
      if (color) edge.color = color;
      edges.push(edge);
    }
  }
  return edges;
}

interface MeshGeometry {
  vertices: Vec3[];
  edges: WireframeEdge[];
  /** Fan-triangulated TextureTriangles used internally for feature edges and picking. */
  polygons: TextureTriangle[];
  animations: ParseAnimationClip[];
  sample: (clipIndex: number, time: number) => TextureTriangle[];
}

/** Fan-triangulate a Polygon (N vertices) into N-2 TextureTriangles. */
function fanTriangulate(polygons: import('glyphcss').Polygon[]): TextureTriangle[] {
  const triangles: TextureTriangle[] = [];
  for (const poly of polygons) {
    if (!poly.vertices || poly.vertices.length < 3) continue;
    const v = poly.vertices;
    const color = poly.color;
    // If the polygon was already pre-triangulated by the parser into textureTriangles,
    // prefer those (they carry per-triangle UVs from the source mesh).
    if (poly.textureTriangles && poly.textureTriangles.length > 0) {
      for (const t of poly.textureTriangles) triangles.push(t);
      continue;
    }
    for (let i = 1; i < v.length - 1; i++) {
      const tri: TextureTriangle = {
        vertices: [v[0]!, v[i]!, v[i + 1]!],
        uvs: [[0, 0], [0, 0], [0, 0]],
      };
      if (color) tri.color = color;
      triangles.push(tri);
    }
  }
  return triangles;
}

/** Recenter + scale triangles to fit a unit bbox (asciss-style mesh-fit). */
function fitTrianglesToUnitBbox(triangles: TextureTriangle[]): TextureTriangle[] {
  if (triangles.length === 0) return triangles;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const t of triangles) for (const v of t.vertices) {
    if (v[0] < minX) minX = v[0]; if (v[0] > maxX) maxX = v[0];
    if (v[1] < minY) minY = v[1]; if (v[1] > maxY) maxY = v[1];
    if (v[2] < minZ) minZ = v[2]; if (v[2] > maxZ) maxZ = v[2];
  }
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, cz = (minZ + maxZ) / 2;
  const size = Math.max(maxX - minX, maxY - minY, maxZ - minZ) || 1;
  const k = 2 / size;
  return triangles.map((t) => ({
    ...t,
    vertices: t.vertices.map((v) => [
      (v[0] - cx) * k,
      (v[1] - cy) * k,
      (v[2] - cz) * k,
    ]) as TextureTriangle["vertices"],
  }));
}

async function loadMeshAsGeometry(url: string, normalize = true): Promise<MeshGeometry> {
  const result = await loadMesh(url);
  const rawTris = fanTriangulate(result.polygons);
  const polys = normalize ? fitTrianglesToUnitBbox(rawTris) : rawTris;
  const edges = trianglesToEdges(polys);
  const vertSet = new Map<string, Vec3>();
  for (const e of edges) {
    vertSet.set(e.from.join(','), e.from);
    vertSet.set(e.to.join(','), e.to);
  }

  // For animated meshes, wrap the sample function to apply the same normalization.
  const clips = result.animation?.clips ?? [];
  let sample: (clipIndex: number, time: number) => TextureTriangle[];
  if (clips.length > 0 && result.animation) {
    const animation = result.animation;
    sample = (clipIndex: number, time: number) => {
      const rawPolys = animation.sample(clipIndex, time);
      const raw = fanTriangulate(rawPolys);
      return normalize ? fitTrianglesToUnitBbox(raw) : raw;
    };
  } else {
    sample = () => polys;
  }

  return {
    vertices: Array.from(vertSet.values()),
    edges,
    polygons: polys,
    animations: clips,
    sample,
  };
}

// ── Selection helpers ─────────────────────────────────────────────────────

/** Point-in-triangle test using barycentric coordinates (2D). */
function pointInTriangle2D(
  px: number, py: number,
  ax: number, ay: number,
  bx: number, by: number,
  cx: number, cy: number,
): boolean {
  const v0x = cx - ax, v0y = cy - ay;
  const v1x = bx - ax, v1y = by - ay;
  const v2x = px - ax, v2y = py - ay;
  const dot00 = v0x * v0x + v0y * v0y;
  const dot01 = v0x * v1x + v0y * v1y;
  const dot02 = v0x * v2x + v0y * v2y;
  const dot11 = v1x * v1x + v1y * v1y;
  const dot12 = v1x * v2x + v1y * v2y;
  const denom = dot00 * dot11 - dot01 * dot01;
  if (Math.abs(denom) < 1e-10) return false;
  const inv = 1 / denom;
  const u = (dot11 * dot02 - dot01 * dot12) * inv;
  const v = (dot00 * dot12 - dot01 * dot02) * inv;
  return u >= 0 && v >= 0 && u + v <= 1;
}

/**
 * Pick the nearest (lowest depth) triangle under the pointer (col, row).
 * Returns the triangle index or -1 if none hit.
 */
function pickTriangle(
  triangles: TextureTriangle[],
  cam: GlyphCamera,
  cols: number, rows: number, cellAspect: number,
  pointerCol: number, pointerRow: number,
): number {
  let bestIdx = -1;
  let bestDepth = Infinity;
  for (let i = 0; i < triangles.length; i++) {
    const t = triangles[i]!;
    const pa = cam.project(t.vertices[0], cols, rows, cellAspect);
    const pb = cam.project(t.vertices[1], cols, rows, cellAspect);
    const pc = cam.project(t.vertices[2], cols, rows, cellAspect);
    // Quick bounding-box cull.
    const minC = Math.min(pa[0], pb[0], pc[0]) - 1;
    const maxC = Math.max(pa[0], pb[0], pc[0]) + 1;
    const minR = Math.min(pa[1], pb[1], pc[1]) - 1;
    const maxR = Math.max(pa[1], pb[1], pc[1]) + 1;
    if (pointerCol < minC || pointerCol > maxC || pointerRow < minR || pointerRow > maxR) continue;
    if (!pointInTriangle2D(pointerCol, pointerRow, pa[0], pa[1], pb[0], pb[1], pc[0], pc[1])) continue;
    const depth = (pa[2] + pb[2] + pc[2]) / 3;
    if (depth < bestDepth) {
      bestDepth = depth;
      bestIdx = i;
    }
  }
  return bestIdx;
}

/** Build 3 weight-3 highlight edges for a selected triangle. */
function buildSelectionEdges(t: TextureTriangle): WireframeEdge[] {
  return [
    { from: t.vertices[0], to: t.vertices[1], weight: 3 },
    { from: t.vertices[1], to: t.vertices[2], weight: 3 },
    { from: t.vertices[2], to: t.vertices[0], weight: 3 },
  ];
}

interface Tunables {
  zoom: number;
  stretch: number;
  distance: number;
  rotX: number;
  /** rotY in radians. When explicitly set, auto-rotate is paused. */
  rotY?: number;
  /** Camera pan target X (world units). */
  targetX?: number;
  /** Camera pan target Y (world units). */
  targetY?: number;
  /** Camera pan target Z (world units). */
  targetZ?: number;
  duration: number;
  lineHeight: number;
  geometry: GeometryName;
  /** Render mode sent from the gallery Dock. */
  renderMode?: 'wireframe' | 'solid';
  /** Feature-edge threshold in degrees (0 = all edges). */
  featureEdges?: number;
  /** Named wireframe glyph palette. */
  glyphPalette?: string;
  /** When false, rasterizer skips <span> emission — fastest possible DOM. */
  useColors?: boolean;
  /** Smooth (Gouraud) shading. Default true. */
  smoothShading?: boolean;
  /** Crease angle in degrees. Default 60. */
  creaseAngle?: number;
  /** Cull back-facing triangles. Default false. */
  backfaceCull?: boolean;
}

type DragMode = 'orbit' | 'pan' | 'fpv';

interface FpvOptions {
  look: boolean;
  move: boolean;
  jump: boolean;
  crouch: boolean;
  moveSpeed: number;
  jumpVelocity: number;
  gravity: number;
  eyeHeight: number;
  crouchHeight: number;
  groundZ: number;
  lookSensitivity: number;
  minPitch: number;
  maxPitch: number;
  invertY: boolean;
}

interface ControlState {
  /** Invert drag direction (both axes). */
  invertDrag: boolean;
  /** Whether drag is enabled. */
  dragEnabled: boolean;
  /** Whether wheel zoom is enabled. */
  wheelEnabled: boolean;
  /** Whether auto-normalize (normalizePolygons) is applied on load. */
  autoCenter: boolean;
  /** Last loaded mesh URL (for re-load on autoCenter toggle). */
  lastMeshUrl: string | null;
  /** When true, the CSS autorotate animation is paused (rotY explicitly controlled). */
  rotYLocked: boolean;
  /** Projection mode. */
  projection: 'perspective' | 'orthographic';
  /** Active drag/interaction mode. */
  dragMode: DragMode;
  /** FPV sub-options (only relevant when dragMode === 'fpv'). */
  fpv: FpvOptions;
}

const FRAMES = 60;
// Default scene tunables. `scale` is the camera zoom; `distance` is the
// perspective focal length in pixels.
const DEFAULT_TUNABLES: Tunables = {
  scale: 0.3,
  stretch: 1.0,
  distance: 8000,
  rotX: 1.134, // 65° in radians, matches glyphcss rotX
  duration: 6,
  lineHeight: 1.0,
  geometry: 'cuboctahedron',
};

// ── Geometry builders ────────────────────────────────────────────────────

function buildCuboctahedron(): { vertices: Vec3[]; edges: WireframeEdge[] } {
  const raw: Vec3[] = [
    [1, 1, 0], [1, -1, 0], [-1, 1, 0], [-1, -1, 0],
    [1, 0, 1], [1, 0, -1], [-1, 0, 1], [-1, 0, -1],
    [0, 1, 1], [0, 1, -1], [0, -1, 1], [0, -1, -1],
  ];
  const verts: Vec3[] = raw.map((v) => {
    const L = Math.hypot(v[0], v[1], v[2]);
    return [v[0] / L, v[1] / L, v[2] / L];
  });
  const edgePairs: [number, number][] = [
    [0, 4], [0, 5], [0, 8], [0, 9],
    [1, 4], [1, 5], [1, 10], [1, 11],
    [2, 6], [2, 7], [2, 8], [2, 9],
    [3, 6], [3, 7], [3, 10], [3, 11],
    [4, 8], [4, 10], [5, 9], [5, 11],
    [6, 8], [6, 10], [7, 9], [7, 11],
  ];
  const SQUARE_FACES: number[][] = [
    [0, 4, 1, 5], [2, 6, 3, 7],
    [0, 8, 2, 9], [1, 10, 3, 11],
    [4, 8, 6, 10], [5, 9, 7, 11],
  ];
  const TRIANGLE_FACES: number[][] = [
    [0, 4, 8], [0, 5, 9], [1, 4, 10], [1, 5, 11],
    [2, 6, 8], [2, 7, 9], [3, 6, 10], [3, 7, 11],
  ];
  const INNER_FACE_SCALE = 1 / 5;
  const INNER_VE_SCALE = 1 / 3;

  const allVerts: Vec3[] = [...verts];
  const edges: WireframeEdge[] = [];

  for (const [a, b] of edgePairs) {
    edges.push({ from: verts[a]!, to: verts[b]!, weight: 2 });
  }

  const addInnerShape = (face: number[]): void => {
    const n = face.length;
    let cx = 0, cy = 0, cz = 0;
    for (const i of face) { cx += verts[i]![0]; cy += verts[i]![1]; cz += verts[i]![2]; }
    cx /= n; cy /= n; cz /= n;
    const innerIdx: number[] = face.map((i) => {
      const v = verts[i]!;
      const small: Vec3 = [
        cx + (v[0] - cx) * INNER_FACE_SCALE,
        cy + (v[1] - cy) * INNER_FACE_SCALE,
        cz + (v[2] - cz) * INNER_FACE_SCALE,
      ];
      const idx = allVerts.length;
      allVerts.push(small);
      return idx;
    });
    for (let k = 0; k < n; k++) {
      edges.push({ from: allVerts[innerIdx[k]!]!, to: allVerts[innerIdx[(k + 1) % n]!]!, weight: 1 });
    }
    for (let k = 0; k < n; k++) {
      edges.push({ from: verts[face[k]!]!, to: allVerts[innerIdx[k]!]!, weight: 1 });
    }
  };
  for (const face of SQUARE_FACES) addInnerShape(face);
  for (const face of TRIANGLE_FACES) addInnerShape(face);

  const innerVeStart = allVerts.length;
  for (let i = 0; i < 12; i++) {
    const v = verts[i]!;
    allVerts.push([v[0] * INNER_VE_SCALE, v[1] * INNER_VE_SCALE, v[2] * INNER_VE_SCALE]);
  }
  for (const [a, b] of edgePairs) {
    edges.push({ from: allVerts[innerVeStart + a]!, to: allVerts[innerVeStart + b]!, weight: 1 });
  }
  for (let i = 0; i < 12; i++) {
    edges.push({ from: verts[i]!, to: allVerts[innerVeStart + i]!, weight: 1 });
  }
  return { vertices: allVerts, edges };
}

function buildIcosahedron(): { vertices: Vec3[]; edges: WireframeEdge[] } {
  const phi = (1 + Math.sqrt(5)) / 2;
  const raw: Vec3[] = [
    [-1, phi, 0], [1, phi, 0], [-1, -phi, 0], [1, -phi, 0],
    [0, -1, phi], [0, 1, phi], [0, -1, -phi], [0, 1, -phi],
    [phi, 0, -1], [phi, 0, 1], [-phi, 0, -1], [-phi, 0, 1],
  ];
  const verts: Vec3[] = raw.map((v) => {
    const L = Math.hypot(v[0], v[1], v[2]);
    return [v[0] / L, v[1] / L, v[2] / L];
  });
  const faces: [number, number, number][] = [
    [0,11,5],[0,5,1],[0,1,7],[0,7,10],[0,10,11],
    [1,5,9],[5,11,4],[11,10,2],[10,7,6],[7,1,8],
    [3,9,4],[3,4,2],[3,2,6],[3,6,8],[3,8,9],
    [4,9,5],[2,4,11],[6,2,10],[8,6,7],[9,8,1],
  ];
  const seen = new Set<string>();
  const edges: WireframeEdge[] = [];
  for (const f of faces) {
    const pairs: [number, number][] = [[0, 1], [1, 2], [2, 0]];
    for (const [i, j] of pairs) {
      const a = f[i]!, b = f[j]!;
      const k = a < b ? `${a}-${b}` : `${b}-${a}`;
      if (seen.has(k)) continue;
      seen.add(k);
      edges.push({ from: verts[a]!, to: verts[b]!, weight: 2 });
    }
  }
  return { vertices: verts, edges };
}

function buildCube(): { vertices: Vec3[]; edges: WireframeEdge[] } {
  const verts: Vec3[] = [];
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) {
    verts.push([x / Math.sqrt(3), y / Math.sqrt(3), z / Math.sqrt(3)]);
  }
  const pairs: [number, number][] = [
    [0,1],[0,2],[0,4],[3,1],[3,2],[3,7],
    [5,1],[5,4],[5,7],[6,2],[6,4],[6,7],
  ];
  const edges: WireframeEdge[] = pairs.map(([a, b]) => ({
    from: verts[a]!, to: verts[b]!, weight: 2,
  }));
  return { vertices: verts, edges };
}

function buildGeometry(name: GeometryName): { vertices: Vec3[]; edges: WireframeEdge[] } {
  if (name === 'icosahedron') return buildIcosahedron();
  if (name === 'cube') return buildCube();
  return buildCuboctahedron();
}

// ── Init per GlyphDemo instance ──────────────────────────────────────────

function initGlyphDemo(demoEl: HTMLElement): void {
  if (demoEl.getAttribute('data-initialized')) return;
  demoEl.setAttribute('data-initialized', '1');

  const sceneHost = demoEl.querySelector('.glyph-demo__scene-host') as HTMLElement;
  const viewportEl = demoEl.querySelector('.glyph-demo__viewport') as HTMLElement;
  const stripEl = demoEl.querySelector('.glyph-demo__strip') as HTMLPreElement;
  const hitLayerEl = demoEl.querySelector('.glyph-demo__hit-layer') as HTMLElement;
  const controlsEl = demoEl.querySelector('.glyph-demo__controls') as HTMLElement | null;
  const loadingEl = demoEl.querySelector('.glyph-demo__loading') as HTMLElement;
  const statsEl = demoEl.querySelector('.glyph-demo__stats') as HTMLElement;
  const codeEls: Record<string, HTMLElement | null> = {
    vanilla: demoEl.querySelector('.glyph-demo__snippet[data-fw="vanilla"] code'),
    react: demoEl.querySelector('.glyph-demo__snippet[data-fw="react"] code'),
    vue: demoEl.querySelector('.glyph-demo__snippet[data-fw="vue"] code'),
  };

  const initialGeometry = (demoEl.getAttribute('data-geometry') || 'cuboctahedron') as GeometryName;
  const wantStats = demoEl.getAttribute('data-show-stats') === '1';

  let userDefaults: Partial<Tunables> = {};
  try { userDefaults = JSON.parse(demoEl.getAttribute('data-defaults') || '{}'); } catch {}

  const tunables: Tunables = { ...DEFAULT_TUNABLES, geometry: initialGeometry, ...userDefaults };

  let controlList: string[] = ['zoom', 'stretch', 'distance', 'rotX', 'duration', 'geometry'];
  const controlsAttr = demoEl.getAttribute('data-controls');
  if (controlsAttr) { try { controlList = JSON.parse(controlsAttr); } catch {} }

  function measureCell(): { fontSize: number; cellW: number; cellH: number } {
    const w = sceneHost.clientWidth;
    const fontSize = Math.max(7, Math.min(11, w * 0.0065));
    const probe = document.createElement('span');
    probe.textContent = 'M';
    probe.style.cssText = [
      'position: absolute',
      'visibility: hidden',
      'pointer-events: none',
      'display: inline-block',
      'font-family: ui-monospace, "JetBrains Mono", "SF Mono", "Menlo", monospace',
      `font-size: ${fontSize}px`,
      'line-height: normal',
      'white-space: pre',
      'padding: 0',
      'margin: 0',
      'letter-spacing: 0',
    ].join(';');
    sceneHost.appendChild(probe);
    const rect = probe.getBoundingClientRect();
    const cellW = rect.width;
    const cellH = rect.height * tunables.lineHeight;
    probe.remove();
    return { fontSize, cellW, cellH };
  }

  function computeGrid(cellW: number, cellH: number) {
    const w = sceneHost.clientWidth;
    const h = sceneHost.clientHeight;
    const cols = Math.max(40, Math.floor(w / cellW));
    const rows = Math.max(24, Math.floor(h / cellH));
    return { cols, rows, cellAspect: cellH / cellW };
  }

  let cellMetrics = measureCell();
  sceneHost.style.setProperty('--cell-fs', `${cellMetrics.fontSize}px`);
  sceneHost.style.setProperty('--cell-h', `${cellMetrics.cellH}px`);
  sceneHost.style.setProperty('--dur', `${tunables.duration}s`);

  // Geometry holds either a built-in shape (animations=[]) or a loaded mesh.
  type GeometryState = {
    vertices: Vec3[];
    edges: WireframeEdge[];
    polygons?: TextureTriangle[];
    animations: ParseAnimationClip[];
    sample: (clipIndex: number, time: number) => TextureTriangle[];
  };

  function staticGeometry(g: { vertices: Vec3[]; edges: WireframeEdge[]; polygons?: TextureTriangle[] }): GeometryState {
    const tris = g.polygons ?? [];
    return { ...g, animations: [], sample: () => tris };
  }

  // When a `data-mesh` URL will be fetched, skip the procedural-geometry build.
  // Otherwise any pre-load bake (resize listeners, first paint) renders the
  // built-in shape (e.g. cuboctahedron) for a brief flash before the real mesh
  // replaces it. Empty placeholder = nothing to rasterize until the mesh lands.
  const willLoadMesh = !!demoEl.getAttribute('data-mesh');
  let geometry: GeometryState = willLoadMesh
    ? staticGeometry({ vertices: [[0, 0, 0]], edges: [], polygons: [] })
    : staticGeometry(buildGeometry(tunables.geometry));

  // ── Animation state ──────────────────────────────────────────────────────
  interface AnimationState {
    clipIndex: number;
    currentTime: number;
    paused: boolean;
    timeScale: number;
    lastFrameTime: number;
    rafHandle: number | null;
  }

  const animState: AnimationState = {
    clipIndex: 0,
    currentTime: 0,
    paused: false,
    timeScale: 1,
    lastFrameTime: 0,
    rafHandle: null,
  };

  const ANIM_TARGET_FPS = 30;
  const ANIM_FRAME_MS = 1000 / ANIM_TARGET_FPS;

  let animLastRenderTime = 0;

  function stopAnimationLoop(): void {
    if (animState.rafHandle !== null) {
      cancelAnimationFrame(animState.rafHandle);
      animState.rafHandle = null;
    }
  }

  function startAnimationLoop(): void {
    stopAnimationLoop();
    animState.lastFrameTime = performance.now();
    animLastRenderTime = 0;

    const tick = (now: number): void => {
      animState.rafHandle = requestAnimationFrame(tick);

      const dt = Math.min((now - animState.lastFrameTime) / 1000, 0.1); // seconds, capped
      animState.lastFrameTime = now;

      // Advance time every RAF for smooth time tracking, but only render at ~30fps
      if (!animState.paused) {
        animState.currentTime += dt * animState.timeScale;
      }

      // Throttle rendering to ~30fps
      if (now - animLastRenderTime < ANIM_FRAME_MS) return;
      animLastRenderTime = now;

      const clip = geometry.animations[animState.clipIndex];
      if (!clip) return;
      const duration = clip.duration;
      if (duration > 0) {
        animState.currentTime = ((animState.currentTime % duration) + duration) % duration;
      }

      // Sample new polygons at current time
      const sampledTriangles = geometry.sample(animState.clipIndex, animState.currentTime);

      // Re-derive edges and update scene (featureEdges not applied to animated
      // frames for perf; use all edges so the animation reads correctly).
      const newEdges = trianglesToEdges(sampledTriangles);
      scene.wireframe = newEdges;
      scene.polygons = sampledTriangles as import('glyphcss').Polygon[];

      // Live-render a single frame (don't re-bake all 60)
      stripEl.innerHTML = rasterize(scene);
    };

    animState.rafHandle = requestAnimationFrame(tick);
  }

  let camera = createGlyphPerspectiveCamera({
    rotX: tunables.rotX, rotY: 0,
    distance: tunables.distance,
    zoom: tunables.zoom,
    stretch: tunables.stretch,
  });

  let grid = computeGrid(cellMetrics.cellW, cellMetrics.cellH);
  sceneHost.style.setProperty('--rows', String(grid.rows));

  let scene = buildRasterizeContext({ camera, grid, wireframe: geometry.edges, mode: 'wireframe' });
  // Canonical wireframe for the current scene: feature-filtered, no selection highlight.
  // Interactive paths (drag, wheel, FPV) use this as the base so they don't
  // accumulate selection edges and also benefit from the feature-edge filter.
  let baseWireframe: WireframeEdge[] = geometry.edges;

  // ── Selection state ──────────────────────────────────────────────────────
  let selectedTriangleIndex = -1;
  let onSelectionChange: ((idx: number, tri: TextureTriangle | null) => void) | null = null;

  function getSelectionEdges(): WireframeEdge[] {
    if (selectedTriangleIndex < 0) return [];
    const tris = geometry.polygons;
    if (!tris || selectedTriangleIndex >= tris.length) return [];
    return buildSelectionEdges(tris[selectedTriangleIndex]!);
  }

  function clearSelection(): void {
    selectedTriangleIndex = -1;
    onSelectionChange?.(-1, null);
    bakeAndApply();
  }


  const hotspots: Hotspot[] = [
    { id: 'top', at: geometry.vertices[0]!, size: [3, 2] },
    { id: 'side', at: geometry.vertices[Math.min(4, geometry.vertices.length - 1)]!, size: [3, 2] },
  ];
  const hotspotLabels: Record<string, string> = { top: 'vertex 0', side: 'vertex 4' };

  const hotspotEls = new Map<string, HTMLDivElement>();
  function rebuildHotspotEls(): void {
    hitLayerEl.innerHTML = '';
    hotspotEls.clear();
    for (const h of hotspots) {
      const el = document.createElement('div');
      el.className = 'glyph-demo__hotspot';
      el.tabIndex = 0;
      el.setAttribute('role', 'button');
      el.setAttribute('aria-label', hotspotLabels[h.id] ?? h.id);
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = hotspotLabels[h.id] ?? h.id;
      el.appendChild(badge);
      el.addEventListener('click', () => alert(`hotspot clicked: ${hotspotLabels[h.id] ?? h.id}`));
      hitLayerEl.appendChild(el);
      hotspotEls.set(h.id, el);
    }
  }
  rebuildHotspotEls();

  let keyframesStyleEl: HTMLStyleElement | null = null;
  function applyKeyframes(css: string): void {
    if (!keyframesStyleEl) {
      keyframesStyleEl = document.createElement('style');
      keyframesStyleEl.dataset.glyphcss = 'hit-keyframes';
      keyframesStyleEl.dataset.demo = demoEl.id;
      document.head.appendChild(keyframesStyleEl);
    }
    keyframesStyleEl.textContent = css;
  }

  function bakeAndApply(): void {
    const { cols, rows, cellAspect } = scene.grid;
    // In wireframe mode, augment base wireframe with selection highlight edges before baking.
    // In solid mode, the wireframe array is unused; leave scene.polygons as-is.
    const selEdges = getSelectionEdges();
    if (scene.mode !== 'solid') {
      scene.wireframe = selEdges.length > 0 ? [...baseWireframe, ...selEdges] : baseWireframe;
    }

    // When autorotate is off, only one frame is ever visible — skip the 60-frame
    // bake to avoid the post-drag freeze on complex meshes.
    if (demoEl.classList.contains('no-autorotate')) {
      const bakeStart = performance.now();
      stripEl.innerHTML = rasterize(scene);
      lastBakeMs = Math.round(performance.now() - bakeStart);
      loadingEl.style.display = 'none';
      updateCode();
      return;
    }

    const bakeStart = performance.now();
    const frames = bakeFrames(scene, FRAMES, 'y');
    lastBakeMs = Math.round(performance.now() - bakeStart);
    stripEl.innerHTML = frames.join('\n');

    const positions: Record<string, Array<{ col: number; row: number; visible: boolean }>> = {};
    for (const h of hotspots) positions[h.id] = [];
    const originalRotY = camera.rotY;
    for (let i = 0; i < FRAMES; i++) {
      // Match bakeFrames's positive direction so hotspots track the visible mesh.
      camera.rotY = originalRotY + (i / FRAMES) * Math.PI * 2;
      const cells = projectHotspots(hotspots, camera, cols, rows, cellAspect);
      for (const c of cells) positions[c.id]!.push({ col: c.col, row: c.row, visible: c.visible });
    }
    camera.rotY = originalRotY;

    const cellH = cellMetrics.cellH;
    const cellW = cellMetrics.cellW;
    let css = '';
    for (const h of hotspots) {
      const animName = `ad-hit-${demoEl.id}-${h.id}`;
      const sizeCols = h.size?.[0] ?? 1;
      const sizeRows = h.size?.[1] ?? 1;
      const el = hotspotEls.get(h.id);
      if (!el) continue;
      el.style.width = `${sizeCols * cellW}px`;
      el.style.height = `${sizeRows * cellH}px`;
      el.style.animationName = animName;
      css += `@keyframes ${animName} {\n`;
      for (let i = 0; i < FRAMES; i++) {
        const p = positions[h.id]![i]!;
        const x = (p.col - sizeCols / 2) * cellW;
        const y = (p.row - sizeRows / 2) * cellH;
        const pct = ((i / FRAMES) * 100).toFixed(4);
        css += `  ${pct}% { transform: translate3d(${x}px, ${y}px, 0); opacity: ${p.visible ? 1 : 0}; }\n`;
      }
      const p0 = positions[h.id]![0]!;
      css += `  100% { transform: translate3d(${(p0.col - sizeCols / 2) * cellW}px, ${(p0.row - sizeRows / 2) * cellH}px, 0); opacity: ${p0.visible ? 1 : 0}; }\n`;
      css += `}\n`;
    }
    applyKeyframes(css);
    loadingEl.style.display = 'none';
    updateCode();
  }

  function rebuildAll(): void {
    stopAnimationLoop();
    geometry = staticGeometry(buildGeometry(tunables.geometry));
    selectedTriangleIndex = -1;
    onSelectionChange?.(-1, null);
    rebuildSceneFromGeometry();
  }

  function rebuildSceneFromGeometry(): void {
    hotspots[0]!.at = geometry.vertices[0]!;
    hotspots[1]!.at = geometry.vertices[Math.min(4, geometry.vertices.length - 1)]!;
    // Honor tunables.rotY whenever it's set (data-defaults, setTunables, drag-end sync).
    // Falls through to camera.rotY for the autorotate path (hero — no data-defaults rotY).
    const preservedRotY = tunables.rotY ?? camera.rotY;
    const prevTarget = camera.target;
    // True orthographic when requested — skips the perspective division so FPV
    // (which places target far from the mesh) doesn't hit the focal-plane
    // singularity. Matches glyphcss's `perspective: false` semantics.
    if (controlState.dragMode === 'fpv') {
      // First-person camera: viewer at z=0 (the eye), perspective diverges at
      // the eye, behind-camera vertices are NaN-culled. Proper FPV semantics,
      // not the orbit perspective with shifted viewer.
      // focal tuned so a 2-unit mesh viewed from ~3 units back fills a
      // similar fraction of the screen as orbit-mode default (~30%).
      camera = createGlyphPerspectiveCamera({
        rotX: tunables.rotX, rotY: preservedRotY,
        zoom: tunables.zoom,
      });
      camera.eyeMode = true;
    } else if (controlState.projection === 'orthographic') {
      camera = createGlyphOrthographicCamera({
        rotX: tunables.rotX, rotY: preservedRotY,
        zoom: tunables.zoom,
      });
    } else {
      camera = createGlyphPerspectiveCamera({
        rotX: tunables.rotX, rotY: preservedRotY,
        distance: tunables.distance,
        zoom: tunables.zoom,
        stretch: tunables.stretch,
      });
    }
    // Restore target (pan offset) from tunables or previous camera state.
    const tx = tunables.targetX ?? prevTarget[0];
    const ty = tunables.targetY ?? prevTarget[1];
    const tz = tunables.targetZ ?? prevTarget[2];
    camera.target = [tx, ty, tz];
    cellMetrics = measureCell();
    sceneHost.style.setProperty('--cell-fs', `${cellMetrics.fontSize}px`);
    sceneHost.style.setProperty('--cell-h', `${cellMetrics.cellH}px`);
    sceneHost.style.setProperty('--dur', `${tunables.duration}s`);
    grid = computeGrid(cellMetrics.cellW, cellMetrics.cellH);
    sceneHost.style.setProperty('--rows', String(grid.rows));
    const activeMode = tunables.renderMode ?? 'wireframe';
    const featureAngle = tunables.featureEdges ?? 0;
    // Re-derive feature edges from the raw triangle list when in wireframe mode
    // and a threshold is set. geometry.edges was built at load time with the
    // default threshold; re-derive here so the Dock slider takes effect
    // without reloading the mesh.
    const activeEdges = (activeMode === 'wireframe' && featureAngle > 0 && geometry.polygons && geometry.polygons.length > 0)
      ? trianglesToEdges(geometry.polygons, featureAngle)
      : geometry.edges;
    baseWireframe = activeEdges;
    scene = buildRasterizeContext({
      camera, grid,
      wireframe: activeEdges,
      polygons: geometry.polygons as import('glyphcss').Polygon[],
      mode: activeMode,
      glyphPalette: tunables.glyphPalette ?? 'default',
      useColors: tunables.useColors ?? true,
      smoothShading: tunables.smoothShading ?? false,
      creaseAngle: tunables.creaseAngle ?? 60,
      backfaceCull: tunables.backfaceCull ?? false,
      directionalLight: { direction: lightingState.direction, intensity: lightingState.keyIntensity, color: lightingState.keyColor },
      ambientLight: { intensity: lightingState.ambientIntensity, color: lightingState.ambientColor },
    });

    // Always bake a static pose by default; animation only runs when the user
    // explicitly picks a clip via setAnimation(). Reset state so a stale clip
    // index from a previous mesh doesn't carry over. Do NOT toggle the
    // no-autorotate class — that's controlled by the host (hero uses CSS
    // autorotate, gallery starts paused).
    stopAnimationLoop();
    animState.clipIndex = 0;
    animState.currentTime = 0;
    bakeAndApply();
  }

  async function setMeshUrl(url: string): Promise<void> {
    loadingEl.style.display = 'grid';
    loadingEl.textContent = `Loading ${url.split('/').pop()}…`;
    try {
      const loaded = await loadMeshAsGeometry(url, controlState.autoCenter);
      if (loaded.edges.length === 0) {
        loadingEl.textContent = 'Empty mesh (0 edges).';
        return;
      }
      controlState.lastMeshUrl = url;
      geometry = loaded;
      selectedTriangleIndex = -1;
      onSelectionChange?.(-1, null);
      rebuildSceneFromGeometry();
      // bakeAndApply hides loadingEl on success.
    } catch (err) {
      console.error('setMeshUrl failed', err);
      loadingEl.textContent = `Failed to load mesh: ${(err as Error).message}`;
    }
  }

  // ── Control state (interaction features) ────────────────────────────────
  const controlState: ControlState = {
    invertDrag: false,
    dragEnabled: true,
    wheelEnabled: true,
    autoCenter: true,
    lastMeshUrl: null,
    rotYLocked: false,
    projection: 'perspective',
    dragMode: 'orbit',
    fpv: {
      look: true,
      move: true,
      jump: true,
      crouch: true,
      moveSpeed: 1,
      jumpVelocity: 0.7,
      gravity: 1.8,
      eyeHeight: 0.2,
      crouchHeight: 0.1,
      groundZ: 0,
      lookSensitivity: 0.15,
      minPitch: 5,
      maxPitch: 175,
      invertY: false,
    },
  };

  // Lighting state — applied to scene on rebuild. Default direction is up-and-right
  // (azimuth 50°, elevation 45°), matching glyphcss gallery defaults.
  const lightingState = {
    direction: [0.454, 0.541, 0.707] as [number, number, number],
    keyIntensity: 1,
    ambientIntensity: 0.4,
    keyColor: '#ffffff',
    ambientColor: '#ffffff',
  };

  function setLighting(partial: { azimuth?: number; elevation?: number; keyIntensity?: number; ambientIntensity?: number; keyColor?: string; ambientColor?: string }): void {
    if (partial.azimuth !== undefined || partial.elevation !== undefined) {
      const azRad = ((partial.azimuth ?? sphericalAz) * Math.PI) / 180;
      const elRad = ((partial.elevation ?? sphericalEl) * Math.PI) / 180;
      if (partial.azimuth !== undefined) sphericalAz = partial.azimuth;
      if (partial.elevation !== undefined) sphericalEl = partial.elevation;
      lightingState.direction = [
        Math.cos(elRad) * Math.cos(azRad),
        Math.cos(elRad) * Math.sin(azRad),
        Math.sin(elRad),
      ];
    }
    if (partial.keyIntensity !== undefined) lightingState.keyIntensity = partial.keyIntensity;
    if (partial.ambientIntensity !== undefined) lightingState.ambientIntensity = partial.ambientIntensity;
    if (partial.keyColor !== undefined) lightingState.keyColor = partial.keyColor;
    if (partial.ambientColor !== undefined) lightingState.ambientColor = partial.ambientColor;
    rebuildSceneFromGeometry();
  }

  let sphericalAz = 50;
  let sphericalEl = 45;

  // ── FPV state ────────────────────────────────────────────────────────────
  // Two-state model ported from glyphcss createPolyFirstPersonControls:
  //   - `fpvOrigin` is the camera's WORLD position (the eye).
  //   - `camera.target` is DERIVED each frame: fpvOrigin + forwardDir * lookOffset.
  //   - Mouselook rotates target AROUND the fixed fpvOrigin (in-place rotation,
  //     not orbit). WASD moves fpvOrigin; target follows via the same offset.
  let fpvOrigin: [number, number, number] = [0, 0, controlState.fpv.groundZ + controlState.fpv.eyeHeight];
  let fpvVerticalVel = 0;
  let fpvJumpOffset = 0;
  let fpvRafId: number | null = null;
  let fpvLastTime = 0;
  let fpvPointerLocked = false;
  const fpvKeysHeld = new Set<string>();
  // Save orbit-mode projection/distance/rotX across FPV sessions; restored on exit.
  // FPV needs its own short focal length so walking produces visible
  // foreshortening (orbit's distance=8000 is too long for our 2-unit world),
  // and rotX = π/2 (horizontal) — orbit's typical 65° tilt looks weird at eye level.
  let fpvSavedProjection: 'perspective' | 'orthographic' | null = null;
  let fpvSavedDistance: number | null = null;
  let fpvSavedRotX: number | null = null;
  const FPV_PERSPECTIVE_DISTANCE = 200;

  const FPV_FORWARD_KEYS = new Set(['KeyW', 'ArrowUp']);
  const FPV_BACK_KEYS = new Set(['KeyS', 'ArrowDown']);
  const FPV_LEFT_KEYS = new Set(['KeyA', 'ArrowLeft']);
  const FPV_RIGHT_KEYS = new Set(['KeyD', 'ArrowRight']);
  const FPV_JUMP_KEYS = new Set(['Space']);
  const FPV_CROUCH_KEYS = new Set(['ControlLeft', 'ControlRight']);

  // MESH_UNIT = 30 matches the projection constant in createCamera.ts. The
  // lookOffset converts from the pixel-ish `distance` (= glyphcss `perspective`)
  // back to world units so the derived target lives exactly `distance/MESH_UNIT`
  // world units ahead of the eye — placing the CSS perspective vanishing point
  // at the eye position (true first-person semantics).
  const FPV_MESH_UNIT = 30;

  function fpvLookOffset(): number {
    // With eyeMode on the perspective camera, target == eye → the projection
    // origin is the eye, perspective diverges at the eye, behind-eye vertices
    // are NaN-culled. True FPV semantics.
    return 0;
  }

  function fpvForwardDir(rotX: number, rotY: number): [number, number, number] {
    // World direction that maps to CSS -Z (into the screen, away from viewer)
    // under glyphcss's rotateVec3(., rotY, rotX). Matches glyphcss verbatim:
    // [-sin(rx)·cos(ry), -sin(rx)·sin(ry), -cos(rx)] in radians.
    // rotX=π/2 = horizontal; rotX<π/2 = looking up; rotX>π/2 = looking down.
    return [
      -Math.sin(rotX) * Math.cos(rotY),
      -Math.sin(rotX) * Math.sin(rotY),
      -Math.cos(rotX),
    ];
  }

  function fpvDeriveTarget(): [number, number, number] {
    const f = fpvForwardDir(camera.rotX, camera.rotY);
    const d = fpvLookOffset();
    return [
      fpvOrigin[0] + f[0] * d,
      fpvOrigin[1] + f[1] * d,
      fpvOrigin[2] + f[2] * d,
    ];
  }

  function fpvSyncTarget(): void {
    // Re-derive target from the current origin and camera angles so glyphcss's
    // perspective viewer tracks the eye. Without this, walking forward would
    // move `fpvOrigin` but target would stay put, drifting the visible center.
    camera.target = fpvDeriveTarget();
  }

  function fpvInitOriginFromCamera(): void {
    // Position camera OUTSIDE the mesh in the look direction's opposite so the
    // user can walk TOWARD the mesh. glyphcss puts the user at scene center
    // (inside the mesh) which works in their 60-unit world — you have room to
    // walk around interior detail. Our normalize fits meshes to a 2-unit box,
    // leaving no interior; backing up 3 units gives the user something to
    // walk toward.
    const t = camera.target;
    fpvJumpOffset = 0;
    fpvVerticalVel = 0;
    // Set both camera AND tunables so the subsequent rebuildSceneFromGeometry
    // (which seeds a new camera from tunables) preserves the FPV-init pitch.
    camera.rotX = Math.PI / 2;
    tunables.rotX = Math.PI / 2;
    const initBackOffset = 3;
    const f = fpvForwardDir(camera.rotX, camera.rotY);
    fpvOrigin = [
      t[0] - f[0] * initBackOffset,
      t[1] - f[1] * initBackOffset,
      controlState.fpv.groundZ + controlState.fpv.eyeHeight,
    ];
    fpvSyncTarget();
  }

  const fpvOnPointerLockChange = (): void => {
    const locked = document.pointerLockElement === viewportEl;
    fpvPointerLocked = locked;
  };

  const fpvOnMouseMove = (e: MouseEvent): void => {
    if (!fpvPointerLocked || controlState.dragMode !== 'fpv') return;
    if (!controlState.fpv.look) return;
    const dx = e.movementX ?? 0;
    const dy = e.movementY ?? 0;
    if (dx === 0 && dy === 0) return;
    const sens = controlState.fpv.lookSensitivity;
    const dyDir = controlState.fpv.invertY ? -1 : 1;
    // Yaw: mouse right → look right → rotY decreases (same as glyphcss line 284).
    // Yaw range wraps; no clamp needed.
    const DEG_TO_RAD = Math.PI / 180;
    camera.rotY = camera.rotY - dx * sens * DEG_TO_RAD;
    // Pitch: mouse down → look down → rotX increases above π/2 (horizontal).
    // At rotX=π/2, forwardDir has no Z component (level gaze). Increasing rotX
    // adds a +Z component to forwardDir → forward tilts toward ground → look down.
    // Clamp to [minPitch, maxPitch] in degrees converted to radians.
    let rotX = camera.rotX - dy * sens * DEG_TO_RAD * dyDir;
    const minR = controlState.fpv.minPitch * DEG_TO_RAD;
    const maxR = controlState.fpv.maxPitch * DEG_TO_RAD;
    if (rotX < minR) rotX = minR;
    else if (rotX > maxR) rotX = maxR;
    camera.rotX = rotX;
    // Re-derive target so it swings around the fixed origin — in-place
    // rotation, not orbit.
    fpvSyncTarget();
    if (scene.mode !== 'solid') {
      const selEdges = getSelectionEdges();
      scene.wireframe = selEdges.length > 0 ? [...baseWireframe, ...selEdges] : baseWireframe;
    }
    stripEl.innerHTML = rasterize(scene);
    updateHotspotPositions();
  };

  const fpvOnKeyDown = (e: KeyboardEvent): void => {
    if (controlState.dragMode !== 'fpv') return;
    const code = e.code;
    const isFpvKey = FPV_FORWARD_KEYS.has(code) || FPV_BACK_KEYS.has(code) ||
      FPV_LEFT_KEYS.has(code) || FPV_RIGHT_KEYS.has(code) ||
      FPV_JUMP_KEYS.has(code) || FPV_CROUCH_KEYS.has(code);
    if (!isFpvKey) return;
    // Only intercept movement keys while pointer-locked or moveEnabled is on —
    // otherwise let the page handle Space/Ctrl normally (scroll, browser shortcuts).
    if (!fpvPointerLocked && !controlState.fpv.move) return;
    if (FPV_JUMP_KEYS.has(code)) {
      if (!controlState.fpv.jump) return;
      e.preventDefault();
      if (!fpvKeysHeld.has(code) && fpvVerticalVel === 0 && fpvJumpOffset === 0) {
        fpvVerticalVel = controlState.fpv.jumpVelocity;
      }
      fpvKeysHeld.add(code);
      return;
    }
    if (FPV_CROUCH_KEYS.has(code) && !controlState.fpv.crouch) return;
    if (!controlState.fpv.move && !FPV_CROUCH_KEYS.has(code)) return;
    e.preventDefault();
    fpvKeysHeld.add(code);
  };

  const fpvOnKeyUp = (e: KeyboardEvent): void => {
    fpvKeysHeld.delete(e.code);
  };

  const fpvOnBlur = (): void => {
    fpvKeysHeld.clear();
  };

  const fpvOnClick = (): void => {
    if (controlState.dragMode !== 'fpv' || fpvPointerLocked) return;
    if (!controlState.fpv.look) return;
    try { viewportEl.requestPointerLock(); } catch { /* ignore */ }
  };

  const FPV_DT_CLAMP = 0.05;

  const fpvTick = (now: number): void => {
    if (fpvRafId === null || controlState.dragMode !== 'fpv') return;
    const dt = Math.min(FPV_DT_CLAMP, fpvLastTime ? (now - fpvLastTime) / 1000 : 0.0167);
    fpvLastTime = now;

    let dirty = false;

    // ── Horizontal movement: WASD walks fpvOrigin on the world XY plane. ────
    // Movement is pitch-independent: always floor-walking, never flying.
    // Mirrors glyphcss's horizontal-only projection (drop the vertical component
    // by projecting the look direction onto XY, matching three.js PointerLockControls).
    if (controlState.fpv.move) {
      let mf = 0;
      let mr = 0;
      for (const code of fpvKeysHeld) {
        if (FPV_FORWARD_KEYS.has(code)) mf += 1;
        else if (FPV_BACK_KEYS.has(code)) mf -= 1;
        else if (FPV_RIGHT_KEYS.has(code)) mr += 1;
        else if (FPV_LEFT_KEYS.has(code)) mr -= 1;
      }
      if (mf !== 0 || mr !== 0) {
        const r = camera.rotY;
        // Yaw-aligned horizontal forward and right vectors (world XY, Z-up).
        // Derived from glyphcss's WASD math after radian substitution.
        const fx = -Math.cos(r);
        const fy = -Math.sin(r);
        const rx = -Math.sin(r);
        const ry =  Math.cos(r);
        const len = Math.hypot(mf, mr) || 1;
        const step = controlState.fpv.moveSpeed * dt;
        fpvOrigin[0] += ((fx * mf + rx * mr) / len) * step;
        fpvOrigin[1] += ((fy * mf + ry * mr) / len) * step;
        dirty = true;
      }
    }

    // ── Vertical: jump + gravity + crouch. Mutates fpvOrigin[2]. ─────────────
    const crouched = controlState.fpv.crouch &&
      (fpvKeysHeld.has('ControlLeft') || fpvKeysHeld.has('ControlRight'));
    const baseHeight = crouched ? controlState.fpv.crouchHeight : controlState.fpv.eyeHeight;
    if (controlState.fpv.jump && (fpvVerticalVel !== 0 || fpvJumpOffset > 0)) {
      fpvVerticalVel -= controlState.fpv.gravity * dt;
      fpvJumpOffset += fpvVerticalVel * dt;
      if (fpvJumpOffset <= 0) {
        fpvJumpOffset = 0;
        fpvVerticalVel = 0;
      }
    } else if (!controlState.fpv.jump) {
      fpvJumpOffset = 0;
      fpvVerticalVel = 0;
    }
    const originZ = controlState.fpv.groundZ + baseHeight + fpvJumpOffset;
    if (Math.abs(fpvOrigin[2] - originZ) > 1e-4) {
      fpvOrigin[2] = originZ;
      dirty = true;
    }

    if (dirty) {
      fpvSyncTarget();
      if (scene.mode !== 'solid') {
        const selEdges = getSelectionEdges();
        scene.wireframe = selEdges.length > 0 ? [...baseWireframe, ...selEdges] : baseWireframe;
      }
      stripEl.innerHTML = rasterize(scene);
      updateHotspotPositions();
    }

    fpvRafId = requestAnimationFrame(fpvTick);
  };

  function startFpv(): void {
    // Save orbit-mode perspective so we can restore on exit. FPV needs its own
    // perspective tuning — orbit's distance=8000 makes walking look like a
    // planar pan (foreshortening is 1/8000 per world-unit walked = invisible).
    // glyphcss does the equivalent via the `.glyph-fpv-host` CSS class that
    // sets `perspective: 2000px` matching `lookOffset` so the CSS viewer
    // coincides with cameraOrigin. For our raster, switching to perspective
    // mode with a short focal length (200) gives noticeable foreshortening
    // over the 1–3 world-unit walks our mesh size allows.
    fpvSavedProjection = controlState.projection;
    fpvSavedDistance = tunables.distance;
    fpvSavedRotX = tunables.rotX;
    controlState.projection = 'perspective';
    tunables.distance = FPV_PERSPECTIVE_DISTANCE;
    fpvInitOriginFromCamera();
    demoEl.classList.add('no-autorotate');
    document.addEventListener('pointerlockchange', fpvOnPointerLockChange);
    document.addEventListener('mousemove', fpvOnMouseMove);
    window.addEventListener('keydown', fpvOnKeyDown);
    window.addEventListener('keyup', fpvOnKeyUp);
    window.addEventListener('blur', fpvOnBlur);
    viewportEl.addEventListener('click', fpvOnClick);
    viewportEl.style.cursor = controlState.fpv.look ? 'crosshair' : '';
    rebuildSceneFromGeometry();
    fpvLastTime = 0;
    fpvRafId = requestAnimationFrame(fpvTick);
  }

  function stopFpv(): void {
    if (fpvRafId !== null) {
      cancelAnimationFrame(fpvRafId);
      fpvRafId = null;
    }
    if (fpvPointerLocked) {
      try { document.exitPointerLock(); } catch { /* ignore */ }
    }
    fpvPointerLocked = false;
    fpvKeysHeld.clear();
    document.removeEventListener('pointerlockchange', fpvOnPointerLockChange);
    document.removeEventListener('mousemove', fpvOnMouseMove);
    window.removeEventListener('keydown', fpvOnKeyDown);
    window.removeEventListener('keyup', fpvOnKeyUp);
    window.removeEventListener('blur', fpvOnBlur);
    viewportEl.removeEventListener('click', fpvOnClick);
    viewportEl.style.cursor = '';
    // Restore the orbit-mode projection that was active before FPV.
    if (fpvSavedProjection !== null) controlState.projection = fpvSavedProjection;
    if (fpvSavedDistance !== null) tunables.distance = fpvSavedDistance;
    if (fpvSavedRotX !== null) tunables.rotX = fpvSavedRotX;
    fpvSavedProjection = null;
    fpvSavedDistance = null;
    fpvSavedRotX = null;
    // Drop the derived target back to world origin on the XY floor so orbit
    // mode starts at the player's ground position rather than the look-ahead point.
    camera.target = [fpvOrigin[0], fpvOrigin[1], controlState.fpv.groundZ];
    rebuildSceneFromGeometry();
  }

  function setDragMode(mode: DragMode): void {
    if (mode === controlState.dragMode) return;
    const prev = controlState.dragMode;
    controlState.dragMode = mode;
    if (prev === 'fpv') stopFpv();
    if (mode === 'fpv') startFpv();
    else bakeAndApply();
  }

  function setFpvOptions(partial: Partial<FpvOptions>): void {
    Object.assign(controlState.fpv, partial);
    if (controlState.dragMode === 'fpv') {
      // Re-snap vertical position when standing height or ground plane changes,
      // preserving horizontal position. Mirrors glyphcss's update() behaviour.
      if ('eyeHeight' in partial || 'groundZ' in partial) {
        fpvOrigin[2] = controlState.fpv.groundZ + controlState.fpv.eyeHeight;
        fpvSyncTarget();
      }
      if ('look' in partial) {
        viewportEl.style.cursor = controlState.fpv.look ? 'crosshair' : '';
      }
    }
  }

  // Expose for the gallery picker / rail to drive.
  function setTunables(partial: Partial<Tunables>): void {
    // User-driven sidebar changes must apply even during FPV. The FPV poll
    // skip in GlyphScene prevents the camera→sidebar echo loop; legitimate
    // sidebar→camera flow still passes through here. In FPV, after the camera
    // is updated by rebuildSceneFromGeometry, fpvOrigin is re-synced below.
    const hasRotY = 'rotY' in partial && partial.rotY !== undefined;
    Object.assign(tunables, partial);
    if (hasRotY) {
      // Explicit rotY set — lock autorotate and update camera immediately.
      controlState.rotYLocked = true;
      camera.rotY = partial.rotY!;
      // Pause the CSS animation on the strip.
      demoEl.classList.add('no-autorotate');
    }
    // Apply target from tunables to camera.
    if ('targetX' in partial || 'targetY' in partial || 'targetZ' in partial) {
      const tx = tunables.targetX ?? camera.target[0];
      const ty = tunables.targetY ?? camera.target[1];
      const tz = tunables.targetZ ?? camera.target[2];
      camera.target = [tx, ty, tz];
    }
    rebuildSceneFromGeometry();
  }

  function resumeAutoRotate(): void {
    controlState.rotYLocked = false;
    demoEl.classList.remove('no-autorotate');
  }

  function setProjection(kind: 'perspective' | 'orthographic'): void {
    controlState.projection = kind;
    // Projection affects how the camera maps 3D → 2D.
    // For perspective mode we use createGlyphPerspectiveCamera (already active).
    // For orthographic mode we set distance to a large value to approximate
    // orthographic projection (createOrthographicCamera if available, else fake it).
    // NOTE: the glyphcss createOrthographicCamera exists in core but isn't imported
    // here yet — we approximate by boosting distance massively.
    if (kind === 'orthographic') {
      // Very large distance makes the perspective warp negligible (~orthographic).
      camera.distance = 200000;
    } else {
      camera.distance = tunables.distance;
    }
    rebuildSceneFromGeometry();
  }

  function setControlState(partial: Partial<ControlState>): void {
    const prevAutoCenter = controlState.autoCenter;
    Object.assign(controlState, partial);
    // If autoCenter changed and we have a mesh URL loaded, reload it.
    if ('autoCenter' in partial && partial.autoCenter !== prevAutoCenter && controlState.lastMeshUrl) {
      void setMeshUrl(controlState.lastMeshUrl);
    }
  }

  let lastBakeMs = 0;

  function getCameraState(): { rotX: number; rotY: number; zoom: number; target: [number, number, number] } {
    return {
      rotX: camera.rotX,
      rotY: camera.rotY,
      scale: camera.zoom,
      target: [...camera.target] as [number, number, number],
    };
  }

  function getStats(): { cols: number; rows: number; edges: number; verts: number; triangles: number; bakeMs: number } {
    // Read live from geometry so the initial mesh load is always reflected.
    return {
      cols: scene.grid.cols,
      rows: scene.grid.rows,
      edges: geometry.edges.length,
      verts: geometry.vertices.length,
      triangles: geometry.polygons?.length ?? 0,
      bakeMs: lastBakeMs,
    };
  }

  function getSelection(): { index: number; triangle: TextureTriangle | null } {
    const tris = geometry.polygons;
    const tri = (tris && selectedTriangleIndex >= 0) ? (tris[selectedTriangleIndex] ?? null) : null;
    return { index: selectedTriangleIndex, triangle: tri };
  }

  function setSelectionChangeHandler(fn: (idx: number, tri: TextureTriangle | null) => void): void {
    onSelectionChange = fn;
  }

  // ── Animation control API ────────────────────────────────────────────────

  function setAnimation(clipIndex: number): void {
    if (clipIndex < 0 || clipIndex >= geometry.animations.length) return;
    animState.clipIndex = clipIndex;
    animState.currentTime = 0;
    demoEl.classList.add('no-autorotate');
    if (geometry.animations.length > 0 && animState.rafHandle === null) {
      startAnimationLoop();
    }
  }

  function clearAnimation(): void {
    stopAnimationLoop();
    animState.clipIndex = 0;
    animState.currentTime = 0;
    demoEl.classList.remove('no-autorotate');
    // Restore the static rest pose so the scene doesn't keep the last sampled frame.
    scene.polygons = geometry.polygons as import('glyphcss').Polygon[];
    if (scene.mode !== 'solid') {
      scene.wireframe = baseWireframe;
    }
    bakeAndApply();
  }

  function setAnimationPaused(paused: boolean): void {
    animState.paused = paused;
  }

  function setAnimationTimeScale(scale: number): void {
    animState.timeScale = scale;
  }

  function getAnimationInfo(): { clips: ParseAnimationClip[]; current: number; time: number; paused: boolean } {
    return {
      clips: geometry.animations,
      current: animState.clipIndex,
      time: animState.currentTime,
      paused: animState.paused,
    };
  }

  (demoEl as unknown as {
    glyphcssDemo: {
      setMeshUrl: (u: string) => Promise<void>;
      setTunables: (p: Partial<Tunables>) => void;
      setControlState: (p: Partial<ControlState>) => void;
      getCameraState: () => { rotX: number; rotY: number; zoom: number; target: [number, number, number] };
      getStats: () => { cols: number; rows: number; edges: number; verts: number; triangles: number; bakeMs: number };
      getSelection: () => { index: number; triangle: TextureTriangle | null };
      clearSelection: () => void;
      setSelectionChangeHandler: (fn: (idx: number, tri: TextureTriangle | null) => void) => void;
      resumeAutoRotate: () => void;
      setProjection: (kind: 'perspective' | 'orthographic') => void;
      setAnimation: (clipIndex: number) => void;
      clearAnimation: () => void;
      setAnimationPaused: (paused: boolean) => void;
      setAnimationTimeScale: (scale: number) => void;
      getAnimationInfo: () => { clips: ParseAnimationClip[]; current: number; time: number; paused: boolean };
      setDragMode: (mode: DragMode) => void;
      setFpvOptions: (partial: Partial<FpvOptions>) => void;
      setLighting: (partial: { azimuth?: number; elevation?: number; keyIntensity?: number; ambientIntensity?: number; keyColor?: string; ambientColor?: string }) => void;
      getDragMode: () => DragMode;
    }
  }).glyphcssDemo = {
    setMeshUrl,
    setTunables,
    setControlState,
    getCameraState,
    getStats,
    getSelection,
    clearSelection,
    setSelectionChangeHandler,
    resumeAutoRotate,
    setProjection,
    setAnimation,
    clearAnimation,
    setAnimationPaused,
    setAnimationTimeScale,
    getAnimationInfo,
    setDragMode,
    setFpvOptions,
    setLighting,
    getDragMode: () => controlState.dragMode,
  };

  // Skip lil-gui entirely if the controls slot was opted-out (noControls prop).
  const gui = controlsEl ? new GUI({ container: controlsEl, title: 'Tuning', width: 240 }) : null;
  // lil-gui ranges aligned to glyphcss gallery defaults.
  const controlMakers: Record<string, () => void> = gui ? {
    scale: () => { gui.add(tunables, 'zoom', 0.05, 2, 0.005).name('zoom').onChange(rebuildAll); },
    stretch: () => { gui.add(tunables, 'stretch', 0.5, 1.5, 0.01).onChange(rebuildAll); },
    distance: () => { gui.add(tunables, 'distance', 100, 100000, 100).name('perspective').onChange(rebuildAll); },
    rotX: () => { gui.add(tunables, 'rotX', 0, 1.75, 0.01).name('tilt (rotX)').onChange(rebuildAll); },
    duration: () => { gui.add(tunables, 'duration', 1, 12, 0.25).name('duration (s)').onChange(() => {
      sceneHost.style.setProperty('--dur', `${tunables.duration}s`);
    }); },
    lineHeight: () => { gui.add(tunables, 'lineHeight', 0.5, 1.2, 0.01).name('line-height ×').onChange(rebuildAll); },
    geometry: () => { gui.add(tunables, 'geometry', ['cuboctahedron', 'icosahedron', 'cube']).onChange(rebuildAll); },
  } : {};
  for (const key of controlList) controlMakers[key]?.();

  // Drag math mirrors glyphcss createPolyOrbitControls (incremental frame-to-frame
  // deltas, dx/4 sensitivity in degrees, mouse-up rotates "up"). Glyphcss uses
  // degrees; we convert (0.25 deg/px × π/180 ≈ 0.00436 rad/px) to keep the same
  // tactile feel.
  const DRAG_SENSITIVITY = (0.25 * Math.PI) / 180; // rad per pixel
  const CLICK_THRESHOLD_PX = 5; // pointer movement beyond this → drag, not click
  let drag: { startX: number; startY: number; lastX: number; lastY: number; moved: boolean } | null = null;

  function updateHotspotPositions(): void {
    const { cols, rows, cellAspect } = scene.grid;
    const cells = projectHotspots(hotspots, camera, cols, rows, cellAspect);
    const cellH = cellMetrics.cellH, cellW = cellMetrics.cellW;
    for (const c of cells) {
      const el = hotspotEls.get(c.id);
      if (!el) continue;
      const sizeCols = hotspots.find((h) => h.id === c.id)?.size?.[0] ?? 1;
      const sizeRows = hotspots.find((h) => h.id === c.id)?.size?.[1] ?? 1;
      el.style.transform = `translate3d(${(c.col - sizeCols / 2) * cellW}px, ${(c.row - sizeRows / 2) * cellH}px, 0)`;
      el.style.opacity = c.visible ? '1' : '0';
    }
  }

  viewportEl.addEventListener('pointerdown', (e) => {
    // FPV mode uses pointer-lock + mousemove, not pointer-drag events.
    if (controlState.dragMode === 'fpv') return;
    drag = { startX: e.clientX, startY: e.clientY, lastX: e.clientX, lastY: e.clientY, moved: false };
    try { viewportEl.setPointerCapture(e.pointerId); } catch {}
    viewportEl.classList.add('dragging');
    e.preventDefault();
  });
  viewportEl.addEventListener('pointermove', (e) => {
    if (!drag) return;
    if (controlState.dragMode === 'fpv') return;
    const totalDx = e.clientX - drag.startX;
    const totalDy = e.clientY - drag.startY;
    if (Math.hypot(totalDx, totalDy) > CLICK_THRESHOLD_PX) drag.moved = true;
    if (!controlState.dragEnabled || !drag.moved) return;
    const dx = e.clientX - drag.lastX;
    const dy = e.clientY - drag.lastY;
    drag.lastX = e.clientX;
    drag.lastY = e.clientY;
    const f = controlState.invertDrag ? -1 : 1;

    if (controlState.dragMode === 'pan' || e.shiftKey) {
      // Pan mode: translate camera.target proportional to drag delta in a
      // slippy-map fashion (terrain follows pointer). Derived for the glyphcss
      // world frame (col = cx + r[0]*radius, row = cy + r[1]*radius) where
      // r[0] = cos(rotY)*world[1] - sin(rotY)*world[0] and
      // r[1] ~ sin(rotY)*world[1] + cos(rotY)*world[0] (before rotX tilt).
      // Solving the 2x2 system (sin,-cos / cos,sin) * (δt[0],δt[1]) = (dx/k,-dy/(k*cosB)):
      // k = world-units-per-pixel divisor. col_pixels = r[0]*radius*cellH, so for
      // 1:1 cursor tracking, k = radius * cellH. Previously used cellW which
      // made pan ~cellAspect (≈2x) faster than the cursor.
      const k = camera.zoom * Math.min(scene.grid.cols, scene.grid.rows) * 1.5 * cellMetrics.cellH;
      const cosA = Math.cos(camera.rotY), sinA = Math.sin(camera.rotY);
      const cosB = Math.cos(camera.rotX);
      const dySafe = cosB !== 0 ? dy / cosB : dy;
      const targetD0 = ( sinA * dx - cosA * dySafe) / k;
      const targetD1 = -(cosA * dx + sinA * dySafe) / k;
      const t = camera.target;
      camera.target = [t[0] + targetD0 * f, t[1] + targetD1 * f, t[2]];
    } else {
      // Orbit mode: matches glyphcss createPolyOrbitControls which subtracts dX/dY.
      // Drag-right (dx > 0) decreases rotY (same direction as CSS rotate spin).
      // Drag-down (dy > 0) decreases rotX (same direction as glyphcss).
      camera.rotY = camera.rotY - dx * DRAG_SENSITIVITY * f;
      // Clamp rotX to the same [0, 100°] range as the sidebar slider.
      // glyphcss uses `Math.max(0, Math.min(100, rotX - dY))` in degrees;
      // we work in radians so the upper bound is 100° × π/180.
      const ROT_X_MAX = Math.PI * 100 / 180;
      camera.rotX = Math.max(0, Math.min(ROT_X_MAX, camera.rotX - dy * DRAG_SENSITIVITY * f));
    }
    if (scene.mode !== 'solid') {
      const selEdges = getSelectionEdges();
      scene.wireframe = selEdges.length > 0 ? [...baseWireframe, ...selEdges] : baseWireframe;
    }
    stripEl.innerHTML = rasterize(scene);
    updateHotspotPositions();
  });

  function handleClick(e: PointerEvent): void {
    const tris = geometry.polygons;
    if (!tris || tris.length === 0) return;

    const vpRect = viewportEl.getBoundingClientRect();
    const px = e.clientX - vpRect.left;
    const py = e.clientY - vpRect.top;
    const pointerCol = px / cellMetrics.cellW;
    const pointerRow = py / cellMetrics.cellH;

    const { cols, rows, cellAspect } = scene.grid;
    const idx = pickTriangle(tris, camera, cols, rows, cellAspect, pointerCol, pointerRow);

    if (idx === selectedTriangleIndex) {
      // Same triangle clicked — toggle off.
      selectedTriangleIndex = -1;
      onSelectionChange?.(-1, null);
    } else {
      selectedTriangleIndex = idx;
      const tri = idx >= 0 ? (tris[idx] ?? null) : null;
      onSelectionChange?.(idx, tri);
    }
    bakeAndApply();
  }

  const endDrag = (e: PointerEvent): void => {
    if (!drag) return;
    const wasDrag = drag.moved;
    drag = null;
    tunables.rotX = camera.rotX;
    tunables.rotY = camera.rotY;
    viewportEl.classList.remove('dragging');
    if (!wasDrag) {
      handleClick(e);
    } else {
      bakeAndApply();
    }
  };
  viewportEl.addEventListener('pointerup', endDrag);
  viewportEl.addEventListener('pointercancel', endDrag);

  const debouncedRebake = debounce(() => {
    tunables.distance = camera.distance;
    bakeAndApply();
    viewportEl.classList.remove('dragging');
  }, 180);
  viewportEl.addEventListener('wheel', (e) => {
    if (!controlState.wheelEnabled) return;
    e.preventDefault();
    // glyph-equivalent wheel zoom: change `scale` (= glyphcss `zoom`), not
    // `distance` (= glyphcss `perspective`). Distance only tunes perspective
    // intensity; scale is the visual zoom the sidebar slider drives.
    const lineFactor = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1;
    let delta = e.deltaY * lineFactor;
    if (e.ctrlKey) delta *= 10; // trackpad pinch (browser sets ctrlKey)
    else delta *= 3;             // two-finger scroll amp
    const factor = Math.exp(-delta * 0.000513); // glyphcss ZOOM_STEP
    const newScale = Math.max(0.02, Math.min(20, camera.zoom * factor));
    camera.zoom = newScale;
    tunables.zoom = newScale;
    viewportEl.classList.add('dragging');
    if (scene.mode !== 'solid') {
      const selEdgesWhl = getSelectionEdges();
      scene.wireframe = selEdgesWhl.length > 0 ? [...baseWireframe, ...selEdgesWhl] : baseWireframe;
    }
    stripEl.innerHTML = rasterize(scene);
    debouncedRebake();
  }, { passive: false });

  if (wantStats) {
    statsEl.classList.add('active');
    let fpsFrames = 0;
    let fpsStart = 0;
    const fpsTick = (now: number): void => {
      if (!fpsStart) fpsStart = now;
      fpsFrames++;
      const elapsed = now - fpsStart;
      if (elapsed >= 1000) {
        const fps = Math.round((fpsFrames * 1000) / elapsed);
        statsEl.innerHTML = `FPS: <span class="stat-value">${fps}</span> · cells: <span class="stat-value">${scene.grid.cols}×${scene.grid.rows}</span>`;
        fpsFrames = 0;
        fpsStart = now;
      }
      requestAnimationFrame(fpsTick);
    };
    requestAnimationFrame(fpsTick);
  }

  window.addEventListener('resize', debounce(() => {
    cellMetrics = measureCell();
    sceneHost.style.setProperty('--cell-fs', `${cellMetrics.fontSize}px`);
    sceneHost.style.setProperty('--cell-h', `${cellMetrics.cellH}px`);
    const next = computeGrid(cellMetrics.cellW, cellMetrics.cellH);
    if (next.cols === scene.grid.cols && next.rows === scene.grid.rows) return;
    scene.grid = next;
    sceneHost.style.setProperty('--rows', String(next.rows));
    bakeAndApply();
  }, 250));

  demoEl.querySelector('.glyph-demo__tabs')?.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('.glyph-demo__tab') as HTMLElement | null;
    if (!btn) return;
    const fw = btn.dataset.fw;
    demoEl.querySelectorAll('.glyph-demo__tab').forEach((t) =>
      t.classList.toggle('active', (t as HTMLElement).dataset.fw === fw));
    demoEl.querySelectorAll('.glyph-demo__snippet').forEach((p) =>
      p.classList.toggle('glyph-demo__snippet--hidden', (p as HTMLElement).dataset.fw !== fw));
  });

  function updateCode(): void {
    const t = tunables;
    if (codeEls.vanilla) {
      codeEls.vanilla.textContent = [
        'import { createGlyphScene } from "glyphcss";',
        '',
        'const host = document.getElementById("scene");',
        'createGlyphScene(host, {',
        `  rotX: ${t.rotX.toFixed(2)},`,
        `  scale: ${t.scale.toFixed(3)},`,
        `  stretch: ${t.stretch.toFixed(2)},`,
        `  distance: ${t.distance.toFixed(2)},`,
        `  geometry: "${t.geometry}",`,
        `  animate: { axis: "y", durationMs: ${t.duration * 1000} },`,
        '});',
      ].join('\n');
    }
    if (codeEls.react) {
      codeEls.react.textContent = [
        'import { GlyphCamera, GlyphScene, GlyphOrbitControls, GlyphMesh } from "@glyphcss/react";',
        '',
        'export function App() {',
        '  return (',
        `    <GlyphCamera rotX={${t.rotX.toFixed(2)}} scale={${t.scale.toFixed(3)}} distance={${t.distance.toFixed(2)}}>`,
        '      <GlyphScene>',
        '        <GlyphOrbitControls drag wheel />',
        `        <GlyphMesh geometry="${t.geometry}" />`,
        '      </GlyphScene>',
        '    </GlyphCamera>',
        '  );',
        '}',
      ].join('\n');
    }
    if (codeEls.vue) {
      codeEls.vue.textContent = [
        '<template>',
        `  <GlyphCamera :rot-x="${t.rotX.toFixed(2)}" :scale="${t.scale.toFixed(3)}" :distance="${t.distance.toFixed(2)}">`,
        '    <GlyphScene>',
        '      <GlyphOrbitControls drag wheel />',
        `      <GlyphMesh geometry="${t.geometry}" />`,
        '    </GlyphScene>',
        '  </GlyphCamera>',
        '</template>',
        '',
        '<script setup lang="ts">',
        'import { GlyphCamera, GlyphScene, GlyphOrbitControls, GlyphMesh } from "@glyphcss/vue";',
        '</script>',
      ].join('\n');
    }
  }

  // Initial render. If data-mesh is set, fetch+load that mesh (which rebakes
  // on success). Otherwise bake the built-in geometry now.
  const initialMeshUrl = demoEl.getAttribute('data-mesh');
  if (initialMeshUrl) {
    void setMeshUrl(initialMeshUrl);
  } else {
    bakeAndApply();
  }
}

function debounce(fn: (...args: unknown[]) => void, ms: number) {
  let t: number | undefined;
  return (...args: unknown[]) => {
    if (t) window.clearTimeout(t);
    t = window.setTimeout(() => fn(...args), ms);
  };
}

export function initAllGlyphDemos(): void {
  document.querySelectorAll<HTMLElement>('.glyph-demo').forEach(initGlyphDemo);
}

document.addEventListener('astro:page-load', initAllGlyphDemos);
if (document.readyState !== 'loading') initAllGlyphDemos();
else document.addEventListener('DOMContentLoaded', initAllGlyphDemos);
