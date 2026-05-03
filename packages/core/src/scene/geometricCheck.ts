/**
 * Geometric continuity check — finds shapes whose surfaces don't tile cleanly
 * with their neighbors, even when the polygon mesh is topologically closed.
 *
 * The manifold check (findGaps) reports zero defects for shapes whose
 * individual boundaries are closed, even if those shapes are visually
 * "isolated" — like a ramp whose vertical wall sticks 1 cell above the
 * adjacent column's top, leaving an exposed -Y wall whose outside is empty
 * but whose neighbor's volume actually extends right up to it. The wall
 * is topologically fine but geometrically a defect.
 *
 * This check captures the *visual* concept of a gap by:
 *   1. Building the exterior polygon surface (visible faces only).
 *   2. For every axis-aligned exposed face, looking at the unit cell
 *      JUST OUTSIDE the face in its outward-normal direction.
 *   3. If that outside cell is claimed by a different voxel, the face is
 *      "facing into solid" — a kink/step where two shapes don't tile flush.
 *
 * Sloped polygons (ramp slopes, spike slants) are skipped because their
 * "outside" cells are partial and the check loses meaning. The defects we
 * care about are flat rectangular walls, which are always axis-aligned.
 */
import type { Voxel } from "../types";
import type { Polygon } from "./polygonModel";
import { voxelToPolygons } from "./polygonModel";
import { extractExteriorSurface } from "./exteriorSurface";

export interface GeometricDefect {
  /** The exposed face polygon facing into a filled cell. */
  polygon: Polygon;
  /** The (x, y, z) integer cell on the outside of the face — claimed by another voxel. */
  blockedCell: { x: number; y: number; z: number };
  /** Voxel key (`x:y:z`) of the voxel claiming the blocked cell. */
  blockerVoxelKey: string;
}

/**
 * Cell-volume occupancy: only true if the cell's CENTER is inside the voxel's
 * actual solid volume (not just its bbox). Cubes fill their full bbox; ramps
 * fill the wedge below the slope plane; spikes fill the pyramid below the
 * apex's slant planes. This matters for the geometric check — without it, a
 * cube face adjacent to a spike's empty bbox-corner would be falsely flagged
 * as "facing into solid".
 */
function isCellInVoxelVolume(v: Voxel, x: number, y: number, z: number): boolean {
  const x2 = v.x2 ?? v.x + 1;
  const y2 = v.y2 ?? v.y + 1;
  const z2 = v.z2 ?? v.z + 1;
  if (x < v.x || x >= x2 || y < v.y || y >= y2 || z < v.z || z >= z2) return false;
  const shape = v.shape ?? "cube";
  if (shape === "cube") return true;

  const cx = x + 0.5, cy = y + 0.5, cz = z + 0.5;
  const rot = v.rot ?? 0;

  if (shape === "ramp") {
    // Slope plane: linear interpolation from "high side" (z=z2) to "low side"
    // (z=v.z) along the rotation-determined axis. Cell is inside the wedge if
    // its center's z is at or below the slope at that (x, y) location.
    let slopeZ: number;
    if (rot === 0) {
      slopeZ = z2 - (z2 - v.z) * (cy - v.y) / (y2 - v.y);
    } else if (rot === 90) {
      slopeZ = z2 - (z2 - v.z) * (cx - v.x) / (x2 - v.x);
    } else if (rot === 180) {
      slopeZ = z2 - (z2 - v.z) * (y2 - cy) / (y2 - v.y);
    } else {
      slopeZ = z2 - (z2 - v.z) * (x2 - cx) / (x2 - v.x);
    }
    return cz <= slopeZ;
  }

  if (shape === "spike") {
    // Pyramid with rectangular base at z=v.z and apex at (apexX, apexY, z2),
    // where the apex is at one of the four bbox top corners selected by rot.
    let apexAtMinX: boolean, apexAtMinY: boolean;
    if (rot === 0) { apexAtMinX = false; apexAtMinY = true; }     // apex (x2, y)
    else if (rot === 90) { apexAtMinX = true; apexAtMinY = true; } // (x, y)
    else if (rot === 180) { apexAtMinX = true; apexAtMinY = false; } // (x, y2)
    else { apexAtMinX = false; apexAtMinY = false; }                // (x2, y2)
    const t = (z2 - cz) / (z2 - v.z); // t=0 at apex z, t=1 at base z.
    // Cross-section grows from a point at apex (t=0) to full base at t=1,
    // anchored at the apex's bbox corner.
    const xMin = apexAtMinX ? v.x : x2 - t * (x2 - v.x);
    const xMax = apexAtMinX ? v.x + t * (x2 - v.x) : x2;
    const yMin = apexAtMinY ? v.y : y2 - t * (y2 - v.y);
    const yMax = apexAtMinY ? v.y + t * (y2 - v.y) : y2;
    return cx >= xMin && cx <= xMax && cy >= yMin && cy <= yMax;
  }

  return true;
}

export function findGeometricDefects(voxels: Voxel[]): GeometricDefect[] {
  // Build cell occupancy map keyed by which cells are ACTUALLY filled by each
  // voxel's solid volume — not just its bbox. Skipping bbox-claims-without-
  // volume eliminates false positives from spike/ramp empty corners.
  const cellOwner = new Map<string, string>();
  for (const v of voxels) {
    const x2 = v.x2 ?? v.x + 1;
    const y2 = v.y2 ?? v.y + 1;
    const z2 = v.z2 ?? v.z + 1;
    const k = `${v.x}:${v.y}:${v.z}`;
    for (let x = v.x; x < x2; x++) {
      for (let y = v.y; y < y2; y++) {
        for (let z = v.z; z < z2; z++) {
          if (!isCellInVoxelVolume(v, x, y, z)) continue;
          const cellKey = `${x}:${y}:${z}`;
          if (!cellOwner.has(cellKey)) cellOwner.set(cellKey, k);
        }
      }
    }
  }

  const polys: Polygon[] = [];
  for (const v of voxels) polys.push(...voxelToPolygons(v));
  const exterior = extractExteriorSurface(polys);

  const defects: GeometricDefect[] = [];
  for (const p of exterior) {
    if (p.v.length !== 4) continue; // sloped / triangle — skip
    const xs = p.v.map((v) => v[0]);
    const ys = p.v.map((v) => v[1]);
    const zs = p.v.map((v) => v[2]);
    const allXSame = xs.every((x) => x === xs[0]);
    const allYSame = ys.every((y) => y === ys[0]);
    const allZSame = zs.every((z) => z === zs[0]);
    if (!allXSame && !allYSame && !allZSame) continue;

    const a = p.v[0], b = p.v[1], c = p.v[2];
    const nx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]);
    const ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
    const nz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);

    let axis: "x" | "y" | "z";
    let offset: number;
    let normalSign: 1 | -1;
    if (allXSame) { axis = "x"; offset = xs[0]; normalSign = nx > 0 ? 1 : -1; }
    else if (allYSame) { axis = "y"; offset = ys[0]; normalSign = ny > 0 ? 1 : -1; }
    else { axis = "z"; offset = zs[0]; normalSign = nz > 0 ? 1 : -1; }

    // Cell index on the OUTSIDE of the face along the normal axis.
    // Normal +A → outside cells start at offset (cell extends offset..offset+1).
    // Normal -A → outside cells start at offset-1.
    const outsideCellCoord = normalSign > 0 ? offset : offset - 1;

    let c1Min: number, c1Max: number, c2Min: number, c2Max: number;
    if (axis === "x") {
      c1Min = Math.min(...ys); c1Max = Math.max(...ys);
      c2Min = Math.min(...zs); c2Max = Math.max(...zs);
    } else if (axis === "y") {
      c1Min = Math.min(...xs); c1Max = Math.max(...xs);
      c2Min = Math.min(...zs); c2Max = Math.max(...zs);
    } else {
      c1Min = Math.min(...xs); c1Max = Math.max(...xs);
      c2Min = Math.min(...ys); c2Max = Math.max(...ys);
    }

    for (let i = c1Min; i < c1Max; i++) {
      for (let j = c2Min; j < c2Max; j++) {
        let cellX: number, cellY: number, cellZ: number;
        if (axis === "x") { cellX = outsideCellCoord; cellY = i; cellZ = j; }
        else if (axis === "y") { cellX = i; cellY = outsideCellCoord; cellZ = j; }
        else { cellX = i; cellY = j; cellZ = outsideCellCoord; }
        const cellKey = `${cellX}:${cellY}:${cellZ}`;
        const blocker = cellOwner.get(cellKey);
        // Self-blocking would mean the face's own voxel claims the outside
        // cell, which shouldn't happen for a properly constructed shape —
        // skip the comparison to be safe though.
        if (blocker && blocker !== p.voxelKey) {
          defects.push({
            polygon: p,
            blockedCell: { x: cellX, y: cellY, z: cellZ },
            blockerVoxelKey: blocker,
          });
        }
      }
    }
  }
  return defects;
}
