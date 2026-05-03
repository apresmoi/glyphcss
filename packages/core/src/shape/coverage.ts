/**
 * Per-shape opaque coverage of cube faces. Used by visibility logic so a
 * partial-coverage shape (spike, ramp, wedge) doesn't incorrectly cull a
 * neighbor's face.
 *
 * Direction conventions (from DEFAULT_OFFSETS):
 *   t  → +Z   b  → -Z
 *   fl → +X   br → -X
 *   fr → +Y   bl → -Y
 *
 * A face is "fully covered" iff the shape's geometry coincides with the entire
 * 1×1 area of that face on the cell boundary. A spike's bottom face is full
 * (the pyramid base IS the bottom face); its top is empty (just an apex
 * point); two of its side faces are filled-triangles (half coverage); the
 * other two are empty (just the bottom edge).
 */
import type { CubeFace, Voxel } from "../types";

const normalizeRotation = (r: number): 0 | 90 | 180 | 270 => {
  const n = ((Math.round(r / 90) * 90) % 360 + 360) % 360;
  return n as 0 | 90 | 180 | 270;
};

/** Opposite face on the neighbor cell that shares this face's plane. */
export function oppositeFace(face: CubeFace): CubeFace {
  switch (face) {
    case "t": return "b";
    case "b": return "t";
    case "fr": return "bl";
    case "bl": return "fr";
    case "fl": return "br";
    case "br": return "fl";
  }
}

/**
 * True iff the voxel's shape fully (100%) opaquely covers the named cube face.
 * Cubes return true everywhere. Sloped/cornered shapes only return true on
 * faces their geometry completely fills.
 */
export function shapeCoversFullyFace(voxel: Voxel, face: CubeFace): boolean {
  const shape = voxel.shape ?? "cube";
  if (shape === "cube") return true;

  const rot = normalizeRotation(voxel.rot ?? 0);

  if (shape === "ramp") return rampCoversFully(rot, face);
  if (shape === "spike") return spikeCoversFully(rot, face);
  if (shape === "wedge") return wedgeCoversFully(rot, face);
  return false;
}

/**
 * Ramp: slope drops along one horizontal axis (the "drop" direction).
 *   - bottom: full (the rectangular base)
 *   - back side (opposite the drop): full (the slope rises to the cell top here)
 *   - drop-direction side: empty (slope hits z=0 here)
 *   - perpendicular sides: triangle (half coverage)
 *   - top: empty (the slope is sub-cell-top everywhere except a degenerate edge)
 *
 * Rotation → drop direction (matches SphereTest's classifier and the
 * voxcss rot semantics for ramps):
 *   rot=0   → fr (+Y)    rot=90  → fl (+X)
 *   rot=180 → bl (-Y)    rot=270 → br (-X)
 */
function rampCoversFully(rot: 0 | 90 | 180 | 270, face: CubeFace): boolean {
  if (face === "t") return false;
  if (face === "b") return true;
  const drop = rampDropDirection(rot);
  if (face === drop) return false;
  if (face === oppositeFace(drop)) return true;
  return false;
}

function rampDropDirection(rot: 0 | 90 | 180 | 270): CubeFace {
  switch (rot) {
    case 0: return "fr";
    case 90: return "fl";
    case 180: return "bl";
    case 270: return "br";
  }
}

/**
 * Spike: pyramid with apex at one TOP corner and base = full bottom face.
 *   - bottom: full
 *   - top: empty (apex is a single point)
 *   - the 2 side faces adjacent to the apex column: triangle (half coverage)
 *   - the 2 side faces opposite the apex column: empty (just the bottom edge)
 *
 * Apex is at the corner OPPOSITE the spike's exposed sides. Rotation table
 * matches SphereTest's classifier:
 *   rot=0   → exposed (xn, yp) → apex at (+X, -Y)  → walls at fl(+X), bl(-Y)
 *   rot=90  → exposed (xp, yp) → apex at (-X, -Y)  → walls at br(-X), bl(-Y)
 *   rot=180 → exposed (xp, yn) → apex at (-X, +Y)  → walls at br(-X), fr(+Y)
 *   rot=270 → exposed (xn, yn) → apex at (+X, +Y)  → walls at fl(+X), fr(+Y)
 *
 * The "wall" faces are the two vertical triangles fully on the apex's column.
 * For partial-coverage purposes those triangles are NOT full — they're half-
 * face triangles — so they still don't fully occlude neighbor faces.
 */
function spikeCoversFully(_rot: 0 | 90 | 180 | 270, face: CubeFace): boolean {
  if (face === "t") return false;
  if (face === "b") return true;
  // Every side of a spike is at most a triangle, never a full square.
  return false;
}

/**
 * Wedge: half-cube cut diagonally. Conservatively report only bottom as full.
 * (The wedge geometry's exact face coverage is renderer-specific; treat top
 * and all sides as partial to avoid wrongly culling neighbor faces.)
 */
function wedgeCoversFully(_rot: 0 | 90 | 180 | 270, face: CubeFace): boolean {
  if (face === "b") return true;
  return false;
}
