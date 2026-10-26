/**
 * Streams the AWS Open Data terrain tiles (Mapzen "terrarium" encoding, no
 * key, CORS `*`) and resamples them onto this site's equal-angle geo-tile
 * pyramid, so city-scale views stand on ~30 m ground instead of the baked
 * ETOPO1 pyramid's 0.125-degree posts.
 *
 * Why it exists: at z4 one ETOPO1 post covers ~10 x 14 km, so a whole city
 * sits on one triangle stretched between posts that can land on hilltops
 * (Florence's valley floor drew at 120-340 m against a real ~50 m). Tilting
 * a ramp that steep turns everything draped on it, which read as the camera
 * rotating the wrong way.
 *
 * The PNGs are decoded here with the platform's `DecompressionStream`, not a
 * canvas: they are data, and this site renders nothing through canvas.
 */
import type { GlyphMapAttribution, GlyphMapBounds, GlyphMapGeoTile } from "@glyphcss/maps";

export const TERRARIUM_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium";
/** The tileset's deepest zoom. */
export const TERRARIUM_MAX_ZOOM = 15;

export const TERRARIUM_ATTRIBUTION: GlyphMapAttribution = {
  name: "Mapzen Terrain Tiles on AWS (SRTM, EU-DEM, GMTED2010, USGS 3DEP, ETOPO1 and others)",
  url: "https://github.com/tilezen/joerd/blob/master/docs/attribution.md",
  license: "Open data, attribution required",
};

const TILE_PX = 256;

/** Decodes an 8-bit, non-interlaced RGB or RGBA PNG to its raw pixels. Throws on anything else. */
export async function decodePng(bytes: Uint8Array): Promise<{ width: number; height: number; channels: number; pixels: Uint8Array }> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0) !== 0x89504e47 || view.getUint32(4) !== 0x0d0a1a0a) throw new Error("PNG: bad signature.");
  let width = 0, height = 0, channels = 0;
  const idat: Uint8Array[] = [];
  for (let at = 8; at + 8 <= bytes.length; ) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(bytes[at + 4], bytes[at + 5], bytes[at + 6], bytes[at + 7]);
    const data = bytes.subarray(at + 8, at + 8 + length);
    if (type === "IHDR") {
      width = view.getUint32(at + 8);
      height = view.getUint32(at + 12);
      const depth = data[8], colorType = data[9], interlace = data[12];
      if (depth !== 8 || (colorType !== 2 && colorType !== 6) || interlace !== 0) {
        throw new Error(`PNG: unsupported depth ${depth} / colour type ${colorType} / interlace ${interlace}.`);
      }
      channels = colorType === 2 ? 3 : 4;
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    at += 12 + length;
  }
  if (!channels) throw new Error("PNG: no IHDR.");
  const deflated = new Uint8Array(idat.reduce((n, d) => n + d.length, 0));
  idat.reduce((at, d) => (deflated.set(d, at), at + d.length), 0);
  const inflated = new Uint8Array(await new Response(new Blob([deflated]).stream().pipeThrough(new DecompressionStream("deflate"))).arrayBuffer());
  const stride = width * channels;
  if (inflated.length !== height * (stride + 1)) throw new Error(`PNG: ${inflated.length} inflated bytes for ${width}x${height}.`);
  const pixels = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = inflated[y * (stride + 1)];
    const src = y * (stride + 1) + 1, out = y * stride, up = out - stride;
    for (let i = 0; i < stride; i++) {
      const x = inflated[src + i];
      const a = i >= channels ? pixels[out + i - channels] : 0;
      const b = y > 0 ? pixels[up + i] : 0;
      const c = y > 0 && i >= channels ? pixels[up + i - channels] : 0;
      let v: number;
      switch (filter) {
        case 0: v = x; break;
        case 1: v = x + a; break;
        case 2: v = x + b; break;
        case 3: v = x + ((a + b) >> 1); break;
        case 4: {
          const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default: throw new Error(`PNG: bad filter ${filter} on row ${y}.`);
      }
      pixels[out + i] = v & 0xff;
    }
  }
  return { width, height, channels, pixels };
}

/** Terrarium pixels to metres: `R * 256 + G + B / 256 - 32768`. */
export function terrariumElevations(png: { width: number; height: number; channels: number; pixels: Uint8Array }): Float32Array {
  const out = new Float32Array(png.width * png.height);
  for (let i = 0, p = 0; i < out.length; i++, p += png.channels) {
    out[i] = png.pixels[p] * 256 + png.pixels[p + 1] + png.pixels[p + 2] / 256 - 32768;
  }
  return out;
}

const mercY = (lat: number) => {
  const r = (Math.max(-85.05112878, Math.min(85.05112878, lat)) * Math.PI) / 180;
  return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2;
};

/**
 * Builds one equal-angle tile of `cols x rows` quads over `bounds` by
 * bilinear reads of terrarium zoom `zoom` (pixel centres). `fetchTile`
 * returns a tile's 256x256 elevations; any failure rejects the whole tile so
 * the caller can fall back rather than mount a hole.
 */
export async function buildTerrariumGeoTile(
  bounds: GlyphMapBounds,
  cols: number,
  rows: number,
  zoom: number,
  fetchTile: (z: number, x: number, y: number) => Promise<Float32Array>,
): Promise<GlyphMapGeoTile> {
  const n = 2 ** zoom, size = n * TILE_PX;
  const pxX = (lon: number) => ((lon + 180) / 360) * size - 0.5;
  const pxY = (lat: number) => mercY(lat) * size - 0.5;
  const clampPx = (p: number) => Math.max(0, Math.min(size - 1, p));
  const x0 = Math.floor(clampPx(pxX(bounds.west)) / TILE_PX), x1 = Math.floor(clampPx(Math.floor(pxX(bounds.east)) + 1) / TILE_PX);
  const y0 = Math.floor(clampPx(pxY(bounds.north)) / TILE_PX), y1 = Math.floor(clampPx(Math.floor(pxY(bounds.south)) + 1) / TILE_PX);
  const tiles = new Map<string, Float32Array>();
  const loads: Promise<void>[] = [];
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) loads.push(fetchTile(zoom, tx, ty).then((t) => void tiles.set(`${tx}_${ty}`, t)));
  }
  await Promise.all(loads);
  const at = (px: number, py: number) => {
    const tx = Math.floor(px / TILE_PX), ty = Math.floor(py / TILE_PX);
    return tiles.get(`${tx}_${ty}`)![(py - ty * TILE_PX) * TILE_PX + (px - tx * TILE_PX)];
  };
  const elevation = new Float32Array((cols + 1) * (rows + 1));
  for (let r = 0; r <= rows; r++) {
    const py = clampPx(pxY(bounds.north - ((bounds.north - bounds.south) * r) / rows));
    const iy = Math.min(size - 2, Math.floor(py)), fy = py - iy;
    for (let c = 0; c <= cols; c++) {
      const px = clampPx(pxX(bounds.west + ((bounds.east - bounds.west) * c) / cols));
      const ix = Math.min(size - 2, Math.floor(px)), fx = px - ix;
      const top = at(ix, iy) * (1 - fx) + at(ix + 1, iy) * fx;
      const bottom = at(ix, iy + 1) * (1 - fx) + at(ix + 1, iy + 1) * fx;
      elevation[r * (cols + 1) + c] = top * (1 - fy) + bottom * fy;
    }
  }
  return { bounds, cols, rows, elevation, source: "terrarium", sampler: "bilinear" };
}

/**
 * Fetch-and-decode with a small LRU of decoded tiles: neighbouring
 * equal-angle tiles share mercator tiles at every seam, and a decoded tile is
 * 256 KB.
 */
export function createTerrariumFetcher(baseUrl = TERRARIUM_URL, capacity = 64): (z: number, x: number, y: number) => Promise<Float32Array> {
  const cache = new Map<string, Promise<Float32Array>>();
  return (z, x, y) => {
    const key = `${z}/${x}/${y}`;
    const hit = cache.get(key);
    if (hit) {
      cache.delete(key);
      cache.set(key, hit);
      return hit;
    }
    const load = (async () => {
      const res = await fetch(`${baseUrl}/${key}.png`);
      if (!res.ok) throw new Error(`terrarium tile ${key}: HTTP ${res.status}.`);
      return terrariumElevations(await decodePng(new Uint8Array(await res.arrayBuffer())));
    })();
    // A failed load must not stay cached, or one dropped request pins that tile to the fallback for the session.
    // Only its own entry: an LRU eviction may have let a newer load take the key.
    load.catch(() => { if (cache.get(key) === load) cache.delete(key); });
    cache.set(key, load);
    while (cache.size > capacity) cache.delete(cache.keys().next().value!);
    return load;
  };
}
