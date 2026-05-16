import type { Polygon, Vec3 } from "@layoutit/polycss";
import { solidColorToHex } from "./debugPrecision";

type AxisIndex = 0 | 1 | 2;
type Point2 = [number, number];

interface Segment2 {
  a: Point2;
  b: Point2;
}

interface InteriorFillInterval {
  row: number;
  y: number;
  x0: number;
  x1: number;
  length: number;
}

interface InteriorFillSlice {
  fixedAxis: AxisIndex;
  axisA: AxisIndex;
  axisB: AxisIndex;
  planeValue: number;
  points: Point2[];
  area: number;
}

interface InteriorFillComponent {
  points: Point2[];
  area: number;
}

export interface PolygonBounds {
  min: Vec3;
  max: Vec3;
  center: Vec3;
  span: Vec3;
  diagonal: number;
  maxSpan: number;
}

const INTERIOR_FILL_MIN_MAX_SPAN = 8;
const INTERIOR_FILL_MIN_DIAGONAL = 10;
const INTERIOR_FILL_SOLID_COVERAGE_MIN = 0.2;
const INTERIOR_FILL_MIN_PLANE_AREA_RATIO = 0.12;
const INTERIOR_FILL_MIN_SLICE_AREA_RATIO = 0.008;
const INTERIOR_FILL_SCAN_ROWS = 64;
const INTERIOR_FILL_SLICE_POSITIONS = [0.28, 0.5, 0.72] as const;
const INTERIOR_FILL_INTERVAL_MIN_LENGTH_RATIO = 0.18;
const INTERIOR_FILL_INTERVAL_OVERLAP_RATIO = 0.12;
const INTERIOR_FILL_MIN_INTERVAL_ROWS = 4;
const INTERIOR_FILL_MAX_COMPONENTS_PER_SLICE = 2;
const INTERIOR_FILL_INSET_RATIO = 0.025;
const INTERIOR_FILL_OVAL_SCALE = 0.82;
const INTERIOR_FILL_OVAL_MARGIN_RATIO = 0.025;
const INTERIOR_FILL_OVAL_SAMPLES = 9;
const INTERIOR_FILL_MAX_SLICES = 9;
const EPS = 1e-6;

function clamp(value: number, min: number, max: number): number {
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
    area += Math.hypot(
      ay * bz - az * by,
      az * bx - ax * bz,
      ax * by - ay * bx,
    ) * 0.5;
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

export function interiorFillPolygons(
  polygons: Polygon[],
): Polygon[] {
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

  const planes = candidatePlanes(bounds);
  const slices: InteriorFillSlice[] = [];
  for (const plane of planes) {
    const area = bounds.span[plane.axisA] * bounds.span[plane.axisB];
    for (const position of INTERIOR_FILL_SLICE_POSITIONS) {
      const planeValue = bounds.min[plane.fixedAxis] + bounds.span[plane.fixedAxis] * position;
      slices.push(...interiorFillSlicesAtPlane(
        polygons,
        bounds,
        plane.fixedAxis,
        plane.axisA,
        plane.axisB,
        planeValue,
        area,
      ));
    }
  }

  slices.sort((a, b) => b.area - a.area);
  return slices
    .slice(0, INTERIOR_FILL_MAX_SLICES)
    .flatMap((slice) => interiorFillPolygonsFromSlice(bounds, slice, color));
}

function candidatePlanes(bounds: PolygonBounds): Array<{ fixedAxis: AxisIndex; axisA: AxisIndex; axisB: AxisIndex }> {
  const candidates = [
    { fixedAxis: 2 as AxisIndex, axisA: 0 as AxisIndex, axisB: 1 as AxisIndex, area: bounds.span[0] * bounds.span[1] },
    { fixedAxis: 1 as AxisIndex, axisA: 0 as AxisIndex, axisB: 2 as AxisIndex, area: bounds.span[0] * bounds.span[2] },
    { fixedAxis: 0 as AxisIndex, axisA: 1 as AxisIndex, axisB: 2 as AxisIndex, area: bounds.span[1] * bounds.span[2] },
  ].sort((a, b) => b.area - a.area);
  const minArea = (candidates[0]?.area ?? 0) * INTERIOR_FILL_MIN_PLANE_AREA_RATIO;
  return candidates.filter((candidate) => candidate.area > minArea);
}

function interiorFillPolygonsFromSlice(
  bounds: PolygonBounds,
  slice: InteriorFillSlice,
  color: string,
): Polygon[] {
  const rect = interiorFillOval2D(slice.points);
  return rect ? doubleSidedSlicePolygon(bounds, slice, rect, color) : [];
}

function doubleSidedSlicePolygon(
  bounds: PolygonBounds,
  slice: InteriorFillSlice,
  points: Point2[],
  color: string,
): [Polygon, Polygon] {
  const point = ([a, b]: Point2): Vec3 => {
    const vertex = [...bounds.center] as Vec3;
    vertex[slice.fixedAxis] = slice.planeValue;
    vertex[slice.axisA] = a;
    vertex[slice.axisB] = b;
    return vertex;
  };
  const vertices = points.map(point);
  return [
    { vertices, color },
    { vertices: [...vertices].reverse(), color },
  ];
}

function interiorFillSlicesAtPlane(
  polygons: Polygon[],
  bounds: PolygonBounds,
  fixedAxis: AxisIndex,
  axisA: AxisIndex,
  axisB: AxisIndex,
  planeValue: number,
  candidateArea: number,
): InteriorFillSlice[] {
  const tolerance = Math.max(bounds.diagonal * 1e-5, 1e-4);
  const segments: Segment2[] = [];
  for (const polygon of polygons) {
    const segment = slicePolygonAtAxis(polygon, fixedAxis, axisA, axisB, planeValue, tolerance);
    if (segment) segments.push(segment);
  }
  if (segments.length < 3) return [];

  const primary = scanlineSliceComponents(segments, false, candidateArea, tolerance);
  const secondary = scanlineSliceComponents(segments, true, candidateArea, tolerance);
  const components = totalComponentArea(secondary) > totalComponentArea(primary) ? secondary : primary;
  return components.map((component): InteriorFillSlice => ({
    fixedAxis,
    axisA,
    axisB,
    planeValue,
    points: component.points,
    area: component.area,
  })).filter((slice) => slice.area >= candidateArea * INTERIOR_FILL_MIN_SLICE_AREA_RATIO);
}

function slicePolygonAtAxis(
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
  for (let i = 0; i < vertices.length; i += 1) {
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

  let best: Segment2 | null = null;
  let bestDistance = 0;
  for (let i = 0; i < unique.length; i += 1) {
    for (let j = i + 1; j < unique.length; j += 1) {
      const distance = distance2D(unique[i], unique[j]);
      if (distance > bestDistance) {
        best = { a: unique[i], b: unique[j] };
        bestDistance = distance;
      }
    }
  }
  return best && bestDistance > tolerance ? best : null;
}

function scanlineSliceComponents(
  segments: Segment2[],
  swapAxes: boolean,
  candidateArea: number,
  tolerance: number,
): InteriorFillComponent[] {
  const oriented = segments.map((segment): Segment2 => ({
    a: orientPoint2D(segment.a, swapAxes),
    b: orientPoint2D(segment.b, swapAxes),
  }));
  const intervals = scanlineIntervals(oriented, candidateArea, tolerance);
  if (intervals.length < INTERIOR_FILL_MIN_INTERVAL_ROWS) return [];

  const components = intervalComponents(intervals)
    .filter((component) => component.length >= INTERIOR_FILL_MIN_INTERVAL_ROWS)
    .slice(0, INTERIOR_FILL_MAX_COMPONENTS_PER_SLICE);

  return components.flatMap((component) => {
    const loop = loopFromIntervals(component);
    const area = Math.abs(loopArea2D(loop));
    if (loop.length < 3 || area < candidateArea * INTERIOR_FILL_MIN_SLICE_AREA_RATIO) {
      return [];
    }
    const points = scaleLoopTowardCentroid2D(loop, INTERIOR_FILL_INSET_RATIO)
      .map((point) => orientPoint2D(point, swapAxes));
    return [{ points, area: Math.abs(loopArea2D(points)) }];
  });
}

function interiorFillOval2D(points: Point2[]): Point2[] | null {
  const normal = interiorFillOvalRect2D(points);
  const transposed = interiorFillOvalRect2D(points.map(transposePoint2D))?.map(transposePoint2D) ?? null;
  if (!normal) return transposed;
  if (!transposed) return normal;
  return Math.abs(loopArea2D(transposed)) > Math.abs(loopArea2D(normal)) ? transposed : normal;
}

function interiorFillOvalRect2D(points: Point2[]): Point2[] | null {
  const bounds = bounds2D(points);
  if (!bounds) return null;
  const center = loopCentroid2D(points);
  const centerY = clamp(center[1], bounds.minY + EPS, bounds.maxY - EPS);
  const centerInterval = widestIntervalAtY2D(points, centerY);
  if (!centerInterval) return null;
  const centerX = clamp(center[0], centerInterval[0], centerInterval[1]);

  for (const scale of [INTERIOR_FILL_OVAL_SCALE, 0.68, 0.54, 0.4]) {
    const halfHeight = bounds.height * scale * 0.5;
    const halfWidth = bounds.width * scale * 0.5;
    const y0 = clamp(centerY - halfHeight, bounds.minY, bounds.maxY);
    const y1 = clamp(centerY + halfHeight, bounds.minY, bounds.maxY);
    if (y1 - y0 <= EPS) continue;

    let x0 = centerX - halfWidth;
    let x1 = centerX + halfWidth;
    for (let i = 0; i < INTERIOR_FILL_OVAL_SAMPLES; i += 1) {
      const t = INTERIOR_FILL_OVAL_SAMPLES === 1 ? 0.5 : i / (INTERIOR_FILL_OVAL_SAMPLES - 1);
      const y = y0 + (y1 - y0) * t;
      const interval = overlappingIntervalAtY2D(points, y, [x0, x1]) ?? widestIntervalAtY2D(points, y);
      if (!interval) {
        x1 = x0;
        break;
      }
      x0 = Math.max(x0, interval[0]);
      x1 = Math.min(x1, interval[1]);
    }
    if (x1 - x0 > EPS) {
      const margin = Math.min(x1 - x0, y1 - y0) * INTERIOR_FILL_OVAL_MARGIN_RATIO;
      const insetX = Math.min(margin, (x1 - x0) * 0.25);
      const insetY = Math.min(margin, (y1 - y0) * 0.25);
      if (x1 - x0 - insetX * 2 <= EPS || y1 - y0 - insetY * 2 <= EPS) continue;
      return [
        [x0 + insetX, y0 + insetY],
        [x1 - insetX, y0 + insetY],
        [x1 - insetX, y1 - insetY],
        [x0 + insetX, y1 - insetY],
      ];
    }
  }
  return null;
}

function widestIntervalAtY2D(points: Point2[], y: number): [number, number] | null {
  const intervals = loopIntervalsAtY2D(points, y);
  let best: [number, number] | null = null;
  for (const interval of intervals) {
    if (!best || interval[1] - interval[0] > best[1] - best[0]) best = interval;
  }
  return best;
}

function overlappingIntervalAtY2D(
  points: Point2[],
  y: number,
  target: [number, number],
): [number, number] | null {
  const intervals = loopIntervalsAtY2D(points, y);
  let best: [number, number] | null = null;
  let bestOverlap = 0;
  for (const interval of intervals) {
    const overlap = Math.min(interval[1], target[1]) - Math.max(interval[0], target[0]);
    if (overlap > bestOverlap) {
      best = interval;
      bestOverlap = overlap;
    }
  }
  return bestOverlap > EPS ? best : null;
}

function loopIntervalsAtY2D(points: Point2[], y: number): Array<[number, number]> {
  const xs: number[] = [];
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    if (Math.abs(b[1] - a[1]) <= EPS) continue;
    const low = Math.min(a[1], b[1]);
    const high = Math.max(a[1], b[1]);
    if (y < low || y >= high) continue;
    const t = (y - a[1]) / (b[1] - a[1]);
    xs.push(a[0] + (b[0] - a[0]) * t);
  }
  xs.sort((a, b) => a - b);
  const intervals: Array<[number, number]> = [];
  for (let i = 0; i + 1 < xs.length; i += 2) {
    if (xs[i + 1] - xs[i] > EPS) intervals.push([xs[i], xs[i + 1]]);
  }
  return intervals;
}

function bounds2D(points: Point2[]): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
} | null {
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
  if (!Number.isFinite(minX) || maxX - minX <= EPS || maxY - minY <= EPS) {
    return null;
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

function transposePoint2D([x, y]: Point2): Point2 {
  return [y, x];
}

function scanlineIntervals(
  segments: Segment2[],
  candidateArea: number,
  tolerance: number,
): InteriorFillInterval[] {
  let minY = Infinity;
  let maxY = -Infinity;
  for (const segment of segments) {
    minY = Math.min(minY, segment.a[1], segment.b[1]);
    maxY = Math.max(maxY, segment.a[1], segment.b[1]);
  }
  if (!Number.isFinite(minY) || maxY - minY <= tolerance) return [];

  const intervals: InteriorFillInterval[] = [];
  for (let row = 0; row < INTERIOR_FILL_SCAN_ROWS; row += 1) {
    const y = minY + ((row + 0.5) / INTERIOR_FILL_SCAN_ROWS) * (maxY - minY);
    const xs: number[] = [];
    for (const segment of segments) {
      const y0 = segment.a[1];
      const y1 = segment.b[1];
      if (Math.abs(y1 - y0) <= tolerance) continue;
      const low = Math.min(y0, y1);
      const high = Math.max(y0, y1);
      if (y < low || y >= high) continue;
      const t = (y - y0) / (y1 - y0);
      xs.push(segment.a[0] + (segment.b[0] - segment.a[0]) * t);
    }

    xs.sort((a, b) => a - b);
    const uniqueXs = uniqueNumbers(xs, tolerance);
    for (let i = 0; i + 1 < uniqueXs.length; i += 2) {
      const x0 = uniqueXs[i];
      const x1 = uniqueXs[i + 1];
      const length = x1 - x0;
      if (length <= tolerance) continue;
      intervals.push({ row, y, x0, x1, length });
    }
  }

  if (intervals.length === 0) return [];
  const maxLength = Math.max(...intervals.map((interval) => interval.length));
  const minLength = Math.max(
    maxLength * INTERIOR_FILL_INTERVAL_MIN_LENGTH_RATIO,
    Math.sqrt(candidateArea) * 0.01,
    tolerance * 4,
  );
  return intervals.filter((interval) => interval.length >= minLength);
}

function intervalComponents(intervals: InteriorFillInterval[]): InteriorFillInterval[][] {
  const sorted = [...intervals].sort((a, b) => a.row - b.row || b.length - a.length);
  const components: InteriorFillInterval[][] = [];
  const active: Array<{ last: InteriorFillInterval; component: InteriorFillInterval[] }> = [];

  for (const interval of sorted) {
    let best: { last: InteriorFillInterval; component: InteriorFillInterval[] } | null = null;
    for (const current of active) {
      if (interval.row - current.last.row > 1) continue;
      const overlap = Math.min(interval.x1, current.last.x1) - Math.max(interval.x0, current.last.x0);
      const required = Math.min(interval.length, current.last.length) * INTERIOR_FILL_INTERVAL_OVERLAP_RATIO;
      if (overlap >= required && (!best || current.component.length > best.component.length)) {
        best = current;
      }
    }

    if (best) {
      best.component.push(interval);
      best.last = interval;
    } else {
      const component = [interval];
      components.push(component);
      active.push({ last: interval, component });
    }

    for (let i = active.length - 1; i >= 0; i -= 1) {
      if (interval.row - active[i].last.row > 1) active.splice(i, 1);
    }
  }

  return components.sort((a, b) => componentArea(b) - componentArea(a));
}

function loopFromIntervals(intervals: InteriorFillInterval[]): Point2[] {
  const byRow = new Map<number, InteriorFillInterval>();
  for (const interval of intervals) {
    const current = byRow.get(interval.row);
    if (!current || interval.length > current.length) byRow.set(interval.row, interval);
  }
  const rows = [...byRow.values()].sort((a, b) => a.row - b.row);
  const loop = [
    ...rows.map((row): Point2 => [row.x0, row.y]),
    ...rows.slice().reverse().map((row): Point2 => [row.x1, row.y]),
  ];
  return cleanLoop2D(loop);
}

function cleanLoop2D(points: Point2[]): Point2[] {
  const out: Point2[] = [];
  for (const point of points) {
    const previous = out[out.length - 1];
    if (!previous || distance2D(previous, point) > EPS) out.push(point);
  }
  if (out.length > 1 && distance2D(out[0], out[out.length - 1]) <= EPS) out.pop();
  return out;
}

function scaleLoopTowardCentroid2D(points: Point2[], amount: number): Point2[] {
  const center = loopCentroid2D(points);
  return points.map(([x, y]) => [
    center[0] + (x - center[0]) * (1 - amount),
    center[1] + (y - center[1]) * (1 - amount),
  ]);
}

function componentArea(component: InteriorFillInterval[]): number {
  if (component.length === 0) return 0;
  const rows = [...component].sort((a, b) => a.row - b.row);
  const rowStep = rows.length > 1
    ? Math.abs(rows[1].y - rows[0].y)
    : 1;
  return rows.reduce((sum, row) => sum + row.length * rowStep, 0);
}

function orientPoint2D([x, y]: Point2, swapAxes: boolean): Point2 {
  return swapAxes ? [y, x] : [x, y];
}

function uniquePoints2D(points: Point2[], tolerance: number): Point2[] {
  const cellSize = Math.max(tolerance, 1e-6);
  const seen = new Map<string, Point2>();
  for (const point of points) {
    const key = `${Math.round(point[0] / cellSize)},${Math.round(point[1] / cellSize)}`;
    if (!seen.has(key)) seen.set(key, point);
  }
  return [...seen.values()];
}

function uniqueNumbers(values: number[], tolerance: number): number[] {
  const out: number[] = [];
  for (const value of values) {
    if (!out.some((current) => Math.abs(current - value) <= tolerance)) out.push(value);
  }
  return out;
}

function distance2D(a: Point2, b: Point2): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function loopArea2D(points: Point2[]): number {
  let area = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    area += a[0] * b[1] - a[1] * b[0];
  }
  return area / 2;
}

function totalComponentArea(components: InteriorFillComponent[]): number {
  return components.reduce((sum, component) => sum + component.area, 0);
}

function loopCentroid2D(points: Point2[]): Point2 {
  const signedArea = loopArea2D(points);
  if (Math.abs(signedArea) <= EPS) {
    return [
      points.reduce((sum, point) => sum + point[0], 0) / Math.max(points.length, 1),
      points.reduce((sum, point) => sum + point[1], 0) / Math.max(points.length, 1),
    ];
  }

  let cx = 0;
  let cy = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const cross = a[0] * b[1] - b[0] * a[1];
    cx += (a[0] + b[0]) * cross;
    cy += (a[1] + b[1]) * cross;
  }
  const factor = 1 / (6 * signedArea);
  return [cx * factor, cy * factor];
}
