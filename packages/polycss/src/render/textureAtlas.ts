import type {
  DirectionalLight,
  Polygon,
  TextureLightingMode,
  Vec3,
} from "@polycss/core";

const DEFAULT_TILE = 50;
const DEFAULT_LIGHT_DIR: Vec3 = [0.4, -0.7, 0.59];
const DEFAULT_LIGHT_COLOR = "#ffffff";
const DEFAULT_AMBIENT_COLOR = "#ffffff";
const DEFAULT_AMBIENT = 0.45;
const ATLAS_MAX_SIZE = 4096;
const ATLAS_PADDING = 1;

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

interface TextureAtlasPlan {
  index: number;
  polygon: Polygon;
  texture?: string;
  matrix: string;
  canvasW: number;
  canvasH: number;
  screenPts: number[];
  uvAffine: UvAffine | null;
  textureTint: RGBFactors;
  textureBrightness: number;
  shadedColor: string;
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

interface PackedAtlas {
  entries: Array<PackedTextureAtlasEntry | null>;
  pages: PackedPage[];
}

interface TextureAtlasPage {
  width: number;
  height: number;
  url: string | null;
}

export interface RenderTextureAtlasOptions {
  doc?: Document;
  tileSize?: number;
  layerElevation?: number;
  directionalLight?: DirectionalLight;
  textureLighting?: TextureLightingMode;
}

export interface RenderedPoly {
  polygonIndex: number;
  element: HTMLDivElement;
  dispose(): void;
}

export interface RenderTextureAtlasResult {
  rendered: RenderedPoly[];
  dispose(): void;
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
  }
  return p;
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

function rgbToHex({ r, g, b }: RGB): string {
  const f = (n: number) =>
    Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, "0");
  return `#${f(r)}${f(g)}${f(b)}`;
}

function shadePolygon(
  baseColor: string,
  lambert: number,
  lightColor: string,
  ambientColor: string,
  ambientStrength: number,
): string {
  const base = parseHex(baseColor);
  const light = parseHex(lightColor);
  const amb = parseHex(ambientColor);
  const tintR = (amb.r / 255) * ambientStrength + (light.r / 255) * lambert;
  const tintG = (amb.g / 255) * ambientStrength + (light.g / 255) * lambert;
  const tintB = (amb.b / 255) * ambientStrength + (light.b / 255) * lambert;
  return rgbToHex({
    r: base.r * tintR,
    g: base.g * tintG,
    b: base.b * tintB,
  });
}

function textureTintFactors(
  lambert: number,
  lightColor: string,
  ambientColor: string,
  ambientStrength: number,
): RGBFactors {
  const light = parseHex(lightColor);
  const amb = parseHex(ambientColor);
  return {
    r: (amb.r / 255) * ambientStrength + (light.r / 255) * lambert,
    g: (amb.g / 255) * ambientStrength + (light.g / 255) * lambert,
    b: (amb.b / 255) * ambientStrength + (light.b / 255) * lambert,
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
): void {
  if (
    Math.abs(tint.r - 1) < 0.001 &&
    Math.abs(tint.g - 1) < 0.001 &&
    Math.abs(tint.b - 1) < 0.001
  ) {
    return;
  }
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
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
): void {
  const srcW = img.naturalWidth || img.width || 1;
  const srcH = img.naturalHeight || img.height || 1;
  const scale = Math.max(width / srcW, height / srcH);
  const drawW = srcW * scale;
  const drawH = srcH * scale;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(img, x + (width - drawW) / 2, y + (height - drawH) / 2, drawW, drawH);
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

function computeTextureAtlasPlan(
  polygon: Polygon,
  index: number,
  options: RenderTextureAtlasOptions,
): TextureAtlasPlan | null {
  const { vertices, texture, uvs } = polygon;
  if (!vertices || vertices.length < 3) return null;

  const tile = options.tileSize ?? DEFAULT_TILE;
  const elev = options.layerElevation ?? tile;
  const toCss = (v: Vec3): Vec3 => [v[1] * tile, v[0] * tile, v[2] * elev];
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
  for (const [x, y] of local2D) screenPts.push(x + shiftX, y + shiftY);

  const tx = p0[0] - shiftX * xAxis[0] - shiftY * yAxis[0];
  const ty = p0[1] - shiftX * xAxis[1] - shiftY * yAxis[1];
  const tz = p0[2] - shiftX * xAxis[2] - shiftY * yAxis[2];
  const matrix = [
    xAxis[0], xAxis[1], xAxis[2], 0,
    yAxis[0], yAxis[1], yAxis[2], 0,
    nx, ny, nz, 0,
    tx, ty, tz, 1,
  ].join(",");

  const lightCfg = options.directionalLight;
  const lightDir = lightCfg?.direction ?? DEFAULT_LIGHT_DIR;
  const lightColor = lightCfg?.color ?? DEFAULT_LIGHT_COLOR;
  const ambientColor = lightCfg?.ambientColor ?? DEFAULT_AMBIENT_COLOR;
  const ambient = lightCfg?.ambient ?? DEFAULT_AMBIENT;
  const lLen = Math.hypot(lightDir[0], lightDir[1], lightDir[2]) || 1;
  const lx = lightDir[0] / lLen, ly = lightDir[1] / lLen, lz = lightDir[2] / lLen;
  const direct = Math.max(0, 1 - ambient);
  const lambert = direct * Math.max(0, nx * lx + ny * ly + nz * lz);
  const textureTint = textureTintFactors(lambert, lightColor, ambientColor, ambient);
  const shadedColor = shadePolygon(polygon.color ?? "#cccccc", lambert, lightColor, ambientColor, ambient);

  let uvAffine: UvAffine | null = null;
  if (texture && uvs && uvs.length >= 3 && uvs.length === vertices.length) {
    const [uv0, uv1, uv2] = uvs;
    const sx0 = local2D[0][0] + shiftX, sy0 = local2D[0][1] + shiftY;
    const sx1 = local2D[1][0] + shiftX, sy1 = local2D[1][1] + shiftY;
    const sx2 = local2D[2][0] + shiftX, sy2 = local2D[2][1] + shiftY;
    const u0 = uv0[0], V0 = 1 - uv0[1];
    const u1 = uv1[0], V1 = 1 - uv1[1];
    const u2 = uv2[0], V2 = 1 - uv2[1];
    const du1 = u1 - u0, dV1 = V1 - V0;
    const du2 = u2 - u0, dV2 = V2 - V0;
    const det = du1 * dV2 - du2 * dV1;
    if (Math.abs(det) > 1e-9) {
      const dx1 = sx1 - sx0, dx2 = sx2 - sx0;
      const dy1 = sy1 - sy0, dy2 = sy2 - sy0;
      uvAffine = {
        a: (dx1 * dV2 - dx2 * dV1) / det,
        b: (du1 * dx2 - du2 * dx1) / det,
        c: (dy1 * dV2 - dy2 * dV1) / det,
        d: (du1 * dy2 - du2 * dy1) / det,
        e: 0,
        f: 0,
      };
      uvAffine.e = sx0 - uvAffine.a * u0 - uvAffine.b * V0;
      uvAffine.f = sy0 - uvAffine.c * u0 - uvAffine.d * V0;
    }
  }

  return {
    index,
    polygon,
    texture,
    matrix,
    canvasW: Math.max(1, Math.ceil(w)),
    canvasH: Math.max(1, Math.ceil(h)),
    screenPts,
    uvAffine,
    textureTint,
    textureBrightness: ambient + lambert,
    shadedColor,
  };
}

function packTextureAtlasPlans(plans: Array<TextureAtlasPlan | null>): PackedAtlas {
  const entries: Array<PackedTextureAtlasEntry | null> = Array(plans.length).fill(null);
  const pages: PackedPage[] = [];
  let current: PackedPage = { width: ATLAS_PADDING, height: ATLAS_PADDING, entries: [] };
  let x = ATLAS_PADDING;
  let y = ATLAS_PADDING;
  let rowH = 0;

  const flush = () => {
    if (current.entries.length === 0) return;
    pages.push(current);
    current = { width: ATLAS_PADDING, height: ATLAS_PADDING, entries: [] };
    x = ATLAS_PADDING;
    y = ATLAS_PADDING;
    rowH = 0;
  };

  for (const plan of plans) {
    if (!plan) continue;
    const tooLarge =
      plan.canvasW + ATLAS_PADDING * 2 > ATLAS_MAX_SIZE ||
      plan.canvasH + ATLAS_PADDING * 2 > ATLAS_MAX_SIZE;

    if (tooLarge) {
      flush();
      const pageIndex = pages.length;
      const entry = { ...plan, pageIndex, x: ATLAS_PADDING, y: ATLAS_PADDING };
      entries[plan.index] = entry;
      pages.push({
        width: plan.canvasW + ATLAS_PADDING * 2,
        height: plan.canvasH + ATLAS_PADDING * 2,
        entries: [entry],
      });
      continue;
    }

    if (x + plan.canvasW + ATLAS_PADDING > ATLAS_MAX_SIZE) {
      x = ATLAS_PADDING;
      y += rowH + ATLAS_PADDING;
      rowH = 0;
    }
    if (y + plan.canvasH + ATLAS_PADDING > ATLAS_MAX_SIZE) flush();

    const pageIndex = pages.length;
    const entry = { ...plan, pageIndex, x, y };
    entries[plan.index] = entry;
    current.entries.push(entry);
    current.width = Math.max(current.width, x + plan.canvasW + ATLAS_PADDING);
    current.height = Math.max(current.height, y + plan.canvasH + ATLAS_PADDING);
    x += plan.canvasW + ATLAS_PADDING;
    rowH = Math.max(rowH, plan.canvasH);
  }

  flush();
  return { entries, pages };
}

async function buildAtlasPage(
  page: PackedPage,
  textureLighting: TextureLightingMode,
  doc: Document,
): Promise<TextureAtlasPage> {
  const canvas = doc.createElement("canvas");
  canvas.width = page.width;
  canvas.height = page.height;
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
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = entry.shadedColor;
      ctx.fillRect(entry.x, entry.y, entry.canvasW, entry.canvasH);
    } else if (srcImg && entry.uvAffine) {
      const imgW = srcImg.naturalWidth || srcImg.width || 1;
      const imgH = srcImg.naturalHeight || srcImg.height || 1;
      ctx.setTransform(
        entry.uvAffine.a / imgW, entry.uvAffine.c / imgW,
        entry.uvAffine.b / imgH, entry.uvAffine.d / imgH,
        entry.x + entry.uvAffine.e, entry.y + entry.uvAffine.f,
      );
      ctx.drawImage(srcImg, 0, 0);
    } else if (srcImg) {
      drawImageCover(ctx, srcImg, entry.x, entry.y, entry.canvasW, entry.canvasH);
    }
    if (entry.texture && textureLighting === "baked") {
      applyTextureTint(ctx, entry.x, entry.y, entry.canvasW, entry.canvasH, entry.textureTint);
    }
    ctx.restore();
  }

  return {
    width: page.width,
    height: page.height,
    url: await canvasToUrl(canvas),
  };
}

function applyAtlasBackground(
  el: HTMLElement,
  page: TextureAtlasPage,
): void {
  if (!page.url) return;
  el.style.backgroundImage = `url(${page.url})`;
  el.style.backgroundSize = `${page.width}px ${page.height}px`;
}

function createAtlasElement(
  entry: PackedTextureAtlasEntry,
  textureLighting: TextureLightingMode,
  doc: Document,
): HTMLDivElement {
  const el = doc.createElement("div");
  el.className = [
    "polycss-poly",
    "polycss-poly-loading",
  ].join(" ");
  el.style.width = `${entry.canvasW}px`;
  el.style.height = `${entry.canvasH}px`;
  el.style.transform = `matrix3d(${entry.matrix})`;
  el.style.backgroundPosition = `-${entry.x}px -${entry.y}px`;
  if (entry.texture && textureLighting === "filter") {
    el.style.filter = `brightness(${entry.textureBrightness.toFixed(3)})`;
  }
  if (entry.polygon.data) {
    for (const [k, v] of Object.entries(entry.polygon.data)) {
      el.setAttribute(`data-${k}`, String(v));
    }
  }
  return el;
}

export function renderPolygonsWithTextureAtlas(
  polygons: Polygon[],
  options: RenderTextureAtlasOptions = {},
): RenderTextureAtlasResult {
  const doc = options.doc ?? (typeof document !== "undefined" ? document : null);
  if (!doc) return { rendered: [], dispose: () => {} };

  const textureLighting = options.textureLighting ?? "baked";
  const plans = polygons.map((polygon, index) => computeTextureAtlasPlan(polygon, index, options));
  const packed = packTextureAtlasPlans(plans);
  const atlasElements = new Map<number, HTMLDivElement>();
  const rendered: RenderedPoly[] = [];
  let cancelled = false;
  let urls: string[] = [];

  for (let i = 0; i < polygons.length; i++) {
    const entry = packed.entries[i];
    if (entry) {
      const element = createAtlasElement(entry, textureLighting, doc);
      atlasElements.set(i, element);
      rendered.push({ polygonIndex: i, element, dispose: () => {} });
    }
  }

  Promise.all(packed.pages.map((page) => buildAtlasPage(page, textureLighting, doc)))
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
          applyAtlasBackground(el, built);
          el.classList.remove("polycss-poly-loading");
        }
      }
    })
    .catch(() => {
      for (const element of atlasElements.values()) {
        element.classList.add("polycss-poly-error");
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
