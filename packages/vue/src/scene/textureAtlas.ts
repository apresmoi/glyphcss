import {
  computed,
  h,
  onBeforeUnmount,
  ref,
  watch,
} from "vue";
import type { ComputedRef, CSSProperties, Ref, VNode } from "vue";
import type {
  AmbientLight,
  DirectionalLight,
  Polygon,
  TextureLightingMode,
  Vec3,
} from "@polycss/core";

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

export interface TextureAtlasPlan {
  index: number;
  polygon: Polygon;
  texture?: string;
  matrix: string;
  canvasW: number;
  canvasH: number;
  screenPts: number[];
  uvAffine: UvAffine | null;
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

function atlasArea(pages: PackedPage[]): number {
  return pages.reduce((sum, page) => sum + page.width * page.height, 0);
}

function autoAtlasScale(pages: PackedPage[]): number {
  const area = atlasArea(pages);
  if (area <= AUTO_ATLAS_LOW_AREA) return 1;
  if (area <= AUTO_ATLAS_MEDIUM_AREA) return 0.75;
  return 0.5;
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
  const atlasScale = autoAtlasScale(fullScalePacked.pages);
  if (atlasScale === 1) return { packed: fullScalePacked, atlasScale };
  return { packed: packTextureAtlasPlans(plans, atlasScale), atlasScale };
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
    directionalLight?: DirectionalLight;
    ambientLight?: AmbientLight;
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
  textureLighting: TextureLightingMode,
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
  textureLighting: TextureLightingMode,
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
  textureLighting: ComputedRef<TextureLightingMode>,
  atlasScale: ComputedRef<AtlasScale | undefined> = computed(() => undefined),
): TextureAtlasResult {
  const atlasState = computed(() => packTextureAtlasPlansWithScale(plans.value, atlasScale.value));
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
  textureLighting: TextureLightingMode;
  className?: string;
  style?: CSSProperties;
  domAttrs?: Record<string, unknown>;
  pointerEvents?: "auto" | "none";
}): VNode {
  const dynamic = textureLighting === "dynamic";

  // Dynamic mode: emit ONLY the per-polygon surface normal vars + the
  // alpha mask inline. The calc-driven background-color + blend-mode
  // multiply live in the global stylesheet's
  // `.polycss-scene[data-polycss-lighting="dynamic"] i { ... }` rule, so
  // each <i>'s style stays tiny (~50 chars instead of ~600 — ~12× smaller
  // payload on big meshes). The mask still has to be inline because each
  // polygon has its own atlas position/size.
  const dynamicMask = dynamic && page?.url ? `url(${page.url})` : undefined;

  const style: CSSProperties = {
    width: `${entry.canvasW}px`,
    height: `${entry.canvasH}px`,
    transform: `matrix3d(${entry.matrix})`,
    backgroundImage: page?.url ? `url(${page.url})` : undefined,
    backgroundPosition: `-${entry.x}px -${entry.y}px`,
    backgroundSize: page ? `${page.width}px ${page.height}px` : undefined,
    ...(dynamic
      ? {
          "--polycss-nx": entry.normal[0].toFixed(4),
          "--polycss-ny": entry.normal[1].toFixed(4),
          "--polycss-nz": entry.normal[2].toFixed(4),
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

  return h("i", {
    class: elementClassName,
    style,
    ...dataAttrs,
    ...domAttrs,
  });
}
