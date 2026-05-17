import type { Polygon, Vec3 } from "../types";
import { rotateVec3 } from "../math/rotation";

export const CAMERA_BACKFACE_CULL_EPS = 1e-5;
export const VOXEL_CAMERA_CULL_AXIS_EPS = 1e-3;
export const VOXEL_CAMERA_CULL_NORMAL_LIMIT = 6;

export interface CameraCullRotation {
  rotX: number;
  rotY: number;
  meshRotation?: Vec3;
}

export interface CameraCullNormalGroup {
  key: string;
  normal: Vec3;
}

export function polygonCssSurfaceNormal(polygon: Polygon): Vec3 | null {
  const vertices = polygon.vertices;
  if (vertices.length < 3) return null;
  const v0 = vertices[0];
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let i = 1; i + 1 < vertices.length; i++) {
    const v1 = vertices[i];
    const v2 = vertices[i + 1];
    const e1x = v1[1] - v0[1], e1y = v1[0] - v0[0], e1z = v1[2] - v0[2];
    const e2x = v2[1] - v0[1], e2y = v2[0] - v0[0], e2z = v2[2] - v0[2];
    nx -= e1y * e2z - e1z * e2y;
    ny -= e1z * e2x - e1x * e2z;
    nz -= e1x * e2y - e1y * e2x;
  }
  const len = Math.hypot(nx, ny, nz);
  if (len < 1e-9) return null;
  return [nx / len, ny / len, nz / len];
}

export function cameraFacingDepth(normal: Vec3, rotation: CameraCullRotation): number {
  const meshRotation = rotation.meshRotation;
  const meshNormal = meshRotation
    ? rotateVec3(normal, meshRotation[0] ?? 0, meshRotation[1] ?? 0, meshRotation[2] ?? 0)
    : normal;
  return rotateVec3(meshNormal, rotation.rotX, 0, rotation.rotY)[2];
}

export function normalFacesCamera(
  normal: Vec3,
  rotation: CameraCullRotation,
  depthThreshold = CAMERA_BACKFACE_CULL_EPS,
): boolean {
  return cameraFacingDepth(normal, rotation) > depthThreshold;
}

export function polygonFacesCamera(
  polygon: Polygon,
  rotation: CameraCullRotation,
  depthThreshold = CAMERA_BACKFACE_CULL_EPS,
): boolean {
  const normal = polygonCssSurfaceNormal(polygon);
  return normal === null || normalFacesCamera(normal, rotation, depthThreshold);
}

export function cameraCullNormalKey(normal: Vec3): string {
  return `${normal[0].toFixed(4)},${normal[1].toFixed(4)},${normal[2].toFixed(4)}`;
}

export function cameraCullNormalGroups(
  normals: Iterable<Vec3 | null | undefined>,
): CameraCullNormalGroup[] {
  const groups = new Map<string, Vec3>();
  for (const normal of normals) {
    if (!normal) continue;
    const key = cameraCullNormalKey(normal);
    if (!groups.has(key)) groups.set(key, normal);
  }
  return Array.from(groups, ([key, normal]) => ({ key, normal }));
}

export function cameraCullNormalGroupsFromPolygons(
  polygons: readonly Polygon[],
): CameraCullNormalGroup[] {
  return cameraCullNormalGroups(polygons.map(polygonCssSurfaceNormal));
}

export function isAxisAlignedSurfaceNormal(
  normal: Vec3,
  axisEpsilon = VOXEL_CAMERA_CULL_AXIS_EPS,
): boolean {
  const ax = Math.abs(normal[0]);
  const ay = Math.abs(normal[1]);
  const az = Math.abs(normal[2]);
  const max = Math.max(ax, ay, az);
  return max > 1 - axisEpsilon && ax + ay + az - max < axisEpsilon;
}

export function isVoxelCameraCullableNormalGroups(
  groups: readonly CameraCullNormalGroup[],
): boolean {
  return groups.length <= VOXEL_CAMERA_CULL_NORMAL_LIMIT &&
    groups.every(({ normal }) => isAxisAlignedSurfaceNormal(normal));
}

export function cameraCullVisibleSignature(
  groups: readonly CameraCullNormalGroup[],
  rotation: CameraCullRotation,
  depthThreshold = CAMERA_BACKFACE_CULL_EPS,
): string {
  const visible: string[] = [];
  for (const { key, normal } of groups) {
    if (normalFacesCamera(normal, rotation, depthThreshold)) visible.push(key);
  }
  visible.sort();
  return visible.join("|");
}
