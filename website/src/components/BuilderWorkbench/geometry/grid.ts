/**
 * Editor floor grid for the /builder viewport — terrain-aware.
 *
 * Each gridline is broken into per-cell segments whose endpoints sit at
 * the heightmap's vertex elevations. Flat regions (every segment in a
 * row has both endpoints at z = 0) collapse into one long slab so a
 * pristine heightmap stays cheap (~80 polygons, same as before). Each
 * raised vertex breaks the lines that pass through it into a short
 * elevated segment + adjacent flat runs — the grid bends to meet the
 * new bump.
 */
import type { Polygon, Vec3 } from "@layoutit/polycss-core";
import { vertexKey, type TerrainVertices } from "./terrain";

export interface BuilderGridOptions {
  /** Side length of the grid in world units. Default 200. */
  size?: number;
  /** Distance between adjacent gridlines in world units. Default 5. */
  spacing?: number;
  /** Line width in world units. Default 0.05 — reads as a hairline at
   *  orbit distance. */
  thickness?: number;
  /** Color of each gridline. */
  color?: string;
  /** Heightmap. Empty map ⇒ flat grid (every line is one long slab). */
  vertices?: TerrainVertices;
}

/** Emit a flat slab between two vertex indices along a constant-Y row
 *  (X-direction line). Both endpoints are at z = 0 — used for flat
 *  runs that collapsed during scan. */
function flatXSlab(
  i0: number, i1: number, j: number,
  spacing: number, halfT: number, color: string,
): Polygon {
  const x0 = i0 * spacing;
  const x1 = i1 * spacing;
  const y  = j  * spacing;
  return {
    vertices: [
      [x0, y - halfT, 0],
      [x1, y - halfT, 0],
      [x1, y + halfT, 0],
      [x0, y + halfT, 0],
    ] as [Vec3, Vec3, Vec3, Vec3],
    color,
  };
}

/** Single X-direction cell segment from (i, j) to (i+1, j). The slab
 *  lies in the plane that contains the line and the perpendicular
 *  (constant-Y) thickness axis — always planar even when z0 != z1. */
function xSegment(
  i: number, j: number, z0: number, z1: number,
  spacing: number, halfT: number, color: string,
): Polygon {
  const x0 = i * spacing;
  const x1 = (i + 1) * spacing;
  const y  = j * spacing;
  return {
    vertices: [
      [x0, y - halfT, z0],
      [x1, y - halfT, z1],
      [x1, y + halfT, z1],
      [x0, y + halfT, z0],
    ] as [Vec3, Vec3, Vec3, Vec3],
    color,
  };
}

function flatYSlab(
  i: number, j0: number, j1: number,
  spacing: number, halfT: number, color: string,
): Polygon {
  const x  = i  * spacing;
  const y0 = j0 * spacing;
  const y1 = j1 * spacing;
  return {
    vertices: [
      [x - halfT, y0, 0],
      [x + halfT, y0, 0],
      [x + halfT, y1, 0],
      [x - halfT, y1, 0],
    ] as [Vec3, Vec3, Vec3, Vec3],
    color,
  };
}

function ySegment(
  i: number, j: number, z0: number, z1: number,
  spacing: number, halfT: number, color: string,
): Polygon {
  const x  = i * spacing;
  const y0 = j * spacing;
  const y1 = (j + 1) * spacing;
  return {
    vertices: [
      [x - halfT, y0, z0],
      [x + halfT, y0, z0],
      [x + halfT, y1, z1],
      [x - halfT, y1, z1],
    ] as [Vec3, Vec3, Vec3, Vec3],
    color,
  };
}

export function buildGridPolygons(options: BuilderGridOptions = {}): Polygon[] {
  const size      = options.size      ?? 200;
  const spacing   = options.spacing   ?? 5;
  const thickness = options.thickness ?? 0.05;
  const color     = options.color     ?? "#3a4250";
  const vertices  = options.vertices  ?? new Map<string, number>();

  const halfT     = thickness / 2;
  const halfCells = Math.floor(size / 2 / spacing);
  const getZ = (i: number, j: number): number => vertices.get(vertexKey(i, j)) ?? 0;

  const polys: Polygon[] = [];

  // X-direction lines at each j. Walk i; collapse runs of flat
  // segments into one long slab, emit elevated segments individually.
  for (let j = -halfCells; j <= halfCells; j++) {
    let runStart: number | null = null;
    for (let i = -halfCells; i < halfCells; i++) {
      const zL = getZ(i, j);
      const zR = getZ(i + 1, j);
      const isFlat = zL === 0 && zR === 0;
      if (isFlat) {
        if (runStart === null) runStart = i;
      } else {
        if (runStart !== null) {
          polys.push(flatXSlab(runStart, i, j, spacing, halfT, color));
          runStart = null;
        }
        polys.push(xSegment(i, j, zL, zR, spacing, halfT, color));
      }
    }
    if (runStart !== null) polys.push(flatXSlab(runStart, halfCells, j, spacing, halfT, color));
  }

  // Y-direction lines at each i.
  for (let i = -halfCells; i <= halfCells; i++) {
    let runStart: number | null = null;
    for (let j = -halfCells; j < halfCells; j++) {
      const zL = getZ(i, j);
      const zU = getZ(i, j + 1);
      const isFlat = zL === 0 && zU === 0;
      if (isFlat) {
        if (runStart === null) runStart = j;
      } else {
        if (runStart !== null) {
          polys.push(flatYSlab(i, runStart, j, spacing, halfT, color));
          runStart = null;
        }
        polys.push(ySegment(i, j, zL, zU, spacing, halfT, color));
      }
    }
    if (runStart !== null) polys.push(flatYSlab(i, runStart, halfCells, spacing, halfT, color));
  }

  return polys;
}
