import { describe, it, expect } from "vitest";
import { parseMagicaVoxel } from "./parseMagicaVoxel";

// ---------------------------------------------------------------------------
// Helpers for building synthetic .vox files
// ---------------------------------------------------------------------------

function buildVoxBuffer(options: {
  sizeX?: number;
  sizeY?: number;
  sizeZ?: number;
  voxels?: Array<{ x: number; y: number; z: number; colorIndex: number }>;
  includeRGBA?: boolean;
  extraChunks?: Array<{ id: string; content: Uint8Array }>;
  skipSize?: boolean;
  skipXYZI?: boolean;
}): ArrayBuffer {
  const {
    sizeX = 4,
    sizeY = 4,
    sizeZ = 4,
    voxels = [],
    includeRGBA = false,
    extraChunks = [],
    skipSize = false,
    skipXYZI = false
  } = options;

  const chunks: Uint8Array[] = [];

  // SIZE chunk
  if (!skipSize) {
    const sizeChunk = new Uint8Array(12 + 12);
    const sizeView = new DataView(sizeChunk.buffer);
    writeString(sizeChunk, 0, "SIZE");
    sizeView.setInt32(4, 12, true); // content size
    sizeView.setInt32(8, 0, true);  // children size
    sizeView.setInt32(12, sizeX, true);
    sizeView.setInt32(16, sizeY, true);
    sizeView.setInt32(20, sizeZ, true);
    chunks.push(sizeChunk);
  }

  // XYZI chunk
  if (!skipXYZI) {
    const xyziContentSize = 4 + voxels.length * 4;
    const xyziChunk = new Uint8Array(12 + xyziContentSize);
    const xyziView = new DataView(xyziChunk.buffer);
    writeString(xyziChunk, 0, "XYZI");
    xyziView.setInt32(4, xyziContentSize, true);
    xyziView.setInt32(8, 0, true);
    xyziView.setInt32(12, voxels.length, true);
    for (let i = 0; i < voxels.length; i++) {
      const v = voxels[i];
      xyziChunk[16 + i * 4 + 0] = v.x;
      xyziChunk[16 + i * 4 + 1] = v.y;
      xyziChunk[16 + i * 4 + 2] = v.z;
      xyziChunk[16 + i * 4 + 3] = v.colorIndex;
    }
    chunks.push(xyziChunk);
  }

  // RGBA chunk
  if (includeRGBA) {
    const rgbaContent = new Uint8Array(256 * 4);
    for (let i = 0; i < 256; i++) {
      rgbaContent[i * 4 + 0] = i;        // r
      rgbaContent[i * 4 + 1] = 255 - i;  // g
      rgbaContent[i * 4 + 2] = 128;      // b
      rgbaContent[i * 4 + 3] = 255;      // a
    }
    const rgbaChunk = new Uint8Array(12 + 256 * 4);
    const rgbaView = new DataView(rgbaChunk.buffer);
    writeString(rgbaChunk, 0, "RGBA");
    rgbaView.setInt32(4, 256 * 4, true);
    rgbaView.setInt32(8, 0, true);
    rgbaChunk.set(rgbaContent, 12);
    chunks.push(rgbaChunk);
  }

  // Extra chunks (unknown chunk types, for testing skip logic)
  for (const chunk of extraChunks) {
    const chunkBuf = new Uint8Array(12 + chunk.content.length);
    const chunkView = new DataView(chunkBuf.buffer);
    writeString(chunkBuf, 0, chunk.id);
    chunkView.setInt32(4, chunk.content.length, true);
    chunkView.setInt32(8, 0, true);
    chunkBuf.set(chunk.content, 12);
    chunks.push(chunkBuf);
  }

  // Compute total children size
  let childrenSize = 0;
  for (const chunk of chunks) childrenSize += chunk.length;

  // Header: "VOX " + version(4) + MAIN(4) + contentSize(4) + childrenSize(4)
  const headerSize = 4 + 4 + 4 + 4 + 4;
  const totalSize = headerSize + childrenSize;
  const buffer = new ArrayBuffer(totalSize);
  const uint8 = new Uint8Array(buffer);
  const view = new DataView(buffer);

  // Magic
  writeString(uint8, 0, "VOX ");
  // Version
  view.setInt32(4, 150, true);
  // MAIN chunk header
  writeString(uint8, 8, "MAIN");
  view.setInt32(12, 0, true);      // MAIN content size (should be 0)
  view.setInt32(16, childrenSize, true); // MAIN children size

  // Write children
  let offset = 20;
  for (const chunk of chunks) {
    uint8.set(chunk, offset);
    offset += chunk.length;
  }

  return buffer;
}

function writeString(buf: Uint8Array, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    buf[offset + i] = str.charCodeAt(i);
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("parseMagicaVoxel — extended coverage", () => {
  // =========================================================================
  // Line 101: Unknown chunk type skipping
  // When an unknown chunk is encountered (not SIZE, XYZI, or RGBA), the parser
  // should skip it by advancing offset by chunkSize.
  // =========================================================================
  describe("unknown chunk types", () => {
    it("skips unknown chunk types without error", () => {
      const unknownContent = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
      const buffer = buildVoxBuffer({
        sizeX: 2,
        sizeY: 2,
        sizeZ: 2,
        voxels: [{ x: 0, y: 0, z: 0, colorIndex: 1 }],
        extraChunks: [{ id: "UNKN", content: unknownContent }]
      });

      const result = parseMagicaVoxel(buffer);
      expect(result.voxels.length).toBe(1);
      expect(result.rows).toBe(2);
      expect(result.cols).toBe(2);
      expect(result.depth).toBe(2);
    });

    it("skips multiple unknown chunk types", () => {
      const buffer = buildVoxBuffer({
        sizeX: 2,
        sizeY: 2,
        sizeZ: 2,
        voxels: [{ x: 0, y: 0, z: 0, colorIndex: 1 }],
        extraChunks: [
          { id: "MATL", content: new Uint8Array(16) },
          { id: "nTRN", content: new Uint8Array(24) },
          { id: "nGRP", content: new Uint8Array(8) }
        ]
      });

      const result = parseMagicaVoxel(buffer);
      expect(result.voxels.length).toBe(1);
    });
  });

  // =========================================================================
  // Line 107: Chunk content not fully consumed (consumed < chunkSize)
  // This happens when a known chunk handler doesn't read all the content bytes,
  // e.g., if SIZE chunk content is larger than expected.
  // =========================================================================
  describe("chunk content advance guard", () => {
    it("advances past chunk content even if handler reads less than chunkSize", () => {
      // Build a buffer manually where the SIZE chunk has extra padding bytes
      // (chunkSize > actual data consumed by handler)
      const chunks: Uint8Array[] = [];

      // SIZE chunk with extra padding (says 20 bytes but only has 12 bytes of SIZE data)
      const sizeChunkSize = 20; // More than the 12 bytes SIZE normally reads
      const sizeChunk = new Uint8Array(12 + sizeChunkSize);
      const sizeView = new DataView(sizeChunk.buffer);
      writeString(sizeChunk, 0, "SIZE");
      sizeView.setInt32(4, sizeChunkSize, true);
      sizeView.setInt32(8, 0, true);
      sizeView.setInt32(12, 3, true); // sizeX
      sizeView.setInt32(16, 3, true); // sizeY
      sizeView.setInt32(20, 3, true); // sizeZ
      // Bytes 24-31 are padding (8 extra bytes)
      chunks.push(sizeChunk);

      // XYZI chunk
      const voxels = [{ x: 0, y: 0, z: 0, colorIndex: 1 }];
      const xyziContentSize = 4 + voxels.length * 4;
      const xyziChunk = new Uint8Array(12 + xyziContentSize);
      const xyziView = new DataView(xyziChunk.buffer);
      writeString(xyziChunk, 0, "XYZI");
      xyziView.setInt32(4, xyziContentSize, true);
      xyziView.setInt32(8, 0, true);
      xyziView.setInt32(12, voxels.length, true);
      xyziChunk[16] = 0; xyziChunk[17] = 0; xyziChunk[18] = 0; xyziChunk[19] = 1;
      chunks.push(xyziChunk);

      let childrenSize = 0;
      for (const chunk of chunks) childrenSize += chunk.length;

      const headerSize = 20;
      const totalSize = headerSize + childrenSize;
      const buffer = new ArrayBuffer(totalSize);
      const uint8 = new Uint8Array(buffer);
      const view = new DataView(buffer);

      writeString(uint8, 0, "VOX ");
      view.setInt32(4, 150, true);
      writeString(uint8, 8, "MAIN");
      view.setInt32(12, 0, true);
      view.setInt32(16, childrenSize, true);

      let offset = 20;
      for (const chunk of chunks) {
        uint8.set(chunk, offset);
        offset += chunk.length;
      }

      const result = parseMagicaVoxel(buffer);
      expect(result.voxels.length).toBe(1);
      expect(result.rows).toBe(3);
      expect(result.cols).toBe(3);
      expect(result.depth).toBe(3);
    });
  });

  // =========================================================================
  // Lines 115-119: Dimension validation errors
  // =========================================================================
  describe("dimension validation", () => {
    it("throws when no SIZE chunk and no voxels (all dims zero)", () => {
      const buffer = buildVoxBuffer({
        skipSize: true,
        skipXYZI: true
      });

      expect(() => parseMagicaVoxel(buffer)).toThrow("voxcss:");
    });

    it("uses observed dimensions when SIZE chunk is missing", () => {
      // No SIZE chunk but have XYZI data
      const buffer = buildVoxBuffer({
        skipSize: true,
        voxels: [
          { x: 0, y: 0, z: 0, colorIndex: 1 },
          { x: 2, y: 3, z: 1, colorIndex: 2 }
        ]
      });

      const result = parseMagicaVoxel(buffer);
      // observedMaxX = 3, observedMaxY = 4, observedMaxZ = 2
      expect(result.rows).toBe(3);
      expect(result.cols).toBe(4);
      expect(result.depth).toBe(2);
      expect(result.voxels.length).toBe(2);
    });
  });

  // =========================================================================
  // Voxels with colorIndex 0 are skipped
  // =========================================================================
  describe("colorIndex 0 filtering", () => {
    it("skips voxels with colorIndex 0", () => {
      const buffer = buildVoxBuffer({
        sizeX: 4,
        sizeY: 4,
        sizeZ: 4,
        voxels: [
          { x: 0, y: 0, z: 0, colorIndex: 0 },  // should be skipped
          { x: 1, y: 0, z: 0, colorIndex: 1 }    // should be kept
        ]
      });

      const result = parseMagicaVoxel(buffer);
      expect(result.voxels.length).toBe(1);
      expect(result.voxels[0].x).toBe(2); // 1-indexed: 1 + 1 = 2
    });
  });

  // =========================================================================
  // Voxels outside SIZE bounds are skipped
  // =========================================================================
  describe("out-of-bounds voxels", () => {
    it("skips voxels with coordinates outside SIZE bounds", () => {
      const buffer = buildVoxBuffer({
        sizeX: 2,
        sizeY: 2,
        sizeZ: 2,
        voxels: [
          { x: 0, y: 0, z: 0, colorIndex: 1 },  // in bounds
          { x: 5, y: 0, z: 0, colorIndex: 1 }    // out of bounds (x >= sizeX=2)
        ]
      });

      const result = parseMagicaVoxel(buffer);
      expect(result.voxels.length).toBe(1);
    });
  });

  // =========================================================================
  // Duplicate voxels at same position are deduplicated
  // =========================================================================
  describe("deduplication", () => {
    it("deduplicates voxels at the same position", () => {
      const buffer = buildVoxBuffer({
        sizeX: 4,
        sizeY: 4,
        sizeZ: 4,
        voxels: [
          { x: 0, y: 0, z: 0, colorIndex: 1 },
          { x: 0, y: 0, z: 0, colorIndex: 2 }  // duplicate position
        ]
      });

      const result = parseMagicaVoxel(buffer);
      // Only the first voxel at (0,0,0) should be kept
      expect(result.voxels.length).toBe(1);
    });
  });

  // =========================================================================
  // Custom RGBA palette
  // =========================================================================
  describe("custom palette", () => {
    it("uses RGBA palette when present", () => {
      const buffer = buildVoxBuffer({
        sizeX: 4,
        sizeY: 4,
        sizeZ: 4,
        voxels: [{ x: 0, y: 0, z: 0, colorIndex: 1 }],
        includeRGBA: true
      });

      const result = parseMagicaVoxel(buffer);
      expect(result.voxels.length).toBe(1);
      // Color should come from custom palette (index 0 in palette = colorIndex - 1 = 0)
      // r=0, g=255, b=128 -> #00ff80
      expect(result.voxels[0].color).toBe("#00ff80");
    });
  });

  // =========================================================================
  // Voxels sorted by z, x, y
  // =========================================================================
  describe("sorting", () => {
    it("output voxels are sorted by z, then x, then y", () => {
      const buffer = buildVoxBuffer({
        sizeX: 4,
        sizeY: 4,
        sizeZ: 4,
        voxels: [
          { x: 2, y: 1, z: 1, colorIndex: 1 },
          { x: 0, y: 0, z: 0, colorIndex: 1 },
          { x: 1, y: 2, z: 0, colorIndex: 1 },
          { x: 0, y: 1, z: 1, colorIndex: 1 }
        ]
      });

      const result = parseMagicaVoxel(buffer);
      expect(result.voxels.length).toBe(4);

      for (let i = 1; i < result.voxels.length; i++) {
        const prev = result.voxels[i - 1];
        const curr = result.voxels[i];
        const order = prev.z - curr.z || prev.x - curr.x || prev.y - curr.y;
        expect(order).toBeLessThanOrEqual(0);
      }
    });
  });

  // =========================================================================
  // SIZE chunk with zero dimensions
  // =========================================================================
  describe("SIZE chunk validation", () => {
    it("throws for SIZE chunk with zero dimensions", () => {
      const buffer = buildVoxBuffer({
        sizeX: 0,
        sizeY: 4,
        sizeZ: 4,
        voxels: []
      });

      expect(() => parseMagicaVoxel(buffer)).toThrow("voxcss:");
    });

    it("throws for SIZE chunk with negative dimensions", () => {
      // Can't easily encode negative in Uint8, but the builder uses Int32
      const chunks: Uint8Array[] = [];
      const sizeChunk = new Uint8Array(24);
      const sizeView = new DataView(sizeChunk.buffer);
      writeString(sizeChunk, 0, "SIZE");
      sizeView.setInt32(4, 12, true);
      sizeView.setInt32(8, 0, true);
      sizeView.setInt32(12, -1, true); // negative sizeX
      sizeView.setInt32(16, 4, true);
      sizeView.setInt32(20, 4, true);
      chunks.push(sizeChunk);

      let childrenSize = 0;
      for (const chunk of chunks) childrenSize += chunk.length;

      const totalSize = 20 + childrenSize;
      const buffer = new ArrayBuffer(totalSize);
      const uint8 = new Uint8Array(buffer);
      const view = new DataView(buffer);
      writeString(uint8, 0, "VOX ");
      view.setInt32(4, 150, true);
      writeString(uint8, 8, "MAIN");
      view.setInt32(12, 0, true);
      view.setInt32(16, childrenSize, true);
      let offset = 20;
      for (const chunk of chunks) {
        uint8.set(chunk, offset);
        offset += chunk.length;
      }

      expect(() => parseMagicaVoxel(buffer)).toThrow("voxcss:");
    });
  });
});
