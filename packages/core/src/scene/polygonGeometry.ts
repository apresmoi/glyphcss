/**
 * Polygon geometry helpers — pure math operating on Polygon vertices.
 *
 * After cube removal in Phase 2, this module carries small polygon-level
 * helpers for downstream consumers (lighting, debug metrics, etc.). The
 * cube / ramp / wedge / spike face emitters lived here in voxcss; they're gone.
 */
import type { Polygon, Vec2, Vec3 } from "../types";

export interface PolygonFace {
  /** Vertices in CCW-from-outside order. Same as Polygon.vertices. */
  v: Vec3[];
  /** Original polygon's color, if any (for lighting helpers). */
  color?: string;
}

export interface TexturePaintMetricsOptions {
  /** CSS pixels per world X/Y unit. Matches renderer default. */
  tileSize?: number;
  /** CSS pixels per world Z unit. Defaults to tileSize. */
  layerElevation?: number;
  /** When true, skip untextured polygons. Defaults to true. */
  texturedOnly?: boolean;
}

export interface TexturePaintMetrics {
  /** Input polygon count before filtering. */
  totalPolygons: number;
  /** Polygons included in the metric after filtering and degeneracy checks. */
  measuredPolygons: number;
  /** Included polygons with a texture URL. */
  texturedPolygons: number;
  /** Sum of rectangular element areas in CSS px^2. */
  elementArea: number;
  /** Sum of projected polygon areas in CSS px^2. */
  polygonArea: number;
  /** elementArea - polygonArea, clamped at 0. */
  transparentArea: number;
  /** transparentArea / elementArea. */
  transparentRatio: number;
  /** elementArea / polygonArea. */
  overdrawRatio: number;
  /** Highest per-polygon transparentRatio. */
  worstTransparentRatio: number;
}

const METRIC_EPS = 1e-9;

/**
 * Surface a polygon as a single face. The returned array always has length 1;
 * the indirection exists so callers that historically iterated faces (e.g.
 * the manifold check, the canvas validator) can keep their loop shape.
 *
 * Returns an empty array for degenerate polygons (< 3 vertices).
 */
export function polygonFaces(p: Polygon): PolygonFace[] {
  if (!p.vertices || p.vertices.length < 3) return [];
  return [{
    v: p.vertices.map((vert) => [vert[0], vert[1], vert[2]] as Vec3),
    color: p.color,
  }];
}

function computeNormal(pts: Vec3[]): Vec3 | null {
  const p0 = pts[0];
  const p1 = pts[1];
  const p2 = pts[2];
  const e1: Vec3 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
  const e2: Vec3 = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
  const nx = e1[1] * e2[2] - e1[2] * e2[1];
  const ny = e1[2] * e2[0] - e1[0] * e2[2];
  const nz = e1[0] * e2[1] - e1[1] * e2[0];
  const len = Math.hypot(nx, ny, nz);
  if (len <= METRIC_EPS) return null;
  return [nx / len, ny / len, nz / len];
}

function polygonArea2D(points: Vec2[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
}

function projectToTightestElementBox(
  vertices: Vec3[],
  tileSize: number,
  layerElevation: number,
): { elementArea: number; polygonArea: number } | null {
  if (!vertices || vertices.length < 3) return null;
  const cssPts: Vec3[] = vertices.map((v) => [
    v[1] * tileSize,
    v[0] * tileSize,
    v[2] * layerElevation,
  ]);
  const normal = computeNormal(cssPts);
  if (!normal) return null;

  let bestElementArea = Infinity;
  let bestPolygonArea = 0;

  for (let i = 0; i < cssPts.length; i++) {
    const origin = cssPts[i];
    const next = cssPts[(i + 1) % cssPts.length];
    const rawX: Vec3 = [
      next[0] - origin[0],
      next[1] - origin[1],
      next[2] - origin[2],
    ];
    const dot = rawX[0] * normal[0] + rawX[1] * normal[1] + rawX[2] * normal[2];
    const planeX: Vec3 = [
      rawX[0] - dot * normal[0],
      rawX[1] - dot * normal[1],
      rawX[2] - dot * normal[2],
    ];
    const xLen = Math.hypot(planeX[0], planeX[1], planeX[2]);
    if (xLen <= METRIC_EPS) continue;
    const xAxis: Vec3 = [planeX[0] / xLen, planeX[1] / xLen, planeX[2] / xLen];
    const rawY: Vec3 = [
      normal[1] * xAxis[2] - normal[2] * xAxis[1],
      normal[2] * xAxis[0] - normal[0] * xAxis[2],
      normal[0] * xAxis[1] - normal[1] * xAxis[0],
    ];
    const yLen = Math.hypot(rawY[0], rawY[1], rawY[2]);
    if (yLen <= METRIC_EPS) continue;
    const yAxis: Vec3 = [rawY[0] / yLen, rawY[1] / yLen, rawY[2] / yLen];

    const local = cssPts.map((p): Vec2 => {
      const dx = p[0] - origin[0];
      const dy = p[1] - origin[1];
      const dz = p[2] - origin[2];
      return [
        dx * xAxis[0] + dy * xAxis[1] + dz * xAxis[2],
        dx * yAxis[0] + dy * yAxis[1] + dz * yAxis[2],
      ];
    });

    let xMin = Infinity;
    let yMin = Infinity;
    let xMax = -Infinity;
    let yMax = -Infinity;
    for (const [x, y] of local) {
      xMin = Math.min(xMin, x);
      yMin = Math.min(yMin, y);
      xMax = Math.max(xMax, x);
      yMax = Math.max(yMax, y);
    }

    const width = xMax - xMin;
    const height = yMax - yMin;
    const elementArea = Math.max(1, Math.ceil(width)) * Math.max(1, Math.ceil(height));
    const polygonArea = polygonArea2D(local);
    if (polygonArea <= METRIC_EPS) continue;
    if (elementArea < bestElementArea) {
      bestElementArea = elementArea;
      bestPolygonArea = polygonArea;
    }
  }

  if (!Number.isFinite(bestElementArea) || bestPolygonArea <= METRIC_EPS) return null;
  return { elementArea: bestElementArea, polygonArea: bestPolygonArea };
}

export function computeTexturePaintMetrics(
  polygons: Polygon[],
  options: TexturePaintMetricsOptions = {},
): TexturePaintMetrics {
  const tileSize = options.tileSize ?? 100;
  const layerElevation = options.layerElevation ?? tileSize;
  const texturedOnly = options.texturedOnly ?? true;

  let measuredPolygons = 0;
  let texturedPolygons = 0;
  let elementArea = 0;
  let polygonArea = 0;
  let worstTransparentRatio = 0;

  for (const polygon of polygons) {
    const isTextured = Boolean(polygon.texture);
    if (texturedOnly && !isTextured) continue;

    const projected = projectToTightestElementBox(polygon.vertices, tileSize, layerElevation);
    if (!projected) continue;

    measuredPolygons += 1;
    if (isTextured) texturedPolygons += 1;
    elementArea += projected.elementArea;
    polygonArea += projected.polygonArea;
    worstTransparentRatio = Math.max(
      worstTransparentRatio,
      Math.max(0, projected.elementArea - projected.polygonArea) / projected.elementArea,
    );
  }

  const transparentArea = Math.max(0, elementArea - polygonArea);
  return {
    totalPolygons: polygons.length,
    measuredPolygons,
    texturedPolygons,
    elementArea,
    polygonArea,
    transparentArea,
    transparentRatio: elementArea > 0 ? transparentArea / elementArea : 0,
    overdrawRatio: polygonArea > 0 ? elementArea / polygonArea : 0,
    worstTransparentRatio,
  };
}
