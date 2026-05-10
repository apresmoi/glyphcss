import type { Polygon, Vec2, Vec3 } from "../types";
import { mergePolygons } from "./mergePolygons";

export interface CoverPlanarPolygonsOptions {
  /** Smallest connected coplanar group worth attempting. Default 4. */
  minGroupPolygons?: number;
  /** Maximum candidate 2D axes tested per group. Default 8. */
  maxCandidateAxes?: number;
  /** Plane normal/distance tolerance in scene units. Default 1e-3. */
  planeEpsilon?: number;
}

interface Plane {
  normal: Vec3;
  d: number;
}

interface CandidateAxis {
  axis: Vec3;
  weight: number;
}

interface GroupBuild {
  groups: number[][];
}

interface EdgeOwner {
  polygon: number;
  edge: number;
}

interface Segment2 {
  a: Vec2;
  b: Vec2;
}

interface DirectedSegment2 {
  a: Vec2;
  b: Vec2;
}

interface BoundaryEdge {
  a: Vec3;
  b: Vec3;
}

const DEFAULT_MIN_GROUP = 4;
const DEFAULT_MAX_AXES = 8;
const DEFAULT_PLANE_EPSILON = 1e-3;
const EPS = 1e-9;
const LOCAL_ROUND = 1e6;
const WORLD_ROUND = 1e6;

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (v: Vec3, n: number): Vec3 => [v[0] * n, v[1] * n, v[2] * n];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const length = (v: Vec3): number => Math.hypot(v[0], v[1], v[2]);

function normalize(v: Vec3): Vec3 | null {
  const len = length(v);
  if (len <= EPS) return null;
  return [v[0] / len, v[1] / len, v[2] / len];
}

function round(value: number, factor: number): number {
  return Math.round(value * factor) / factor;
}

function roundLocal(value: number): number {
  return round(value, LOCAL_ROUND);
}

function roundWorld(value: number): number {
  return round(value, WORLD_ROUND);
}

function eq2(a: Vec2, b: Vec2): boolean {
  return Math.abs(a[0] - b[0]) <= 1e-7 && Math.abs(a[1] - b[1]) <= 1e-7;
}

function pointKey(point: Vec2): string {
  return `${roundLocal(point[0])},${roundLocal(point[1])}`;
}

function undirectedSegmentKey(segment: DirectedSegment2): string {
  const ak = pointKey(segment.a);
  const bk = pointKey(segment.b);
  return ak < bk ? `${ak}|${bk}` : `${bk}|${ak}`;
}

function vecKey(v: Vec3): string {
  return `${v[0]},${v[1]},${v[2]}`;
}

function edgeKey(a: Vec3, b: Vec3): string {
  const ak = vecKey(a);
  const bk = vecKey(b);
  return ak < bk ? `${ak}|${bk}` : `${bk}|${ak}`;
}

function dataKey(data: Polygon["data"]): string {
  if (!data) return "";
  return Object.keys(data)
    .sort()
    .map((key) => `${key}:${String(data[key])}`)
    .join("|");
}

function materialKey(polygon: Polygon): string {
  return [
    polygon.color ?? "#cccccc",
    polygon.texture ?? "",
    polygon.uvs ? "uv" : "plain",
    dataKey(polygon.data),
  ].join("|");
}

function planeOf(polygon: Polygon): Plane | null {
  const vertices = polygon.vertices;
  if (!vertices || vertices.length < 3) return null;
  const origin = vertices[0];
  let normalSum: Vec3 = [0, 0, 0];
  for (let i = 1; i < vertices.length - 1; i++) {
    normalSum = add(normalSum, cross(sub(vertices[i], origin), sub(vertices[i + 1], origin)));
  }
  const normal = normalize(normalSum);
  if (!normal) return null;
  return { normal, d: dot(normal, origin) };
}

function samePlane(a: Plane, b: Plane, epsilon: number): boolean {
  return dot(a.normal, b.normal) > 1 - epsilon && Math.abs(a.d - b.d) <= epsilon;
}

function canCover(polygon: Polygon): boolean {
  return !polygon.texture && !polygon.uvs && !polygon.textureTriangles;
}

function sharedData(group: number[], polygons: Polygon[]): Polygon["data"] | undefined {
  const first = polygons[group[0]]?.data;
  const firstKey = dataKey(first);
  for (const index of group) {
    if (dataKey(polygons[index].data) !== firstKey) return undefined;
  }
  return first ? { ...first } : undefined;
}

function buildGroups(polygons: Polygon[], planeEpsilon: number): GroupBuild {
  const planes = polygons.map((polygon) => canCover(polygon) ? planeOf(polygon) : null);
  const eligible = planes.map(Boolean);
  const edgeOwners = new Map<string, EdgeOwner[]>();

  for (let i = 0; i < polygons.length; i++) {
    if (!planes[i]) continue;
    const vertices = polygons[i].vertices;
    for (let edge = 0; edge < vertices.length; edge++) {
      const key = edgeKey(vertices[edge], vertices[(edge + 1) % vertices.length]);
      const owners = edgeOwners.get(key);
      const owner = { polygon: i, edge };
      if (owners) owners.push(owner);
      else edgeOwners.set(key, [owner]);
    }
  }

  const adjacency = polygons.map(() => new Set<number>());
  for (const owners of edgeOwners.values()) {
    if (owners.length < 2) continue;
    for (let i = 0; i < owners.length; i++) {
      for (let j = i + 1; j < owners.length; j++) {
        const a = owners[i].polygon;
        const b = owners[j].polygon;
        const planeA = planes[a];
        const planeB = planes[b];
        if (!planeA || !planeB) continue;
        if (materialKey(polygons[a]) !== materialKey(polygons[b])) continue;
        if (!samePlane(planeA, planeB, planeEpsilon)) continue;
        adjacency[a].add(b);
        adjacency[b].add(a);
      }
    }
  }

  const visited = new Set<number>();
  const groups: number[][] = [];
  for (let i = 0; i < polygons.length; i++) {
    if (!eligible[i] || visited.has(i)) continue;
    const group: number[] = [];
    const queue = [i];
    visited.add(i);
    while (queue.length > 0) {
      const current = queue.shift()!;
      group.push(current);
      for (const next of adjacency[current]) {
        if (visited.has(next)) continue;
        visited.add(next);
        queue.push(next);
      }
    }
    groups.push(group);
  }

  return { groups };
}

function boundaryEdgesForGroup(group: number[], polygons: Polygon[]): BoundaryEdge[] | null {
  const groupSet = new Set(group);
  const owners = new Map<string, EdgeOwner[]>();
  for (const polygonIndex of group) {
    const vertices = polygons[polygonIndex].vertices;
    for (let edge = 0; edge < vertices.length; edge++) {
      const key = edgeKey(vertices[edge], vertices[(edge + 1) % vertices.length]);
      const list = owners.get(key);
      const owner = { polygon: polygonIndex, edge };
      if (list) list.push(owner);
      else owners.set(key, [owner]);
    }
  }

  const boundary: BoundaryEdge[] = [];
  for (const list of owners.values()) {
    const localOwners = list.filter((owner) => groupSet.has(owner.polygon));
    if (localOwners.length === 1) {
      const owner = localOwners[0];
      const vertices = polygons[owner.polygon].vertices;
      boundary.push({
        a: vertices[owner.edge],
        b: vertices[(owner.edge + 1) % vertices.length],
      });
    } else if (localOwners.length !== 2) {
      return null;
    }
  }
  return boundary;
}

function boundaryIsClosed(boundary: BoundaryEdge[]): boolean {
  const degree = new Map<string, number>();
  for (const edge of boundary) {
    degree.set(vecKey(edge.a), (degree.get(vecKey(edge.a)) ?? 0) + 1);
    degree.set(vecKey(edge.b), (degree.get(vecKey(edge.b)) ?? 0) + 1);
  }
  for (const count of degree.values()) {
    if (count % 2 !== 0) return false;
  }
  return true;
}

function canonicalAxis(axis: Vec3): Vec3 {
  const out: Vec3 = [axis[0], axis[1], axis[2]];
  const major = Math.abs(out[0]) >= Math.abs(out[1]) && Math.abs(out[0]) >= Math.abs(out[2])
    ? 0
    : Math.abs(out[1]) >= Math.abs(out[2])
      ? 1
      : 2;
  if (out[major] < 0) return [-out[0], -out[1], -out[2]];
  return out;
}

function axisKey(axis: Vec3): string {
  const canonical = canonicalAxis(axis);
  return `${round(canonical[0], 1000)},${round(canonical[1], 1000)},${round(canonical[2], 1000)}`;
}

function fallbackAxis(normal: Vec3): Vec3 {
  const seed: Vec3 = Math.abs(normal[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const projected = sub(seed, scale(normal, dot(seed, normal)));
  return normalize(projected) ?? [1, 0, 0];
}

function candidateAxes(boundary: BoundaryEdge[], normal: Vec3, maxAxes: number): Vec3[] {
  const byKey = new Map<string, CandidateAxis>();
  for (const edge of boundary) {
    const edgeVector = sub(edge.b, edge.a);
    const projected = sub(edgeVector, scale(normal, dot(edgeVector, normal)));
    const axis = normalize(projected);
    if (!axis) continue;
    const canonical = canonicalAxis(axis);
    const key = axisKey(canonical);
    const weight = length(projected);
    const current = byKey.get(key);
    if (current) current.weight += weight;
    else byKey.set(key, { axis: canonical, weight });
  }
  const axes = [...byKey.values()]
    .sort((a, b) => b.weight - a.weight)
    .slice(0, maxAxes)
    .map((candidate) => candidate.axis);
  if (axes.length === 0) axes.push(fallbackAxis(normal));
  return axes;
}

function projectPoint(point: Vec3, origin: Vec3, xAxis: Vec3, yAxis: Vec3): Vec2 {
  const local = sub(point, origin);
  return [roundLocal(dot(local, xAxis)), roundLocal(dot(local, yAxis))];
}

function uniqueSorted(values: number[]): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const out: number[] = [];
  for (const value of sorted) {
    if (out.length === 0 || Math.abs(value - out[out.length - 1]) > 1e-7) {
      out.push(value);
    }
  }
  return out;
}

function segmentYAt(segment: Segment2, x: number): number {
  const [x0, y0] = segment.a;
  const [x1, y1] = segment.b;
  const t = (x - x0) / (x1 - x0);
  return roundLocal(y0 + (y1 - y0) * t);
}

function cleanLocalPolygon(points: Vec2[]): Vec2[] {
  const dedup: Vec2[] = [];
  for (const point of points) {
    if (
      dedup.length === 0 ||
      Math.abs(point[0] - dedup[dedup.length - 1][0]) > 1e-7 ||
      Math.abs(point[1] - dedup[dedup.length - 1][1]) > 1e-7
    ) {
      dedup.push(point);
    }
  }
  if (
    dedup.length > 1 &&
    Math.abs(dedup[0][0] - dedup[dedup.length - 1][0]) <= 1e-7 &&
    Math.abs(dedup[0][1] - dedup[dedup.length - 1][1]) <= 1e-7
  ) {
    dedup.pop();
  }

  const cleaned: Vec2[] = [];
  for (let i = 0; i < dedup.length; i++) {
    const prev = dedup[(i - 1 + dedup.length) % dedup.length];
    const current = dedup[i];
    const next = dedup[(i + 1) % dedup.length];
    const cross2 =
      (current[0] - prev[0]) * (next[1] - current[1]) -
      (current[1] - prev[1]) * (next[0] - current[0]);
    if (Math.abs(cross2) > 1e-8) cleaned.push(current);
  }
  return cleaned;
}

function signedArea(points: Vec2[]): number {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    area += a[0] * b[1] - b[0] * a[1];
  }
  return area / 2;
}

function localBBox(points: Vec2[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { minX, minY, maxX, maxY };
}

function bboxesCanTouch(a: Vec2[], b: Vec2[]): boolean {
  const ab = localBBox(a);
  const bb = localBBox(b);
  return !(
    ab.maxX < bb.minX - 1e-7 ||
    bb.maxX < ab.minX - 1e-7 ||
    ab.maxY < bb.minY - 1e-7 ||
    bb.maxY < ab.minY - 1e-7
  );
}

function localAreaAbs(points: Vec2[]): number {
  return Math.abs(signedArea(points));
}

function isConvexLocal(points: Vec2[]): boolean {
  if (points.length < 3) return false;
  let sign = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const c = points[(i + 2) % points.length];
    const turn =
      (b[0] - a[0]) * (c[1] - b[1]) -
      (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(turn) <= 1e-8) continue;
    const nextSign = turn > 0 ? 1 : -1;
    if (sign === 0) sign = nextSign;
    else if (sign !== nextSign) return false;
  }
  return true;
}

function pointOnSegment(point: Vec2, a: Vec2, b: Vec2): boolean {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const apx = point[0] - a[0];
  const apy = point[1] - a[1];
  const cross2 = abx * apy - aby * apx;
  const len = Math.hypot(abx, aby);
  if (len <= 1e-9 || Math.abs(cross2) > Math.max(1e-8, len * 1e-8)) return false;
  const dot2 = apx * abx + apy * aby;
  return dot2 >= -1e-8 && dot2 <= abx * abx + aby * aby + 1e-8;
}

function pointParameterOnSegment(point: Vec2, a: Vec2, b: Vec2): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const denom = dx * dx + dy * dy;
  if (denom <= 1e-12) return 0;
  return ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / denom;
}

function splitDirectedEdges(polygon: Vec2[], splitPoints: Vec2[]): DirectedSegment2[] {
  const segments: DirectedSegment2[] = [];
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    const splits: Array<{ t: number; point: Vec2 }> = [
      { t: 0, point: a },
      { t: 1, point: b },
    ];
    for (const point of splitPoints) {
      if (eq2(point, a) || eq2(point, b)) continue;
      if (!pointOnSegment(point, a, b)) continue;
      splits.push({
        t: pointParameterOnSegment(point, a, b),
        point,
      });
    }
    splits.sort((left, right) => left.t - right.t);

    const unique: Array<{ t: number; point: Vec2 }> = [];
    for (const split of splits) {
      if (unique.some((item) => Math.abs(item.t - split.t) <= 1e-8 || eq2(item.point, split.point))) continue;
      unique.push(split);
    }

    for (let j = 0; j < unique.length - 1; j++) {
      const start = unique[j].point;
      const end = unique[j + 1].point;
      if (Math.hypot(end[0] - start[0], end[1] - start[1]) <= 1e-8) continue;
      segments.push({
        a: [roundLocal(start[0]), roundLocal(start[1])],
        b: [roundLocal(end[0]), roundLocal(end[1])],
      });
    }
  }
  return segments;
}

function unionConvexLocalPair(a: Vec2[], b: Vec2[]): Vec2[] | null {
  if (!bboxesCanTouch(a, b)) return null;
  const pieces = [
    ...splitDirectedEdges(a, b),
    ...splitDirectedEdges(b, a),
  ];
  const grouped = new Map<string, DirectedSegment2[]>();
  for (const segment of pieces) {
    const key = undirectedSegmentKey(segment);
    const current = grouped.get(key);
    if (current) current.push(segment);
    else grouped.set(key, [segment]);
  }

  let hadSharedEdge = false;
  const boundary: DirectedSegment2[] = [];
  for (const group of grouped.values()) {
    if (group.length === 1) {
      boundary.push(group[0]);
      continue;
    }
    hadSharedEdge = true;
    const forward = group.filter((segment) => pointKey(segment.a) < pointKey(segment.b)).length;
    const backward = group.length - forward;
    if (forward !== backward) return null;
  }
  if (!hadSharedEdge || boundary.length < 3) return null;

  const outgoing = new Map<string, DirectedSegment2>();
  for (const segment of boundary) {
    const key = pointKey(segment.a);
    if (outgoing.has(key)) return null;
    outgoing.set(key, segment);
  }

  const start = boundary[0];
  const startKey = pointKey(start.a);
  const loop: Vec2[] = [];
  const used = new Set<string>();
  let currentKey = startKey;
  for (let guard = 0; guard <= boundary.length; guard++) {
    const segment = outgoing.get(currentKey);
    if (!segment) return null;
    const edgeKey2 = `${pointKey(segment.a)}>${pointKey(segment.b)}`;
    if (used.has(edgeKey2)) return null;
    used.add(edgeKey2);
    loop.push(segment.a);
    currentKey = pointKey(segment.b);
    if (currentKey === startKey) break;
  }
  if (currentKey !== startKey || used.size !== boundary.length) return null;

  const cleaned = cleanLocalPolygon(loop);
  if (cleaned.length < 3 || !isConvexLocal(cleaned)) return null;
  const area = localAreaAbs(cleaned);
  const expectedArea = localAreaAbs(a) + localAreaAbs(b);
  if (Math.abs(area - expectedArea) > Math.max(1e-5, expectedArea * 1e-5)) return null;
  return signedArea(cleaned) >= 0 ? cleaned : [...cleaned].reverse();
}

function mergeLocalCells(cells: Vec2[][]): Vec2[][] {
  const polygons = cells
    .map(cleanLocalPolygon)
    .filter((polygon) => polygon.length >= 3 && localAreaAbs(polygon) > 1e-8);

  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < polygons.length; i++) {
      for (let j = i + 1; j < polygons.length; j++) {
        const merged = unionConvexLocalPair(polygons[i], polygons[j]);
        if (!merged) continue;
        polygons[i] = merged;
        polygons.splice(j, 1);
        changed = true;
        break;
      }
      if (changed) break;
    }
  }

  return polygons;
}

function localToWorldFactory(origin: Vec3, xAxis: Vec3, yAxis: Vec3): (point: Vec2) => Vec3 {
  const snap = new Map<string, Vec3>();
  return (point: Vec2): Vec3 => {
    const x = roundLocal(point[0]);
    const y = roundLocal(point[1]);
    const key = `${x},${y}`;
    const existing = snap.get(key);
    if (existing) return [existing[0], existing[1], existing[2]];
    const world = add(origin, add(scale(xAxis, x), scale(yAxis, y)));
    const rounded: Vec3 = [roundWorld(world[0]), roundWorld(world[1]), roundWorld(world[2])];
    snap.set(key, rounded);
    return [rounded[0], rounded[1], rounded[2]];
  };
}

function decomposeWithAxis(
  group: number[],
  polygons: Polygon[],
  boundary: BoundaryEdge[],
  normal: Vec3,
  xAxisInput: Vec3,
): Polygon[] | null {
  const origin = boundary[0]?.a;
  if (!origin) return null;
  const xAxisProjected = normalize(sub(xAxisInput, scale(normal, dot(xAxisInput, normal))));
  if (!xAxisProjected) return null;
  const yAxis = normalize(cross(normal, xAxisProjected));
  if (!yAxis) return null;

  const segments: Segment2[] = [];
  const xs: number[] = [];
  for (const edge of boundary) {
    const a = projectPoint(edge.a, origin, xAxisProjected, yAxis);
    const b = projectPoint(edge.b, origin, xAxisProjected, yAxis);
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) <= 1e-7) continue;
    segments.push({ a, b });
    xs.push(a[0], b[0]);
  }

  const sortedXs = uniqueSorted(xs);
  if (segments.length < 3 || sortedXs.length < 2) return null;

  const color = polygons[group[0]].color;
  const data = sharedData(group, polygons);
  const localCells: Vec2[][] = [];

  for (let i = 0; i < sortedXs.length - 1; i++) {
    const x0 = sortedXs[i];
    const x1 = sortedXs[i + 1];
    if (x1 - x0 <= 1e-7) continue;
    const xm = (x0 + x1) / 2;
    const active = segments
      .filter((segment) => {
        const minX = Math.min(segment.a[0], segment.b[0]);
        const maxX = Math.max(segment.a[0], segment.b[0]);
        return minX < xm && xm < maxX && Math.abs(segment.a[0] - segment.b[0]) > 1e-7;
      })
      .map((segment) => ({
        segment,
        yMid: segmentYAt(segment, xm),
      }))
      .sort((a, b) => a.yMid - b.yMid);

    if (active.length === 0) continue;
    if (active.length % 2 !== 0) return null;

    for (let j = 0; j < active.length; j += 2) {
      const low = active[j].segment;
      const high = active[j + 1].segment;
      const low0 = segmentYAt(low, x0);
      const low1 = segmentYAt(low, x1);
      const high0 = segmentYAt(high, x0);
      const high1 = segmentYAt(high, x1);
      const local = cleanLocalPolygon([
        [x0, low0],
        [x1, low1],
        [x1, high1],
        [x0, high0],
      ]);
      if (local.length < 3 || Math.abs(signedArea(local)) <= 1e-8) continue;
      const oriented = signedArea(local) > 0 ? local : [...local].reverse();
      localCells.push(oriented);
    }
  }

  if (localCells.length === 0) return null;
  const toWorld = localToWorldFactory(origin, xAxisProjected, yAxis);
  const cells = mergeLocalCells(localCells).map((local): Polygon => ({
    vertices: local.map(toWorld),
    ...(color ? { color } : {}),
    ...(data ? { data } : {}),
  }));
  return mergePolygons(cells);
}

function optimizeGroup(
  group: number[],
  polygons: Polygon[],
  maxCandidateAxes: number,
): Polygon[] | null {
  const boundary = boundaryEdgesForGroup(group, polygons);
  if (!boundary || boundary.length < 3 || !boundaryIsClosed(boundary)) return null;
  const plane = planeOf(polygons[group[0]]);
  if (!plane) return null;

  let best: Polygon[] | null = null;
  for (const axis of candidateAxes(boundary, plane.normal, maxCandidateAxes)) {
    const result = decomposeWithAxis(group, polygons, boundary, plane.normal, axis);
    if (!result) continue;
    if (!best || result.length < best.length) best = result;
  }

  if (!best || best.length >= group.length) return null;
  return best;
}

/**
 * Re-cover flat same-color mesh regions with generated convex polygons.
 *
 * `mergePolygons` preserves source topology: it can only combine existing
 * neighboring faces. This pass is more aggressive for solid-color planar
 * regions: it projects each connected coplanar patch into 2D, covers the
 * patch from its outer boundary, then lets `mergePolygons` collapse the
 * generated cover into large rects/quads where possible.
 */
export function coverPlanarPolygons(
  input: Polygon[],
  options: CoverPlanarPolygonsOptions = {},
): Polygon[] {
  const minGroupPolygons = options.minGroupPolygons ?? DEFAULT_MIN_GROUP;
  const maxCandidateAxes = options.maxCandidateAxes ?? DEFAULT_MAX_AXES;
  const planeEpsilon = options.planeEpsilon ?? DEFAULT_PLANE_EPSILON;
  const polygons = input ?? [];
  if (polygons.length < minGroupPolygons) return polygons;

  const { groups } = buildGroups(polygons, planeEpsilon);
  if (groups.length === 0) return polygons;

  const replacements = new Map<number, Polygon[]>();
  const replaced = new Set<number>();
  for (const group of groups) {
    if (group.length < minGroupPolygons) continue;
    const optimized = optimizeGroup(group, polygons, maxCandidateAxes);
    if (!optimized) continue;
    replacements.set(group[0], optimized);
    for (const index of group) replaced.add(index);
  }

  if (replacements.size === 0) return polygons;

  const output: Polygon[] = [];
  for (let i = 0; i < polygons.length; i++) {
    const replacement = replacements.get(i);
    if (replacement) {
      output.push(...replacement);
      continue;
    }
    if (replaced.has(i)) continue;
    output.push(polygons[i]);
  }
  return output;
}
