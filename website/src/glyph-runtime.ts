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
  planePolygons,
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
import { resolveGeometry } from '@glyphcss/core';

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

async function loadMeshAsGeometry(url: string, normalize = true, mtlUrl?: string): Promise<MeshGeometry> {
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
  const result = await loadMesh(url, resolvedMtl ? { mtlUrl: resolvedMtl } : undefined);
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
  lastMtlUrl: string | null;
  rotYLocked: boolean;
  projection: 'perspective' | 'orthographic';
  dragMode: DragMode;
  fpv: FpvOptions;
}

const DEFAULT_TUNABLES: Tunables = {
  zoom: 0.3,
  stretch: 1.0,
  distance: 8000,
  rotX: 65,
  duration: 6,
  lineHeight: 1.0,
  geometry: 'cuboctahedron',
};

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
  const polygons = resolveGeometry(name, { size: 1 });
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
    // Corresponds to azimuth=50°, elevation=45° in the old "FROM" convention.
    direction: [-0.454, -0.541, -0.707] as [number, number, number],
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
  // Returned vector points FROM the subsolar surface point AWAY from the
  // sun, i.e. the direction the light TRAVELS. Glyphcss's rasterizer uses
  // `direction` in the Lambert dot product against face normals, and the
  // landing-earth bake reverses quad winding to keep backface culling
  // happy, which flips the effective face-normal sign. The net effect is
  // that pointing `direction` away from the sun illuminates the correct
  // hemisphere.
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
    // Negated relative to the subsolar surface point — see header comment.
    return [-cosLat * Math.cos(lon), cosLat * Math.sin(lon), -Math.sin(lat)];
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
      shadow: shadowState.enabled
        ? { color: shadowState.color, opacity: shadowState.opacity, lift: shadowState.lift * Math.max(bboxMaxDim(geometry.polygons as Polygon[]) / 2, 0.001) }
        : undefined,
    };
  }

  // Declare before buildSceneOptions() is called to avoid temporal dead zone.
  let baseWireframe: WireframeEdge[] = geometry.edges;

  const scene: GlyphSceneHandle = createGlyphScene(sceneHost, {
    camera,
    autoSize: true,
    ...buildSceneOptions(),
  });

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

  // ── Fit-to-content ───────────────────────────────────────────────────────
  // Compute the absolute camera.zoom that makes the geometry's true projected
  // silhouette fill ~`fill` of the viewport. We project the ACTUAL vertices
  // (sampled for big meshes) — NOT the 8 AABB corners: for a round object the
  // bounding-cube corners project ~√2 wider than the real silhouette, which
  // under-fills (a sphere lands at ~58% when targeting 82%). Projection scales
  // linearly with zoom, so we measure the cell extent at the current zoom and
  // scale to hit the target. Skipped for FPV (eyeMode) / pinned-zoom demos.
  function fitContentZoom(fill = 0.85): void {
    if (hasExplicitZoom || camera.eyeMode) return;
    const polys = geometry.polygons as Polygon[];
    if (!polys || polys.length === 0) return;
    const opts = scene.getOptions();
    const cols = opts.cols ?? 80, rows = opts.rows ?? 24, ca = opts.cellAspect ?? 0.5;
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
    const c0 = camera.project([tx, ty, tz], cols, rows, ca);
    let sCol2 = 0, sRow2 = 0;
    for (const e of [[1, 0, 0], [0, 1, 0], [0, 0, 1]] as Vec3[]) {
      const pe = camera.project([tx + e[0], ty + e[1], tz + e[2]], cols, rows, ca);
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
      // Update mesh handle with new frame polygons
      meshHandle.dispose();
      meshHandle = scene.add(sampledTriangles as Polygon[], {
        castShadow: shadowState.castShadow,
        receiveShadow: shadowState.receiveShadow,
      });
      doRerender();
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

    meshHandle.dispose();
    meshHandle = scene.add(polys, {
      castShadow: shadowState.castShadow,
      receiveShadow: shadowState.receiveShadow,
    });
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
    rebuildFloor();
    scene.fit();
    maybeFitContent();
    doRerender();
    loadingEl.style.display = 'none';
    updateCode();
  }

  function rebuildAll(): void {
    stopAnimationLoop();
    if (usesBuiltInGeometry) geometry = buildDemoGeometry(tunables.geometry);
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

  async function setMeshUrl(url: string, mtlUrl?: string): Promise<void> {
    const token = ++meshLoadToken;
    loadingEl.style.display = 'grid';
    loadingEl.textContent = `Loading ${url.split('/').pop()}…`;
    try {
      const loaded = await loadMeshAsGeometry(url, controlState.autoCenter, mtlUrl);
      if (token !== meshLoadToken) return; // superseded by a newer selection
      if (loaded.edges.length === 0) {
        loadingEl.textContent = 'Empty mesh (0 edges).';
        return;
      }
      controlState.lastMeshUrl = url;
      controlState.lastMtlUrl = mtlUrl ?? null;
      geometry = loaded;
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
    geometry = {
      vertices: Array.from(vertSet.values()),
      edges,
      polygons: polyTris,
      ngonPolygons: fitted,
      animations: [],
      sample: () => polyTris,
    };
    selectedTriangleIndex = -1;
    onSelectionChange?.(-1, null);
    rebuildSceneFromGeometry();
  }

  // ── FPV state ─────────────────────────────────────────────────────────────
  let fpvOrigin: [number, number, number] = [0, 0, controlState.fpv.groundZ + controlState.fpv.eyeHeight];
  // Scales FPV distances/speeds to the model. Meshes keep their authored scale
  // (autoCenter is center-only), so a fixed back-off/eye-height/move-speed would
  // break on non-unit models — spawning you inside a large one. `maxDim/2` is 1
  // for the old 2-unit mesh (identical behavior) and grows with the model.
  let fpvModelScale = 1;
  let fpvVerticalVel = 0;
  let fpvJumpOffset = 0;
  let fpvRafId: number | null = null;
  let fpvLastTime = 0;
  let fpvPointerLocked = false;
  const fpvKeysHeld = new Set<string>();
  let fpvSavedProjection: 'perspective' | 'orthographic' | null = null;
  let fpvSavedDistance: number | null = null;
  let fpvSavedRotX: number | null = null;
  let fpvSavedZoom: number | null = null;
  const FPV_PERSPECTIVE_DISTANCE = 200;

  const FPV_FORWARD_KEYS = new Set(['KeyW', 'ArrowUp']);
  const FPV_BACK_KEYS = new Set(['KeyS', 'ArrowDown']);
  const FPV_LEFT_KEYS = new Set(['KeyA', 'ArrowLeft']);
  const FPV_RIGHT_KEYS = new Set(['KeyD', 'ArrowRight']);
  const FPV_JUMP_KEYS = new Set(['Space']);
  const FPV_CROUCH_KEYS = new Set(['ControlLeft', 'ControlRight']);

  function fpvForwardDir(rotXDeg: number, rotYDeg: number): [number, number, number] {
    const rx = (rotXDeg * Math.PI) / 180;
    const ry = (rotYDeg * Math.PI) / 180;
    return [
      -Math.sin(rx) * Math.cos(ry),
      -Math.sin(rx) * Math.sin(ry),
      -Math.cos(rx),
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
    // Derive a model-relative scale from the bbox so the spawn back-off + eye
    // height fit the actual model (mirrors voxcss useFpvSpawn). maxDim/2 == 1
    // for the old 2-unit mesh, so unit-scale models are unchanged.
    const polys = geometry.polygons as Polygon[];
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (const p of polys) for (const v of p.vertices) {
      if (v[0] < minX) minX = v[0]; if (v[0] > maxX) maxX = v[0];
      if (v[1] < minY) minY = v[1]; if (v[1] > maxY) maxY = v[1];
      if (v[2] < minZ) minZ = v[2]; if (v[2] > maxZ) maxZ = v[2];
    }
    const hasBbox = isFinite(minX);
    const cx = hasBbox ? (minX + maxX) / 2 : camera.target[0];
    const cy = hasBbox ? (minY + maxY) / 2 : camera.target[1];
    const maxDim = hasBbox ? Math.max(maxX - minX, maxY - minY, maxZ - minZ, 0.001) : 2;
    fpvModelScale = maxDim / 2;
    // eyeMode apparent size ∝ zoom (the scaled back-off cancels the model size,
    // focal is constant). The orbit auto-fit zoom shrinks ∝ 1/scale for big
    // models, so normalize it by the model scale → consistent FPV view at any
    // size. (For the old 2-unit mesh fpvModelScale is 1, so this is a no-op.)
    camera.zoom = (fpvSavedZoom ?? camera.zoom) * fpvModelScale;
    tunables.zoom = camera.zoom;
    fpvJumpOffset = 0;
    fpvVerticalVel = 0;
    camera.rotX = 90;
    tunables.rotX = 90;
    const back = 1.5 * fpvModelScale;
    const f = fpvForwardDir(camera.rotX, camera.rotY);
    fpvOrigin = [
      cx - f[0] * back,
      cy - f[1] * back,
      controlState.fpv.groundZ + controlState.fpv.eyeHeight * fpvModelScale,
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
    // Camera is now in degrees; sensitivity is in degrees/pixel.
    camera.rotY = camera.rotY - dx * sens;
    let rotX = camera.rotX - dy * sens * dyDir;
    const minDeg = controlState.fpv.minPitch;
    const maxDeg = controlState.fpv.maxPitch;
    if (rotX < minDeg) rotX = minDeg;
    else if (rotX > maxDeg) rotX = maxDeg;
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
        fpvVerticalVel = controlState.fpv.jumpVelocity * fpvModelScale;
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
        const r = (camera.rotY * Math.PI) / 180;
        const fx = -Math.cos(r), fy = -Math.sin(r);
        const rx = -Math.sin(r), ry =  Math.cos(r);
        const len = Math.hypot(mf, mr) || 1;
        const step = controlState.fpv.moveSpeed * fpvModelScale * dt;
        fpvOrigin[0] += ((fx * mf + rx * mr) / len) * step;
        fpvOrigin[1] += ((fy * mf + ry * mr) / len) * step;
        dirty = true;
      }
    }

    const crouched = controlState.fpv.crouch &&
      (fpvKeysHeld.has('ControlLeft') || fpvKeysHeld.has('ControlRight'));
    const baseHeight = (crouched ? controlState.fpv.crouchHeight : controlState.fpv.eyeHeight) * fpvModelScale;
    if (controlState.fpv.jump && (fpvVerticalVel !== 0 || fpvJumpOffset > 0)) {
      fpvVerticalVel -= controlState.fpv.gravity * fpvModelScale * dt;
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
    fpvSavedZoom = tunables.zoom;
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
    if (fpvSavedZoom !== null) tunables.zoom = fpvSavedZoom;
    fpvSavedProjection = null;
    fpvSavedDistance = null;
    fpvSavedRotX = null;
    fpvSavedZoom = null;
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
    if ('targetX' in partial || 'targetY' in partial || 'targetZ' in partial) {
      const tx = tunables.targetX ?? camera.target[0];
      const ty = tunables.targetY ?? camera.target[1];
      const tz = tunables.targetZ ?? camera.target[2];
      camera.target = [tx, ty, tz];
    }

    // Forward render-affecting options to the scene without recreating it.
    const sceneOpts: Partial<Parameters<typeof scene.setOptions>[0]> = {};
    if ('renderMode' in partial && partial.renderMode !== undefined) sceneOpts.mode = partial.renderMode;
    if ('glyphPalette' in partial && partial.glyphPalette !== undefined) sceneOpts.glyphPalette = partial.glyphPalette;
    if ('useColors' in partial && partial.useColors !== undefined) sceneOpts.useColors = partial.useColors;
    if ('smoothShading' in partial && partial.smoothShading !== undefined) sceneOpts.smoothShading = partial.smoothShading;
    if ('creaseAngle' in partial && partial.creaseAngle !== undefined) sceneOpts.creaseAngle = partial.creaseAngle;
    if (Object.keys(sceneOpts).length > 0) scene.setOptions(sceneOpts);

    // `lineHeight` isn't a scene option — it's a CSS multiplier we apply
    // directly to the rendered <pre>. Pre-line-height changes the character
    // cell height, so we re-fit cols/rows + cellAspect for the new cell, then
    // compensate zoom so the object keeps the SAME on-screen size: the object's
    // row-span is `worldHeight · zoom` (cell-independent), so a taller cell
    // would otherwise scale it up. On-screen width and height both scale as
    // `zoom · lineHeight`, so scaling zoom by the inverse line-height ratio
    // holds both fixed — line-height then only changes vertical glyph density.
    if ('lineHeight' in partial && partial.lineHeight !== undefined) {
      const prevLineHeight = parseFloat(scene.output.style.lineHeight) || 1;
      const nextLineHeight = partial.lineHeight;
      scene.output.style.lineHeight = String(nextLineHeight);
      scene.fit();
      if (prevLineHeight > 0 && nextLineHeight > 0 && camera.zoom > 0 && !camera.eyeMode) {
        camera.zoom = Math.round(camera.zoom * (prevLineHeight / nextLineHeight) * 1000) / 1000;
        tunables.zoom = camera.zoom;
      }
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
      void setMeshUrl(controlState.lastMeshUrl, controlState.lastMtlUrl ?? undefined);
    }
  }

  function setLighting(partial: { azimuth?: number; elevation?: number; keyIntensity?: number; ambientIntensity?: number; keyColor?: string; ambientColor?: string }): void {
    if (partial.azimuth !== undefined || partial.elevation !== undefined) {
      const azRad = ((partial.azimuth ?? sphericalAz) * Math.PI) / 180;
      const elRad = ((partial.elevation ?? sphericalEl) * Math.PI) / 180;
      if (partial.azimuth !== undefined) sphericalAz = partial.azimuth;
      if (partial.elevation !== undefined) sphericalEl = partial.elevation;
      // `direction` = the direction light shines TOWARD (three.js / voxcss
      // convention). A sun at elevation el, azimuth az sits in the +Z
      // hemisphere; light travels FROM there TOWARD the scene, i.e. in the
      // NEGATIVE of the subsolar unit vector.
      lightingState.direction = [
        -Math.cos(elRad) * Math.cos(azRad),
        -Math.cos(elRad) * Math.sin(azRad),
        -Math.sin(elRad),
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
    meshHandle = scene.add(geometry.polygons as Polygon[], {
      castShadow: shadowState.castShadow,
      receiveShadow: shadowState.receiveShadow,
    });
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
      setMeshUrl: (u: string, mtl?: string) => Promise<void>;
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
      setShadow: (partial: Partial<ShadowState>) => void;
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
    setShadow,
    getDragMode,
  };

  // ── lil-gui ───────────────────────────────────────────────────────────────
  const gui = controlsEl ? new GUI({ container: controlsEl, title: 'Tuning', width: 240 }) : null;
  const controlMakers: Record<string, () => void> = gui ? {
    scale: () => { gui.add(tunables, 'zoom', 0.5, 60, 0.5).name('zoom').listen().onChange(rebuildAll); },
    stretch: () => { gui.add(tunables, 'stretch', 0.5, 1.5, 0.01).onChange(rebuildAll); },
    distance: () => { gui.add(tunables, 'distance', 100, 100000, 100).name('perspective').onChange(rebuildAll); },
    rotX: () => { gui.add(tunables, 'rotX', 0, 180, 1).name('tilt (rotX)').onChange(rebuildAll); },
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
  // Indexed-polygons URL (compact format used by the landing earth) takes
  // priority over mesh-file URL takes priority over built-in geometry.
  const polygonsUrl = demoEl.getAttribute('data-polygons-url');
  const initialMeshUrl = demoEl.getAttribute('data-mesh');
  const initialMtlUrl = demoEl.getAttribute('data-mtl') || undefined;
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
    void setMeshUrl(initialMeshUrl, initialMtlUrl);
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
