import type { GridContext, RenderState, Voxel, CubeFace, WallsMask } from "../types";
import { computeCubeFaceAppearance } from "../cubeFaceAppearance";

export interface PlaneShellSnapshot { layers: Voxel[][]; context: GridContext; }

export interface PlaneShellDomState {
  zHost: HTMLElement;
  xHost: HTMLElement;
  yHost: HTMLElement;
  zPool: Element[];
  xPool: Element[];
  yPool: Element[];
  faceCache: Map<string, FacePlan>;
  faceBrushCache: Map<string, unknown>;
  cacheLighting: GridContext["lighting"] | null;
  cacheResolveTexture: GridContext["resolveTexture"] | null;
  cacheOffsets: GridContext["offsets"] | null;
  cacheTileSize: number;
  cacheLayerElevation: number;
  cacheRows: number;
  cacheCols: number;
  cacheDepth: number;
  cacheWallsSig: number;
  cacheRenderVersion: number | null;
  cacheLayersRef: Voxel[][] | null;
  lastFaces: FacePlan[] | null;
  lastDebugSig: number;
  warnedUnstableLayers?: boolean;
}

export type PlaneShellAxis = "x" | "y" | "z";
export interface FaceKey { axis: PlaneShellAxis; plane: number; face: CubeFace; }
export interface FaceBuffer {
  width: number;
  height: number;
  minRow: number;
  minCol: number;
  maxRow: number;
  maxCol: number;
  ids: Uint32Array;
  mask: Uint8Array;
  palette: string[];
}
export interface FaceData { key: FaceKey; buffer: FaceBuffer; signatureHash: number; fillCells: number; }
export interface HostRect { r0: number; c0: number; r1: number; c1: number; transparent?: boolean; }
export interface DetailPlan {
  colorId: number;
  path: string;
  rects?: HostRect[];
  fill: string;
  rectsCache?: { x: number; y: number; width: number; height: number }[];
}
export interface HostPlan { r0: number; c0: number; r1: number; c1: number; baseColorId: number; details: DetailPlan[]; detailSig?: string; }
export interface FacePlan { key: FaceKey; originRow: number; originCol: number; palette: string[]; signatureHash: number; hosts: HostPlan[]; fallback: boolean; }

type VoxcssTune = Partial<{
  baseCoverMin: number;
  fragmentationLimit: number;
  detailColorLimit: number;
  minHostArea: number;
  maxBrushesPerHost: number;
  mergePasses: number;
  hostCap: number;
  maxSplitDepth: number;
  maxSplitsPerHost: number;
  splitCandidateLimit: number;
  maxSplitsPerFace: number;
  maxHostsPerFace: number;
}>;

const voxcssTune: VoxcssTune | null = (() => {
  if (typeof globalThis === "undefined") return null;
  const raw = (globalThis as { __voxcssTune?: unknown }).__voxcssTune;
  if (!raw || typeof raw !== "object") return null;
  return raw as VoxcssTune;
})();

const tuneNumber = (key: keyof VoxcssTune, fallback: number): number => {
  const value = voxcssTune?.[key];
  return Number.isFinite(value) ? Number(value) : fallback;
};

export const NEW_SHELL_VERSION = 1;
export const HOST_CAP = tuneNumber("hostCap", 1500);
export const BASE_COVER_MIN = tuneNumber("baseCoverMin", 0.3);
export const HOST_FILL_RATIO_MIN = 0.6;
export const HOST_GAP_MAX = 64;
export const DETAIL_COLOR_LIMIT = tuneNumber("detailColorLimit", 4);
export const DETAIL_COLOR_LIMIT_TRANSPARENT = 8;
export const MAX_SPLIT_DEPTH = tuneNumber("maxSplitDepth", 2);
export const MAX_SPLITS_PER_HOST = tuneNumber("maxSplitsPerHost", 2);
export const MAX_SPLITS_PER_FACE = tuneNumber("maxSplitsPerFace", 400);
export const MAX_HOSTS_PER_FACE = tuneNumber("maxHostsPerFace", 8000);
export const MIN_HOST_AREA = tuneNumber("minHostArea", 8);
export const FRAGMENTATION_LIMIT = tuneNumber("fragmentationLimit", 400);
export const SPLIT_CANDIDATE_LIMIT = tuneNumber("splitCandidateLimit", 4);
export const MAX_BRUSHES_PER_HOST = tuneNumber("maxBrushesPerHost", 1);
export const COMBO_MIN_AREA = 16;
export const STAMP_BUCKET_SIZE = 16;
export const STAMP_MAX_OFFSET = 12;
export const STAMP_MAX_PSEUDO_SPAN = 64;
export const STAMP_MAX_BLEED_AREA = 2048;
export const STAMP_MAX_OFFSET_RELAXED = 20;
export const STAMP_MAX_PSEUDO_SPAN_RELAXED = 96;
export const STAMP_MAX_BLEED_AREA_RELAXED = 3072;
export const SVG_NS = "http://www.w3.org/2000/svg";
export const MAX_MERGE_SPAN = 64;
export const MAX_MERGE_AREA = 4096;
export const MAX_OVERLAP_GAP = 8;
export const MAX_OVERLAP_CANDIDATES_PER_BRUSH = 24;
export const MAX_OVERLAP_MERGES_PER_PASS = 256;
export const MAX_OVERLAP_PASSES = tuneNumber("mergePasses", 2);
export const MAX_OVERLAP_COLORS = 12;
export const PLANE_SHELL_DEV_VERIFY = false;
export const wallsToSig = (walls: WallsMask): number =>
  (walls.t ? 1 : 0) |
  (walls.b ? 2 : 0) |
  (walls.bl ? 4 : 0) |
  (walls.br ? 8 : 0) |
  (walls.fl ? 16 : 0) |
  (walls.fr ? 32 : 0);

export const setAttrIfDiff = (el: Element, name: string, value: string): void => {
  const anyEl = el as Record<string, unknown>;
  const cache = (anyEl.__voxcssAttrCache ?? (anyEl.__voxcssAttrCache = Object.create(null))) as Record<string, string>;
  if (cache[name] === value) return;
  el.setAttribute(name, value);
  cache[name] = value;
};

export const setStyleIfDiff = (el: HTMLElement | SVGElement, name: string, value: string): void => {
  const anyEl = el as Record<string, unknown>;
  const cache = (anyEl.__voxcssStyleCache ?? (anyEl.__voxcssStyleCache = Object.create(null))) as Record<string, string>;
  if (cache[name] === value) return;
  (el as any).style[name] = value;
  cache[name] = value;
};

export const setDatasetIfDiff = (el: HTMLElement, name: string, value: string): void => {
  const anyEl = el as Record<string, unknown>;
  const cache = (anyEl.__voxcssDatasetCache ?? (anyEl.__voxcssDatasetCache = Object.create(null))) as Record<string, string>;
  if (cache[name] === value) return;
  (el.dataset as Record<string, string>)[name] = value;
  cache[name] = value;
};

export const setCssVarIfDiff = (el: HTMLElement, name: string, value: string): void => {
  const anyEl = el as Record<string, unknown>;
  const cache = (anyEl.__voxcssVarCache ?? (anyEl.__voxcssVarCache = Object.create(null))) as Record<string, string>;
  if (cache[name] === value) return;
  el.style.setProperty(name, value);
  cache[name] = value;
};

export const clearCssVar = (el: HTMLElement, name: string): void => {
  const anyEl = el as Record<string, unknown>;
  const cache = (anyEl.__voxcssVarCache ?? (anyEl.__voxcssVarCache = Object.create(null))) as Record<string, string>;
  if (cache[name] === undefined && !el.style.getPropertyValue(name)) return;
  delete cache[name];
  el.style.removeProperty(name);
};

export const clearPlaneDetailVars = (quad: HTMLElement): void => {
  clearCssVar(quad, "--vox-bc");
  clearCssVar(quad, "--vox-bl");
  clearCssVar(quad, "--vox-bt");
  clearCssVar(quad, "--vox-bw");
  clearCssVar(quad, "--vox-bh");
  clearCssVar(quad, "--vox-bcol");
  clearCssVar(quad, "--vox-ac");
  clearCssVar(quad, "--vox-al");
  clearCssVar(quad, "--vox-at");
  clearCssVar(quad, "--vox-aw");
  clearCssVar(quad, "--vox-ah");
  clearCssVar(quad, "--vox-acol");
  clearCssVar(quad, "--vox-z");
};

const parseSimpleRectPath = (path: string): { x: number; y: number; width: number; height: number } | null => {
  const match = path.match(/^M([\d.]+)\s+([\d.]+)H([\d.]+)V([\d.]+)H\1Z$/);
  if (!match) return null;
  const x0 = Number(match[1]);
  const y0 = Number(match[2]);
  const x1 = Number(match[3]);
  const y1 = Number(match[4]);
  if (!Number.isFinite(x0) || !Number.isFinite(y0) || !Number.isFinite(x1) || !Number.isFinite(y1)) return null;
  if (x1 <= x0 || y1 <= y0) return null;
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
};

const rectFromHostRect = (rect?: HostRect): { x: number; y: number; width: number; height: number } | null => {
  if (!rect) return null;
  const width = rect.c1 - rect.c0;
  const height = rect.r1 - rect.r0;
  if (width <= 0 || height <= 0) return null;
  return { x: rect.c0, y: rect.r0, width, height };
};

export const getDetailRects = (detail?: DetailPlan): { x: number; y: number; width: number; height: number }[] => {
  if (!detail) return [];
  if (detail.rectsCache) return detail.rectsCache;
  if (detail.rects?.length) {
    const rects: { x: number; y: number; width: number; height: number }[] = [];
    for (const rect of detail.rects) {
      const mapped = rectFromHostRect(rect);
      if (mapped) rects.push(mapped);
    }
    detail.rectsCache = rects;
    return rects;
  }
  const parsed = parseSimpleRectPath(detail.path);
  const cached = parsed ? [parsed] : [];
  detail.rectsCache = cached;
  return cached;
};

export const STAMP_FACE_Z_OFFSET: Record<CubeFace, number> = {
  t: 0.12,
  b: 0.12,
  fr: -0.12,
  fl: -0.12,
  br: 0.12,
  bl: 0.12
};
export const formatZOffset = (value: number): string => `${value.toFixed(3)}px`;

export const HASH_SEED = 2166136261;
const HASH_PRIME = 16777619;
export const hashUpdate = (hash: number, value: number): number => Math.imul(hash ^ value, HASH_PRIME) >>> 0;
export const hashNumber = (hash: number, value: number): number => {
  let v = value >>> 0;
  hash = hashUpdate(hash, v & 0xff);
  hash = hashUpdate(hash, (v >>> 8) & 0xff);
  hash = hashUpdate(hash, (v >>> 16) & 0xff);
  hash = hashUpdate(hash, (v >>> 24) & 0xff);
  return hash;
};
export const hashString = (hash: number, value: string): number => {
  for (let i = 0; i < value.length; i += 1) hash = hashUpdate(hash, value.charCodeAt(i));
  return hash;
};

let __colorParserStyle: CSSStyleDeclaration | null = null;
const __colorCache = new Map<string, { r: number; g: number; b: number } | null>();

const getColorParserStyle = (): CSSStyleDeclaration | null => {
  if (typeof document === "undefined") return null;
  if (__colorParserStyle) return __colorParserStyle;
  const style = new Option().style;
  __colorParserStyle = style;
  return style;
};

const normalizeCssColor = (rawColor: string, brightness: number): { r: number; g: number; b: number } | null => {
  const parser = getColorParserStyle();
  if (!parser) return null;
  parser.color = rawColor;
  const computed = parser.color;
  if (!computed) return null;
  const match = computed.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+)\s*)?\)$/i);
  if (!match) return null;
  const rRaw = Number(match[1]);
  const gRaw = Number(match[2]);
  const bRaw = Number(match[3]);
  const aRaw = match[4] !== undefined ? Number(match[4]) : 1;
  if (!Number.isFinite(rRaw) || !Number.isFinite(gRaw) || !Number.isFinite(bRaw) || !Number.isFinite(aRaw)) return null;
  if (aRaw < 1) return null;
  const clamp = (value: number): number => Math.max(0, Math.min(255, Math.round(value)));
  const r = clamp(rRaw * brightness);
  const g = clamp(gRaw * brightness);
  const b = clamp(bRaw * brightness);
  return { r, g, b };
};

function getAppearanceColorKey(
  voxel: Voxel,
  face: CubeFace,
  context: GridContext
): { r: number; g: number; b: number } | null {
  const appearance = computeCubeFaceAppearance(voxel, face, context);
  if (appearance.backgroundImage) return null;
  const rawFilter = appearance.filter.trim();
  let brightness = 1;
  if (rawFilter) {
    const match = rawFilter.match(/^brightness\(\s*([^)]+)\s*\)$/i);
    if (!match) return null;
    const body = (match[1] ?? "").trim();
    if (!body) return null;
    if (body.endsWith("%")) {
      const pct = Number(body.slice(0, -1));
      if (!Number.isFinite(pct)) return null;
      brightness = Math.max(0, pct / 100);
    } else {
      const scalar = Number(body);
      if (!Number.isFinite(scalar)) return null;
      brightness = Math.max(0, scalar);
    }
  }
  const rawColor = appearance.backgroundColor.trim();
  if (!rawColor) return null;
  const cacheKey = `${rawColor}||${brightness}`;
  if (__colorCache.has(cacheKey)) {
    const cached = __colorCache.get(cacheKey);
    return cached ? { r: cached.r, g: cached.g, b: cached.b } : null;
  }
  const normalized = normalizeCssColor(rawColor, brightness);
  __colorCache.set(cacheKey, normalized);
  if (!normalized) return null;
  return { r: normalized.r, g: normalized.g, b: normalized.b };
}

export function buildFaceBufferFromCells(
  cells: { row: number; col: number; voxel: Voxel }[],
  minRow: number,
  minCol: number,
  maxRow: number,
  maxCol: number,
  face: CubeFace,
  context: GridContext
): { buffer: FaceBuffer; signatureHash: number; fillCells: number } | null {
  const width = maxCol - minCol + 1;
  const height = maxRow - minRow + 1;
  if (width <= 0 || height <= 0) return null;

  const ids = new Uint32Array(width * height);
  const palette: string[] = [""];
  const colorIndex = new Map<string, number>();
  let fillCells = 0;
  let hash = HASH_SEED;

  for (const cell of cells) {
    const rowOffset = cell.row - minRow;
    const colOffset = cell.col - minCol;
    if (rowOffset < 0 || colOffset < 0 || rowOffset >= height || colOffset >= width) continue;
    const index = rowOffset * width + colOffset;

    const colorInfo = getAppearanceColorKey(cell.voxel, face, context);
    if (!colorInfo) continue;
    const colorKey = `${colorInfo.r},${colorInfo.g},${colorInfo.b},255`;
    let colorId = colorIndex.get(colorKey);
    if (colorId === undefined) {
      colorId = palette.length;
      colorIndex.set(colorKey, colorId);
      palette.push(`rgb(${colorInfo.r}, ${colorInfo.g}, ${colorInfo.b})`);
    }
    if (!ids[index]) fillCells += 1;
    ids[index] = colorId;
    hash = hashString(hashNumber(hashNumber(hash, cell.row), cell.col), colorKey);
  }

  if (!fillCells) return null;
  const mask = new Uint8Array(ids.length);
  for (let i = 0; i < ids.length; i += 1) mask[i] = ids[i] ? 1 : 0;

  return {
    buffer: {
      width,
      height,
      minRow,
      minCol,
      maxRow,
      maxCol,
      ids,
      mask,
      palette
    },
    signatureHash: hash,
    fillCells
  };
}

export const makeRectEngine = (width: number, height: number) => {
  const hist = new Int32Array(width);
  const stack = new Int32Array(width + 1);

  const forEachRectRuns = (
    r0: number,
    c0: number,
    r1: number,
    c1: number,
    isOn: (idx: number) => boolean,
    onRect: (rr0: number, rc0: number, rr1: number, rc1: number) => void
  ): void => {
    const openStore: number[] = [];
    const open = new Map<number, number>();
    const keyFor = (runC0: number, runC1: number): number =>
      runC0 * (width + 1) + runC1;
    const closeRectAt = (index: number): void => {
      onRect(openStore[index], openStore[index + 1], openStore[index + 2], openStore[index + 3]);
    };

    for (let r = r0; r < r1; r += 1) {
      const nextOpen = new Map<number, number>();
      const rowBase = r * width;
      let c = c0;
      while (c < c1) {
        while (c < c1 && !isOn(rowBase + c)) c += 1;
        if (c >= c1) break;
        const runC0 = c;
        while (c < c1 && isOn(rowBase + c)) c += 1;
        const runC1 = c;
        const key = keyFor(runC0, runC1);
        const prevIndex = open.get(key);
        if (prevIndex !== undefined && openStore[prevIndex + 2] === r) {
          openStore[prevIndex + 2] = r + 1;
          nextOpen.set(key, prevIndex);
        } else {
          const index = openStore.length;
          openStore.push(r, runC0, r + 1, runC1);
          nextOpen.set(key, index);
        }
      }

      for (const [key, index] of open) {
        if (!nextOpen.has(key)) closeRectAt(index);
      }

      open.clear();
      for (const [key, index] of nextOpen) open.set(key, index);
    }

    for (const index of open.values()) closeRectAt(index);
  };

  const maxRectInMask = (mask: Uint8Array): [number, number, number, number, number] => {
    hist.fill(0);
    let bestArea = 0;
    let bestR0 = 0;
    let bestC0 = 0;
    let bestR1 = 0;
    let bestC1 = 0;

    for (let r = 0; r < height; r += 1) {
      const rowBase = r * width;
      for (let c = 0; c < width; c += 1) {
        hist[c] = mask[rowBase + c] ? hist[c] + 1 : 0;
      }

      let stackTop = 0;
      for (let c = 0; c <= width; c += 1) {
        const h = c === width ? 0 : hist[c];
        while (stackTop > 0 && h < hist[stack[stackTop - 1]]) {
          const heightValue = hist[stack[stackTop - 1]];
          stackTop -= 1;
          const leftIndex = stackTop > 0 ? stack[stackTop - 1] : -1;
          const area = heightValue * (c - leftIndex - 1);
          if (area > bestArea) {
            bestArea = area;
            bestR1 = r + 1;
            bestR0 = bestR1 - heightValue;
            bestC1 = c;
            bestC0 = leftIndex + 1;
          }
        }
        stack[stackTop] = c;
        stackTop += 1;
      }
    }

    return [bestR0, bestC0, bestR1, bestC1, bestArea];
  };

  const maxRects = (mask: Uint8Array, limit: number, fillCells: number): { rects: HostRect[]; coveredAll: boolean } => {
    const rects: HostRect[] = [];
    const working = mask.slice();
    let remaining = fillCells;
    const clearRect = (r0: number, c0: number, r1: number, c1: number): void => {
      for (let r = r0; r < r1; r += 1) {
        const rowBase = r * width;
        for (let c = c0; c < c1; c += 1) working[rowBase + c] = 0;
      }
    };
    while (rects.length < limit) {
      const [r0, c0, r1, c1, area] = maxRectInMask(working);
      if (!area) break;
      rects.push({ r0, c0, r1, c1 });
      clearRect(r0, c0, r1, c1);
      remaining -= area;
      if (remaining > 0) {
        const minRects = Math.ceil(remaining / area);
        if (rects.length + minRects > limit) return { rects, coveredAll: false };
      }
    }
    return { rects, coveredAll: remaining <= 0 };
  };

  return { forEachRectRuns, maxRects };
};

export const buildSolidSvgPath = (rects: { r0: number; c0: number; r1: number; c1: number }[]): string => {
  if (!rects.length) return "";
  const pathParts: string[] = [];
  for (const rect of rects) {
    pathParts.push(`M${rect.c0} ${rect.r0}H${rect.c1}V${rect.r1}H${rect.c0}Z`);
  }
  return pathParts.join("");
};

export const buildMaskPsum = (mask: Uint8Array, width: number, height: number): Uint32Array => {
  const psum = new Uint32Array((width + 1) * (height + 1));
  for (let r = 1; r <= height; r += 1) {
    const rowBase = (r - 1) * width;
    const psumRow = r * (width + 1);
    const psumPrev = (r - 1) * (width + 1);
    for (let c = 1; c <= width; c += 1) {
      const idx = rowBase + (c - 1);
      const value = mask[idx] ? 1 : 0;
      psum[psumRow + c] = psum[psumPrev + c] + psum[psumRow + c - 1] - psum[psumPrev + c - 1] + value;
    }
  }
  return psum;
};

export const sumRectFromPsum = (psum: Uint32Array, width: number, r0: number, c0: number, r1: number, c1: number): number => {
  const stride = width + 1;
  return psum[r1 * stride + c1] - psum[r0 * stride + c1] - psum[r1 * stride + c0] + psum[r0 * stride + c0];
};

export const mergeHostRects = (
  rects: HostRect[],
  psum: Uint32Array,
  width: number,
  height: number
): HostRect[] => {
  const getRectFillStats = (r0: number, c0: number, r1: number, c1: number): { area: number; filled: number; fillRatio: number; emptyCells: number } | null => {
    const area = Math.max(0, r1 - r0) * Math.max(0, c1 - c0);
    if (!area) return null;
    if (r0 < 0 || c0 < 0 || r1 > height || c1 > width) return null;
    const filled = sumRectFromPsum(psum, width, r0, c0, r1, c1);
    const emptyCells = area - filled;
    const fillRatio = area ? filled / area : 0;
    return { area, filled, fillRatio, emptyCells };
  };
  const canMerge = (r0: number, c0: number, r1: number, c1: number): { transparent: boolean } | null => {
    const stats = getRectFillStats(r0, c0, r1, c1);
    if (!stats) return null;
    if (stats.fillRatio >= HOST_FILL_RATIO_MIN || stats.emptyCells <= HOST_GAP_MAX) {
      return { transparent: stats.filled < stats.area };
    }
    return null;
  };
  let current = rects.slice();
  for (let iter = 0; iter < 3; iter += 1) {
    if (current.length < 2) break;
    current.sort((a, b) => (a.r0 !== b.r0 ? a.r0 - b.r0 : a.r1 - b.r1 || a.c0 - b.c0 || a.c1 - b.c1));
    const horiz: HostRect[] = [];
    for (const rect of current) {
      const last = horiz[horiz.length - 1];
      if (last && rect.r0 === last.r0 && rect.r1 === last.r1 && rect.c0 === last.c1) {
        const r0 = last.r0;
        const c0 = last.c0;
        const r1 = last.r1;
        const c1 = rect.c1;
        const merged = canMerge(r0, c0, r1, c1);
        if (merged) {
          last.c1 = c1;
          last.transparent = merged.transparent;
          continue;
        }
      }
      horiz.push({ ...rect });
    }
    horiz.sort((a, b) => (a.c0 !== b.c0 ? a.c0 - b.c0 : a.c1 - b.c1 || a.r0 - b.r0 || a.r1 - b.r1));
    const vert: HostRect[] = [];
    for (const rect of horiz) {
      const last = vert[vert.length - 1];
      if (last && rect.c0 === last.c0 && rect.c1 === last.c1 && rect.r0 === last.r1) {
        const r0 = last.r0;
        const c0 = last.c0;
        const r1 = rect.r1;
        const c1 = last.c1;
        const merged = canMerge(r0, c0, r1, c1);
        if (merged) {
          last.r1 = r1;
          last.transparent = merged.transparent;
          continue;
        }
      }
      vert.push({ ...rect });
    }
    current = vert;
  }
  return current;
};


export const ensurePlaneShellHosts = (
  renderState: RenderState,
  existing: PlaneShellDomState | null,
  documentRef: Document
): PlaneShellDomState => {
  const root = renderState.root;
  const floor = renderState.floor;
  if (existing) {
    for (const host of [existing.xHost, existing.yHost]) host.parentElement !== root && root.appendChild(host);
    if (existing.zHost !== floor) existing.zHost = floor;
    return existing;
  }

  const xHost = documentRef.createElement("div");
  const yHost = documentRef.createElement("div");
  xHost.className = "voxcss-floor-x";
  yHost.className = "voxcss-floor-y";
  root.appendChild(xHost);
  root.appendChild(yHost);

  return {
    zHost: floor,
    xHost,
    yHost,
    zPool: [],
    xPool: [],
    yPool: [],
    faceCache: new Map(),
    faceBrushCache: new Map(),
    cacheLighting: null,
    cacheResolveTexture: null,
    cacheOffsets: null,
    cacheTileSize: 0,
    cacheLayerElevation: 0,
    cacheRows: 0,
    cacheCols: 0,
    cacheDepth: 0,
    cacheWallsSig: 0,
    cacheRenderVersion: null,
    cacheLayersRef: null,
    lastFaces: null,
    lastDebugSig: -1,
    warnedUnstableLayers: false
  };
};

export function clearPlaneShell(planeShell: PlaneShellDomState | null): void {
  if (!planeShell) return;
  planeShell.faceBrushCache.clear();
  planeShell.faceCache.clear();
  planeShell.lastFaces = null;
  planeShell.cacheLayersRef = null;
  planeShell.cacheResolveTexture = null;
  planeShell.cacheOffsets = null;
  for (const pool of [planeShell.zPool, planeShell.xPool, planeShell.yPool]) pool.length = 0;
  const zHost = planeShell.zHost;
  zHost.innerHTML = "";
  for (const prop of ["display", "grid-template-columns", "grid-template-rows"]) zHost.style.removeProperty(prop);
  planeShell.xHost.remove();
  planeShell.yHost.remove();
}
