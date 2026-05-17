/**
 * Project a screen-space pointer position to a world-space point on the
 * Z=0 ground plane.
 *
 * The polycss CSS transform stack (on the `.polycss-scene` element) is:
 *
 *   M = scale(zoom) rotateX(rotX) rotate(rotY) translate3d(-cssX, -cssY, -cssZ)
 *
 * where cssX = (target[1] + autoCenterOffset[1]) * BASE_TILE,
 *       cssY = (target[0] + autoCenterOffset[0]) * BASE_TILE,
 *       cssZ = (target[2] + autoCenterOffset[2]) * BASE_TILE.
 *
 * The camera element (.polycss-camera) has CSS `perspective: P` (or "none"
 * for orthographic). The eye position in camera-local space is (0, 0, P);
 * the viewer plane sits at cssZ=0.
 *
 * To convert a pointer at (clientX, clientY) → world (X, Y):
 *   1. Convert to camera-element-local coords centered at element middle:
 *      sx = clientX - rect.left - rect.width/2
 *      sy = clientY - rect.top  - rect.height/2
 *   2. Build a picking ray from eye=(0, 0, P) through (sx, sy, 0) in
 *      camera-local (= scene-parent) space. The ray is:
 *        R(t) = eye + t*(viewpoint - eye)
 *             = (0,0,P) + t*((sx,sy,0)-(0,0,P))
 *             = (t*sx, t*sy, P*(1-t))
 *   3. Apply M^-1 to bring both points into scene-local space.
 *      M^-1 = translate(+cssTarget) * rotate(-rotY) * rotateX(-rotX) * scale(1/zoom)
 *      Apply to eye and a far point (t=2) on the ray.
 *   4. In scene-local space, CSS-Z = 0 IS world Z = 0 (because the
 *      polycss axis swap maps worldZ to cssZ). Parameterise the scene-local
 *      ray and solve for the t that gives cssZ = 0.
 *   5. Read cssX, cssY at that t. Convert back:
 *        worldX = cssY / BASE_TILE
 *        worldY = cssX / BASE_TILE
 */

import type { SceneOptionsState } from "../types";

const BASE_TILE = 50;

/** 3D vector [x, y, z]. */
type V3 = [number, number, number];

function deg2rad(d: number): number {
  return (d * Math.PI) / 180;
}

/**
 * Apply a single row of the inverse transform:
 *   translate(+cssTarget) ∘ rotateZ(-rotY) ∘ rotateX(-rotX) ∘ scale(1/zoom)
 *
 * We apply the steps in order (innermost first in M^-1 = T * RZ * RX * S):
 *   1. scale(1/zoom)
 *   2. rotateX(-rotX)   — tilt back
 *   3. rotateZ(-rotY)   — rotate back  (CSS rotate() is actually rotateZ)
 *   4. translate(+cssX, +cssY, +cssZ)
 */
function applyInverseTransform(
  p: V3,
  zoom: number,
  rotXDeg: number,
  rotYDeg: number,
  cssX: number,
  cssY: number,
  cssZ: number,
): V3 {
  let [x, y, z] = p;

  // 1. scale(1/zoom)
  const inv = 1 / zoom;
  x *= inv;
  y *= inv;
  z *= inv;

  // 2. rotateX(-rotX) — undo the tilt
  const rxRad = deg2rad(-rotXDeg);
  const cosRx = Math.cos(rxRad);
  const sinRx = Math.sin(rxRad);
  // rotateX: y' = y*cos - z*sin, z' = y*sin + z*cos
  const y2 = y * cosRx - z * sinRx;
  const z2 = y * sinRx + z * cosRx;
  y = y2;
  z = z2;

  // 3. rotate(-rotY) — CSS rotate() is rotateZ; undo the compass heading
  const rzRad = deg2rad(-rotYDeg);
  const cosRz = Math.cos(rzRad);
  const sinRz = Math.sin(rzRad);
  // rotateZ: x' = x*cos - y*sin, y' = x*sin + y*cos
  const x3 = x * cosRz - y * sinRz;
  const y3 = x * sinRz + y * cosRz;
  x = x3;
  y = y3;

  // 4. translate(+cssX, +cssY, +cssZ)
  x += cssX;
  y += cssY;
  z += cssZ;

  return [x, y, z];
}

export interface ProjectScreenToWorldGroundArgs {
  clientX: number;
  clientY: number;
  /** The `.polycss-camera` DOM element — the element that has `perspective` in style. */
  cameraEl: HTMLElement;
  sceneOptions: Pick<SceneOptionsState, "zoom" | "rotX" | "rotY" | "target">;
  /** autoCenterOffset from the scene store — [worldX, worldY, worldZ]. */
  autoCenterOffset: [number, number, number];
}

/**
 * Returns [worldX, worldY] on the Z=0 ground plane for a pointer event, or
 * `null` if the ray is parallel to the ground (degenerate camera angle).
 */
export function projectScreenToWorldGround({
  clientX,
  clientY,
  cameraEl,
  sceneOptions,
  autoCenterOffset,
}: ProjectScreenToWorldGroundArgs): [number, number] | null {
  const rect = cameraEl.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return null;

  // Screen-space coords centered on the camera element's midpoint.
  const sx = clientX - rect.left - rect.width / 2;
  const sy = clientY - rect.top - rect.height / 2;

  // CSS perspective value on the camera element.
  const perspStr = getComputedStyle(cameraEl).perspective;
  const isOrthographic = !perspStr || perspStr === "none";
  const P = isOrthographic ? 0 : parseFloat(perspStr);

  // CSS-space target = (target + autoCenterOffset) * BASE_TILE
  // Axis swap: cssX = worldY * tile, cssY = worldX * tile, cssZ = worldZ * tile
  const { zoom, rotX, rotY, target } = sceneOptions;
  const [ox, oy, oz] = autoCenterOffset;
  const cssX = (target[1] + oy) * BASE_TILE;
  const cssY = (target[0] + ox) * BASE_TILE;
  const cssZ = (target[2] + oz) * BASE_TILE;

  let rayOriginScene: V3;
  let rayFarScene: V3;

  if (isOrthographic || P === 0 || !Number.isFinite(P)) {
    // Orthographic: the eye is effectively at infinity along +Z. The ray
    // direction in camera-local space is straight toward -Z through (sx, sy).
    // We use two points on the ray: (sx, sy, 1000) and (sx, sy, -1000).
    rayOriginScene = applyInverseTransform([sx, sy, 1000], zoom, rotX, rotY, cssX, cssY, cssZ);
    rayFarScene = applyInverseTransform([sx, sy, -1000], zoom, rotX, rotY, cssX, cssY, cssZ);
  } else {
    // Perspective: eye is at (0, 0, P) in camera-local space.
    // The ray passes through (sx, sy, 0) on the viewer plane at cssZ=0.
    // Two points: the eye itself and a far point along the ray.
    const eye: V3 = [0, 0, P];
    // Parametric: R(t) = eye + t*(viewpoint - eye). At t=1: viewpoint = (sx, sy, 0).
    // Pick t=10 as the far point so the direction is well-defined.
    const far: V3 = [sx * 10 - 0 * 9, sy * 10 - 0 * 9, 0 * 10 - P * 9];
    rayOriginScene = applyInverseTransform(eye, zoom, rotX, rotY, cssX, cssY, cssZ);
    rayFarScene = applyInverseTransform(far, zoom, rotX, rotY, cssX, cssY, cssZ);
  }

  // In scene-local space, CSS-Z = 0 IS world Z = 0.
  // Ray: R(t) = rayOriginScene + t * (rayFarScene - rayOriginScene)
  // Solve for t such that R(t)[2] = 0.
  const dz = rayFarScene[2] - rayOriginScene[2];
  if (Math.abs(dz) < 1e-10) {
    // Ray is parallel to the ground plane — can't intersect.
    return null;
  }
  const t = -rayOriginScene[2] / dz;

  const hitCssX = rayOriginScene[0] + t * (rayFarScene[0] - rayOriginScene[0]);
  const hitCssY = rayOriginScene[1] + t * (rayFarScene[1] - rayOriginScene[1]);

  // polycss axis swap: cssX = worldY * tile, cssY = worldX * tile.
  const worldX = hitCssY / BASE_TILE;
  const worldY = hitCssX / BASE_TILE;

  return [worldX, worldY];
}
