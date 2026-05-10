import {
  cullInteriorPolygons,
  mergePolygons,
} from "@layoutit/polycss";
import type { Polygon, TextureTriangle, Vec2, Vec3 } from "@layoutit/polycss";

const NORMALIZE_MAX_ANGLE_DEG = 3;
const NORMALIZE_MAX_PLANE_DISPLACEMENT = 0.03;
const NORMALIZE_MAX_BOUNDARY_DISPLACEMENT = 0.02;

export interface GeometryNormalizeOptions {
  maxAngleDeg?: number;
  maxPlaneDisplacement?: number;
  maxBoundaryDisplacement?: number;
  isolatedPairs?: boolean;
}

interface ResolvedGeometryNormalizeOptions {
  maxAngleDeg: number;
  maxPlaneDisplacement: number;
  maxBoundaryDisplacement: number;
  isolatedPairs: boolean;
}

interface PlaneNormalizeMeta {
  polygon: Polygon;
  normal: Vec3;
  area: number;
  materialKey: string;
}

interface PlaneFit {
  normal: Vec3;
  point: Vec3;
}

interface PairCandidate {
  a: number;
  b: number;
  polygon: Polygon;
  score: number;
}

const DEFAULT_NORMALIZE_OPTIONS: ResolvedGeometryNormalizeOptions = {
  maxAngleDeg: NORMALIZE_MAX_ANGLE_DEG,
  maxPlaneDisplacement: NORMALIZE_MAX_PLANE_DISPLACEMENT,
  maxBoundaryDisplacement: NORMALIZE_MAX_BOUNDARY_DISPLACEMENT,
  isolatedPairs: false,
};

export function preprocessModelPolygons(
  polygons: Polygon[],
  normalizeGeometry: boolean | GeometryNormalizeOptions,
): Polygon[] {
  const baseline = mergePolygons(cullInteriorPolygons(polygons));
  if (!normalizeGeometry) return baseline;

  const options = normalizeGeometry === true
    ? DEFAULT_NORMALIZE_OPTIONS
    : resolveNormalizeOptions(normalizeGeometry);
  if (options.isolatedPairs) {
    const paired = mergeIsolatedTrianglePairs(cullInteriorPolygons(snapGeometryForMerge(polygons)), options);
    return paired.length < baseline.length ? paired : baseline;
  }
  const normalized = mergePolygons(cullInteriorPolygons(normalizeGeometryForMerge(polygons, options)));
  return normalized.length < baseline.length ? normalized : baseline;
}

function resolveNormalizeOptions(options: GeometryNormalizeOptions): ResolvedGeometryNormalizeOptions {
  return {
    maxAngleDeg: options.maxAngleDeg ?? DEFAULT_NORMALIZE_OPTIONS.maxAngleDeg,
    maxPlaneDisplacement: options.maxPlaneDisplacement ?? DEFAULT_NORMALIZE_OPTIONS.maxPlaneDisplacement,
    maxBoundaryDisplacement: options.maxBoundaryDisplacement ?? DEFAULT_NORMALIZE_OPTIONS.maxBoundaryDisplacement,
    isolatedPairs: options.isolatedPairs ?? DEFAULT_NORMALIZE_OPTIONS.isolatedPairs,
  };
}

function mergeIsolatedTrianglePairs(
  polygons: Polygon[],
  options: ResolvedGeometryNormalizeOptions,
): Polygon[] {
  const metas = polygons.map((polygon): PlaneNormalizeMeta | null => {
    const plane = planeOfPolygon(polygon);
    if (!plane) return null;
    return {
      polygon,
      normal: plane.normal,
      area: plane.area,
      materialKey: materialKeyForPolygon(polygon),
    };
  });
  const edgeOwners = new Map<string, number[]>();
  for (let i = 0; i < polygons.length; i++) {
    const polygon = polygons[i];
    if (polygon.vertices.length !== 3 || !metas[i]) continue;
    for (let j = 0; j < polygon.vertices.length; j++) {
      const key = edgeKey(polygon.vertices[j], polygon.vertices[(j + 1) % polygon.vertices.length]);
      const owners = edgeOwners.get(key);
      if (owners) owners.push(i);
      else edgeOwners.set(key, [i]);
    }
  }

  const candidates: PairCandidate[] = [];
  for (const owners of edgeOwners.values()) {
    if (owners.length !== 2) continue;
    const [a, b] = owners;
    const candidate = approximateTrianglePairCandidate(a, b, polygons, metas, options);
    if (candidate) candidates.push(candidate);
  }
  candidates.sort((a, b) => a.score - b.score);

  const used = new Set<number>();
  const replacements = new Map<number, Polygon>();
  const skipped = new Set<number>();
  for (const candidate of candidates) {
    if (used.has(candidate.a) || used.has(candidate.b)) continue;
    used.add(candidate.a);
    used.add(candidate.b);
    const outputIndex = Math.min(candidate.a, candidate.b);
    replacements.set(outputIndex, candidate.polygon);
    skipped.add(Math.max(candidate.a, candidate.b));
  }

  const output: Polygon[] = [];
  for (let i = 0; i < polygons.length; i++) {
    const replacement = replacements.get(i);
    if (replacement) {
      output.push(replacement);
      continue;
    }
    if (skipped.has(i)) continue;
    output.push(polygons[i]);
  }
  return output;
}

function approximateTrianglePairCandidate(
  aIndex: number,
  bIndex: number,
  polygons: Polygon[],
  metas: Array<PlaneNormalizeMeta | null>,
  options: ResolvedGeometryNormalizeOptions,
): PairCandidate | null {
  const a = polygons[aIndex];
  const b = polygons[bIndex];
  const aMeta = metas[aIndex];
  const bMeta = metas[bIndex];
  if (!aMeta || !bMeta) return null;
  if (a.vertices.length !== 3 || b.vertices.length !== 3) return null;
  if (a.texture || b.texture || a.uvs || b.uvs || a.textureTriangles || b.textureTriangles) return null;
  if (aMeta.materialKey !== bMeta.materialKey) return null;

  const shared = sharedEdgeIndices(a, b);
  if (!shared) return null;
  const [ai0, ai1, bi0, bi1] = shared;
  const bGoesSameDirection = (bi0 + 1) % b.vertices.length === bi1;
  if (bGoesSameDirection) return null;

  const normalDot = Math.abs(dotVec(aMeta.normal, bMeta.normal));
  const minNormalDot = Math.cos((options.maxAngleDeg * Math.PI) / 180);
  if (normalDot < minNormalDot) return null;

  const aThird = (ai1 + 1) % a.vertices.length;
  const bThird = 3 - bi0 - bi1;
  const ring = [
    a.vertices[ai1],
    a.vertices[aThird],
    a.vertices[ai0],
    b.vertices[bThird],
  ];
  const fit = fitPlaneForVertices(ring);
  if (!fit) return null;

  let maxDistance = 0;
  for (const vertex of ring) {
    maxDistance = Math.max(maxDistance, Math.abs(signedPlaneDistance(vertex, fit)));
  }
  if (maxDistance > Math.min(options.maxPlaneDisplacement, options.maxBoundaryDisplacement)) return null;

  const vertices = ring.map((vertex) => projectVecToPlane(vertex, fit));
  if (!isConvexPolygon(vertices, fit.normal)) return null;
  return {
    a: aIndex,
    b: bIndex,
    polygon: {
      vertices,
      color: a.color,
      ...(a.data ? { data: { ...a.data } } : {}),
    },
    score: maxDistance + (1 - normalDot),
  };
}

function fitPlaneForVertices(vertices: Vec3[]): PlaneFit | null {
  if (vertices.length < 3) return null;
  let nx = 0;
  let ny = 0;
  let nz = 0;
  let px = 0;
  let py = 0;
  let pz = 0;
  for (let i = 0; i < vertices.length; i++) {
    const current = vertices[i];
    const next = vertices[(i + 1) % vertices.length];
    nx += (current[1] - next[1]) * (current[2] + next[2]);
    ny += (current[2] - next[2]) * (current[0] + next[0]);
    nz += (current[0] - next[0]) * (current[1] + next[1]);
    px += current[0];
    py += current[1];
    pz += current[2];
  }
  const normal = normalizeVec([nx, ny, nz]);
  if (!normal) return null;
  return {
    normal,
    point: [px / vertices.length, py / vertices.length, pz / vertices.length],
  };
}

function isConvexPolygon(vertices: Vec3[], normal: Vec3): boolean {
  let sign = 0;
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i];
    const b = vertices[(i + 1) % vertices.length];
    const c = vertices[(i + 2) % vertices.length];
    const turn = dotVec(crossVec(subVec(b, a), subVec(c, b)), normal);
    if (Math.abs(turn) <= 1e-9) continue;
    const nextSign = turn > 0 ? 1 : -1;
    if (sign === 0) sign = nextSign;
    else if (sign !== nextSign) return false;
  }
  return true;
}

function normalizeGeometryForMerge(
  polygons: Polygon[],
  options: ResolvedGeometryNormalizeOptions,
): Polygon[] {
  const snapped = snapGeometryForMerge(polygons);
  const planeEpsilon = planeFitEpsilon(snapped, options);
  if (planeEpsilon <= 0) return snapped;

  const metas = snapped.map((polygon): PlaneNormalizeMeta | null => {
    const plane = planeOfPolygon(polygon);
    if (!plane) return null;
    return {
      polygon,
      normal: plane.normal,
      area: plane.area,
      materialKey: materialKeyForPolygon(polygon),
    };
  });
  const adjacency = buildMergeAdjacency(snapped, metas);
  const assigned = new Set<number>();
  const output: Array<Polygon | undefined> = Array(snapped.length);
  const writeOutput = (index: number, polygon: Polygon): void => {
    output[index] = polygon;
  };

  for (let i = 0; i < snapped.length; i++) {
    const meta = metas[i];
    if (assigned.has(i)) continue;
    if (!meta) {
      writeOutput(i, snapped[i]);
      continue;
    }

    const group = growPlaneGroup(i, metas, adjacency, assigned, planeEpsilon, options);
    for (const index of group) assigned.add(index);
    if (group.length < 2) {
      writeOutput(i, snapped[i]);
      continue;
    }

    const fit = fitPlaneForGroup(group, metas);
    if (!fit || !groupWithinPlaneBudget(group, metas, fit, planeEpsilon, options)) {
      for (const index of group) writeOutput(index, snapped[index]);
      continue;
    }

    const projected = group.map((index) => projectPolygonToPlane(snapped[index], fit));
    const source = group.map((index) => snapped[index]);
    const chosen = projectedGroupWins(source, projected) ? projected : source;
    for (let groupIndex = 0; groupIndex < group.length; groupIndex++) {
      writeOutput(group[groupIndex], chosen[groupIndex]);
    }
  }

  const projected = output.flatMap((polygon) => polygon ? [polygon] : []);
  return snapGeometryForMerge(projected);
}

function snapGeometryForMerge(polygons: Polygon[]): Polygon[] {
  const geometryEpsilon = geometrySnapEpsilon(polygons);
  const uvEpsilon = 1e-4;
  if (geometryEpsilon <= 0) return polygons;

  const vertices = createVec3Snapper(geometryEpsilon);
  const uvs = createVec2Snapper(uvEpsilon);

  return polygons.map((polygon) => {
    const snappedVertices = polygon.vertices.map((vertex) => vertices.snap(vertex));
    const snappedUvs = polygon.uvs && polygon.uvs.length === polygon.vertices.length
      ? polygon.uvs.map((uv) => uvs.snap(uv))
      : undefined;
    const snappedPolygon: Polygon = {
      ...polygon,
      vertices: snappedVertices,
      ...(snappedUvs ? { uvs: snappedUvs } : {}),
    };
    return {
      ...snappedPolygon,
      ...(snappedPolygon.texture
        ? { textureTriangles: textureTrianglesForPolygon(snappedPolygon) }
        : {}),
    };
  });
}

function textureTrianglesForPolygon(polygon: Polygon): TextureTriangle[] | undefined {
  if (!polygon.texture) return undefined;
  if (polygon.uvs && polygon.uvs.length === polygon.vertices.length) {
    return fanTextureTriangles(polygon.vertices, polygon.uvs);
  }
  if (polygon.textureTriangles?.length) return cloneTextureTriangles(polygon.textureTriangles);
  return undefined;
}

function fanTextureTriangles(vertices: Vec3[], uvs: Vec2[]): TextureTriangle[] {
  const triangles: TextureTriangle[] = [];
  for (let i = 1; i < vertices.length - 1; i++) {
    triangles.push({
      vertices: [
        [...vertices[0]] as Vec3,
        [...vertices[i]] as Vec3,
        [...vertices[i + 1]] as Vec3,
      ],
      uvs: [
        [...uvs[0]] as Vec2,
        [...uvs[i]] as Vec2,
        [...uvs[i + 1]] as Vec2,
      ],
    });
  }
  return triangles;
}

function cloneTextureTriangles(triangles: TextureTriangle[]): TextureTriangle[] {
  return triangles.map((triangle) => ({
    vertices: triangle.vertices.map((vertex) => [...vertex] as Vec3) as [Vec3, Vec3, Vec3],
    uvs: triangle.uvs.map((uv) => [...uv] as Vec2) as [Vec2, Vec2, Vec2],
  }));
}

function projectedGroupWins(source: Polygon[], projected: Polygon[]): boolean {
  return mergePolygons(projected).length < mergePolygons(source).length;
}

function planeFitEpsilon(
  polygons: Polygon[],
  options: ResolvedGeometryNormalizeOptions,
): number {
  const geometryEpsilon = geometrySnapEpsilon(polygons);
  if (geometryEpsilon <= 0) return 0;
  return options.maxPlaneDisplacement;
}

function geometrySnapEpsilon(polygons: Polygon[]): number {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  for (const polygon of polygons) {
    for (const [x, y, z] of polygon.vertices) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      minZ = Math.min(minZ, z);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      maxZ = Math.max(maxZ, z);
    }
  }

  if (!Number.isFinite(minX)) return 0;
  const diagonal = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ);
  if (diagonal <= 0) return 0;
  return Math.min(0.025, Math.max(0.0001, diagonal * 0.00025));
}

function createVec3Snapper(epsilon: number) {
  const buckets = new Map<string, Vec3[]>();
  const cell = (value: number) => Math.floor(value / epsilon);
  const key = (x: number, y: number, z: number) => `${x},${y},${z}`;

  return {
    snap(input: Vec3): Vec3 {
      const cx = cell(input[0]);
      const cy = cell(input[1]);
      const cz = cell(input[2]);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dz = -1; dz <= 1; dz++) {
            const bucket = buckets.get(key(cx + dx, cy + dy, cz + dz));
            if (!bucket) continue;
            for (const candidate of bucket) {
              if (distanceVec(input, candidate) <= epsilon) {
                return [candidate[0], candidate[1], candidate[2]];
              }
            }
          }
        }
      }

      const snapped: Vec3 = [input[0], input[1], input[2]];
      const bucketKey = key(cx, cy, cz);
      const bucket = buckets.get(bucketKey);
      if (bucket) bucket.push(snapped);
      else buckets.set(bucketKey, [snapped]);
      return snapped;
    },
  };
}

function createVec2Snapper(epsilon: number) {
  const buckets = new Map<string, Vec2[]>();
  const cell = (value: number) => Math.floor(value / epsilon);
  const key = (x: number, y: number) => `${x},${y}`;

  return {
    snap(input: Vec2): Vec2 {
      const cx = cell(input[0]);
      const cy = cell(input[1]);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const bucket = buckets.get(key(cx + dx, cy + dy));
          if (!bucket) continue;
          for (const candidate of bucket) {
            if (Math.hypot(input[0] - candidate[0], input[1] - candidate[1]) <= epsilon) {
              return [candidate[0], candidate[1]];
            }
          }
        }
      }

      const snapped: Vec2 = [input[0], input[1]];
      const bucketKey = key(cx, cy);
      const bucket = buckets.get(bucketKey);
      if (bucket) bucket.push(snapped);
      else buckets.set(bucketKey, [snapped]);
      return snapped;
    },
  };
}

function materialKeyForPolygon(polygon: Polygon): string {
  return `${polygon.color ?? "#cccccc"}|${polygon.texture ?? ""}|${polygon.uvs ? "uv" : "plain"}`;
}

function planeOfPolygon(polygon: Polygon): { normal: Vec3; area: number } | null {
  const vertices = polygon.vertices;
  if (!vertices || vertices.length < 3) return null;

  let nx = 0;
  let ny = 0;
  let nz = 0;
  const origin = vertices[0];
  for (let i = 1; i < vertices.length - 1; i++) {
    const a = subVec(vertices[i], origin);
    const b = subVec(vertices[i + 1], origin);
    const cross = crossVec(a, b);
    nx += cross[0];
    ny += cross[1];
    nz += cross[2];
  }

  const len = Math.hypot(nx, ny, nz);
  if (len <= 1e-10) return null;
  return {
    normal: [nx / len, ny / len, nz / len],
    area: len / 2,
  };
}

function buildMergeAdjacency(
  polygons: Polygon[],
  metas: Array<PlaneNormalizeMeta | null>,
): Map<number, Set<number>> {
  const edgeOwners = new Map<string, number[]>();
  const adjacency = new Map<number, Set<number>>();

  for (let i = 0; i < polygons.length; i++) {
    const polygon = polygons[i];
    if (!metas[i] || polygon.vertices.length < 3) continue;
    for (let j = 0; j < polygon.vertices.length; j++) {
      const key = edgeKey(polygon.vertices[j], polygon.vertices[(j + 1) % polygon.vertices.length]);
      const owners = edgeOwners.get(key);
      if (owners) owners.push(i);
      else edgeOwners.set(key, [i]);
    }
  }

  for (const owners of edgeOwners.values()) {
    for (let a = 0; a < owners.length; a++) {
      for (let b = a + 1; b < owners.length; b++) {
        const ai = owners[a];
        const bi = owners[b];
        if (canShareMergePatch(polygons[ai], polygons[bi], metas[ai], metas[bi])) {
          addAdjacency(adjacency, ai, bi);
          addAdjacency(adjacency, bi, ai);
        }
      }
    }
  }

  return adjacency;
}

function canShareMergePatch(
  a: Polygon,
  b: Polygon,
  aMeta: PlaneNormalizeMeta | null,
  bMeta: PlaneNormalizeMeta | null,
): boolean {
  if (!aMeta || !bMeta) return false;
  if (aMeta.materialKey !== bMeta.materialKey) return false;
  if (!!a.uvs !== !!b.uvs) return false;
  if (a.texture || b.texture) return !!a.uvs && !!b.uvs;
  if (!a.uvs || !b.uvs) return true;

  const shared = sharedEdgeIndices(a, b);
  if (!shared) return false;
  const [ai0, ai1, bi0, bi1] = shared;
  return eqUv(a.uvs[ai0], b.uvs[bi0]) && eqUv(a.uvs[ai1], b.uvs[bi1]);
}

function addAdjacency(adjacency: Map<number, Set<number>>, from: number, to: number): void {
  const values = adjacency.get(from);
  if (values) values.add(to);
  else adjacency.set(from, new Set([to]));
}

function growPlaneGroup(
  seed: number,
  metas: Array<PlaneNormalizeMeta | null>,
  adjacency: Map<number, Set<number>>,
  assigned: Set<number>,
  planeEpsilon: number,
  options: ResolvedGeometryNormalizeOptions,
): number[] {
  const group = [seed];
  const queued = new Set([seed]);
  const queue = [seed];

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const next of adjacency.get(current) ?? []) {
      if (assigned.has(next) || queued.has(next)) continue;
      const nextMeta = metas[next];
      const seedMeta = metas[seed];
      if (!nextMeta || !seedMeta) continue;
      if (nextMeta.materialKey !== seedMeta.materialKey) continue;
      if (!canJoinPlaneGroup([...group, next], metas, planeEpsilon, options)) continue;
      group.push(next);
      queued.add(next);
      queue.push(next);
    }
  }

  return group;
}

function canJoinPlaneGroup(
  group: number[],
  metas: Array<PlaneNormalizeMeta | null>,
  planeEpsilon: number,
  options: ResolvedGeometryNormalizeOptions,
): boolean {
  const fit = fitPlaneForGroup(group, metas);
  return !!fit && groupWithinPlaneBudget(group, metas, fit, planeEpsilon, options);
}

function fitPlaneForGroup(
  group: number[],
  metas: Array<PlaneNormalizeMeta | null>,
): PlaneFit | null {
  const seed = metas[group[0]];
  if (!seed) return null;

  let nx = 0;
  let ny = 0;
  let nz = 0;
  let px = 0;
  let py = 0;
  let pz = 0;
  let weightSum = 0;

  for (const index of group) {
    const meta = metas[index];
    if (!meta) return null;
    const direction = dotVec(seed.normal, meta.normal) < 0 ? -1 : 1;
    const weight = Math.max(meta.area, 1e-6);
    nx += meta.normal[0] * direction * weight;
    ny += meta.normal[1] * direction * weight;
    nz += meta.normal[2] * direction * weight;
    for (const vertex of meta.polygon.vertices) {
      px += vertex[0];
      py += vertex[1];
      pz += vertex[2];
      weightSum += 1;
    }
  }

  const normal = normalizeVec([nx, ny, nz]);
  if (!normal || weightSum === 0) return null;
  const boundaryVertices = groupBoundaryVertexKeys(group, metas);
  const boundaryD = planeOffsetRangeForVertices(group, metas, normal, boundaryVertices);
  if (boundaryD) {
    const d = (boundaryD.min + boundaryD.max) / 2;
    return {
      normal,
      point: [normal[0] * d, normal[1] * d, normal[2] * d],
    };
  }

  return {
    normal,
    point: [px / weightSum, py / weightSum, pz / weightSum],
  };
}

function planeOffsetRangeForVertices(
  group: number[],
  metas: Array<PlaneNormalizeMeta | null>,
  normal: Vec3,
  vertexKeys: Set<string>,
): { min: number; max: number } | null {
  let min = Infinity;
  let max = -Infinity;

  for (const index of group) {
    const meta = metas[index];
    if (!meta) continue;
    for (const vertex of meta.polygon.vertices) {
      if (!vertexKeys.has(vertexKey(vertex))) continue;
      const d = dotVec(vertex, normal);
      min = Math.min(min, d);
      max = Math.max(max, d);
    }
  }

  return Number.isFinite(min) && Number.isFinite(max) ? { min, max } : null;
}

function groupWithinPlaneBudget(
  group: number[],
  metas: Array<PlaneNormalizeMeta | null>,
  fit: PlaneFit,
  planeEpsilon: number,
  options: ResolvedGeometryNormalizeOptions,
): boolean {
  const normalDotMin = Math.cos((options.maxAngleDeg * Math.PI) / 180);
  const boundaryVertices = groupBoundaryVertexKeys(group, metas);
  for (const index of group) {
    const meta = metas[index];
    if (!meta) return false;
    if (Math.abs(dotVec(meta.normal, fit.normal)) < normalDotMin) return false;
    for (const vertex of meta.polygon.vertices) {
      const limit = boundaryVertices.has(vertexKey(vertex))
        ? options.maxBoundaryDisplacement
        : planeEpsilon;
      if (Math.abs(signedPlaneDistance(vertex, fit)) > limit) return false;
    }
  }
  return true;
}

function groupBoundaryVertexKeys(
  group: number[],
  metas: Array<PlaneNormalizeMeta | null>,
): Set<string> {
  const edgeCounts = new Map<string, { count: number; a: Vec3; b: Vec3 }>();

  for (const index of group) {
    const meta = metas[index];
    if (!meta) continue;
    const vertices = meta.polygon.vertices;
    for (let i = 0; i < vertices.length; i++) {
      const a = vertices[i];
      const b = vertices[(i + 1) % vertices.length];
      const key = edgeKey(a, b);
      const current = edgeCounts.get(key);
      if (current) current.count += 1;
      else edgeCounts.set(key, { count: 1, a, b });
    }
  }

  const boundary = new Set<string>();
  for (const edge of edgeCounts.values()) {
    if (edge.count !== 1) continue;
    boundary.add(vertexKey(edge.a));
    boundary.add(vertexKey(edge.b));
  }
  return boundary;
}

function projectPolygonToPlane(polygon: Polygon, fit: PlaneFit): Polygon {
  return {
    ...polygon,
    vertices: polygon.vertices.map((vertex) => projectVecToPlane(vertex, fit)),
  };
}

function sharedEdgeIndices(a: Polygon, b: Polygon): [number, number, number, number] | null {
  for (let ai0 = 0; ai0 < a.vertices.length; ai0++) {
    const ai1 = (ai0 + 1) % a.vertices.length;
    for (let bi0 = 0; bi0 < b.vertices.length; bi0++) {
      const bi1 = (bi0 + 1) % b.vertices.length;
      if (eqVec(a.vertices[ai0], b.vertices[bi0]) && eqVec(a.vertices[ai1], b.vertices[bi1])) {
        return [ai0, ai1, bi0, bi1];
      }
      if (eqVec(a.vertices[ai0], b.vertices[bi1]) && eqVec(a.vertices[ai1], b.vertices[bi0])) {
        return [ai0, ai1, bi1, bi0];
      }
    }
  }
  return null;
}

function edgeKey(a: Vec3, b: Vec3): string {
  const ak = vertexKey(a);
  const bk = vertexKey(b);
  return ak < bk ? `${ak}|${bk}` : `${bk}|${ak}`;
}

function vertexKey(vertex: Vec3): string {
  return `${vertex[0]},${vertex[1]},${vertex[2]}`;
}

function eqVec(a: Vec3, b: Vec3): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

function eqUv(a: Vec2, b: Vec2): boolean {
  return Math.abs(a[0] - b[0]) <= 1e-4 && Math.abs(a[1] - b[1]) <= 1e-4;
}

function subVec(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function crossVec(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function dotVec(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function distanceVec(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function normalizeVec(value: Vec3): Vec3 | null {
  const length = Math.hypot(value[0], value[1], value[2]);
  if (length <= 1e-10) return null;
  return [value[0] / length, value[1] / length, value[2] / length];
}

function signedPlaneDistance(vertex: Vec3, fit: PlaneFit): number {
  return dotVec(subVec(vertex, fit.point), fit.normal);
}

function projectVecToPlane(vertex: Vec3, fit: PlaneFit): Vec3 {
  const distance = signedPlaneDistance(vertex, fit);
  return [
    vertex[0] - fit.normal[0] * distance,
    vertex[1] - fit.normal[1] * distance,
    vertex[2] - fit.normal[2] * distance,
  ];
}
