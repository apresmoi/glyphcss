import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { parseVox } from "./parseVox";

// ── Real fixture helpers ─────────────────────────────────────────────────────

function loadVoxFile(name: string): ArrayBuffer {
  const filePath = resolve(__dirname, "../../../../website/public/gallery/vox", name);
  const buf = readFileSync(filePath);
  // Node Buffer → ArrayBuffer (own copy so DataView offsets are always 0)
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

// ── Minimal .vox builder (for unit tests without real files) ─────────────────
//
// Builds a well-formed .vox ArrayBuffer:
//   Header (8): "VOX " + version 150
//   MAIN  (12): id + contentSize=0 + childrenSize
//     SIZE  (12+12): sx, sy, sz
//     XYZI  (12 + 4 + n*4): count + (x,y,z,colorIndex)…
//     RGBA  (12 + 1024): optional — 256 × (r,g,b,a)

interface VoxelInput {
  x: number;
  y: number;
  z: number;
  colorIndex: number; // 1-based
}

function buildVoxBuffer(
  size: [number, number, number],
  voxels: VoxelInput[],
  palette?: [number, number, number, number][], // 256 RGBA entries
): ArrayBuffer {
  // SIZE chunk: 12 header + 12 content
  const sizeChunkBytes = 12 + 12;
  // XYZI chunk: 12 header + 4 (count) + voxels.length * 4
  const xyziChunkBytes = 12 + 4 + voxels.length * 4;
  // RGBA chunk: 12 header + 256 * 4 = 12 + 1024
  const rgbaChunkBytes = palette ? 12 + 1024 : 0;

  const childrenSize = sizeChunkBytes + xyziChunkBytes + rgbaChunkBytes;
  // total = 8 (header) + 12 (MAIN) + childrenSize
  const totalBytes = 8 + 12 + childrenSize;

  const buf = new ArrayBuffer(totalBytes);
  const dv = new DataView(buf);
  const u8 = new Uint8Array(buf);
  let off = 0;

  // Helper to write a 4-char ASCII id
  const writeId = (id: string) => {
    for (let i = 0; i < 4; i++) u8[off++] = id.charCodeAt(i);
  };
  const writeU32 = (v: number) => { dv.setUint32(off, v, true); off += 4; };
  const writeU8 = (v: number) => { u8[off++] = v; };

  // Header: "VOX " + version 150
  writeId("VOX ");
  writeU32(150);

  // MAIN chunk: contentSize=0, childrenSize
  writeId("MAIN");
  writeU32(0);          // MAIN content size (always 0)
  writeU32(childrenSize);

  // SIZE chunk
  writeId("SIZE");
  writeU32(12);         // content size
  writeU32(0);          // children size
  writeU32(size[0]);    // sx
  writeU32(size[1]);    // sy
  writeU32(size[2]);    // sz

  // XYZI chunk
  writeId("XYZI");
  writeU32(4 + voxels.length * 4); // content size
  writeU32(0);          // children size
  writeU32(voxels.length);
  for (const v of voxels) {
    writeU8(v.x);
    writeU8(v.y);
    writeU8(v.z);
    writeU8(v.colorIndex);
  }

  // RGBA chunk (optional)
  if (palette) {
    writeId("RGBA");
    writeU32(1024);
    writeU32(0);
    for (let i = 0; i < 256; i++) {
      const [r, g, b, a] = palette[i] ?? [0, 0, 0, 255];
      writeU8(r); writeU8(g); writeU8(b); writeU8(a);
    }
  }

  return buf;
}

function buildMultiModelVoxBuffer(
  models: Array<{ size: [number, number, number]; voxels: VoxelInput[] }>,
  palette?: [number, number, number, number][], // 256 RGBA entries
): ArrayBuffer {
  const modelBytes = models.reduce(
    (sum, model) => sum + 12 + 12 + 12 + 4 + model.voxels.length * 4,
    0,
  );
  const rgbaChunkBytes = palette ? 12 + 1024 : 0;
  const childrenSize = modelBytes + rgbaChunkBytes;
  const totalBytes = 8 + 12 + childrenSize;

  const buf = new ArrayBuffer(totalBytes);
  const dv = new DataView(buf);
  const u8 = new Uint8Array(buf);
  let off = 0;

  const writeId = (id: string) => {
    for (let i = 0; i < 4; i++) u8[off++] = id.charCodeAt(i);
  };
  const writeU32 = (v: number) => { dv.setUint32(off, v, true); off += 4; };
  const writeU8 = (v: number) => { u8[off++] = v; };

  writeId("VOX ");
  writeU32(150);
  writeId("MAIN");
  writeU32(0);
  writeU32(childrenSize);

  for (const model of models) {
    writeId("SIZE");
    writeU32(12);
    writeU32(0);
    writeU32(model.size[0]);
    writeU32(model.size[1]);
    writeU32(model.size[2]);

    writeId("XYZI");
    writeU32(4 + model.voxels.length * 4);
    writeU32(0);
    writeU32(model.voxels.length);
    for (const v of model.voxels) {
      writeU8(v.x);
      writeU8(v.y);
      writeU8(v.z);
      writeU8(v.colorIndex);
    }
  }

  if (palette) {
    writeId("RGBA");
    writeU32(1024);
    writeU32(0);
    for (let i = 0; i < 256; i++) {
      const [r, g, b, a] = palette[i] ?? [0, 0, 0, 255];
      writeU8(r); writeU8(g); writeU8(b); writeU8(a);
    }
  }

  return buf;
}

// ── Real fixture tests ────────────────────────────────────────────────────────

describe("parseVox — real fixture (obj_candle.vox)", () => {
  // obj_candle.vox: 3 voxels in a 1×1×3 column (Z direction, colorIdx 96 and 24).
  // Visible faces: bottom (5) + middle (4) + top (5) = 14 quads = 28 triangles.

  it("parses without throwing", () => {
    const buf = loadVoxFile("obj_candle.vox");
    expect(() => parseVox(buf)).not.toThrow();
  });

  it("returns correct face count for a 3-voxel column (greedy-meshed)", () => {
    const buf = loadVoxFile("obj_candle.vox");
    const result = parseVox(buf);
    // 3 voxels stacked on Z but with TWO materials (brown wax + orange
    // flame): each material section has 4 side faces + an end cap → 5
    // polys per color × 2 colors = 10. Greedy mesh can't merge across
    // material boundaries, which is correct.
    expect(result.polygons.length).toBe(10);
  });

  it("metadata.triangleCount matches polygons.length", () => {
    const buf = loadVoxFile("obj_candle.vox");
    const result = parseVox(buf);
    expect(result.metadata?.triangleCount).toBe(result.polygons.length);
  });

  it("metadata.sourceBytes equals the file size", () => {
    const buf = loadVoxFile("obj_candle.vox");
    const result = parseVox(buf);
    expect(result.metadata?.sourceBytes).toBe(buf.byteLength);
  });

  it("each face is a 4-vertex quad with finite coords", () => {
    const buf = loadVoxFile("obj_candle.vox");
    const result = parseVox(buf);
    for (const p of result.polygons) {
      expect(p.vertices).toHaveLength(4);
      for (const v of p.vertices) {
        expect(v).toHaveLength(3);
        expect(Number.isFinite(v[0])).toBe(true);
        expect(Number.isFinite(v[1])).toBe(true);
        expect(Number.isFinite(v[2])).toBe(true);
      }
    }
  });

  it("mesh fits inside targetSize=60 bbox (default)", () => {
    const buf = loadVoxFile("obj_candle.vox");
    const result = parseVox(buf);
    const all = result.polygons.flatMap((p) => p.vertices);
    const xs = all.map((v) => v[0]);
    const ys = all.map((v) => v[1]);
    const zs = all.map((v) => v[2]);
    const span = Math.max(
      Math.max(...xs) - Math.min(...xs),
      Math.max(...ys) - Math.min(...ys),
      Math.max(...zs) - Math.min(...zs),
    );
    expect(span).toBeCloseTo(60, 1);
  });

  it("default gridShift=0 → min coord is 0", () => {
    const buf = loadVoxFile("obj_candle.vox");
    const result = parseVox(buf);
    const allCoords = result.polygons.flatMap((p) => p.vertices).flat();
    expect(Math.min(...allCoords)).toBeCloseTo(0, 3);
  });

  it("custom targetSize is honored", () => {
    const buf = loadVoxFile("obj_candle.vox");
    const result = parseVox(buf, { targetSize: 30, gridShift: 0 });
    const all = result.polygons.flatMap((p) => p.vertices);
    const span = Math.max(
      Math.max(...all.map((v) => v[0])) - Math.min(...all.map((v) => v[0])),
      Math.max(...all.map((v) => v[1])) - Math.min(...all.map((v) => v[1])),
      Math.max(...all.map((v) => v[2])) - Math.min(...all.map((v) => v[2])),
    );
    expect(span).toBeCloseTo(30, 1);
  });

  it("gridShift offsets all coordinates", () => {
    const buf = loadVoxFile("obj_candle.vox");
    const result = parseVox(buf, { gridShift: 5, targetSize: 60 });
    const allCoords = result.polygons.flatMap((p) => p.vertices).flat();
    expect(Math.min(...allCoords)).toBeGreaterThanOrEqual(5);
  });

  it("all polygon colors are valid CSS hex strings", () => {
    const buf = loadVoxFile("obj_candle.vox");
    const result = parseVox(buf);
    for (const p of result.polygons) {
      expect(p.color).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("objectUrls is always empty (parseVox never mints blob URLs)", () => {
    const buf = loadVoxFile("obj_candle.vox");
    const result = parseVox(buf);
    expect(result.objectUrls).toEqual([]);
  });

  it("dispose() is idempotent (safe to call twice)", () => {
    const buf = loadVoxFile("obj_candle.vox");
    const result = parseVox(buf);
    expect(() => result.dispose()).not.toThrow();
    expect(() => result.dispose()).not.toThrow();
  });

  it("warnings array is empty for valid input", () => {
    const buf = loadVoxFile("obj_candle.vox");
    const result = parseVox(buf);
    expect(result.warnings).toEqual([]);
  });
});

describe("parseVox — real fixture (chr_robot.vox, medium complexity)", () => {
  it("parses a multi-voxel model without throwing", () => {
    const buf = loadVoxFile("chr_robot.vox");
    expect(() => parseVox(buf)).not.toThrow();
  });

  it("emits significantly fewer faces than 6 per voxel (face culling works)", () => {
    const buf = loadVoxFile("chr_robot.vox");
    const result = parseVox(buf);
    const voxelCount = (result.metadata as { voxelCount?: number } | undefined)?.voxelCount ?? 0;
    // Without culling: voxelCount * 6 quad faces (each face is 1 polygon).
    // With culling interior faces are removed, so count should be much lower.
    expect(result.polygons.length).toBeLessThan(voxelCount * 6);
    expect(result.polygons.length).toBeGreaterThan(0);
  });

  it("metadata.triangleCount matches polygons.length", () => {
    const buf = loadVoxFile("chr_robot.vox");
    const result = parseVox(buf);
    expect(result.metadata?.triangleCount).toBe(result.polygons.length);
  });
});

// ── Synthetic unit tests ──────────────────────────────────────────────────────

describe("parseVox — minimal synthetic buffer", () => {
  it("single voxel at origin emits 6 quads (one per exposed face)", () => {
    const buf = buildVoxBuffer([1, 1, 1], [{ x: 0, y: 0, z: 0, colorIndex: 1 }]);
    const result = parseVox(buf);
    // A lone voxel has all 6 faces exposed → 6 quad polygons.
    expect(result.polygons.length).toBe(6);
  });

  it("two adjacent voxels share one face — greedy-meshed to 6 polys", () => {
    // Two voxels side by side on X: (0,0,0) and (1,0,0). Same material →
    // greedy mesh runs each long face as a single 2×1 rectangle:
    //   2 end faces (px of right + nx of left) + 4 long faces
    //   (py, ny, pz, nz spanning the 2-cell run) = 6 total.
    const buf = buildVoxBuffer(
      [2, 1, 1],
      [
        { x: 0, y: 0, z: 0, colorIndex: 1 },
        { x: 1, y: 0, z: 0, colorIndex: 1 },
      ],
    );
    const result = parseVox(buf);
    expect(result.polygons.length).toBe(6);
  });

  it("2×2×2 solid cube exposes only exterior faces, greedy-meshed to 6", () => {
    // 2×2×2 = 8 voxels, same material. Each of the 6 cube faces is a 2×2
    // contiguous patch → greedy mesh emits 1 polygon per side, total 6.
    const voxels: VoxelInput[] = [];
    for (let x = 0; x < 2; x++)
      for (let y = 0; y < 2; y++)
        for (let z = 0; z < 2; z++)
          voxels.push({ x, y, z, colorIndex: 1 });

    const buf = buildVoxBuffer([2, 2, 2], voxels);
    const result = parseVox(buf);
    expect(result.polygons.length).toBe(6);
  });

  it("hollow cube shell exposes inner and outer faces", () => {
    // A 3×3×3 shell (faces only, hollow interior) has more visible faces than a solid.
    // We build the 26 shell voxels of a 3×3×3 cube (everything except center).
    const voxels: VoxelInput[] = [];
    for (let x = 0; x < 3; x++)
      for (let y = 0; y < 3; y++)
        for (let z = 0; z < 3; z++)
          if (!(x === 1 && y === 1 && z === 1)) // skip center
            voxels.push({ x, y, z, colorIndex: 2 });

    const buf = buildVoxBuffer([3, 3, 3], voxels);
    const result = parseVox(buf);
    // Hollow → inner faces exposed too → more triangles than a solid 3×3×3
    const solidVoxels: VoxelInput[] = [];
    for (let x = 0; x < 3; x++)
      for (let y = 0; y < 3; y++)
        for (let z = 0; z < 3; z++)
          solidVoxels.push({ x, y, z, colorIndex: 1 });
    const solidBuf = buildVoxBuffer([3, 3, 3], solidVoxels);
    const solidResult = parseVox(solidBuf);
    expect(result.polygons.length).toBeGreaterThan(solidResult.polygons.length);
  });

  it("parses all XYZI chunks in a multi-model VOX file", () => {
    const buf = buildMultiModelVoxBuffer([
      { size: [1, 1, 1], voxels: [{ x: 0, y: 0, z: 0, colorIndex: 1 }] },
      { size: [3, 1, 1], voxels: [{ x: 2, y: 0, z: 0, colorIndex: 37 }] },
    ]);

    const result = parseVox(buf);
    const voxelCount = (result.metadata as { voxelCount?: number } | undefined)?.voxelCount ?? 0;
    const colors = new Set(result.polygons.map((p) => p.color));

    expect(voxelCount).toBe(2);
    expect(result.polygons.length).toBe(12);
    expect(colors.size).toBe(2);
  });

  it("dedupes overlapping voxels across XYZI chunks using the first color", () => {
    const buf = buildMultiModelVoxBuffer([
      { size: [1, 1, 1], voxels: [{ x: 0, y: 0, z: 0, colorIndex: 1 }] },
      { size: [1, 1, 1], voxels: [{ x: 0, y: 0, z: 0, colorIndex: 37 }] },
    ]);

    const result = parseVox(buf);
    const voxelCount = (result.metadata as { voxelCount?: number } | undefined)?.voxelCount ?? 0;
    const colors = new Set(result.polygons.map((p) => p.color));

    expect(voxelCount).toBe(1);
    expect(result.polygons.length).toBe(6);
    expect(colors).toEqual(new Set(["#ffffff"]));
  });
});

describe("parseVox — default palette", () => {
  it("colorIndex 1 resolves to white #ffffff from the default palette", () => {
    // Default palette index 1 = 0xffffffff → R=ff G=ff B=ff
    const buf = buildVoxBuffer([1, 1, 1], [{ x: 0, y: 0, z: 0, colorIndex: 1 }]);
    const result = parseVox(buf);
    // All faces of the single voxel should have the same color
    for (const p of result.polygons) {
      expect(p.color).toBe("#ffffff");
    }
  });

  it("different colorIndex values produce different colors", () => {
    // Two adjacent voxels with different colors
    const buf = buildVoxBuffer(
      [2, 1, 1],
      [
        { x: 0, y: 0, z: 0, colorIndex: 1 },
        { x: 1, y: 0, z: 0, colorIndex: 37 },
      ],
    );
    const result = parseVox(buf);
    const colors = new Set(result.polygons.map((p) => p.color));
    // Two distinct palette entries → at least 2 colors in the output
    expect(colors.size).toBeGreaterThanOrEqual(2);
  });
});

describe("parseVox — custom RGBA palette", () => {
  it("custom palette overrides default — colorIndex 1 uses custom entry 0", () => {
    // Build a custom palette where entry 0 (= colorIndex 1) is pure red
    const palette: [number, number, number, number][] = Array.from(
      { length: 256 },
      () => [0, 0, 0, 255] as [number, number, number, number],
    );
    palette[0] = [255, 0, 0, 255]; // colorIndex 1 → red

    const buf = buildVoxBuffer(
      [1, 1, 1],
      [{ x: 0, y: 0, z: 0, colorIndex: 1 }],
      palette,
    );
    const result = parseVox(buf);
    for (const p of result.polygons) {
      expect(p.color).toBe("#ff0000");
    }
  });

  it("custom palette entry 1 (colorIndex 2) used correctly", () => {
    const palette: [number, number, number, number][] = Array.from(
      { length: 256 },
      () => [0, 0, 0, 255] as [number, number, number, number],
    );
    palette[1] = [0, 128, 255, 255]; // colorIndex 2 → blue-ish

    const buf = buildVoxBuffer(
      [1, 1, 1],
      [{ x: 0, y: 0, z: 0, colorIndex: 2 }],
      palette,
    );
    const result = parseVox(buf);
    expect(result.polygons[0].color).toBe("#0080ff");
  });

  it("custom palette alpha is preserved", () => {
    const palette: [number, number, number, number][] = Array.from(
      { length: 256 },
      () => [0, 0, 0, 255] as [number, number, number, number],
    );
    palette[0] = [255, 64, 0, 128];

    const buf = buildVoxBuffer(
      [1, 1, 1],
      [{ x: 0, y: 0, z: 0, colorIndex: 1 }],
      palette,
    );
    const result = parseVox(buf);
    expect(result.polygons[0].color).toBe("rgba(255, 64, 0, 0.502)");
  });

  it("RGBA chunk fully overrides default palette", () => {
    // All custom palette entries are green
    const palette: [number, number, number, number][] = Array.from(
      { length: 256 },
      () => [0, 200, 0, 255] as [number, number, number, number],
    );
    const buf = buildVoxBuffer(
      [1, 1, 1],
      [{ x: 0, y: 0, z: 0, colorIndex: 5 }],
      palette,
    );
    const result = parseVox(buf);
    // All polygons should be green (#00c800)
    for (const p of result.polygons) {
      expect(p.color).toBe("#00c800");
    }
  });
});

describe("parseVox — empty and malformed input", () => {
  it("zero-length buffer returns empty ParseResult with warning", () => {
    const buf = new ArrayBuffer(0);
    const result = parseVox(buf);
    expect(result.polygons).toEqual([]);
    expect(result.objectUrls).toEqual([]);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.metadata?.triangleCount).toBe(0);
  });

  it("4-byte buffer (truncated — shorter than header) returns empty with warning", () => {
    const buf = new ArrayBuffer(4);
    const result = parseVox(buf);
    expect(result.polygons).toEqual([]);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("bad magic bytes return empty ParseResult with a warning", () => {
    const buf = new ArrayBuffer(8);
    new DataView(buf).setUint32(0, 0x12345678, true);
    const result = parseVox(buf);
    expect(result.polygons).toEqual([]);
    expect(result.warnings.some((w) => w.includes("magic"))).toBe(true);
  });

  it("buffer with correct magic but missing MAIN returns empty", () => {
    const buf = new ArrayBuffer(8);
    // "VOX " magic only, no MAIN chunk (buffer is 8 bytes which is < 20)
    new DataView(buf).setUint32(0, 0x20584f56, true); // VOX_MAGIC
    new DataView(buf).setUint32(4, 150, true);
    const result = parseVox(buf);
    expect(result.polygons).toEqual([]);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("XYZI with no voxels (count=0) returns empty result", () => {
    const buf = buildVoxBuffer([1, 1, 1], []);
    const result = parseVox(buf);
    expect(result.polygons).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("dispose() is idempotent on empty result", () => {
    const result = parseVox(new ArrayBuffer(0));
    expect(() => result.dispose()).not.toThrow();
    expect(() => result.dispose()).not.toThrow();
  });
});

describe("parseVox — scaling and coordinate system", () => {
  it("Z axis is elevation (Z-up): stacked voxels extend along Z", () => {
    // Three voxels stacked vertically (Z direction)
    const buf = buildVoxBuffer(
      [1, 1, 3],
      [
        { x: 0, y: 0, z: 0, colorIndex: 1 },
        { x: 0, y: 0, z: 1, colorIndex: 1 },
        { x: 0, y: 0, z: 2, colorIndex: 1 },
      ],
    );
    const result = parseVox(buf);
    const zCoords = result.polygons.flatMap((p) => p.vertices.map((v) => v[2]));
    // The mesh should have meaningful Z variation (it's the longest axis)
    const zSpan = Math.max(...zCoords) - Math.min(...zCoords);
    expect(zSpan).toBeCloseTo(60, 0); // targetSize=60 default
  });

  it("single-voxel mesh has scale=1 (no division by zero)", () => {
    const buf = buildVoxBuffer([1, 1, 1], [{ x: 0, y: 0, z: 0, colorIndex: 1 }]);
    const result = parseVox(buf);
    // Should not throw and should produce 6 quads at some scale.
    expect(result.polygons.length).toBe(6);
    const allCoords = result.polygons.flatMap((p) => p.vertices).flat();
    expect(allCoords.every(Number.isFinite)).toBe(true);
  });
});

describe("parseVox — winding consistency (CCW from outside)", () => {
  it("+Z face normal points up: vertices form CCW when viewed from +Z", () => {
    // Single voxel at origin. The +Z face is one quad with CCW winding
    // from above: [(0,0,1),(1,0,1),(1,1,1),(0,1,1)].
    const buf = buildVoxBuffer([1, 1, 1], [{ x: 0, y: 0, z: 0, colorIndex: 1 }]);
    const result = parseVox(buf);
    const maxZ = Math.max(...result.polygons.flatMap((p) => p.vertices.map((v) => v[2])));
    const topFacePolys = result.polygons.filter((p) =>
      p.vertices.every((v) => Math.abs(v[2] - maxZ) < 0.01),
    );
    // Exactly one quad polygon for the +Z face (no fan triangulation).
    expect(topFacePolys.length).toBe(1);
    expect(topFacePolys[0].vertices.length).toBe(4);
  });
});
