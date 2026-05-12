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

export type AtlasScale = number | "auto";

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

interface TextureAtlasPlan {
  index: number;
  polygon: Polygon;
  texture?: string;
  tileSize: number;
  layerElevation: number;
  matrix: string;
  canvasW: number;
  canvasH: number;
  screenPts: number[];
  uvAffine: UvAffine | null;
  uvSampleRect: UvSampleRect | null;
  textureTriangles: TextureTrianglePlan[] | null;
  seamEdges: Set<number> | null;
  /** World-space surface normal — stable across light changes, used by dynamic mode. */
  normal: Vec3;
  textureTint: RGBFactors;
  shadedColor: string;
}

interface TextureTrianglePlan {
  screenPts: number[];
  uvAffine: UvAffine | null;
  uvSampleRect: UvSampleRect | null;
}

interface PackedTextureAtlasEntry extends TextureAtlasPlan {
  pageIndex: number;
  x: number;
  y: number;
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

interface SolidTrianglePlan {
  index: number;
  polygon: Polygon;
  styleText: string;
}

export interface SolidPaintDefaults {
  paintColor?: string;
  dynamicColor?: { r: number; g: number; b: number };
  dynamicColorKey?: string;
}

interface TextureAtlasPage {
  width: number;
  height: number;
  url: string | null;
}

interface RectBrush {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface LocalBasis {
  xAxis: Vec3;
  yAxis: Vec3;
  local2D: Vec2[];
  shiftX: number;
  shiftY: number;
  canvasW: number;
  canvasH: number;
  pixelArea: number;
  rawArea: number;
}

interface BasisOptions {
  optimize: boolean;
  fixedXAxis?: Vec3;
  boundsOrigin?: Vec3;
  snapBounds?: boolean;
  seamEdges?: Set<number>;
}

interface BasisHint {
  xAxis?: Vec3;
  boundsOrigin?: Vec3;
  seamEdges: Set<number>;
}

interface PolygonBasisInfo {
  pts: Vec3[];
  normal: Vec3;
  planeD: number;
  optimizable: boolean;
}

export interface RenderTextureAtlasOptions {
  doc?: Document;
  tileSize?: number;
  layerElevation?: number;
  directionalLight?: PolyDirectionalLight;
  ambientLight?: PolyAmbientLight;
  textureLighting?: PolyTextureLightingMode;
  /**
   * Raster scale for generated atlas pages. `1` keeps one bitmap pixel per CSS
   * pixel; lower values reduce atlas memory and encode cost at lower texture
   * detail. Numeric values are clamped to 0.1..1. Omitted / `"auto"` picks
   * 1 / 0.75 / 0.5 from packed atlas area, then caps oversized runtime
   * bitmaps by side length and decoded-memory budget.
   */
  atlasScale?: AtlasScale;
  solidPaintDefaults?: SolidPaintDefaults;
}

export interface RenderedPoly {
  polygonIndex: number;
  element: HTMLElement;
  kind?: "atlas" | "solid" | "border" | "triangle";
  dispose(): void;
}

export interface RenderTextureAtlasResult {
  rendered: RenderedPoly[];
  dispose(): void;
}

const TEXTURE_IMAGE_CACHE = new Map<string, Promise<HTMLImageElement>>();
const ELEMENT_DATA_KEYS = new WeakMap<HTMLElement, string[]>();
const RECT_EPS = 1e-3;
const BASIS_EPS = 1e-9;
const SURFACE_NORMAL_EPS = 1e-4;
const SURFACE_DISTANCE_EPS = 0.1;
const TEXTURE_TRIANGLE_BLEED = 0.75;
const TEXTURE_SEAM_BLEED = 0;
const SOLID_TRIANGLE_BLEED = 0.45;
const DEFAULT_MATRIX_DECIMALS = 3;
const DEFAULT_BORDER_SHAPE_DECIMALS = 2;
const DEFAULT_TRIANGLE_BORDER_DECIMALS = 1;
const BORDER_SHAPE_CENTER_PERCENT = 50;
const BORDER_SHAPE_POINT_EPS = 1e-7;

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

function formatTriangleBorderPx(value: number, decimals = DEFAULT_TRIANGLE_BORDER_DECIMALS): string {
  const next = roundDecimal(value, decimals);
  return Number(next) === 0 || Object.is(Number(next), -0) ? "0" : `${next}px`;
}

function formatInlinePx(value: number): string {
  return value === 0 || Object.is(value, -0) ? "0" : `${value}px`;
}

function formatMatrix3dValues(values: readonly number[], decimals = DEFAULT_MATRIX_DECIMALS): string {
  return values.map((value) => roundDecimal(value, decimals)).join(",");
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
  atlasScaleInput: AtlasScale | undefined,
): { packed: PackedAtlas; atlasScale: number } {
  if (atlasScaleInput !== undefined && atlasScaleInput !== "auto") {
    const atlasScale = normalizeAtlasScale(atlasScaleInput);
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
  // or rgba(). createTransformControls passes rgba() colors to fade
  // arrows on hover/drag.
  const parsed = parsePureColor(hex);
  if (!parsed) return { r: 255, g: 255, b: 255 };
  return { r: parsed.rgb[0], g: parsed.rgb[1], b: parsed.rgb[2] };
}

function rgbKey({ r, g, b }: RGB): string {
  return `${r},${g},${b}`;
}

/** Returns the parsed alpha for a color string (1.0 default). */
function parseAlpha(input: string): number {
  return parsePureColor(input)?.alpha ?? 1;
}

function rgbToHex({ r, g, b }: RGB): string {
  const f = (n: number) =>
    Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, "0");
  return `#${f(r)}${f(g)}${f(b)}`;
}

function setInlineStyleProperty(el: HTMLElement, property: string, value: string): void {
  const current = el.getAttribute("style") ?? "";
  const declaration = `${property}:${value}`;
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(^|;)\\s*${escaped}\\s*:[^;]*`, "i");
  const next = pattern.test(current)
    ? current.replace(pattern, (_match, prefix: string) => `${prefix}${declaration}`)
    : `${current}${current.trim() && !current.trim().endsWith(";") ? ";" : ""}${declaration}`;
  if (next !== current) el.setAttribute("style", next);
}

function removeInlineStyleProperty(el: HTMLElement, property: string): void {
  const current = el.getAttribute("style") ?? "";
  if (!current) return;
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matcher = new RegExp(`^\\s*${escaped}\\s*:`, "i");
  const next = current
    .split(";")
    .map((declaration) => declaration.trim())
    .filter((declaration) => declaration && !matcher.test(declaration))
    .join(";");
  if (next) el.setAttribute("style", next);
  else el.removeAttribute("style");
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
  // a translucent input (e.g. createTransformControls arrows at idle)
  // must keep its alpha so the gizmo stays see-through after shading.
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

function pointKey(point: Vec3): string {
  return `${point[0]},${point[1]},${point[2]}`;
}

function edgeKey(a: Vec3, b: Vec3): string {
  const ak = pointKey(a);
  const bk = pointKey(b);
  return ak < bk ? `${ak}|${bk}` : `${bk}|${ak}`;
}

function canonicalEdgeVector(a: Vec3, b: Vec3): Vec3 {
  return pointKey(a) < pointKey(b)
    ? [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
    : [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function isBasisOptimizable(polygon: Polygon): boolean {
  return !polygon.texture;
}

function cssPoints(vertices: Vec3[], tile: number, elev: number): Vec3[] {
  return vertices.map((v): Vec3 => [v[1] * tile, v[0] * tile, v[2] * elev]);
}

function computeSurfaceNormal(pts: Vec3[]): Vec3 | null {
  if (pts.length < 3) return null;
  const p0 = pts[0];
  const p1 = pts[1];
  const p2 = pts[2];
  const e1: Vec3 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
  const e2: Vec3 = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
  let nx = -(e1[1] * e2[2] - e1[2] * e2[1]);
  let ny = -(e1[2] * e2[0] - e1[0] * e2[2]);
  let nz = -(e1[0] * e2[1] - e1[1] * e2[0]);
  const nLen = Math.hypot(nx, ny, nz);
  if (nLen <= BASIS_EPS) return null;
  nx /= nLen; ny /= nLen; nz /= nLen;
  return [nx, ny, nz];
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

function getPolygonBasisInfo(
  polygon: Polygon,
  tile: number,
  elev: number,
): PolygonBasisInfo | null {
  if (!polygon.vertices || polygon.vertices.length < 3) return null;
  const pts = cssPoints(polygon.vertices, tile, elev);
  const normal = computeSurfaceNormal(pts);
  if (!normal) return null;
  return {
    pts,
    normal,
    planeD: dotVec(normal, pts[0]),
    optimizable: isBasisOptimizable(polygon),
  };
}

function compatibleSurface(
  a: PolygonBasisInfo | null,
  b: PolygonBasisInfo | null,
): boolean {
  if (!a || !b || !a.optimizable || !b.optimizable) return false;
  if (dotVec(a.normal, b.normal) < 1 - SURFACE_NORMAL_EPS) return false;
  return Math.abs(a.planeD - b.planeD) <= SURFACE_DISTANCE_EPS;
}

function basisAxisKey(axis: Vec3): string {
  const canonical: Vec3 = [...axis] as Vec3;
  const first = Math.abs(canonical[0]) > BASIS_EPS
    ? 0
    : Math.abs(canonical[1]) > BASIS_EPS
      ? 1
      : 2;
  if (canonical[first] < 0) {
    canonical[0] *= -1;
    canonical[1] *= -1;
    canonical[2] *= -1;
  }
  return `${canonical[0].toFixed(6)},${canonical[1].toFixed(6)},${canonical[2].toFixed(6)}`;
}

function makeLocalBasis(
  pts: Vec3[],
  origin: Vec3,
  normal: Vec3,
  rawXAxis: Vec3,
  options: { boundsOrigin?: Vec3; snapBounds?: boolean } = {},
): LocalBasis | null {
  const dot = dotVec(rawXAxis, normal);
  const planeX: Vec3 = [
    rawXAxis[0] - dot * normal[0],
    rawXAxis[1] - dot * normal[1],
    rawXAxis[2] - dot * normal[2],
  ];
  const xLength = Math.hypot(planeX[0], planeX[1], planeX[2]);
  if (xLength <= BASIS_EPS) return null;

  const xAxis: Vec3 = [
    planeX[0] / xLength,
    planeX[1] / xLength,
    planeX[2] / xLength,
  ];
  const yAxisRaw: Vec3 = [
    normal[1] * xAxis[2] - normal[2] * xAxis[1],
    normal[2] * xAxis[0] - normal[0] * xAxis[2],
    normal[0] * xAxis[1] - normal[1] * xAxis[0],
  ];
  const yLength = Math.hypot(yAxisRaw[0], yAxisRaw[1], yAxisRaw[2]);
  if (yLength <= BASIS_EPS) return null;
  const yAxis: Vec3 = [
    yAxisRaw[0] / yLength,
    yAxisRaw[1] / yLength,
    yAxisRaw[2] / yLength,
  ];

  const local2D = pts.map((p): Vec2 => {
    const dx = p[0] - origin[0], dy = p[1] - origin[1], dz = p[2] - origin[2];
    return [
      dx * xAxis[0] + dy * xAxis[1] + dz * xAxis[2],
      dx * yAxis[0] + dy * yAxis[1] + dz * yAxis[2],
    ];
  });

  const boundsOrigin = options.boundsOrigin ?? origin;
  const odx = origin[0] - boundsOrigin[0];
  const ody = origin[1] - boundsOrigin[1];
  const odz = origin[2] - boundsOrigin[2];
  const originOffsetX = odx * xAxis[0] + ody * xAxis[1] + odz * xAxis[2];
  const originOffsetY = odx * yAxis[0] + ody * yAxis[1] + odz * yAxis[2];
  let xMin = Infinity, yMin = Infinity, xMax = -Infinity, yMax = -Infinity;
  for (const [x, y] of local2D) {
    const boundsX = x + originOffsetX;
    const boundsY = y + originOffsetY;
    if (boundsX < xMin) xMin = boundsX; if (boundsX > xMax) xMax = boundsX;
    if (boundsY < yMin) yMin = boundsY; if (boundsY > yMax) yMax = boundsY;
  }

  const w = xMax - xMin;
  const h = yMax - yMin;
  if (!Number.isFinite(w) || !Number.isFinite(h)) return null;

  const boxMinX = options.snapBounds ? Math.floor(xMin + RECT_EPS) : xMin;
  const boxMinY = options.snapBounds ? Math.floor(yMin + RECT_EPS) : yMin;
  const boxMaxX = options.snapBounds ? Math.ceil(xMax - RECT_EPS) : xMax;
  const boxMaxY = options.snapBounds ? Math.ceil(yMax - RECT_EPS) : yMax;
  const canvasW = Math.max(1, options.snapBounds ? boxMaxX - boxMinX : Math.ceil(w));
  const canvasH = Math.max(1, options.snapBounds ? boxMaxY - boxMinY : Math.ceil(h));
  return {
    xAxis,
    yAxis,
    local2D,
    shiftX: originOffsetX - boxMinX,
    shiftY: originOffsetY - boxMinY,
    canvasW,
    canvasH,
    pixelArea: canvasW * canvasH,
    rawArea: w * h,
  };
}

function evaluateIslandAxis(
  component: number[],
  infos: Array<PolygonBasisInfo | null>,
  axis: Vec3,
  boundsOrigin: Vec3,
): { pixelArea: number; rawArea: number } | null {
  let pixelArea = 0;
  let rawArea = 0;
  for (const index of component) {
    const info = infos[index];
    if (!info) return null;
    const basis = makeLocalBasis(info.pts, info.pts[0], info.normal, axis, {
      boundsOrigin,
      snapBounds: true,
    });
    if (!basis) return null;
    pixelArea += basis.pixelArea;
    rawArea += basis.rawArea;
  }
  return { pixelArea, rawArea };
}

function chooseIslandXAxis(
  component: number[],
  infos: Array<PolygonBasisInfo | null>,
): BasisHint | null {
  const boundsOrigin = infos[component[0]]?.pts[0];
  if (!boundsOrigin) return null;
  let baseline: { pixelArea: number; rawArea: number } | null = { pixelArea: 0, rawArea: 0 };
  let best: { xAxis: Vec3; pixelArea: number; rawArea: number } | null = null;
  const seen = new Set<string>();

  for (const polygonIndex of component) {
    const info = infos[polygonIndex];
    if (!info) continue;

    const firstEdge: Vec3 = [
      info.pts[1][0] - info.pts[0][0],
      info.pts[1][1] - info.pts[0][1],
      info.pts[1][2] - info.pts[0][2],
    ];
    const firstBasis = makeLocalBasis(info.pts, info.pts[0], info.normal, firstEdge);
    if (baseline && firstBasis) {
      baseline.pixelArea += firstBasis.pixelArea;
      baseline.rawArea += firstBasis.rawArea;
    } else {
      baseline = null;
    }

    for (let i = 0; i < info.pts.length; i++) {
      const rawAxis = canonicalEdgeVector(info.pts[i], info.pts[(i + 1) % info.pts.length]);
      const basis = makeLocalBasis(info.pts, info.pts[0], info.normal, rawAxis);
      if (!basis) continue;
      const key = basisAxisKey(basis.xAxis);
      if (seen.has(key)) continue;
      seen.add(key);

      const candidate = evaluateIslandAxis(component, infos, basis.xAxis, boundsOrigin);
      if (!candidate) continue;
      if (
        !best ||
        candidate.pixelArea < best.pixelArea ||
        (candidate.pixelArea === best.pixelArea && candidate.rawArea < best.rawArea - RECT_EPS)
      ) {
        best = { xAxis: basis.xAxis, ...candidate };
      }
    }
  }

  if (!best) return null;
  if (
    baseline &&
    (
      best.pixelArea < baseline.pixelArea ||
      (best.pixelArea === baseline.pixelArea && best.rawArea <= baseline.rawArea + RECT_EPS)
    )
  ) {
    return { xAxis: best.xAxis, boundsOrigin, seamEdges: new Set<number>() };
  }
  return null;
}

function buildBasisHints(
  polygons: Polygon[],
  options: RenderTextureAtlasOptions,
): Array<BasisHint | undefined> {
  const tile = options.tileSize ?? DEFAULT_TILE;
  const elev = options.layerElevation ?? tile;
  const infos = polygons.map((polygon) => getPolygonBasisInfo(polygon, tile, elev));
  const edgeOwners = new Map<string, Array<{ polygon: number; edge: number }>>();
  const seamEdges = polygons.map(() => new Set<number>());
  for (let polygonIndex = 0; polygonIndex < polygons.length; polygonIndex++) {
    const vertices = polygons[polygonIndex].vertices;
    if (!vertices || vertices.length < 3) continue;
    for (let edgeIndex = 0; edgeIndex < vertices.length; edgeIndex++) {
      const key = edgeKey(
        vertices[edgeIndex],
        vertices[(edgeIndex + 1) % vertices.length],
      );
      const owners = edgeOwners.get(key);
      const owner = { polygon: polygonIndex, edge: edgeIndex };
      if (owners) owners.push(owner);
      else edgeOwners.set(key, [owner]);
    }
  }

  const adjacency = polygons.map(() => new Set<number>());
  for (const owners of edgeOwners.values()) {
    if (owners.length < 2) continue;
    for (const owner of owners) seamEdges[owner.polygon].add(owner.edge);
    for (let i = 0; i < owners.length; i++) {
      for (let j = i + 1; j < owners.length; j++) {
        const a = owners[i].polygon;
        const b = owners[j].polygon;
        if (!compatibleSurface(infos[a], infos[b])) continue;
        adjacency[a].add(b);
        adjacency[b].add(a);
      }
    }
  }

  const hints: Array<BasisHint | undefined> = Array(polygons.length).fill(undefined);
  const visited = new Set<number>();
  for (let i = 0; i < polygons.length; i++) {
    if (visited.has(i) || !infos[i]?.optimizable) continue;
    const component: number[] = [];
    const stack = [i];
    visited.add(i);
    while (stack.length > 0) {
      const current = stack.pop()!;
      component.push(current);
      for (const next of adjacency[current]) {
        if (visited.has(next)) continue;
        visited.add(next);
        stack.push(next);
      }
    }

    if (component.length < 2) continue;
    const hint = chooseIslandXAxis(component, infos);
    if (!hint) continue;
    for (const index of component) {
      hints[index] = {
        xAxis: hint.xAxis,
        boundsOrigin: hint.boundsOrigin,
        seamEdges: seamEdges[index],
      };
    }
  }

  for (let i = 0; i < polygons.length; i++) {
    if (!hints[i] && seamEdges[i].size > 0) {
      hints[i] = { seamEdges: seamEdges[i] };
    }
  }

  return hints;
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

function chooseLocalBasis(
  pts: Vec3[],
  origin: Vec3,
  normal: Vec3,
  options: BasisOptions,
): LocalBasis | null {
  if (options.optimize && options.fixedXAxis) {
    return makeLocalBasis(pts, origin, normal, options.fixedXAxis, {
      boundsOrigin: options.boundsOrigin,
      snapBounds: options.snapBounds,
    });
  }

  let best: LocalBasis | null = null;
  const seamCandidates = options.optimize && options.seamEdges && options.seamEdges.size > 0
    ? Array.from(options.seamEdges)
    : null;
  const candidateEdges = seamCandidates ?? (
    options.optimize
      ? pts.map((_, edgeIndex) => edgeIndex)
      : [0]
  );

  for (const i of candidateEdges) {
    const next = (i + 1) % pts.length;
    const edge = seamCandidates
      ? canonicalEdgeVector(pts[i], pts[next])
      : [
          pts[next][0] - pts[i][0],
          pts[next][1] - pts[i][1],
          pts[next][2] - pts[i][2],
        ] as Vec3;
    const candidate = makeLocalBasis(pts, origin, normal, edge, {
      boundsOrigin: options.boundsOrigin,
      snapBounds: options.snapBounds,
    });
    if (!candidate) continue;

    if (
      !best ||
      candidate.pixelArea < best.pixelArea ||
      (candidate.pixelArea === best.pixelArea && candidate.rawArea < best.rawArea - RECT_EPS)
    ) {
      best = candidate;
    }
  }

  return best;
}

function isFullRectBasis(basis: LocalBasis): boolean {
  if (basis.local2D.length !== 4) return false;

  const xs: number[] = [];
  const ys: number[] = [];
  const addUnique = (list: number[], value: number): void => {
    for (const existing of list) {
      if (Math.abs(existing - value) <= RECT_EPS) return;
    }
    list.push(value);
  };

  for (const [x, y] of basis.local2D) {
    addUnique(xs, x + basis.shiftX);
    addUnique(ys, y + basis.shiftY);
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

  for (const [rawX, rawY] of basis.local2D) {
    const x = rawX + basis.shiftX;
    const y = rawY + basis.shiftY;
    const onX = Math.abs(x - xs[0]) <= RECT_EPS || Math.abs(x - xs[1]) <= RECT_EPS;
    const onY = Math.abs(y - ys[0]) <= RECT_EPS || Math.abs(y - ys[1]) <= RECT_EPS;
    if (!onX || !onY) return false;
  }
  return true;
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
  const pts = cssPoints(triangle.vertices, tile, elev);
  const points = pts.map((point): Vec2 => {
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
    const length = Math.hypot(dx, dy);
    if (length <= RECT_EPS) continue;
    expanded[i] += (dx / length) * amount;
    expanded[i + 1] += (dy / length) * amount;
  }
  return expanded;
}

function signedArea2D(points: number[]): number {
  let area = 0;
  for (let i = 0; i < points.length; i += 2) {
    const next = (i + 2) % points.length;
    area += points[i] * points[next + 1] - points[next] * points[i + 1];
  }
  return area / 2;
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

function traceTextureClipPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  points: number[],
  seamEdges: Set<number> | null,
  bleed: number,
): void {
  tracePolygonPath(ctx, x, y, points);
  if (!seamEdges || seamEdges.size === 0 || bleed <= 0) return;

  const count = points.length / 2;
  const area = signedArea2D(points);
  for (const edgeIndex of seamEdges) {
    const i = edgeIndex * 2;
    const next = ((edgeIndex + 1) % count) * 2;
    const ax = points[i];
    const ay = points[i + 1];
    const bx = points[next];
    const by = points[next + 1];
    const dx = bx - ax;
    const dy = by - ay;
    const length = Math.hypot(dx, dy);
    if (length <= RECT_EPS) continue;
    const outwardX = area >= 0 ? dy / length : -dy / length;
    const outwardY = area >= 0 ? -dx / length : dx / length;
    ctx.moveTo(x + ax, y + ay);
    ctx.lineTo(x + bx, y + by);
    ctx.lineTo(x + bx + outwardX * bleed, y + by + outwardY * bleed);
    ctx.lineTo(x + ax + outwardX * bleed, y + ay + outwardY * bleed);
    ctx.closePath();
  }
}

function computeTextureAtlasPlan(
  polygon: Polygon,
  index: number,
  options: RenderTextureAtlasOptions,
  basisHint?: BasisHint,
): TextureAtlasPlan | null {
  const { vertices, texture, uvs } = polygon;
  if (!vertices || vertices.length < 3) return null;

  const tile = options.tileSize ?? DEFAULT_TILE;
  const elev = options.layerElevation ?? tile;
  const pts = cssPoints(vertices, tile, elev);
  const p0 = pts[0];
  const p1 = pts[1];

  const e1: Vec3 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
  const l01 = Math.hypot(e1[0], e1[1], e1[2]);
  if (l01 === 0) return null;

  const normal = computeSurfaceNormal(pts);
  if (!normal) return null;

  const firstEdgeBasis = chooseLocalBasis(pts, p0, normal, { optimize: false });
  const basis = texture
    ? firstEdgeBasis
    : firstEdgeBasis && isFullRectBasis(firstEdgeBasis)
      ? firstEdgeBasis
      : chooseLocalBasis(pts, p0, normal, {
          optimize: true,
          fixedXAxis: basisHint?.xAxis,
          boundsOrigin: basisHint?.boundsOrigin,
          snapBounds: Boolean(basisHint),
          seamEdges: basisHint?.seamEdges,
        });
  if (!basis) return null;
  const { xAxis, yAxis, local2D, shiftX, shiftY } = basis;

  const screenPts: number[] = [];
  for (const [x, y] of local2D) screenPts.push(x + shiftX, y + shiftY);

  const tx = p0[0] - shiftX * xAxis[0] - shiftY * yAxis[0];
  const ty = p0[1] - shiftX * xAxis[1] - shiftY * yAxis[1];
  const tz = p0[2] - shiftX * xAxis[2] - shiftY * yAxis[2];
  const matrix = formatMatrix3dValues([
    xAxis[0], xAxis[1], xAxis[2], 0,
    yAxis[0], yAxis[1], yAxis[2], 0,
    normal[0], normal[1], normal[2], 0,
    tx, ty, tz, 1,
  ]);

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
  const directScale = lightIntensity * Math.max(0, normal[0] * lx + normal[1] * ly + normal[2] * lz);
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
    canvasW: basis.canvasW,
    canvasH: basis.canvasH,
    screenPts,
    uvAffine,
    uvSampleRect,
    textureTriangles,
    seamEdges: basisHint?.seamEdges.size ? basisHint.seamEdges : null,
    normal,
    textureTint,
    shadedColor,
  };
}

function computeSolidTrianglePlan(
  polygon: Polygon,
  index: number,
  options: RenderTextureAtlasOptions,
): SolidTrianglePlan | null {
  if (polygon.texture || polygon.vertices.length !== 3) return null;

  const tile = options.tileSize ?? DEFAULT_TILE;
  const elev = options.layerElevation ?? tile;
  const pts = cssPoints(polygon.vertices, tile, elev);
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
  const bleed = SOLID_TRIANGLE_BLEED;
  const leftPx = left + bleed;
  const rightPx = right + bleed;
  const heightPx = height + bleed * 2;
  const tx = cv[0] - leftPx * xAxis[0] - bleed * yAxis[0];
  const ty = cv[1] - leftPx * xAxis[1] - bleed * yAxis[1];
  const tz = cv[2] - leftPx * xAxis[2] - bleed * yAxis[2];
  const matrix = formatMatrix3dValues([
    xAxis[0], xAxis[1], xAxis[2], 0,
    yAxis[0], yAxis[1], yAxis[2], 0,
    normal[0], normal[1], normal[2], 0,
    tx, ty, tz, 1,
  ]);

  const directionalCfg = options.directionalLight;
  const ambientCfg = options.ambientLight;
  const lightDir = directionalCfg?.direction ?? DEFAULT_LIGHT_DIR;
  const lightColor = directionalCfg?.color ?? DEFAULT_LIGHT_COLOR;
  const lightIntensity = Math.max(0, directionalCfg?.intensity ?? DEFAULT_LIGHT_INTENSITY);
  const ambientColor = ambientCfg?.color ?? DEFAULT_AMBIENT_COLOR;
  const ambientIntensity = Math.max(0, ambientCfg?.intensity ?? DEFAULT_AMBIENT_INTENSITY);
  const lLen = Math.hypot(lightDir[0], lightDir[1], lightDir[2]) || 1;
  const lx = lightDir[0] / lLen, ly = lightDir[1] / lLen, lz = lightDir[2] / lLen;
  const directScale = lightIntensity * Math.max(0, normal[0] * lx + normal[1] * ly + normal[2] * lz);
  const shadedColor = shadePolygon(polygon.color ?? "#cccccc", directScale, lightColor, ambientColor, ambientIntensity);
  const textureLighting = options.textureLighting ?? "baked";
  const base = parseHex(polygon.color ?? "#cccccc");
  const useDefaultPaint = shadedColor === options.solidPaintDefaults?.paintColor;
  const useDefaultDynamicColor =
    textureLighting === "dynamic" && rgbKey(base) === options.solidPaintDefaults?.dynamicColorKey;
  const bakedColor = textureLighting === "dynamic" || useDefaultPaint
    ? ""
    : `color:${shadedColor};`;
  const dynamicVars = textureLighting === "dynamic"
    ? `--pnx:${normal[0].toFixed(4)};--pny:${normal[1].toFixed(4)};--pnz:${normal[2].toFixed(4)};` +
      (useDefaultDynamicColor
        ? ""
        : `--psr:${(base.r / 255).toFixed(4)};--psg:${(base.g / 255).toFixed(4)};--psb:${(base.b / 255).toFixed(4)};`)
    : "";
  const styleText =
    `transform:matrix3d(${matrix});` +
    `border-width:${formatTriangleBorderPx(0)} ${formatTriangleBorderPx(rightPx)} ${formatTriangleBorderPx(heightPx)} ${formatTriangleBorderPx(leftPx)};` +
    bakedColor +
    dynamicVars;

  return {
    index,
    polygon,
    styleText,
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
        shelf.x += plan.canvasW + padding * 2;
        page.entries.push(entry);
        page.width = Math.max(page.width, entry.x + plan.canvasW + padding);
        return entry;
      }
    }

    const shelfY = page.shelves.length === 0 ? padding : page.height + padding;
    if (shelfY + plan.canvasH + padding > ATLAS_MAX_SIZE) return null;

    const entry = { ...plan, pageIndex, x: padding, y: shelfY };
    page.shelves.push({
      x: padding + plan.canvasW + padding * 2,
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
      const entry = { ...plan, pageIndex, x: padding, y: padding };
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

function paintSolidAtlasEntry(
  ctx: CanvasRenderingContext2D,
  entry: PackedTextureAtlasEntry,
  textureLighting: PolyTextureLightingMode,
  atlasScale: number,
): void {
  setCssTransform(ctx, atlasScale);
  ctx.beginPath();
  tracePolygonPath(ctx, entry.x, entry.y, entry.screenPts);
  ctx.clip();
  setCssTransform(ctx, atlasScale);
  // Dynamic mode multiplies the tint at render time via background-blend-mode,
  // so the atlas keeps the polygon's unshaded base color.
  ctx.fillStyle = textureLighting === "dynamic"
    ? (entry.polygon.color ?? "#cccccc")
    : entry.shadedColor;
  ctx.fillRect(entry.x, entry.y, entry.canvasW, entry.canvasH);
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

async function buildAtlasPage(
  page: PackedPage,
  textureLighting: PolyTextureLightingMode,
  doc: Document,
  atlasScale: number,
): Promise<TextureAtlasPage> {
  const canvas = doc.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(page.width * atlasScale));
  canvas.height = Math.max(1, Math.ceil(page.height * atlasScale));
  const ctx = canvas.getContext("2d");
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
    ctx.save();
    setCssTransform(ctx, atlasScale);
    ctx.beginPath();
    if (entry.texture) {
      traceTextureClipPath(ctx, entry.x, entry.y, entry.screenPts, entry.seamEdges, TEXTURE_SEAM_BLEED);
    } else {
      tracePolygonPath(ctx, entry.x, entry.y, entry.screenPts);
    }
    ctx.clip();

    if (!entry.texture) {
      paintSolidAtlasEntry(ctx, entry, textureLighting, atlasScale);
    } else if (srcImg && entry.textureTriangles?.length) {
      const imgW = srcImg.naturalWidth || srcImg.width || 1;
      const imgH = srcImg.naturalHeight || srcImg.height || 1;
      for (const triangle of entry.textureTriangles) {
        const clipPts = expandClipPoints(triangle.screenPts, TEXTURE_TRIANGLE_BLEED);
        ctx.save();
        setCssTransform(ctx, atlasScale);
        ctx.beginPath();
        for (let i = 0; i < clipPts.length; i += 2) {
          const px = entry.x + clipPts[i];
          const py = entry.y + clipPts[i + 1];
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.clip();
        if (triangle.uvAffine) {
          setCssTransform(
            ctx,
            atlasScale,
            triangle.uvAffine.a / imgW, triangle.uvAffine.c / imgW,
            triangle.uvAffine.b / imgH, triangle.uvAffine.d / imgH,
            entry.x + triangle.uvAffine.e, entry.y + triangle.uvAffine.f,
          );
          ctx.drawImage(srcImg, 0, 0);
        } else if (triangle.uvSampleRect) {
          drawImageUvSample(
            ctx,
            srcImg,
            triangle.uvSampleRect,
            entry.x,
            entry.y,
            entry.canvasW,
            entry.canvasH,
            atlasScale,
          );
        }
        ctx.restore();
      }
    } else if (srcImg && entry.uvAffine) {
      const imgW = srcImg.naturalWidth || srcImg.width || 1;
      const imgH = srcImg.naturalHeight || srcImg.height || 1;
      setCssTransform(
        ctx,
        atlasScale,
        entry.uvAffine.a / imgW, entry.uvAffine.c / imgW,
        entry.uvAffine.b / imgH, entry.uvAffine.d / imgH,
        entry.x + entry.uvAffine.e, entry.y + entry.uvAffine.f,
      );
      ctx.drawImage(srcImg, 0, 0);
    } else if (srcImg && entry.uvSampleRect) {
      drawImageUvSample(
        ctx,
        srcImg,
        entry.uvSampleRect,
        entry.x,
        entry.y,
        entry.canvasW,
        entry.canvasH,
        atlasScale,
      );
    } else if (srcImg) {
      drawImageCover(ctx, srcImg, entry.x, entry.y, entry.canvasW, entry.canvasH, atlasScale);
    }
    if (entry.texture && textureLighting === "baked") {
      applyTextureTint(ctx, entry.x, entry.y, entry.canvasW, entry.canvasH, entry.textureTint, atlasScale);
    }
    ctx.restore();
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

function applyAtlasBackground(
  el: HTMLElement,
  page: TextureAtlasPage,
  textureLighting: PolyTextureLightingMode,
  entry: PackedTextureAtlasEntry,
): void {
  if (!page.url) return;
  const url = `url(${page.url})`;
  const pos = `-${entry.x}px -${entry.y}px`;
  const size = `${page.width}px ${page.height}px`;
  if (textureLighting === "dynamic") {
    setInlineStyleProperty(el, "background-image", url);
    setInlineStyleProperty(el, "background-position", pos);
    setInlineStyleProperty(el, "background-size", size);
  } else {
    setInlineStyleProperty(el, "background", `${url} ${pos} / ${size} no-repeat`);
  }
  // Dynamic mode also masks the entire <i> by the atlas image so the
  // background-color tint only paints inside the polygon shape (W3C
  // multiply with transparent backdrop reduces to source).
  if (textureLighting === "dynamic") {
    setInlineStyleProperty(el, "mask-image", url);
    setInlineStyleProperty(el, "mask-mode", "alpha");
    setInlineStyleProperty(el, "mask-position", pos);
    setInlineStyleProperty(el, "mask-size", size);
    setInlineStyleProperty(el, "mask-repeat", "no-repeat");
    // Vendor-prefixed twins for older Safari. setProperty avoids the
    // deprecation warnings on the camelCase properties in lib.dom.
    setInlineStyleProperty(el, "-webkit-mask-image", url);
    setInlineStyleProperty(el, "-webkit-mask-position", pos);
    setInlineStyleProperty(el, "-webkit-mask-size", size);
    setInlineStyleProperty(el, "-webkit-mask-repeat", "no-repeat");
  } else {
    removeInlineStyleProperty(el, "mask-image");
    removeInlineStyleProperty(el, "mask-mode");
    removeInlineStyleProperty(el, "mask-position");
    removeInlineStyleProperty(el, "mask-size");
    removeInlineStyleProperty(el, "mask-repeat");
    removeInlineStyleProperty(el, "-webkit-mask-image");
    removeInlineStyleProperty(el, "-webkit-mask-position");
    removeInlineStyleProperty(el, "-webkit-mask-size");
    removeInlineStyleProperty(el, "-webkit-mask-repeat");
  }
}

function applyPolygonDataAttrs(el: HTMLElement, polygon: Polygon): void {
  const previousDataKeys = ELEMENT_DATA_KEYS.get(el);
  if (previousDataKeys) {
    for (const key of previousDataKeys) el.removeAttribute(`data-${key}`);
  }
  const nextDataKeys: string[] = [];
  if (polygon.data) {
    for (const [k, v] of Object.entries(polygon.data)) {
      el.setAttribute(`data-${k}`, String(v));
      nextDataKeys.push(k);
    }
  }
  ELEMENT_DATA_KEYS.set(el, nextDataKeys);
}

function formatPlanElementStyle(entry: TextureAtlasPlan, shapeDeclaration?: string): string {
  const shapeStyle = shapeDeclaration ? `${shapeDeclaration};` : "";
  return `transform:matrix3d(${entry.matrix});${shapeStyle}width:${formatInlinePx(entry.canvasW)};height:${formatInlinePx(entry.canvasH)}`;
}

function applyPlanElementBase(el: HTMLElement, entry: TextureAtlasPlan, shapeDeclaration?: string): void {
  el.setAttribute(
    "style",
    formatPlanElementStyle(entry, shapeDeclaration),
  );
  applyPolygonDataAttrs(el, entry.polygon);
}

function applyDynamicNormalVars(el: HTMLElement, entry: TextureAtlasPlan): void {
  // Dynamic mode: emit ONLY the per-polygon normal vars inline. The
  // calc-driven background-color + background-blend-mode multiply live
  // in the global stylesheet's
  // `.polycss-scene[data-polycss-lighting="dynamic"] i { ... }` rule, so
  // the per-element style stays tiny (~50 chars instead of ~600).
  setInlineStyleProperty(el, "--pnx", entry.normal[0].toFixed(4));
  setInlineStyleProperty(el, "--pny", entry.normal[1].toFixed(4));
  setInlineStyleProperty(el, "--pnz", entry.normal[2].toFixed(4));
}

function fullRectBounds(entry: TextureAtlasPlan): RectBrush | null {
  if (entry.screenPts.length !== 8) return null;

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
  if (xs.length !== 2 || ys.length !== 2) return null;

  xs.sort((a, b) => a - b);
  ys.sort((a, b) => a - b);
  if (
    Math.abs(xs[0]) > RECT_EPS ||
    Math.abs(ys[0]) > RECT_EPS ||
    xs[1] - xs[0] <= RECT_EPS ||
    ys[1] - ys[0] <= RECT_EPS
  ) {
    return null;
  }

  for (let i = 0; i < entry.screenPts.length; i += 2) {
    const x = entry.screenPts[i];
    const y = entry.screenPts[i + 1];
    const onX = Math.abs(x - xs[0]) <= RECT_EPS || Math.abs(x - xs[1]) <= RECT_EPS;
    const onY = Math.abs(y - ys[0]) <= RECT_EPS || Math.abs(y - ys[1]) <= RECT_EPS;
    if (!onX || !onY) return null;
  }

  return {
    left: xs[0],
    top: ys[0],
    width: xs[1] - xs[0],
    height: ys[1] - ys[0],
  };
}

function isFullRectSolid(entry: TextureAtlasPlan): boolean {
  return !!fullRectBounds(entry);
}

function isSolidTrianglePlan(entry: TextureAtlasPlan): boolean {
  return !entry.texture && entry.polygon.vertices.length === 3;
}

function borderShapeSupported(doc: Document): boolean {
  const css = doc.defaultView?.CSS ?? (typeof CSS !== "undefined" ? CSS : undefined);
  const supportsBorderShape = !!css?.supports?.(
    "border-shape",
    "polygon(0 0, 100% 0, 0 100%) circle(0)",
  );
  if (!supportsBorderShape) return false;

  const win = doc.defaultView ?? (typeof window !== "undefined" ? window : undefined);
  const media = win?.matchMedia;
  if (!media) return true;

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

function getSolidPaintDefaultsForPlans(
  plans: Array<TextureAtlasPlan | null>,
  textureLighting: PolyTextureLightingMode,
  doc: Document,
): SolidPaintDefaults {
  const paintCounts = new Map<string, number>();
  const dynamicCounts = new Map<string, number>();
  const dynamicColors = new Map<string, RGB>();
  const useBorderShape = textureLighting !== "dynamic" && borderShapeSupported(doc);

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

export function getSolidPaintDefaults(
  polygons: Polygon[],
  options: RenderTextureAtlasOptions = {},
): SolidPaintDefaults {
  const doc = options.doc ?? (typeof document !== "undefined" ? document : null);
  if (!doc) return {};
  const basisHints = buildBasisHints(polygons, options);
  const plans = polygons.map((polygon, index) =>
    computeTextureAtlasPlan(polygon, index, options, basisHints[index])
  );
  return getSolidPaintDefaultsForPlans(plans, options.textureLighting ?? "baked", doc);
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

function cssBorderShapeForPlan(entry: TextureAtlasPlan): string {
  const points = borderShapePointsForPlan(entry);
  return `${cssPolygonShapeForPoints(points)} ${cssCollapsedInnerShapeForPoints(points)}`;
}

function applySolidPaint(
  el: HTMLElement,
  entry: TextureAtlasPlan,
  textureLighting: PolyTextureLightingMode,
  solidPaintDefaults?: SolidPaintDefaults,
): void {
  if (textureLighting === "dynamic") {
    removeInlineStyleProperty(el, "color");
    removeInlineStyleProperty(el, "background");
    applyDynamicNormalVars(el, entry);
    const base = parseHex(entry.polygon.color ?? "#cccccc");
    if (rgbKey(base) === solidPaintDefaults?.dynamicColorKey) {
      removeInlineStyleProperty(el, "--psr");
      removeInlineStyleProperty(el, "--psg");
      removeInlineStyleProperty(el, "--psb");
    } else {
      setInlineStyleProperty(el, "--psr", (base.r / 255).toFixed(4));
      setInlineStyleProperty(el, "--psg", (base.g / 255).toFixed(4));
      setInlineStyleProperty(el, "--psb", (base.b / 255).toFixed(4));
    }
  } else if (entry.shadedColor !== solidPaintDefaults?.paintColor) {
    removeInlineStyleProperty(el, "background");
    setInlineStyleProperty(el, "color", entry.shadedColor);
  } else {
    removeInlineStyleProperty(el, "background");
    removeInlineStyleProperty(el, "color");
  }
}

function createSolidElement(
  entry: TextureAtlasPlan,
  textureLighting: PolyTextureLightingMode,
  doc: Document,
  solidPaintDefaults?: SolidPaintDefaults,
): HTMLElement {
  const el = doc.createElement("b");
  applyPlanElementBase(el, entry);
  applySolidPaint(el, entry, textureLighting, solidPaintDefaults);

  return el;
}

function createBorderShapeSolidElement(
  entry: TextureAtlasPlan,
  doc: Document,
  solidPaintDefaults?: SolidPaintDefaults,
): HTMLElement {
  const el = doc.createElement("i");
  applyPlanElementBase(el, entry, `border-shape:${cssBorderShapeForPlan(entry)}`);
  if (entry.shadedColor !== solidPaintDefaults?.paintColor) {
    setInlineStyleProperty(el, "color", entry.shadedColor);
  }

  return el;
}

function createAtlasElement(
  entry: PackedTextureAtlasEntry,
  textureLighting: PolyTextureLightingMode,
  doc: Document,
): HTMLElement {
  const el = doc.createElement("s");
  applyPlanElementBase(el, entry);
  setInlineStyleProperty(el, "background-position", `-${entry.x}px -${entry.y}px`);
  setInlineStyleProperty(el, "opacity", "0");

  if (textureLighting === "dynamic") applyDynamicNormalVars(el, entry);
  return el;
}

export function renderPolygonsWithTextureAtlas(
  polygons: Polygon[],
  options: RenderTextureAtlasOptions = {},
): RenderTextureAtlasResult {
  const doc = options.doc ?? (typeof document !== "undefined" ? document : null);
  if (!doc) return { rendered: [], dispose: () => {} };

  const textureLighting = options.textureLighting ?? "baked";
  const useBorderShape =
    textureLighting !== "dynamic" &&
    borderShapeSupported(doc);
  const basisHints = buildBasisHints(polygons, options);
  const plans = polygons.map((polygon, index) =>
    computeTextureAtlasPlan(polygon, index, options, basisHints[index])
  );
  const trianglePlans = plans.map((plan) =>
    plan && isSolidTrianglePlan(plan)
      ? computeSolidTrianglePlan(plan.polygon, plan.index, options)
      : null
  );
  const atlasPlans = plans.map((plan, index) =>
    plan &&
    (plan.texture
      ? plan
      : (!isFullRectSolid(plan) && !trianglePlans[index] && !useBorderShape) ? plan : null)
  );
  const { packed, atlasScale } = packTextureAtlasPlansWithScale(atlasPlans, options.atlasScale);
  const atlasElements = new Map<number, HTMLElement>();
  const rendered: RenderedPoly[] = [];
  let cancelled = false;
  let urls: string[] = [];

  for (let i = 0; i < polygons.length; i++) {
    const plan = plans[i];
    const trianglePlan = trianglePlans[i];
    if (!plan) continue;

    const entry = packed.entries[i];
    if (entry) {
      const element = createAtlasElement(entry, textureLighting, doc);
      atlasElements.set(i, element);
      rendered.push({ polygonIndex: i, element, kind: "atlas", dispose: () => {} });
    } else if (!plan.texture && isFullRectSolid(plan)) {
      const element = createSolidElement(plan, textureLighting, doc, options.solidPaintDefaults);
      rendered.push({ polygonIndex: i, element, kind: "solid", dispose: () => {} });
    } else if (!plan.texture && trianglePlan) {
      const element = createSolidTriangleElement(trianglePlan, doc);
      rendered.push({ polygonIndex: i, element, kind: "triangle", dispose: () => {} });
    } else if (!plan.texture && useBorderShape) {
      const element = createBorderShapeSolidElement(plan, doc, options.solidPaintDefaults);
      rendered.push({ polygonIndex: i, element, kind: "border", dispose: () => {} });
    }
  }

  rendered.sort((a, b) => a.polygonIndex - b.polygonIndex);

  buildAtlasPages(packed.pages, textureLighting, doc, atlasScale, () => cancelled)
    .then((pages) => {
      if (cancelled) {
        for (const page of pages) {
          if (page.url?.startsWith("blob:")) URL.revokeObjectURL(page.url);
        }
        return;
      }
      urls = pages.flatMap((page) => page.url?.startsWith("blob:") ? [page.url] : []);
      for (let pageIndex = 0; pageIndex < packed.pages.length; pageIndex++) {
        const page = packed.pages[pageIndex];
        const built = pages[pageIndex];
        if (!built) continue;
        for (const entry of page.entries) {
          const el = atlasElements.get(entry.index);
          if (!el || !built.url) continue;
          applyAtlasBackground(el, built, textureLighting, entry);
          removeInlineStyleProperty(el, "opacity");
        }
      }
    })
    .catch(() => {
      if (cancelled) return;
      for (const element of atlasElements.values()) {
        setInlineStyleProperty(element, "opacity", "0.5");
        setInlineStyleProperty(element, "outline", "1px dashed rgba(255, 0, 0, 0.6)");
      }
    });

  return {
    rendered,
    dispose() {
      cancelled = true;
      for (const url of urls) URL.revokeObjectURL(url);
      urls = [];
    },
  };
}

function computeStableSolidTriangles(
  polygons: Polygon[],
  options: RenderTextureAtlasOptions,
): SolidTrianglePlan[] | null {
  const plans = polygons.map((polygon, index) =>
    computeSolidTrianglePlan(polygon, index, options)
  );
  if (plans.some((plan) => !plan)) return null;
  return plans as SolidTrianglePlan[];
}

function clearAtlasImageStyles(el: HTMLElement): void {
  el.style.backgroundImage = "";
  el.style.backgroundPosition = "";
  el.style.backgroundSize = "";
  el.style.maskImage = "";
  el.style.maskMode = "";
  el.style.maskPosition = "";
  el.style.maskSize = "";
  el.style.maskRepeat = "";
  el.style.removeProperty("-webkit-mask-image");
  el.style.removeProperty("-webkit-mask-position");
  el.style.removeProperty("-webkit-mask-size");
  el.style.removeProperty("-webkit-mask-repeat");
}

function applySolidTriangleElement(
  el: HTMLElement,
  entry: SolidTrianglePlan,
): void {
  el.setAttribute("style", entry.styleText);
  if (entry.polygon.data || ELEMENT_DATA_KEYS.get(el)?.length) {
    applyPolygonDataAttrs(el, entry.polygon);
  }
}

function createSolidTriangleElement(
  entry: SolidTrianglePlan,
  doc: Document,
): HTMLElement {
  const el = doc.createElement("u");
  clearAtlasImageStyles(el);
  applySolidTriangleElement(el, entry);
  applyPolygonDataAttrs(el, entry.polygon);
  return el;
}

export function renderPolygonsWithStableTriangles(
  polygons: Polygon[],
  options: RenderTextureAtlasOptions = {},
): RenderTextureAtlasResult | null {
  const doc = options.doc ?? (typeof document !== "undefined" ? document : null);
  if (!doc) return { rendered: [], dispose: () => {} };

  const plans = computeStableSolidTriangles(polygons, options);
  if (!plans) return null;
  const rendered: RenderedPoly[] = [];

  for (const plan of plans) {
    const element = createSolidTriangleElement(plan, doc);
    rendered.push({ polygonIndex: plan.index, element, kind: "triangle", dispose: () => {} });
  }

  rendered.sort((a, b) => a.polygonIndex - b.polygonIndex);

  return {
    rendered,
    dispose() {},
  };
}

export function updatePolygonsWithStableTriangles(
  rendered: RenderedPoly[],
  polygons: Polygon[],
  options: RenderTextureAtlasOptions = {},
): RenderTextureAtlasResult | null {
  const doc = options.doc ?? (typeof document !== "undefined" ? document : null);
  if (!doc) return { rendered, dispose: () => {} };
  if (rendered.some((item) => item.kind !== "triangle")) return null;

  const plans = computeStableSolidTriangles(polygons, options);
  if (!plans || plans.length !== rendered.length) return null;
  for (let i = 0; i < rendered.length; i++) {
    if (rendered[i].polygonIndex !== plans[i].index) return null;
  }

  for (let i = 0; i < rendered.length; i++) {
    applySolidTriangleElement(rendered[i].element, plans[i]);
  }

  return {
    rendered,
    dispose() {},
  };
}
