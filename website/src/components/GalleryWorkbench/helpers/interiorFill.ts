import type { Polygon, Vec3 } from "@layoutit/polycss";
import { solidColorToHex } from "./debugPrecision";

// ── Types ────────────────────────────────────────────────────────────────────

export type AxisIndex = 0 | 1 | 2;
export type Point2 = [number, number];

export interface Segment2 {
  a: Point2;
  b: Point2;
}

export interface InteriorFillInterval {
  row: number;
  y: number;
  x0: number;
  x1: number;
  length: number;
}

export interface InteriorFillSlice {
  points: Point2[];
  planeValue: number;
  area: number;
  center: Point2;
}

export interface InteriorFillPlaneSlice {
  fixedAxis: AxisIndex;
  axisA: AxisIndex;
  axisB: AxisIndex;
  slice: InteriorFillSlice;
}

export interface PolygonBounds {
  min: Vec3;
  max: Vec3;
  center: Vec3;
  span: Vec3;
  diagonal: number;
  maxSpan: number;
}

// ── Constants ────────────────────────────────────────────────────────────────

export const INTERIOR_FILL_MIN_MAX_SPAN = 8;
export const INTERIOR_FILL_MIN_DIAGONAL = 10;
export const INTERIOR_FILL_SOLID_COVERAGE_MIN = 0.2;
export const INTERIOR_FILL_MIN_PLANE_AREA_RATIO = 0.12;
export const INTERIOR_FILL_MIN_SLICE_AREA_RATIO = 0.01;
export const INTERIOR_FILL_SCAN_ROWS = 72;
export const INTERIOR_FILL_GRID_COLUMNS = 96;
export const INTERIOR_FILL_SLICE_SAMPLES = 31;
export const INTERIOR_FILL_SLICE_MARGIN = 0.08;
export const INTERIOR_FILL_EXTRA_SLICE_MIN_AREA_RATIO = 0.35;
export const INTERIOR_FILL_MIN_PLANE_SEPARATION_RATIO = 0.14;
export const INTERIOR_FILL_OPEN_RADIUS_RATIO = 0.06;
export const INTERIOR_FILL_END_TRIM_LENGTH_RATIO = 0.45;
export const INTERIOR_FILL_END_TRIM_MIN_ROWS = 6;
export const INTERIOR_FILL_SIDE_TRIM_WINDOW = 2;
export const INTERIOR_FILL_SIDE_TRIM_QUANTILE = 0.6;
export const INTERIOR_FILL_SIDE_TRIM_MIN_LENGTH_RATIO = 0.24;
export const INTERIOR_FILL_INTERVAL_MIN_LENGTH_RATIO = 0.28;
export const INTERIOR_FILL_INTERVAL_OVERLAP_RATIO = 0.08;
export const INTERIOR_FILL_MIN_INTERVAL_ROWS = 4;
export const INTERIOR_FILL_INSET_DISTANCE_RATIO = 0.025;
export const INTERIOR_FILL_INSET_MAX_DISTANCE_RATIO = 0.08;
export const INTERIOR_FILL_MAX_MITER_RATIO = 4;
export const INTERIOR_FILL_SECONDARY_COMPONENT_AREA_RATIO = 0.68;
export const INTERIOR_FILL_MAX_COMPONENTS_PER_SLICE = 2;
export const INTERIOR_FILL_MAX_PLANES = 6;

// ── Primitive helpers ────────────────────────────────────────────────────────

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

export function polygonArea(polygon: Polygon): number {
  const [origin] = polygon.vertices;
  if (!origin || polygon.vertices.length < 3) return 0;
  let area = 0;
  for (let i = 1; i < polygon.vertices.length - 1; i += 1) {
    const a = polygon.vertices[i];
    const b = polygon.vertices[i + 1];
    const ax = a[0] - origin[0];
    const ay = a[1] - origin[1];
    const az = a[2] - origin[2];
    const bx = b[0] - origin[0];
    const by = b[1] - origin[1];
    const bz = b[2] - origin[2];
    const cx = ay * bz - az * by;
    const cy = az * bx - ax * bz;
    const cz = ax * by - ay * bx;
    area += Math.hypot(cx, cy, cz) * 0.5;
  }
  return area;
}

export function polygonBounds(polygons: Polygon[]): PolygonBounds | null {
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

  if (!Number.isFinite(minX)) return null;
  const span: Vec3 = [maxX - minX, maxY - minY, maxZ - minZ];
  return {
    min: [minX, minY, minZ],
    max: [maxX, maxY, maxZ],
    center: [
      (minX + maxX) / 2,
      (minY + maxY) / 2,
      (minZ + maxZ) / 2,
    ],
    span,
    diagonal: Math.hypot(span[0], span[1], span[2]),
    maxSpan: Math.max(span[0], span[1], span[2]),
  };
}

export function dominantSolidColor(polygons: Polygon[]): string | null {
  let totalWeight = 0;
  let solidWeight = 0;
  const weights = new Map<string, number>();

  for (const polygon of polygons) {
    const weight = Math.max(polygonArea(polygon), 1e-4);
    totalWeight += weight;
    if (polygon.texture || polygon.material?.texture || polygon.textureTriangles?.length) continue;

    const color = solidColorToHex(polygon.color ?? "#cccccc");
    if (!color) continue;
    solidWeight += weight;
    weights.set(color, (weights.get(color) ?? 0) + weight);
  }

  if (totalWeight <= 0 || solidWeight / totalWeight < INTERIOR_FILL_SOLID_COVERAGE_MIN) {
    return null;
  }

  let bestColor: string | null = null;
  let bestWeight = 0;
  for (const [color, weight] of weights) {
    if (weight > bestWeight) {
      bestColor = color;
      bestWeight = weight;
    }
  }
  return bestColor;
}

// ── Top-level entry points ───────────────────────────────────────────────────

export function withInteriorFillPolygons(polygons: Polygon[]): Polygon[] {
  const fill = interiorFillPolygons(polygons);
  return fill.length > 0 ? [...fill, ...polygons] : polygons;
}

export function interiorFillPolygons(polygons: Polygon[]): Polygon[] {
  const bounds = polygonBounds(polygons);
  if (!bounds) return [];
  if (
    bounds.maxSpan < INTERIOR_FILL_MIN_MAX_SPAN ||
    bounds.diagonal < INTERIOR_FILL_MIN_DIAGONAL
  ) {
    return [];
  }

  const color = dominantSolidColor(polygons);
  if (!color) return [];

  let targetPlaneCount = automaticInteriorFillPlaneCount(polygons, bounds);
  const candidates = [
    { fixedAxis: 2 as AxisIndex, axisA: 0 as AxisIndex, axisB: 1 as AxisIndex, area: bounds.span[0] * bounds.span[1] },
    { fixedAxis: 1 as AxisIndex, axisA: 0 as AxisIndex, axisB: 2 as AxisIndex, area: bounds.span[0] * bounds.span[2] },
    { fixedAxis: 0 as AxisIndex, axisA: 1 as AxisIndex, axisB: 2 as AxisIndex, area: bounds.span[1] * bounds.span[2] },
  ].sort((a, b) => b.area - a.area);

  const maxArea = candidates[0]?.area ?? 0;
  const minArea = maxArea * INTERIOR_FILL_MIN_PLANE_AREA_RATIO;
  const groups: InteriorFillPlaneSlice[][] = [];
  for (const candidate of candidates) {
    if (candidate.area <= minArea) continue;
    const slices = interiorFillCandidateSlices(
      polygons,
      bounds,
      candidate.fixedAxis,
      candidate.axisA,
      candidate.axisB,
      candidate.area,
      INTERIOR_FILL_MAX_PLANES,
    );
    if (slices.length === 0) continue;
    groups.push(slices.map((slice): InteriorFillPlaneSlice => ({
      fixedAxis: candidate.fixedAxis,
      axisA: candidate.axisA,
      axisB: candidate.axisB,
      slice,
    })));
  }
  if (groups.some(hasComparableCoPlanarCavities)) {
    targetPlaneCount = Math.min(INTERIOR_FILL_MAX_PLANES, targetPlaneCount + 1);
  }

  const selected: InteriorFillPlaneSlice[] = [];
  const selectedKeys = new Set<string>();
  const addSlice = (candidate: InteriorFillPlaneSlice): void => {
    const key = interiorFillPlaneSliceKey(candidate);
    if (selectedKeys.has(key) || selected.length >= targetPlaneCount) return;
    selectedKeys.add(key);
    selected.push(candidate);
  };

  for (const group of groups) addSlice(group[0]);
  while (selected.length < targetPlaneCount) {
    let best: InteriorFillPlaneSlice | null = null;
    for (const group of groups) {
      for (let i = 1; i < group.length; i += 1) {
        const candidate = group[i];
        const key = interiorFillPlaneSliceKey(candidate);
        if (selectedKeys.has(key)) continue;
        if (!best || candidate.slice.area > best.slice.area) best = candidate;
      }
    }
    if (!best) break;
    addSlice(best);
  }

  const fill: Polygon[] = [];
  for (const selectedSlice of selected) {
    fill.push(...interiorFillPlaneFromSlice(bounds, selectedSlice, color));
  }
  return fill;
}

// ── Plane-slice helpers ──────────────────────────────────────────────────────

export function hasComparableCoPlanarCavities(slices: InteriorFillPlaneSlice[]): boolean {
  for (let i = 0; i < slices.length; i += 1) {
    for (let j = i + 1; j < slices.length; j += 1) {
      if (Math.abs(slices[i].slice.planeValue - slices[j].slice.planeValue) > 1e-5) continue;
      if (
        Math.min(slices[i].slice.area, slices[j].slice.area) >=
        Math.max(slices[i].slice.area, slices[j].slice.area) * INTERIOR_FILL_SECONDARY_COMPONENT_AREA_RATIO
      ) {
        return true;
      }
    }
  }
  return false;
}

export function interiorFillPlaneSliceKey(candidate: InteriorFillPlaneSlice): string {
  return [
    candidate.fixedAxis,
    candidate.slice.planeValue.toFixed(5),
    candidate.slice.center[0].toFixed(2),
    candidate.slice.center[1].toFixed(2),
  ].join(":");
}

export function automaticInteriorFillPlaneCount(polygons: Polygon[], bounds: PolygonBounds): number {
  const nonZeroSpans = bounds.span.filter((span) => span > 1e-6).sort((a, b) => a - b);
  const minSpan = nonZeroSpans[0] ?? bounds.maxSpan;
  const aspect = minSpan > 0 ? bounds.maxSpan / minSpan : 1;
  let planes = 3;
  if (bounds.diagonal >= 28 || polygons.length >= 160 || aspect >= 3) planes = 4;
  if (bounds.diagonal >= 42 || polygons.length >= 360 || aspect >= 4.5) planes = 5;
  if (bounds.diagonal >= 80 && polygons.length >= 1400 && aspect >= 3) planes = 6;
  return Math.min(planes, INTERIOR_FILL_MAX_PLANES);
}

export function interiorFillPlaneFromSlice(
  bounds: PolygonBounds,
  plane: InteriorFillPlaneSlice,
  color: string,
): [Polygon, Polygon] {
  const point = ([a, b]: Point2): Vec3 => {
    const vertex = [...bounds.center] as Vec3;
    vertex[plane.fixedAxis] = plane.slice.planeValue;
    vertex[plane.axisA] = a;
    vertex[plane.axisB] = b;
    return vertex;
  };
  const vertices = plane.slice.points.map(point);
  return [
    { vertices, color },
    { vertices: [...vertices].reverse(), color },
  ];
}

export function interiorFillCandidateSlices(
  polygons: Polygon[],
  bounds: PolygonBounds,
  fixedAxis: AxisIndex,
  axisA: AxisIndex,
  axisB: AxisIndex,
  candidateArea: number,
  maxSlices: number,
): InteriorFillSlice[] {
  const span = bounds.span[fixedAxis];
  if (!Number.isFinite(span) || span <= 0) return [];

  const candidates: InteriorFillSlice[] = [];
  const usableStart = bounds.min[fixedAxis] + span * INTERIOR_FILL_SLICE_MARGIN;
  const usableSpan = span * (1 - INTERIOR_FILL_SLICE_MARGIN * 2);
  for (let i = 0; i < INTERIOR_FILL_SLICE_SAMPLES; i++) {
    const planeValue = usableStart + ((i + 0.5) / INTERIOR_FILL_SLICE_SAMPLES) * usableSpan;
    const slices = interiorFillSlicePolygons(
      polygons,
      bounds,
      fixedAxis,
      axisA,
      axisB,
      candidateArea,
      planeValue,
    );
    candidates.push(...slices);
  }
  candidates.sort((a, b) => b.area - a.area);
  if (candidates.length === 0) return [];

  const minArea = Math.max(
    candidateArea * INTERIOR_FILL_MIN_SLICE_AREA_RATIO,
    candidates[0].area * INTERIOR_FILL_EXTRA_SLICE_MIN_AREA_RATIO,
  );
  const minSeparation = span * INTERIOR_FILL_MIN_PLANE_SEPARATION_RATIO;
  const selected: InteriorFillSlice[] = [];
  for (const slice of candidates) {
    if (slice.area < minArea) continue;
    if (selected.some((current) =>
      Math.abs(current.planeValue - slice.planeValue) < minSeparation &&
      distance2D(current.center, slice.center) < Math.sqrt(Math.max(current.area, slice.area)) * 0.35
    )) {
      continue;
    }
    selected.push(slice);
    if (selected.length >= maxSlices) break;
  }
  return selected;
}

export function interiorFillSlicePolygons(
  polygons: Polygon[],
  bounds: PolygonBounds,
  fixedAxis: AxisIndex,
  axisA: AxisIndex,
  axisB: AxisIndex,
  candidateArea: number,
  planeValue: number,
): InteriorFillSlice[] {
  const tolerance = Math.max(bounds.diagonal * 1e-5, 1e-4);
  const segments: Segment2[] = [];

  for (const polygon of polygons) {
    const segment = slicePolygonAtAxis(polygon, fixedAxis, axisA, axisB, planeValue, tolerance);
    if (segment) segments.push(segment);
  }

  if (segments.length < 3) return [];
  const spanA = bounds.span[axisA];
  const spanB = bounds.span[axisB];
  const first = scanlineCavityPolygons(segments, spanA < spanB, candidateArea, tolerance);
  const second = scanlineCavityPolygons(segments, spanA >= spanB, candidateArea, tolerance);
  const points = first.length === 0
    ? second
    : second.length === 0
      ? first
      : totalLoopArea2D(second) > totalLoopArea2D(first)
        ? second
        : first;
  return points.map((loop): InteriorFillSlice => ({
    points: loop,
    planeValue,
    area: Math.abs(loopArea2D(loop)),
    center: loopCentroid2D(loop),
  }));
}

export function slicePolygonAtAxis(
  polygon: Polygon,
  fixedAxis: AxisIndex,
  axisA: AxisIndex,
  axisB: AxisIndex,
  planeValue: number,
  tolerance: number,
): Segment2 | null {
  const vertices = polygon.vertices;
  if (vertices.length < 3) return null;
  if (vertices.every((vertex) => Math.abs(vertex[fixedAxis] - planeValue) <= tolerance)) {
    return null;
  }
  const hits: Point2[] = [];
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i];
    const b = vertices[(i + 1) % vertices.length];
    const da = a[fixedAxis] - planeValue;
    const db = b[fixedAxis] - planeValue;

    if (Math.abs(da) <= tolerance && Math.abs(db) <= tolerance) {
      hits.push([a[axisA], a[axisB]], [b[axisA], b[axisB]]);
      continue;
    }
    if (Math.abs(da) <= tolerance) {
      hits.push([a[axisA], a[axisB]]);
      continue;
    }
    if (da * db >= 0) continue;

    const t = da / (da - db);
    hits.push([
      a[axisA] + (b[axisA] - a[axisA]) * t,
      a[axisB] + (b[axisB] - a[axisB]) * t,
    ]);
  }
  const unique = uniquePoints2D(hits, tolerance);
  if (unique.length < 2) return null;

  let a = unique[0];
  let b = unique[1];
  let bestDistance = distance2D(a, b);
  for (let i = 0; i < unique.length; i++) {
    for (let j = i + 1; j < unique.length; j++) {
      const distance = distance2D(unique[i], unique[j]);
      if (distance > bestDistance) {
        a = unique[i];
        b = unique[j];
        bestDistance = distance;
      }
    }
  }

  return bestDistance > tolerance ? { a, b } : null;
}

export function uniquePoints2D(points: Point2[], tolerance: number): Point2[] {
  const cellSize = Math.max(tolerance, 1e-6);
  const seen = new Map<string, Point2>();
  for (const point of points) {
    const key = `${Math.round(point[0] / cellSize)},${Math.round(point[1] / cellSize)}`;
    if (!seen.has(key)) seen.set(key, point);
  }
  return [...seen.values()];
}

export function scanlineCavityPolygons(
  segments: Segment2[],
  swapAxes: boolean,
  candidateArea: number,
  tolerance: number,
): Point2[][] {
  const oriented = segments.map((segment): Segment2 => ({
    a: orientPoint2D(segment.a, swapAxes),
    b: orientPoint2D(segment.b, swapAxes),
  }));
  const intervals = scanlineIntervals(oriented, tolerance);
  if (intervals.length === 0) return [];

  const opened = morphologicalCavityPolygons(intervals, candidateArea, tolerance);
  if (opened.length > 0) {
    return opened.map((loop) => loop.map((point) => orientPoint2D(point, swapAxes)));
  }

  const maxLength = Math.max(...intervals.map((interval) => interval.length));
  const minLength = Math.max(maxLength * INTERIOR_FILL_INTERVAL_MIN_LENGTH_RATIO, tolerance * 4);
  const kept = intervals.filter((interval) => interval.length >= minLength);
  if (kept.length < INTERIOR_FILL_MIN_INTERVAL_ROWS) return [];

  const selected = largestIntervalComponent(kept);
  if (selected.length < INTERIOR_FILL_MIN_INTERVAL_ROWS) return [];

  const byRow = new Map<number, InteriorFillInterval>();
  for (const interval of selected) {
    const current = byRow.get(interval.row);
    if (!current || interval.length > current.length) byRow.set(interval.row, interval);
  }
  const rows = [...byRow.values()].sort((a, b) => a.row - b.row);
  if (rows.length < INTERIOR_FILL_MIN_INTERVAL_ROWS) return [];

  const rowStep = rows.length > 1
    ? Math.abs(rows[1].y - rows[0].y)
    : Math.sqrt(candidateArea) / INTERIOR_FILL_SCAN_ROWS;
  const estimatedArea = rows.reduce((sum, row) => sum + row.length * rowStep, 0);
  if (estimatedArea < candidateArea * INTERIOR_FILL_MIN_SLICE_AREA_RATIO) return [];

  const loop = [
    ...rows.map((row): Point2 => [row.x0, row.y]),
    ...rows.slice().reverse().map((row): Point2 => [row.x1, row.y]),
  ].map((point) => orientPoint2D(point, swapAxes));
  const cleaned = cleanLoop2D(loop, tolerance);
  if (cleaned.length < 3) return [];
  return [insetLoop2D(cleaned, tolerance)];
}

export function morphologicalCavityPolygons(
  intervals: InteriorFillInterval[],
  candidateArea: number,
  tolerance: number,
): Point2[][] {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const interval of intervals) {
    minX = Math.min(minX, interval.x0);
    maxX = Math.max(maxX, interval.x1);
    minY = Math.min(minY, interval.y);
    maxY = Math.max(maxY, interval.y);
  }
  if (!Number.isFinite(minX) || maxX - minX <= tolerance || maxY - minY <= tolerance) return [];

  const grid = Array.from({ length: INTERIOR_FILL_SCAN_ROWS }, () =>
    new Array<boolean>(INTERIOR_FILL_GRID_COLUMNS).fill(false)
  );
  const width = maxX - minX;
  for (const interval of intervals) {
    const row = interval.row;
    if (!grid[row]) continue;
    const start = Math.max(0, Math.floor(((interval.x0 - minX) / width) * INTERIOR_FILL_GRID_COLUMNS));
    const end = Math.min(
      INTERIOR_FILL_GRID_COLUMNS - 1,
      Math.ceil(((interval.x1 - minX) / width) * INTERIOR_FILL_GRID_COLUMNS) - 1,
    );
    for (let col = start; col <= end; col++) grid[row][col] = true;
  }

  const radius = Math.max(
    1,
    Math.round(Math.min(INTERIOR_FILL_SCAN_ROWS, INTERIOR_FILL_GRID_COLUMNS) * INTERIOR_FILL_OPEN_RADIUS_RATIO),
  );
  const eroded = erodeGrid(grid, radius);
  const components = largestGridComponents(eroded);
  if (components.length === 0) return [];

  const rowStep = (maxY - minY) / INTERIOR_FILL_SCAN_ROWS;
  const loops: Point2[][] = [];
  for (const component of components) {
    const opened = dilateGrid(component, radius);
    const rows = trimCavityRows(refinedGridRowsToIntervals(opened, intervals, minX, maxX, minY, maxY));
    if (rows.length < INTERIOR_FILL_MIN_INTERVAL_ROWS) continue;

    const estimatedArea = rows.reduce((sum, row) => sum + row.length * rowStep, 0);
    if (estimatedArea < candidateArea * INTERIOR_FILL_MIN_SLICE_AREA_RATIO) continue;

    const loop = [
      ...rows.map((row): Point2 => [row.x0, row.y]),
      ...rows.slice().reverse().map((row): Point2 => [row.x1, row.y]),
    ];
    const cleaned = cleanLoop2D(loop, tolerance);
    if (cleaned.length >= 3) loops.push(insetLoop2D(cleaned, tolerance));
  }
  return loops;
}

export function trimCavityRows(rows: InteriorFillInterval[]): InteriorFillInterval[] {
  if (rows.length < INTERIOR_FILL_END_TRIM_MIN_ROWS) return rows;

  const maxLength = Math.max(...rows.map((row) => row.length));
  const minEndLength = maxLength * INTERIOR_FILL_END_TRIM_LENGTH_RATIO;
  let start = 0;
  let end = rows.length;
  while (end - start > INTERIOR_FILL_MIN_INTERVAL_ROWS && rows[start].length < minEndLength) {
    start += 1;
  }
  while (end - start > INTERIOR_FILL_MIN_INTERVAL_ROWS && rows[end - 1].length < minEndLength) {
    end -= 1;
  }
  const trimmed = start === 0 && end === rows.length ? rows : rows.slice(start, end);
  return trimCavityRowSides(trimmed);
}

export function trimCavityRowSides(rows: InteriorFillInterval[]): InteriorFillInterval[] {
  if (rows.length < INTERIOR_FILL_END_TRIM_MIN_ROWS) return rows;

  const maxLength = Math.max(...rows.map((row) => row.length));
  const minLength = maxLength * INTERIOR_FILL_SIDE_TRIM_MIN_LENGTH_RATIO;
  return rows.map((row, index) => {
    const start = Math.max(0, index - INTERIOR_FILL_SIDE_TRIM_WINDOW);
    const end = Math.min(rows.length, index + INTERIOR_FILL_SIDE_TRIM_WINDOW + 1);
    const neighbors = rows.slice(start, end).filter((_, neighborIndex) => start + neighborIndex !== index);
    if (neighbors.length < 2) return row;

    const leftLimit = quantile(neighbors.map((neighbor) => neighbor.x0), INTERIOR_FILL_SIDE_TRIM_QUANTILE);
    const rightLimit = quantile(neighbors.map((neighbor) => neighbor.x1), 1 - INTERIOR_FILL_SIDE_TRIM_QUANTILE);
    const x0 = Math.max(row.x0, leftLimit);
    const x1 = Math.min(row.x1, rightLimit);
    const length = x1 - x0;
    if (length < minLength) return row;
    return { ...row, x0, x1, length };
  });
}

export function quantile(values: number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = clamp(Math.round((sorted.length - 1) * q), 0, sorted.length - 1);
  return sorted[index] ?? 0;
}

export function erodeGrid(grid: boolean[][], radius: number): boolean[][] {
  return grid.map((row, y) => row.map((filled, x) => {
    if (!filled) return false;
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.abs(dx) + Math.abs(dy) > radius) continue;
        if (!grid[y + dy]?.[x + dx]) return false;
      }
    }
    return true;
  }));
}

export function dilateGrid(grid: boolean[][], radius: number): boolean[][] {
  const out = grid.map((row) => row.map(() => false));
  for (let y = 0; y < grid.length; y++) {
    for (let x = 0; x < grid[y].length; x++) {
      if (!grid[y][x]) continue;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (Math.abs(dx) + Math.abs(dy) > radius) continue;
          const row = out[y + dy];
          if (row && x + dx >= 0 && x + dx < row.length) row[x + dx] = true;
        }
      }
    }
  }
  return out;
}

export function largestGridComponents(grid: boolean[][]): boolean[][][] {
  const seen = grid.map((row) => row.map(() => false));
  const components: Point2[][] = [];
  const directions = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

  for (let y = 0; y < grid.length; y++) {
    for (let x = 0; x < grid[y].length; x++) {
      if (!grid[y][x] || seen[y][x]) continue;
      const queue: Point2[] = [[x, y]];
      const component: Point2[] = [];
      seen[y][x] = true;
      for (let i = 0; i < queue.length; i++) {
        const [cx, cy] = queue[i];
        component.push([cx, cy]);
        for (const [dx, dy] of directions) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (!grid[ny]?.[nx] || seen[ny][nx]) continue;
          seen[ny][nx] = true;
          queue.push([nx, ny]);
        }
      }
      components.push(component);
    }
  }

  components.sort((a, b) => b.length - a.length);
  const largest = components[0]?.length ?? 0;
  if (largest === 0) return [];
  const minSize = largest * INTERIOR_FILL_SECONDARY_COMPONENT_AREA_RATIO;
  return components
    .filter((component) => component.length >= minSize)
    .slice(0, INTERIOR_FILL_MAX_COMPONENTS_PER_SLICE)
    .map((component) => {
      const out = grid.map((row) => row.map(() => false));
      for (const [x, y] of component) out[y][x] = true;
      return out;
    });
}

export function gridRowsToIntervals(
  grid: boolean[][],
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
): InteriorFillInterval[] {
  const rows: InteriorFillInterval[] = [];
  const width = maxX - minX;
  const height = maxY - minY;
  for (let row = 0; row < grid.length; row++) {
    let start = -1;
    let end = -1;
    for (let col = 0; col < grid[row].length; col++) {
      if (!grid[row][col]) continue;
      if (start < 0) start = col;
      end = col;
    }
    if (start < 0) continue;
    const x0 = minX + (start / INTERIOR_FILL_GRID_COLUMNS) * width;
    const x1 = minX + ((end + 1) / INTERIOR_FILL_GRID_COLUMNS) * width;
    const y = minY + ((row + 0.5) / INTERIOR_FILL_SCAN_ROWS) * height;
    rows.push({ row, y, x0, x1, length: x1 - x0 });
  }
  return rows;
}

export function refinedGridRowsToIntervals(
  grid: boolean[][],
  sourceIntervals: InteriorFillInterval[],
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
): InteriorFillInterval[] {
  const rows = gridRowsToIntervals(grid, minX, maxX, minY, maxY);
  if (rows.length === 0) return rows;

  const byRow = new Map<number, InteriorFillInterval[]>();
  for (const interval of sourceIntervals) {
    const current = byRow.get(interval.row);
    if (current) current.push(interval);
    else byRow.set(interval.row, [interval]);
  }

  const cellWidth = (maxX - minX) / INTERIOR_FILL_GRID_COLUMNS;
  return rows.map((row) => {
    const expanded: InteriorFillInterval = {
      ...row,
      x0: row.x0 - cellWidth,
      x1: row.x1 + cellWidth,
      length: row.length + cellWidth * 2,
    };
    let best: InteriorFillInterval | null = null;
    let bestOverlap = 0;
    for (const source of byRow.get(row.row) ?? []) {
      const overlap = intervalOverlap(source, expanded);
      if (overlap > bestOverlap) {
        best = source;
        bestOverlap = overlap;
      }
    }
    if (!best || bestOverlap <= 0) return row;

    const x0 = Math.max(best.x0, expanded.x0);
    const x1 = Math.min(best.x1, expanded.x1);
    const length = x1 - x0;
    return length > 0 ? { row: row.row, y: best.y, x0, x1, length } : row;
  });
}

export function orientPoint2D(point: Point2, swapAxes: boolean): Point2 {
  return swapAxes ? [point[1], point[0]] : point;
}

export function scanlineIntervals(segments: Segment2[], tolerance: number): InteriorFillInterval[] {
  let minY = Infinity;
  let maxY = -Infinity;
  for (const segment of segments) {
    minY = Math.min(minY, segment.a[1], segment.b[1]);
    maxY = Math.max(maxY, segment.a[1], segment.b[1]);
  }
  const spanY = maxY - minY;
  if (!Number.isFinite(spanY) || spanY <= tolerance) return [];

  const intervals: InteriorFillInterval[] = [];
  for (let row = 0; row < INTERIOR_FILL_SCAN_ROWS; row++) {
    const y = minY + ((row + 0.5) / INTERIOR_FILL_SCAN_ROWS) * spanY;
    const xs: number[] = [];
    for (const segment of segments) {
      const y0 = segment.a[1];
      const y1 = segment.b[1];
      const dy = y1 - y0;
      if (Math.abs(dy) <= tolerance) continue;
      const t = (y - y0) / dy;
      if (t < -tolerance || t > 1 + tolerance) continue;
      xs.push(segment.a[0] + (segment.b[0] - segment.a[0]) * t);
    }

    const sorted = uniqueNumbers(xs.sort((a, b) => a - b), tolerance);
    for (let i = 0; i + 1 < sorted.length; i += 2) {
      const x0 = sorted[i];
      const x1 = sorted[i + 1];
      const length = x1 - x0;
      if (length <= tolerance) continue;
      intervals.push({ row, y, x0, x1, length });
    }
  }
  return intervals;
}

export function uniqueNumbers(values: number[], tolerance: number): number[] {
  const unique: number[] = [];
  for (const value of values) {
    if (unique.length === 0 || Math.abs(value - unique[unique.length - 1]) > tolerance) {
      unique.push(value);
    }
  }
  return unique;
}

export function largestIntervalComponent(intervals: InteriorFillInterval[]): InteriorFillInterval[] {
  const parent = intervals.map((_, index) => index);
  const find = (index: number): number => {
    while (parent[index] !== index) {
      parent[index] = parent[parent[index]];
      index = parent[index];
    }
    return index;
  };
  const union = (a: number, b: number): void => {
    const ar = find(a);
    const br = find(b);
    if (ar !== br) parent[br] = ar;
  };

  for (let i = 0; i < intervals.length; i++) {
    for (let j = i + 1; j < intervals.length; j++) {
      if (Math.abs(intervals[i].row - intervals[j].row) > 1) continue;
      const overlap = intervalOverlap(intervals[i], intervals[j]);
      const required = Math.min(intervals[i].length, intervals[j].length) * INTERIOR_FILL_INTERVAL_OVERLAP_RATIO;
      if (overlap >= required) union(i, j);
    }
  }

  const groups = new Map<number, { intervals: InteriorFillInterval[]; score: number }>();
  for (let i = 0; i < intervals.length; i++) {
    const root = find(i);
    const group = groups.get(root);
    if (group) {
      group.intervals.push(intervals[i]);
      group.score += intervals[i].length;
    } else {
      groups.set(root, { intervals: [intervals[i]], score: intervals[i].length });
    }
  }

  let best: { intervals: InteriorFillInterval[]; score: number } | null = null;
  for (const group of groups.values()) {
    if (!best || group.score > best.score) best = group;
  }
  return best?.intervals ?? [];
}

export function intervalOverlap(a: InteriorFillInterval, b: InteriorFillInterval): number {
  return Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0));
}

export function cleanLoop2D(points: Point2[], tolerance: number): Point2[] {
  const cleaned: Point2[] = [];
  for (let i = 0; i < points.length; i++) {
    const prev = points[(i - 1 + points.length) % points.length];
    const current = points[i];
    const next = points[(i + 1) % points.length];
    if (distance2D(prev, current) <= tolerance || distance2D(current, next) <= tolerance) continue;
    if (Math.abs(cross2D(prev, current, next)) <= tolerance * tolerance) continue;
    cleaned.push(current);
  }
  return cleaned;
}

export function insetLoop2D(points: Point2[], tolerance: number): Point2[] {
  if (points.length < 3) return points;
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

  const minSpan = Math.min(maxX - minX, maxY - minY);
  const insetDistance = clamp(
    minSpan * INTERIOR_FILL_INSET_DISTANCE_RATIO,
    tolerance * 8,
    minSpan * INTERIOR_FILL_INSET_MAX_DISTANCE_RATIO,
  );
  if (!Number.isFinite(insetDistance) || insetDistance <= tolerance) return points;

  const area = loopArea2D(points);
  const orientation = area >= 0 ? 1 : -1;
  const normals: Point2[] = [];
  for (let i = 0; i < points.length; i++) {
    const current = points[i];
    const next = points[(i + 1) % points.length];
    const dx = next[0] - current[0];
    const dy = next[1] - current[1];
    const length = Math.hypot(dx, dy);
    if (length <= tolerance) return scaleLoopTowardCentroid2D(points, insetDistance);
    normals.push([
      (-dy / length) * orientation,
      (dx / length) * orientation,
    ]);
  }

  const maxMiter = insetDistance * INTERIOR_FILL_MAX_MITER_RATIO + tolerance;
  const inset = points.map((point, index): Point2 => {
    const prevIndex = (index - 1 + points.length) % points.length;
    const nextIndex = (index + 1) % points.length;
    const prevNormal = normals[prevIndex];
    const currentNormal = normals[index];
    const prevPoint = points[prevIndex];
    const nextPoint = points[nextIndex];
    const previousLineA: Point2 = [
      prevPoint[0] + prevNormal[0] * insetDistance,
      prevPoint[1] + prevNormal[1] * insetDistance,
    ];
    const previousLineB: Point2 = [
      point[0] + prevNormal[0] * insetDistance,
      point[1] + prevNormal[1] * insetDistance,
    ];
    const currentLineA: Point2 = [
      point[0] + currentNormal[0] * insetDistance,
      point[1] + currentNormal[1] * insetDistance,
    ];
    const currentLineB: Point2 = [
      nextPoint[0] + currentNormal[0] * insetDistance,
      nextPoint[1] + currentNormal[1] * insetDistance,
    ];
    const fallback = averagedInsetPoint(point, prevNormal, currentNormal, insetDistance);
    const intersection = lineIntersection2D(previousLineA, previousLineB, currentLineA, currentLineB, tolerance);
    if (!intersection || distance2D(point, intersection) > maxMiter) return fallback;
    return intersection;
  });

  const cleaned = cleanLoop2D(inset, tolerance);
  if (cleaned.length < 3) return scaleLoopTowardCentroid2D(points, insetDistance);
  const insetArea = loopArea2D(cleaned);
  if (
    Math.sign(insetArea || area) !== Math.sign(area) ||
    Math.abs(insetArea) < Math.abs(area) * 0.05 ||
    !loopInsideLoop2D(cleaned, points, tolerance)
  ) {
    return scaleLoopTowardCentroid2D(points, insetDistance);
  }
  return cleaned;
}

export function averagedInsetPoint(point: Point2, a: Point2, b: Point2, distance: number): Point2 {
  const nx = a[0] + b[0];
  const ny = a[1] + b[1];
  const length = Math.hypot(nx, ny);
  if (length <= 1e-8) return [point[0] + b[0] * distance, point[1] + b[1] * distance];
  return [
    point[0] + (nx / length) * distance,
    point[1] + (ny / length) * distance,
  ];
}

export function lineIntersection2D(a0: Point2, a1: Point2, b0: Point2, b1: Point2, tolerance: number): Point2 | null {
  const rx = a1[0] - a0[0];
  const ry = a1[1] - a0[1];
  const sx = b1[0] - b0[0];
  const sy = b1[1] - b0[1];
  const denominator = rx * sy - ry * sx;
  if (Math.abs(denominator) <= tolerance * tolerance) return null;

  const qpx = b0[0] - a0[0];
  const qpy = b0[1] - a0[1];
  const t = (qpx * sy - qpy * sx) / denominator;
  return [a0[0] + rx * t, a0[1] + ry * t];
}

export function loopInsideLoop2D(inner: Point2[], outer: Point2[], tolerance: number): boolean {
  for (let i = 0; i < inner.length; i++) {
    const a = inner[i];
    const b = inner[(i + 1) % inner.length];
    const mid: Point2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    if (!pointInLoop2D(a, outer, tolerance) || !pointInLoop2D(mid, outer, tolerance)) return false;
  }
  return true;
}

export function pointInLoop2D(point: Point2, loop: Point2[], tolerance: number): boolean {
  let inside = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const a = loop[i];
    const b = loop[j];
    if (pointNearSegment2D(point, a, b, tolerance)) return true;
    const intersects = (a[1] > point[1]) !== (b[1] > point[1]) &&
      point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0];
    if (intersects) inside = !inside;
  }
  return inside;
}

export function pointNearSegment2D(point: Point2, a: Point2, b: Point2, tolerance: number): boolean {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq <= tolerance * tolerance) return distance2D(point, a) <= tolerance;
  const t = clamp(((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / lengthSq, 0, 1);
  const closest: Point2 = [a[0] + dx * t, a[1] + dy * t];
  return distance2D(point, closest) <= tolerance;
}

export function scaleLoopTowardCentroid2D(points: Point2[], distance: number): Point2[] {
  let cx = 0;
  let cy = 0;
  for (const point of points) {
    cx += point[0];
    cy += point[1];
  }
  cx /= points.length;
  cy /= points.length;
  return points.map(([x, y]) => {
    const dx = x - cx;
    const dy = y - cy;
    const length = Math.hypot(dx, dy);
    if (length <= distance || length <= 1e-8) return [x, y];
    const scale = (length - distance) / length;
    return [
      cx + dx * scale,
      cy + dy * scale,
    ];
  });
}

export function loopArea2D(points: Point2[]): number {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    area += a[0] * b[1] - b[0] * a[1];
  }
  return area / 2;
}

export function totalLoopArea2D(loops: Point2[][]): number {
  return loops.reduce((sum, loop) => sum + Math.abs(loopArea2D(loop)), 0);
}

export function loopCentroid2D(points: Point2[]): Point2 {
  let cx = 0;
  let cy = 0;
  for (const point of points) {
    cx += point[0];
    cy += point[1];
  }
  return points.length > 0 ? [cx / points.length, cy / points.length] : [0, 0];
}

export function cross2D(a: Point2, b: Point2, c: Point2): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

export function distance2D(a: Point2, b: Point2): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}
