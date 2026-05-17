/**
 * Terrain geometry — vertex-based sparse heightmap for the /builder editor.
 *
 * Heightmap model:
 *   Keys are integer GRID VERTEX indices (i, j); each vertex sits at
 *   world position (i * cellSize, j * cellSize). The value is the
 *   vertex's elevation in WORLD units. Absent keys mean z = 0.
 *
 * Rendering model — **tilted quads, not boxes.**
 *   Each CELL is the square between vertices (i, j) ↔ (i+1, j+1).
 *   If ANY of those 4 corners is non-zero, the cell renders as a
 *   single tilted quad with the actual corner heights. Cells whose
 *   4 corners are all 0 don't render — the flat floor grid is
 *   visible in their place.
 *
 *   Because adjacent cells SHARE corners, raising a vertex
 *   automatically tilts the 4 cells touching it: the cell with the
 *   raised vertex as a corner becomes a ramp pulled toward that
 *   corner, and the cells on the other sides of the raised vertex
 *   form matching ramps. No box rendering, no z-fighting with the
 *   floor — the warp emerges from sharing vertex heights.
 *
 * The hover ghost marks the nearest VERTEX (where the next click
 * will land) — a small translucent cyan square at the vertex.
 */

import type { Polygon } from "@layoutit/polycss-react";

/** Sparse heightmap: vertex (i, j) → elevation in world units. */
export type TerrainVertices = Map<string, number>;

export const vertexKey = (i: number, j: number): string => `${i},${j}`;
export function parseVertexKey(key: string): [number, number] {
  const [i, j] = key.split(",").map(Number);
  return [i, j];
}

/** Project a world XY to the nearest VERTEX index. Used for tools —
 *  clicks snap to the closest grid intersection. */
export function worldToVertex(worldX: number, worldY: number, cellSize: number): [number, number] {
  return [Math.round(worldX / cellSize), Math.round(worldY / cellSize)];
}

/** Project a world XY to the CELL index that contains it. Used to
 *  determine which cells touch the hovered vertex (the cell whose
 *  corners are (i, j), (i+1, j), (i+1, j+1), (i, j+1)). */
export function worldToCell(worldX: number, worldY: number, cellSize: number): [number, number] {
  return [Math.floor(worldX / cellSize), Math.floor(worldY / cellSize)];
}

/** Build the polygons for every cell that has at least one elevated
 *  corner. Each such cell renders as a single tilted quad spanning
 *  (i, j) → (i+1, j+1) with the actual corner heights. */
export interface TerrainRenderOptions {
  vertices: TerrainVertices;
  cellSize: number;
  color?: string;
}

export function buildTerrainPolygons(opts: TerrainRenderOptions): Polygon[] {
  const color = opts.color ?? "rgba(34, 211, 238, 0.35)";
  const polys: Polygon[] = [];

  // Walk the set of CELLS that have at least one non-zero corner. A
  // vertex is shared by up to 4 cells (its NW, NE, SE, SW), so for
  // each non-zero vertex we mark all 4 touching cells dirty.
  const dirtyCells = new Set<string>();
  for (const key of opts.vertices.keys()) {
    const [i, j] = parseVertexKey(key);
    dirtyCells.add(vertexKey(i - 1, j - 1));
    dirtyCells.add(vertexKey(i,     j - 1));
    dirtyCells.add(vertexKey(i - 1, j));
    dirtyCells.add(vertexKey(i,     j));
  }

  const getZ = (i: number, j: number): number => opts.vertices.get(vertexKey(i, j)) ?? 0;

  for (const cellKey of dirtyCells) {
    const [ci, cj] = parseVertexKey(cellKey);
    const x0 = ci * opts.cellSize;
    const x1 = (ci + 1) * opts.cellSize;
    const y0 = cj * opts.cellSize;
    const y1 = (cj + 1) * opts.cellSize;
    const z00 = getZ(ci,     cj);
    const z10 = getZ(ci + 1, cj);
    const z11 = getZ(ci + 1, cj + 1);
    const z01 = getZ(ci,     cj + 1);
    const p00: [number, number, number] = [x0, y0, z00];
    const p10: [number, number, number] = [x1, y0, z10];
    const p11: [number, number, number] = [x1, y1, z11];
    const p01: [number, number, number] = [x0, y1, z01];
    // Split each cell into 2 triangles along the (p00 → p11) diagonal.
    // A non-planar quad would be auto-snapped by polycss (see CLAUDE.md
    // "Coplanarity is a hard requirement at render time…") which opens
    // visible seams with neighbouring cells; triangles are inherently
    // planar so the warped surface stays gap-free. CCW from +Z on both
    // tris so the surface normal points up.
    polys.push({ vertices: [p00, p10, p11], color });
    polys.push({ vertices: [p00, p11, p01], color });
  }

  return polys;
}

/** Sample the heightmap at a continuous world (x, y) and return both
 *  the surface elevation z AND the slope gradients dz/dx, dz/dy at
 *  that point. The interpolation matches the rendered triangulation
 *  (cells are split along the (p00 → p11) diagonal, see
 *  `buildTerrainPolygons`) so a placement queried via this function
 *  lands exactly on the visible surface. Both gradients are constant
 *  within each triangle, so a placement on a slope reads the same
 *  tilt anywhere inside that triangle. */
export interface TerrainSample {
  z: number;
  slopeX: number;
  slopeY: number;
}

export function sampleTerrain(
  vertices: TerrainVertices,
  cellSize: number,
  worldX: number,
  worldY: number,
): TerrainSample {
  const ci = Math.floor(worldX / cellSize);
  const cj = Math.floor(worldY / cellSize);
  const u = (worldX - ci * cellSize) / cellSize;
  const v = (worldY - cj * cellSize) / cellSize;

  const z00 = vertices.get(vertexKey(ci,     cj)) ?? 0;
  const z10 = vertices.get(vertexKey(ci + 1, cj)) ?? 0;
  const z11 = vertices.get(vertexKey(ci + 1, cj + 1)) ?? 0;
  const z01 = vertices.get(vertexKey(ci,     cj + 1)) ?? 0;

  // Z matches the rendered tris: tri1 = p00, p10, p11 (u > v);
  // tri2 = p00, p11, p01 (u <= v). The two triangles share the diagonal
  // p00↔p11, so Z is continuous across it — only the slope is not.
  let z: number;
  if (u > v) {
    z = (1 - u) * z00 + (u - v) * z10 + v * z11;
  } else {
    z = (1 - v) * z00 + u * z11 + (v - u) * z01;
  }

  // Slope uses a single best-fit plane across all 4 corners of the
  // cell, not the per-triangle gradient. On a non-planar cell (e.g.
  // one corner raised) the two triangles have very different slopes,
  // and an object whose footprint straddles the diagonal can't match
  // both. The cell-average plane is the linear approximation that
  // minimises the maximum deviation across the whole face — and it
  // gives the placement a single stable orientation no matter which
  // side of the diagonal its centre lands on. Object's centre still
  // sits exactly on the visible ridge via the per-triangle Z above.
  const slopeX = ((z10 + z11) - (z00 + z01)) / (2 * cellSize);
  const slopeY = ((z01 + z11) - (z00 + z10)) / (2 * cellSize);

  return { z, slopeX, slopeY };
}

/** Convert slope gradients into a [rotX, rotY, 0] Euler triple (in
 *  degrees) that tilts a horizontal mesh so its local +Z aligns with
 *  the surface normal — i.e. `PolyMesh.rotation` values to pass.
 *
 *  Slot mapping accounts for the world↔CSS axis swap (`cssPoints`
 *  maps world (x,y,z) → CSS (y,x,z)). CSS `rotateX` preserves CSS-X
 *  = world-Y, so it tilts the world-X side up/down → it carries
 *  `slopeX`. CSS `rotateY` preserves CSS-Y = world-X, so it tilts
 *  the world-Y side → it carries `slopeY`. The negative sign on the
 *  rotY arm comes from CSS rotateY's left-handed direction in this
 *  axis convention: `rotateY(+α)` takes +CSS-X (= +world-Y) toward
 *  -CSS-Z (down), so to lift +world-Y for a positive slopeY we need
 *  the opposite sign. */
export function rotationForSlope(slopeX: number, slopeY: number): [number, number, number] {
  const rotX = (Math.atan(slopeX) * 180) / Math.PI;
  const rotY = (-Math.atan(slopeY) * 180) / Math.PI;
  return [rotX, rotY, 0];
}

/** Build the hover ghost — visual feedback for where the next click
 *  will land. Vertex target = a small cyan square centred on the
 *  vertex. Face target = a translucent quad covering the cell at its
 *  current corner heights (2 triangles to stay planar). */
export type HoverTarget =
  | { kind: "vertex"; i: number; j: number }
  | { kind: "face";   i: number; j: number };

export interface HoverGhostOptions {
  target: HoverTarget | null;
  cellSize: number;
  /** Heightmap. Used to read the cell's corner heights in face mode
   *  and the vertex elevation in vertex mode (so the marker doesn't
   *  sink inside a raised surface). */
  vertices: TerrainVertices;
  /** Half-side of the vertex marker, in world units. Default 0.4. */
  size?: number;
  color?: string;
}

export function buildHoverGhostPolygons(opts: HoverGhostOptions): Polygon[] {
  if (!opts.target) return [];
  const color = opts.color ?? "rgba(0, 217, 255, 0.5)";
  if (opts.target.kind === "face") {
    const { i, j } = opts.target;
    const x0 = i * opts.cellSize;
    const x1 = (i + 1) * opts.cellSize;
    const y0 = j * opts.cellSize;
    const y1 = (j + 1) * opts.cellSize;
    const z00 = opts.vertices.get(vertexKey(i,     j)) ?? 0;
    const z10 = opts.vertices.get(vertexKey(i + 1, j)) ?? 0;
    const z11 = opts.vertices.get(vertexKey(i + 1, j + 1)) ?? 0;
    const z01 = opts.vertices.get(vertexKey(i,     j + 1)) ?? 0;
    // Slight z-offset so the highlight doesn't z-fight with the grid.
    const off = 0.05;
    const p00: [number, number, number] = [x0, y0, z00 + off];
    const p10: [number, number, number] = [x1, y0, z10 + off];
    const p11: [number, number, number] = [x1, y1, z11 + off];
    const p01: [number, number, number] = [x0, y1, z01 + off];
    return [
      { vertices: [p00, p10, p11], color },
      { vertices: [p00, p11, p01], color },
    ];
  }
  // Vertex target — small marker square at the vertex's current
  // elevation so it doesn't disappear inside a raised surface.
  const size = opts.size ?? 0.4;
  const { i, j } = opts.target;
  const cx = i * opts.cellSize;
  const cy = j * opts.cellSize;
  const z = (opts.vertices.get(vertexKey(i, j)) ?? 0) + 0.05;
  return [{
    vertices: [
      [cx - size, cy - size, z],
      [cx + size, cy - size, z],
      [cx + size, cy + size, z],
      [cx - size, cy + size, z],
    ],
    color,
  }];
}
