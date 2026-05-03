/**
 * Camera-direction quantization for occlusion culling.
 *
 * The continuous space of camera directions (a hemisphere or full sphere of
 * unit vectors) is split into a fixed grid of bins. Each bin has a "center
 * direction" — the unit vector at the bin's midpoint — used to precompute
 * which voxels would be hidden when the camera is anywhere in that bin.
 *
 * The grid is azimuth × elevation:
 *   - azimuth: 0..360° around the vertical axis (matches voxcss rotY)
 *   - elevation: 0..180° from straight-up to straight-down (matches voxcss rotX)
 *
 * Total bins = AZIMUTH_BINS × ELEVATION_BINS. With 8 × 8 = 64 we get ~45°
 * azimuth × ~22.5° elevation steps — coarse but fast. Bump for smoother
 * transitions at the cost of larger precompute and bigger DOM attributes.
 */

// Direction-octant culling: 8 camera direction octants based on the SIGN of
// (cx, cy, cz). Each octant covers a 90°×90° quadrant of camera direction.
// We only mark a cell occluded when ALL 3 of its camera-facing axis neighbors
// are cubes — that's "definitely hidden", not "probably hidden". Conservative
// but produces no false positives, scales to large scenes, keeps the
// per-element data attribute tiny (8 tokens vs 256), and runs in microseconds.
export const AZIMUTH_BINS = 4; // 4 azimuth × 2 elevation = 8 direction octants
export const ELEVATION_BINS = 2;
export const OCCLUSION_DIR_BINS = AZIMUTH_BINS * ELEVATION_BINS;

/** Bin index (0..OCCLUSION_DIR_BINS-1) for a camera at the given rotX/rotY. */
export function directionBinFromCamera(rotX: number = 65, rotY: number = 45): number {
  const az = ((rotY % 360) + 360) % 360;
  const el = clamp(rotX, 0, 180);
  const azBin = Math.min(AZIMUTH_BINS - 1, Math.floor((az / 360) * AZIMUTH_BINS));
  const elBin = Math.min(ELEVATION_BINS - 1, Math.floor((el / 180) * ELEVATION_BINS));
  return azBin * ELEVATION_BINS + elBin;
}

/** Center unit vector for the given bin. Used during occlusion precompute. */
export function directionVectorFromBin(bin: number): [number, number, number] {
  const azBin = Math.floor(bin / ELEVATION_BINS);
  const elBin = bin % ELEVATION_BINS;
  const azDeg = ((azBin + 0.5) / AZIMUTH_BINS) * 360;
  const elDeg = ((elBin + 0.5) / ELEVATION_BINS) * 180;
  const azRad = (azDeg * Math.PI) / 180;
  const elRad = (elDeg * Math.PI) / 180;
  // Standard spherical → cartesian: elevation measured from +Z (top).
  // elevation 0   = pure +Z (camera straight above)
  // elevation 90  = horizontal (camera at horizon)
  // elevation 180 = pure -Z (camera below)
  const horiz = Math.sin(elRad);
  const x = horiz * Math.cos(azRad);
  const y = horiz * Math.sin(azRad);
  const z = Math.cos(elRad);
  return [x, y, z];
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
