import type { Vec3 } from "../types";

/**
 * Apply CSS-style chained `rotateX(rx) rotateY(ry) rotateZ(rz)` rotation
 * to a 3D vector. Matches the matrix composition used by glyphcss mesh
 * wrapper transforms (see `buildTransform` in each PolyMesh implementation).
 *
 * CSS composes `transform: rotateX(rx) rotateY(ry) rotateZ(rz)` as the
 * matrix `M = Rx · Ry · Rz`, applied to a point as `M · p` — so Rz acts
 * first on the point, then Ry, then Rx. Compound rotations only commute
 * when axes coincide; getting the order wrong silently corrupts results
 * for any two-axis combination.
 *
 * Angles in degrees.
 */
export function rotateVec3(v: Vec3, rxDeg: number, ryDeg: number, rzDeg: number): Vec3 {
  const dx = (rxDeg * Math.PI) / 180;
  const dy = (ryDeg * Math.PI) / 180;
  const dz = (rzDeg * Math.PI) / 180;
  let [x, y, z] = v;
  if (dz !== 0) {
    const c = Math.cos(dz), s = Math.sin(dz);
    [x, y] = [x * c - y * s, x * s + y * c];
  }
  if (dy !== 0) {
    const c = Math.cos(dy), s = Math.sin(dy);
    [x, z] = [x * c + z * s, -x * s + z * c];
  }
  if (dx !== 0) {
    const c = Math.cos(dx), s = Math.sin(dx);
    [y, z] = [y * c - z * s, y * s + z * c];
  }
  return [x, y, z];
}

/**
 * Inverse of `rotateVec3` for the same rotation tuple — transforms a
 * world-space vector into the mesh's local frame. Used by the baked
 * atlas pipeline to inverse-rotate the directional light so the
 * pre-multiplied Lambert shading stays correct after the mesh rotates,
 * and by the dynamic-mode CSS-var override for the same reason.
 *
 * The inverse of `M = Rx · Ry · Rz` is `M⁻¹ = Rz⁻¹ · Ry⁻¹ · Rx⁻¹`, so
 * Rx⁻¹ acts first on the vector, then Ry⁻¹, then Rz⁻¹.
 *
 * `rot` is `[rxDeg, ryDeg, rzDeg]` matching the mesh's CSS rotation prop.
 */
export function inverseRotateVec3(v: Vec3, rot: Vec3): Vec3 {
  const dx = (-rot[0] * Math.PI) / 180;
  const dy = (-rot[1] * Math.PI) / 180;
  const dz = (-rot[2] * Math.PI) / 180;
  let [x, y, z] = v;
  if (dx !== 0) {
    const c = Math.cos(dx), s = Math.sin(dx);
    [y, z] = [y * c - z * s, y * s + z * c];
  }
  if (dy !== 0) {
    const c = Math.cos(dy), s = Math.sin(dy);
    [x, z] = [x * c + z * s, -x * s + z * c];
  }
  if (dz !== 0) {
    const c = Math.cos(dz), s = Math.sin(dz);
    [x, y] = [x * c - y * s, x * s + y * c];
  }
  return [x, y, z];
}
