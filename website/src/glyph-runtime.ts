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
  createGlyphFirstPersonControls,
  createGlyphPerspectiveCamera,
  createGlyphOrthographicCamera,
  loadMesh,
  planePolygons,
} from 'glyphcss';
import type {
  Vec3,
  WireframeEdge,
  TextureTriangle,
  GlyphCamera,
  ParseAnimationClip,
  Polygon,
  LoadMeshOptions,
  GlyphEffectDefinition,
  GlyphEffectLayerHandle,
  GlyphEffectParamSchema,
  GlyphControlSceneManifest,
  GlyphObjectDictionary,
  GlyphSemanticCellFrame,
} from 'glyphcss';
import type { GlyphSceneHandle, GlyphFirstPersonControlsHandle, GlyphFirstPersonControlsOptions } from 'glyphcss';
import { resolveGeometry } from '@glyphcss/core';
import { getSolidWeightRamp } from './components/GalleryWorkbench/weightedRamp';
import { computeGlyphAtlasAvailability } from './lib/glyphAtlasAvailability';
import { defaultGlyphColorEncoding } from './lib/glyphColorEncodingDefault';

type GeometryName = 'cuboctahedron' | 'icosahedron' | 'cube';

type RuntimeEffectParam = string | number | boolean;
type RuntimeEffectConfig = {
  effect: unknown;
  params: Record<string, RuntimeEffectParam>;
  blend: 'replace' | 'over';
  paused: boolean;
  timeScale: number;
};

type RuntimeEffectLayer = GlyphEffectLayerHandle<Record<string, RuntimeEffectParam>>;
type RuntimeSemanticOutput = { sceneManifest: GlyphControlSceneManifest; dictionary: GlyphObjectDictionary } | null;

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

/**
 * Derive a wireframe edge list from polygons of arbitrary vertex count.
 *
 * Two things going on:
 *   1. **Outline-only edges.** Each polygon contributes `verts[i] → verts[(i+1) % N]`
 *      for i ∈ [0, N) — its actual N-gon boundary. The previous implementation
 *      hardcoded `[[0,1],[1,2],[2,0]]` which is correct for triangles but for a
 *      quad it falsely emits `[2,0]` (the diagonal) and ignores vertex 3. That
 *      produced spurious "X" diagonals across every cube / quad face.
 *   2. **Coplanar-adjacent merge via face-normal feature filter.** When the
 *      same edge is shared by two polygons with similar face normals (angle
 *      below `featureAngleDeg`), the edge is interior to a flat region and is
 *      dropped. Triangulated meshes (file imports where a cube comes in as 12
 *      triangles) thus collapse their internal diagonals back into the 6
 *      perceived quad faces — same look as if the cube were authored as quads.
 *
 * Backward-compatible: for triangle input the outline iteration produces the
 * same `[0,1], [1,2], [2,0]` set as before.
 */
function trianglesToEdges(triangles: TextureTriangle[], featureAngleDeg = 20): WireframeEdge[] {
  const THRESH = Math.cos((featureAngleDeg * Math.PI) / 180);
  const edgeFaces = new Map<string, { normals: Array<[number, number, number]>; from: Vec3; to: Vec3; color?: string }>();
  for (const t of triangles) {
    const verts = t.vertices;
    if (verts.length < 2) continue;
    const n = faceNormal(t);
    for (let i = 0; i < verts.length; i++) {
      const a = verts[i]!, b = verts[(i + 1) % verts.length]!;
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
  dispose?: () => void;
}

/** Fan-triangulate a Polygon (N vertices) into N-2 TextureTriangles. */
function fanTriangulate(polygons: Polygon[]): TextureTriangle[] {
  const triangles: TextureTriangle[] = [];
  for (const poly of polygons) {
    if (!poly.vertices || poly.vertices.length < 3) continue;
    const v = poly.vertices;
    const color = poly.color;
    // Texture URL (carried through so the renderer can sample it per cell).
    const texture = poly.material?.texture ?? poly.texture;
    if (poly.textureTriangles && poly.textureTriangles.length > 0) {
      for (const t of poly.textureTriangles) triangles.push(texture ? { ...t, texture } : t);
      continue;
    }
    const uvs = poly.uvs;
    const hasUvs = !!uvs && uvs.length === v.length;
    for (let i = 1; i < v.length - 1; i++) {
      const tri: TextureTriangle = {
        vertices: [v[0]!, v[i]!, v[i + 1]!],
        uvs: hasUvs ? [uvs![0]!, uvs![i]!, uvs![i + 1]!] : [[0, 0], [0, 0], [0, 0]],
      };
      if (color) tri.color = color;
      if (texture) tri.texture = texture;
      triangles.push(tri);
    }
  }
  return triangles;
}

/** Re-center polygons so their bbox center sits at the origin (center only, no
 * scaling — matches voxcss `autoCenter`). The camera auto-fit handles size. */
function recenterPolygons(polygons: Polygon[]): Polygon[] {
  if (polygons.length === 0) return polygons;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const p of polygons) for (const v of p.vertices) {
    if (v[0] < minX) minX = v[0]; if (v[0] > maxX) maxX = v[0];
    if (v[1] < minY) minY = v[1]; if (v[1] > maxY) maxY = v[1];
    if (v[2] < minZ) minZ = v[2]; if (v[2] > maxZ) maxZ = v[2];
  }
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, cz = (minZ + maxZ) / 2;
  return polygons.map((p) => ({
    ...p,
    vertices: p.vertices.map((v) => [v[0] - cx, v[1] - cy, v[2] - cz]) as Polygon["vertices"],
  }));
}

/**
 * Derive wireframe edges from polygon outlines (not triangle edges). For each
 * polygon, emit edges between consecutive vertices: `verts[i] → verts[(i+1) % N]`.
 *
 * When `featureAngleDeg > 0`, drop edges where adjacent polygons' face normals
 * diverge by LESS than that threshold (the edge is interior to a coplanar
 * region — e.g., the diagonal of two coplanar triangles that together form a
 * quad). Threshold `0` keeps every outline edge.
 */
function polygonsToWireframeEdges(polygons: Polygon[], featureAngleDeg = 0): WireframeEdge[] {
  const edgeFaces = new Map<string, { normals: Array<[number, number, number]>; from: Vec3; to: Vec3; color?: string }>();
  for (const p of polygons) {
    const verts = p.vertices;
    if (verts.length < 2) continue;
    // Face normal from the first non-colinear triplet — good enough for the
    // shapes we render (planar N-gons + fan-triangulated triangles).
    let n: [number, number, number] = [0, 0, 0];
    if (verts.length >= 3) {
      const a = verts[0]!, b = verts[1]!, c = verts[2]!;
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
      const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const L = Math.hypot(nx, ny, nz) || 1;
      n = [nx / L, ny / L, nz / L];
    }
    for (let i = 0; i < verts.length; i++) {
      const a = verts[i]!, b = verts[(i + 1) % verts.length]!;
      const k1 = `${a[0]},${a[1]},${a[2]}`;
      const k2 = `${b[0]},${b[1]},${b[2]}`;
      const key = k1 < k2 ? `${k1}|${k2}` : `${k2}|${k1}`;
      const existing = edgeFaces.get(key);
      if (existing) existing.normals.push(n);
      else edgeFaces.set(key, { normals: [n], from: a, to: b, color: p.color });
    }
  }
  if (featureAngleDeg <= 0) {
    return Array.from(edgeFaces.values()).map(({ from, to, color }) => {
      const e: WireframeEdge = { from, to, weight: 2 };
      if (color) e.color = color;
      return e;
    });
  }
  const THRESH = Math.cos((featureAngleDeg * Math.PI) / 180);
  const out: WireframeEdge[] = [];
  for (const { normals, from, to, color } of edgeFaces.values()) {
    if (normals.length < 2) {
      const e: WireframeEdge = { from, to, weight: 2 };
      if (color) e.color = color;
      out.push(e);
      continue;
    }
    let isFeature = false;
    outer: for (let i = 0; i < normals.length; i++) {
      for (let j = i + 1; j < normals.length; j++) {
        const a = normals[i]!, b = normals[j]!;
        const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
        if (dot < THRESH) { isFeature = true; break outer; }
      }
    }
    if (isFeature) {
      const e: WireframeEdge = { from, to, weight: 2 };
      if (color) e.color = color;
      out.push(e);
    }
  }
  return out;
}

/** Largest bounding-box dimension of a polygon set (0 if empty). Used to scale
 * world-unit params (shadow lift) now that meshes keep their authored scale. */
function bboxMaxDim(polygons: Polygon[]): number {
  if (!polygons || polygons.length === 0) return 0;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const p of polygons) for (const v of p.vertices) {
    if (v[0] < minX) minX = v[0]; if (v[0] > maxX) maxX = v[0];
    if (v[1] < minY) minY = v[1]; if (v[1] > maxY) maxY = v[1];
    if (v[2] < minZ) minZ = v[2]; if (v[2] > maxZ) maxZ = v[2];
  }
  return Math.max(maxX - minX, maxY - minY, maxZ - minZ);
}

/** Recenter triangles so their bbox center sits at the origin (center only). */
function recenterTriangles(triangles: TextureTriangle[]): TextureTriangle[] {
  if (triangles.length === 0) return triangles;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const t of triangles) for (const v of t.vertices) {
    if (v[0] < minX) minX = v[0]; if (v[0] > maxX) maxX = v[0];
    if (v[1] < minY) minY = v[1]; if (v[1] > maxY) maxY = v[1];
    if (v[2] < minZ) minZ = v[2]; if (v[2] > maxZ) maxZ = v[2];
  }
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, cz = (minZ + maxZ) / 2;
  return triangles.map((t) => ({
    ...t,
    vertices: t.vertices.map((v) => [v[0] - cx, v[1] - cy, v[2] - cz]) as TextureTriangle["vertices"],
  }));
}

export async function loadMeshAsGeometry(
  url: string,
  normalize = true,
  mtlUrl?: string,
  options?: LoadMeshOptions,
): Promise<MeshGeometry> {
  // Resolve the companion .mtl so materials + textures load (otherwise faces
  // fall back to default colors — the "red/blue" bug). Explicit mtlUrl wins;
  // otherwise probe the sibling <basename>.mtl. The in-OBJ `mtllib` name is
  // unreliable (cottage.obj declares cottage_obj.mtl but the file is
  // cottage.mtl; rock1.obj declares Rock1.mtl but the file is rock1.mtl), so
  // we use the OBJ's own basename + .mtl, which the assets follow.
  let resolvedMtl = mtlUrl;
  if (!resolvedMtl && /\.obj(\?|#|$)/i.test(url)) {
    const sibling = url.replace(/\.obj(\?|#|$)/i, '.mtl$1');
    try { const probe = await fetch(sibling); if (probe.ok) resolvedMtl = sibling; } catch { /* no sibling .mtl */ }
  }
  const result = await loadMesh(url, {
    ...(options ?? {}),
    baseUrl: options?.baseUrl ?? url,
    ...(resolvedMtl ? { mtlUrl: resolvedMtl } : {}),
    // The gallery's renderer samples authored UV textures per cell. The legacy
    // solid sampler can replace uniform-looking textured polygons before this
    // runtime gets a chance to build its sampler map, which breaks exact
    // texture identity and makes the control path depend on a browser heuristic.
    solidTextureSamples: false,
  });
  // Textures are now sampled per cell by the renderer (UV-mapped, glyph-
  // resolution) — carried through `fanTriangulate` as `texture` + real UVs.
  // The old per-face `bakeSolidTextureSamples` flat-color pass is gone; faces
  // without a decodable texture fall back to their MTL `Kd` color.
  const rawTris = fanTriangulate(result.polygons);
  const polys = normalize ? recenterTriangles(rawTris) : rawTris;
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
      return normalize ? recenterTriangles(raw) : raw;
    };
  } else {
    sample = () => polys;
  }
  let disposed = false;
  return {
    vertices: Array.from(vertSet.values()),
    edges,
    polygons: polys,
    animations: clips,
    sample,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      result.dispose();
    },
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

interface ShadowState {
  enabled: boolean;
  opacity: number;
  lift: number;
  color: string;
  castShadow: boolean;
  receiveShadow: boolean;
  floor: boolean;
}

interface Tunables {
  zoom: number;
  stretch: number;
  distance: number;
  perspective: number;
  rotX: number;
  rotY?: number;
  targetX?: number;
  targetY?: number;
  targetZ?: number;
  duration: number;
  density: number;
  lineHeight: number;
  fontSize?: number;
  geometry: GeometryName;
  renderMode?: 'wireframe' | 'solid' | 'ink';
  featureEdges?: number;
  glyphPalette?: string;
  charMode?: 'ascii' | 'braille' | 'halfblock' | 'quadrant';
  wireframeJunctions?: boolean;
  hiddenLines?: 'show' | 'hide';
  /** Solid-mode-only font-weight-calibrated ramp toggle — see `weightedRamp.ts`. */
  solidWeightRamp?: boolean;
  /** `glyphcss` scene option — `"spans"` (default) or `"atlas"` (zero-`<span>`
   *  colour-font encoding). The atlas palette is not a tunable: `createGlyphScene`
   *  derives and pools it internally from the real cell buffers. */
  colorEncoding?: 'spans' | 'atlas';
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
  lastMtlUrl: string | null;
  lastLoadOptions: LoadMeshOptions | null;
  rotYLocked: boolean;
  projection: 'perspective' | 'orthographic';
  dragMode: DragMode;
  fpv: FpvOptions;
}

const DEFAULT_TUNABLES: Tunables = {
  zoom: 0.3,
  stretch: 1.0,
  distance: 0,
  perspective: 32000,
  rotX: 65,
  duration: 6,
  density: 1.0,
  lineHeight: 1.0,
  geometry: 'cuboctahedron',
};

const DEMO_BASE_FONT_SIZE = 10;
const DEMO_GEOMETRY_SIZE = 100;

// ── Geometry state ───────────────────────────────────────────────────────

type GeometryState = {
  vertices: Vec3[];
  edges: WireframeEdge[];
  polygons: TextureTriangle[];
  /** Original N-gon polygons (pre fan-triangulation). Wireframe edge
   *  derivation uses these so outline edges don't get polluted by
   *  fan-triangulation diagonals. Empty for triangulated mesh imports. */
  ngonPolygons?: Polygon[];
  animations: ParseAnimationClip[];
  sample: (clipIndex: number, time: number) => TextureTriangle[];
};

// ── Geometry builder ─────────────────────────────────────────────────────

/**
 * Build a docs-demo geometry from a `@glyphcss/core` registry name.
 * Mirrors the shape used by the gallery's `setPolygons`: N-gons preserved in
 * `ngonPolygons` so the wireframe path emits true outline edges, plus a
 * fan-triangulated `polygons` array for selection/sampling/stats.
 */
function buildDemoGeometry(name: GeometryName): GeometryState {
  const polygons = resolveGeometry(name, { size: DEMO_GEOMETRY_SIZE });
  const polyTris = fanTriangulate(polygons);
  const edges = polygonsToWireframeEdges(polygons, 0);
  const vertSet = new Map<string, Vec3>();
  for (const e of edges) {
    vertSet.set(e.from.join(','), e.from);
    vertSet.set(e.to.join(','), e.to);
  }
  return {
    vertices: Array.from(vertSet.values()),
    edges,
    polygons: polyTris,
    ngonPolygons: polygons,
    animations: [],
    sample: () => polyTris,
  };
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

  // With absolute (px-per-world-unit) zoom, a fixed default no longer auto-fits
  // the object to the viewport the way the old fraction-zoom did. So unless a
  // demo PINS an explicit `zoom`, we fit-to-content after load/resize so the
  // mesh fills its container. Demos that pin zoom (landing hero) opt out.
  const hasExplicitZoom = Object.prototype.hasOwnProperty.call(userDefaults, 'zoom');

  const tunables: Tunables = { ...DEFAULT_TUNABLES, geometry: initialGeometry, ...userDefaults };

  let controlList: string[] = ['scale', 'stretch', 'distance', 'rotX', 'duration', 'geometry'];
  const controlsAttr = demoEl.getAttribute('data-controls');
  if (controlsAttr) { try { controlList = JSON.parse(controlsAttr); } catch {} }

  // Decorative landing demos pass `interactive={false}`; honor that before
  // controls are built so the orbit handlers never attach in the first place.
  const interactiveAttr = demoEl.getAttribute('data-interactive');
  const allowInteract = interactiveAttr !== '0';

  // `noZoom` disables wheel/pinch zoom while keeping drag-to-orbit — used by
  // decorative demos (landing hero) that should spin but not scroll-zoom.
  const noZoom = demoEl.getAttribute('data-no-zoom') === '1';
  const showHotspots = demoEl.getAttribute('data-no-hotspots') !== '1';
  function parseInteractiveDownscale(value: string | null): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 2;
  }
  const interactiveDownscale = parseInteractiveDownscale(demoEl.getAttribute('data-interactive-downscale'));

  // Globe-style "grab and spin east" drag direction. Opposite of the default
  // camera-orbits-target sign convention used by everything else.
  const invertDragAttr = demoEl.getAttribute('data-invert-drag') === '1';

  // ── Control state ────────────────────────────────────────────────────────
  const controlState: ControlState = {
    invertDrag: invertDragAttr,
    dragEnabled: allowInteract,
    wheelEnabled: allowInteract && !noZoom,
    autoCenter: true,
    lastMeshUrl: null,
    lastMtlUrl: null,
    lastLoadOptions: null,
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

  // Shadow state
  const shadowState: ShadowState = {
    enabled: demoEl.getAttribute('data-shadow') === '1',
    opacity: parseFloat(demoEl.getAttribute('data-shadow-opacity') ?? '0.25') || 0.25,
    lift: parseFloat(demoEl.getAttribute('data-shadow-lift') ?? '0.05') || 0.05,
    color: demoEl.getAttribute('data-shadow-color') ?? '#000000',
    castShadow: demoEl.getAttribute('data-cast-shadow') === '1',
    receiveShadow: demoEl.getAttribute('data-receive-shadow') === '1',
    floor: demoEl.getAttribute('data-shadow-floor') !== '0',
  };

  // Lighting state
  const lightingState = {
    // "Shines TOWARD" convention (negated subsolar unit vector).
    // Corresponds to azimuth=50°, elevation=45° in the source-vector convention.
    direction: [0.454, 0.541, 0.707] as [number, number, number],
    keyIntensity: 1,
    ambientIntensity: 0.4,
    keyColor: '#ffffff',
    ambientColor: '#ffffff',
  };
  let sphericalAz = 50;
  let sphericalEl = 45;

  // Per-demo lighting override (`light` prop). Applied before the real-sun
  // branch so realSunLight still owns `direction` when both are present.
  const lightAttr = demoEl.getAttribute('data-light');
  if (lightAttr) {
    try {
      const l = JSON.parse(lightAttr) as { direction?: [number, number, number]; intensity?: number; ambient?: number };
      if (Array.isArray(l.direction)) lightingState.direction = l.direction;
      if (typeof l.intensity === 'number') lightingState.keyIntensity = l.intensity;
      if (typeof l.ambient === 'number') lightingState.ambientIntensity = l.ambient;
    } catch { /* malformed light attr — keep defaults */ }
  }

  // Real-time sun direction for an Earth globe. Subsolar point = lat/lon on
  // Earth where the sun is directly overhead right now. Derived from UTC
  // time + day-of-year (Earth's tilt makes the declination wobble between
  // ±23.45° over the year).
  //
  // Returned vector points from the shaded surface toward the sun.
  function realSunDirection(): [number, number, number] {
    const now = new Date();
    const utcHours = now.getUTCHours() + now.getUTCMinutes() / 60 + now.getUTCSeconds() / 3600;
    const startOfYear = Date.UTC(now.getUTCFullYear(), 0, 0);
    const dayOfYear = Math.floor((now.getTime() - startOfYear) / 86400000);
    // Solar declination (degrees): peaks at +23.45° at summer solstice (~day 172).
    const declDeg = 23.45 * Math.sin((2 * Math.PI * (dayOfYear - 80)) / 365.25);
    // Subsolar longitude: sun is at Greenwich at UTC noon; 15° east per
    // hour earlier than noon.
    const lonDeg = (12 - utcHours) * 15;
    const lat = (declDeg * Math.PI) / 180;
    const lon = (lonDeg * Math.PI) / 180;
    const cosLat = Math.cos(lat);
    return [cosLat * Math.cos(lon), -cosLat * Math.sin(lon), Math.sin(lat)];
  }

  if (demoEl.getAttribute('data-real-sun-light') === '1') {
    lightingState.direction = realSunDirection();
    // Refresh every 30s so a long-open page tracks dusk → night.
    setInterval(() => {
      lightingState.direction = realSunDirection();
      scene.setOptions({
        directionalLight: { direction: lightingState.direction, intensity: lightingState.keyIntensity, color: lightingState.keyColor },
      });
      doRerender();
    }, 30_000);
  }

  const willLoadMesh = !!demoEl.getAttribute('data-mesh');
  const willLoadPrimitive = demoEl.getAttribute('data-primitive') === '1';
  const willLoadPolygons = !!demoEl.getAttribute('data-polygons-url');
  // Only demos whose geometry comes from the built-in dropdown regenerate it on
  // a control change. Mesh / polygons-URL demos keep their loaded geometry so a
  // zoom/tilt tweak doesn't replace the mesh with a primitive.
  const usesBuiltInGeometry = !willLoadMesh && !willLoadPrimitive && !willLoadPolygons;
  // Mesh / primitive / polygons-URL demos start empty so nothing paints until
  // the real geometry loads — otherwise the built-in default primitive flashes
  // as a solid blob (the "square") while landing-earth.json is in flight.
  let geometry: GeometryState = (willLoadMesh || willLoadPrimitive || willLoadPolygons)
    ? { vertices: [[0, 0, 0]], edges: [], polygons: [], animations: [], sample: () => [] }
    : buildDemoGeometry(tunables.geometry);

  // ── Create the managed scene ─────────────────────────────────────────────
  if (tunables.fontSize === undefined && tunables.density !== 1) {
    tunables.fontSize = DEMO_BASE_FONT_SIZE / Math.max(0.1, tunables.density);
  }
  if (tunables.fontSize !== undefined) {
    sceneHost.style.fontSize = `${tunables.fontSize}px`;
  }

  // Build initial camera from tunables
  function buildCamera(): GlyphCamera {
    if (controlState.dragMode === 'fpv') {
      return createGlyphPerspectiveCamera({
        rotX: tunables.rotX, rotY: tunables.rotY ?? 0,
        perspective: tunables.perspective,
        zoom: tunables.zoom,
      });
    } else if (controlState.projection === 'orthographic') {
      return createGlyphOrthographicCamera({
        rotX: tunables.rotX, rotY: tunables.rotY ?? 0,
        zoom: tunables.zoom,
      });
    } else {
      return createGlyphPerspectiveCamera({
        rotX: tunables.rotX, rotY: tunables.rotY ?? 0,
        distance: tunables.distance,
        perspective: tunables.perspective,
        zoom: tunables.zoom,
        stretch: tunables.stretch,
      });
    }
  }

  let camera: GlyphCamera = buildCamera();
  if (tunables.targetX !== undefined || tunables.targetY !== undefined || tunables.targetZ !== undefined) {
    camera.target = [tunables.targetX ?? 0, tunables.targetY ?? 0, tunables.targetZ ?? 0];
  }

  // `colorEncoding: "atlas"` — derived (never user-tunable) disabled-state
  // reason, kept current by `recomputeAtlasAvailability` below (a
  // `MutationObserver` on the real stage `<pre>`, set up right after `scene`
  // is constructed).
  let atlasReason: string | null = 'Nothing rendered yet.';

  // Derive render options from current state
  function buildSceneOptions() {
    const activeMode = semanticOutput ? 'solid' : (tunables.renderMode ?? 'wireframe');
    const featureAngle = tunables.featureEdges ?? 0;
    let activeEdges = geometry.edges;
    if (activeMode === 'wireframe' && featureAngle > 0) {
      // Prefer original N-gon polygons when available — gives true polygon-
      // outline edges (no fan-triangulation diagonals). Fall back to the
      // fan-triangulated polygons for file-imported meshes that don't carry
      // their authored N-gons.
      const ngons = geometry.ngonPolygons;
      const filtered = ngons && ngons.length > 0
        ? polygonsToWireframeEdges(ngons, featureAngle)
        : trianglesToEdges(geometry.polygons, featureAngle);
      activeEdges = filtered.length > 0 ? filtered : geometry.edges;
    }
    baseWireframe = activeEdges;

    return {
      mode: activeMode as 'wireframe' | 'solid' | 'ink',
      glyphPalette: tunables.glyphPalette ?? 'default',
      charMode: tunables.charMode ?? 'ascii',
      wireframeJunctions: tunables.wireframeJunctions ?? false,
      hiddenLines: tunables.hiddenLines ?? 'show',
      solidWeightRamp: tunables.solidWeightRamp ? getSolidWeightRamp() ?? undefined : undefined,
      // Feature-detected site default (see glyphColorEncodingDefault.ts).
      // GlyphDemo instances have no colorEncoding UI control ("never
      // user-tunable" — see `atlasReason` below), so this is the only
      // place a demo picks up the site default; an explicit
      // `defaults='{"colorEncoding":...}'` prop still wins via `tunables`.
      colorEncoding: tunables.colorEncoding ?? defaultGlyphColorEncoding(),
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
      shadow: shadowState.enabled
        ? { color: shadowState.color, opacity: shadowState.opacity, lift: shadowState.lift * Math.max(bboxMaxDim(geometry.polygons as Polygon[]) / 2, 0.001) }
        : undefined,
    };
  }

  // Declare before buildSceneOptions() is called to avoid temporal dead zone.
  let baseWireframe: WireframeEdge[] = geometry.edges;
  // Gallery Semantic is presentation state over the public solid renderer.
  // Geometry rebuilds can happen after it is enabled, so this must be known
  // when their scene options are reconstructed as well.
  let semanticOutput: RuntimeSemanticOutput = null;

  const scene: GlyphSceneHandle = createGlyphScene(sceneHost, {
    camera,
    autoSize: true,
    // Interactive LOD: render ½-resolution (¼ cells) while dragging, full detail
    // on release — keeps high-density scenes smooth to orbit/pan.
    interactiveDownscale,
    ...buildSceneOptions(),
  });

  // Keeps `atlasReason` current by watching the stage `<pre>` directly (a
  // `MutationObserver`, not a dependency list) — mirrors /synth's and
  // /wordart's own watchers.
  function recomputeAtlasAvailability(): void {
    const result = computeGlyphAtlasAvailability(scene.output, {
      useColors: tunables.useColors ?? true,
      charMode: tunables.charMode ?? 'ascii',
    });
    atlasReason = result.reason;
  }
  recomputeAtlasAvailability();
  const atlasObserver = new MutationObserver(recomputeAtlasAvailability);
  atlasObserver.observe(scene.output, { childList: true, subtree: true, characterData: true });

  // Apply the initial line-height multiplier directly. setTunables handles
  // later updates, but on first paint we want any non-default lineHeight from
  // `defaults` (landing hero etc.) to take effect before autoSize measures the
  // cell.
  if (tunables.lineHeight !== 1) {
    scene.output.style.lineHeight = String(tunables.lineHeight);
    scene.fit();
  }

  // Mesh handle — single mesh slot; replaced on geometry change
  let meshHandle = scene.add(geometry.polygons as Polygon[], {
    castShadow: shadowState.castShadow,
    receiveShadow: shadowState.receiveShadow,
  });

  let effectLayer: RuntimeEffectLayer | null = null;
  let effectDefinition: unknown = null;
  let effectPaused = false;
  let effectTimeScale = 1;
  let effectTime = 0;
  let effectHasTime = false;
  let effectRafId: number | null = null;
  let effectLastFrame: number | null = null;

  function stopEffectLoop(): void {
    if (effectRafId !== null) cancelAnimationFrame(effectRafId);
    effectRafId = null;
    effectLastFrame = null;
  }

  function effectDefinitionHasTime(effect: unknown): boolean {
    if (!effect || typeof effect !== 'object') return false;
    const schema = (effect as { parameterSchema?: unknown }).parameterSchema;
    return !!schema && typeof schema === 'object' && 'time' in schema;
  }

  function startEffectLoop(): void {
    if (effectRafId !== null || !effectLayer || !effectHasTime || effectPaused || effectTimeScale === 0) return;
    const tick = (now: number): void => {
      effectRafId = requestAnimationFrame(tick);
      if (!effectLayer || effectPaused) return;
      const elapsed = effectLastFrame === null ? 0 : Math.min(Math.max(now - effectLastFrame, 0) / 1000, 0.1);
      effectLastFrame = now;
      if (elapsed > 0) {
        effectTime += elapsed * effectTimeScale;
        effectLayer.setParams({ time: effectTime });
      }
    };
    effectRafId = requestAnimationFrame(tick);
  }

  function configureEffect(config: RuntimeEffectConfig | null): void {
    if (!config) {
      stopEffectLoop();
      effectLayer?.dispose();
      effectLayer = null;
      effectDefinition = null;
      effectTime = 0;
      effectHasTime = false;
      return;
    }

    const params = Object.fromEntries(
      Object.entries(config.params).filter(([name]) => name !== 'time'),
    ) as Record<string, RuntimeEffectParam>;
    try {
      if (!effectLayer || effectDefinition !== config.effect) {
        stopEffectLoop();
        effectLayer?.dispose();
        effectLayer = null;
        effectDefinition = config.effect;
        effectHasTime = effectDefinitionHasTime(config.effect);
        effectLayer = scene.addEffectLayer({
          effect: config.effect as GlyphEffectDefinition<GlyphEffectParamSchema>,
          params,
          target: 'surfaces',
          blend: config.blend,
        }) as RuntimeEffectLayer;
        const initialTime = effectLayer.params.time;
        effectTime = typeof initialTime === 'number' && Number.isFinite(initialTime) ? initialTime : 0;
      } else {
        effectLayer.setParams(params);
        effectLayer.setOptions({ blend: config.blend });
      }
    } catch (error) {
      if (!effectLayer) {
        effectDefinition = null;
        effectHasTime = false;
      }
      console.warn('[glyphcss gallery] Unable to configure effect:', error);
      return;
    }

    effectPaused = config.paused;
    effectTimeScale = Number.isFinite(config.timeScale) ? Math.max(0, config.timeScale) : 1;
    if (effectPaused || effectTimeScale === 0) stopEffectLoop();
    else startEffectLoop();
  }

  /** Uses the renderer's public semantic selector; no gallery rasterizer exists. */
  function setPresentation(renderMode: 'wireframe' | 'solid' | 'ink', config: RuntimeSemanticOutput): void {
    semanticOutput = config;
    tunables.renderMode = renderMode;
    scene.setOptions(config
      // Semantic is gallery presentation state, not another renderer mode.
      // Set the compatible public mode atomically with glyphOutput so a
      // pending wireframe render cannot reject the semantic selector.
      ? { mode: 'solid', glyphOutput: 'semantic', sceneManifest: config.sceneManifest, dictionary: config.dictionary }
      : { mode: renderMode, glyphOutput: 'visible', sceneManifest: undefined, dictionary: undefined });
  }

  function getSemanticCellFrame(): GlyphSemanticCellFrame | null {
    return scene.getGlyphSemanticCellFrame();
  }

  // Floor handle — ground plane added when shadows + floor are both on.
  // Separate from meshHandle so it never enters fitContentZoom or stats.
  let floorHandle: ReturnType<typeof scene.add> | null = null;

  // The floor color is intentionally dim/dark so it reads as a neutral ground
  // rather than a prominent object. The model's shadow darkens it further.
  const FLOOR_COLOR = '#2a2d33';

  /**
   * Compute the floor polygon from the current geometry's bounding box.
   * +Z is world-up. The floor sits at the model's min-Z edge, sized 1.6× the
   * model's XY footprint so the shadow spills visibly beyond the model silhouette.
   * The model is always centered at XY=0 after recenterPolygons/loadMesh
   * auto-center, so offset=[0,0] places the floor quad at the XY origin.
   */
  function buildFloorPolygons(): Polygon[] {
    const polys = geometry.polygons as Polygon[];
    if (polys.length === 0) return [];
    let minZ = Infinity;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of polys) {
      for (const v of p.vertices) {
        if (v[2] < minZ) minZ = v[2];
        if (v[0] < minX) minX = v[0]; if (v[0] > maxX) maxX = v[0];
        if (v[1] < minY) minY = v[1]; if (v[1] > maxY) maxY = v[1];
      }
    }
    if (!isFinite(minZ)) return [];
    const xySpan = Math.max(maxX - minX, maxY - minY, 0.1);
    const halfSize = (xySpan / 2) * 1.6;
    // axis=2 → XY plane (Z is up); along=minZ positions it at the model base.
    // offset=[0,0] centers the quad at the XY origin.
    return planePolygons({ axis: 2, size: halfSize, offset: [0, 0], along: minZ, color: FLOOR_COLOR });
  }

  function rebuildFloor(): void {
    if (floorHandle) { floorHandle.dispose(); floorHandle = null; }
    if (!shadowState.enabled || !shadowState.floor) return;
    const floorPolys = buildFloorPolygons();
    if (floorPolys.length === 0) return;
    floorHandle = scene.add(floorPolys, { castShadow: false, receiveShadow: true });
  }

  // Track last bake time for stats
  let lastBakeMs = 0;

  // ── Wrap scene.rerender to track timing ─────────────────────────────────
  function doRerender(): void {
    const t0 = performance.now();
    scene.rerender();
    lastBakeMs = Math.round(performance.now() - t0);
  }

  function projectionGrid(): {
    cols: number;
    rows: number;
    cellAspect: number;
    cellWidth: number;
    cellHeight: number;
    centerCol: number;
    centerRow: number;
  } {
    const opts = scene.getOptions();
    const cols = opts.cols ?? 80;
    const rows = opts.rows ?? 24;
    const cellAspect = opts.cellAspect ?? 2;
    const hostRect = scene.host.getBoundingClientRect();
    const outputRect = scene.output.getBoundingClientRect();
    const fallbackCellHeight = 50;
    const fallbackCellWidth = fallbackCellHeight / cellAspect;
    const cellWidth = outputRect.width > 0 ? outputRect.width / cols
      : hostRect.width > 0 ? hostRect.width / cols
      : fallbackCellWidth;
    const cellHeight = outputRect.height > 0 ? outputRect.height / rows
      : hostRect.height > 0 ? hostRect.height / rows
      : fallbackCellHeight;
    const centerCol = cols * camera.center[0] +
      (opts.autoSize && hostRect.width > 0 && cellWidth > 0 ? (hostRect.width - cols * cellWidth) / (2 * cellWidth) : 0);
    const centerRow = rows * camera.center[1] +
      (opts.autoSize && hostRect.height > 0 && cellHeight > 0 ? (hostRect.height - rows * cellHeight) / (2 * cellHeight) : 0);
    return { cols, rows, cellAspect, cellWidth, cellHeight, centerCol, centerRow };
  }

  // ── Fit-to-content ───────────────────────────────────────────────────────
  // Compute the absolute camera.zoom that makes the geometry's true projected
  // silhouette fill ~`fill` of the viewport. We project the ACTUAL vertices
  // (sampled for big meshes) — NOT the 8 AABB corners: for a round object the
  // bounding-cube corners project ~√2 wider than the real silhouette, which
  // under-fills (a sphere lands at ~58% when targeting 82%). Projection scales
  // linearly with zoom, so we measure the cell extent at the current zoom and
  // scale to hit the target. Skipped for FPV / pinned-zoom demos.
  function fitContentZoom(fill = 0.85): void {
    if (hasExplicitZoom || controlState.dragMode === 'fpv') return;
    const polys = geometry.polygons as Polygon[];
    if (!polys || polys.length === 0) return;
    const grid = projectionGrid();
    const { cols, rows, cellAspect } = grid;
    const [tx, ty, tz] = camera.target;
    // Fit the bounding SPHERE around the pivot (camera target), not the
    // silhouette at the current angle. The sphere radius is rotation-invariant,
    // so the model fits at EVERY orbit angle — orbiting never grows it past the
    // grid (the old per-angle fit overflowed when you spun to a wider profile,
    // and the clipped overflow is what made the model look off-center).
    let total = 0;
    for (const p of polys) total += p.vertices.length;
    const stride = total > 3000 ? Math.ceil(total / 3000) : 1;
    let r2max = 0, i = 0;
    for (const p of polys) for (const v of p.vertices) {
      if (i++ % stride !== 0) continue;
      const dx = v[0] - tx, dy = v[1] - ty, dz = v[2] - tz;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > r2max) r2max = d2;
    }
    const R = Math.sqrt(r2max);
    if (!(R > 0)) return;
    // Per-world-unit projection scales (cols/rows) derived from camera.project,
    // so we inherit the exact cellAspect/fovScale/zoom math instead of
    // re-deriving it. Rotation is orthonormal, so projecting the three unit axes
    // and combining in quadrature gives the rotation-invariant col/row scale.
    const c0 = camera.project([tx, ty, tz], cols, rows, cellAspect, grid);
    let sCol2 = 0, sRow2 = 0;
    for (const e of [[1, 0, 0], [0, 1, 0], [0, 0, 1]] as Vec3[]) {
      const pe = camera.project([tx + e[0], ty + e[1], tz + e[2]], cols, rows, cellAspect, grid);
      const dc = pe[0] - c0[0], dr = pe[1] - c0[1];
      sCol2 += dc * dc; sRow2 += dr * dr;
    }
    const sCol = Math.sqrt(sCol2), sRow = Math.sqrt(sRow2);
    if (!(sCol > 0) || !(sRow > 0)) return;
    const factor = Math.min((fill * cols) / (2 * R * sCol), (fill * rows) / (2 * R * sRow));
    if (!isFinite(factor) || factor <= 0) return;
    const nz = Math.round((camera.zoom || 1) * factor * 10) / 10;
    camera.zoom = nz;
    tunables.zoom = nz;
  }

  // Auto-fit ONLY when the geometry itself changes (new shape/mesh) — NOT on
  // camera-control tweaks (zoom/perspective/tilt/stretch all route through
  // rebuildSceneFromGeometry, and refitting there would stomp the user's
  // change so the controls appear dead). Resize refits separately below.
  let lastFitSig: string | null = null;
  function maybeFitContent(): void {
    const sig = `${tunables.geometry}|${controlState.lastMeshUrl ?? ''}|${(geometry.polygons as Polygon[]).length}`;
    if (sig === lastFitSig) return;
    lastFitSig = sig;
    fitContentZoom();
  }

  // Refit (grid + content) on container resize so the mesh keeps filling.
  if (!hasExplicitZoom && typeof ResizeObserver !== 'undefined') {
    let refitRaf = 0;
    const refitObserver = new ResizeObserver(() => {
      cancelAnimationFrame(refitRaf);
      refitRaf = requestAnimationFrame(() => {
        scene.fit();
        fitContentZoom();
        doRerender();
      });
    });
    refitObserver.observe(sceneHost);
  }

  // ── Hotspots ─────────────────────────────────────────────────────────────
  // Two named hotspots anchored to vertex 0 and vertex 4 of the geometry.
  const hotspotLabels: Record<string, string> = { top: 'vertex 0', side: 'vertex 4' };

  let hotspotHandles: Array<{ id: string; handle: ReturnType<GlyphSceneHandle['addHotspot']> }> = [];

  function rebuildHotspots(): void {
    for (const { handle } of hotspotHandles) handle.remove();
    hotspotHandles = [];

    if (!showHotspots) return;
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

  // `data-no-clamp-pitch="1"` removes the orbit-controls vertical-rotation
  // clamp so a globe can roll past either pole.
  const noClampPitch = demoEl.getAttribute('data-no-clamp-pitch') === '1';

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
      // orbit (default) — pass through the clamp flag.
      controls = createGlyphOrbitControls(scene, { ...commonOpts, clampPitch: !noClampPitch });
    }
  }

  buildControls();

  // ── Auto-rotate RAF loop ─────────────────────────────────────────────────
  // Replaces the baked-strip CSS animation. JS-driven so all render-path fixes
  // propagate automatically; perf is acceptable for the gallery's use case.
  let autoRotateRafId: number | null = null;
  let autoRotateLastTime: number | null = null;
  const AUTO_ROTATE_SPEED_DEG_PER_S = 60; // 1 full rotation in 6 seconds at default

  // Suspended while the user is actively dragging. Without this, the autospin
  // fights direct input — the camera jerks back toward "current frame's auto
  // rotation" every time the RAF loop ticks. Set from a pointerdown listener
  // attached after the scene mounts.
  let autoRotatePaused = false;

  function startAutoRotate(): void {
    if (autoRotateRafId !== null) return;
    const tick = (now: number): void => {
      autoRotateRafId = requestAnimationFrame(tick);
      const dt = autoRotateLastTime !== null ? Math.min((now - autoRotateLastTime) / 1000, 0.1) : 0;
      autoRotateLastTime = now;
      if (dt > 0 && !autoRotatePaused) {
        const speedDegPerS = AUTO_ROTATE_SPEED_DEG_PER_S * (tunables.duration > 0 ? 6 / tunables.duration : 1);
        camera.rotY = camera.rotY + speedDegPerS * dt;
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
      meshHandle.setPolygons(sampledTriangles as Polygon[]);
    };

    animState.rafHandle = requestAnimationFrame(tick);
  }

  // ── Apply current mesh/wireframe/selection to scene ──────────────────────
  function applyMesh(): void {
    const mode = tunables.renderMode ?? 'wireframe';
    let polys: Polygon[];

    // Prefer the original N-gon polygons over the fan-triangulated set. The
    // public scene's wireframe derivation calls polygonsToWireframeEdges on
    // whatever we pass in — for triangles it emits 3 edges per face (including
    // fan diagonals); for N-gons it emits the actual outline. Same polygons
    // also work for solid mode (the rasterizer fan-triangulates internally).
    const basePolys = geometry.ngonPolygons && geometry.ngonPolygons.length > 0
      ? geometry.ngonPolygons
      : (geometry.polygons as Polygon[]);

    if (mode === 'wireframe') {
      const selEdges = getSelectionEdges();
      if (selEdges.length > 0) {
        // Selection edges piggyback as degenerate triangles so they rasterize
        // as bright overlays.
        const selPolys: Polygon[] = selEdges.map((e) => ({
          vertices: [e.from, e.to, e.from],
          color: '#38bdf8',
        }));
        polys = [...basePolys, ...selPolys];
      } else {
        polys = basePolys;
      }
    } else {
      polys = basePolys;
    }

    meshHandle.setTransform({
      castShadow: shadowState.castShadow,
      receiveShadow: shadowState.receiveShadow,
    });
    meshHandle.setPolygons(polys);
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
    // FPV uses the library control (not buildControls); it captured the prior
    // camera, so rebind it to the freshly-built one or WASD/look go dead.
    rebindFpvControl();

    applyMesh();
    rebuildFloor();
    scene.fit();
    maybeFitContent();
    doRerender();
    loadingEl.style.display = 'none';
    updateCode();
  }

  function rebuildAll(): void {
    stopAnimationLoop();
    if (usesBuiltInGeometry) {
      const previousGeometry = geometry;
      geometry = buildDemoGeometry(tunables.geometry);
      previousGeometry.dispose?.();
    }
    selectedTriangleIndex = -1;
    onSelectionChange?.(-1, null);
    rebuildSceneFromGeometry();
  }

  // Monotonic token guarding async mesh loads. Switching models fires a new
  // setMeshUrl/setPolygons before a slow earlier fetch resolves; without this
  // the stale load would overwrite the newer mesh (and re-toggle the loading
  // overlay) — the "blink, then shows the old mesh" bug. Each call bumps the
  // token; an awaited load whose token is no longer current bails.
  let meshLoadToken = 0;

  async function setMeshUrl(url: string, mtlUrl?: string, options?: LoadMeshOptions): Promise<void> {
    const token = ++meshLoadToken;
    loadingEl.style.display = 'grid';
    loadingEl.textContent = `Loading ${url.split('/').pop()}…`;
    try {
      const loaded = await loadMeshAsGeometry(url, controlState.autoCenter, mtlUrl, options);
      if (token !== meshLoadToken) { loaded.dispose?.(); return; } // superseded by a newer selection
      if (loaded.edges.length === 0) {
        loaded.dispose?.();
        loadingEl.textContent = 'Empty mesh (0 edges).';
        return;
      }
      controlState.lastMeshUrl = url;
      controlState.lastMtlUrl = mtlUrl ?? null;
      controlState.lastLoadOptions = options ?? null;
      const previousGeometry = geometry;
      geometry = loaded;
      previousGeometry.dispose?.();
      selectedTriangleIndex = -1;
      onSelectionChange?.(-1, null);
      rebuildSceneFromGeometry();
    } catch (err) {
      if (token !== meshLoadToken) return; // stale failure; a newer load owns the UI
      console.error('setMeshUrl failed', err);
      loadingEl.textContent = `Failed to load mesh: ${(err as Error).message}`;
    }
  }

  function setPolygons(polygons: Polygon[]): void {
    // Invalidate any in-flight mesh fetch so a slow load can't overwrite this
    // synchronously-applied geometry (e.g. switching to a primitive mid-load).
    meshLoadToken += 1;
    // Preserve the ORIGINAL N-gon polygons (don't fan-triangulate up front).
    // Wireframe edge derivation downstream uses the actual polygon outlines —
    // a cube stays 6 quads (12 outline edges), a dodecahedron stays 12
    // pentagons (30 outline edges). Fan-triangulating first would feed
    // triangles into trianglesToEdges and reintroduce spurious diagonals.
    // The rasterizer handles N-gons internally (fan-triangulates per render).
    const fitted = recenterPolygons(polygons);
    // Triangles for downstream code paths that still expect TextureTriangle[]:
    // sampler, selection picking, stats. They only need geometry-equivalent
    // triangles for hit testing — the wireframe path uses `fitted` directly.
    const polyTris = fanTriangulate(fitted);
    const edges = polygonsToWireframeEdges(fitted, 0);
    const vertSet = new Map<string, Vec3>();
    for (const e of edges) {
      vertSet.set(e.from.join(','), e.from);
      vertSet.set(e.to.join(','), e.to);
    }
    controlState.lastMeshUrl = null;
    const previousGeometry = geometry;
    geometry = {
      vertices: Array.from(vertSet.values()),
      edges,
      polygons: polyTris,
      ngonPolygons: fitted,
      animations: [],
      sample: () => polyTris,
    };
    previousGeometry.dispose?.();
    selectedTriangleIndex = -1;
    onSelectionChange?.(-1, null);
    rebuildSceneFromGeometry();
  }

  // ── FPV (first-person) ─────────────────────────────────────────────────────
  // Uses the library control (createGlyphFirstPersonControls). The gallery only
  // supplies model-relative spawn + options — meshes keep their authored scale
  // (autoCenter is center-only), so distances/speeds scale by the model size.
  // Mirrors voxcss (control in the library, spawn config in the website).
  let fpvControl: GlyphFirstPersonControlsHandle | null = null;
  let fpvSavedProjection: 'perspective' | 'orthographic' | null = null;
  let fpvSavedDistance: number | null = null;
  let fpvSavedPerspective: number | null = null;
  let fpvSavedRotX: number | null = null;
  let fpvSavedZoom: number | null = null;
  const FPV_PERSPECTIVE_PER_SCALE = 200;
  // Spawn the eye this many bounding-sphere radii back from the model center.
  // >1 guarantees the eye is OUTSIDE the model; ~2.5 gives a gentle perspective
  // that reads as "standing in front of it" without near-plane distortion.
  const FPV_PULLBACK_RADII = 2.5;
  // Fraction of the viewport the model's silhouette fills on FPV spawn.
  const FPV_SPAWN_FILL = 0.62;

  // Model bbox → scale (maxDim/2; 1 for a 2-unit mesh). Used to size eye height,
  // speeds, spawn distance and the FPV zoom to the model's authored scale.
  function fpvModelScale(): number {
    const polys = geometry.polygons as Polygon[];
    let mnx = Infinity, mxx = -Infinity, mny = Infinity, mxy = -Infinity, mnz = Infinity, mxz = -Infinity;
    for (const p of polys) for (const v of p.vertices) {
      if (v[0] < mnx) mnx = v[0]; if (v[0] > mxx) mxx = v[0];
      if (v[1] < mny) mny = v[1]; if (v[1] > mxy) mxy = v[1];
      if (v[2] < mnz) mnz = v[2]; if (v[2] > mxz) mxz = v[2];
    }
    if (!isFinite(mnx)) return 1;
    return Math.max(mxx - mnx, mxy - mny, mxz - mnz, 0.001) / 2;
  }

  function fpvScaledOptions(scale: number): GlyphFirstPersonControlsOptions {
    const f = controlState.fpv;
    return {
      lookEnabled: f.look,
      moveEnabled: f.move,
      jumpEnabled: f.jump,
      crouchEnabled: f.crouch,
      lookSensitivity: f.lookSensitivity,
      invertY: f.invertY,
      moveSpeed: f.moveSpeed * scale,
      jumpVelocity: f.jumpVelocity * scale,
      gravity: f.gravity * scale,
      eyeHeight: f.eyeHeight * scale,
      crouchHeight: f.crouchHeight * scale,
      groundZ: f.groundZ,
      minPitch: f.minPitch,
      maxPitch: f.maxPitch,
    };
  }

  // A scene rebuild replaces `camera`; the FPV control captured the old one,
  // so re-create it against the new camera, preserving the eye position.
  function rebindFpvControl(): void {
    if (controlState.dragMode !== 'fpv' || !fpvControl) return;
    const origin = fpvControl.getOrigin();
    fpvControl.destroy();
    fpvControl = createGlyphFirstPersonControls(scene, fpvScaledOptions(fpvModelScale()));
    fpvControl.setOrigin(origin);
  }

  // Model center + rotation-invariant bounding-sphere radius (same measure the
  // orbit auto-fit uses). Drives the FPV spawn pull-back so the eye lands
  // outside the model regardless of shape or size.
  function fpvModelBounds(): { center: [number, number, number]; radius: number } {
    const polys = geometry.polygons as Polygon[];
    let mnx = Infinity, mxx = -Infinity, mny = Infinity, mxy = -Infinity, mnz = Infinity, mxz = -Infinity;
    for (const p of polys) for (const v of p.vertices) {
      if (v[0] < mnx) mnx = v[0]; if (v[0] > mxx) mxx = v[0];
      if (v[1] < mny) mny = v[1]; if (v[1] > mxy) mxy = v[1];
      if (v[2] < mnz) mnz = v[2]; if (v[2] > mxz) mxz = v[2];
    }
    if (!isFinite(mnx)) return { center: [0, 0, 0], radius: 1 };
    const cx = (mnx + mxx) / 2, cy = (mny + mxy) / 2, cz = (mnz + mxz) / 2;
    let total = 0;
    for (const p of polys) total += p.vertices.length;
    const stride = total > 3000 ? Math.ceil(total / 3000) : 1;
    let r2max = 0, i = 0;
    for (const p of polys) for (const v of p.vertices) {
      if (i++ % stride !== 0) continue;
      const dx = v[0] - cx, dy = v[1] - cy, dz = v[2] - cz;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > r2max) r2max = d2;
    }
    return { center: [cx, cy, cz], radius: Math.max(Math.sqrt(r2max), 0.001) };
  }

  // Perspective fit: solve the zoom that makes a sphere of `radius` around
  // `center` fill `fill` of the viewport under the CURRENT (perspective) camera.
  // Same projection-measurement trick as fitContentZoom, but the sphere is
  // centered on the MODEL (not camera.target, which FPV parks far ahead of the
  // eye) — so framing is decoupled from whatever zoom orbit was left at.
  function fpvFitZoom(center: [number, number, number], radius: number, fill: number): void {
    const grid = projectionGrid();
    const { cols, rows, cellAspect } = grid;
    const c0 = camera.project(center, cols, rows, cellAspect, grid);
    let sCol2 = 0, sRow2 = 0;
    for (const e of [[1, 0, 0], [0, 1, 0], [0, 0, 1]] as Vec3[]) {
      const pe = camera.project([center[0] + e[0], center[1] + e[1], center[2] + e[2]], cols, rows, cellAspect, grid);
      const dc = pe[0] - c0[0], dr = pe[1] - c0[1];
      sCol2 += dc * dc; sRow2 += dr * dr;
    }
    const sCol = Math.sqrt(sCol2), sRow = Math.sqrt(sRow2);
    if (!(sCol > 0) || !(sRow > 0)) return;
    const factor = Math.min((fill * cols) / (2 * radius * sCol), (fill * rows) / (2 * radius * sRow));
    if (!isFinite(factor) || factor <= 0) return;
    const nz = Math.round((camera.zoom || 1) * factor * 1000) / 1000;
    camera.zoom = nz;
    tunables.zoom = nz;
  }

  function startFpv(): void {
    fpvSavedProjection = controlState.projection;
    fpvSavedDistance = tunables.distance;
    fpvSavedPerspective = tunables.perspective;
    fpvSavedRotX = tunables.rotX;
    fpvSavedZoom = tunables.zoom;
    const scale = fpvModelScale();
    const { center, radius } = fpvModelBounds();
    controlState.projection = 'perspective';
    tunables.distance = 0;
    tunables.perspective = FPV_PERSPECTIVE_PER_SCALE * scale;
    tunables.rotX = 90;
    stopAutoRotate();
    controlState.rotYLocked = true;
    // Rebuild so the scene has a perspective camera the control needs.
    rebuildSceneFromGeometry();
    // Spawn the eye pulled back from the model center along the current
    // (horizontal) look direction. Distance is a multiple of the bounding
    // radius, so the eye lands OUTSIDE the model at any zoom the user left
    // orbit at — the old fixed `1.5 * scale` sat inside the bounding sphere of
    // anything wider than a slab, which is why FPV spawned "inside" the model.
    const back = FPV_PULLBACK_RADII * radius;
    const r = (camera.rotY * Math.PI) / 180;
    // forward at rotX=90 is (-cos rotY, -sin rotY, 0); spawn the opposite way.
    const spawnX = center[0] + Math.cos(r) * back;
    const spawnY = center[1] + Math.sin(r) * back;
    fpvControl = createGlyphFirstPersonControls(scene, fpvScaledOptions(scale));
    fpvControl.setOrigin([spawnX, spawnY, controlState.fpv.groundZ + controlState.fpv.eyeHeight * scale]);
    // Frame the model from outside. Computed fresh from the bounding sphere, so
    // the prior orbit zoom (however far in the user had zoomed) never leaks in.
    fpvFitZoom(center, radius, FPV_SPAWN_FILL);
    doRerender();
  }

  function stopFpv(): void {
    fpvControl?.destroy();
    fpvControl = null;
    controlState.rotYLocked = false;
    if (fpvSavedProjection !== null) controlState.projection = fpvSavedProjection;
    if (fpvSavedDistance !== null) tunables.distance = fpvSavedDistance;
    if (fpvSavedPerspective !== null) tunables.perspective = fpvSavedPerspective;
    if (fpvSavedRotX !== null) tunables.rotX = fpvSavedRotX;
    if (fpvSavedZoom !== null) tunables.zoom = fpvSavedZoom;
    fpvSavedProjection = null;
    fpvSavedDistance = null;
    fpvSavedPerspective = null;
    fpvSavedRotX = null;
    fpvSavedZoom = null;
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
    if (controlState.dragMode === 'fpv' && fpvControl) {
      fpvControl.update(fpvScaledOptions(fpvModelScale()));
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

    // Apply camera-state changes IN-PLACE on the existing camera handle. The
    // previous implementation rebuilt the entire scene (including destroying
    // the orbit controls and tearing down pointer capture) for every option
    // change — which broke mid-drag because the 500 ms poll echoes camera
    // mutations back through this path. Now we only do the expensive rebuild
    // when something actually changed the geometry derivation (e.g.,
    // feature-edge threshold or render-mode wireframe ↔ solid).
    if (hasRotY) {
      controlState.rotYLocked = true;
      camera.rotY = partial.rotY!;
      stopAutoRotate();
    }
    if ('rotX' in partial && partial.rotX !== undefined) camera.rotX = partial.rotX;
    if ('zoom' in partial && partial.zoom !== undefined) camera.zoom = partial.zoom;
    if ('distance' in partial && partial.distance !== undefined) camera.distance = partial.distance;
    if ('perspective' in partial && partial.perspective !== undefined) camera.perspective = partial.perspective;
    if ('targetX' in partial || 'targetY' in partial || 'targetZ' in partial) {
      const tx = tunables.targetX ?? camera.target[0];
      const ty = tunables.targetY ?? camera.target[1];
      const tz = tunables.targetZ ?? camera.target[2];
      camera.target = [tx, ty, tz];
    }

    // Forward render-affecting options to the scene without recreating it.
    const sceneOpts: Partial<Parameters<typeof scene.setOptions>[0]> = {};
    if ('renderMode' in partial && partial.renderMode !== undefined) {
      // Keep Gallery's semantic presentation on the public solid path even if
      // a delayed visible-mode effect flushes while the selector is changing.
      sceneOpts.mode = semanticOutput ? 'solid' : partial.renderMode;
    }
    if ('glyphPalette' in partial && partial.glyphPalette !== undefined) sceneOpts.glyphPalette = partial.glyphPalette;
    if ('charMode' in partial && partial.charMode !== undefined) sceneOpts.charMode = partial.charMode;
    if ('wireframeJunctions' in partial && partial.wireframeJunctions !== undefined) sceneOpts.wireframeJunctions = partial.wireframeJunctions;
    if ('hiddenLines' in partial && partial.hiddenLines !== undefined) sceneOpts.hiddenLines = partial.hiddenLines;
    if ('solidWeightRamp' in partial && partial.solidWeightRamp !== undefined) {
      sceneOpts.solidWeightRamp = partial.solidWeightRamp ? getSolidWeightRamp() ?? undefined : undefined;
    }
    if ('useColors' in partial && partial.useColors !== undefined) sceneOpts.useColors = partial.useColors;
    if ('smoothShading' in partial && partial.smoothShading !== undefined) sceneOpts.smoothShading = partial.smoothShading;
    if ('creaseAngle' in partial && partial.creaseAngle !== undefined) sceneOpts.creaseAngle = partial.creaseAngle;
    if ('colorEncoding' in partial && partial.colorEncoding !== undefined) {
      sceneOpts.colorEncoding = partial.colorEncoding;
    }
    if (Object.keys(sceneOpts).length > 0) scene.setOptions(sceneOpts);

    // `lineHeight` changes the measured cell size. createGlyphScene projects in
    // CSS pixels and converts through those live cell metrics, so refitting the
    // grid is enough: apparent size stays fixed while glyph density changes.
    if ('lineHeight' in partial && partial.lineHeight !== undefined) {
      const nextLineHeight = partial.lineHeight;
      scene.output.style.lineHeight = String(nextLineHeight);
      scene.fit();
    }

    if ('density' in partial && partial.density !== undefined) {
      const nextDensity = Math.max(0.1, partial.density);
      tunables.fontSize = DEMO_BASE_FONT_SIZE / nextDensity;
      scene.output.style.fontSize = `${tunables.fontSize}px`;
      scene.fit();
    }

    // `fontSize` (px) — scene-wide glyph density. Smaller cells create more
    // cols+rows over the same host; camera zoom must not change.
    if ('fontSize' in partial && partial.fontSize !== undefined) {
      const nextFont = partial.fontSize;
      scene.output.style.fontSize = `${nextFont}px`;
      scene.fit();
    }

    // Geometry-affecting tunables — wireframe edge threshold changes the
    // derived edge set, so the polygon→edge cache needs to be re-derived. Same
    // for switching render mode if it touches the geometry pipeline. Trigger
    // a full rebuild only here.
    if ('featureEdges' in partial || 'renderMode' in partial) {
      rebuildSceneFromGeometry();
    } else {
      scene.rerender();
    }
  }

  function setInteractiveDownscale(value: number): void {
    scene.setOptions({ interactiveDownscale: Number.isFinite(value) && value > 0 ? value : 1 });
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
      void setMeshUrl(
        controlState.lastMeshUrl,
        controlState.lastMtlUrl ?? undefined,
        controlState.lastLoadOptions ?? undefined,
      );
    }
  }

  function setLighting(partial: { azimuth?: number; elevation?: number; keyIntensity?: number; ambientIntensity?: number; keyColor?: string; ambientColor?: string }): void {
    if (partial.azimuth !== undefined || partial.elevation !== undefined) {
      const azRad = ((partial.azimuth ?? sphericalAz) * Math.PI) / 180;
      const elRad = ((partial.elevation ?? sphericalEl) * Math.PI) / 180;
      if (partial.azimuth !== undefined) sphericalAz = partial.azimuth;
      if (partial.elevation !== undefined) sphericalEl = partial.elevation;
      // `direction` is the source vector from the shaded surface toward the sun.
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

  function setShadow(partial: Partial<ShadowState>): void {
    Object.assign(shadowState, partial);
    scene.setOptions({
      shadow: shadowState.enabled
        ? { color: shadowState.color, opacity: shadowState.opacity, lift: shadowState.lift * Math.max(bboxMaxDim(geometry.polygons as Polygon[]) / 2, 0.001) }
        : undefined,
    });
    // When cast/receive flags change we must rebuild the mesh handle so the
    // rasterizer picks up the updated per-mesh flags.
    if ('castShadow' in partial || 'receiveShadow' in partial) {
      applyMesh();
    }
    // Rebuild floor whenever enabled/floor toggle changes.
    if ('enabled' in partial || 'floor' in partial) {
      rebuildFloor();
    }
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

  function getStats(): {
    cols: number;
    rows: number;
    glyphs: number;
    textChars: number;
    colorSpans: number;
    domNodes: number;
    layers: number;
    bakeMs: number;
  } {
    const opts = scene.getOptions();
    const layers = Array.from(scene.host.querySelectorAll<HTMLPreElement>("pre.glyph-output"));
    let textChars = 0;
    for (const layer of layers) {
      textChars += layer.textContent?.length ?? 0;
    }
    const colorSpans = scene.host.querySelectorAll("pre.glyph-output span").length;
    return {
      cols: opts.cols,
      rows: opts.rows,
      glyphs: opts.cols * opts.rows,
      textChars,
      colorSpans,
      domNodes: layers.length + colorSpans,
      layers: layers.length,
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
    meshHandle.setPolygons(geometry.polygons as Polygon[]);
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

  // Current (centered) polygons — used by the "export to CodePen" button.
  function getPolygons(): Polygon[] { return geometry.polygons as Polygon[]; }

  // Real reason `colorEncoding: "atlas"` isn't available right now (`null`
  // when it is) — kept current by `recomputeAtlasAvailability` above. Polled
  // by `GlyphScene.tsx`'s existing stats interval (mirrors `getStats`), not
  // pushed — there is no reactive channel from this imperative runtime back
  // into React.
  function getAtlasAvailability(): { reason: string | null } { return { reason: atlasReason }; }

  // Expose handle on the demoEl
  (demoEl as unknown as {
    glyphcssDemo: {
      setMeshUrl: (u: string, mtl?: string, options?: LoadMeshOptions) => Promise<void>;
      setPolygons: (polygons: Polygon[]) => void;
      setTunables: (p: Partial<Tunables>) => void;
      setInteractiveDownscale: (value: number) => void;
      setControlState: (p: Partial<ControlState>) => void;
      getCameraState: () => { rotX: number; rotY: number; scale: number; target: [number, number, number] };
      getStats: () => {
        cols: number;
        rows: number;
        glyphs: number;
        textChars: number;
        colorSpans: number;
        domNodes: number;
        layers: number;
        bakeMs: number;
      };
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
      setShadow: (partial: Partial<ShadowState>) => void;
      configureEffect: (config: RuntimeEffectConfig | null) => void;
      setPresentation: (renderMode: 'wireframe' | 'solid' | 'ink', config: RuntimeSemanticOutput) => void;
      getSemanticCellFrame: () => GlyphSemanticCellFrame | null;
      getDragMode: () => DragMode;
      getPolygons: () => Polygon[];
      getAtlasAvailability: () => { reason: string | null };
    }
  }).glyphcssDemo = {
    setMeshUrl,
    setPolygons,
    setTunables,
    setInteractiveDownscale,
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
    setShadow,
    configureEffect,
    setPresentation,
    getSemanticCellFrame,
    getDragMode,
    getPolygons,
    getAtlasAvailability,
  };

  // ── lil-gui ───────────────────────────────────────────────────────────────
  const gui = controlsEl ? new GUI({ container: controlsEl, title: 'Tuning', width: 240 }) : null;
  const controlMakers: Record<string, () => void> = gui ? {
    scale: () => { gui.add(tunables, 'zoom', 0.5, 60, 0.5).name('zoom').listen().onChange(rebuildAll); },
    stretch: () => { gui.add(tunables, 'stretch', 0.5, 1.5, 0.01).onChange(rebuildAll); },
    distance: () => { gui.add(tunables, 'distance', 100, 100000, 100).name('perspective').onChange(rebuildAll); },
    rotX: () => { gui.add(tunables, 'rotX', 0, 180, 1).name('tilt (rotX)').onChange(rebuildAll); },
    duration: () => { gui.add(tunables, 'duration', 1, 12, 0.25).name('duration (s)').onChange(() => { /* no-op: JS autorotate uses tunables.duration directly */ }); },
    density: () => { gui.add(tunables, 'density', 0.5, 4, 0.1).name('density').onChange((v: number) => setTunables({ density: v })); },
    lineHeight: () => { gui.add(tunables, 'lineHeight', 0.5, 1.2, 0.01).name('line-height ×').onChange(rebuildAll); },
    geometry: () => { gui.add(tunables, 'geometry', ['cuboctahedron', 'icosahedron', 'cube']).onChange(rebuildAll); },
  } : {};
  for (const key of controlList) controlMakers[key]?.();

  // ── Code panel sync ───────────────────────────────────────────────────────
  function updateCode(): void {
    const t = tunables;
    const mode = t.renderMode ?? 'wireframe';
    const rotY = t.rotY ?? camera.rotY;
    if (codeEls.vanilla) {
      codeEls.vanilla.textContent = [
        'import { createGlyphCamera, createGlyphScene, createGlyphOrbitControls } from "glyphcss";',
        'import { resolveGeometry } from "@glyphcss/core";',
        '',
        'const host = document.getElementById("scene")!;',
        `const camera = createGlyphCamera({ rotX: ${t.rotX.toFixed(2)}, rotY: ${rotY.toFixed(2)}, zoom: ${t.zoom.toFixed(2)} });`,
        'const scene = createGlyphScene(host, {',
        '  camera,',
        '  autoSize: true,',
        `  mode: "${mode}",`,
        '});',
        '',
        `scene.add(resolveGeometry("${t.geometry}", { size: ${DEMO_GEOMETRY_SIZE} }));`,
        'createGlyphOrbitControls(scene, { drag: true, wheel: true });',
      ].join('\n');
    }
    if (codeEls.react) {
      codeEls.react.textContent = [
        'import { GlyphCamera, GlyphScene, GlyphOrbitControls, GlyphMesh } from "@glyphcss/react";',
        '',
        'export function App() {',
        '  return (',
        `    <GlyphCamera rotX={${t.rotX.toFixed(2)}} rotY={${rotY.toFixed(2)}} zoom={${t.zoom.toFixed(2)}}>`,
        `      <GlyphScene mode="${mode}" autoSize style={{ width: "100%", height: "100%" }}>`,
        '        <GlyphOrbitControls drag wheel />',
        `        <GlyphMesh geometry="${t.geometry}" size={${DEMO_GEOMETRY_SIZE}} />`,
        '      </GlyphScene>',
        '    </GlyphCamera>',
        '  );',
        '}',
      ].join('\n');
    }
    if (codeEls.vue) {
      codeEls.vue.textContent = [
        '<template>',
        `  <GlyphCamera :rot-x="${t.rotX.toFixed(2)}" :rot-y="${rotY.toFixed(2)}" :zoom="${t.zoom.toFixed(2)}">`,
        `    <GlyphScene mode="${mode}" auto-size :style="{ width: '100%', height: '100%' }">`,
        '      <GlyphOrbitControls drag wheel />',
        `      <GlyphMesh geometry="${t.geometry}" :size="${DEMO_GEOMETRY_SIZE}" />`,
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
  // Indexed-polygons URL (compact format used by the landing earth) takes
  // priority over mesh-file URL takes priority over built-in geometry.
  const polygonsUrl = demoEl.getAttribute('data-polygons-url');
  const initialMeshUrl = demoEl.getAttribute('data-mesh');
  const initialMtlUrl = demoEl.getAttribute('data-mtl') || undefined;
  let initialLoadOptions: LoadMeshOptions | undefined;
  const initialLoadOptionsJson = demoEl.getAttribute('data-load-options');
  if (initialLoadOptionsJson) {
    try {
      initialLoadOptions = JSON.parse(initialLoadOptionsJson) as LoadMeshOptions;
    } catch (err) {
      console.warn('[glyphcss] invalid data-load-options:', err);
    }
  }
  if (polygonsUrl) {
    void (async () => {
      try {
        const res = await fetch(polygonsUrl);
        const data = await res.json() as {
          vertices: [number, number, number][];
          colors: string[];
          faces: { v: number[]; c: number }[];
        };
        const polys: Polygon[] = data.faces.map((f) => {
          const verts = f.v.map((i) => data.vertices[i]!) as Polygon['vertices'];
          const out: Polygon = { vertices: verts };
          if (f.c >= 0) out.color = data.colors[f.c];
          return out;
        });
        setPolygons(polys);
      } catch (err) {
        console.error('failed to load polygons URL', err);
      } finally {
        loadingEl.style.display = 'none';
      }
    })();
  } else if (initialMeshUrl) {
    void setMeshUrl(initialMeshUrl, initialMtlUrl, initialLoadOptions);
  } else {
    applyMesh();
    scene.fit();
    maybeFitContent();
    doRerender();
    loadingEl.style.display = 'none';
    updateCode();
  }

  if (demoEl.getAttribute('data-auto-rotate') === '1') {
    // Pause the spin while the user is actively dragging so user input
    // doesn't fight the RAF tick. Resume after a short delay so a quick
    // release-and-grab doesn't restart the spin mid-gesture.
    const sceneHost = scene.host;
    let resumeTimer: number | null = null;
    sceneHost.addEventListener('pointerdown', () => {
      autoRotatePaused = true;
      if (resumeTimer !== null) { window.clearTimeout(resumeTimer); resumeTimer = null; }
    });
    const releaseHandler = () => {
      if (resumeTimer !== null) window.clearTimeout(resumeTimer);
      resumeTimer = window.setTimeout(() => {
        autoRotatePaused = false;
        autoRotateLastTime = null; // reset dt accumulator
        resumeTimer = null;
      }, 600);
    };
    sceneHost.addEventListener('pointerup', releaseHandler);
    sceneHost.addEventListener('pointercancel', releaseHandler);
    startAutoRotate();
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
