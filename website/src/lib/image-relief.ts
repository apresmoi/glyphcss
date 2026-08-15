import type { Polygon } from "glyphcss";

export type ReliefMode = "flat" | "steps" | "regions" | "columns";

export interface ReliefOptions {
  mode: ReliefMode;
  textureUrl: string;
  /** Image width / height. World: height 1 along X (screen-down), width = aspect along Y. */
  aspect: number;
  /** World-Z height of a full-luminance cell. */
  depth: number;
  /** Quantization levels for `steps` mode. */
  steps: number;
  /** 0..1 color-distance threshold for `regions` flood fill. */
  threshold: number;
}

export interface ReliefResult {
  polygons: Polygon[];
  cols: number;
  rows: number;
  regionCount: number;
}

/** Downsample an image to a glyph-friendly sampling grid. */
export function sampleImageToGrid(
  img: HTMLImageElement,
  rows: number,
): { data: ImageData; cols: number; rows: number } {
  const aspect = img.naturalWidth / img.naturalHeight || 1;
  const cols = Math.max(2, Math.round(rows * aspect));
  const canvas = document.createElement("canvas");
  canvas.width = cols;
  canvas.height = rows;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, cols, rows);
  return { data: ctx.getImageData(0, 0, cols, rows), cols, rows };
}

const lumOf = (r: number, g: number, b: number): number =>
  (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

const hex = (r: number, g: number, b: number): string =>
  `#${((1 << 24) | (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b)).toString(16).slice(1)}`;

export function buildReliefPolygons(grid: ImageData, opts: ReliefOptions): ReliefResult {
  const { mode, textureUrl, aspect } = opts;
  const W = grid.width;
  const H = grid.height;

  if (mode === "flat") {
    const h = 1;
    const w = aspect;
    return {
      polygons: [{
        vertices: [[-h / 2, -w / 2, 0], [-h / 2, w / 2, 0], [h / 2, w / 2, 0], [h / 2, -w / 2, 0]],
        texture: textureUrl,
        uvs: [[0, 1], [1, 1], [1, 0], [0, 0]],
      }],
      cols: W, rows: H, regionCount: 1,
    };
  }

  const px = grid.data;
  const n = W * H;
  const lum = new Float64Array(n);
  for (let i = 0; i < n; i++) lum[i] = lumOf(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]);

  // Per-cell height + merge key. Cells only merge into one top face when they
  // share a key, so `regions` keeps its fragmentation visible even where two
  // regions happen to land on the same height.
  const height = new Float64Array(n);
  const key = new Int32Array(n);
  let regionCount = 0;

  if (mode === "steps") {
    const levels = Math.max(2, Math.round(opts.steps));
    for (let i = 0; i < n; i++) {
      const q = Math.round(lum[i] * (levels - 1));
      height[i] = (q / (levels - 1)) * opts.depth;
      key[i] = q;
    }
    regionCount = levels;
  } else if (mode === "columns") {
    for (let i = 0; i < n; i++) {
      height[i] = lum[i] * opts.depth;
      key[i] = i; // never merge — every cell is its own column
    }
    regionCount = n;
  } else {
    // regions: flood fill on color distance to the region seed.
    const maxDist = opts.threshold * 441.673; // threshold × max RGB distance (√3·255)
    const region = new Int32Array(n).fill(-1);
    const queue = new Int32Array(n);
    for (let start = 0; start < n; start++) {
      if (region[start] !== -1) continue;
      const id = regionCount++;
      const sr = px[start * 4], sg = px[start * 4 + 1], sb = px[start * 4 + 2];
      let head = 0, tail = 0, lumSum = 0, size = 0;
      queue[tail++] = start;
      region[start] = id;
      while (head < tail) {
        const i = queue[head++];
        lumSum += lum[i];
        size++;
        const x = i % W, y = (i / W) | 0;
        for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1]) {
          if (j < 0 || region[j] !== -1) continue;
          const dr = px[j * 4] - sr, dg = px[j * 4 + 1] - sg, db = px[j * 4 + 2] - sb;
          if (Math.sqrt(dr * dr + dg * dg + db * db) <= maxDist) {
            region[j] = id;
            queue[tail++] = j;
          }
        }
      }
      const h = (lumSum / size) * opts.depth;
      for (let k = 0; k < tail; k++) height[queue[k]] = h;
      // heights are shared per region, so the region id is the merge key
      for (let k = 0; k < tail; k++) key[queue[k]] = id;
    }
  }

  // World mapping (matches the flat quad): X down, Y right, Z toward camera.
  const wx = (y: number): number => (y / H - 0.5) * 1;
  const wy = (x: number): number => (x / W - 0.5) * aspect;
  const u = (x: number): number => x / W;
  const v = (y: number): number => 1 - y / H;

  const polygons: Polygon[] = [];

  // Top faces: greedy horizontal run merge of equal (height, key).
  for (let y = 0; y < H; y++) {
    let x = 0;
    while (x < W) {
      const i = y * W + x;
      let x2 = x + 1;
      while (x2 < W && key[y * W + x2] === key[i] && height[y * W + x2] === height[i]) x2++;
      const z = height[i];
      polygons.push({
        vertices: [
          [wx(y), wy(x), z], [wx(y), wy(x2), z],
          [wx(y + 1), wy(x2), z], [wx(y + 1), wy(x), z],
        ],
        texture: textureUrl,
        uvs: [[u(x), v(y)], [u(x2), v(y)], [u(x2), v(y + 1)], [u(x), v(y + 1)]],
      });
      x = x2;
    }
  }

  // Walls where adjacent heights differ (grid border counts as height 0),
  // colored from the taller cell's texel, darkened. Runs of the same
  // (low, high, color) merge along the boundary.
  const wallColor = (i: number): string =>
    hex(px[i * 4] * 0.55, px[i * 4 + 1] * 0.55, px[i * 4 + 2] * 0.55);
  const hAt = (x: number, y: number): number =>
    x < 0 || y < 0 || x >= W || y >= H ? 0 : height[y * W + x];

  // Horizontal boundaries (between row y-1 and y) → walls along Y.
  for (let y = 0; y <= H; y++) {
    let x = 0;
    while (x < W) {
      const hi = hAt(x, y - 1), lo = hAt(x, y);
      if (hi === lo) { x++; continue; }
      const top = Math.max(hi, lo), bot = Math.min(hi, lo);
      const owner = hi > lo ? (y - 1) * W + x : y * W + x;
      const color = wallColor(owner);
      let x2 = x + 1;
      while (
        x2 < W &&
        Math.max(hAt(x2, y - 1), hAt(x2, y)) === top &&
        Math.min(hAt(x2, y - 1), hAt(x2, y)) === bot &&
        wallColor(hAt(x2, y - 1) > hAt(x2, y) ? (y - 1) * W + x2 : y * W + x2) === color
      ) x2++;
      polygons.push({
        vertices: [
          [wx(y), wy(x), bot], [wx(y), wy(x2), bot],
          [wx(y), wy(x2), top], [wx(y), wy(x), top],
        ],
        color,
      });
      x = x2;
    }
  }

  // Vertical boundaries (between col x-1 and x) → walls along X.
  for (let x = 0; x <= W; x++) {
    let y = 0;
    while (y < H) {
      const hi = hAt(x - 1, y), lo = hAt(x, y);
      if (hi === lo) { y++; continue; }
      const top = Math.max(hi, lo), bot = Math.min(hi, lo);
      const owner = hi > lo ? y * W + (x - 1) : y * W + x;
      const color = wallColor(owner);
      let y2 = y + 1;
      while (
        y2 < H &&
        Math.max(hAt(x - 1, y2), hAt(x, y2)) === top &&
        Math.min(hAt(x - 1, y2), hAt(x, y2)) === bot &&
        wallColor(hAt(x - 1, y2) > hAt(x, y2) ? y2 * W + (x - 1) : y2 * W + x) === color
      ) y2++;
      polygons.push({
        vertices: [
          [wx(y), wy(x), bot], [wx(y2), wy(x), bot],
          [wx(y2), wy(x), top], [wx(y), wy(x), top],
        ],
        color,
      });
      y = y2;
    }
  }

  return { polygons, cols: W, rows: H, regionCount };
}
