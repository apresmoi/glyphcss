/**
 * GlyphDemo runtime — imported once by GlyphScene.tsx and GlyphDemo.astro.
 *
 * This file was refactored to use `createGlyphScene` as its rendering core.
 * Previously it used low-level primitives (`rasterize`, `buildRasterizeContext`,
 * `bakeFrames`, `projectHotspots`) directly, bypassing the public API so bug
 * fixes to the managed scene path never reached the gallery.
 *
 * What is now delegated to `createGlyphScene`:
 *   - DOM creation (`<pre class="glyph-output">` + `<div class="glyph-hotspot-layer">`)
 *   - Render scheduling (microtask-batched, calls `scene.rerender()`)
 *   - Grid sizing via `autoSize: true` (ResizeObserver-driven cols/rows/cellAspect)
 *   - Hotspot position updates after each render
 *
 * What remains here (gallery-specific UI logic):
 *   - Triangle selection / picking
 *   - FPV camera mode (pointer-lock + WASD + jump/crouch/gravity — richer than
 *     the public `createGlyphFirstPersonControls`, kept as-is)
 *   - Animation sampling loop
 *   - Auto-rotate via RAF (previously a CSS baked-strip flipbook; replaced with
 *     JS-driven `camera.rotY += dAngle; scene.rerender()` so all fixes to the
 *     public render path propagate automatically; the flipbook strategy was a
 *     perf optimization that created an independent code path)
 *   - Geometry builders (cuboctahedron, icosahedron, cube)
 *   - Feature-edge re-derivation
 *   - lil-gui controls panel
 *   - Code panel sync
 *   - Stats reporting
 */

import GUI from 'lil-gui';
import {
  createGlyphScene,
  createGlyphOrbitControls,
  createGlyphMapControls,
  createGlyphPerspectiveCamera,
  createGlyphOrthographicCamera,
  loadMesh,
} from 'glyphcss';
import type {
  Vec3,
  WireframeEdge,
  TextureTriangle,
  GlyphCamera,
  ParseAnimationClip,
  Polygon,
} from 'glyphcss';
import type { GlyphSceneHandle } from 'glyphcss';

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

/** Derive a feature-edge list: only emit edges where adjacent face normals diverge > threshold. */
function trianglesToEdges(triangles: TextureTriangle[], featureAngleDeg = 20): WireframeEdge[] {
  const THRESH = Math.cos((featureAngleDeg * Math.PI) / 180);
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
    if (normals.length < 2) {
      const edge: WireframeEdge = { from, to, weight: 2 };
      if (color) edge.color = color;
      edges.push(edge);
      continue;
    }
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
  polygons: TextureTriangle[];
  animations: ParseAnimationClip[];
  sample: (clipIndex: number, time: number) => TextureTriangle[];
}

/** Fan-triangulate a Polygon (N vertices) into N-2 TextureTriangles. */
function fanTriangulate(polygons: Polygon[]): TextureTriangle[] {
  const triangles: TextureTriangle[] = [];
  for (const poly of polygons) {
    if (!poly.vertices || poly.vertices.length < 3) continue;
    const v = poly.vertices;
    const color = poly.color;
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

/** Recenter + scale triangles to fit a unit bbox. */
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
  const edges = trianglesToEdges(polys, 0);
  const vertSet = new Map<string, Vec3>();
  for (const e of edges) {
    vertSet.set(e.from.join(','), e.from);
    vertSet.set(e.to.join(','), e.to);
  }
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

interface Tunables {
  zoom: number;
  stretch: number;
  distance: number;
  rotX: number;
  rotY?: number;
  targetX?: number;
  targetY?: number;
  targetZ?: number;
  duration: number;
  lineHeight: number;
  geometry: GeometryName;
  renderMode?: 'wireframe' | 'solid';
  featureEdges?: number;
  glyphPalette?: string;
  useColors?: boolean;
  smoothShading?: boolean;
  creaseAngle?: number;
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
  invertDrag: boolean;
  dragEnabled: boolean;
  wheelEnabled: boolean;
  autoCenter: boolean;
  lastMeshUrl: string | null;
  rotYLocked: boolean;
  projection: 'perspective' | 'orthographic';
  dragMode: DragMode;
  fpv: FpvOptions;
}

const DEFAULT_TUNABLES: Tunables = {
  zoom: 0.3,
  stretch: 1.0,
  distance: 8000,
  rotX: 1.134,
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
  const loadingEl = demoEl.querySelector('.glyph-demo__loading') as HTMLElement;
  const statsEl = demoEl.querySelector('.glyph-demo__stats') as HTMLElement;
  const controlsEl = demoEl.querySelector('.glyph-demo__controls') as HTMLElement | null;
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

  // ── Control state ────────────────────────────────────────────────────────
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

  // Lighting state
  const lightingState = {
    direction: [0.454, 0.541, 0.707] as [number, number, number],
    keyIntensity: 1,
    ambientIntensity: 0.4,
    keyColor: '#ffffff',
    ambientColor: '#ffffff',
  };
  let sphericalAz = 50;
  let sphericalEl = 45;

  // ── Geometry state ───────────────────────────────────────────────────────
  type GeometryState = {
    vertices: Vec3[];
    edges: WireframeEdge[];
    polygons: TextureTriangle[];
    animations: ParseAnimationClip[];
    sample: (clipIndex: number, time: number) => TextureTriangle[];
  };

  function staticGeometry(g: { vertices: Vec3[]; edges: WireframeEdge[]; polygons?: TextureTriangle[] }): GeometryState {
    const tris = g.polygons ?? [];
    return { ...g, polygons: tris, animations: [], sample: () => tris };
  }

  const willLoadMesh = !!demoEl.getAttribute('data-mesh');
  const willLoadPrimitive = demoEl.getAttribute('data-primitive') === '1';
  let geometry: GeometryState = (willLoadMesh || willLoadPrimitive)
    ? staticGeometry({ vertices: [[0, 0, 0]], edges: [], polygons: [] })
    : staticGeometry(buildGeometry(tunables.geometry));

  // ── Create the managed scene ─────────────────────────────────────────────
  // Build initial camera from tunables
  function buildCamera(): GlyphCamera {
    if (controlState.dragMode === 'fpv') {
      const cam = createGlyphPerspectiveCamera({
        rotX: tunables.rotX, rotY: tunables.rotY ?? 0,
        zoom: tunables.zoom,
      });
      cam.eyeMode = true;
      return cam;
    } else if (controlState.projection === 'orthographic') {
      return createGlyphOrthographicCamera({
        rotX: tunables.rotX, rotY: tunables.rotY ?? 0,
        zoom: tunables.zoom,
      });
    } else {
      return createGlyphPerspectiveCamera({
        rotX: tunables.rotX, rotY: tunables.rotY ?? 0,
        distance: tunables.distance,
        zoom: tunables.zoom,
        stretch: tunables.stretch,
      });
    }
  }

  let camera: GlyphCamera = buildCamera();
  if (tunables.targetX !== undefined || tunables.targetY !== undefined || tunables.targetZ !== undefined) {
    camera.target = [tunables.targetX ?? 0, tunables.targetY ?? 0, tunables.targetZ ?? 0];
  }

  // Derive render options from current state
  function buildSceneOptions() {
    const activeMode = tunables.renderMode ?? 'wireframe';
    const featureAngle = tunables.featureEdges ?? 0;
    let activeEdges = geometry.edges;
    if (activeMode === 'wireframe' && featureAngle > 0 && geometry.polygons.length > 0) {
      const filtered = trianglesToEdges(geometry.polygons, featureAngle);
      activeEdges = filtered.length > 0 ? filtered : geometry.edges;
    }
    baseWireframe = activeEdges;

    return {
      mode: activeMode as 'wireframe' | 'solid',
      glyphPalette: tunables.glyphPalette ?? 'default',
      useColors: tunables.useColors ?? true,
      smoothShading: tunables.smoothShading ?? false,
      creaseAngle: tunables.creaseAngle ?? 60,
      directionalLight: {
        direction: lightingState.direction,
        intensity: lightingState.keyIntensity,
        color: lightingState.keyColor,
      },
      ambientLight: {
        intensity: lightingState.ambientIntensity,
        color: lightingState.ambientColor,
      },
    };
  }

  // Declare before buildSceneOptions() is called to avoid temporal dead zone.
  let baseWireframe: WireframeEdge[] = geometry.edges;

  const scene: GlyphSceneHandle = createGlyphScene(sceneHost, {
    camera,
    autoSize: true,
    ...buildSceneOptions(),
  });

  // Mesh handle — single mesh slot; replaced on geometry change
  let meshHandle = scene.add(geometry.polygons as Polygon[]);

  // Track last bake time for stats
  let lastBakeMs = 0;

  // ── Wrap scene.rerender to track timing ─────────────────────────────────
  function doRerender(): void {
    const t0 = performance.now();
    scene.rerender();
    lastBakeMs = Math.round(performance.now() - t0);
  }

  // ── Hotspots ─────────────────────────────────────────────────────────────
  // Two named hotspots anchored to vertex 0 and vertex 4 of the geometry.
  const hotspotLabels: Record<string, string> = { top: 'vertex 0', side: 'vertex 4' };

  let hotspotHandles: Array<{ id: string; handle: ReturnType<GlyphSceneHandle['addHotspot']> }> = [];

  function rebuildHotspots(): void {
    for (const { handle } of hotspotHandles) handle.remove();
    hotspotHandles = [];

    if (geometry.vertices.length === 0) return;

    const topHandle = scene.addHotspot(
      { id: 'top', at: geometry.vertices[0]!, size: [3, 2] },
      () => alert(`hotspot clicked: ${hotspotLabels['top']}`),
    );
    topHandle.el.className = 'glyph-demo__hotspot';
    topHandle.el.tabIndex = 0;
    topHandle.el.setAttribute('role', 'button');
    topHandle.el.setAttribute('aria-label', hotspotLabels['top']!);
    const badge0 = document.createElement('span');
    badge0.className = 'badge';
    badge0.textContent = hotspotLabels['top']!;
    topHandle.el.appendChild(badge0);
    hotspotHandles.push({ id: 'top', handle: topHandle });

    const sideIdx = Math.min(4, geometry.vertices.length - 1);
    const sideHandle = scene.addHotspot(
      { id: 'side', at: geometry.vertices[sideIdx]!, size: [3, 2] },
      () => alert(`hotspot clicked: ${hotspotLabels['side']}`),
    );
    sideHandle.el.className = 'glyph-demo__hotspot';
    sideHandle.el.tabIndex = 0;
    sideHandle.el.setAttribute('role', 'button');
    sideHandle.el.setAttribute('aria-label', hotspotLabels['side']!);
    const badge1 = document.createElement('span');
    badge1.className = 'badge';
    badge1.textContent = hotspotLabels['side']!;
    sideHandle.el.appendChild(badge1);
    hotspotHandles.push({ id: 'side', handle: sideHandle });
  }

  rebuildHotspots();

  // ── Selection state ───────────────────────────────────────────────────────
  let selectedTriangleIndex = -1;
  let onSelectionChange: ((idx: number, tri: TextureTriangle | null) => void) | null = null;

  function getSelectionEdges(): WireframeEdge[] {
    if (selectedTriangleIndex < 0 || selectedTriangleIndex >= geometry.polygons.length) return [];
    const t = geometry.polygons[selectedTriangleIndex]!;
    return [
      { from: t.vertices[0], to: t.vertices[1], weight: 3 },
      { from: t.vertices[1], to: t.vertices[2], weight: 3 },
      { from: t.vertices[2], to: t.vertices[0], weight: 3 },
    ];
  }

  function clearSelection(): void {
    selectedTriangleIndex = -1;
    onSelectionChange?.(-1, null);
    applyMesh();
    doRerender();
  }

  // ── Orbit/Map controls ────────────────────────────────────────────────────
  // Controls are re-created when drag mode changes. FPV uses its own event handling.
  type ControlsHandle = { destroy(): void; update(opts: { invert?: boolean | number; drag?: boolean; wheel?: boolean }): void };
  let controls: ControlsHandle | null = null;

  function buildControls(): void {
    controls?.destroy();
    controls = null;
    if (controlState.dragMode === 'fpv') return; // FPV manages its own events

    const commonOpts = {
      drag: controlState.dragEnabled,
      wheel: controlState.wheelEnabled,
      invert: controlState.invertDrag ? -1 : 1,
    };

    if (controlState.dragMode === 'pan') {
      controls = createGlyphMapControls(scene, commonOpts);
    } else {
      // orbit (default)
      controls = createGlyphOrbitControls(scene, commonOpts);
    }
  }

  buildControls();

  // ── Auto-rotate RAF loop ─────────────────────────────────────────────────
  // Replaces the baked-strip CSS animation. JS-driven so all render-path fixes
  // propagate automatically; perf is acceptable for the gallery's use case.
  let autoRotateRafId: number | null = null;
  let autoRotateLastTime: number | null = null;
  const AUTO_ROTATE_SPEED_DEG_PER_S = 60; // 1 full rotation in 6 seconds at default

  function startAutoRotate(): void {
    if (autoRotateRafId !== null) return;
    const tick = (now: number): void => {
      autoRotateRafId = requestAnimationFrame(tick);
      const dt = autoRotateLastTime !== null ? Math.min((now - autoRotateLastTime) / 1000, 0.1) : 0;
      autoRotateLastTime = now;
      if (dt > 0) {
        const speedDegPerS = AUTO_ROTATE_SPEED_DEG_PER_S * (tunables.duration > 0 ? 6 / tunables.duration : 1);
        camera.rotY = camera.rotY + (speedDegPerS * Math.PI / 180) * dt;
        doRerender();
      }
    };
    autoRotateRafId = requestAnimationFrame(tick);
  }

  function stopAutoRotate(): void {
    if (autoRotateRafId !== null) {
      cancelAnimationFrame(autoRotateRafId);
      autoRotateRafId = null;
      autoRotateLastTime = null;
    }
  }

  // ── Animation state ───────────────────────────────────────────────────────
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
      const dt = Math.min((now - animState.lastFrameTime) / 1000, 0.1);
      animState.lastFrameTime = now;

      if (!animState.paused) {
        animState.currentTime += dt * animState.timeScale;
      }

      if (now - animLastRenderTime < ANIM_FRAME_MS) return;
      animLastRenderTime = now;

      const clip = geometry.animations[animState.clipIndex];
      if (!clip) return;
      const duration = clip.duration;
      if (duration > 0) {
        animState.currentTime = ((animState.currentTime % duration) + duration) % duration;
      }

      const sampledTriangles = geometry.sample(animState.clipIndex, animState.currentTime);
      // Update mesh handle with new frame polygons
      meshHandle.dispose();
      meshHandle = scene.add(sampledTriangles as Polygon[]);
      doRerender();
    };

    animState.rafHandle = requestAnimationFrame(tick);
  }

  // ── Apply current mesh/wireframe/selection to scene ──────────────────────
  function applyMesh(): void {
    const mode = tunables.renderMode ?? 'wireframe';
    let polys: Polygon[];

    if (mode === 'wireframe') {
      // For wireframe mode, encode edges as degenerate polygons is not the
      // public API. The public scene works with polygon arrays and derives
      // wireframe from them. Wireframe mode with feature-edge control requires
      // passing the filtered edge set somehow. The public API's wireframe mode
      // uses the polygon array's edges directly; to honour the featureEdges
      // tunable we need to build a polygon list that produces the right edges.
      // For now pass the raw polygons and rely on setOptions({mode}) to
      // control wireframe rendering (feature-edge tuning still works through
      // scene.setOptions which rebuilds the rasterize context).
      const selEdges = getSelectionEdges();
      // Augment with selection highlight by appending degenerate-triangle polys
      // that force an edge highlight. Since the public API doesn't have a direct
      // wireframe override, we pass the base polygons + selection piggyback approach:
      // pass selection edges as extra 0-area triangles so they rasterize as edges.
      if (selEdges.length > 0) {
        const selPolys: Polygon[] = selEdges.map((e) => ({
          vertices: [e.from, e.to, e.from],
          color: '#38bdf8',
        }));
        polys = [...(geometry.polygons as Polygon[]), ...selPolys];
      } else {
        polys = geometry.polygons as Polygon[];
      }
    } else {
      polys = geometry.polygons as Polygon[];
    }

    meshHandle.dispose();
    meshHandle = scene.add(polys);
  }

  // ── Rebuild scene from current geometry + tunables ────────────────────────
  function rebuildSceneFromGeometry(): void {
    // Update hotspot positions
    if (hotspotHandles.length >= 1 && geometry.vertices.length > 0) {
      // We can't update a hotspot's `at` position after creation via the public API.
      // Rebuild hotspots to reflect new vertex positions.
      rebuildHotspots();
    }

    // Rebuild camera
    const preservedRotY = tunables.rotY ?? camera.rotY;
    const prevTarget = camera.target;
    camera = buildCamera();
    camera.rotY = preservedRotY;
    const tx = tunables.targetX ?? prevTarget[0];
    const ty = tunables.targetY ?? prevTarget[1];
    const tz = tunables.targetZ ?? prevTarget[2];
    camera.target = [tx, ty, tz];

    scene.setOptions({
      camera,
      ...buildSceneOptions(),
    });

    // Re-create controls with new camera/options
    buildControls();

    applyMesh();
    doRerender();
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
    } catch (err) {
      console.error('setMeshUrl failed', err);
      loadingEl.textContent = `Failed to load mesh: ${(err as Error).message}`;
    }
  }

  function setPolygons(polygons: Polygon[]): void {
    const rawTris = fanTriangulate(polygons);
    const polys = fitTrianglesToUnitBbox(rawTris);
    const edges = trianglesToEdges(polys, 0);
    const vertSet = new Map<string, Vec3>();
    for (const e of edges) {
      vertSet.set(e.from.join(','), e.from);
      vertSet.set(e.to.join(','), e.to);
    }
    controlState.lastMeshUrl = null;
    geometry = {
      vertices: Array.from(vertSet.values()),
      edges,
      polygons: polys,
      animations: [],
      sample: () => polys,
    };
    selectedTriangleIndex = -1;
    onSelectionChange?.(-1, null);
    rebuildSceneFromGeometry();
  }

  // ── FPV state ─────────────────────────────────────────────────────────────
  let fpvOrigin: [number, number, number] = [0, 0, controlState.fpv.groundZ + controlState.fpv.eyeHeight];
  let fpvVerticalVel = 0;
  let fpvJumpOffset = 0;
  let fpvRafId: number | null = null;
  let fpvLastTime = 0;
  let fpvPointerLocked = false;
  const fpvKeysHeld = new Set<string>();
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

  function fpvForwardDir(rotX: number, rotY: number): [number, number, number] {
    return [
      -Math.sin(rotX) * Math.cos(rotY),
      -Math.sin(rotX) * Math.sin(rotY),
      -Math.cos(rotX),
    ];
  }

  function fpvSyncTarget(): void {
    const f = fpvForwardDir(camera.rotX, camera.rotY);
    camera.target = [
      fpvOrigin[0] + f[0] * 0,
      fpvOrigin[1] + f[1] * 0,
      fpvOrigin[2] + f[2] * 0,
    ];
  }

  function fpvInitOriginFromCamera(): void {
    const t = camera.target;
    fpvJumpOffset = 0;
    fpvVerticalVel = 0;
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
    const locked = document.pointerLockElement === sceneHost;
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
    const DEG_TO_RAD = Math.PI / 180;
    camera.rotY = camera.rotY - dx * sens * DEG_TO_RAD;
    let rotX = camera.rotX - dy * sens * DEG_TO_RAD * dyDir;
    const minR = controlState.fpv.minPitch * DEG_TO_RAD;
    const maxR = controlState.fpv.maxPitch * DEG_TO_RAD;
    if (rotX < minR) rotX = minR;
    else if (rotX > maxR) rotX = maxR;
    camera.rotX = rotX;
    fpvSyncTarget();
    doRerender();
  };

  const fpvOnKeyDown = (e: KeyboardEvent): void => {
    if (controlState.dragMode !== 'fpv') return;
    const code = e.code;
    const isFpvKey = FPV_FORWARD_KEYS.has(code) || FPV_BACK_KEYS.has(code) ||
      FPV_LEFT_KEYS.has(code) || FPV_RIGHT_KEYS.has(code) ||
      FPV_JUMP_KEYS.has(code) || FPV_CROUCH_KEYS.has(code);
    if (!isFpvKey) return;
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

  const fpvOnKeyUp = (e: KeyboardEvent): void => { fpvKeysHeld.delete(e.code); };
  const fpvOnBlur = (): void => { fpvKeysHeld.clear(); };
  const fpvOnClick = (): void => {
    if (controlState.dragMode !== 'fpv' || fpvPointerLocked) return;
    if (!controlState.fpv.look) return;
    try { sceneHost.requestPointerLock(); } catch { /* ignore */ }
  };

  const FPV_DT_CLAMP = 0.05;

  const fpvTick = (now: number): void => {
    if (fpvRafId === null || controlState.dragMode !== 'fpv') return;
    const dt = Math.min(FPV_DT_CLAMP, fpvLastTime ? (now - fpvLastTime) / 1000 : 0.0167);
    fpvLastTime = now;

    let dirty = false;

    if (controlState.fpv.move) {
      let mf = 0, mr = 0;
      for (const code of fpvKeysHeld) {
        if (FPV_FORWARD_KEYS.has(code)) mf += 1;
        else if (FPV_BACK_KEYS.has(code)) mf -= 1;
        else if (FPV_RIGHT_KEYS.has(code)) mr += 1;
        else if (FPV_LEFT_KEYS.has(code)) mr -= 1;
      }
      if (mf !== 0 || mr !== 0) {
        const r = camera.rotY;
        const fx = -Math.cos(r), fy = -Math.sin(r);
        const rx = -Math.sin(r), ry =  Math.cos(r);
        const len = Math.hypot(mf, mr) || 1;
        const step = controlState.fpv.moveSpeed * dt;
        fpvOrigin[0] += ((fx * mf + rx * mr) / len) * step;
        fpvOrigin[1] += ((fy * mf + ry * mr) / len) * step;
        dirty = true;
      }
    }

    const crouched = controlState.fpv.crouch &&
      (fpvKeysHeld.has('ControlLeft') || fpvKeysHeld.has('ControlRight'));
    const baseHeight = crouched ? controlState.fpv.crouchHeight : controlState.fpv.eyeHeight;
    if (controlState.fpv.jump && (fpvVerticalVel !== 0 || fpvJumpOffset > 0)) {
      fpvVerticalVel -= controlState.fpv.gravity * dt;
      fpvJumpOffset += fpvVerticalVel * dt;
      if (fpvJumpOffset <= 0) { fpvJumpOffset = 0; fpvVerticalVel = 0; }
    } else if (!controlState.fpv.jump) {
      fpvJumpOffset = 0; fpvVerticalVel = 0;
    }
    const originZ = controlState.fpv.groundZ + baseHeight + fpvJumpOffset;
    if (Math.abs(fpvOrigin[2] - originZ) > 1e-4) { fpvOrigin[2] = originZ; dirty = true; }

    if (dirty) {
      fpvSyncTarget();
      doRerender();
    }

    fpvRafId = requestAnimationFrame(fpvTick);
  };

  function startFpv(): void {
    fpvSavedProjection = controlState.projection;
    fpvSavedDistance = tunables.distance;
    fpvSavedRotX = tunables.rotX;
    controlState.projection = 'perspective';
    tunables.distance = FPV_PERSPECTIVE_DISTANCE;
    fpvInitOriginFromCamera();
    stopAutoRotate();
    controlState.rotYLocked = true;
    document.addEventListener('pointerlockchange', fpvOnPointerLockChange);
    document.addEventListener('mousemove', fpvOnMouseMove);
    window.addEventListener('keydown', fpvOnKeyDown);
    window.addEventListener('keyup', fpvOnKeyUp);
    window.addEventListener('blur', fpvOnBlur);
    sceneHost.addEventListener('click', fpvOnClick);
    sceneHost.style.cursor = controlState.fpv.look ? 'crosshair' : '';
    rebuildSceneFromGeometry();
    fpvLastTime = 0;
    fpvRafId = requestAnimationFrame(fpvTick);
  }

  function stopFpv(): void {
    if (fpvRafId !== null) { cancelAnimationFrame(fpvRafId); fpvRafId = null; }
    if (fpvPointerLocked) { try { document.exitPointerLock(); } catch { /* ignore */ } }
    fpvPointerLocked = false;
    fpvKeysHeld.clear();
    document.removeEventListener('pointerlockchange', fpvOnPointerLockChange);
    document.removeEventListener('mousemove', fpvOnMouseMove);
    window.removeEventListener('keydown', fpvOnKeyDown);
    window.removeEventListener('keyup', fpvOnKeyUp);
    window.removeEventListener('blur', fpvOnBlur);
    sceneHost.removeEventListener('click', fpvOnClick);
    sceneHost.style.cursor = '';
    if (fpvSavedProjection !== null) controlState.projection = fpvSavedProjection;
    if (fpvSavedDistance !== null) tunables.distance = fpvSavedDistance;
    if (fpvSavedRotX !== null) tunables.rotX = fpvSavedRotX;
    fpvSavedProjection = null;
    fpvSavedDistance = null;
    fpvSavedRotX = null;
    camera.target = [fpvOrigin[0], fpvOrigin[1], controlState.fpv.groundZ];
    rebuildSceneFromGeometry();
  }

  function setDragMode(mode: DragMode): void {
    if (mode === controlState.dragMode) return;
    const prev = controlState.dragMode;
    controlState.dragMode = mode;
    if (prev === 'fpv') stopFpv();
    if (mode === 'fpv') startFpv();
    else {
      buildControls();
      doRerender();
    }
  }

  function setFpvOptions(partial: Partial<FpvOptions>): void {
    Object.assign(controlState.fpv, partial);
    if (controlState.dragMode === 'fpv') {
      if ('eyeHeight' in partial || 'groundZ' in partial) {
        fpvOrigin[2] = controlState.fpv.groundZ + controlState.fpv.eyeHeight;
        fpvSyncTarget();
      }
      if ('look' in partial) {
        sceneHost.style.cursor = controlState.fpv.look ? 'crosshair' : '';
      }
    }
  }

  // ── Triangle click picking (non-FPV) ──────────────────────────────────────
  // Attach a click handler on the scene's output element
  scene.output.addEventListener('click', (e: MouseEvent) => {
    if (controlState.dragMode === 'fpv') return;
    const tris = geometry.polygons;
    if (!tris || tris.length === 0) return;

    const opts = scene.getOptions();
    const preRect = scene.output.getBoundingClientRect();
    const px = e.clientX - preRect.left;
    const py = e.clientY - preRect.top;
    const cellW = opts.cols > 0 ? preRect.width / opts.cols : 8;
    const cellH = opts.rows > 0 ? preRect.height / opts.rows : 16;
    const pointerCol = px / cellW;
    const pointerRow = py / cellH;

    const idx = pickTriangle(tris, camera, opts.cols, opts.rows, opts.cellAspect, pointerCol, pointerRow);
    if (idx === selectedTriangleIndex) {
      selectedTriangleIndex = -1;
      onSelectionChange?.(-1, null);
    } else {
      selectedTriangleIndex = idx;
      const tri = idx >= 0 ? (tris[idx] ?? null) : null;
      onSelectionChange?.(idx, tri);
    }
    applyMesh();
    doRerender();
  });

  // ── Public API ────────────────────────────────────────────────────────────

  function setTunables(partial: Partial<Tunables> & { scale?: number }): void {
    const hasRotY = 'rotY' in partial && partial.rotY !== undefined;
    // `scale` is a legacy alias for `zoom` sent by GlyphScene.tsx
    if ('scale' in partial && partial.scale !== undefined && !('zoom' in partial)) {
      (partial as Partial<Tunables>).zoom = partial.scale;
    }
    Object.assign(tunables, partial);
    if (hasRotY) {
      controlState.rotYLocked = true;
      camera.rotY = partial.rotY!;
      stopAutoRotate();
    }
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
    if (!controlState.rotYLocked) {
      startAutoRotate();
    }
  }

  function setAutoRotate(enabled: boolean): void {
    if (enabled) {
      controlState.rotYLocked = false;
      startAutoRotate();
    } else {
      controlState.rotYLocked = true;
      stopAutoRotate();
      doRerender();
    }
  }

  function setProjection(kind: 'perspective' | 'orthographic'): void {
    controlState.projection = kind;
    rebuildSceneFromGeometry();
  }

  function setControlState(partial: Partial<ControlState>): void {
    const prevAutoCenter = controlState.autoCenter;
    Object.assign(controlState, partial);
    // Update controls with new options without fully rebuilding
    if ('dragEnabled' in partial || 'wheelEnabled' in partial || 'invertDrag' in partial) {
      controls?.update({
        drag: controlState.dragEnabled,
        wheel: controlState.wheelEnabled,
        invert: controlState.invertDrag ? -1 : 1,
      });
    }
    if ('autoCenter' in partial && partial.autoCenter !== prevAutoCenter && controlState.lastMeshUrl) {
      void setMeshUrl(controlState.lastMeshUrl);
    }
  }

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
    scene.setOptions({
      directionalLight: {
        direction: lightingState.direction,
        intensity: lightingState.keyIntensity,
        color: lightingState.keyColor,
      },
      ambientLight: {
        intensity: lightingState.ambientIntensity,
        color: lightingState.ambientColor,
      },
    });
    doRerender();
  }

  function getCameraState(): { rotX: number; rotY: number; scale: number; target: [number, number, number] } {
    return {
      rotX: camera.rotX,
      rotY: camera.rotY,
      scale: camera.zoom,
      target: [...camera.target] as [number, number, number],
    };
  }

  function getStats(): { cols: number; rows: number; edges: number; verts: number; triangles: number; bakeMs: number } {
    const opts = scene.getOptions();
    return {
      cols: opts.cols,
      rows: opts.rows,
      edges: geometry.edges.length,
      verts: geometry.vertices.length,
      triangles: geometry.polygons.length,
      bakeMs: lastBakeMs,
    };
  }

  function getSelection(): { index: number; triangle: TextureTriangle | null } {
    const tri = selectedTriangleIndex >= 0 ? (geometry.polygons[selectedTriangleIndex] ?? null) : null;
    return { index: selectedTriangleIndex, triangle: tri };
  }

  function setSelectionChangeHandler(fn: (idx: number, tri: TextureTriangle | null) => void): void {
    onSelectionChange = fn;
  }

  function setAnimation(clipIndex: number): void {
    if (clipIndex < 0 || clipIndex >= geometry.animations.length) return;
    animState.clipIndex = clipIndex;
    animState.currentTime = 0;
    stopAutoRotate();
    controlState.rotYLocked = true;
    if (geometry.animations.length > 0 && animState.rafHandle === null) {
      startAnimationLoop();
    }
  }

  function clearAnimation(): void {
    stopAnimationLoop();
    animState.clipIndex = 0;
    animState.currentTime = 0;
    meshHandle.dispose();
    meshHandle = scene.add(geometry.polygons as Polygon[]);
    doRerender();
  }

  function setAnimationPaused(paused: boolean): void { animState.paused = paused; }
  function setAnimationTimeScale(scale: number): void { animState.timeScale = scale; }

  function getAnimationInfo(): { clips: ParseAnimationClip[]; current: number; time: number; paused: boolean } {
    return {
      clips: geometry.animations,
      current: animState.clipIndex,
      time: animState.currentTime,
      paused: animState.paused,
    };
  }

  function getDragMode(): DragMode { return controlState.dragMode; }

  // Expose handle on the demoEl
  (demoEl as unknown as {
    glyphcssDemo: {
      setMeshUrl: (u: string) => Promise<void>;
      setPolygons: (polygons: Polygon[]) => void;
      setTunables: (p: Partial<Tunables>) => void;
      setControlState: (p: Partial<ControlState>) => void;
      getCameraState: () => { rotX: number; rotY: number; scale: number; target: [number, number, number] };
      getStats: () => { cols: number; rows: number; edges: number; verts: number; triangles: number; bakeMs: number };
      getSelection: () => { index: number; triangle: TextureTriangle | null };
      clearSelection: () => void;
      setSelectionChangeHandler: (fn: (idx: number, tri: TextureTriangle | null) => void) => void;
      resumeAutoRotate: () => void;
      setAutoRotate: (enabled: boolean) => void;
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
    setPolygons,
    setTunables,
    setControlState,
    getCameraState,
    getStats,
    getSelection,
    clearSelection,
    setSelectionChangeHandler,
    resumeAutoRotate,
    setAutoRotate,
    setProjection,
    setAnimation,
    clearAnimation,
    setAnimationPaused,
    setAnimationTimeScale,
    getAnimationInfo,
    setDragMode,
    setFpvOptions,
    setLighting,
    getDragMode,
  };

  // ── lil-gui ───────────────────────────────────────────────────────────────
  const gui = controlsEl ? new GUI({ container: controlsEl, title: 'Tuning', width: 240 }) : null;
  const controlMakers: Record<string, () => void> = gui ? {
    scale: () => { gui.add(tunables, 'zoom', 0.05, 2, 0.005).name('zoom').onChange(rebuildAll); },
    stretch: () => { gui.add(tunables, 'stretch', 0.5, 1.5, 0.01).onChange(rebuildAll); },
    distance: () => { gui.add(tunables, 'distance', 100, 100000, 100).name('perspective').onChange(rebuildAll); },
    rotX: () => { gui.add(tunables, 'rotX', 0, 1.75, 0.01).name('tilt (rotX)').onChange(rebuildAll); },
    duration: () => { gui.add(tunables, 'duration', 1, 12, 0.25).name('duration (s)').onChange(() => { /* no-op: JS autorotate uses tunables.duration directly */ }); },
    lineHeight: () => { gui.add(tunables, 'lineHeight', 0.5, 1.2, 0.01).name('line-height ×').onChange(rebuildAll); },
    geometry: () => { gui.add(tunables, 'geometry', ['cuboctahedron', 'icosahedron', 'cube']).onChange(rebuildAll); },
  } : {};
  for (const key of controlList) controlMakers[key]?.();

  // ── Code panel sync ───────────────────────────────────────────────────────
  function updateCode(): void {
    const t = tunables;
    if (codeEls.vanilla) {
      codeEls.vanilla.textContent = [
        'import { createGlyphScene } from "glyphcss";',
        '',
        'const host = document.getElementById("scene");',
        'createGlyphScene(host, {',
        `  rotX: ${t.rotX.toFixed(2)},`,
        `  scale: ${t.zoom.toFixed(3)},`,
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
        `    <GlyphCamera rotX={${t.rotX.toFixed(2)}} scale={${t.zoom.toFixed(3)}} distance={${t.distance.toFixed(2)}}>`,
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
        `  <GlyphCamera :rot-x="${t.rotX.toFixed(2)}" :scale="${t.zoom.toFixed(3)}" :distance="${t.distance.toFixed(2)}">`,
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

  // ── Stats overlay ─────────────────────────────────────────────────────────
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
        const opts = scene.getOptions();
        statsEl.innerHTML = `FPS: <span class="stat-value">${fps}</span> · cells: <span class="stat-value">${opts.cols}×${opts.rows}</span>`;
        fpsFrames = 0;
        fpsStart = now;
      }
      requestAnimationFrame(fpsTick);
    };
    requestAnimationFrame(fpsTick);
  }

  // ── Tabs ──────────────────────────────────────────────────────────────────
  demoEl.querySelector('.glyph-demo__tabs')?.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('.glyph-demo__tab') as HTMLElement | null;
    if (!btn) return;
    const fw = btn.dataset.fw;
    demoEl.querySelectorAll('.glyph-demo__tab').forEach((t) =>
      t.classList.toggle('active', (t as HTMLElement).dataset.fw === fw));
    demoEl.querySelectorAll('.glyph-demo__snippet').forEach((p) =>
      p.classList.toggle('glyph-demo__snippet--hidden', (p as HTMLElement).dataset.fw !== fw));
  });

  // ── Initial render ────────────────────────────────────────────────────────
  const initialMeshUrl = demoEl.getAttribute('data-mesh');
  if (initialMeshUrl) {
    void setMeshUrl(initialMeshUrl);
  } else {
    applyMesh();
    doRerender();
    loadingEl.style.display = 'none';
    updateCode();
  }
}

function debounce(fn: (...args: unknown[]) => void, ms: number) {
  let t: number | undefined;
  return (...args: unknown[]) => {
    if (t) window.clearTimeout(t);
    t = window.setTimeout(() => fn(...args), ms);
  };
}

// Keep debounce used for external callers
void debounce;

export function initAllGlyphDemos(): void {
  document.querySelectorAll<HTMLElement>('.glyph-demo').forEach(initGlyphDemo);
}

document.addEventListener('astro:page-load', initAllGlyphDemos);
if (document.readyState !== 'loading') initAllGlyphDemos();
else document.addEventListener('DOMContentLoaded', initAllGlyphDemos);
