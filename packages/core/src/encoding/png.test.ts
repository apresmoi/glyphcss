import { describe, it, expect } from "vitest";
import { encodeRgbaToPng, encodeRgbToPng } from "./png";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function readUint32BE(buf: Uint8Array, offset: number): number {
  return (
    ((buf[offset] << 24) | (buf[offset + 1] << 16) | (buf[offset + 2] << 8) | buf[offset + 3]) >>>
    0
  );
}

function readChunkType(buf: Uint8Array, offset: number): string {
  return String.fromCharCode(buf[offset], buf[offset + 1], buf[offset + 2], buf[offset + 3]);
}

function findChunks(png: Uint8Array): Array<{ type: string; offset: number; length: number }> {
  const chunks: Array<{ type: string; offset: number; length: number }> = [];
  let offset = 8; // skip signature
  while (offset < png.length) {
    const length = readUint32BE(png, offset);
    const type = readChunkType(png, offset + 4);
    chunks.push({ type, offset, length });
    offset += 4 + 4 + length + 4; // length field + type + data + crc
  }
  return chunks;
}

describe("encodeRgbaToPng", () => {
  const width = 2;
  const height = 2;
  const rgba = new Uint8Array(width * height * 4);
  // Fill with solid red
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4] = 255; // R
    rgba[i * 4 + 1] = 0; // G
    rgba[i * 4 + 2] = 0; // B
    rgba[i * 4 + 3] = 255; // A
  }

  it("starts with PNG signature bytes", () => {
    const png = encodeRgbaToPng(rgba, width, height);
    for (let i = 0; i < PNG_SIGNATURE.length; i++) {
      expect(png[i]).toBe(PNG_SIGNATURE[i]);
    }
  });

  it("contains IHDR chunk", () => {
    const png = encodeRgbaToPng(rgba, width, height);
    const chunks = findChunks(png);
    const ihdr = chunks.find((c) => c.type === "IHDR");
    expect(ihdr).toBeDefined();
    expect(ihdr!.length).toBe(13);
  });

  it("IHDR has correct width and height", () => {
    const png = encodeRgbaToPng(rgba, width, height);
    // IHDR data starts at offset 8 (signature) + 4 (length) + 4 (type) = 16
    const ihdrDataOffset = 8 + 4 + 4;
    expect(readUint32BE(png, ihdrDataOffset)).toBe(width);
    expect(readUint32BE(png, ihdrDataOffset + 4)).toBe(height);
  });

  it("IHDR has color type 6 (RGBA)", () => {
    const png = encodeRgbaToPng(rgba, width, height);
    const ihdrDataOffset = 8 + 4 + 4;
    const bitDepth = png[ihdrDataOffset + 8];
    const colorType = png[ihdrDataOffset + 9];
    expect(bitDepth).toBe(8);
    expect(colorType).toBe(6);
  });

  it("contains IDAT chunk", () => {
    const png = encodeRgbaToPng(rgba, width, height);
    const chunks = findChunks(png);
    const idat = chunks.find((c) => c.type === "IDAT");
    expect(idat).toBeDefined();
    expect(idat!.length).toBeGreaterThan(0);
  });

  it("contains IEND chunk", () => {
    const png = encodeRgbaToPng(rgba, width, height);
    const chunks = findChunks(png);
    const iend = chunks.find((c) => c.type === "IEND");
    expect(iend).toBeDefined();
    expect(iend!.length).toBe(0);
  });

  it("chunks appear in order: IHDR, IDAT, IEND", () => {
    const png = encodeRgbaToPng(rgba, width, height);
    const chunks = findChunks(png);
    expect(chunks.length).toBe(3);
    expect(chunks[0].type).toBe("IHDR");
    expect(chunks[1].type).toBe("IDAT");
    expect(chunks[2].type).toBe("IEND");
  });

  it("throws on wrong buffer size", () => {
    const wrongSize = new Uint8Array(10);
    expect(() => encodeRgbaToPng(wrongSize, 2, 2)).toThrow(/voxcss:/);
  });

  it("throws on zero width", () => {
    expect(() => encodeRgbaToPng(new Uint8Array(0), 0, 1)).toThrow(/voxcss:/);
  });

  it("throws on zero height", () => {
    expect(() => encodeRgbaToPng(new Uint8Array(0), 1, 0)).toThrow(/voxcss:/);
  });

  it("throws on negative dimensions", () => {
    expect(() => encodeRgbaToPng(new Uint8Array(0), -1, 1)).toThrow(/voxcss:/);
  });

  it("throws on non-integer dimensions", () => {
    expect(() => encodeRgbaToPng(new Uint8Array(8), 1.5, 1)).toThrow(/voxcss:/);
  });

  it("throws on NaN dimensions", () => {
    expect(() => encodeRgbaToPng(new Uint8Array(0), NaN, 1)).toThrow(/voxcss:/);
  });

  it("throws on Infinity dimensions", () => {
    expect(() => encodeRgbaToPng(new Uint8Array(0), Infinity, 1)).toThrow(/voxcss:/);
  });

  it("encodes a 1x1 image", () => {
    const pixel = new Uint8Array([128, 64, 32, 255]);
    const png = encodeRgbaToPng(pixel, 1, 1);
    expect(png.length).toBeGreaterThan(PNG_SIGNATURE.length);
    const chunks = findChunks(png);
    expect(chunks.map((c) => c.type)).toEqual(["IHDR", "IDAT", "IEND"]);
  });
});

describe("encodeRgbToPng", () => {
  const width = 2;
  const height = 2;
  const rgb = new Uint8Array(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    rgb[i * 3] = 0;
    rgb[i * 3 + 1] = 255;
    rgb[i * 3 + 2] = 0;
  }

  it("starts with PNG signature", () => {
    const png = encodeRgbToPng(rgb, width, height);
    for (let i = 0; i < PNG_SIGNATURE.length; i++) {
      expect(png[i]).toBe(PNG_SIGNATURE[i]);
    }
  });

  it("IHDR has color type 2 (RGB)", () => {
    const png = encodeRgbToPng(rgb, width, height);
    const ihdrDataOffset = 8 + 4 + 4;
    const colorType = png[ihdrDataOffset + 9];
    expect(colorType).toBe(2);
  });

  it("contains IHDR, IDAT, and IEND chunks", () => {
    const png = encodeRgbToPng(rgb, width, height);
    const chunks = findChunks(png);
    expect(chunks.map((c) => c.type)).toEqual(["IHDR", "IDAT", "IEND"]);
  });

  it("throws on wrong buffer size", () => {
    expect(() => encodeRgbToPng(new Uint8Array(10), 2, 2)).toThrow(/voxcss:/);
  });

  it("throws on zero dimensions", () => {
    expect(() => encodeRgbToPng(new Uint8Array(0), 0, 1)).toThrow(/voxcss:/);
  });

  it("throws on non-integer dimensions", () => {
    expect(() => encodeRgbToPng(new Uint8Array(6), 1.5, 1)).toThrow(/voxcss:/);
  });
});

