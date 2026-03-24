import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { parseMagicaVoxel } from "./parseMagicaVoxel";

function loadVoxFile(name: string): ArrayBuffer {
  const filePath = resolve(__dirname, "../../../../examples/models", name);
  const buffer = readFileSync(filePath);
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

describe("parseMagicaVoxel", () => {
  describe("with real .vox file (tree.vox)", () => {
    it("parses without throwing", () => {
      const buffer = loadVoxFile("tree.vox");
      expect(() => parseMagicaVoxel(buffer)).not.toThrow();
    });

    it("returns positive dimensions", () => {
      const buffer = loadVoxFile("tree.vox");
      const result = parseMagicaVoxel(buffer);
      expect(result.rows).toBeGreaterThan(0);
      expect(result.cols).toBeGreaterThan(0);
      expect(result.depth).toBeGreaterThan(0);
    });

    it("returns a non-empty voxel array", () => {
      const buffer = loadVoxFile("tree.vox");
      const result = parseMagicaVoxel(buffer);
      expect(result.voxels.length).toBeGreaterThan(0);
    });

    it("all voxels have valid coordinates (x >= 1, y >= 1, z >= 0)", () => {
      const buffer = loadVoxFile("tree.vox");
      const result = parseMagicaVoxel(buffer);
      for (const voxel of result.voxels) {
        expect(voxel.x).toBeGreaterThanOrEqual(1);
        expect(voxel.y).toBeGreaterThanOrEqual(1);
        expect(voxel.z).toBeGreaterThanOrEqual(0);
      }
    });

    it("all voxels have hex color strings matching #[0-9a-f]{6}", () => {
      const buffer = loadVoxFile("tree.vox");
      const result = parseMagicaVoxel(buffer);
      for (const voxel of result.voxels) {
        expect(voxel.color).toMatch(/^#[0-9a-f]{6}$/);
      }
    });

    it("all voxels have shape set to 'cube'", () => {
      const buffer = loadVoxFile("tree.vox");
      const result = parseMagicaVoxel(buffer);
      for (const voxel of result.voxels) {
        expect(voxel.shape).toBe("cube");
      }
    });

    it("all voxels have x2 = x + 1 and y2 = y + 1", () => {
      const buffer = loadVoxFile("tree.vox");
      const result = parseMagicaVoxel(buffer);
      for (const voxel of result.voxels) {
        expect(voxel.x2).toBe(voxel.x + 1);
        expect(voxel.y2).toBe(voxel.y + 1);
      }
    });

    it("voxels are sorted by z, then x, then y", () => {
      const buffer = loadVoxFile("tree.vox");
      const result = parseMagicaVoxel(buffer);
      for (let i = 1; i < result.voxels.length; i++) {
        const prev = result.voxels[i - 1];
        const curr = result.voxels[i];
        const order = prev.z - curr.z || prev.x - curr.x || prev.y - curr.y;
        expect(order).toBeLessThanOrEqual(0);
      }
    });
  });

  describe("with Uint8Array input", () => {
    it("accepts Uint8Array wrapping the same buffer", () => {
      const buffer = loadVoxFile("tree.vox");
      const uint8 = new Uint8Array(buffer);
      const result = parseMagicaVoxel(uint8);
      expect(result.voxels.length).toBeGreaterThan(0);
    });
  });

  describe("with other .vox files", () => {
    it("parses house.vox", () => {
      const buffer = loadVoxFile("house.vox");
      const result = parseMagicaVoxel(buffer);
      expect(result.voxels.length).toBeGreaterThan(0);
      expect(result.rows).toBeGreaterThan(0);
      expect(result.cols).toBeGreaterThan(0);
      expect(result.depth).toBeGreaterThan(0);
    });
  });

  describe("invalid input", () => {
    it("throws for empty ArrayBuffer", () => {
      expect(() => parseMagicaVoxel(new ArrayBuffer(0))).toThrow();
    });

    it("throws with 'voxcss:' prefix for random bytes", () => {
      const garbage = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
      expect(() => parseMagicaVoxel(garbage)).toThrow(/^voxcss:/);
    });

    it("throws for buffer with wrong magic header", () => {
      const buf = new ArrayBuffer(32);
      const view = new DataView(buf);
      // Write wrong magic: "NOTV"
      view.setUint8(0, 0x4e);
      view.setUint8(1, 0x4f);
      view.setUint8(2, 0x54);
      view.setUint8(3, 0x56);
      expect(() => parseMagicaVoxel(buf)).toThrow(/voxcss:.*VOX/);
    });

    it("throws for VOX file with missing MAIN chunk", () => {
      const buf = new ArrayBuffer(32);
      const view = new DataView(buf);
      // Write "VOX " magic
      const magic = "VOX ";
      for (let i = 0; i < 4; i++) view.setUint8(i, magic.charCodeAt(i));
      // Version
      view.setInt32(4, 150, true);
      // Wrong chunk id: "BOGUS" instead of "MAIN"
      const chunk = "FAKE";
      for (let i = 0; i < 4; i++) view.setUint8(8, chunk.charCodeAt(i));
      expect(() => parseMagicaVoxel(buf)).toThrow(/voxcss:/);
    });
  });
});
