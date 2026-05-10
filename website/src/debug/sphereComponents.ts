import type { Polygon, Vec3 } from "polycss";

interface SphereFit {
  radius: number;
  p95: number;
  rms: number;
  extentRatio: number;
  centerOffset: number;
  bins: number;
  bboxDiag: number;
}

interface ComponentInfo {
  polygonIndices: number[];
  points: Vec3[];
}

export interface RemovedSphereLikeComponent extends SphereFit {
  polygons: number;
  vertices: number;
  radiusRel: number;
  bboxRel: number;
  groupSize: number;
}

export interface SphereLikeFilterResult {
  polygons: Polygon[];
  removedComponents: RemovedSphereLikeComponent[];
  removedPolygons: number;
}

interface SphereLikeCandidate {
  component: ComponentInfo;
  fit: SphereFit;
  radiusRel: number;
  bboxRel: number;
  groupKey: string;
}

// Conservative by design: this pass targets tiny repeated dense details,
// not semantic spheres that define a model's silhouette.
const MIN_COMPONENT_POLYGONS = 32;
const MIN_COMPONENT_VERTICES = 20;
const MIN_REPEATED_GROUP_SIZE = 4;
const MIN_TOTAL_REMOVED_POLYGONS = 512;
const MIN_TOTAL_REMOVED_RATIO = 0.05;
const MAX_TINY_RADIUS_RATIO = 0.01;
const MAX_TINY_BBOX_RATIO = 0.035;

export function removeTinyRepeatedSphereLikeComponents(polygons: Polygon[]): SphereLikeFilterResult {
  const components = findConnectedComponents(polygons);
  const modelDiagonal = modelBounds(polygons).diagonal;
  if (modelDiagonal <= 0) {
    return { polygons, removedComponents: [], removedPolygons: 0 };
  }

  const candidates: SphereLikeCandidate[] = [];
  const groupSizes = new Map<string, number>();

  for (const component of components) {
    if (component.polygonIndices.length < MIN_COMPONENT_POLYGONS || component.points.length < MIN_COMPONENT_VERTICES) {
      continue;
    }
    const fit = fitSphere(component.points);
    if (!fit || !isSphereLikeFit(fit)) continue;

    const radiusRel = fit.radius / modelDiagonal;
    const bboxRel = fit.bboxDiag / modelDiagonal;
    const groupKey = sphereGroupKey(component, radiusRel);
    candidates.push({ component, fit, radiusRel, bboxRel, groupKey });
    groupSizes.set(groupKey, (groupSizes.get(groupKey) ?? 0) + 1);
  }

  const remove = new Set<number>();
  const removedComponents: RemovedSphereLikeComponent[] = [];

  for (const candidate of candidates) {
    const groupSize = groupSizes.get(candidate.groupKey) ?? 0;
    if (!isTinyRepeatedCandidate(candidate, groupSize)) continue;

    for (const index of candidate.component.polygonIndices) remove.add(index);
    removedComponents.push({
      ...candidate.fit,
      polygons: candidate.component.polygonIndices.length,
      vertices: candidate.component.points.length,
      radiusRel: candidate.radiusRel,
      bboxRel: candidate.bboxRel,
      groupSize,
    });
  }

  if (
    remove.size < MIN_TOTAL_REMOVED_POLYGONS ||
    remove.size / Math.max(1, polygons.length) < MIN_TOTAL_REMOVED_RATIO
  ) {
    return { polygons, removedComponents: [], removedPolygons: 0 };
  }

  return {
    polygons: remove.size > 0
      ? polygons.filter((_, index) => !remove.has(index))
      : polygons,
    removedComponents,
    removedPolygons: remove.size,
  };
}

function isSphereLikeFit(fit: SphereFit): boolean {
  return (
    fit.p95 <= 0.055 &&
    fit.rms <= 0.04 &&
    fit.extentRatio >= 0.45 &&
    fit.centerOffset <= 0.55
  );
}

function isTinyRepeatedCandidate(candidate: SphereLikeCandidate, groupSize: number): boolean {
  return (
    groupSize >= MIN_REPEATED_GROUP_SIZE &&
    candidate.radiusRel <= MAX_TINY_RADIUS_RATIO &&
    candidate.bboxRel <= MAX_TINY_BBOX_RATIO
  );
}

function sphereGroupKey(component: ComponentInfo, radiusRel: number): string {
  return [
    component.polygonIndices.length,
    component.points.length,
    Math.round(radiusRel * 1000),
  ].join("|");
}

function modelBounds(polygons: Polygon[]): { diagonal: number } {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];

  for (const polygon of polygons) {
    for (const vertex of polygon.vertices) {
      for (let i = 0; i < 3; i++) {
        min[i] = Math.min(min[i], vertex[i]);
        max[i] = Math.max(max[i], vertex[i]);
      }
    }
  }

  if (!Number.isFinite(min[0])) return { diagonal: 0 };
  return {
    diagonal: Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]),
  };
}

function findConnectedComponents(polygons: Polygon[]): ComponentInfo[] {
  const keyToPolygon = new Map<string, number[]>();

  polygons.forEach((polygon, index) => {
    for (const vertex of polygon.vertices) {
      const key = vertexKey(vertex);
      const list = keyToPolygon.get(key);
      if (list) list.push(index);
      else keyToPolygon.set(key, [index]);
    }
  });

  const seen = new Uint8Array(polygons.length);
  const components: ComponentInfo[] = [];

  for (let i = 0; i < polygons.length; i++) {
    if (seen[i]) continue;

    const stack = [i];
    const polygonIndices: number[] = [];
    const pointKeys = new Set<string>();
    const points: Vec3[] = [];
    seen[i] = 1;

    while (stack.length > 0) {
      const current = stack.pop()!;
      polygonIndices.push(current);

      for (const vertex of polygons[current].vertices) {
        const key = vertexKey(vertex);
        if (!pointKeys.has(key)) {
          pointKeys.add(key);
          points.push(vertex);
        }

        for (const next of keyToPolygon.get(key) ?? []) {
          if (seen[next]) continue;
          seen[next] = 1;
          stack.push(next);
        }
      }
    }

    components.push({ polygonIndices, points });
  }

  return components;
}

function fitSphere(points: Vec3[]): SphereFit | null {
  const A = Array.from({ length: 4 }, () => [0, 0, 0, 0]);
  const b = [0, 0, 0, 0];

  for (const [x, y, z] of points) {
    const row = [x, y, z, 1];
    const rhs = -(x * x + y * y + z * z);
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) A[i][j] += row[i] * row[j];
      b[i] += row[i] * rhs;
    }
  }

  const sol = solve4(A, b);
  if (!sol) return null;

  const [a, bb, c, d] = sol;
  const center: Vec3 = [-a / 2, -bb / 2, -c / 2];
  const radius2 = center[0] ** 2 + center[1] ** 2 + center[2] ** 2 - d;
  if (!(radius2 > 0)) return null;

  const radius = Math.sqrt(radius2);
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  const devs: number[] = [];
  const bins = new Set<string>();

  for (const point of points) {
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i], point[i]);
      max[i] = Math.max(max[i], point[i]);
    }

    const vx = point[0] - center[0];
    const vy = point[1] - center[1];
    const vz = point[2] - center[2];
    const len = Math.hypot(vx, vy, vz) || 1;
    devs.push(Math.abs(len - radius) / radius);

    const theta = Math.atan2(vy / len, vx / len);
    const phi = Math.asin(Math.max(-1, Math.min(1, vz / len)));
    const thetaBin = Math.floor(((theta + Math.PI) / (2 * Math.PI)) * 16);
    const phiBin = Math.floor(((phi + Math.PI / 2) / Math.PI) * 8);
    bins.add(`${thetaBin},${phiBin}`);
  }

  devs.sort((left, right) => left - right);
  const p95 = devs[Math.floor(0.95 * (devs.length - 1))] ?? Infinity;
  const rms = Math.sqrt(devs.reduce((sum, value) => sum + value * value, 0) / devs.length);
  const extents = [max[0] - min[0], max[1] - min[1], max[2] - min[2]].sort((left, right) => left - right);
  const extentRatio = extents[2] > 0 ? extents[0] / extents[2] : 0;
  const bboxDiag = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
  const boxCenter: Vec3 = [
    (min[0] + max[0]) / 2,
    (min[1] + max[1]) / 2,
    (min[2] + max[2]) / 2,
  ];
  const centerOffset = Math.hypot(
    center[0] - boxCenter[0],
    center[1] - boxCenter[1],
    center[2] - boxCenter[2],
  ) / radius;

  return {
    radius,
    p95,
    rms,
    extentRatio,
    centerOffset,
    bins: bins.size,
    bboxDiag,
  };
}

function solve4(A: number[][], b: number[]): number[] | null {
  const matrix = A.map((row) => row.slice());
  const rhs = b.slice();

  for (let i = 0; i < 4; i++) {
    let pivot = i;
    for (let r = i + 1; r < 4; r++) {
      if (Math.abs(matrix[r][i]) > Math.abs(matrix[pivot][i])) pivot = r;
    }
    if (Math.abs(matrix[pivot][i]) < 1e-12) return null;

    [matrix[i], matrix[pivot]] = [matrix[pivot], matrix[i]];
    [rhs[i], rhs[pivot]] = [rhs[pivot], rhs[i]];

    const div = matrix[i][i];
    for (let c = i; c < 4; c++) matrix[i][c] /= div;
    rhs[i] /= div;

    for (let r = 0; r < 4; r++) {
      if (r === i) continue;
      const factor = matrix[r][i];
      for (let c = i; c < 4; c++) matrix[r][c] -= factor * matrix[i][c];
      rhs[r] -= factor * rhs[i];
    }
  }

  return rhs;
}

function vertexKey([x, y, z]: Vec3): string {
  return `${Math.round(x * 1000)},${Math.round(y * 1000)},${Math.round(z * 1000)}`;
}
