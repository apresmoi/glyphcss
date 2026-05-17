import { useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import type React from "react";
import type {
  PolyAmbientLight,
  PolyDirectionalLight,
  Polygon,
  TextureTriangle,
  PolyTextureLightingMode,
  Vec2,
  Vec3,
} from "@layoutit/polycss-core";
import { parsePureColor } from "@layoutit/polycss-core";

/** A render strategy tag that can be selectively disabled. */
export type PolyRenderStrategy = "b" | "i" | "u";

export interface PolyRenderStrategiesOption {
  /** Strategies to skip; polygons that would normally use them fall through
   *  the chain (b → i → s, u → i → s, i → s). `<s>` is the universal
   *  fallback and cannot be disabled — textured polys have no other path. */
  disable?: readonly PolyRenderStrategy[];
}

const DEFAULT_TILE = 50;
const DEFAULT_LIGHT_DIR: Vec3 = [0.4, -0.7, 0.59];
const DEFAULT_LIGHT_COLOR = "#ffffff";
const DEFAULT_LIGHT_INTENSITY = 1;
const DEFAULT_AMBIENT_COLOR = "#ffffff";
const DEFAULT_AMBIENT_INTENSITY = 0.4;
const ATLAS_MAX_SIZE = 4096;
const ATLAS_PADDING = 1;
const MIN_ATLAS_SCALE = 0.1;
const MAX_ATLAS_SCALE = 1;
const AUTO_ATLAS_LOW_AREA = ATLAS_MAX_SIZE * ATLAS_MAX_SIZE;
const AUTO_ATLAS_MEDIUM_AREA = AUTO_ATLAS_LOW_AREA * 3;
const AUTO_ATLAS_MAX_BITMAP_SIDE = 2048;
const AUTO_ATLAS_MAX_DECODED_BYTES = 16 * 1024 * 1024;
const AUTO_ATLAS_SCALE_GUARD = 0.995;
const DEFAULT_MATRIX_DECIMALS = 3;
const DEFAULT_BORDER_SHAPE_DECIMALS = 2;
const DEFAULT_ATLAS_CSS_DECIMALS = 4;
const BORDER_SHAPE_CENTER_PERCENT = 50;
const BORDER_SHAPE_POINT_EPS = 1e-7;
const BORDER_SHAPE_CANONICAL_SIZE = 64;
const QUAD_CANONICAL_SIZE = 64;
const SOLID_TRIANGLE_CANONICAL_SIZE = 64;
const PROJECTIVE_QUAD_DENOM_EPS = 0.05;
const PROJECTIVE_QUAD_MAX_WEIGHT_RATIO = 4;
const PROJECTIVE_QUAD_BLEED = 0.6;
const BASIS_EPS = 1e-9;
const SOLID_TRIANGLE_BLEED = 0.75;

export type TextureQuality = number | "auto";

interface RGB { r: number; g: number; b: number; }
interface RGBFactors { r: number; g: number; b: number; }

interface UvAffine {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

interface UvSampleRect {
  minU: number;
  minV: number;
  maxU: number;
  maxV: number;
}

interface TextureTrianglePlan {
  screenPts: number[];
  uvAffine: UvAffine | null;
  uvSampleRect: UvSampleRect | null;
}

interface ProjectiveQuadCoefficients {
  g: number;
  h: number;
  w1: number;
  w3: number;
}

export interface TextureAtlasPlan {
  index: number;
  polygon: Polygon;
  texture?: string;
  tileSize: number;
  layerElevation: number;
  matrix: string;
  canonicalMatrix: string;
  projectiveMatrix: string | null;
  canvasW: number;
  canvasH: number;
  screenPts: number[];
  uvAffine: UvAffine | null;
  uvSampleRect: UvSampleRect | null;
  textureTriangles: TextureTrianglePlan[] | null;
  textureEdgeRepairEdges: Set<number> | null;
  textureEdgeRepair: boolean;
  /** World-space surface normal — stable across light changes, used by dynamic mode. */
  normal: Vec3;
  textureTint: RGBFactors;
  shadedColor: string;
}

export interface PackedTextureAtlasEntry extends TextureAtlasPlan {
  pageIndex: number;
  x: number;
  y: number;
}

export interface TextureAtlasPage {
  width: number;
  height: number;
  url: string | null;
}

interface PackedPage {
  width: number;
  height: number;
  entries: PackedTextureAtlasEntry[];
}

interface PackingShelf {
  x: number;
  y: number;
  height: number;
}

interface PackingPage extends PackedPage {
  shelves: PackingShelf[];
  sealed?: boolean;
}

interface PackedAtlas {
  entries: Array<PackedTextureAtlasEntry | null>;
  pages: PackedPage[];
}

export interface TextureAtlasResult {
  entries: Array<PackedTextureAtlasEntry | null>;
  pages: TextureAtlasPage[];
  ready: boolean;
}

export interface SolidPaintDefaults {
  paintColor?: string;
  dynamicColor?: { r: number; g: number; b: number };
  dynamicColorKey?: string;
}

const TEXTURE_IMAGE_CACHE = new Map<string, Promise<HTMLImageElement>>();
const RECT_EPS = 1e-3;
const TEXTURE_TRIANGLE_BLEED = 0.75;
const TEXTURE_EDGE_REPAIR_ALPHA_MIN = 1;
const TEXTURE_EDGE_REPAIR_SOURCE_ALPHA_MIN = 250;
const TEXTURE_EDGE_REPAIR_RADIUS = 1.5;

function loadTextureImage(url: string): Promise<HTMLImageElement> {
  let p = TEXTURE_IMAGE_CACHE.get(url);
  if (!p) {
    p = new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.decoding = "async";
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`texture load failed: ${url}`));
      img.src = url;
    });
    TEXTURE_IMAGE_CACHE.set(url, p);
    p.then(
      () => {
        if (TEXTURE_IMAGE_CACHE.get(url) === p) TEXTURE_IMAGE_CACHE.delete(url);
      },
      () => {
        if (TEXTURE_IMAGE_CACHE.get(url) === p) TEXTURE_IMAGE_CACHE.delete(url);
      },
    );
  }
  return p;
}

function normalizeAtlasScale(scale: number | string | undefined): number {
  const value = typeof scale === "string" ? Number(scale) : scale;
  if (value === undefined || !Number.isFinite(value)) return 1;
  return Math.min(MAX_ATLAS_SCALE, Math.max(MIN_ATLAS_SCALE, value));
}

function roundDecimal(value: number, decimals: number): string {
  const next = value.toFixed(decimals).replace(/\.?0+$/, "");
  return Object.is(Number(next), -0) ? "0" : next;
}

function formatCssLength(value: number, decimals = DEFAULT_ATLAS_CSS_DECIMALS): string {
  const next = roundDecimal(value, decimals);
  return Number(next) === 0 || Object.is(Number(next), -0) ? "0" : `${next}px`;
}

function formatMatrix3d(matrix: string, decimals = DEFAULT_MATRIX_DECIMALS): string {
  return `matrix3d(${matrix.split(",").map((value) => {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? roundDecimal(parsed, decimals) : value.trim();
  }).join(",")})`;
}

function formatPercent(value: number, decimals = DEFAULT_BORDER_SHAPE_DECIMALS): string {
  const next = roundDecimal(value, decimals);
  return Number(next) === 0 ? "0" : `${next}%`;
}

function pointOnSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): boolean {
  const cross = (px - ax) * (by - ay) - (py - ay) * (bx - ax);
  if (Math.abs(cross) > BORDER_SHAPE_POINT_EPS) return false;
  const dot = (px - ax) * (px - bx) + (py - ay) * (py - by);
  return dot <= BORDER_SHAPE_POINT_EPS;
}

function polygonContainsPoint(
  points: Array<[number, number]>,
  px = BORDER_SHAPE_CENTER_PERCENT,
  py = BORDER_SHAPE_CENTER_PERCENT,
): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    if (pointOnSegment(px, py, xi, yi, xj, yj)) return true;
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function atlasArea(pages: PackedPage[]): number {
  return pages.reduce((sum, page) => sum + page.width * page.height, 0);
}

function autoAtlasScaleCap(pages: PackedPage[]): number {
  const area = atlasArea(pages);
  if (area <= 0) return 1;

  const maxSide = Math.max(
    1,
    ...pages.map((page) => Math.max(page.width, page.height)),
  );
  const sideScale = AUTO_ATLAS_MAX_BITMAP_SIDE / maxSide;
  const memoryScale = Math.sqrt(AUTO_ATLAS_MAX_DECODED_BYTES / (area * 4));

  return normalizeAtlasScale(Math.min(sideScale, memoryScale));
}

function autoAtlasScale(pages: PackedPage[]): number {
  const area = atlasArea(pages);
  let atlasScale = 0.5;
  if (area <= AUTO_ATLAS_LOW_AREA) atlasScale = 1;
  else if (area <= AUTO_ATLAS_MEDIUM_AREA) atlasScale = 0.75;

  return normalizeAtlasScale(Math.min(atlasScale, autoAtlasScaleCap(pages)));
}

function atlasBitmapMaxSide(pages: PackedPage[], atlasScale: number): number {
  return pages.reduce((max, page) => Math.max(
    max,
    Math.ceil(page.width * atlasScale),
    Math.ceil(page.height * atlasScale),
  ), 0);
}

function atlasDecodedBytes(pages: PackedPage[], atlasScale: number): number {
  return pages.reduce((sum, page) =>
    sum +
    Math.ceil(page.width * atlasScale) *
    Math.ceil(page.height * atlasScale) *
    4
  , 0);
}

function autoAtlasBudgetFactor(pages: PackedPage[], atlasScale: number): number {
  const maxSide = atlasBitmapMaxSide(pages, atlasScale);
  const decodedBytes = atlasDecodedBytes(pages, atlasScale);
  const sideFactor = maxSide > AUTO_ATLAS_MAX_BITMAP_SIDE
    ? AUTO_ATLAS_MAX_BITMAP_SIDE / maxSide
    : 1;
  const memoryFactor = decodedBytes > AUTO_ATLAS_MAX_DECODED_BYTES
    ? Math.sqrt(AUTO_ATLAS_MAX_DECODED_BYTES / decodedBytes)
    : 1;
  return Math.min(sideFactor, memoryFactor);
}

function packTextureAtlasPlansAuto(
  plans: Array<TextureAtlasPlan | null>,
  fullScalePacked: PackedAtlas,
): { packed: PackedAtlas; atlasScale: number } {
  let atlasScale = autoAtlasScale(fullScalePacked.pages);
  let packed = atlasScale === 1
    ? fullScalePacked
    : packTextureAtlasPlans(plans, atlasScale);

  // Lower scales increase padding, so verify the final packed bitmap budget.
  for (let i = 0; i < 4; i++) {
    const factor = autoAtlasBudgetFactor(packed.pages, atlasScale);
    if (factor >= 1) break;

    const nextAtlasScale = normalizeAtlasScale(atlasScale * factor * AUTO_ATLAS_SCALE_GUARD);
    if (nextAtlasScale >= atlasScale) break;
    atlasScale = nextAtlasScale;
    packed = packTextureAtlasPlans(plans, atlasScale);
  }

  return { packed, atlasScale };
}

function packTextureAtlasPlansWithScale(
  plans: Array<TextureAtlasPlan | null>,
  textureQualityInput: TextureQuality | undefined,
): { packed: PackedAtlas; atlasScale: number } {
  if (textureQualityInput !== undefined && textureQualityInput !== "auto") {
    const atlasScale = normalizeAtlasScale(textureQualityInput);
    return { packed: packTextureAtlasPlans(plans, atlasScale), atlasScale };
  }

  const fullScalePacked = packTextureAtlasPlans(plans, 1);
  return packTextureAtlasPlansAuto(plans, fullScalePacked);
}

function atlasPadding(atlasScale: number): number {
  return Math.max(ATLAS_PADDING, Math.ceil(ATLAS_PADDING / atlasScale));
}

function setCssTransform(
  ctx: CanvasRenderingContext2D,
  atlasScale: number,
  a = 1,
  b = 0,
  c = 0,
  d = 1,
  e = 0,
  f = 0,
): void {
  ctx.setTransform(
    a * atlasScale,
    b * atlasScale,
    c * atlasScale,
    d * atlasScale,
    e * atlasScale,
    f * atlasScale,
  );
}

function parseHex(hex: string): RGB {
  // Tolerate any CSS color string the renderer hands us — hex, rgb(),
  // or rgba(). Polygon colors arrive from user code and helpers like
  // <TransformControls> use rgba() to fade arrows on hover/drag.
  const parsed = parsePureColor(hex);
  if (!parsed) return { r: 255, g: 255, b: 255 };
  return { r: parsed.rgb[0], g: parsed.rgb[1], b: parsed.rgb[2] };
}

function rgbKey({ r, g, b }: RGB): string {
  return `${r},${g},${b}`;
}

/** Returns the parsed alpha for a color string, defaulting to 1.0
 *  when the color has no explicit alpha (hex, rgb()). */
function parseAlpha(input: string): number {
  return parsePureColor(input)?.alpha ?? 1;
}

function isFullRectSolid(entry: TextureAtlasPlan): boolean {
  if (entry.screenPts.length !== 8) return false;

  const xs: number[] = [];
  const ys: number[] = [];
  const addUnique = (list: number[], value: number): void => {
    for (const existing of list) {
      if (Math.abs(existing - value) <= RECT_EPS) return;
    }
    list.push(value);
  };

  for (let i = 0; i < entry.screenPts.length; i += 2) {
    addUnique(xs, entry.screenPts[i]);
    addUnique(ys, entry.screenPts[i + 1]);
  }
  if (xs.length !== 2 || ys.length !== 2) return false;

  xs.sort((a, b) => a - b);
  ys.sort((a, b) => a - b);
  if (
    Math.abs(xs[0]) > RECT_EPS ||
    Math.abs(ys[0]) > RECT_EPS ||
    xs[1] - xs[0] <= RECT_EPS ||
    ys[1] - ys[0] <= RECT_EPS
  ) {
    return false;
  }

  for (let i = 0; i < entry.screenPts.length; i += 2) {
    const x = entry.screenPts[i];
    const y = entry.screenPts[i + 1];
    const onX = Math.abs(x - xs[0]) <= RECT_EPS || Math.abs(x - xs[1]) <= RECT_EPS;
    const onY = Math.abs(y - ys[0]) <= RECT_EPS || Math.abs(y - ys[1]) <= RECT_EPS;
    if (!onX || !onY) return false;
  }

  return true;
}

export function isSolidTrianglePlan(entry: TextureAtlasPlan): boolean {
  return !entry.texture && entry.polygon.vertices.length === 3;
}

export function isProjectiveQuadPlan(entry: TextureAtlasPlan): entry is TextureAtlasPlan & { projectiveMatrix: string } {
  return !entry.texture && !!entry.projectiveMatrix && !isFullRectSolid(entry);
}

function borderShapeSupported(): boolean {
  const supportsBorderShape = !!globalThis.CSS?.supports?.(
    "border-shape",
    "polygon(0 0, 100% 0, 0 100%) circle(0)",
  );
  if (!supportsBorderShape) return false;

  const media = globalThis.matchMedia;
  if (typeof media !== "function") return true;

  return media("(pointer: fine)").matches && media("(hover: hover)").matches;
}

function incrementCount(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function dominantCountKey(map: Map<string, number>): string | undefined {
  let bestKey: string | undefined;
  let bestCount = 1;
  for (const [key, count] of map) {
    if (count > bestCount) {
      bestKey = key;
      bestCount = count;
    }
  }
  return bestKey;
}

const BRUSH_INLINE_STYLE_ORDER = new Map([
  ["transform", 0],
  ["border-shape", 1],
  ["border-width", 2],
  ["width", 3],
  ["height", 4],
  ["color", 5],
]);

function orderBrushInlineStyle(el: HTMLElement): void {
  const current = el.getAttribute("style");
  if (!current) return;
  const declarations = current.split(";").map((declaration) => declaration.trim()).filter(Boolean);
  const next = declarations
    .map((declaration, index) => {
      const property = declaration.slice(0, declaration.indexOf(":")).trim().toLowerCase();
      return {
        declaration,
        index,
        order: BRUSH_INLINE_STYLE_ORDER.get(property) ?? Number.POSITIVE_INFINITY,
      };
    })
    .sort((a, b) => a.order - b.order || a.index - b.index)
    .map(({ declaration }) => declaration)
    .join(";");
  if (next !== current) el.setAttribute("style", next);
}

export function getSolidPaintDefaults(
  plans: Array<TextureAtlasPlan | null>,
  textureLighting: PolyTextureLightingMode,
): SolidPaintDefaults {
  const paintCounts = new Map<string, number>();
  const dynamicCounts = new Map<string, number>();
  const dynamicColors = new Map<string, RGB>();
  const useBorderShape = textureLighting !== "dynamic" && borderShapeSupported();

  for (const plan of plans) {
    if (!plan || plan.texture) continue;

    if (textureLighting === "dynamic") {
      if (!isSolidTrianglePlan(plan) && !isFullRectSolid(plan)) continue;
      const color = parseHex(plan.polygon.color ?? "#cccccc");
      const key = rgbKey(color);
      incrementCount(dynamicCounts, key);
      if (!dynamicColors.has(key)) dynamicColors.set(key, color);
      continue;
    }

    if (!isSolidTrianglePlan(plan) && !isFullRectSolid(plan) && !useBorderShape) continue;
    incrementCount(paintCounts, plan.shadedColor);
  }

  const paintColor = dominantCountKey(paintCounts);
  const dynamicColorKey = dominantCountKey(dynamicCounts);
  return {
    paintColor,
    dynamicColorKey,
    dynamicColor: dynamicColorKey ? dynamicColors.get(dynamicColorKey) : undefined,
  };
}

function borderShapePointsForPlan(entry: TextureAtlasPlan): Array<[number, number]> {
  const points: Array<[number, number]> = [];
  const width = entry.canvasW || 1;
  const height = entry.canvasH || 1;
  for (let i = 0; i < entry.screenPts.length; i += 2) {
    const x = Math.max(0, Math.min(100, (entry.screenPts[i] / width) * 100));
    const y = Math.max(0, Math.min(100, (entry.screenPts[i + 1] / height) * 100));
    points.push([x, y]);
  }
  return points;
}

function cssBorderShapePoint([x, y]: [number, number]): string {
  return `${formatPercent(x)} ${formatPercent(y)}`;
}

function cssPolygonShapeForPoints(points: Array<[number, number]>): string {
  return `polygon(${points.map(cssBorderShapePoint).join(",")})`;
}

function cssCollapsedInnerShapeForPoints(points: Array<[number, number]>): string {
  if (polygonContainsPoint(points)) return "circle(0)";

  let xSum = 0;
  let ySum = 0;
  const pointCount = Math.max(1, points.length);
  for (const [x, y] of points) {
    xSum += x;
    ySum += y;
  }
  const x = formatPercent(Math.max(0, Math.min(100, xSum / pointCount)));
  const y = formatPercent(Math.max(0, Math.min(100, ySum / pointCount)));
  return `circle(0 at ${x} ${y})`;
}

export function cssBorderShapeForPlan(entry: TextureAtlasPlan): string {
  const points = borderShapePointsForPlan(entry);
  return `${cssPolygonShapeForPoints(points)} ${cssCollapsedInnerShapeForPoints(points)}`;
}

function formatMatrix3dValues(values: readonly number[], decimals = DEFAULT_MATRIX_DECIMALS): string {
  return values.map((value) => roundDecimal(value, decimals)).join(",");
}

function formatScaledMatrixFromPlan(
  entry: TextureAtlasPlan,
  scaleX: number,
  scaleY: number,
): string {
  const values = entry.matrix.split(",").map((value) => Number(value));
  if (values.length !== 16 || values.some((value) => !Number.isFinite(value))) {
    return entry.matrix;
  }
  values[0] *= scaleX;
  values[1] *= scaleX;
  values[2] *= scaleX;
  values[4] *= scaleY;
  values[5] *= scaleY;
  values[6] *= scaleY;
  return formatMatrix3dValues(values);
}

function formatQuadMatrix(entry: TextureAtlasPlan): string {
  return formatScaledMatrixFromPlan(
    entry,
    entry.canvasW / QUAD_CANONICAL_SIZE,
    entry.canvasH / QUAD_CANONICAL_SIZE,
  );
}

function formatBorderShapeMatrix(entry: TextureAtlasPlan): string {
  return formatScaledMatrixFromPlan(
    entry,
    (entry.canvasW || 1) / BORDER_SHAPE_CANONICAL_SIZE,
    (entry.canvasH || 1) / BORDER_SHAPE_CANONICAL_SIZE,
  );
}

function isConvexPolygonPoints(points: Array<[number, number]>): boolean {
  if (points.length < 3) return false;
  let sign = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const c = points[(i + 2) % points.length];
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(cross) <= BASIS_EPS) return false;
    const nextSign = Math.sign(cross);
    if (sign === 0) sign = nextSign;
    else if (nextSign !== sign) return false;
  }
  return true;
}

function signedArea2D(points: Array<[number, number]>): number {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    area += a[0] * b[1] - a[1] * b[0];
  }
  return area / 2;
}

function intersect2DLines(
  a0: [number, number],
  a1: [number, number],
  b0: [number, number],
  b1: [number, number],
): [number, number] | null {
  const rx = a1[0] - a0[0];
  const ry = a1[1] - a0[1];
  const sx = b1[0] - b0[0];
  const sy = b1[1] - b0[1];
  const det = rx * sy - ry * sx;
  if (Math.abs(det) <= BASIS_EPS) return null;

  const qpx = b0[0] - a0[0];
  const qpy = b0[1] - a0[1];
  const t = (qpx * sy - qpy * sx) / det;
  return [a0[0] + t * rx, a0[1] + t * ry];
}

function offsetConvexPolygonPoints(points: number[], amount: number): number[] {
  if (points.length < 6 || points.length % 2 !== 0 || amount <= 0) return points;
  const q: Array<[number, number]> = [];
  for (let i = 0; i < points.length; i += 2) q.push([points[i], points[i + 1]]);
  if (!isConvexPolygonPoints(q)) return expandClipPoints(points, amount);

  const area = signedArea2D(q);
  if (Math.abs(area) <= BASIS_EPS) return expandClipPoints(points, amount);
  const outwardSign = area > 0 ? 1 : -1;
  const offsetLines: Array<{ a: [number, number]; b: [number, number] }> = [];
  for (let i = 0; i < q.length; i++) {
    const a = q[i];
    const b = q[(i + 1) % q.length];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const length = Math.hypot(dx, dy);
    if (length <= BASIS_EPS) return expandClipPoints(points, amount);
    const ox = outwardSign * (dy / length) * amount;
    const oy = outwardSign * (-dx / length) * amount;
    offsetLines.push({
      a: [a[0] + ox, a[1] + oy],
      b: [b[0] + ox, b[1] + oy],
    });
  }

  const expanded: number[] = [];
  const maxMiter = Math.max(2, amount * 4);
  for (let i = 0; i < q.length; i++) {
    const prev = offsetLines[(i + q.length - 1) % q.length];
    const next = offsetLines[i];
    const intersection = intersect2DLines(prev.a, prev.b, next.a, next.b);
    if (!intersection) return expandClipPoints(points, amount);

    const original = q[i];
    const dx = intersection[0] - original[0];
    const dy = intersection[1] - original[1];
    const miter = Math.hypot(dx, dy);
    if (miter > maxMiter) {
      expanded.push(
        original[0] + (dx / miter) * maxMiter,
        original[1] + (dy / miter) * maxMiter,
      );
    } else {
      expanded.push(intersection[0], intersection[1]);
    }
  }
  return expanded;
}

function computeProjectiveQuadCoefficients(
  q: Array<[number, number]>,
): ProjectiveQuadCoefficients | null {
  if (q.length !== 4 || !isConvexPolygonPoints(q)) return null;

  const [q0, q1, q2, q3] = q;
  const sx = q0[0] - q1[0] + q2[0] - q3[0];
  const sy = q0[1] - q1[1] + q2[1] - q3[1];
  const dx1 = q1[0] - q2[0];
  const dx2 = q3[0] - q2[0];
  const dy1 = q1[1] - q2[1];
  const dy2 = q3[1] - q2[1];
  const det = dx1 * dy2 - dy1 * dx2;
  if (Math.abs(det) <= BASIS_EPS) return null;

  const g = (sx * dy2 - sy * dx2) / det;
  const h = (dx1 * sy - dy1 * sx) / det;
  const weights = [1, 1 + g, 1 + g + h, 1 + h];
  if (weights.some((weight) => !Number.isFinite(weight) || weight <= PROJECTIVE_QUAD_DENOM_EPS)) {
    return null;
  }

  const minWeight = Math.min(...weights);
  const maxWeight = Math.max(...weights);
  // Very large homogeneous-weight variation means the rectangle's vanishing
  // line is too close to the primitive. Chrome can then tessellate the leaf
  // visibly wrong; the clipped polygon path is steadier for those quads.
  if (maxWeight / minWeight > PROJECTIVE_QUAD_MAX_WEIGHT_RATIO) return null;

  return {
    g,
    h,
    w1: 1 + g,
    w3: 1 + h,
  };
}

function computeProjectiveQuadMatrix(
  screenPts: number[],
  xAxis: Vec3,
  yAxis: Vec3,
  normal: Vec3,
  tx: number,
  ty: number,
  tz: number,
): string | null {
  if (screenPts.length !== 8) return null;
  const rawQ: Array<[number, number]> = [
    [screenPts[0], screenPts[1]],
    [screenPts[2], screenPts[3]],
    [screenPts[4], screenPts[5]],
    [screenPts[6], screenPts[7]],
  ];
  if (!computeProjectiveQuadCoefficients(rawQ)) return null;

  const expandedPts = offsetConvexPolygonPoints(screenPts, PROJECTIVE_QUAD_BLEED);
  const q: Array<[number, number]> = [
    [expandedPts[0], expandedPts[1]],
    [expandedPts[2], expandedPts[3]],
    [expandedPts[4], expandedPts[5]],
    [expandedPts[6], expandedPts[7]],
  ];
  const coeffs = computeProjectiveQuadCoefficients(q);
  if (!coeffs) return null;
  const { g, h, w1, w3 } = coeffs;
  const [q0, q1, , q3] = q;

  const toCssPoint = ([x, y]: [number, number]): Vec3 => [
    tx + x * xAxis[0] + y * yAxis[0],
    ty + x * xAxis[1] + y * yAxis[1],
    tz + x * xAxis[2] + y * yAxis[2],
  ];
  const p0 = toCssPoint(q0);
  const p1 = toCssPoint(q1);
  const p3 = toCssPoint(q3);
  const xCol: Vec3 = [
    p1[0] * w1 - p0[0],
    p1[1] * w1 - p0[1],
    p1[2] * w1 - p0[2],
  ];
  const yCol: Vec3 = [
    p3[0] * w3 - p0[0],
    p3[1] * w3 - p0[1],
    p3[2] * w3 - p0[2],
  ];
  const sourceSize = QUAD_CANONICAL_SIZE;

  return formatMatrix3dValues([
    xCol[0] / sourceSize, xCol[1] / sourceSize, xCol[2] / sourceSize, g / sourceSize,
    yCol[0] / sourceSize, yCol[1] / sourceSize, yCol[2] / sourceSize, h / sourceSize,
    normal[0], normal[1], normal[2], 0,
    p0[0], p0[1], p0[2], 1,
  ], 6);
}

function cssPoints(vertices: Vec3[], tile: number, elev: number): Vec3[] {
  return vertices.map((v) => [v[1] * tile, v[0] * tile, v[2] * elev]);
}

function pointKey(point: Vec3): string {
  return `${point[0]},${point[1]},${point[2]}`;
}

function edgeKey(a: Vec3, b: Vec3): string {
  const ak = pointKey(a);
  const bk = pointKey(b);
  return ak < bk ? `${ak}|${bk}` : `${bk}|${ak}`;
}

export function buildTextureEdgeRepairSets(polygons: Polygon[]): Array<Set<number> | undefined> {
  const edgeOwners = new Map<string, Array<{ polygon: number; edge: number }>>();
  for (let polygonIndex = 0; polygonIndex < polygons.length; polygonIndex++) {
    const vertices = polygons[polygonIndex].vertices;
    if (!vertices || vertices.length < 3 || !polygons[polygonIndex].texture) continue;
    for (let edgeIndex = 0; edgeIndex < vertices.length; edgeIndex++) {
      const key = edgeKey(vertices[edgeIndex], vertices[(edgeIndex + 1) % vertices.length]);
      const owner = { polygon: polygonIndex, edge: edgeIndex };
      const owners = edgeOwners.get(key);
      if (owners) owners.push(owner);
      else edgeOwners.set(key, [owner]);
    }
  }

  const repairEdges = polygons.map(() => new Set<number>());
  for (const owners of edgeOwners.values()) {
    if (owners.length < 2) continue;
    for (let i = 0; i < owners.length; i++) {
      for (let j = i + 1; j < owners.length; j++) {
        repairEdges[owners[i].polygon].add(owners[i].edge);
        repairEdges[owners[j].polygon].add(owners[j].edge);
      }
    }
  }
  return repairEdges.map((edges) => edges.size > 0 ? edges : undefined);
}

function computeSurfaceNormal(pts: Vec3[]): Vec3 | null {
  if (pts.length < 3) return null;
  const p0 = pts[0];
  const normal: Vec3 = [0, 0, 0];
  for (let i = 1; i + 1 < pts.length; i++) {
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const e1: Vec3 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
    const e2: Vec3 = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
    normal[0] -= e1[1] * e2[2] - e1[2] * e2[1];
    normal[1] -= e1[2] * e2[0] - e1[0] * e2[2];
    normal[2] -= e1[0] * e2[1] - e1[1] * e2[0];
  }
  const len = Math.hypot(normal[0], normal[1], normal[2]);
  if (len <= BASIS_EPS) return null;
  return [normal[0] / len, normal[1] / len, normal[2] / len];
}

function dotVec(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function crossVec(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function solidTriangleStyle(
  entry: TextureAtlasPlan,
  textureLighting: PolyTextureLightingMode,
  pointerEvents: "auto" | "none",
  solidPaintDefaults?: SolidPaintDefaults,
): CSSProperties | null {
  if (!isSolidTrianglePlan(entry)) return null;

  const pts = cssPoints(entry.polygon.vertices, entry.tileSize, entry.layerElevation);
  const normal = computeSurfaceNormal(pts);
  if (!normal) return null;

  const edges = [
    { a: 0, b: 1, c: 2 },
    { a: 1, b: 2, c: 0 },
    { a: 2, b: 0, c: 1 },
  ].map((edge) => {
    const av = pts[edge.a];
    const bv = pts[edge.b];
    return {
      ...edge,
      length: Math.hypot(bv[0] - av[0], bv[1] - av[1], bv[2] - av[2]),
    };
  }).sort((a, b) => b.length - a.length);

  let a = edges[0].a;
  let b = edges[0].b;
  const c = edges[0].c;
  let av = pts[a];
  let bv = pts[b];
  const cv = pts[c];
  let baseLength = edges[0].length;
  if (baseLength <= BASIS_EPS) return null;

  let xAxis: Vec3 = [
    (bv[0] - av[0]) / baseLength,
    (bv[1] - av[1]) / baseLength,
    (bv[2] - av[2]) / baseLength,
  ];
  const ac: Vec3 = [cv[0] - av[0], cv[1] - av[1], cv[2] - av[2]];
  let apexX = dotVec(ac, xAxis);
  let foot: Vec3 = [
    av[0] + xAxis[0] * apexX,
    av[1] + xAxis[1] * apexX,
    av[2] + xAxis[2] * apexX,
  ];
  let yAxisRaw: Vec3 = [
    foot[0] - cv[0],
    foot[1] - cv[1],
    foot[2] - cv[2],
  ];
  const height = Math.hypot(yAxisRaw[0], yAxisRaw[1], yAxisRaw[2]);
  if (height <= BASIS_EPS) return null;
  let yAxis: Vec3 = [
    yAxisRaw[0] / height,
    yAxisRaw[1] / height,
    yAxisRaw[2] / height,
  ];

  if (dotVec(crossVec(xAxis, yAxis), normal) < 0) {
    const nextA = b;
    b = a;
    a = nextA;
    av = pts[a];
    bv = pts[b];
    baseLength = Math.hypot(bv[0] - av[0], bv[1] - av[1], bv[2] - av[2]);
    if (baseLength <= BASIS_EPS) return null;
    xAxis = [
      (bv[0] - av[0]) / baseLength,
      (bv[1] - av[1]) / baseLength,
      (bv[2] - av[2]) / baseLength,
    ];
    const nextAc: Vec3 = [cv[0] - av[0], cv[1] - av[1], cv[2] - av[2]];
    apexX = dotVec(nextAc, xAxis);
    foot = [
      av[0] + xAxis[0] * apexX,
      av[1] + xAxis[1] * apexX,
      av[2] + xAxis[2] * apexX,
    ];
    yAxisRaw = [
      foot[0] - cv[0],
      foot[1] - cv[1],
      foot[2] - cv[2],
    ];
    const nextHeight = Math.hypot(yAxisRaw[0], yAxisRaw[1], yAxisRaw[2]);
    if (nextHeight <= BASIS_EPS) return null;
    yAxis = [
      yAxisRaw[0] / nextHeight,
      yAxisRaw[1] / nextHeight,
      yAxisRaw[2] / nextHeight,
    ];
  }

  const left = Math.max(0, Math.min(baseLength, apexX));
  const right = Math.max(0, baseLength - left);
  const expanded = offsetConvexPolygonPoints([
    left, 0,
    0, height,
    left + right, height,
  ], SOLID_TRIANGLE_BLEED);
  const apex2: Vec2 = [expanded[0], expanded[1]];
  const baseLeft2: Vec2 = [expanded[2], expanded[3]];
  const baseRight2: Vec2 = [expanded[4], expanded[5]];
  const baseY = (baseLeft2[1] + baseRight2[1]) / 2;
  const leftPx = apex2[0] - baseLeft2[0];
  const rightPx = baseRight2[0] - apex2[0];
  const heightPx = baseY - apex2[1];
  if (
    leftPx <= BASIS_EPS ||
    rightPx <= BASIS_EPS ||
    heightPx <= BASIS_EPS ||
    !Number.isFinite(leftPx + rightPx + heightPx)
  ) {
    return null;
  }
  const dynamic = textureLighting === "dynamic";
  const base = parseHex(entry.polygon.color ?? "#cccccc");
  const useDefaultDynamicColor = dynamic && rgbKey(base) === solidPaintDefaults?.dynamicColorKey;
  const sharedStyle = {
    color: dynamic || entry.shadedColor === solidPaintDefaults?.paintColor
      ? undefined
      : entry.shadedColor,
    pointerEvents: pointerEvents === "none" ? "none" as const : undefined,
    ...(dynamic && !useDefaultDynamicColor
      ? {
          ["--pnx" as string]: normal[0].toFixed(4),
          ["--pny" as string]: normal[1].toFixed(4),
          ["--pnz" as string]: normal[2].toFixed(4),
          ["--psr" as string]: (base.r / 255).toFixed(4),
          ["--psg" as string]: (base.g / 255).toFixed(4),
          ["--psb" as string]: (base.b / 255).toFixed(4),
        }
      : dynamic
        ? {
            ["--pnx" as string]: normal[0].toFixed(4),
            ["--pny" as string]: normal[1].toFixed(4),
            ["--pnz" as string]: normal[2].toFixed(4),
          }
        : null),
  };

  const worldPoint = ([x, y]: Vec2): Vec3 => [
    cv[0] + (x - left) * xAxis[0] + y * yAxis[0],
    cv[1] + (x - left) * xAxis[1] + y * yAxis[1],
    cv[2] + (x - left) * xAxis[2] + y * yAxis[2],
  ];
  const apex = worldPoint(apex2);
  const baseLeft = worldPoint([baseLeft2[0], baseY]);
  const baseRight = worldPoint([baseRight2[0], baseY]);
  const xCol: Vec3 = [
    (baseRight[0] - baseLeft[0]) / 2,
    (baseRight[1] - baseLeft[1]) / 2,
    (baseRight[2] - baseLeft[2]) / 2,
  ];
  const txCol: Vec3 = [
    apex[0] - xCol[0],
    apex[1] - xCol[1],
    apex[2] - xCol[2],
  ];
  const yCol: Vec3 = [
    baseLeft[0] - txCol[0],
    baseLeft[1] - txCol[1],
    baseLeft[2] - txCol[2],
  ];
  const sourceSize = SOLID_TRIANGLE_CANONICAL_SIZE;
  const canonicalMatrix = formatMatrix3dValues([
    xCol[0] / sourceSize, xCol[1] / sourceSize, xCol[2] / sourceSize, 0,
    yCol[0] / sourceSize, yCol[1] / sourceSize, yCol[2] / sourceSize, 0,
    normal[0], normal[1], normal[2], 0,
    txCol[0], txCol[1], txCol[2], 1,
  ], 6);
  return {
    transform: `matrix3d(${canonicalMatrix})`,
    ...sharedStyle,
  };
}

function rgbToHex({ r, g, b }: RGB): string {
  const f = (n: number) =>
    Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, "0");
  return `#${f(r)}${f(g)}${f(b)}`;
}

function shadePolygon(
  baseColor: string,
  directScale: number,
  lightColor: string,
  ambientColor: string,
  ambientIntensity: number,
): string {
  const base = parseHex(baseColor);
  const light = parseHex(lightColor);
  const amb = parseHex(ambientColor);
  const tintR = (amb.r / 255) * ambientIntensity + (light.r / 255) * directScale;
  const tintG = (amb.g / 255) * ambientIntensity + (light.g / 255) * directScale;
  const tintB = (amb.b / 255) * ambientIntensity + (light.b / 255) * directScale;
  const r = Math.max(0, Math.min(255, Math.round(base.r * tintR)));
  const g = Math.max(0, Math.min(255, Math.round(base.g * tintG)));
  const b = Math.max(0, Math.min(255, Math.round(base.b * tintB)));
  // Preserve the base polygon's alpha. Lighting only modulates RGB —
  // a translucent input (e.g. <TransformControls> arrow at idle) must
  // keep its alpha so the gizmo stays see-through after shading.
  const alpha = parseAlpha(baseColor);
  return alpha < 1
    ? `rgba(${r}, ${g}, ${b}, ${alpha})`
    : rgbToHex({ r, g, b });
}

function textureTintFactors(
  directScale: number,
  lightColor: string,
  ambientColor: string,
  ambientIntensity: number,
): RGBFactors {
  const light = parseHex(lightColor);
  const amb = parseHex(ambientColor);
  return {
    r: (amb.r / 255) * ambientIntensity + (light.r / 255) * directScale,
    g: (amb.g / 255) * ambientIntensity + (light.g / 255) * directScale,
    b: (amb.b / 255) * ambientIntensity + (light.b / 255) * directScale,
  };
}

function tintToCss({ r, g, b }: RGBFactors): string {
  const f = (n: number) => Math.round(Math.max(0, Math.min(1, n)) * 255);
  return `rgb(${f(r)} ${f(g)} ${f(b)})`;
}

function applyTextureTint(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  tint: RGBFactors,
  atlasScale: number,
): void {
  if (
    Math.abs(tint.r - 1) < 0.001 &&
    Math.abs(tint.g - 1) < 0.001 &&
    Math.abs(tint.b - 1) < 0.001
  ) {
    return;
  }
  ctx.save();
  setCssTransform(ctx, atlasScale);
  ctx.globalCompositeOperation = "multiply";
  ctx.fillStyle = tintToCss(tint);
  ctx.fillRect(x, y, width, height);
  ctx.restore();
}

function drawImageCover(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  width: number,
  height: number,
  atlasScale: number,
): void {
  const srcW = img.naturalWidth || img.width || 1;
  const srcH = img.naturalHeight || img.height || 1;
  const scale = Math.max(width / srcW, height / srcH);
  const drawW = srcW * scale;
  const drawH = srcH * scale;
  setCssTransform(ctx, atlasScale);
  ctx.drawImage(img, x + (width - drawW) / 2, y + (height - drawH) / 2, drawW, drawH);
}

function computeUvAffine(points: Vec2[], uvs: Vec2[]): UvAffine | null {
  if (points.length < 3 || uvs.length < 3) return null;
  const [p0, p1, p2] = points;
  const [uv0, uv1, uv2] = uvs;
  const sx0 = p0[0], sy0 = p0[1];
  const sx1 = p1[0], sy1 = p1[1];
  const sx2 = p2[0], sy2 = p2[1];
  const u0 = uv0[0], V0 = 1 - uv0[1];
  const u1 = uv1[0], V1 = 1 - uv1[1];
  const u2 = uv2[0], V2 = 1 - uv2[1];
  const du1 = u1 - u0, dV1 = V1 - V0;
  const du2 = u2 - u0, dV2 = V2 - V0;
  const det = du1 * dV2 - du2 * dV1;
  if (Math.abs(det) <= 1e-9) return null;

  const dx1 = sx1 - sx0, dx2 = sx2 - sx0;
  const dy1 = sy1 - sy0, dy2 = sy2 - sy0;
  const affine = {
    a: (dx1 * dV2 - dx2 * dV1) / det,
    b: (du1 * dx2 - du2 * dx1) / det,
    c: (dy1 * dV2 - dy2 * dV1) / det,
    d: (du1 * dy2 - du2 * dy1) / det,
    e: 0,
    f: 0,
  };
  affine.e = sx0 - affine.a * u0 - affine.b * V0;
  affine.f = sy0 - affine.c * u0 - affine.d * V0;
  return affine;
}

function computeUvSampleRect(uvs: Vec2[]): UvSampleRect | null {
  if (uvs.length === 0) return null;
  let minU = Infinity;
  let minV = Infinity;
  let maxU = -Infinity;
  let maxV = -Infinity;
  for (const uv of uvs) {
    const u = uv[0];
    const v = 1 - uv[1];
    if (!Number.isFinite(u) || !Number.isFinite(v)) return null;
    minU = Math.min(minU, u);
    maxU = Math.max(maxU, u);
    minV = Math.min(minV, v);
    maxV = Math.max(maxV, v);
  }
  return { minU, minV, maxU, maxV };
}

function projectTextureTriangle(
  triangle: TextureTriangle,
  tile: number,
  elev: number,
  origin: Vec3,
  xAxis: Vec3,
  yAxis: Vec3,
  shiftX: number,
  shiftY: number,
): TextureTrianglePlan | null {
  const points = triangle.vertices.map((vertex): Vec2 => {
    const point: Vec3 = [
      vertex[1] * tile,
      vertex[0] * tile,
      vertex[2] * elev,
    ];
    const dx = point[0] - origin[0];
    const dy = point[1] - origin[1];
    const dz = point[2] - origin[2];
    return [
      dx * xAxis[0] + dy * xAxis[1] + dz * xAxis[2] + shiftX,
      dx * yAxis[0] + dy * yAxis[1] + dz * yAxis[2] + shiftY,
    ];
  });
  const uvAffine = computeUvAffine(points, triangle.uvs);
  const uvSampleRect = computeUvSampleRect(triangle.uvs);
  if (!uvAffine && !uvSampleRect) return null;
  return {
    screenPts: points.flatMap(([x, y]) => [x, y]),
    uvAffine,
    uvSampleRect,
  };
}

function expandClipPoints(points: number[], amount: number): number[] {
  if (points.length < 6 || amount <= 0) return points;
  let cx = 0;
  let cy = 0;
  const count = points.length / 2;
  for (let i = 0; i < points.length; i += 2) {
    cx += points[i];
    cy += points[i + 1];
  }
  cx /= count;
  cy /= count;

  const expanded = points.slice();
  for (let i = 0; i < expanded.length; i += 2) {
    const dx = expanded[i] - cx;
    const dy = expanded[i + 1] - cy;
    const len = Math.hypot(dx, dy);
    if (len <= RECT_EPS) continue;
    expanded[i] += (dx / len) * amount;
    expanded[i + 1] += (dy / len) * amount;
  }
  return expanded;
}

function tracePolygonPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  points: number[],
): void {
  for (let i = 0; i < points.length; i += 2) {
    const px = x + points[i];
    const py = y + points[i + 1];
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

function canvasToUrl(canvas: HTMLCanvasElement): Promise<string | null> {
  if (typeof canvas.toBlob === "function") {
    return new Promise((resolve) => {
      canvas.toBlob((blob) => {
        resolve(blob ? URL.createObjectURL(blob) : null);
      }, "image/png");
    });
  }
  try {
    return Promise.resolve(canvas.toDataURL("image/png"));
  } catch {
    return Promise.resolve(null);
  }
}

function clampSourceCoord(value: number, max: number): number {
  return Math.max(0, Math.min(max, value));
}

function drawImageUvSample(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  rect: UvSampleRect,
  x: number,
  y: number,
  width: number,
  height: number,
  atlasScale: number,
): void {
  const imgW = img.naturalWidth || img.width || 1;
  const imgH = img.naturalHeight || img.height || 1;
  const rawX0 = clampSourceCoord(Math.min(rect.minU, rect.maxU) * imgW, imgW);
  const rawX1 = clampSourceCoord(Math.max(rect.minU, rect.maxU) * imgW, imgW);
  const rawY0 = clampSourceCoord(Math.min(rect.minV, rect.maxV) * imgH, imgH);
  const rawY1 = clampSourceCoord(Math.max(rect.minV, rect.maxV) * imgH, imgH);

  let sx = Math.floor(rawX0);
  let sy = Math.floor(rawY0);
  let sw = Math.ceil(rawX1) - sx;
  let sh = Math.ceil(rawY1) - sy;

  if (sw < 1) {
    sx = Math.floor(clampSourceCoord(((rect.minU + rect.maxU) / 2) * imgW, imgW - 1));
    sw = 1;
  }
  if (sh < 1) {
    sy = Math.floor(clampSourceCoord(((rect.minV + rect.maxV) / 2) * imgH, imgH - 1));
    sh = 1;
  }
  sx = Math.max(0, Math.min(imgW - 1, sx));
  sy = Math.max(0, Math.min(imgH - 1, sy));
  sw = Math.max(1, Math.min(imgW - sx, sw));
  sh = Math.max(1, Math.min(imgH - sy, sh));

  setCssTransform(ctx, atlasScale);
  ctx.drawImage(img, sx, sy, sw, sh, x, y, width, height);
}

function traceOffsetPolygonPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  points: number[],
  offsetX: number,
  offsetY: number,
): void {
  for (let i = 0; i < points.length; i += 2) {
    const px = x + points[i] + offsetX;
    const py = y + points[i + 1] + offsetY;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

function drawTexturedAtlasEntry(
  ctx: CanvasRenderingContext2D,
  entry: PackedTextureAtlasEntry,
  srcImg: HTMLImageElement,
  atlasScale: number,
  offsetX = 0,
  offsetY = 0,
): void {
  if (entry.textureTriangles?.length) {
    const imgW = srcImg.naturalWidth || srcImg.width || 1;
    const imgH = srcImg.naturalHeight || srcImg.height || 1;
    for (const triangle of entry.textureTriangles) {
      const clipPts = expandClipPoints(triangle.screenPts, TEXTURE_TRIANGLE_BLEED);
      ctx.save();
      setCssTransform(ctx, atlasScale);
      ctx.beginPath();
      traceOffsetPolygonPath(ctx, entry.x, entry.y, clipPts, offsetX, offsetY);
      ctx.clip();
      if (triangle.uvAffine) {
        setCssTransform(
          ctx,
          atlasScale,
          triangle.uvAffine.a / imgW, triangle.uvAffine.c / imgW,
          triangle.uvAffine.b / imgH, triangle.uvAffine.d / imgH,
          entry.x + triangle.uvAffine.e + offsetX,
          entry.y + triangle.uvAffine.f + offsetY,
        );
        ctx.drawImage(srcImg, 0, 0);
      } else if (triangle.uvSampleRect) {
        drawImageUvSample(
          ctx,
          srcImg,
          triangle.uvSampleRect,
          entry.x + offsetX,
          entry.y + offsetY,
          entry.canvasW,
          entry.canvasH,
          atlasScale,
        );
      }
      ctx.restore();
    }
  } else if (entry.uvAffine) {
    const imgW = srcImg.naturalWidth || srcImg.width || 1;
    const imgH = srcImg.naturalHeight || srcImg.height || 1;
    setCssTransform(
      ctx,
      atlasScale,
      entry.uvAffine.a / imgW, entry.uvAffine.c / imgW,
      entry.uvAffine.b / imgH, entry.uvAffine.d / imgH,
      entry.x + entry.uvAffine.e + offsetX,
      entry.y + entry.uvAffine.f + offsetY,
    );
    ctx.drawImage(srcImg, 0, 0);
  } else if (entry.uvSampleRect) {
    drawImageUvSample(
      ctx,
      srcImg,
      entry.uvSampleRect,
      entry.x + offsetX,
      entry.y + offsetY,
      entry.canvasW,
      entry.canvasH,
      atlasScale,
    );
  } else {
    drawImageCover(
      ctx,
      srcImg,
      entry.x + offsetX,
      entry.y + offsetY,
      entry.canvasW,
      entry.canvasH,
      atlasScale,
    );
  }
}

function distanceToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq <= BASIS_EPS) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

function distanceToPolygonEdges(
  px: number,
  py: number,
  points: number[],
  edgeIndices: Set<number>,
): number {
  let best = Infinity;
  const count = points.length / 2;
  for (const edgeIndex of edgeIndices) {
    if (edgeIndex < 0 || edgeIndex >= count) continue;
    const i = edgeIndex * 2;
    const next = ((edgeIndex + 1) % count) * 2;
    best = Math.min(
      best,
      distanceToSegment(px, py, points[i], points[i + 1], points[next], points[next + 1]),
    );
  }
  return best;
}

function nearestOpaquePixelOffset(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  radius: number,
): number | null {
  const minX = Math.max(0, x - radius);
  const maxX = Math.min(width - 1, x + radius);
  const minY = Math.max(0, y - radius);
  const maxY = Math.min(height - 1, y + radius);
  let bestOffset: number | null = null;
  let bestDistanceSq = Infinity;
  for (let yy = minY; yy <= maxY; yy++) {
    for (let xx = minX; xx <= maxX; xx++) {
      if (xx === x && yy === y) continue;
      const dx = xx - x;
      const dy = yy - y;
      const distanceSq = dx * dx + dy * dy;
      if (distanceSq > radius * radius || distanceSq >= bestDistanceSq) continue;
      const offset = (yy * width + xx) * 4;
      if (data[offset + 3] < TEXTURE_EDGE_REPAIR_SOURCE_ALPHA_MIN) continue;
      bestOffset = offset;
      bestDistanceSq = distanceSq;
    }
  }
  return bestOffset;
}

function repairTextureEdgeAlpha(
  ctx: CanvasRenderingContext2D,
  entry: PackedTextureAtlasEntry,
  atlasScale: number,
): void {
  if (!entry.textureEdgeRepair || !entry.texture) return;
  if (!entry.textureEdgeRepairEdges || entry.textureEdgeRepairEdges.size === 0) return;
  const canvas = (ctx as CanvasRenderingContext2D & { canvas?: HTMLCanvasElement }).canvas;
  if (!canvas) return;
  const pixelX = Math.max(0, Math.floor(entry.x * atlasScale));
  const pixelY = Math.max(0, Math.floor(entry.y * atlasScale));
  const pixelW = Math.max(1, Math.min(canvas.width - pixelX, Math.ceil(entry.canvasW * atlasScale)));
  const pixelH = Math.max(1, Math.min(canvas.height - pixelY, Math.ceil(entry.canvasH * atlasScale)));
  if (pixelW <= 0 || pixelH <= 0) return;

  let imageData: ImageData;
  try {
    imageData = ctx.getImageData(pixelX, pixelY, pixelW, pixelH);
  } catch {
    return;
  }

  const data = imageData.data;
  const source = new Uint8ClampedArray(data);
  const radius = Math.max(TEXTURE_EDGE_REPAIR_RADIUS, TEXTURE_EDGE_REPAIR_RADIUS / atlasScale);
  const sourceRadius = Math.max(2, Math.ceil(radius * atlasScale) + 1);
  let changed = false;
  for (let y = 0; y < pixelH; y++) {
    for (let x = 0; x < pixelW; x++) {
      const offset = (y * pixelW + x) * 4;
      const alpha = data[offset + 3];
      if (alpha < TEXTURE_EDGE_REPAIR_ALPHA_MIN || alpha === 255) continue;
      const localX = (pixelX + x + 0.5) / atlasScale - entry.x;
      const localY = (pixelY + y + 0.5) / atlasScale - entry.y;
      if (distanceToPolygonEdges(localX, localY, entry.screenPts, entry.textureEdgeRepairEdges) > radius) {
        continue;
      }
      const sourceOffset = nearestOpaquePixelOffset(source, pixelW, pixelH, x, y, sourceRadius);
      if (sourceOffset === null) continue;
      data[offset] = source[sourceOffset];
      data[offset + 1] = source[sourceOffset + 1];
      data[offset + 2] = source[sourceOffset + 2];
      data[offset + 3] = 255;
      changed = true;
    }
  }
  if (!changed) return;
  ctx.putImageData(imageData, pixelX, pixelY);
}

export function computeTextureAtlasPlan(
  polygon: Polygon,
  index: number,
  options: {
    tileSize?: number;
    layerElevation?: number;
    directionalLight?: PolyDirectionalLight;
    ambientLight?: PolyAmbientLight;
    textureEdgeRepairEdges?: Set<number>;
  } = {},
): TextureAtlasPlan | null {
  const { vertices, texture, uvs } = polygon;
  if (!vertices || vertices.length < 3) return null;

  const tile = options.tileSize ?? DEFAULT_TILE;
  const elev = options.layerElevation ?? tile;
  const toCss = (v: Vec3): Vec3 => [
    v[1] * tile,
    v[0] * tile,
    v[2] * elev,
  ];
  const pts = vertices.map(toCss);
  const p0 = pts[0];
  const p1 = pts[1];
  const p2 = pts[2];

  const e1: Vec3 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
  const e2: Vec3 = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
  const l01 = Math.hypot(e1[0], e1[1], e1[2]);
  if (l01 === 0) return null;

  const xAxis: Vec3 = [e1[0] / l01, e1[1] / l01, e1[2] / l01];
  let nx = -(e1[1] * e2[2] - e1[2] * e2[1]);
  let ny = -(e1[2] * e2[0] - e1[0] * e2[2]);
  let nz = -(e1[0] * e2[1] - e1[1] * e2[0]);
  const nLen = Math.hypot(nx, ny, nz);
  if (nLen === 0) return null;
  nx /= nLen; ny /= nLen; nz /= nLen;

  const yAxis: Vec3 = [
    ny * xAxis[2] - nz * xAxis[1],
    nz * xAxis[0] - nx * xAxis[2],
    nx * xAxis[1] - ny * xAxis[0],
  ];

  const local2D = pts.map((p): [number, number] => {
    const dx = p[0] - p0[0], dy = p[1] - p0[1], dz = p[2] - p0[2];
    return [
      dx * xAxis[0] + dy * xAxis[1] + dz * xAxis[2],
      dx * yAxis[0] + dy * yAxis[1] + dz * yAxis[2],
    ];
  });

  let xMin = Infinity, yMin = Infinity, xMax = -Infinity, yMax = -Infinity;
  for (const [x, y] of local2D) {
    if (x < xMin) xMin = x; if (x > xMax) xMax = x;
    if (y < yMin) yMin = y; if (y > yMax) yMax = y;
  }
  const w = xMax - xMin;
  const h = yMax - yMin;
  if (!Number.isFinite(w) || !Number.isFinite(h)) return null;

  const textureEdgeRepairEdges = texture && options.textureEdgeRepairEdges?.size
    ? options.textureEdgeRepairEdges
    : null;
  const textureEdgeRepair = Boolean(texture && textureEdgeRepairEdges);
  const shiftX = -xMin;
  const shiftY = -yMin;

  const screenPts: number[] = [];
  for (let i = 0; i < local2D.length; i++) {
    const [x, y] = local2D[i];
    screenPts.push(x + shiftX, y + shiftY);
  }

  const canvasW = Math.max(1, Math.ceil(w));
  const canvasH = Math.max(1, Math.ceil(h));
  const tx = p0[0] - shiftX * xAxis[0] - shiftY * yAxis[0];
  const ty = p0[1] - shiftX * xAxis[1] - shiftY * yAxis[1];
  const tz = p0[2] - shiftX * xAxis[2] - shiftY * yAxis[2];

  const matrix = [
    xAxis[0], xAxis[1], xAxis[2], 0,
    yAxis[0], yAxis[1], yAxis[2], 0,
    nx, ny, nz, 0,
    tx, ty, tz, 1,
  ].join(",");
  const canonicalMatrix = [
    xAxis[0] * canvasW, xAxis[1] * canvasW, xAxis[2] * canvasW, 0,
    yAxis[0] * canvasH, yAxis[1] * canvasH, yAxis[2] * canvasH, 0,
    nx, ny, nz, 0,
    tx, ty, tz, 1,
  ].join(",");
  const normal: Vec3 = [nx, ny, nz];
  const projectiveMatrix = !texture && vertices.length === 4
    ? computeProjectiveQuadMatrix(screenPts, xAxis, yAxis, normal, tx, ty, tz)
    : null;
  const directionalCfg = options.directionalLight;
  const ambientCfg = options.ambientLight;
  const lightDir = directionalCfg?.direction ?? DEFAULT_LIGHT_DIR;
  const lightColor = directionalCfg?.color ?? DEFAULT_LIGHT_COLOR;
  const lightIntensity = Math.max(0, directionalCfg?.intensity ?? DEFAULT_LIGHT_INTENSITY);
  const ambientColor = ambientCfg?.color ?? DEFAULT_AMBIENT_COLOR;
  const ambientIntensity = Math.max(0, ambientCfg?.intensity ?? DEFAULT_AMBIENT_INTENSITY);
  const lLen = Math.hypot(lightDir[0], lightDir[1], lightDir[2]) || 1;
  const lx = lightDir[0] / lLen, ly = lightDir[1] / lLen, lz = lightDir[2] / lLen;
  // Decoupled: directional and ambient sum independently. No (1 - ambient)
  // budget — matches three.js's lighting model.
  const directScale = lightIntensity * Math.max(0, nx * lx + ny * ly + nz * lz);
  const textureTint = textureTintFactors(directScale, lightColor, ambientColor, ambientIntensity);
  const shadedColor = shadePolygon(polygon.color ?? "#cccccc", directScale, lightColor, ambientColor, ambientIntensity);

  let uvAffine: UvAffine | null = null;
  let uvSampleRect: UvSampleRect | null = null;
  if (texture && uvs && uvs.length >= 3 && uvs.length === vertices.length) {
    uvSampleRect = computeUvSampleRect(uvs);
    uvAffine = computeUvAffine(
      local2D.map(([x, y]) => [x + shiftX, y + shiftY]),
      uvs,
    );
  }
  const textureTriangles = texture && polygon.textureTriangles?.length
    ? polygon.textureTriangles
        .map((triangle) =>
          projectTextureTriangle(triangle, tile, elev, p0, xAxis, yAxis, shiftX, shiftY)
        )
        .filter((triangle): triangle is TextureTrianglePlan => !!triangle)
    : null;

  return {
    index,
    polygon,
    texture,
    tileSize: tile,
    layerElevation: elev,
    matrix,
    canonicalMatrix,
    projectiveMatrix,
    canvasW,
    canvasH,
    screenPts,
    uvAffine,
    uvSampleRect,
    textureTriangles,
    textureEdgeRepairEdges,
    textureEdgeRepair,
    normal,
    textureTint,
    shadedColor,
  };
}

function packTextureAtlasPlans(
  plans: Array<TextureAtlasPlan | null>,
  atlasScale = 1,
): PackedAtlas {
  const entries: Array<PackedTextureAtlasEntry | null> = Array(plans.length).fill(null);
  const pages: PackingPage[] = [];
  const padding = atlasPadding(atlasScale);
  const sortedPlans = plans
    .filter((plan): plan is TextureAtlasPlan => !!plan)
    .sort((a, b) =>
      b.canvasH - a.canvasH ||
      b.canvasW - a.canvasW ||
      a.index - b.index
    );

  const createPage = (): PackingPage => ({
    width: padding,
    height: padding,
    entries: [],
    shelves: [],
  });

  const placeOnPage = (
    page: PackingPage,
    plan: TextureAtlasPlan,
    pageIndex: number,
  ): PackedTextureAtlasEntry | null => {
    if (page.sealed) return null;
    for (const shelf of page.shelves) {
      if (
        plan.canvasH <= shelf.height &&
        shelf.x + plan.canvasW + padding <= ATLAS_MAX_SIZE
      ) {
        const entry = { ...plan, pageIndex, x: shelf.x, y: shelf.y };
        shelf.x += plan.canvasW + padding;
        page.entries.push(entry);
        page.width = Math.max(page.width, entry.x + plan.canvasW + padding);
        return entry;
      }
    }

    const shelfY = page.shelves.length === 0 ? padding : page.height;
    if (shelfY + plan.canvasH + padding > ATLAS_MAX_SIZE) return null;

    const entry = { ...plan, pageIndex, x: padding, y: shelfY };
    page.shelves.push({
      x: padding + plan.canvasW + padding,
      y: shelfY,
      height: plan.canvasH,
    });
    page.entries.push(entry);
    page.width = Math.max(page.width, entry.x + plan.canvasW + padding);
    page.height = Math.max(page.height, shelfY + plan.canvasH + padding);
    return entry;
  };

  for (const plan of sortedPlans) {
    const tooLarge =
      plan.canvasW + padding * 2 > ATLAS_MAX_SIZE ||
      plan.canvasH + padding * 2 > ATLAS_MAX_SIZE;

    if (tooLarge) {
      const pageIndex = pages.length;
      const entry = {
        ...plan,
        pageIndex,
        x: padding,
        y: padding,
      };
      entries[plan.index] = entry;
      pages.push({
        width: plan.canvasW + padding * 2,
        height: plan.canvasH + padding * 2,
        entries: [entry],
        shelves: [],
        sealed: true,
      });
      continue;
    }

    let placed: PackedTextureAtlasEntry | null = null;
    for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
      placed = placeOnPage(pages[pageIndex], plan, pageIndex);
      if (placed) break;
    }
    if (!placed) {
      const page = createPage();
      const pageIndex = pages.length;
      pages.push(page);
      placed = placeOnPage(page, plan, pageIndex);
    }
    if (placed) entries[plan.index] = placed;
  }

  return {
    entries,
    pages: pages.map(({ width, height, entries }) => ({ width, height, entries })),
  };
}

async function buildAtlasPage(
  page: PackedPage,
  textureLighting: PolyTextureLightingMode,
  doc: Document,
  atlasScale: number,
): Promise<TextureAtlasPage> {
  const canvas = doc.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(page.width * atlasScale));
  canvas.height = Math.max(1, Math.ceil(page.height * atlasScale));
  const needsReadback = page.entries.some((entry) =>
    entry.textureEdgeRepair &&
    entry.texture &&
    entry.textureEdgeRepairEdges &&
    entry.textureEdgeRepairEdges.size > 0
  );
  const ctx = canvas.getContext("2d", needsReadback ? { willReadFrequently: true } : undefined);
  if (!ctx) return { width: page.width, height: page.height, url: null };

  const uniqueTextures = Array.from(new Set(
    page.entries.flatMap((entry) => entry.texture ? [entry.texture] : []),
  ));
  const loaded = new Map<string, HTMLImageElement>();
  await Promise.all(uniqueTextures.map(async (url) => {
    loaded.set(url, await loadTextureImage(url));
  }));

  for (const entry of page.entries) {
    const srcImg = entry.texture ? loaded.get(entry.texture) : null;
    if (!entry.texture) {
      ctx.save();
      setCssTransform(ctx, atlasScale);
      ctx.beginPath();
      tracePolygonPath(ctx, entry.x, entry.y, entry.screenPts);
      ctx.clip();
      // Dynamic mode multiplies the tint at render time via
      // background-blend-mode, so the atlas keeps the polygon's unshaded
      // base color. Baked bakes the JS-computed shadedColor.
      ctx.fillStyle = textureLighting === "dynamic"
        ? (entry.polygon.color ?? "#cccccc")
        : entry.shadedColor;
      ctx.fillRect(entry.x, entry.y, entry.canvasW, entry.canvasH);
      ctx.restore();
      continue;
    }

    if (srcImg) {
      ctx.save();
      setCssTransform(ctx, atlasScale);
      ctx.beginPath();
      tracePolygonPath(ctx, entry.x, entry.y, entry.screenPts);
      ctx.clip();
      drawTexturedAtlasEntry(ctx, entry, srcImg, atlasScale);
      ctx.restore();
    }
    if (entry.texture && textureLighting === "baked") {
      ctx.save();
      setCssTransform(ctx, atlasScale);
      ctx.beginPath();
      tracePolygonPath(ctx, entry.x, entry.y, entry.screenPts);
      ctx.clip();
      applyTextureTint(ctx, entry.x, entry.y, entry.canvasW, entry.canvasH, entry.textureTint, atlasScale);
      ctx.restore();
    }
    repairTextureEdgeAlpha(ctx, entry, atlasScale);
  }

  const url = await canvasToUrl(canvas);
  canvas.width = 1;
  canvas.height = 1;

  return {
    width: page.width,
    height: page.height,
    url,
  };
}

async function buildAtlasPages(
  pages: PackedPage[],
  textureLighting: PolyTextureLightingMode,
  doc: Document,
  atlasScale: number,
  isCancelled: () => boolean,
): Promise<TextureAtlasPage[]> {
  const built: TextureAtlasPage[] = [];
  for (const page of pages) {
    if (isCancelled()) break;
    built.push(await buildAtlasPage(page, textureLighting, doc, atlasScale));
  }
  return built;
}

export function useTextureAtlas(
  plans: Array<TextureAtlasPlan | null>,
  textureLighting: PolyTextureLightingMode,
  textureQualityInput?: TextureQuality,
  strategies?: PolyRenderStrategiesOption,
): TextureAtlasResult {
  const disableB = strategies?.disable?.includes("b") ?? false;
  const disableI = strategies?.disable?.includes("i") ?? false;
  const disableU = strategies?.disable?.includes("u") ?? false;
  const useFullRectSolid = !disableB;
  const useProjectiveQuad = useFullRectSolid;
  const useStableTriangle = !disableU;
  const useBorderShape = !disableI && textureLighting !== "dynamic" && borderShapeSupported();
  const atlasPlans = useMemo(
    () => plans.map((plan) => {
      if (!plan) return plan;
      if (plan.texture) return plan;
      // Exclude solid triangles from atlas only when <u> is active.
      // When u is disabled they fall to <i> (if border-shape supported) or <s>.
      if (useStableTriangle && isSolidTrianglePlan(plan)) return null;
      // Exclude full-rect solids (<b> path) and border-shape eligible polys (<i> path).
      const fullRect = isFullRectSolid(plan);
      if (
        (useFullRectSolid && fullRect) ||
        (useProjectiveQuad && isProjectiveQuadPlan(plan)) ||
        (textureLighting !== "dynamic" && useBorderShape && (!fullRect || disableB))
      ) return null;
      return plan;
    }),
    [plans, textureLighting, useFullRectSolid, useProjectiveQuad, useStableTriangle, useBorderShape],
  );
  const { packed, atlasScale } = useMemo(
    () => packTextureAtlasPlansWithScale(atlasPlans, textureQualityInput),
    [atlasPlans, textureQualityInput],
  );
  const [pages, setPages] = useState<TextureAtlasPage[]>(
    () => packed.pages.map((page) => ({ width: page.width, height: page.height, url: null })),
  );

  useEffect(() => {
    let cancelled = false;
    let urls: string[] = [];
    setPages(packed.pages.map((page) => ({ width: page.width, height: page.height, url: null })));

    if (packed.pages.length === 0 || typeof document === "undefined") {
      return () => {};
    }

    buildAtlasPages(packed.pages, textureLighting, document, atlasScale, () => cancelled)
      .then((nextPages) => {
        if (cancelled) {
          for (const page of nextPages) {
            if (page.url?.startsWith("blob:")) URL.revokeObjectURL(page.url);
          }
          return;
        }
        urls = nextPages.flatMap((page) => page.url?.startsWith("blob:") ? [page.url] : []);
        setPages(nextPages);
      })
      .catch(() => {
        if (!cancelled) {
          setPages(packed.pages.map((page) => ({ width: page.width, height: page.height, url: null })));
        }
      });

    return () => {
      cancelled = true;
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, [packed, textureLighting, atlasScale]);

  return {
    entries: packed.entries,
    pages,
    ready: pages.length === 0 || pages.every((page) => !!page.url),
  };
}

export function TextureBorderShapePoly({
  entry,
  solidPaintDefaults,
  className,
  style: styleProp,
  domAttrs,
  domEventHandlers,
  pointerEvents = "auto",
  disabledStrategies,
}: {
  entry: TextureAtlasPlan;
  solidPaintDefaults?: SolidPaintDefaults;
  className?: string;
  style?: CSSProperties;
  domAttrs?: Record<string, unknown>;
  domEventHandlers?: React.DOMAttributes<Element>;
  pointerEvents?: "auto" | "none";
  disabledStrategies?: ReadonlySet<string>;
}) {
  const fullRect = isFullRectSolid(entry);
  // When <b> is disabled but <i> is available (border-shape supported), render
  // the full-rect poly as <i> instead. The `disabledStrategies` set is only
  // populated when strategies.disable was explicitly set by the caller.
  const bDisabled = disabledStrategies?.has("b") ?? false;
  const useIForFullRect = bDisabled && borderShapeSupported();
  const borderShape = (!fullRect || useIForFullRect) ? cssBorderShapeForPlan(entry) : null;
  const useDefaultPaint = entry.shadedColor === solidPaintDefaults?.paintColor;
  const setElementRef = useCallback((el: HTMLElement | null) => {
    if (!el) return;
    if (borderShape) el.style.setProperty("border-shape", borderShape);
    else el.style.removeProperty("border-shape");
    orderBrushInlineStyle(el);
  }, [borderShape]);
  const transform = formatMatrix3d(borderShape ? formatBorderShapeMatrix(entry) : formatQuadMatrix(entry));
  const style: CSSProperties = fullRect
    ? {
        transform,
        color: useDefaultPaint ? undefined : entry.shadedColor,
        pointerEvents: pointerEvents === "none" ? "none" : undefined,
        ...styleProp,
      }
    : {
        transform,
        color: useDefaultPaint ? undefined : entry.shadedColor,
        pointerEvents: pointerEvents === "none" ? "none" : undefined,
        ...styleProp,
      };

  const dataAttrs = entry.polygon.data
    ? Object.fromEntries(
        Object.entries(entry.polygon.data).map(([k, v]) => [`data-${k}`, String(v)]),
      )
    : {};
  const elementClassName = className?.trim() || undefined;

  if (fullRect && !useIForFullRect) {
    return (
      <b
        className={elementClassName}
        style={style}
        {...domEventHandlers}
        {...dataAttrs}
        {...domAttrs}
      />
    );
  }

  return (
    <i
      ref={setElementRef}
      className={elementClassName}
      style={style}
      {...domEventHandlers}
      {...dataAttrs}
      {...domAttrs}
    />
  );
}

export function TextureProjectiveSolidPoly({
  entry,
  textureLighting,
  solidPaintDefaults,
  className,
  style: styleProp,
  domAttrs,
  domEventHandlers,
  pointerEvents = "auto",
}: {
  entry: TextureAtlasPlan & { projectiveMatrix: string };
  textureLighting: PolyTextureLightingMode;
  solidPaintDefaults?: SolidPaintDefaults;
  className?: string;
  style?: CSSProperties;
  domAttrs?: Record<string, unknown>;
  domEventHandlers?: React.DOMAttributes<Element>;
  pointerEvents?: "auto" | "none";
}) {
  const dynamic = textureLighting === "dynamic";
  const base = parseHex(entry.polygon.color ?? "#cccccc");
  const useDefaultDynamicColor = dynamic && rgbKey(base) === solidPaintDefaults?.dynamicColorKey;
  const style: CSSProperties = {
    transform: formatMatrix3d(entry.projectiveMatrix, 6),
    color: dynamic || entry.shadedColor === solidPaintDefaults?.paintColor
      ? undefined
      : entry.shadedColor,
    pointerEvents: pointerEvents === "none" ? "none" : undefined,
    ...(dynamic && !useDefaultDynamicColor
      ? {
          ["--pnx" as string]: entry.normal[0].toFixed(4),
          ["--pny" as string]: entry.normal[1].toFixed(4),
          ["--pnz" as string]: entry.normal[2].toFixed(4),
          ["--psr" as string]: (base.r / 255).toFixed(4),
          ["--psg" as string]: (base.g / 255).toFixed(4),
          ["--psb" as string]: (base.b / 255).toFixed(4),
        }
      : dynamic
        ? {
            ["--pnx" as string]: entry.normal[0].toFixed(4),
            ["--pny" as string]: entry.normal[1].toFixed(4),
            ["--pnz" as string]: entry.normal[2].toFixed(4),
          }
        : null),
    ...styleProp,
  };

  const dataAttrs = entry.polygon.data
    ? Object.fromEntries(
        Object.entries(entry.polygon.data).map(([k, v]) => [`data-${k}`, String(v)]),
      )
    : {};
  const elementClassName = className?.trim() || undefined;

  return (
    <b
      className={elementClassName}
      style={style}
      {...domEventHandlers}
      {...dataAttrs}
      {...domAttrs}
    />
  );
}

export function TextureTrianglePoly({
  entry,
  textureLighting,
  solidPaintDefaults,
  className,
  style: styleProp,
  domAttrs,
  domEventHandlers,
  pointerEvents = "auto",
}: {
  entry: TextureAtlasPlan;
  textureLighting: PolyTextureLightingMode;
  solidPaintDefaults?: SolidPaintDefaults;
  className?: string;
  style?: CSSProperties;
  domAttrs?: Record<string, unknown>;
  domEventHandlers?: React.DOMAttributes<Element>;
  pointerEvents?: "auto" | "none";
}) {
  const triangleStyle = solidTriangleStyle(entry, textureLighting, pointerEvents, solidPaintDefaults);
  if (!triangleStyle) return null;

  const dataAttrs = entry.polygon.data
    ? Object.fromEntries(
        Object.entries(entry.polygon.data).map(([k, v]) => [`data-${k}`, String(v)]),
      )
    : {};
  const elementClassName = className?.trim() || undefined;

  return (
    <u
      className={elementClassName}
      style={{ ...triangleStyle, ...styleProp }}
      {...domEventHandlers}
      {...dataAttrs}
      {...domAttrs}
    />
  );
}

export function TextureAtlasPoly({
  entry,
  page,
  textureLighting,
  className,
  style: styleProp,
  domAttrs,
  domEventHandlers,
  pointerEvents = "auto",
}: {
  entry: PackedTextureAtlasEntry;
  page: TextureAtlasPage | undefined;
  textureLighting: PolyTextureLightingMode;
  className?: string;
  style?: CSSProperties;
  domAttrs?: Record<string, unknown>;
  domEventHandlers?: React.DOMAttributes<Element>;
  pointerEvents?: "auto" | "none";
}) {
  const dynamic = textureLighting === "dynamic";
  const atlasWidth = entry.canvasW || 1;
  const atlasHeight = entry.canvasH || 1;
  const atlasPosition = page
    ? `${formatCssLength(-entry.x / atlasWidth)} ${formatCssLength(-entry.y / atlasHeight)}`
    : undefined;
  const atlasSize = page
    ? `${formatCssLength(page.width / atlasWidth)} ${formatCssLength(page.height / atlasHeight)}`
    : undefined;

  // Dynamic mode: emit ONLY the per-polygon surface normal vars + the
  // alpha mask inline. The calc-driven background-color + blend-mode
  // multiply live in the global stylesheet's
  // `.polycss-scene[data-polycss-lighting="dynamic"] s { ... }` rule, so
  // each <s>'s style stays tiny (~50 chars instead of ~600 — ~12× smaller
  // payload on big meshes). The mask still has to be inline because each
  // polygon has its own atlas position/size.
  const dynamicMask = dynamic && page?.url ? `url(${page.url})` : undefined;
  const background = !dynamic && page?.url
    ? `url(${page.url}) ${atlasPosition} / ${atlasSize} no-repeat`
    : undefined;

  const style: CSSProperties = {
    transform: formatMatrix3d(entry.canonicalMatrix),
    background,
    backgroundImage: dynamic && page?.url ? `url(${page.url})` : undefined,
    backgroundPosition: dynamic ? atlasPosition : undefined,
    backgroundSize: dynamic ? atlasSize : undefined,
    ...(dynamic
      ? {
          ["--pnx" as string]: entry.normal[0].toFixed(4),
          ["--pny" as string]: entry.normal[1].toFixed(4),
          ["--pnz" as string]: entry.normal[2].toFixed(4),
        }
      : null),
    ...(dynamic && dynamicMask
      ? {
          // Use the atlas as an alpha mask so transparent regions outside
          // the polygon don't get painted with the tint.
          maskImage: dynamicMask,
          maskMode: "alpha" as const,
          maskPosition: atlasPosition,
          maskSize: atlasSize,
          maskRepeat: "no-repeat" as const,
          WebkitMaskImage: dynamicMask,
          WebkitMaskPosition: atlasPosition,
          WebkitMaskSize: atlasSize,
          WebkitMaskRepeat: "no-repeat" as const,
        }
      : null),
    opacity: page?.url ? undefined : 0,
    pointerEvents: pointerEvents === "none" ? "none" : undefined,
    ...styleProp,
  };

  const dataAttrs = entry.polygon.data
    ? Object.fromEntries(
        Object.entries(entry.polygon.data).map(([k, v]) => [`data-${k}`, String(v)]),
      )
    : {};
  const elementClassName = className?.trim() || undefined;

  return (
    <s
      className={elementClassName}
      style={style}
      {...domEventHandlers}
      {...dataAttrs}
      {...domAttrs}
    />
  );
}
