import type { Polygon, TextureTriangle, Vec2 } from "../types";
import type { ParseResult } from "./types";

export interface SolidTextureSampleOptions {
  /**
   * Set false to keep every textured polygon texture-backed. Defaults to true
   * when a browser-like Image + canvas environment is available.
   */
  enabled?: boolean;
  /** Per-channel tolerance for declaring sampled texels uniform. Default 2. */
  colorTolerance?: number;
  /** Skip decoding very large textures for this optimization. Default 16 MP. */
  maxTexturePixels?: number;
}

interface ImageLike {
  src: string;
  decoding?: string;
  naturalWidth?: number;
  naturalHeight?: number;
  width?: number;
  height?: number;
  onload: (() => void) | null;
  onerror: (() => void) | null;
  decode?: () => Promise<void>;
}

interface CanvasLike {
  width: number;
  height: number;
  getContext(type: "2d", options?: unknown): CanvasContextLike | null;
}

interface CanvasContextLike {
  drawImage(...args: unknown[]): void;
  getImageData(x: number, y: number, width: number, height: number): { data: ArrayLike<number> };
}

interface BrowserTextureSamplingEnv {
  Image: new () => ImageLike;
  createCanvas(): CanvasLike;
}

interface SampledColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

interface TextureSampler {
  width: number;
  height: number;
  data: ArrayLike<number>;
  lowDetail: boolean;
}

interface ColorStats {
  min: SampledColor;
  max: SampledColor;
  sum: SampledColor;
  count: number;
}

const DEFAULT_MAX_TEXTURE_PIXELS = 16 * 1024 * 1024;
const DEFAULT_COLOR_TOLERANCE = 2;
const SMOOTH_SWATCH_TOLERANCE = 32;
const DETAIL_SAMPLE_TARGET = 128;
const DETAIL_EDGE_THRESHOLD = 32;
const LOW_DETAIL_MAX_EDGE_RATIO = 0.045;
const LOW_DETAIL_MAX_AVERAGE_DELTA = 10;
const TRIANGLE_GRID_STEPS = 6;

function textureForPolygon(polygon: Polygon): string | undefined {
  return polygon.material?.texture ?? polygon.texture;
}

function getTextureSamplingEnv(): BrowserTextureSamplingEnv | null {
  const g = globalThis as unknown as {
    Image?: new () => ImageLike;
    document?: { createElement?: (tagName: string) => unknown };
  };
  if (typeof g.Image !== "function" || typeof g.document?.createElement !== "function") {
    return null;
  }
  return {
    Image: g.Image,
    createCanvas(): CanvasLike {
      return g.document!.createElement!("canvas") as CanvasLike;
    },
  };
}

function loadImage(url: string, ImageCtor: new () => ImageLike): Promise<ImageLike> {
  return new Promise((resolve, reject) => {
    const img = new ImageCtor();
    let settled = false;
    const done = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      fn();
    };
    img.decoding = "async";
    img.onload = () => done(() => resolve(img));
    img.onerror = () => done(() => reject(new Error(`texture load failed: ${url}`)));
    img.src = url;
    if (typeof img.decode === "function") {
      img.decode().then(
        () => done(() => resolve(img)),
        () => {
          // Keep the onload/onerror path authoritative for older/fake images.
        },
      );
    }
  });
}

async function createSampler(
  url: string,
  env: BrowserTextureSamplingEnv,
  maxTexturePixels: number,
): Promise<TextureSampler | null> {
  try {
    const img = await loadImage(url, env.Image);
    const width = Math.max(0, Math.floor(img.naturalWidth || img.width || 0));
    const height = Math.max(0, Math.floor(img.naturalHeight || img.height || 0));
    if (width <= 0 || height <= 0 || width * height > maxTexturePixels) return null;

    const canvas = env.createCanvas();
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, width, height);
    const data = ctx.getImageData(0, 0, width, height).data;
    return { width, height, data, lowDetail: isLowDetailTexture(width, height, data) };
  } catch {
    return null;
  }
}

function maxRgbDeltaAt(
  data: ArrayLike<number>,
  width: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  const a = (y1 * width + x1) * 4;
  const b = (y2 * width + x2) * 4;
  return Math.max(
    Math.abs((data[a] ?? 0) - (data[b] ?? 0)),
    Math.abs((data[a + 1] ?? 0) - (data[b + 1] ?? 0)),
    Math.abs((data[a + 2] ?? 0) - (data[b + 2] ?? 0)),
  );
}

function isLowDetailTexture(width: number, height: number, data: ArrayLike<number>): boolean {
  const step = Math.max(1, Math.floor(Math.max(width, height) / DETAIL_SAMPLE_TARGET));
  let total = 0;
  let edgeCount = 0;
  let deltaSum = 0;

  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      if (x + step < width) {
        const delta = maxRgbDeltaAt(data, width, x, y, x + step, y);
        deltaSum += delta;
        total++;
        if (delta > DETAIL_EDGE_THRESHOLD) edgeCount++;
      }
      if (y + step < height) {
        const delta = maxRgbDeltaAt(data, width, x, y, x, y + step);
        deltaSum += delta;
        total++;
        if (delta > DETAIL_EDGE_THRESHOLD) edgeCount++;
      }
    }
  }

  return total > 0 &&
    edgeCount / total <= LOW_DETAIL_MAX_EDGE_RATIO &&
    deltaSum / total <= LOW_DETAIL_MAX_AVERAGE_DELTA;
}

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function sampleUv(sampler: TextureSampler, uv: Vec2): SampledColor | null {
  const u = uv[0];
  const imageV = 1 - uv[1];
  if (!Number.isFinite(u) || !Number.isFinite(imageV)) return null;
  const x = clampInt(Math.floor(u * sampler.width), 0, sampler.width - 1);
  const y = clampInt(Math.floor(imageV * sampler.height), 0, sampler.height - 1);
  const offset = (y * sampler.width + x) * 4;
  return {
    r: sampler.data[offset] ?? 0,
    g: sampler.data[offset + 1] ?? 0,
    b: sampler.data[offset + 2] ?? 0,
    a: sampler.data[offset + 3] ?? 255,
  };
}

function mixUv(a: Vec2, b: Vec2, c: Vec2, wa: number, wb: number, wc: number): Vec2 {
  return [
    a[0] * wa + b[0] * wb + c[0] * wc,
    a[1] * wa + b[1] * wb + c[1] * wc,
  ];
}

function triangleSampleUvs(uvs: readonly [Vec2, Vec2, Vec2]): Vec2[] {
  const [a, b, c] = uvs;
  return [
    mixUv(a, b, c, 1 / 3, 1 / 3, 1 / 3),
    mixUv(a, b, c, 0.8, 0.1, 0.1),
    mixUv(a, b, c, 0.1, 0.8, 0.1),
    mixUv(a, b, c, 0.1, 0.1, 0.8),
    mixUv(a, b, c, 0.45, 0.45, 0.1),
    mixUv(a, b, c, 0.45, 0.1, 0.45),
    mixUv(a, b, c, 0.1, 0.45, 0.45),
  ];
}

function triangleGridSampleUvs(uvs: readonly [Vec2, Vec2, Vec2]): Vec2[] {
  const [a, b, c] = uvs;
  const out = triangleSampleUvs(uvs);
  for (let wa = 1; wa < TRIANGLE_GRID_STEPS; wa++) {
    for (let wb = 1; wb < TRIANGLE_GRID_STEPS - wa; wb++) {
      const wc = TRIANGLE_GRID_STEPS - wa - wb;
      if (wc <= 0) continue;
      out.push(mixUv(
        a,
        b,
        c,
        wa / TRIANGLE_GRID_STEPS,
        wb / TRIANGLE_GRID_STEPS,
        wc / TRIANGLE_GRID_STEPS,
      ));
    }
  }
  return out;
}

function polygonTextureTriangles(polygon: Polygon): Array<Pick<TextureTriangle, "uvs">> {
  if (polygon.textureTriangles?.length) return polygon.textureTriangles;
  const uvs = polygon.uvs;
  if (!uvs || uvs.length !== polygon.vertices.length || uvs.length < 3) return [];
  const triangles: Array<Pick<TextureTriangle, "uvs">> = [];
  for (let i = 1; i + 1 < uvs.length; i++) {
    triangles.push({
      uvs: [
        uvs[0],
        uvs[i],
        uvs[i + 1],
      ],
    });
  }
  return triangles;
}

function colorsClose(a: SampledColor, b: SampledColor, tolerance: number): boolean {
  return (
    Math.abs(a.r - b.r) <= tolerance &&
    Math.abs(a.g - b.g) <= tolerance &&
    Math.abs(a.b - b.b) <= tolerance &&
    Math.abs(a.a - b.a) <= tolerance
  );
}

function colorToCss(color: SampledColor): string {
  const hex = (value: number) =>
    Math.round(Math.max(0, Math.min(255, value))).toString(16).padStart(2, "0");
  if (color.a >= 255) return `#${hex(color.r)}${hex(color.g)}${hex(color.b)}`;
  const alpha = Math.round((Math.max(0, Math.min(255, color.a)) / 255) * 1000) / 1000;
  return `rgba(${Math.round(color.r)}, ${Math.round(color.g)}, ${Math.round(color.b)}, ${alpha})`;
}

function createColorStats(): ColorStats {
  return {
    min: { r: 255, g: 255, b: 255, a: 255 },
    max: { r: 0, g: 0, b: 0, a: 0 },
    sum: { r: 0, g: 0, b: 0, a: 0 },
    count: 0,
  };
}

function addColor(stats: ColorStats, color: SampledColor): void {
  stats.min.r = Math.min(stats.min.r, color.r);
  stats.min.g = Math.min(stats.min.g, color.g);
  stats.min.b = Math.min(stats.min.b, color.b);
  stats.min.a = Math.min(stats.min.a, color.a);
  stats.max.r = Math.max(stats.max.r, color.r);
  stats.max.g = Math.max(stats.max.g, color.g);
  stats.max.b = Math.max(stats.max.b, color.b);
  stats.max.a = Math.max(stats.max.a, color.a);
  stats.sum.r += color.r;
  stats.sum.g += color.g;
  stats.sum.b += color.b;
  stats.sum.a += color.a;
  stats.count++;
}

function statsColor(stats: ColorStats): SampledColor {
  return {
    r: stats.sum.r / stats.count,
    g: stats.sum.g / stats.count,
    b: stats.sum.b / stats.count,
    a: stats.sum.a / stats.count,
  };
}

function solidColorForPolygon(
  polygon: Polygon,
  sampler: TextureSampler,
  tolerance: number,
  explicitTolerance: boolean,
): string | null {
  const triangles = polygonTextureTriangles(polygon);
  if (triangles.length === 0) return null;
  if (!explicitTolerance && !sampler.lowDetail) return null;

  const stats = createColorStats();

  for (const triangle of triangles) {
    for (const uv of triangleGridSampleUvs(triangle.uvs)) {
      const color = sampleUv(sampler, uv);
      if (!color) return null;
      addColor(stats, color);
    }
  }

  if (stats.count === 0) return null;
  if (colorsClose(stats.min, stats.max, tolerance)) return colorToCss(statsColor(stats));
  if (explicitTolerance) return null;
  if (!colorsClose(stats.min, stats.max, SMOOTH_SWATCH_TOLERANCE)) return null;
  return colorToCss(statsColor(stats));
}

function bakePolygon(polygon: Polygon, color: string): Polygon {
  const {
    texture: _texture,
    material: _material,
    uvs: _uvs,
    textureTriangles: _textureTriangles,
    ...rest
  } = polygon;
  return {
    ...rest,
    color,
  };
}

interface SolidTextureBaker {
  bake(polygons: Polygon[]): { polygons: Polygon[]; changed: boolean };
}

async function createSolidTextureBaker(
  polygons: Polygon[],
  options: SolidTextureSampleOptions = {},
): Promise<SolidTextureBaker | null> {
  if (options.enabled === false) return null;
  const env = getTextureSamplingEnv();
  if (!env) return null;

  const candidates = polygons.filter((polygon) =>
    textureForPolygon(polygon) && polygonTextureTriangles(polygon).length > 0
  );
  if (candidates.length === 0) return null;

  const maxTexturePixels = options.maxTexturePixels ?? DEFAULT_MAX_TEXTURE_PIXELS;
  const samplerByTexture = new Map<string, TextureSampler | null>();
  await Promise.all(
    Array.from(new Set(candidates.map((polygon) => textureForPolygon(polygon)!))).map(async (texture) => {
      samplerByTexture.set(texture, await createSampler(texture, env, maxTexturePixels));
    }),
  );

  const tolerance = options.colorTolerance ?? DEFAULT_COLOR_TOLERANCE;
  const explicitTolerance = options.colorTolerance !== undefined;
  return {
    bake(nextPolygons: Polygon[]): { polygons: Polygon[]; changed: boolean } {
      let changed = false;
      const baked = nextPolygons.map((polygon) => {
        const texture = textureForPolygon(polygon);
        if (!texture) return polygon;
        const sampler = samplerByTexture.get(texture);
        if (!sampler) return polygon;
        const color = solidColorForPolygon(polygon, sampler, tolerance, explicitTolerance);
        if (!color) return polygon;
        changed = true;
        return bakePolygon(polygon, color);
      });
      return { polygons: changed ? baked : nextPolygons, changed };
    },
  };
}

export async function bakeSolidTextureSampledPolygons(
  polygons: Polygon[],
  options: SolidTextureSampleOptions = {},
): Promise<Polygon[]> {
  const baker = await createSolidTextureBaker(polygons, options);
  if (!baker) return polygons;
  return baker.bake(polygons).polygons;
}

export async function bakeSolidTextureSamples(
  result: ParseResult,
  options: SolidTextureSampleOptions = {},
): Promise<ParseResult> {
  const baker = await createSolidTextureBaker(result.polygons, options);
  if (!baker) return result;

  const baked = baker.bake(result.polygons);
  if (!baked.changed && !result.animation) return result;

  return {
    ...result,
    polygons: baked.polygons,
    animation: result.animation
      ? {
          ...result.animation,
          sample(clip, timeSeconds) {
            return baker.bake(result.animation!.sample(clip, timeSeconds)).polygons;
          },
        }
      : result.animation,
  };
}
