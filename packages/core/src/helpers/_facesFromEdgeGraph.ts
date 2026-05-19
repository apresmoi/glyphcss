/**
 * Shared face-discovery utilities for Archimedean polyhedra whose faces cannot
 * be trivially read from a truncation table.
 *
 * Algorithm: for each vertex `start` (the minimum index in the cycle), do a
 * depth-first search through the edge graph collecting paths of `length` vertices.
 * When a path of `length` vertices ends at a vertex adjacent to `start`, we have
 * a candidate cycle. We then:
 *   1. Check planarity — all vertices within 1e-6 of the plane defined by the
 *      first three.
 *   2. Check outward-facing — the face centroid is in the same half-space as the
 *      face normal (origin is the solid's centre).
 *   3. Deduplicate — keep one canonical rotation (minimum-index vertex first).
 *
 * The "nb >= start" pruning guarantees that each cycle is discovered at most
 * once: when `start` is the smallest-index vertex in the face, all other
 * vertices along the path will be > start.  The final closing step (back to
 * start) is allowed explicitly.
 */

export type RawVerts = [number, number, number][];
export type AdjList = number[][];

/** Check that all vertices lie on the same plane (within 1e-6). */
function isPlanar(raw: RawVerts, indices: number[]): boolean {
  if (indices.length <= 3) return true;
  const [ax, ay, az] = raw[indices[0]];
  const [bx, by, bz] = raw[indices[1]];
  const [cx, cy, cz] = raw[indices[2]];
  const e0x = bx - ax, e0y = by - ay, e0z = bz - az;
  const e1x = cx - ax, e1y = cy - ay, e1z = cz - az;
  const nx = e0y * e1z - e0z * e1y;
  const ny = e0z * e1x - e0x * e1z;
  const nz = e0x * e1y - e0y * e1x;
  const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
  if (len < 1e-10) return false;
  const inv = 1 / len;
  const d = (nx * ax + ny * ay + nz * az) * inv;
  for (let k = 3; k < indices.length; k++) {
    const [px, py, pz] = raw[indices[k]];
    const dist = Math.abs((nx * px + ny * py + nz * pz) * inv - d);
    if (dist > 1e-6) return false;
  }
  return true;
}

/** Check that the face normal points away from the origin (solid centred at 0). */
function isOutwardFacing(raw: RawVerts, indices: number[]): boolean {
  let gcx = 0, gcy = 0, gcz = 0;
  for (const i of indices) { gcx += raw[i][0]; gcy += raw[i][1]; gcz += raw[i][2]; }
  const cnt = indices.length;
  gcx /= cnt; gcy /= cnt; gcz /= cnt;

  const [ax, ay, az] = raw[indices[0]];
  const [bx, by, bz] = raw[indices[1]];
  const [cx, cy, cz] = raw[indices[2]];
  const e0x = bx - ax, e0y = by - ay, e0z = bz - az;
  const e1x = cx - ax, e1y = cy - ay, e1z = cz - az;
  const nx = e0y * e1z - e0z * e1y;
  const ny = e0z * e1x - e0x * e1z;
  const nz = e0x * e1y - e0y * e1x;
  return (nx * gcx + ny * gcy + nz * gcz) > 0;
}

/** Canonical face key: rotate so smallest index is first, then join. */
function faceKey(indices: number[]): string {
  const minPos = indices.indexOf(Math.min(...indices));
  const rotated = [...indices.slice(minPos), ...indices.slice(0, minPos)];
  return rotated.join(",");
}

/**
 * Find all outward-facing planar cycles of `length` in the edge graph.
 *
 * @param raw   Raw (unscaled) vertex coordinates.
 * @param adj   Adjacency list built from edges.
 * @param length  Cycle length to search for (4, 5, 6, 8, 10, …).
 * @returns Array of vertex index arrays, one per face.
 */
export function findFacesOfLength(raw: RawVerts, adj: AdjList, length: number): number[][] {
  const n = raw.length;
  const found = new Set<string>();
  const faces: number[][] = [];

  // path is always built with path[0] = start (the minimum vertex in the cycle).
  // All intermediate vertices must have index > start to avoid finding the same
  // cycle multiple times.
  function dfs(path: number[], start: number): void {
    const last = path[path.length - 1];

    if (path.length === length) {
      // Close the cycle — last must be adjacent to start.
      if (!adj[last].includes(start)) return;
      if (!isPlanar(raw, path)) return;
      if (!isOutwardFacing(raw, path)) return;
      const key = faceKey(path);
      if (!found.has(key)) {
        found.add(key);
        faces.push([...path]);
      }
      return;
    }

    for (const nb of adj[last]) {
      // Must not revisit any already-visited vertex.
      if (path.includes(nb)) continue;
      // Enforce nb > start so each cycle is enumerated at its minimum vertex.
      if (nb <= start) continue;
      dfs([...path, nb], start);
    }
  }

  for (let start = 0; start < n; start++) {
    dfs([start], start);
  }
  return faces;
}

/**
 * Build an adjacency list from a raw vertex array.
 * Two vertices are connected if their distance equals `edgeLen ± eps`.
 */
export function buildAdjList(raw: RawVerts, eps = 1e-6): { adj: AdjList; edgeLen: number } {
  const n = raw.length;
  let edgeLen = Infinity;

  // Find the minimum non-zero pairwise distance.
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dx = raw[i][0] - raw[j][0];
      const dy = raw[i][1] - raw[j][1];
      const dz = raw[i][2] - raw[j][2];
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d > 1e-10 && d < edgeLen) edgeLen = d;
    }
  }

  const adj: AdjList = Array.from({ length: n }, () => []);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dx = raw[i][0] - raw[j][0];
      const dy = raw[i][1] - raw[j][1];
      const dz = raw[i][2] - raw[j][2];
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (Math.abs(d - edgeLen) < eps) {
        adj[i].push(j);
        adj[j].push(i);
      }
    }
  }

  return { adj, edgeLen };
}

/**
 * Sort a list of vertex indices CCW around their centroid,
 * given an outward normal direction.
 */
export function sortCCW(raw: RawVerts, indices: number[], normal: [number, number, number]): number[] {
  let gcx = 0, gcy = 0, gcz = 0;
  for (const i of indices) { gcx += raw[i][0]; gcy += raw[i][1]; gcz += raw[i][2]; }
  const cnt = indices.length;
  gcx /= cnt; gcy /= cnt; gcz /= cnt;

  const [nx, ny, nz] = normal;
  const [p0x, p0y, p0z] = raw[indices[0]];
  let e0x = p0x - gcx, e0y = p0y - gcy, e0z = p0z - gcz;
  const dot0 = e0x * nx + e0y * ny + e0z * nz;
  e0x -= dot0 * nx; e0y -= dot0 * ny; e0z -= dot0 * nz;
  const len0 = Math.sqrt(e0x * e0x + e0y * e0y + e0z * e0z);
  e0x /= len0; e0y /= len0; e0z /= len0;
  const e1x = ny * e0z - nz * e0y;
  const e1y = nz * e0x - nx * e0z;
  const e1z = nx * e0y - ny * e0x;

  const angles = indices.map((i) => {
    const [px, py, pz] = raw[i];
    const dx = px - gcx, dy = py - gcy, dz = pz - gcz;
    const u = dx * e0x + dy * e0y + dz * e0z;
    const w = dx * e1x + dy * e1y + dz * e1z;
    return { i, angle: Math.atan2(w, u) };
  });
  angles.sort((a, b) => a.angle - b.angle);
  return angles.map((a) => a.i);
}

/** Compute the outward face normal as the normalised centroid direction. */
export function faceNormal(raw: RawVerts, indices: number[]): [number, number, number] {
  let gcx = 0, gcy = 0, gcz = 0;
  for (const i of indices) { gcx += raw[i][0]; gcy += raw[i][1]; gcz += raw[i][2]; }
  const cnt = indices.length;
  gcx /= cnt; gcy /= cnt; gcz /= cnt;
  const nl = Math.sqrt(gcx * gcx + gcy * gcy + gcz * gcz);
  return [gcx / nl, gcy / nl, gcz / nl];
}
