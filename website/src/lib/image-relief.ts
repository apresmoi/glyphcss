import type { Polygon } from "glyphcss";

export interface ShapePlatesOptions {
  textureUrl: string;
  /** Image width / height. World: height 1 along X (screen-down), width = aspect along Y. */
  aspect: number;
  /** Number of color groups the image is posterized into. */
  groups: number;
  /** World-Z span between the lowest and highest plate. */
  depth: number;
  /** Photo mode: keep image texels on the plates (image-space UVs) instead of
   *  flat posterized color (per-shape UVs). */
  texture: boolean;
}

export interface ShapePlatesResult {
  polygons: Polygon[];
  cols: number;
  rows: number;
  groupCount: number;
  shapeCount: number;
}

/** Downsample an image to a segmentation-friendly sampling grid. */
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

export function buildFlatQuad(textureUrl: string, aspect: number): Polygon[] {
  const h = 1;
  const w = aspect;
  return [{
    vertices: [[-h / 2, -w / 2, 0], [-h / 2, w / 2, 0], [h / 2, w / 2, 0], [h / 2, -w / 2, 0]],
    texture: textureUrl,
    uvs: [[0, 1], [1, 1], [1, 0], [0, 0]],
  }];
}

const lumOf = (r: number, g: number, b: number): number =>
  (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

const hex = (r: number, g: number, b: number): string =>
  `#${((1 << 24) | (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b)).toString(16).slice(1)}`;

/** K-means color quantization → per-cell bucket index + bucket mean colors. */
function quantize(px: Uint8ClampedArray, n: number, k: number): { bucket: Int32Array; colors: [number, number, number][] } {
  // Seed centroids from luminance quantiles so they spread the tonal range.
  const order = Array.from({ length: n }, (_, i) => i)
    .sort((a, b) => lumOf(px[a * 4], px[a * 4 + 1], px[a * 4 + 2]) - lumOf(px[b * 4], px[b * 4 + 1], px[b * 4 + 2]));
  const centroids: [number, number, number][] = [];
  for (let c = 0; c < k; c++) {
    const i = order[Math.min(n - 1, Math.round(((c + 0.5) / k) * n))];
    centroids.push([px[i * 4], px[i * 4 + 1], px[i * 4 + 2]]);
  }
  const bucket = new Int32Array(n);
  for (let iter = 0; iter < 8; iter++) {
    const sum = centroids.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < n; i++) {
      const r = px[i * 4], g = px[i * 4 + 1], b = px[i * 4 + 2];
      let best = 0, bestD = Infinity;
      for (let c = 0; c < k; c++) {
        const dr = r - centroids[c][0], dg = g - centroids[c][1], db = b - centroids[c][2];
        const d = dr * dr + dg * dg + db * db;
        if (d < bestD) { bestD = d; best = c; }
      }
      bucket[i] = best;
      sum[best][0] += r; sum[best][1] += g; sum[best][2] += b; sum[best][3]++;
    }
    for (let c = 0; c < k; c++) {
      if (sum[c][3] > 0) centroids[c] = [sum[c][0] / sum[c][3], sum[c][1] / sum[c][3], sum[c][2] / sum[c][3]];
    }
  }
  return { bucket, colors: centroids };
}

/** One 3×3 majority pass to kill speckle so shapes merge into large plates. */
function majorityFilter(bucket: Int32Array, W: number, H: number, k: number): Int32Array {
  const out = new Int32Array(bucket.length);
  const counts = new Int32Array(k);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    counts.fill(0);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      counts[bucket[ny * W + nx]]++;
    }
    const self = bucket[y * W + x];
    let best = self;
    for (let c = 0; c < k; c++) if (counts[c] > counts[best]) best = c;
    out[y * W + x] = best;
  }
  return out;
}

/** 4-connected component labeling over the bucket map. */
function labelShapes(bucket: Int32Array, W: number, H: number): { shape: Int32Array; shapeCount: number } {
  const n = W * H;
  const shape = new Int32Array(n).fill(-1);
  const queue = new Int32Array(n);
  let shapeCount = 0;
  for (let start = 0; start < n; start++) {
    if (shape[start] !== -1) continue;
    const id = shapeCount++;
    const b = bucket[start];
    let head = 0, tail = 0;
    queue[tail++] = start;
    shape[start] = id;
    while (head < tail) {
      const i = queue[head++];
      const x = i % W, y = (i / W) | 0;
      for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1]) {
        if (j >= 0 && shape[j] === -1 && bucket[j] === b) { shape[j] = id; queue[tail++] = j; }
      }
    }
  }
  return { shape, shapeCount };
}

/**
 * Posterize the image into `groups` color plates. Every connected shape of a
 * group becomes a few LARGE merged polygons on that group's height plane, and
 * (in flat-color mode) carries UVs normalized to its own bounding box — so a
 * mounted effect gets one coherent field per shape instead of per-cell noise.
 */
export function buildShapePlates(grid: ImageData, opts: ShapePlatesOptions): ShapePlatesResult {
  const { aspect, textureUrl } = opts;
  const W = grid.width;
  const H = grid.height;
  const n = W * H;
  const px = grid.data;
  const k = Math.max(2, Math.round(opts.groups));

  const { bucket: rawBucket, colors } = quantize(px, n, k);
  const bucket = majorityFilter(rawBucket, W, H, k);
  const { shape, shapeCount } = labelShapes(bucket, W, H);

  // Plate heights: groups ranked by luminance, evenly spaced up to `depth`.
  const rank = colors
    .map((c, i) => ({ i, lum: lumOf(c[0], c[1], c[2]) }))
    .sort((a, b) => a.lum - b.lum);
  const heightOf = new Float64Array(k);
  for (let r = 0; r < rank.length; r++) heightOf[rank[r].i] = (r / Math.max(1, k - 1)) * opts.depth;

  // Per-shape bounding box for shape-local UV domains.
  const bbox = new Int32Array(shapeCount * 4);
  for (let s = 0; s < shapeCount; s++) bbox.set([W, H, -1, -1], s * 4);
  for (let i = 0; i < n; i++) {
    const s = shape[i] * 4, x = i % W, y = (i / W) | 0;
    if (x < bbox[s]) bbox[s] = x;
    if (y < bbox[s + 1]) bbox[s + 1] = y;
    if (x > bbox[s + 2]) bbox[s + 2] = x;
    if (y > bbox[s + 3]) bbox[s + 3] = y;
  }

  const wx = (y: number): number => (y / H - 0.5) * 1;
  const wy = (x: number): number => (x / W - 0.5) * aspect;

  // Greedy maximal-rectangle decomposition per shape → few large polygons.
  const claimed = new Uint8Array(n);
  const polygons: Polygon[] = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (claimed[i]) continue;
    const s = shape[i];
    let x2 = x + 1;
    while (x2 < W && !claimed[y * W + x2] && shape[y * W + x2] === s) x2++;
    let y2 = y + 1;
    outer: while (y2 < H) {
      for (let xx = x; xx < x2; xx++) {
        const j = y2 * W + xx;
        if (claimed[j] || shape[j] !== s) break outer;
      }
      y2++;
    }
    for (let yy = y; yy < y2; yy++) for (let xx = x; xx < x2; xx++) claimed[yy * W + xx] = 1;

    const b = bucket[i];
    const z = heightOf[b];
    const vertices: Polygon["vertices"] = [
      [wx(y), wy(x), z], [wx(y), wy(x2), z],
      [wx(y2), wy(x2), z], [wx(y2), wy(x), z],
    ];
    if (opts.texture) {
      // Photo mode: image-space UVs so the texels land where they came from.
      const u = (xx: number): number => xx / W;
      const v = (yy: number): number => 1 - yy / H;
      polygons.push({
        vertices,
        texture: textureUrl,
        uvs: [[u(x), v(y)], [u(x2), v(y)], [u(x2), v(y2)], [u(x), v(y2)]],
      });
    } else {
      // Shape mode: flat group color + UVs normalized to THIS shape's bbox,
      // so every shape carries its own complete 0..1 effect domain.
      const bx = s * 4;
      const sw = bbox[bx + 2] - bbox[bx] + 1;
      const sh = bbox[bx + 3] - bbox[bx + 1] + 1;
      const u = (xx: number): number => (xx - bbox[bx]) / sw;
      const v = (yy: number): number => 1 - (yy - bbox[bx + 1]) / sh;
      polygons.push({
        vertices,
        color: hex(colors[b][0], colors[b][1], colors[b][2]),
        uvs: [[u(x), v(y)], [u(x2), v(y)], [u(x2), v(y2)], [u(x), v(y2)]],
      });
    }
  }

  return { polygons, cols: W, rows: H, groupCount: k, shapeCount };
}
