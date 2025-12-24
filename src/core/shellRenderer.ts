import type { GridContext, RenderState, Voxel, CubeFace, WallsMask } from "./types";
import { CUBE_FACES, DEFAULT_WALLS } from "./types";
import { getVoxelBounds } from "./context";
import { computeCubeFaceAppearance } from "./cubeFaceAppearance";

export interface PlaneShellSnapshot { layers: Voxel[][]; context: GridContext; }

export interface PlaneShellDomState {
  zHost: HTMLElement;
  xHost: HTMLElement;
  yHost: HTMLElement;
  zPool: Element[];
  xPool: Element[];
  yPool: Element[];
  faceCache: Map<string, FacePlan>;
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
  statsLoggedOnce?: boolean;
  lastStats?: PlaneShellStats;
}

type PlaneShellAxis = "x" | "y" | "z";
interface FaceKey { axis: PlaneShellAxis; plane: number; face: CubeFace; }
interface FaceBuffer {
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
interface FaceData { key: FaceKey; buffer: FaceBuffer; signatureHash: number; fillCells: number; }
interface HostRect { r0: number; c0: number; r1: number; c1: number; transparent?: boolean; }
interface DetailPlan {
  colorId: number;
  path: string;
  rects?: HostRect[];
  fill: string;
  rectsCache?: { x: number; y: number; width: number; height: number }[];
}
interface HostPlan { r0: number; c0: number; r1: number; c1: number; baseColorId: number; details: DetailPlan[]; detailSig?: string; }
interface FacePlan { key: FaceKey; originRow: number; originCol: number; palette: string[]; signatureHash: number; hosts: HostPlan[]; stats: FaceStats; fallback: boolean; }
interface FaceStats { hosts: number; svgHosts: number; svgPaths: number; stampPathBytes: number; stampSvgHosts: number; stampPseudoHosts: number; stampBrushHosts: number; splitCount: number; fallback: boolean; }
interface PlaneShellStats {
  plans: number;
  baseBrushes: number;
  detailBrushes: number;
  totalBrushes: number;
  svgHosts: number;
  svgPaths: number;
  stampPathBytes: number;
  stampSvgHosts: number;
  stampPseudoHosts: number;
  stampBrushHosts: number;
  splitCount: number;
  fallbackFaces: number;
  domEstimate: number;
  domAvg: number;
  domMax: number;
}

const NEW_SHELL_VERSION = 1;
const HOST_CAP = 1500;
const BASE_COVER_MIN = 0.4;
const HOST_FILL_RATIO_MIN = 0.85;
const HOST_GAP_MAX = 8;
const DETAIL_COLOR_LIMIT = 4;
const MAX_SPLIT_DEPTH = 2;
const MAX_SPLITS_PER_HOST = 2;
const MAX_SPLITS_PER_FACE = 400;
const MAX_HOSTS_PER_FACE = 4000;
const MIN_HOST_AREA = 4;
const FRAGMENTATION_LIMIT = 600;
const SPLIT_CANDIDATE_LIMIT = 4;
const MAX_BRUSHES_PER_HOST = 5;
const SVG_NS = "http://www.w3.org/2000/svg";
const wallsToSig = (walls: WallsMask): number =>
  (walls.t ? 1 : 0) |
  (walls.b ? 2 : 0) |
  (walls.bl ? 4 : 0) |
  (walls.br ? 8 : 0) |
  (walls.fl ? 16 : 0) |
  (walls.fr ? 32 : 0);

const setAttrIfDiff = (el: Element, name: string, value: string): void => {
  const anyEl = el as Record<string, unknown>;
  const cache = (anyEl.__voxcssAttrCache ?? (anyEl.__voxcssAttrCache = Object.create(null))) as Record<string, string>;
  if (cache[name] === value) return;
  el.setAttribute(name, value);
  cache[name] = value;
};

const setStyleIfDiff = (el: HTMLElement | SVGElement, name: string, value: string): void => {
  const anyEl = el as Record<string, unknown>;
  const cache = (anyEl.__voxcssStyleCache ?? (anyEl.__voxcssStyleCache = Object.create(null))) as Record<string, string>;
  if (cache[name] === value) return;
  (el as any).style[name] = value;
  cache[name] = value;
};

const setDatasetIfDiff = (el: HTMLElement, name: string, value: string): void => {
  const anyEl = el as Record<string, unknown>;
  const cache = (anyEl.__voxcssDatasetCache ?? (anyEl.__voxcssDatasetCache = Object.create(null))) as Record<string, string>;
  if (cache[name] === value) return;
  (el.dataset as Record<string, string>)[name] = value;
  cache[name] = value;
};

const setCssVarIfDiff = (el: HTMLElement, name: string, value: string): void => {
  const anyEl = el as Record<string, unknown>;
  const cache = (anyEl.__voxcssVarCache ?? (anyEl.__voxcssVarCache = Object.create(null))) as Record<string, string>;
  if (cache[name] === value) return;
  el.style.setProperty(name, value);
  cache[name] = value;
};

const clearCssVar = (el: HTMLElement, name: string): void => {
  const anyEl = el as Record<string, unknown>;
  const cache = (anyEl.__voxcssVarCache ?? (anyEl.__voxcssVarCache = Object.create(null))) as Record<string, string>;
  if (cache[name] === undefined && !el.style.getPropertyValue(name)) return;
  delete cache[name];
  el.style.removeProperty(name);
};

const clearPlaneDetailVars = (quad: HTMLElement): void => {
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

const getDetailRects = (detail?: DetailPlan): { x: number; y: number; width: number; height: number }[] => {
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

const STAMP_FACE_Z_OFFSET: Record<CubeFace, number> = {
  t: 0.12,
  b: 0.12,
  fr: -0.12,
  fl: -0.12,
  br: 0.12,
  bl: 0.12
};
const formatZOffset = (value: number): string => `${value.toFixed(3)}px`;

const HASH_SEED = 2166136261;
const HASH_PRIME = 16777619;
const hashUpdate = (hash: number, value: number): number => Math.imul(hash ^ value, HASH_PRIME) >>> 0;
const hashNumber = (hash: number, value: number): number => {
  let v = value >>> 0;
  hash = hashUpdate(hash, v & 0xff);
  hash = hashUpdate(hash, (v >>> 8) & 0xff);
  hash = hashUpdate(hash, (v >>> 16) & 0xff);
  hash = hashUpdate(hash, (v >>> 24) & 0xff);
  return hash;
};
const hashString = (hash: number, value: string): number => {
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

function buildFaceBufferFromCells(
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

const makeRectEngine = (width: number, height: number) => {
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

const buildSolidSvgPath = (rects: { r0: number; c0: number; r1: number; c1: number }[]): string => {
  if (!rects.length) return "";
  const pathParts: string[] = [];
  for (const rect of rects) {
    pathParts.push(`M${rect.c0} ${rect.r0}H${rect.c1}V${rect.r1}H${rect.c0}Z`);
  }
  return pathParts.join("");
};

const buildMaskPsum = (mask: Uint8Array, width: number, height: number): Uint32Array => {
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

const sumRectFromPsum = (psum: Uint32Array, width: number, r0: number, c0: number, r1: number, c1: number): number => {
  const stride = width + 1;
  return psum[r1 * stride + c1] - psum[r0 * stride + c1] - psum[r1 * stride + c0] + psum[r0 * stride + c0];
};

const mergeHostRects = (
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
  for (let iter = 0; iter < 2; iter += 1) {
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


const ensurePlaneShellHosts = (
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
    cacheLighting: null,
    cacheResolveTexture: null,
    cacheOffsets: null,
    cacheTileSize: 0,
    cacheLayerElevation: 0,
    cacheRows: 0,
    cacheCols: 0,
    cacheDepth: 0,
    cacheLayersRef: null,
    lastFaces: null,
    lastDebugSig: -1,
    statsLoggedOnce: false
  };
};

export function clearPlaneShell(planeShell: PlaneShellDomState | null): void {
  if (!planeShell) return;
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

const buildFaceDataFromSnapshot = (snapshot: PlaneShellSnapshot): FaceData[] => {
  const context = snapshot.context;
  const rows = Math.max(context.rows, 1);
  const cols = Math.max(context.cols, 1);
  const depth = Math.max(snapshot.layers.length, 0);
  const strideXY = rows * cols;
  const occupancy = new Array<Voxel | null>(strideXY * depth).fill(null);
  const occupiedIndices: number[] = [];

  for (let z = 0; z < snapshot.layers.length; z += 1) {
    const layer = snapshot.layers[z];
    if (!layer?.length) continue;
    for (const voxel of layer) {
      if (!voxel) continue;
      const { x2, y2 } = getVoxelBounds(voxel);
      for (let x = voxel.x; x < x2; x += 1) {
        if (x < 0 || x >= rows) continue;
        for (let y = voxel.y; y < y2; y += 1) {
          if (y < 0 || y >= cols) continue;
          const idx = z * strideXY + x * cols + y;
          if (occupancy[idx]) continue;
          occupancy[idx] = voxel;
          occupiedIndices.push(idx);
        }
      }
    }
  }

  const offsets = context.offsets;
  const builders = new Map<string, { key: FaceKey; minRow: number; minCol: number; maxRow: number; maxCol: number; cells: { row: number; col: number; voxel: Voxel }[] }>();
  const addCell = (axis: PlaneShellAxis, plane: number, face: CubeFace, voxel: Voxel, row: number, col: number): void => {
    const keyStr = `${axis}:${plane}:${face}`;
    let builder = builders.get(keyStr);
    if (!builder) {
      builder = { key: { axis, plane, face }, minRow: row, minCol: col, maxRow: row, maxCol: col, cells: [] };
      builders.set(keyStr, builder);
    }
    builder.cells.push({ row, col, voxel });
    if (row < builder.minRow) builder.minRow = row;
    if (col < builder.minCol) builder.minCol = col;
    if (row > builder.maxRow) builder.maxRow = row;
    if (col > builder.maxCol) builder.maxCol = col;
  };

  for (const idx of occupiedIndices) {
    const z = Math.floor(idx / strideXY);
    const rem = idx - z * strideXY;
    const x = Math.floor(rem / cols);
    const y = rem - x * cols;
    const voxel = occupancy[idx];
    if (!voxel) continue;

    for (const face of CUBE_FACES) {
      const delta = offsets[face];
      if (!delta) continue;
      const [dx, dy, dz] = delta;
      const nx = x + dx;
      const ny = y + dy;
      const nz = z + dz;
      const hasNeighbor =
        nx >= 0 && nx < rows && ny >= 0 && ny < cols && nz >= 0 && nz < depth && occupancy[nz * strideXY + nx * cols + ny];
      if (hasNeighbor) continue;

      if (face === "t" || face === "b") addCell("z", face === "b" ? z : z + 1, face, voxel, x, y);
      else if (face === "bl" || face === "fr") addCell("y", face === "bl" ? y : y + 1, face, voxel, x, z + 1);
      else addCell("x", face === "br" ? x : x + 1, face, voxel, z + 1, y);
    }
  }

  const axisOrder: Record<PlaneShellAxis, number> = { x: 0, y: 1, z: 2 };
  const faceOrder = new Map<CubeFace, number>();
  CUBE_FACES.forEach((face, index) => faceOrder.set(face, index));

  const buildersList = Array.from(builders.values());
  buildersList.sort((a, b) => {
    const axisDiff = axisOrder[a.key.axis] - axisOrder[b.key.axis];
    if (axisDiff) return axisDiff;
    if (a.key.plane !== b.key.plane) return a.key.plane - b.key.plane;
    return (faceOrder.get(a.key.face) ?? 0) - (faceOrder.get(b.key.face) ?? 0);
  });
  for (const builder of buildersList) {
    if (builder.cells.length > 1) {
      builder.cells.sort((a, b) => (a.row !== b.row ? a.row - b.row : a.col - b.col));
    }
  }

  const faces: FaceData[] = [];
  for (const builder of buildersList) {
    if (!builder.cells.length) continue;
    const built = buildFaceBufferFromCells(
      builder.cells,
      builder.minRow,
      builder.minCol,
      builder.maxRow,
      builder.maxCol,
      builder.key.face,
      context
    );
    if (!built) continue;
    const { buffer, signatureHash, fillCells } = built;
    if (!fillCells) continue;
    faces.push({ key: builder.key, buffer, signatureHash, fillCells });
  }

  return faces;
};

type HistogramScratch = { counts: Int32Array; touched: number[]; };
const resetHistogram = (scratch: HistogramScratch): void => {
  for (const id of scratch.touched) scratch.counts[id] = 0;
  scratch.touched.length = 0;
};

const analyzeHostColors = (
  buffer: FaceBuffer,
  rect: HostRect,
  scratch: HistogramScratch,
  allowEmpty: boolean
): { baseColorId: number; baseCount: number; uniqueColors: number; baseCoverage: number; nonBaseCoverage: number; area: number; colorCounts: { colorId: number; count: number }[]; invalid: boolean } => {
  const { ids, width } = buffer;
  const area = Math.max(0, rect.r1 - rect.r0) * Math.max(0, rect.c1 - rect.c0);
  if (!area) {
    return { baseColorId: 0, baseCount: 0, uniqueColors: 0, baseCoverage: 0, nonBaseCoverage: 0, area, colorCounts: [], invalid: true };
  }
  let baseColorId = 0;
  let baseCount = 0;
  let uniqueColors = 0;
  let invalid = false;
  for (let r = rect.r0; r < rect.r1; r += 1) {
    const rowBase = r * width;
    for (let c = rect.c0; c < rect.c1; c += 1) {
      const id = ids[rowBase + c];
      if (!id) {
        if (!allowEmpty) invalid = true;
        continue;
      }
      const prev = scratch.counts[id];
      if (!prev) scratch.touched.push(id), uniqueColors += 1;
      const next = prev + 1;
      scratch.counts[id] = next;
      if (next > baseCount) {
        baseCount = next;
        baseColorId = id;
      }
    }
  }
  const colorCounts = scratch.touched.map((id) => ({ colorId: id, count: scratch.counts[id] }));
  colorCounts.sort((a, b) => b.count - a.count || a.colorId - b.colorId);
  const baseCoverage = area ? baseCount / area : 0;
  const nonBaseCoverage = 1 - baseCoverage;
  resetHistogram(scratch);
  return { baseColorId, baseCount, uniqueColors, baseCoverage, nonBaseCoverage, area, colorCounts, invalid };
};

const extractColorRects = (
  buffer: FaceBuffer,
  rect: HostRect,
  colorId: number,
  rectEngine: ReturnType<typeof makeRectEngine>
): HostRect[] => {
  const rects: HostRect[] = [];
  rectEngine.forEachRectRuns(
    rect.r0,
    rect.c0,
    rect.r1,
    rect.c1,
    (idx) => buffer.ids[idx] === colorId,
    (r0, c0, r1, c1) => {
      rects.push({ r0: r0 - rect.r0, c0: c0 - rect.c0, r1: r1 - rect.r0, c1: c1 - rect.c0 });
    }
  );
  return rects;
};

const mergeAdjacentRectsExact = (rects: HostRect[]): HostRect[] => {
  if (rects.length < 2) return rects;
  rects.sort((a, b) => (a.r0 !== b.r0 ? a.r0 - b.r0 : a.c0 - b.c0 || a.r1 - b.r1 || a.c1 - b.c1));
  const horiz: HostRect[] = [];
  for (const rect of rects) {
    const last = horiz[horiz.length - 1];
    if (last && rect.r0 === last.r0 && rect.r1 === last.r1 && rect.c0 === last.c1) {
      last.c1 = rect.c1;
      continue;
    }
    horiz.push({ ...rect });
  }
  horiz.sort((a, b) => (a.c0 !== b.c0 ? a.c0 - b.c0 : a.r0 - b.r0 || a.c1 - b.c1 || a.r1 - b.r1));
  const merged: HostRect[] = [];
  for (const rect of horiz) {
    const last = merged[merged.length - 1];
    if (last && rect.c0 === last.c0 && rect.c1 === last.c1 && rect.r0 === last.r1) {
      last.r1 = rect.r1;
      continue;
    }
    merged.push({ ...rect });
  }
  return merged;
};

const ensureMask = (maskRef: { mask: Uint8Array }, size: number): Uint8Array => {
  if (maskRef.mask.length < size) {
    maskRef.mask = new Uint8Array(size);
    return maskRef.mask;
  }
  maskRef.mask.fill(0, 0, size);
  return maskRef.mask;
};

const verifyHostDetails = (
  buffer: FaceBuffer,
  host: HostRect,
  baseColorId: number,
  details: { colorId: number; rects: HostRect[] }[],
  maskRef: { mask: Uint8Array }
): boolean => {
  const hostWidth = host.c1 - host.c0;
  const hostHeight = host.r1 - host.r0;
  if (hostWidth <= 0 || hostHeight <= 0) return false;
  const mask = ensureMask(maskRef, hostWidth * hostHeight);
  const colorMap = new Map<number, number>();
  for (let i = 0; i < details.length; i += 1) {
    const colorId = details[i]?.colorId ?? 0;
    if (!colorId) continue;
    colorMap.set(colorId, i + 1);
  }
  const fillMask = (rects: HostRect[], value: number): boolean => {
    for (const rect of rects) {
      for (let r = rect.r0; r < rect.r1; r += 1) {
        const rowBase = r * hostWidth;
        for (let c = rect.c0; c < rect.c1; c += 1) {
          const idx = rowBase + c;
          const prev = mask[idx];
          if (prev && prev !== value) return false;
          mask[idx] = value;
        }
      }
    }
    return true;
  };
  for (let i = 0; i < details.length; i += 1) {
    const value = i + 1;
    if (!fillMask(details[i].rects, value)) return false;
  }
  const ids = buffer.ids;
  const width = buffer.width;
  for (let r = 0; r < hostHeight; r += 1) {
    const rowBase = (host.r0 + r) * width;
    const maskRow = r * hostWidth;
    for (let c = 0; c < hostWidth; c += 1) {
      const id = ids[rowBase + host.c0 + c];
      const m = mask[maskRow + c];
      if (!id) {
        if (m) return false;
        continue;
      }
      if (id === baseColorId) {
        if (m) return false;
        continue;
      }
      const value = colorMap.get(id);
      if (!value || m !== value) return false;
    }
  }
  return true;
};

const pickTopK = (scores: Int32Array, k: number): number[] => {
  const indices = Array.from(scores.keys());
  indices.sort((a, b) => scores[b] - scores[a] || a - b);
  return indices.slice(0, Math.max(0, Math.min(k, indices.length)));
};

const chooseSplitLine = (
  buffer: FaceBuffer,
  rect: HostRect,
  parentUniqueColors: number,
  parentNonBaseCoverage: number,
  allowEmpty: boolean
): { axis: "v" | "h"; line: number } | null => {
  const width = rect.c1 - rect.c0;
  const height = rect.r1 - rect.r0;
  if (width < 2 && height < 2) return null;
  const ids = buffer.ids;
  const stride = buffer.width;

  const vertScores = width >= 2 ? new Int32Array(width - 1) : null;
  const horizScores = height >= 2 ? new Int32Array(height - 1) : null;
  if (vertScores) {
    for (let r = rect.r0; r < rect.r1; r += 1) {
      const rowBase = r * stride;
      for (let c = rect.c0 + 1; c < rect.c1; c += 1) {
        if (ids[rowBase + c] !== ids[rowBase + c - 1]) vertScores[c - rect.c0 - 1] += 1;
      }
    }
  }
  if (horizScores) {
    for (let r = rect.r0 + 1; r < rect.r1; r += 1) {
      const rowBase = r * stride;
      const prevBase = (r - 1) * stride;
      for (let c = rect.c0; c < rect.c1; c += 1) {
        if (ids[rowBase + c] !== ids[prevBase + c]) horizScores[r - rect.r0 - 1] += 1;
      }
    }
  }

  const candidates: { axis: "v" | "h"; line: number }[] = [];
  if (vertScores && vertScores.length) {
    const top = pickTopK(vertScores, SPLIT_CANDIDATE_LIMIT);
    for (const idx of top) candidates.push({ axis: "v", line: rect.c0 + 1 + idx });
    const mid = rect.c0 + Math.floor(width / 2);
    if (mid > rect.c0 && mid < rect.c1 && !candidates.some((c) => c.axis === "v" && c.line === mid)) {
      candidates.push({ axis: "v", line: mid });
    }
  }
  if (horizScores && horizScores.length) {
    const top = pickTopK(horizScores, SPLIT_CANDIDATE_LIMIT);
    for (const idx of top) candidates.push({ axis: "h", line: rect.r0 + 1 + idx });
    const mid = rect.r0 + Math.floor(height / 2);
    if (mid > rect.r0 && mid < rect.r1 && !candidates.some((c) => c.axis === "h" && c.line === mid)) {
      candidates.push({ axis: "h", line: mid });
    }
  }

  if (!candidates.length) return null;

  const scratchA: HistogramScratch = { counts: new Int32Array(buffer.palette.length), touched: [] };
  const scratchB: HistogramScratch = { counts: new Int32Array(buffer.palette.length), touched: [] };

  let best: { axis: "v" | "h"; line: number } | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  let bestTie = Number.POSITIVE_INFINITY;

  for (const candidate of candidates) {
    const isVertical = candidate.axis === "v";
    const line = candidate.line;
    const leftArea = isVertical ? (line - rect.c0) * height : (line - rect.r0) * width;
    const rightArea = isVertical ? (rect.c1 - line) * height : (rect.r1 - line) * width;
    if (leftArea < MIN_HOST_AREA || rightArea < MIN_HOST_AREA) continue;
    resetHistogram(scratchA);
    resetHistogram(scratchB);
    const leftStats = analyzeHostColors(buffer, isVertical
      ? { r0: rect.r0, c0: rect.c0, r1: rect.r1, c1: line }
      : { r0: rect.r0, c0: rect.c0, r1: line, c1: rect.c1 }, scratchA, allowEmpty);
    const rightStats = analyzeHostColors(buffer, isVertical
      ? { r0: rect.r0, c0: line, r1: rect.r1, c1: rect.c1 }
      : { r0: line, c0: rect.c0, r1: rect.r1, c1: rect.c1 }, scratchB, allowEmpty);
    if (leftStats.invalid || rightStats.invalid) continue;
    const score = Math.max(leftStats.uniqueColors, rightStats.uniqueColors);
    const tie = Math.max(leftStats.nonBaseCoverage, rightStats.nonBaseCoverage);
    if (score < bestScore || (score === bestScore && tie < bestTie)) {
      bestScore = score;
      bestTie = tie;
      best = candidate;
    }
  }

  if (!best) return null;
  if (bestScore > parentUniqueColors) return null;
  if (bestScore === parentUniqueColors && bestTie >= parentNonBaseCoverage) return null;
  return best;
};

const buildFallbackHostsForFace = (
  buffer: FaceBuffer,
  rectEngine: ReturnType<typeof makeRectEngine>
): HostPlan[] => {
  const { ids, palette, width, height } = buffer;
  const colorCounts = new Int32Array(palette.length);
  for (let i = 0; i < ids.length; i += 1) if (ids[i]) colorCounts[ids[i]] += 1;
  const fallbackHosts: HostPlan[] = [];
  const mask = new Uint8Array(ids.length);
  for (let colorId = 1; colorId < colorCounts.length; colorId += 1) {
    if (!colorCounts[colorId]) continue;
    mask.fill(0);
    for (let i = 0; i < ids.length; i += 1) mask[i] = ids[i] === colorId ? 1 : 0;
    const { rects } = rectEngine.maxRects(mask, colorCounts[colorId], colorCounts[colorId]);
    for (const rect of rects) {
      if (rect.r1 <= rect.r0 || rect.c1 <= rect.c0) continue;
      fallbackHosts.push({ r0: rect.r0, c0: rect.c0, r1: rect.r1, c1: rect.c1, baseColorId: colorId, details: [] });
    }
  }
  fallbackHosts.sort((a, b) => (a.r0 !== b.r0 ? a.r0 - b.r0 : a.c0 - b.c0 || a.r1 - b.r1 || a.c1 - b.c1));
  return fallbackHosts;
};

const buildFacePlan = (faceData: FaceData): FacePlan => {
  const { buffer, fillCells } = faceData;
  const rectEngine = makeRectEngine(buffer.width, buffer.height);
  const { rects, coveredAll } = rectEngine.maxRects(buffer.mask, HOST_CAP, fillCells);
  const psum = buildMaskPsum(buffer.mask, buffer.width, buffer.height);
  const mergedRects = mergeHostRects(rects, psum, buffer.width, buffer.height);
  const hostRects = mergedRects;
  let coveredCells = 0;
  for (const rect of hostRects) coveredCells += sumRectFromPsum(psum, buffer.width, rect.r0, rect.c0, rect.r1, rect.c1);
  const chosenCoveredAll = coveredCells === fillCells;
  // Coverage must reflect the rects we actually render.
  const hosts: HostPlan[] = [];
  let splitCount = 0;
  let fallback = !chosenCoveredAll;
  const stats: FaceStats = { hosts: 0, svgHosts: 0, svgPaths: 0, stampPathBytes: 0, stampSvgHosts: 0, stampPseudoHosts: 0, stampBrushHosts: 0, splitCount: 0, fallback: false };
  const maskRef = { mask: new Uint8Array(0) };
  const scratch: HistogramScratch = { counts: new Int32Array(buffer.palette.length), touched: [] };

  const addHost = (plan: HostPlan): void => {
    hosts.push(plan);
    stats.hosts += 1;
    if (plan.details.length) {
      stats.svgHosts += 1;
      stats.svgPaths += plan.details.length;
      for (const detail of plan.details) stats.stampPathBytes += detail.path.length;
    }
  };

  const processHost = (rect: HostRect, depth: number, splitsRemaining: number): boolean => {
    if (fallback) return false;
    const area = Math.max(0, rect.r1 - rect.r0) * Math.max(0, rect.c1 - rect.c0);
    if (!area) return true;
    const transparentHost = rect.transparent === true;
    const analysis = analyzeHostColors(buffer, rect, scratch, transparentHost);
    if (analysis.invalid || (!analysis.baseColorId && !transparentHost)) {
      fallback = true;
      return false;
    }
    const needsSplit = transparentHost
      ? analysis.uniqueColors > DETAIL_COLOR_LIMIT
      : analysis.uniqueColors > DETAIL_COLOR_LIMIT + 1 || analysis.baseCoverage < BASE_COVER_MIN;
    const detailColors = transparentHost
      ? analysis.colorCounts.map((entry) => entry.colorId)
      : analysis.colorCounts
        .filter((entry) => entry.colorId !== analysis.baseColorId)
        .slice(0, DETAIL_COLOR_LIMIT)
        .map((entry) => entry.colorId);
    const canStamp = transparentHost
      ? !needsSplit && analysis.uniqueColors <= DETAIL_COLOR_LIMIT
      : !needsSplit && analysis.uniqueColors <= DETAIL_COLOR_LIMIT + 1 && analysis.baseCoverage >= BASE_COVER_MIN;
    const baseColorId = transparentHost ? -1 : analysis.baseColorId;
    if (canStamp && !detailColors.length) {
      addHost({ r0: rect.r0, c0: rect.c0, r1: rect.r1, c1: rect.c1, baseColorId, details: [] });
      return true;
    }
    if (canStamp && detailColors.length) {
      const detailRects = detailColors.map((colorId) => {
        let rects = extractColorRects(buffer, rect, colorId, rectEngine);
        rects = mergeAdjacentRectsExact(rects);
        rects.sort((a, b) => (a.r0 !== b.r0 ? a.r0 - b.r0 : a.c0 - b.c0 || a.r1 - b.r1 || a.c1 - b.c1));
        return { colorId, rects };
      });
      const rectRunCount = detailRects.reduce((sum, entry) => sum + entry.rects.length, 0);
      if (rectRunCount <= FRAGMENTATION_LIMIT) {
        const ok = verifyHostDetails(buffer, rect, baseColorId, detailRects, maskRef);
        if (ok) {
          const hostArea = area;
          const detailArea = detailRects.reduce((sum, entry) => {
            for (const detailRect of entry.rects) {
              const rectHeight = Math.max(0, detailRect.r1 - detailRect.r0);
              const rectWidth = Math.max(0, detailRect.c1 - detailRect.c0);
              sum += rectHeight * rectWidth;
            }
            return sum;
          }, 0);
          const details: DetailPlan[] = [];
          for (const entry of detailRects) {
            const path = buildSolidSvgPath(entry.rects);
            if (!path) continue;
            const fill = buffer.palette[entry.colorId] ?? "";
            const rects = entry.rects.map((rect) => ({ ...rect }));
            details.push({ colorId: entry.colorId, path, rects, fill });
          }
          const hostWidth = rect.c1 - rect.c0;
          const hostHeight = rect.r1 - rect.r0;
          let detailSig = `${hostWidth}x${hostHeight}`;
          for (const detail of details) detailSig += `|${detail.fill}:${detail.path}`;
          addHost({ r0: rect.r0, c0: rect.c0, r1: rect.r1, c1: rect.c1, baseColorId, details, detailSig });
          return true;
        }
      }
    }

    if (depth < MAX_SPLIT_DEPTH && splitsRemaining > 0 && area >= MIN_HOST_AREA) {
      const split = chooseSplitLine(buffer, rect, analysis.uniqueColors, analysis.nonBaseCoverage, transparentHost);
      if (split) {
        splitCount += 1;
        const nextSplits = splitsRemaining - 1;
        const a = split.axis === "v"
          ? { r0: rect.r0, c0: rect.c0, r1: rect.r1, c1: split.line }
          : { r0: rect.r0, c0: rect.c0, r1: split.line, c1: rect.c1 };
        const b = split.axis === "v"
          ? { r0: rect.r0, c0: split.line, r1: rect.r1, c1: rect.c1 }
          : { r0: split.line, c0: rect.c0, r1: rect.r1, c1: rect.c1 };
        if (!processHost(a, depth + 1, nextSplits)) return false;
        if (!processHost(b, depth + 1, nextSplits)) return false;
        return true;
      }
    }
    fallback = true;
    return false;
  };

  if (!fallback) {
    const sorted = hostRects.slice().sort((a, b) => (a.r0 !== b.r0 ? a.r0 - b.r0 : a.c0 - b.c0 || a.r1 - b.r1 || a.c1 - b.c1));
    for (const rect of sorted) {
      if (hosts.length > MAX_HOSTS_PER_FACE) {
        fallback = true;
        break;
      }
      if (!processHost(rect, 0, MAX_SPLITS_PER_HOST)) break;
      if (splitCount > MAX_SPLITS_PER_FACE) {
        fallback = true;
        break;
      }
    }
  }

  if (fallback) {
    hosts.length = 0;
    const fallbackHosts = buildFallbackHostsForFace(buffer, rectEngine);
    for (const host of fallbackHosts) addHost(host);
  }

  stats.splitCount = splitCount;
  stats.fallback = fallback;

  return {
    key: faceData.key,
    originRow: buffer.minRow,
    originCol: buffer.minCol,
    palette: buffer.palette,
    signatureHash: faceData.signatureHash,
    hosts,
    stats,
    fallback
  };
};

const buildCacheKey = (face: FaceData): string => {
  let hash = HASH_SEED;
  hash = hashNumber(hash, NEW_SHELL_VERSION);
  hash = hashNumber(hash, HOST_CAP);
  hash = hashNumber(hash, Math.round(BASE_COVER_MIN * 1000));
  hash = hashNumber(hash, Math.round(HOST_FILL_RATIO_MIN * 1000));
  hash = hashNumber(hash, HOST_GAP_MAX);
  hash = hashNumber(hash, DETAIL_COLOR_LIMIT);
  hash = hashNumber(hash, MAX_SPLIT_DEPTH);
  hash = hashNumber(hash, MAX_SPLITS_PER_HOST);
  hash = hashNumber(hash, MAX_SPLITS_PER_FACE);
  hash = hashNumber(hash, MAX_HOSTS_PER_FACE);
  hash = hashNumber(hash, MIN_HOST_AREA);
  hash = hashNumber(hash, FRAGMENTATION_LIMIT);
  for (const color of face.buffer.palette) hash = hashString(hash, color);
  const { axis, plane, face: faceKey } = face.key;
  return `${axis}:${plane}:${faceKey}:${face.buffer.minRow}:${face.buffer.minCol}:${face.buffer.maxRow}:${face.buffer.maxCol}:${face.fillCells}:${face.signatureHash}:${hash}`;
};

const buildPlaneShellStats = (faces: FacePlan[], walls: WallsMask): PlaneShellStats => {
  let baseBrushes = 0;
  let detailBrushes = 0;
  let totalBrushes = 0;
  let svgHosts = 0;
  let svgPaths = 0;
  let stampPathBytes = 0;
  let stampSvgHosts = 0;
  let stampPseudoHosts = 0;
  let stampBrushHosts = 0;
  let splitCount = 0;
  let fallbackFaces = 0;
  let domMax = 0;
  for (const face of faces) {
    if (walls[face.key.face]) continue;
    baseBrushes += face.stats.hosts;
    detailBrushes += face.stats.stampBrushHosts;
    totalBrushes += face.stats.hosts + face.stats.stampBrushHosts;
    svgHosts += face.stats.svgHosts;
    svgPaths += face.stats.svgPaths;
    stampPathBytes += face.stats.stampPathBytes;
    stampSvgHosts += face.stats.stampSvgHosts;
    stampPseudoHosts += face.stats.stampPseudoHosts;
    stampBrushHosts += face.stats.stampBrushHosts;
    splitCount += face.stats.splitCount;
    if (face.stats.fallback) fallbackFaces += 1;
    domMax = Math.max(domMax, face.stats.hosts + face.stats.stampSvgHosts + face.stats.stampBrushHosts);
  }
  const plans = faces.filter((face) => !walls[face.key.face]).length;
  const domEstimate = totalBrushes + stampSvgHosts;
  const domAvg = plans ? domEstimate / plans : 0;
  return {
    plans,
    baseBrushes,
    detailBrushes,
    totalBrushes,
    svgHosts,
    svgPaths,
    stampPathBytes,
    stampSvgHosts,
    stampPseudoHosts,
    stampBrushHosts,
    splitCount,
    fallbackFaces,
    domEstimate,
    domAvg,
    domMax
  };
};

const updatePlaneShellStats = (
  hosts: PlaneShellDomState,
  stats: PlaneShellStats,
  context: GridContext,
  plans: FacePlan[],
  tileSize: number,
  layerElevation: number
): void => {
  let debugSig = HASH_SEED;
  debugSig = hashNumber(debugSig, context.rows);
  debugSig = hashNumber(debugSig, context.cols);
  debugSig = hashNumber(debugSig, context.depth ?? 0);
  debugSig = hashNumber(debugSig, tileSize);
  debugSig = hashNumber(debugSig, layerElevation);
  const walls = context.walls ?? DEFAULT_WALLS;
  for (const plan of plans) {
    if (walls[plan.key.face]) continue;
    const axis = plan.key.axis;
    const axisCode = axis === "x" ? 1 : axis === "y" ? 2 : 3;
    const face = plan.key.face;
    const faceCode =
      face === "t" ? 1 :
        face === "b" ? 2 :
          face === "bl" ? 3 :
            face === "br" ? 4 :
              face === "fr" ? 5 : 6;
    debugSig = hashNumber(debugSig, axisCode);
    debugSig = hashNumber(debugSig, plan.key.plane);
    debugSig = hashNumber(debugSig, faceCode);
    debugSig = hashNumber(debugSig, plan.stats.hosts);
    debugSig = hashNumber(debugSig, plan.stats.svgPaths);
    debugSig = hashNumber(debugSig, plan.stats.stampPathBytes);
    debugSig = hashNumber(debugSig, plan.stats.stampSvgHosts);
    debugSig = hashNumber(debugSig, plan.stats.stampPseudoHosts);
    debugSig = hashNumber(debugSig, plan.stats.stampBrushHosts);
  }
  if (debugSig === hosts.lastDebugSig) return;
  if (!hosts.statsLoggedOnce) {
    console.groupCollapsed("[VoxCSS] PlaneShell report (new)");
    console.log("[VoxCSS] PlaneShell summary", stats);
    console.groupEnd();
    hosts.statsLoggedOnce = true;
  }
  hosts.lastDebugSig = debugSig;
  hosts.lastStats = stats;
};

const syncPlaneShellStatsDataset = (root: HTMLElement, stats: PlaneShellStats): void => {
  setDatasetIfDiff(root, "voxcssPlaneShellBaseBrushes", String(stats.baseBrushes));
  setDatasetIfDiff(root, "voxcssPlaneShellDetailBrushes", String(stats.detailBrushes));
  setDatasetIfDiff(root, "voxcssPlaneShellTotalBrushes", String(stats.totalBrushes));
  setDatasetIfDiff(root, "voxcssStampBrushHosts", String(stats.detailBrushes));
  setDatasetIfDiff(root, "voxcssStampSvgHosts", String(stats.stampSvgHosts));
  setDatasetIfDiff(root, "voxcssStampPseudoHosts", String(stats.stampPseudoHosts));
};

const applyBrush = (
  brush: HTMLElement,
  gridArea: string,
  backgroundColor: string,
  zOffset: string
): void => {
  const state = brush as { __voxcssNewBrushState?: { className?: string; gridArea?: string; backgroundColor?: string } };
  const brushState = state.__voxcssNewBrushState ?? (state.__voxcssNewBrushState = {});
  const className = "voxcss-plane-brush";
  if (brushState.className !== className) {
    brush.className = className;
    brushState.className = className;
  }
  if (brushState.gridArea !== gridArea) {
    brush.style.gridArea = gridArea;
    brushState.gridArea = gridArea;
  }
  if (brushState.backgroundColor !== backgroundColor) {
    brush.style.backgroundColor = backgroundColor;
    brushState.backgroundColor = backgroundColor;
  }
  setCssVarIfDiff(brush, "--vox-z", zOffset);
  setStyleIfDiff(brush, "position", "relative");
  setStyleIfDiff(brush, "left", "");
  setStyleIfDiff(brush, "top", "");
  setStyleIfDiff(brush, "width", "");
  setStyleIfDiff(brush, "height", "");
};

const renderFacePlans = (
  hosts: PlaneShellDomState,
  snapshot: PlaneShellSnapshot,
  documentRef: Document,
  plans: FacePlan[]
): void => {
  const context = snapshot.context;
  const tileSize = context.tileSize ?? 50;
  const layerElevation = context.layerElevation ?? tileSize;
  const walls = context.walls ?? DEFAULT_WALLS;
  const tasks: { rect: { x: number; y: number; width: number; height: number }; color: string }[] = [];
  const axisState: Record<PlaneShellAxis, { host: HTMLElement; pool: Element[]; index: number }> = {
    z: { host: hosts.zHost, pool: hosts.zPool, index: 0 },
    x: { host: hosts.xHost, pool: hosts.xPool, index: 0 },
    y: { host: hosts.yHost, pool: hosts.yPool, index: 0 }
  };
  const nextElement = (axis: PlaneShellAxis, tag: "b" | "svg"): Element => {
    const bucket = axisState[axis];
    const i = bucket.index++;
    let el = bucket.pool[i];
    const wantsSvg = tag === "svg";
    if (el) {
      const tagName = el.tagName.toLowerCase();
      if ((wantsSvg && tagName !== "svg") || (!wantsSvg && tagName !== "b")) {
        el.remove();
        el = undefined;
      }
    }
    if (!el) {
      el = wantsSvg ? documentRef.createElementNS(SVG_NS, "svg") : documentRef.createElement("b");
      bucket.pool[i] = el;
      bucket.host.appendChild(el);
    } else if (el.parentElement !== bucket.host) {
      bucket.host.appendChild(el);
    }
    if (el instanceof HTMLElement && el.style.display === "none") el.style.display = "";
    return el;
  };
  const nextBrush = (axis: PlaneShellAxis): HTMLElement => nextElement(axis, "b") as HTMLElement;
  const nextSvg = (axis: PlaneShellAxis): SVGSVGElement => nextElement(axis, "svg") as SVGSVGElement;
  const getPlaneOffset = (axis: PlaneShellAxis, plane: number): number =>
    axis === "z"
      ? plane * layerElevation
      : -1 * (plane - 1) * tileSize;
  const gridAreaFor = (row0: number, col0: number, row1: number, col1: number): string =>
    `${row0} / ${col0} / ${row1} / ${col1}`;

  for (const plan of plans) {
    const { axis, plane, face } = plan.key;
    plan.stats.stampSvgHosts = 0;
    plan.stats.stampPseudoHosts = 0;
    plan.stats.stampBrushHosts = 0;
    if (walls[face]) continue;
    const planeOffset = getPlaneOffset(axis, plane);
    const stampOffset = STAMP_FACE_Z_OFFSET[face] ?? 0.12;
    const brushZ = formatZOffset(planeOffset + stampOffset);
    const cellWidthPx = axis === "y" ? layerElevation : tileSize;
    const cellHeightPx = axis === "x" ? layerElevation : tileSize;

    const applyPseudo = (
      target: HTMLElement,
      contentVar: "before" | "after",
      task: { rect: { x: number; y: number; width: number; height: number }; color: string }
    ): void => {
      const prefix = contentVar === "before" ? "--vox-b" : "--vox-a";
      const leftPx = task.rect.x * cellWidthPx;
      const topPx = task.rect.y * cellHeightPx;
      const widthPx = task.rect.width * cellWidthPx;
      const heightPx = task.rect.height * cellHeightPx;
      setCssVarIfDiff(target, `${prefix}c`, "''");
      setCssVarIfDiff(target, `${prefix}l`, `${leftPx}px`);
      setCssVarIfDiff(target, `${prefix}t`, `${topPx}px`);
      setCssVarIfDiff(target, `${prefix}w`, `${widthPx}px`);
      setCssVarIfDiff(target, `${prefix}h`, `${heightPx}px`);
      setCssVarIfDiff(target, `${prefix}col`, task.color);
      setCssVarIfDiff(target, "--vox-z", brushZ);
    };

    const applyBrushPseudo = (
      brush: HTMLElement,
      contentVar: "before" | "after",
      task: { rect: { x: number; y: number; width: number; height: number }; color: string },
      baseRect: { x: number; y: number }
    ): void => {
      const prefix = contentVar === "before" ? "--vox-b" : "--vox-a";
      const leftPx = (task.rect.x - baseRect.x) * cellWidthPx;
      const topPx = (task.rect.y - baseRect.y) * cellHeightPx;
      const widthPx = task.rect.width * cellWidthPx;
      const heightPx = task.rect.height * cellHeightPx;
      setCssVarIfDiff(brush, `${prefix}c`, "''");
      setCssVarIfDiff(brush, `${prefix}l`, `${leftPx}px`);
      setCssVarIfDiff(brush, `${prefix}t`, `${topPx}px`);
      setCssVarIfDiff(brush, `${prefix}w`, `${widthPx}px`);
      setCssVarIfDiff(brush, `${prefix}h`, `${heightPx}px`);
      setCssVarIfDiff(brush, `${prefix}col`, task.color);
      setCssVarIfDiff(brush, "--vox-z", brushZ);
    };

    for (const host of plan.hosts) {
      const baseBrush = nextBrush(axis);
      const hostRow0 = plan.originRow + host.r0;
      const hostCol0 = plan.originCol + host.c0;
      const hostRow1 = plan.originRow + host.r1;
      const hostCol1 = plan.originCol + host.c1;
      const gridArea = gridAreaFor(hostRow0, hostCol0, hostRow1, hostCol1);
      const backgroundColor = plan.palette[host.baseColorId] ?? "transparent";
      clearPlaneDetailVars(baseBrush);
      applyBrush(baseBrush, gridArea, backgroundColor, brushZ);

      if (!host.details.length) continue;

      tasks.length = 0;
      let pseudoValid = true;
      for (const detail of host.details) {
        const rects = getDetailRects(detail);
        if (!rects.length) {
          pseudoValid = false;
          break;
        }
        const fill = detail.fill || plan.palette[detail.colorId] || "transparent";
        for (const rect of rects) tasks.push({ rect, color: fill });
      }

      const shouldBrush = pseudoValid && tasks.length && tasks.length <= MAX_BRUSHES_PER_HOST * 3;
      if (!shouldBrush) {
        const hostWidth = host.c1 - host.c0;
        const hostHeight = host.r1 - host.r0;
        const svg = nextSvg(axis);
        svg.setAttribute("preserveAspectRatio", "none");
        setAttrIfDiff(svg, "shape-rendering", "geometricPrecision");
        svg.setAttribute("aria-hidden", "true");
        svg.setAttribute("focusable", "false");
        setStyleIfDiff(svg, "position", "relative");
        setStyleIfDiff(svg, "width", "100%");
        setStyleIfDiff(svg, "height", "100%");
        setStyleIfDiff(svg, "display", "block");
        setStyleIfDiff(svg, "pointerEvents", "none");
        setStyleIfDiff(svg, "transformOrigin", "0 0");
        setStyleIfDiff(svg, "willChange", "transform");
        setStyleIfDiff(svg, "gridArea", gridArea);
        setStyleIfDiff(svg, "transform", `translateZ(${brushZ})`);
        setAttrIfDiff(svg, "viewBox", `0 0 ${hostWidth} ${hostHeight}`);
        plan.stats.stampSvgHosts += 1;
        const svgState = svg as {
          __voxcssNewStampPathA?: SVGPathElement;
          __voxcssNewStampPathB?: SVGPathElement;
          __voxcssNewStampPathC?: SVGPathElement;
          __voxcssNewStampPathD?: SVGPathElement;
        };
        const ensurePath = (key: "A" | "B" | "C" | "D"): SVGPathElement => {
          const pathKey =
            key === "A" ? "__voxcssNewStampPathA" :
              key === "B" ? "__voxcssNewStampPathB" :
                key === "C" ? "__voxcssNewStampPathC" : "__voxcssNewStampPathD";
          let path = svgState[pathKey];
          if (!path) {
            path = documentRef.createElementNS(SVG_NS, "path");
            svg.appendChild(path);
            svgState[pathKey] = path;
          }
          return path;
        };
        const svgDetailA = host.details[0];
        const svgDetailB = host.details[1];
        const svgDetailC = host.details[2];
        const svgDetailD = host.details[3];
        if (svgDetailA) {
          const pathA = ensurePath("A");
          setAttrIfDiff(pathA, "d", svgDetailA.path);
          setAttrIfDiff(pathA, "fill", plan.palette[svgDetailA.colorId] ?? "");
        } else if (svgState.__voxcssNewStampPathA) {
          svgState.__voxcssNewStampPathA.remove();
          svgState.__voxcssNewStampPathA = undefined;
        }
        if (svgDetailB) {
          const pathB = ensurePath("B");
          setAttrIfDiff(pathB, "d", svgDetailB.path);
          setAttrIfDiff(pathB, "fill", plan.palette[svgDetailB.colorId] ?? "");
        } else if (svgState.__voxcssNewStampPathB) {
          svgState.__voxcssNewStampPathB.remove();
          svgState.__voxcssNewStampPathB = undefined;
        }
        if (svgDetailC) {
          const pathC = ensurePath("C");
          setAttrIfDiff(pathC, "d", svgDetailC.path);
          setAttrIfDiff(pathC, "fill", plan.palette[svgDetailC.colorId] ?? "");
        } else if (svgState.__voxcssNewStampPathC) {
          svgState.__voxcssNewStampPathC.remove();
          svgState.__voxcssNewStampPathC = undefined;
        }
        if (svgDetailD) {
          const pathD = ensurePath("D");
          setAttrIfDiff(pathD, "d", svgDetailD.path);
          setAttrIfDiff(pathD, "fill", plan.palette[svgDetailD.colorId] ?? "");
        } else if (svgState.__voxcssNewStampPathD) {
          svgState.__voxcssNewStampPathD.remove();
          svgState.__voxcssNewStampPathD = undefined;
        }
        continue;
      }

      if (tasks.length > 2) {
        tasks.sort((a, b) => (b.rect.width * b.rect.height) - (a.rect.width * a.rect.height));
      }

      if (tasks[0]) applyPseudo(baseBrush, "before", tasks[0]);
      if (tasks[1]) applyPseudo(baseBrush, "after", tasks[1]);
      if (!tasks[1]) setCssVarIfDiff(baseBrush, "--vox-ac", "none");

      if (tasks.length <= 2) {
        plan.stats.stampPseudoHosts += 1;
        continue;
      }

      const brushOffset = 2;
      const remainingTasks = tasks.length - brushOffset;
      const brushCount = Math.ceil(remainingTasks / 3);
      for (let i = 0; i < brushCount; i += 1) {
        const base = tasks[brushOffset + i * 3];
        if (!base) continue;
        const brushRow0 = hostRow0 + base.rect.y;
        const brushCol0 = hostCol0 + base.rect.x;
        const brushRow1 = brushRow0 + base.rect.height;
        const brushCol1 = brushCol0 + base.rect.width;
        const detailBrush = nextBrush(axis);
        clearPlaneDetailVars(detailBrush);
        applyBrush(detailBrush, gridAreaFor(brushRow0, brushCol0, brushRow1, brushCol1), base.color, brushZ);
        const beforeTask = tasks[brushOffset + i * 3 + 1];
        const afterTask = tasks[brushOffset + i * 3 + 2];
        if (beforeTask) applyBrushPseudo(detailBrush, "before", beforeTask, base.rect);
        else setCssVarIfDiff(detailBrush, "--vox-bc", "none");
        if (afterTask) applyBrushPseudo(detailBrush, "after", afterTask, base.rect);
        else setCssVarIfDiff(detailBrush, "--vox-ac", "none");
      }
      plan.stats.stampPseudoHosts += 1;
      plan.stats.stampBrushHosts += brushCount;
    }
  }

  for (const axis of Object.keys(axisState) as PlaneShellAxis[]) {
    const bucket = axisState[axis];
    for (let i = bucket.index; i < bucket.pool.length; i += 1) bucket.pool[i]?.remove();
  }
};

export function renderPlaneShellMask(
  renderState: RenderState,
  planeShell: PlaneShellDomState | null,
  snapshot: PlaneShellSnapshot,
  documentRef: Document
): PlaneShellDomState {
  const hosts = ensurePlaneShellHosts(renderState, planeShell, documentRef);
  const context = snapshot.context;
  const rows = Math.max(context.rows, 1);
  const cols = Math.max(context.cols, 1);
  const depth = Math.max(snapshot.layers.length, 0);
  const lighting = context.lighting ?? null;
  const resolveTexture = context.resolveTexture ?? null;
  const offsets = context.offsets;
  const tileSize = context.tileSize ?? 50;
  const layerElevation = context.layerElevation ?? tileSize;
  const walls = context.walls ?? DEFAULT_WALLS;
  const wallsSig = wallsToSig(walls);
  const renderVersion = typeof context.renderVersion === "number" ? context.renderVersion : null;
  const hasRenderVersion = renderVersion !== null;

  const depsChanged =
    hosts.cacheLighting !== lighting ||
    hosts.cacheResolveTexture !== resolveTexture ||
    hosts.cacheOffsets !== offsets ||
    hosts.cacheTileSize !== tileSize ||
    hosts.cacheLayerElevation !== layerElevation ||
    hosts.cacheRows !== rows ||
    hosts.cacheCols !== cols ||
    hosts.cacheDepth !== depth ||
    hosts.cacheWallsSig !== wallsSig ||
    (hasRenderVersion && hosts.cacheRenderVersion !== renderVersion);

  if (depsChanged) {
    hosts.faceCache.clear();
    hosts.cacheLighting = lighting;
    hosts.cacheResolveTexture = resolveTexture;
    hosts.cacheOffsets = offsets;
    hosts.cacheTileSize = tileSize;
    hosts.cacheLayerElevation = layerElevation;
    hosts.cacheRows = rows;
    hosts.cacheCols = cols;
    hosts.cacheDepth = depth;
    hosts.cacheWallsSig = wallsSig;
    hosts.cacheRenderVersion = renderVersion;
    hosts.lastFaces = null;
  }
  if (hosts.cacheLayersRef !== snapshot.layers) {
    hosts.cacheLayersRef = snapshot.layers;
    hosts.lastFaces = null;
  }
  if (!depsChanged && hosts.lastFaces && hosts.cacheLayersRef === snapshot.layers && hasRenderVersion) {
    return hosts;
  }

  if (depsChanged) {
    for (const [host, w, h] of [
      [hosts.xHost, cols * tileSize, depth * layerElevation],
      [hosts.yHost, depth * layerElevation, rows * tileSize]
    ] as [HTMLElement, number, number][]) host.style.width = `${w}px`, host.style.height = `${h}px`;
    for (const [host, gridCols, gridRows, colPx, rowPx] of [
      [hosts.zHost, cols, rows, tileSize, tileSize],
      [hosts.xHost, cols, depth, tileSize, layerElevation],
      [hosts.yHost, depth, rows, layerElevation, tileSize]
    ] as [HTMLElement, number, number, number, number][]) {
      host.style.display = "grid";
      host.style.gridTemplateColumns = `repeat(${gridCols}, ${colPx}px)`;
      host.style.gridTemplateRows = `repeat(${gridRows}, ${rowPx}px)`;
    }
  }

  let plans: FacePlan[];
  let usedKeys: Set<string> | null = null;
  if (!depsChanged && hosts.lastFaces) {
    plans = hosts.lastFaces;
  } else {
    const faces = buildFaceDataFromSnapshot(snapshot);
    plans = [];
    usedKeys = new Set();
    for (const face of faces) {
      const cacheKey = buildCacheKey(face);
      let plan = hosts.faceCache.get(cacheKey);
      if (!plan) {
        plan = buildFacePlan(face);
        hosts.faceCache.set(cacheKey, plan);
      }
      plans.push(plan);
      usedKeys.add(cacheKey);
    }
    hosts.lastFaces = plans;
  }

  if (usedKeys) {
    for (const key of Array.from(hosts.faceCache.keys())) {
      if (usedKeys.has(key)) continue;
      hosts.faceCache.delete(key);
    }
  }

  renderFacePlans(hosts, snapshot, documentRef, plans);
  const stats = buildPlaneShellStats(plans, walls);
  updatePlaneShellStats(hosts, stats, context, plans, tileSize, layerElevation);
  syncPlaneShellStatsDataset(renderState.root, stats);
  return hosts;
}
