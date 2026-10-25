import { describe, expect, it } from "vitest";
import { buildTerrariumGeoTile, decodePng, terrariumElevations } from "./terrariumTiles";

function crcTable(): Uint32Array {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
}
const CRC = crcTable();
function chunk(type: string, data: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(12 + data.length), view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  let c = 0xffffffff;
  for (let i = 4; i < 8 + data.length; i++) c = CRC[(c ^ out[i]) & 0xff] ^ (c >>> 8);
  view.setUint32(8 + data.length, (c ^ 0xffffffff) >>> 0);
  return out;
}

/** Encodes RGB pixels as a PNG, cycling every row through all five filter types. */
async function encodePng(width: number, height: number, rgb: Uint8Array): Promise<Uint8Array> {
  const stride = width * 3, raw = new Uint8Array(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    const filter = y % 5;
    raw[y * (stride + 1)] = filter;
    for (let i = 0; i < stride; i++) {
      const x = rgb[y * stride + i];
      const a = i >= 3 ? rgb[y * stride + i - 3] : 0;
      const b = y > 0 ? rgb[(y - 1) * stride + i] : 0;
      const c = y > 0 && i >= 3 ? rgb[(y - 1) * stride + i - 3] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const pred = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][filter];
      raw[y * (stride + 1) + 1 + i] = (x - pred) & 0xff;
    }
  }
  const z = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream("deflate"))).arrayBuffer());
  const ihdr = new Uint8Array(13), hv = new DataView(ihdr.buffer);
  hv.setUint32(0, width);
  hv.setUint32(4, height);
  ihdr.set([8, 2, 0, 0, 0], 8);
  // Split IDAT in two: the decoder must concatenate chunks before inflating.
  const half = z.length >> 1;
  const parts: Uint8Array<ArrayBuffer>[] = [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", z.subarray(0, half)), chunk("IDAT", z.subarray(half)), chunk("IEND", new Uint8Array())];
  return new Uint8Array(await new Blob(parts).arrayBuffer());
}

describe("decodePng", () => {
  it("round-trips RGB pixels through every row filter and a split IDAT", async () => {
    const width = 7, height = 10, rgb = new Uint8Array(width * height * 3);
    for (let i = 0; i < rgb.length; i++) rgb[i] = (i * 37 + ((i * i) % 11) * 19) & 0xff;
    const png = await decodePng(await encodePng(width, height, rgb));
    expect([png.width, png.height, png.channels]).toEqual([width, height, 3]);
    expect(Array.from(png.pixels)).toEqual(Array.from(rgb));
  });

  it("decodes terrarium RGB to metres", () => {
    // 128*256 + 50 + 128/256 - 32768 = 50.5 m; 127*256 + 255 - 32768 = -1 m.
    const e = terrariumElevations({ width: 2, height: 1, channels: 3, pixels: new Uint8Array([128, 50, 128, 127, 255, 0]) });
    expect(Array.from(e)).toEqual([50.5, -1]);
  });
});

describe("buildTerrariumGeoTile", () => {
  it("reads every vertex from the mercator pixel it falls on, exactly for a field linear in pixels", async () => {
    const zoom = 3, size = 256 * 2 ** zoom;
    // A field linear in GLOBAL pixel coordinates is reproduced exactly by bilinear reads at pixel centres.
    const field = (px: number, py: number) => px * 0.25 - py * 0.5;
    const fetched: string[] = [];
    const tile = await buildTerrariumGeoTile({ west: 10, east: 55, south: 22.5, north: 45 }, 6, 3, zoom, async (z, x, y) => {
      fetched.push(`${z}/${x}/${y}`);
      const out = new Float32Array(256 * 256);
      for (let j = 0; j < 256; j++) for (let i = 0; i < 256; i++) out[j * 256 + i] = field(x * 256 + i, y * 256 + j);
      return out;
    });
    const mercY = (lat: number) => {
      const r = (lat * Math.PI) / 180;
      return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2;
    };
    for (let r = 0; r <= 3; r++) {
      for (let c = 0; c <= 6; c++) {
        const lon = 10 + 7.5 * c, lat = 45 - 7.5 * r;
        const want = field(((lon + 180) / 360) * size - 0.5, mercY(lat) * size - 0.5);
        expect(tile.elevation[r * 7 + c]).toBeCloseTo(want, 3);
      }
    }
    // 10..55 degrees east spans mercator columns 4..5 at z3; 22.5..45 north spans rows 2..3.
    expect(fetched.sort()).toEqual(["3/4/2", "3/4/3", "3/5/2", "3/5/3"]);
  });

  it("rejects when any covering terrain tile fails, so the caller can fall back instead of mounting a hole", async () => {
    await expect(
      buildTerrariumGeoTile({ west: 0, east: 1, south: 0, north: 1 }, 2, 1, 5, async () => {
        throw new Error("HTTP 503");
      }),
    ).rejects.toThrow("HTTP 503");
  });
});
