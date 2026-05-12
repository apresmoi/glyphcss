import {
  computed,
  h,
  onBeforeUnmount,
  ref,
  watch,
} from "vue";
import type { ComputedRef, CSSProperties, Ref, VNode } from "vue";
import type {
  PolyAmbientLight,
  PolyDirectionalLight,
  Polygon,
  TextureTriangle,
  PolyTextureLightingMode,
  Vec2,
  Vec3,
} from "@layoutit/polycss-core";

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
const RECT_EPS = 1e-3;
const TEXTURE_TRIANGLE_BLEED = 0.75;
const DEFAULT_MATRIX_DECIMALS = 3;
const DEFAULT_BORDER_SHAPE_DECIMALS = 2;
const BASIS_EPS = 1e-9;
const SOLID_TRIANGLE_BLEED = 0.45;

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

interface TextureTrianglePlan {
  screenPts: number[];
  uvAffine: UvAffine | null;
  uvSampleRect: UvSampleRect | null;
}

export interface TextureAtlasPlan {
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
  entries: ComputedRef<Array<PackedTextureAtlasEntry | null>>;
  pages: Ref<TextureAtlasPage[]>;
  ready: ComputedRef<boolean>;
}

const TEXTURE_IMAGE_CACHE = new Map<string, Promise<HTMLImageElement>>();

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

function formatMatrix3d(matrix: string, decimals = DEFAULT_MATRIX_DECIMALS): string {
  return `matrix3d(${matrix.split(",").map((value) => {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? roundDecimal(parsed, decimals) : value.trim();
  }).join(",")})`;
}

function formatPercent(value: number, decimals = DEFAULT_BORDER_SHAPE_DECIMALS): string {
  return `${roundDecimal(value, decimals)}%`;
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
  const c = hex.startsWith("#") ? hex.slice(1) : hex;
  if (c.length !== 6) return { r: 255, g: 255, b: 255 };
  return {
    r: parseInt(c.slice(0, 2), 16),
    g: parseInt(c.slice(2, 4), 16),
    b: parseInt(c.slice(4, 6), 16),
  };
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

function borderShapeSupported(): boolean {
  const supportsBorderShape = !!globalThis.CSS?.supports?.(
    "border-shape",
    "polygon(0 0, 100% 0, 0 100%) polygon(50% 50%, 50% 50%, 50% 50%)",
  );
  if (!supportsBorderShape) return false;

  const media = globalThis.matchMedia;
  if (typeof media !== "function") return true;

  return media("(pointer: fine)").matches && media("(hover: hover)").matches;
}

function cssPolygonShapeForPlan(entry: TextureAtlasPlan): string {
  const pts: string[] = [];
  const width = entry.canvasW || 1;
  const height = entry.canvasH || 1;
  for (let i = 0; i < entry.screenPts.length; i += 2) {
    const x = Math.max(0, Math.min(100, (entry.screenPts[i] / width) * 100));
    const y = Math.max(0, Math.min(100, (entry.screenPts[i + 1] / height) * 100));
    pts.push(`${formatPercent(x)} ${formatPercent(y)}`);
  }
  return `polygon(${pts.join(", ")})`;
}

function cssCollapsedInnerShapeForPlan(entry: TextureAtlasPlan): string {
  let xSum = 0;
  let ySum = 0;
  const points = Math.max(1, entry.screenPts.length / 2);
  for (let i = 0; i < entry.screenPts.length; i += 2) {
    xSum += entry.screenPts[i];
    ySum += entry.screenPts[i + 1];
  }
  const width = entry.canvasW || 1;
  const height = entry.canvasH || 1;
  const x = formatPercent(Math.max(0, Math.min(100, (xSum / points / width) * 100)));
  const y = formatPercent(Math.max(0, Math.min(100, (ySum / points / height) * 100)));
  return `polygon(${Array.from({ length: points }, () => `${x} ${y}`).join(", ")})`;
}

function cssBorderShapeForPlan(entry: TextureAtlasPlan): string {
  return `${cssPolygonShapeForPlan(entry)} ${cssCollapsedInnerShapeForPlan(entry)}`;
}

function formatMatrix3dValues(values: readonly number[], decimals = DEFAULT_MATRIX_DECIMALS): string {
  return values.map((value) => roundDecimal(value, decimals)).join(",");
}

function cssPoints(vertices: Vec3[], tile: number, elev: number): Vec3[] {
  return vertices.map((v) => [v[1] * tile, v[0] * tile, v[2] * elev]);
}

function computeSurfaceNormal(pts: Vec3[]): Vec3 | null {
  if (pts.length < 3) return null;
  const p0 = pts[0], p1 = pts[1], p2 = pts[2];
  const e1: Vec3 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
  const e2: Vec3 = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
  const normal: Vec3 = [
    -(e1[1] * e2[2] - e1[2] * e2[1]),
    -(e1[2] * e2[0] - e1[0] * e2[2]),
    -(e1[0] * e2[1] - e1[1] * e2[0]),
  ];
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
  const dynamic = textureLighting === "dynamic";
  const base = parseHex(entry.polygon.color ?? "#cccccc");

  return {
    transform: `matrix3d(${matrix})`,
    borderWidth: `0 ${rightPx}px ${heightPx}px ${leftPx}px`,
    borderBottomColor: dynamic ? undefined : entry.shadedColor,
    pointerEvents: pointerEvents === "none" ? "none" : undefined,
    ...(dynamic
      ? {
          "--pnx": normal[0].toFixed(4),
          "--pny": normal[1].toFixed(4),
          "--pnz": normal[2].toFixed(4),
          "--psr": (base.r / 255).toFixed(4),
          "--psg": (base.g / 255).toFixed(4),
          "--psb": (base.b / 255).toFixed(4),
        }
      : null),
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
  return rgbToHex({
    r: base.r * tintR,
    g: base.g * tintG,
    b: base.b * tintB,
  });
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

export function computeTextureAtlasPlan(
  polygon: Polygon,
  index: number,
  options: {
    tileSize?: number;
    layerElevation?: number;
    directionalLight?: PolyDirectionalLight;
    ambientLight?: PolyAmbientLight;
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
  const shiftX = -xMin;
  const shiftY = -yMin;
  const w = xMax - xMin;
  const h = yMax - yMin;
  if (!Number.isFinite(w) || !Number.isFinite(h)) return null;

  const screenPts: number[] = [];
  for (let i = 0; i < local2D.length; i++) {
    const [x, y] = local2D[i];
    const sx = x + shiftX;
    const sy = y + shiftY;
    screenPts.push(sx, sy);
  }

  const tx = p0[0] - shiftX * xAxis[0] - shiftY * yAxis[0];
  const ty = p0[1] - shiftX * xAxis[1] - shiftY * yAxis[1];
  const tz = p0[2] - shiftX * xAxis[2] - shiftY * yAxis[2];

  const matrix = [
    xAxis[0], xAxis[1], xAxis[2], 0,
    yAxis[0], yAxis[1], yAxis[2], 0,
    nx, ny, nz, 0,
    tx, ty, tz, 1,
  ].join(",");
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
    canvasW: Math.max(1, Math.ceil(w)),
    canvasH: Math.max(1, Math.ceil(h)),
    screenPts,
    uvAffine,
    uvSampleRect,
    textureTriangles,
    normal: [nx, ny, nz],
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
    for (let i = 0; i < entry.screenPts.length; i += 2) {
      const px = entry.x + entry.screenPts[i];
      const py = entry.y + entry.screenPts[i + 1];
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.clip();

    if (!entry.texture) {
      setCssTransform(ctx, atlasScale);
      // Dynamic mode multiplies the tint at render time via
      // background-blend-mode, so the atlas keeps the polygon's unshaded
      // base color. Baked bakes the JS-computed shadedColor.
      ctx.fillStyle = textureLighting === "dynamic"
        ? (entry.polygon.color ?? "#cccccc")
        : entry.shadedColor;
      ctx.fillRect(entry.x, entry.y, entry.canvasW, entry.canvasH);
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

function revokeUrls(urls: string[]): void {
  for (const url of urls) URL.revokeObjectURL(url);
}

export function useTextureAtlas(
  plans: ComputedRef<Array<TextureAtlasPlan | null>>,
  textureLighting: ComputedRef<PolyTextureLightingMode>,
  atlasScale: ComputedRef<AtlasScale | undefined> = computed(() => undefined),
): TextureAtlasResult {
  const useBorderShape = computed(() => textureLighting.value !== "dynamic" && borderShapeSupported());

  const atlasState = computed(() => {
    const atlasPlans = plans.value.map((plan) => {
      if (!plan) return plan;
      if (plan.texture) return plan;
      if (isSolidTrianglePlan(plan)) return null;
      if (textureLighting.value !== "dynamic" && (useBorderShape.value || isFullRectSolid(plan))) return null;
      return plan;
    });
    return packTextureAtlasPlansWithScale(atlasPlans, atlasScale.value);
  });
  const pages = ref<TextureAtlasPage[]>(
    atlasState.value.packed.pages.map((page) => ({ width: page.width, height: page.height, url: null })),
  );
  let activeUrls: string[] = [];

  watch(
    () => [atlasState.value, textureLighting.value] as const,
    ([nextAtlasState, nextTextureLighting], _prev, onCleanup) => {
      const { packed: nextPacked, atlasScale: nextAtlasScale } = nextAtlasState;
      let cancelled = false;
      revokeUrls(activeUrls);
      activeUrls = [];
      pages.value = nextPacked.pages.map((page) => ({
        width: page.width,
        height: page.height,
        url: null,
      }));

      onCleanup(() => {
        cancelled = true;
        revokeUrls(activeUrls);
        activeUrls = [];
      });

      if (nextPacked.pages.length === 0 || typeof document === "undefined") return;

      buildAtlasPages(nextPacked.pages, nextTextureLighting, document, nextAtlasScale, () => cancelled)
        .then((nextPages) => {
          if (cancelled) {
            revokeUrls(nextPages.flatMap((page) => page.url?.startsWith("blob:") ? [page.url] : []));
            return;
          }
          activeUrls = nextPages.flatMap((page) => page.url?.startsWith("blob:") ? [page.url] : []);
          pages.value = nextPages;
        })
        .catch(() => {
          if (!cancelled) {
            pages.value = nextPacked.pages.map((page) => ({
              width: page.width,
              height: page.height,
              url: null,
            }));
          }
        });
    },
    { immediate: true },
  );

  onBeforeUnmount(() => {
    revokeUrls(activeUrls);
    activeUrls = [];
  });

  return {
    entries: computed(() => atlasState.value.packed.entries),
    pages,
    ready: computed(() => pages.value.length === 0 || pages.value.every((page) => !!page.url)),
  };
}

export function renderTextureAtlasPoly({
  entry,
  page,
  textureLighting,
  className,
  style: styleProp,
  domAttrs,
  pointerEvents = "auto",
}: {
  entry: PackedTextureAtlasEntry;
  page: TextureAtlasPage | undefined;
  textureLighting: PolyTextureLightingMode;
  className?: string;
  style?: CSSProperties;
  domAttrs?: Record<string, unknown>;
  pointerEvents?: "auto" | "none";
}): VNode {
  const dynamic = textureLighting === "dynamic";

  // Dynamic mode: emit ONLY the per-polygon surface normal vars + the
  // alpha mask inline. The calc-driven background-color + blend-mode
  // multiply live in the global stylesheet's
  // `.polycss-scene[data-polycss-lighting="dynamic"] s { ... }` rule, so
  // each <s>'s style stays tiny (~50 chars instead of ~600 — ~12× smaller
  // payload on big meshes). The mask still has to be inline because each
  // polygon has its own atlas position/size.
  const dynamicMask = dynamic && page?.url ? `url(${page.url})` : undefined;
  const background = !dynamic && page?.url
    ? `url(${page.url}) -${entry.x}px -${entry.y}px / ${page.width}px ${page.height}px no-repeat`
    : undefined;

  const style: CSSProperties = {
    width: `${entry.canvasW}px`,
    height: `${entry.canvasH}px`,
    transform: formatMatrix3d(entry.matrix),
    background,
    backgroundImage: dynamic && page?.url ? `url(${page.url})` : undefined,
    backgroundPosition: dynamic ? `-${entry.x}px -${entry.y}px` : undefined,
    backgroundSize: dynamic && page ? `${page.width}px ${page.height}px` : undefined,
    ...(dynamic
      ? {
          "--pnx": entry.normal[0].toFixed(4),
          "--pny": entry.normal[1].toFixed(4),
          "--pnz": entry.normal[2].toFixed(4),
        }
      : null),
    ...(dynamic && dynamicMask
      ? {
          maskImage: dynamicMask,
          maskMode: "alpha",
          maskPosition: `-${entry.x}px -${entry.y}px`,
          maskSize: page ? `${page.width}px ${page.height}px` : undefined,
          maskRepeat: "no-repeat",
          WebkitMaskImage: dynamicMask,
          WebkitMaskPosition: `-${entry.x}px -${entry.y}px`,
          WebkitMaskSize: page ? `${page.width}px ${page.height}px` : undefined,
          WebkitMaskRepeat: "no-repeat",
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

  return h("s", {
    class: elementClassName,
    style,
    ...dataAttrs,
    ...domAttrs,
  });
}

export function renderTextureBorderShapePoly({
  entry,
  className,
  style: styleProp,
  domAttrs,
  pointerEvents = "auto",
}: {
  entry: TextureAtlasPlan;
  className?: string;
  style?: CSSProperties;
  domAttrs?: Record<string, unknown>;
  pointerEvents?: "auto" | "none";
}): VNode {
  const fullRect = isFullRectSolid(entry);
  const borderShape = fullRect ? null : cssBorderShapeForPlan(entry);
  const style: CSSProperties = fullRect
    ? {
        width: `${entry.canvasW}px`,
        height: `${entry.canvasH}px`,
        transform: formatMatrix3d(entry.matrix),
        background: entry.shadedColor,
        pointerEvents: pointerEvents === "none" ? "none" : undefined,
        ...styleProp,
      }
    : {
        width: `${entry.canvasW}px`,
        height: `${entry.canvasH}px`,
        transform: formatMatrix3d(entry.matrix),
        color: entry.shadedColor,
        pointerEvents: pointerEvents === "none" ? "none" : undefined,
        ...styleProp,
      };

  const dataAttrs = entry.polygon.data
    ? Object.fromEntries(
        Object.entries(entry.polygon.data).map(([k, v]) => [`data-${k}`, String(v)]),
      )
    : {};
  const elementClassName = className?.trim() || undefined;

  const applyBorderShape = (vnode: VNode) => {
    const el = vnode.el as HTMLElement | null;
    if (!el) return;
    if (borderShape) el.style.setProperty("border-shape", borderShape);
    else el.style.removeProperty("border-shape");
  };

  return h(fullRect ? "b" : "i", {
    class: elementClassName,
    style,
    ...dataAttrs,
    ...domAttrs,
    onVnodeMounted: applyBorderShape,
    onVnodeUpdated: applyBorderShape,
  });
}

export function renderTextureTrianglePoly({
  entry,
  textureLighting,
  className,
  style: styleProp,
  domAttrs,
  pointerEvents = "auto",
}: {
  entry: TextureAtlasPlan;
  textureLighting: PolyTextureLightingMode;
  className?: string;
  style?: CSSProperties;
  domAttrs?: Record<string, unknown>;
  pointerEvents?: "auto" | "none";
}): VNode | null {
  const triangleStyle = solidTriangleStyle(entry, textureLighting, pointerEvents);
  if (!triangleStyle) return null;

  const dataAttrs = entry.polygon.data
    ? Object.fromEntries(
        Object.entries(entry.polygon.data).map(([k, v]) => [`data-${k}`, String(v)]),
      )
    : {};
  const elementClassName = className?.trim() || undefined;

  return h("u", {
    class: elementClassName,
    style: {
      ...triangleStyle,
      ...styleProp,
    },
    ...dataAttrs,
    ...domAttrs,
  });
}
