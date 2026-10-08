import { resolveGeometry } from "@glyphcss/core";
import type { LoadMeshOptions, ParseAnimationClip, Polygon, TextureTriangle, Vec3, WireframeEdge } from "glyphcss";
import { loadMesh } from "glyphcss";
import { type GeometryName, type GeometryState, DEMO_GEOMETRY_SIZE } from "./types";

/** Compute the face normal (unnormalized) of a triangle. */
function faceNormal(t: TextureTriangle): [number, number, number] {
  const [a, b, c] = [t.vertices[0], t.vertices[1], t.vertices[2]];
  const ux = b[0] - a[0],
    uy = b[1] - a[1],
    uz = b[2] - a[2];
  const vx = c[0] - a[0],
    vy = c[1] - a[1],
    vz = c[2] - a[2];
  return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
}

function dotNorm(na: [number, number, number], nb: [number, number, number]): number {
  const la = Math.hypot(na[0], na[1], na[2]);
  const lb = Math.hypot(nb[0], nb[1], nb[2]);
  if (la === 0 || lb === 0) return 1;
  return (na[0] * nb[0] + na[1] * nb[1] + na[2] * nb[2]) / (la * lb);
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
export function trianglesToEdges(triangles: TextureTriangle[], featureAngleDeg = 20): WireframeEdge[] {
  const THRESH = Math.cos((featureAngleDeg * Math.PI) / 180);
  const edgeFaces = new Map<
    string,
    { normals: Array<[number, number, number]>; from: Vec3; to: Vec3; color?: string }
  >();
  for (const t of triangles) {
    const verts = t.vertices;
    if (verts.length < 2) continue;
    const n = faceNormal(t);
    for (let i = 0; i < verts.length; i++) {
      const a = verts[i]!,
        b = verts[(i + 1) % verts.length]!;
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
export function fanTriangulate(polygons: Polygon[]): TextureTriangle[] {
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
        uvs: hasUvs
          ? [uvs![0]!, uvs![i]!, uvs![i + 1]!]
          : [
              [0, 0],
              [0, 0],
              [0, 0],
            ],
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
export function recenterPolygons(polygons: Polygon[]): Polygon[] {
  if (polygons.length === 0) return polygons;
  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity;
  let maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity;
  for (const p of polygons)
    for (const v of p.vertices) {
      if (v[0] < minX) minX = v[0];
      if (v[0] > maxX) maxX = v[0];
      if (v[1] < minY) minY = v[1];
      if (v[1] > maxY) maxY = v[1];
      if (v[2] < minZ) minZ = v[2];
      if (v[2] > maxZ) maxZ = v[2];
    }
  const cx = (minX + maxX) / 2,
    cy = (minY + maxY) / 2,
    cz = (minZ + maxZ) / 2;
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
export function polygonsToWireframeEdges(polygons: Polygon[], featureAngleDeg = 0): WireframeEdge[] {
  const edgeFaces = new Map<
    string,
    { normals: Array<[number, number, number]>; from: Vec3; to: Vec3; color?: string }
  >();
  for (const p of polygons) {
    const verts = p.vertices;
    if (verts.length < 2) continue;
    // Face normal from the first non-colinear triplet — good enough for the
    // shapes we render (planar N-gons + fan-triangulated triangles).
    let n: [number, number, number] = [0, 0, 0];
    if (verts.length >= 3) {
      const a = verts[0]!,
        b = verts[1]!,
        c = verts[2]!;
      const ux = b[0] - a[0],
        uy = b[1] - a[1],
        uz = b[2] - a[2];
      const vx = c[0] - a[0],
        vy = c[1] - a[1],
        vz = c[2] - a[2];
      const nx = uy * vz - uz * vy,
        ny = uz * vx - ux * vz,
        nz = ux * vy - uy * vx;
      const L = Math.hypot(nx, ny, nz) || 1;
      n = [nx / L, ny / L, nz / L];
    }
    for (let i = 0; i < verts.length; i++) {
      const a = verts[i]!,
        b = verts[(i + 1) % verts.length]!;
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
        const a = normals[i]!,
          b = normals[j]!;
        const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
        if (dot < THRESH) {
          isFeature = true;
          break outer;
        }
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
export function bboxMaxDim(polygons: Polygon[]): number {
  if (!polygons || polygons.length === 0) return 0;
  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity;
  let maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity;
  for (const p of polygons)
    for (const v of p.vertices) {
      if (v[0] < minX) minX = v[0];
      if (v[0] > maxX) maxX = v[0];
      if (v[1] < minY) minY = v[1];
      if (v[1] > maxY) maxY = v[1];
      if (v[2] < minZ) minZ = v[2];
      if (v[2] > maxZ) maxZ = v[2];
    }
  return Math.max(maxX - minX, maxY - minY, maxZ - minZ);
}

/** Recenter triangles so their bbox center sits at the origin (center only). */
function recenterTriangles(triangles: TextureTriangle[]): TextureTriangle[] {
  if (triangles.length === 0) return triangles;
  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity;
  let maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity;
  for (const t of triangles)
    for (const v of t.vertices) {
      if (v[0] < minX) minX = v[0];
      if (v[0] > maxX) maxX = v[0];
      if (v[1] < minY) minY = v[1];
      if (v[1] > maxY) maxY = v[1];
      if (v[2] < minZ) minZ = v[2];
      if (v[2] > maxZ) maxZ = v[2];
    }
  const cx = (minX + maxX) / 2,
    cy = (minY + maxY) / 2,
    cz = (minZ + maxZ) / 2;
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
    const sibling = url.replace(/\.obj(\?|#|$)/i, ".mtl$1");
    try {
      const probe = await fetch(sibling);
      if (probe.ok) resolvedMtl = sibling;
    } catch {
      /* no sibling .mtl */
    }
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
    vertSet.set(e.from.join(","), e.from);
    vertSet.set(e.to.join(","), e.to);
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

// ── Geometry builder ─────────────────────────────────────────────────────

/**
 * Build a docs-demo geometry from a `@glyphcss/core` registry name.
 * Mirrors the shape used by the gallery's `setPolygons`: N-gons preserved in
 * `ngonPolygons` so the wireframe path emits true outline edges, plus a
 * fan-triangulated `polygons` array for selection/sampling/stats.
 */
export function buildDemoGeometry(name: GeometryName): GeometryState {
  const polygons = resolveGeometry(name, { size: DEMO_GEOMETRY_SIZE });
  const polyTris = fanTriangulate(polygons);
  const edges = polygonsToWireframeEdges(polygons, 0);
  const vertSet = new Map<string, Vec3>();
  for (const e of edges) {
    vertSet.set(e.from.join(","), e.from);
    vertSet.set(e.to.join(","), e.to);
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
