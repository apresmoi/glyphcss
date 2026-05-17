import type { TextureTriangle } from "../types";
import type { WireframeEdge } from "../types";

/** Compute unnormalized face normal for a triangle. */
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
  return (na[0] * nb[0] + na[1] * nb[1] + na[2] * nb[2]) / (la * lb);
}

function edgeKey(a: readonly number[], b: readonly number[]): string {
  const k1 = `${a[0]},${a[1]},${a[2]}`;
  const k2 = `${b[0]},${b[1]},${b[2]}`;
  return k1 < k2 ? `${k1}|${k2}` : `${k2}|${k1}`;
}

/**
 * Derive a deduplicated edge list from triangle vertices, weight `2`.
 * Color is copied from the first triangle encountered for each edge.
 *
 * When `featureAngleDeg > 0`, only edges where adjacent face normals diverge
 * by more than `featureAngleDeg` degrees are kept (feature-edge filter). Boundary
 * edges (only one adjacent triangle) are always kept.
 * When `featureAngleDeg === 0`, all edges are kept (original behaviour).
 */
function trianglesToEdges(triangles: TextureTriangle[], featureAngleDeg = 0): WireframeEdge[] {
  if (featureAngleDeg <= 0) {
    const seen = new Set<string>();
    const out: WireframeEdge[] = [];
    for (const t of triangles) {
      const pairs: [number, number][] = [[0, 1], [1, 2], [2, 0]];
      for (const [i, j] of pairs) {
        const a = t.vertices[i], b = t.vertices[j];
        const key = edgeKey(a, b);
        if (seen.has(key)) continue;
        seen.add(key);
        const edge: WireframeEdge = { from: a, to: b, weight: 2 };
        if (t.color) edge.color = t.color;
        out.push(edge);
      }
    }
    return out;
  }

  // Feature-edge path: accumulate per-edge face normals, then filter.
  const THRESH = Math.cos((featureAngleDeg * Math.PI) / 180);
  const edgeFaces = new Map<string, { normals: Array<[number, number, number]>; from: readonly number[]; to: readonly number[]; color?: string }>();
  const pairs: [number, number][] = [[0, 1], [1, 2], [2, 0]];
  for (const t of triangles) {
    const n = faceNormal(t);
    for (const [i, j] of pairs) {
      const a = t.vertices[i], b = t.vertices[j];
      const key = edgeKey(a, b);
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
      const edge: WireframeEdge = { from: from as [number, number, number], to: to as [number, number, number], weight: 2 };
      if (color) edge.color = color;
      edges.push(edge);
      continue;
    }
    // Emit if any pair of adjacent normals diverges more than the threshold.
    let isFeature = false;
    outer: for (let ii = 0; ii < normals.length; ii++) {
      for (let jj = ii + 1; jj < normals.length; jj++) {
        if (dotNorm(normals[ii]!, normals[jj]!) < THRESH) {
          isFeature = true;
          break outer;
        }
      }
    }
    if (isFeature) {
      const edge: WireframeEdge = { from: from as [number, number, number], to: to as [number, number, number], weight: 2 };
      if (color) edge.color = color;
      edges.push(edge);
    }
  }
  return edges;
}

/** Public: derive feature edges from a triangle list. `featureAngleDeg = 0` = all edges. */
export function trianglesToFeatureEdges(triangles: TextureTriangle[], featureAngleDeg = 0): WireframeEdge[] {
  return trianglesToEdges(triangles, featureAngleDeg);
}
