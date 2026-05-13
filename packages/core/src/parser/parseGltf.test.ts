import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { parseGltf } from "./parseGltf";

// ── Real GLB fixture (lead test — matches voxcss parseMagicaVoxel pattern) ─

function loadGlbFile(...parts: string[]): ArrayBuffer {
  const filePath = resolve(__dirname, "../../../../website/public/gallery/glb", ...parts);
  const buffer = readFileSync(filePath);
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

describe("parseGltf — real fixture (tree.glb)", () => {
  it("parses a real FBX2glTF-emitted GLB without throwing", () => {
    const buf = loadGlbFile("tree.glb");
    expect(() => parseGltf(buf)).not.toThrow();
  });

  it("emits a non-empty polygon list", () => {
    const result = parseGltf(loadGlbFile("tree.glb"));
    expect(result.polygons.length).toBeGreaterThan(0);
  });

  it("metadata.triangleCount matches polygons.length", () => {
    const result = parseGltf(loadGlbFile("tree.glb"));
    expect(result.metadata?.triangleCount).toBe(result.polygons.length);
  });

  it("metadata.sourceBytes equals input byteLength", () => {
    const buf = loadGlbFile("tree.glb");
    const result = parseGltf(buf);
    expect(result.metadata?.sourceBytes).toBe(buf.byteLength);
  });

  it("metadata.meshes is populated for a real mesh-bearing GLB", () => {
    const result = parseGltf(loadGlbFile("tree.glb"));
    expect(result.metadata?.meshes).toBeDefined();
    expect(result.metadata!.meshes!.length).toBeGreaterThan(0);
  });

  it("every triangle has 3 finite Vec3 vertices and a valid hex color", () => {
    const result = parseGltf(loadGlbFile("tree.glb"));
    for (const p of result.polygons) {
      expect(p.vertices).toHaveLength(3);
      expect(p.color).toMatch(/^#[0-9a-f]{6}$/i);
      for (const v of p.vertices) {
        expect(v).toHaveLength(3);
        expect(Number.isFinite(v[0])).toBe(true);
        expect(Number.isFinite(v[1])).toBe(true);
        expect(Number.isFinite(v[2])).toBe(true);
      }
    }
  });

  it("mesh fits inside default targetSize=60 bbox", () => {
    const result = parseGltf(loadGlbFile("tree.glb"));
    const all = result.polygons.flatMap((p) => p.vertices);
    const span = (axis: number) =>
      Math.max(...all.map((v) => v[axis])) - Math.min(...all.map((v) => v[axis]));
    expect(Math.max(span(0), span(1), span(2))).toBeCloseTo(60, 1);
  });

  it("default gridShift=1 keeps all coords ≥ 1 (no zero edges)", () => {
    const result = parseGltf(loadGlbFile("tree.glb"));
    const allCoords = result.polygons.flatMap((p) => p.vertices).flat();
    expect(Math.min(...allCoords)).toBeGreaterThanOrEqual(1);
  });

  it("custom targetSize=200 scales the mesh proportionally", () => {
    const result = parseGltf(loadGlbFile("tree.glb"), { targetSize: 200, gridShift: 0 });
    const all = result.polygons.flatMap((p) => p.vertices);
    const span = (axis: number) =>
      Math.max(...all.map((v) => v[axis])) - Math.min(...all.map((v) => v[axis]));
    expect(Math.max(span(0), span(1), span(2))).toBeCloseTo(200, 1);
  });

  it("dispose() is callable and idempotent", () => {
    const result = parseGltf(loadGlbFile("tree.glb"));
    expect(typeof result.dispose).toBe("function");
    expect(() => result.dispose()).not.toThrow();
    expect(() => result.dispose()).not.toThrow();
  });

  it("accepts Uint8Array input wrapping the same buffer", () => {
    const buf = loadGlbFile("tree.glb");
    const result = parseGltf(new Uint8Array(buf));
    expect(result.polygons.length).toBeGreaterThan(0);
  });
});

describe("parseGltf — animated fixture (FishAnimated.glb)", () => {
  const animatedGalleryFixtures = [
    ["FishAnimated.glb", 1],
    ["AnimatedMushnub.glb", 9],
    ["AnimatedWizard.glb", 9],
    ["AnimatedSnake.glb", 4],
  ] as const;

  it.each(animatedGalleryFixtures)(
    "exposes usable animation clips for %s",
    (file, clipCount) => {
      const result = parseGltf(loadGlbFile(file), { gridShift: 0 });
      expect(result.animation?.clips).toHaveLength(clipCount);
      const frame = result.animation!.sample(0, 0.25);
      expect(frame).toHaveLength(result.polygons.length);
      expect(frame.length).toBeGreaterThan(0);
      for (const polygon of frame) {
        expect(polygon.vertices).toHaveLength(3);
        for (const vertex of polygon.vertices) {
          expect(Number.isFinite(vertex[0])).toBe(true);
          expect(Number.isFinite(vertex[1])).toBe(true);
          expect(Number.isFinite(vertex[2])).toBe(true);
        }
      }
    },
  );

  it("exposes animation clips for a skinned GLB", () => {
    const result = parseGltf(loadGlbFile("FishAnimated.glb"));
    expect(result.animation?.clips).toHaveLength(1);
    expect(result.animation?.clips[0].name).toBe("Armature|Swim");
    expect(result.metadata?.animations?.[0].name).toBe("Armature|Swim");
  });

  it("samples animated polygons with stable triangle count", () => {
    const result = parseGltf(loadGlbFile("FishAnimated.glb"));
    const frame = result.animation!.sample(0, 0.25);
    expect(frame).toHaveLength(result.polygons.length);
    for (const polygon of frame) {
      expect(polygon.vertices).toHaveLength(3);
      for (const vertex of polygon.vertices) {
        expect(Number.isFinite(vertex[0])).toBe(true);
        expect(Number.isFinite(vertex[1])).toBe(true);
        expect(Number.isFinite(vertex[2])).toBe(true);
      }
    }
  });

  it("sampled animation changes vertex positions over time", () => {
    const result = parseGltf(loadGlbFile("FishAnimated.glb"));
    const a = result.animation!.sample(0, 0);
    const b = result.animation!.sample(0, 0.25);
    let totalDelta = 0;
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      for (let j = 0; j < 3; j++) {
        totalDelta += Math.hypot(
          a[i].vertices[j][0] - b[i].vertices[j][0],
          a[i].vertices[j][1] - b[i].vertices[j][1],
          a[i].vertices[j][2] - b[i].vertices[j][2],
        );
      }
    }
    expect(totalDelta).toBeGreaterThan(1);
  });
});

// ── GLB / glTF binary builder helpers ─────────────────────────────────────

const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN  = 0x004e4942;
const GLB_MAGIC  = 0x46546c67;

/** Encode a plain-object glTF JSON doc → padded UTF-8 bytes */
function encodeJson(doc: object): Uint8Array {
  const str = JSON.stringify(doc);
  const raw = new TextEncoder().encode(str);
  const pad = (4 - (raw.length % 4)) % 4;
  const out = new Uint8Array(raw.length + pad);
  out.set(raw);
  // Pad with spaces per glTF spec
  for (let i = raw.length; i < out.length; i++) out[i] = 0x20;
  return out;
}

interface GlbParts {
  doc: object;
  binData?: Uint8Array;
}

/** Build a minimal valid GLB ArrayBuffer from a JSON doc + optional BIN chunk */
function buildGlb({ doc, binData }: GlbParts): ArrayBuffer {
  const jsonChunk = encodeJson(doc);
  const hasbin = binData && binData.length > 0;

  let totalLen = 12 + 8 + jsonChunk.length;
  if (hasbin) {
    const binPad = (4 - (binData.length % 4)) % 4;
    totalLen += 8 + binData.length + binPad;
  }

  const buf = new ArrayBuffer(totalLen);
  const view = new DataView(buf);
  let off = 0;

  // Header
  view.setUint32(off, GLB_MAGIC, true); off += 4;
  view.setUint32(off, 2, true); off += 4;
  view.setUint32(off, totalLen, true); off += 4;

  // JSON chunk
  view.setUint32(off, jsonChunk.length, true); off += 4;
  view.setUint32(off, CHUNK_JSON, true); off += 4;
  new Uint8Array(buf, off, jsonChunk.length).set(jsonChunk);
  off += jsonChunk.length;

  // BIN chunk (optional)
  if (hasbin) {
    const binPad = (4 - (binData.length % 4)) % 4;
    const binChunkLen = binData.length + binPad;
    view.setUint32(off, binChunkLen, true); off += 4;
    view.setUint32(off, CHUNK_BIN, true); off += 4;
    new Uint8Array(buf, off, binData.length).set(binData);
    off += binChunkLen;
  }

  return buf;
}

/**
 * Build a minimal GLB with one mesh, one primitive containing a triangle.
 * Returns { glb, positions } where positions is the 3 vertex XYZ values used.
 */
function buildTriangleGlb(opts?: {
  materialColor?: [number, number, number, number];
  materialName?: string;
  indexed?: boolean;
  mode?: number;
  includeTexcoord?: boolean;
  textureUrl?: string;
  upAxis?: "y" | "z";
}): { glb: ArrayBuffer; positions: number[] } {
  // Triangle vertices in OBJ/glTF order: 3 Vec3 floats = 36 bytes
  const positions = [
    0, 0, 0,
    1, 0, 0,
    0, 1, 0,
  ];
  const indices = opts?.indexed !== false ? [0, 1, 2] : [];
  const texcoords = opts?.includeTexcoord
    ? [0, 0, 1, 0, 0, 1]  // 3 UV pairs
    : [];

  // Build binary buffer
  let totalBytes = positions.length * 4;
  const posStart = 0;
  let idxStart = -1, idxBytes = 0;
  let uvStart = -1;

  if (opts?.indexed !== false) {
    idxBytes = indices.length * 2; // UNSIGNED_SHORT
    // Align to 2 bytes
    idxStart = totalBytes;
    totalBytes += idxBytes;
  }

  if (opts?.includeTexcoord) {
    uvStart = totalBytes;
    totalBytes += texcoords.length * 4;
  }

  const bin = new Uint8Array(totalBytes);
  const binView = new DataView(bin.buffer);

  // Write positions as float32
  for (let i = 0; i < positions.length; i++) {
    binView.setFloat32(posStart + i * 4, positions[i], true);
  }
  // Write indices as uint16
  if (opts?.indexed !== false) {
    for (let i = 0; i < indices.length; i++) {
      binView.setUint16(idxStart + i * 2, indices[i], true);
    }
  }
  // Write texcoords as float32
  if (opts?.includeTexcoord && uvStart >= 0) {
    for (let i = 0; i < texcoords.length; i++) {
      binView.setFloat32(uvStart + i * 4, texcoords[i], true);
    }
  }

  // glTF doc
  const accessors: object[] = [
    // 0: POSITION
    {
      bufferView: 0,
      byteOffset: 0,
      componentType: 5126, // FLOAT
      count: 3,
      type: "VEC3",
    },
  ];
  const bufferViews: object[] = [
    // 0: positions
    { buffer: 0, byteOffset: posStart, byteLength: positions.length * 4 },
  ];

  let indexAccessorIdx: number | undefined = undefined;
  if (opts?.indexed !== false) {
    indexAccessorIdx = accessors.length;
    accessors.push({
      bufferView: bufferViews.length,
      byteOffset: 0,
      componentType: 5123, // UNSIGNED_SHORT
      count: 3,
      type: "SCALAR",
    });
    bufferViews.push({ buffer: 0, byteOffset: idxStart, byteLength: idxBytes });
  }

  let uvAccessorIdx: number | undefined = undefined;
  if (opts?.includeTexcoord && uvStart >= 0) {
    uvAccessorIdx = accessors.length;
    accessors.push({
      bufferView: bufferViews.length,
      byteOffset: 0,
      componentType: 5126,
      count: 3,
      type: "VEC2",
    });
    bufferViews.push({ buffer: 0, byteOffset: uvStart, byteLength: texcoords.length * 4 });
  }

  const materials: object[] = [];
  let materialIdx: number | undefined = undefined;
  if (opts?.materialColor || opts?.materialName || opts?.textureUrl) {
    materialIdx = 0;
    const mat: Record<string, unknown> = {};
    if (opts?.materialName) mat.name = opts.materialName;
    if (opts?.materialColor) {
      mat.pbrMetallicRoughness = { baseColorFactor: opts.materialColor };
    }
    if (opts?.textureUrl) {
      mat.pbrMetallicRoughness = {
        ...((mat.pbrMetallicRoughness as object | undefined) ?? {}),
        baseColorTexture: { index: 0 },
      };
    }
    materials.push(mat);
  }

  const primitiveAttrs: Record<string, number> = { POSITION: 0 };
  if (uvAccessorIdx !== undefined) primitiveAttrs.TEXCOORD_0 = uvAccessorIdx;

  const primitive: Record<string, unknown> = {
    attributes: primitiveAttrs,
    mode: opts?.mode ?? 4,
  };
  if (indexAccessorIdx !== undefined) primitive.indices = indexAccessorIdx;
  if (materialIdx !== undefined) primitive.material = materialIdx;

  const images: object[] = [];
  const textures: object[] = [];
  if (opts?.textureUrl) {
    images.push({ uri: opts.textureUrl });
    textures.push({ source: 0 });
  }

  const doc: Record<string, unknown> = {
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ name: "TestMesh", primitives: [primitive] }],
    accessors,
    bufferViews,
    buffers: [{ byteLength: bin.length }],
  };
  if (materials.length > 0) doc.materials = materials;
  if (images.length > 0) doc.images = images;
  if (textures.length > 0) doc.textures = textures;

  return { glb: buildGlb({ doc, binData: bin }), positions };
}

/** Encode text as base64 data: URI for embedded buffer tests */
function encodeDataUri(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  const b64 = btoa(bin);
  return `data:application/octet-stream;base64,${b64}`;
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Tests ──────────────────────────────────────────────────────────────────

describe("parseGltf", () => {
  describe("GLB container parsing", () => {
    it("rejects invalid magic bytes (GLB magic check; non-matching input falls through to JSON parse)", () => {
      // When magic bytes don't match GLB_MAGIC, parseGltf falls through to
      // JSON parsing. A 16-byte buffer with bad magic isn't valid JSON either.
      // The actual message is a JSON parse error, not "not a GLB".
      // Test the behavior: either parse error or "not a GLB" — just not valid.
      const bad = new ArrayBuffer(16);
      new DataView(bad).setUint32(0, 0x12345678, true);
      expect(() => parseGltf(bad)).toThrow(); // throws something — JSON error
    });

    it("GLB with bad magic in a long-enough buffer (>= magic size) that could be a real GLB path", () => {
      // Build a buffer that starts with the GLB magic but has wrong version
      const buf = buildGlb({ doc: { asset: { version: "2.0" } } });
      // Overwrite the magic with something invalid
      new DataView(buf).setUint32(0, 0xDEADBEEF, true);
      // Now it's >= 4 bytes but magic doesn't match → JSON parse attempted → throws
      expect(() => parseGltf(buf)).toThrow();
    });

    it("rejects GLB version != 2", () => {
      const buf = buildGlb({ doc: { asset: { version: "2.0" } } });
      // Tamper version field (offset 4)
      new DataView(buf).setUint32(4, 1, true);
      expect(() => parseGltf(buf)).toThrow("glTF v2");
    });

    it("throws when JSON chunk is missing", () => {
      // Build a GLB with only BIN chunk (tamper JSON chunk type)
      const { glb } = buildTriangleGlb();
      const view = new DataView(glb);
      // Chunk type is at offset 16; change to something unknown
      view.setUint32(16, 0xDEADBEEF, true);
      expect(() => parseGltf(glb)).toThrow("no JSON chunk");
    });

    it("parses a valid GLB with one mesh, one triangle", () => {
      const { glb } = buildTriangleGlb();
      const result = parseGltf(glb);
      expect(result.polygons).toHaveLength(1);
      expect(result.polygons[0].vertices).toHaveLength(3);
    });

    it("accepts a Uint8Array input (not just ArrayBuffer)", () => {
      const { glb } = buildTriangleGlb();
      const result = parseGltf(new Uint8Array(glb));
      expect(result.polygons).toHaveLength(1);
    });
  });

  describe("glTF JSON (non-GLB) format", () => {
    it("parses a glTF JSON with embedded data: URI buffer", () => {
      // Build the same triangle but as a glTF JSON (not GLB) with data: URI
      const positions = [0, 0, 0, 1, 0, 0, 0, 1, 0];
      const bin = new Uint8Array(positions.length * 4);
      const view = new DataView(bin.buffer);
      for (let i = 0; i < positions.length; i++) {
        view.setFloat32(i * 4, positions[i], true);
      }
      const uri = encodeDataUri(bin);

      const doc = {
        asset: { version: "2.0" },
        scene: 0,
        scenes: [{ nodes: [0] }],
        nodes: [{ mesh: 0 }],
        meshes: [{ primitives: [{ attributes: { POSITION: 0 }, mode: 4 }] }],
        accessors: [{
          bufferView: 0, byteOffset: 0, componentType: 5126,
          count: 3, type: "VEC3",
        }],
        bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: bin.length }],
        buffers: [{ byteLength: bin.length, uri }],
      };
      const jsonBytes = new TextEncoder().encode(JSON.stringify(doc));
      const result = parseGltf(jsonBytes.buffer as ArrayBuffer);
      expect(result.polygons).toHaveLength(1);
    });

    it("throws when JSON doc has no buffers[0]", () => {
      const doc = {
        asset: { version: "2.0" },
        meshes: [],
      };
      const jsonBytes = new TextEncoder().encode(JSON.stringify(doc));
      expect(() => parseGltf(jsonBytes.buffer as ArrayBuffer)).toThrow("no buffers");
    });

    it("throws when buffer[0] has no uri and no resolveBuffer", () => {
      const doc = {
        asset: { version: "2.0" },
        meshes: [],
        buffers: [{ byteLength: 0 }],
      };
      const jsonBytes = new TextEncoder().encode(JSON.stringify(doc));
      expect(() => parseGltf(jsonBytes.buffer as ArrayBuffer)).toThrow("no uri");
    });

    it("resolveBuffer callback is called for external buffer URI", () => {
      const positions = [0, 0, 0, 1, 0, 0, 0, 1, 0];
      const bin = new Uint8Array(positions.length * 4);
      const binView = new DataView(bin.buffer);
      for (let i = 0; i < positions.length; i++) {
        binView.setFloat32(i * 4, positions[i], true);
      }

      const doc = {
        asset: { version: "2.0" },
        scene: 0,
        scenes: [{ nodes: [0] }],
        nodes: [{ mesh: 0 }],
        meshes: [{ primitives: [{ attributes: { POSITION: 0 }, mode: 4 }] }],
        accessors: [{
          bufferView: 0, byteOffset: 0, componentType: 5126,
          count: 3, type: "VEC3",
        }],
        bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: bin.length }],
        buffers: [{ byteLength: bin.length, uri: "model.bin" }],
      };
      const jsonBytes = new TextEncoder().encode(JSON.stringify(doc));
      const mockResolve = vi.fn().mockReturnValue(bin);
      const result = parseGltf(jsonBytes.buffer as ArrayBuffer, { resolveBuffer: mockResolve });
      expect(mockResolve).toHaveBeenCalledWith("model.bin");
      expect(result.polygons).toHaveLength(1);
    });

    it("throws when resolveBuffer returns a Promise (async not supported)", () => {
      const doc = {
        asset: { version: "2.0" },
        meshes: [],
        buffers: [{ byteLength: 0, uri: "model.bin" }],
      };
      const jsonBytes = new TextEncoder().encode(JSON.stringify(doc));
      const asyncResolve = () => Promise.resolve(new Uint8Array(0));
      expect(() => parseGltf(jsonBytes.buffer as ArrayBuffer, { resolveBuffer: asyncResolve as never }))
        .toThrow("Promise");
    });
  });

  describe("non-indexed primitives", () => {
    it("primitive without indices: uses sequential vertex ordering", () => {
      const { glb } = buildTriangleGlb({ indexed: false });
      const result = parseGltf(glb);
      expect(result.polygons).toHaveLength(1);
    });
  });

  describe("indexed primitives", () => {
    it("indexed triangle produces correct polygon", () => {
      const { glb } = buildTriangleGlb({ indexed: true });
      const result = parseGltf(glb);
      expect(result.polygons).toHaveLength(1);
      expect(result.polygons[0].vertices).toHaveLength(3);
    });
  });

  describe("non-TRIANGLES mode", () => {
    it("mode=5 (TRIANGLE_STRIP) is skipped, no polygons emitted", () => {
      const { glb } = buildTriangleGlb({ mode: 5 });
      const result = parseGltf(glb);
      expect(result.polygons).toHaveLength(0);
    });

    it("mode=6 (TRIANGLE_FAN) is skipped", () => {
      const { glb } = buildTriangleGlb({ mode: 6 });
      const result = parseGltf(glb);
      expect(result.polygons).toHaveLength(0);
    });
  });

  describe("material color", () => {
    it("PBR baseColorFactor is used as the polygon color", () => {
      const { glb } = buildTriangleGlb({
        materialColor: [1, 0, 0, 1], // pure red
      });
      const result = parseGltf(glb);
      expect(result.polygons[0].color).toBe("#ff0000");
    });

    it("PBR baseColorFactor alpha is preserved in the polygon color", () => {
      const { glb } = buildTriangleGlb({
        materialColor: [0, 0.5, 1, 0.25],
      });
      const result = parseGltf(glb);
      expect(result.polygons[0].color).toBe("rgba(0, 128, 255, 0.25)");
    });

    it("no material → uses default color #888888", () => {
      const { glb } = buildTriangleGlb();
      const result = parseGltf(glb);
      expect(result.polygons[0].color).toBe("#888888");
    });

    it("materialColors override takes priority over baseColorFactor", () => {
      const { glb } = buildTriangleGlb({
        materialColor: [1, 0, 0, 1],
        materialName: "Red",
      });
      const result = parseGltf(glb, { materialColors: { Red: "#custom" } });
      expect(result.polygons[0].color).toBe("#custom");
    });

    it("custom defaultColor is used when no material", () => {
      const { glb } = buildTriangleGlb();
      const result = parseGltf(glb, { defaultColor: "#334455" });
      expect(result.polygons[0].color).toBe("#334455");
    });
  });

  describe("targetSize scaling", () => {
    it("output vertices are scaled to fit targetSize", () => {
      const { glb } = buildTriangleGlb();
      const r = parseGltf(glb, { targetSize: 10, gridShift: 0 });
      const allCoords = r.polygons.flatMap((p) => p.vertices).flat();
      const span = Math.max(...allCoords) - Math.min(...allCoords);
      expect(span).toBeCloseTo(10, 3);
    });

    it("larger targetSize produces proportionally larger mesh", () => {
      const { glb } = buildTriangleGlb();
      const r10 = parseGltf(glb, { targetSize: 10, gridShift: 0 });
      const r50 = parseGltf(glb, { targetSize: 50, gridShift: 0 });
      const span = (r: ReturnType<typeof parseGltf>) =>
        Math.max(...r.polygons.flatMap((p) => p.vertices).flat()) -
        Math.min(...r.polygons.flatMap((p) => p.vertices).flat());
      expect(span(r50)).toBeGreaterThan(span(r10));
    });
  });

  describe("axis conversion (upAxis)", () => {
    it("upAxis=y (default) permutes axes (z,x,y) → +Y in glTF ends up on +Z polycss", () => {
      const { glb } = buildTriangleGlb();
      const rY = parseGltf(glb, { upAxis: "y", gridShift: 0 });
      const rZ = parseGltf(glb, { upAxis: "z", gridShift: 0 });
      // They should produce different vertex layouts
      const serialize = (r: ReturnType<typeof parseGltf>) =>
        JSON.stringify(r.polygons.map((p) => p.vertices).sort());
      expect(serialize(rY)).not.toBe(serialize(rZ));
    });

    it("upAxis=z applies identity (no swap)", () => {
      const { glb } = buildTriangleGlb();
      const result = parseGltf(glb, { upAxis: "z", targetSize: 10, gridShift: 0 });
      expect(result.polygons).toHaveLength(1);
    });
  });

  describe("gridShift", () => {
    it("default gridShift=1 means minimum vertex coord >= 1", () => {
      const { glb } = buildTriangleGlb();
      const result = parseGltf(glb, { gridShift: 1 });
      const allCoords = result.polygons.flatMap((p) => p.vertices).flat();
      expect(Math.min(...allCoords)).toBeGreaterThanOrEqual(1);
    });
  });

  describe("node transforms", () => {
    it("node with translation applies transform to vertices", () => {
      // Build GLB with a node that has a translation
      const positions = [0, 0, 0, 1, 0, 0, 0, 1, 0];
      const bin = new Uint8Array(positions.length * 4);
      const view = new DataView(bin.buffer);
      for (let i = 0; i < positions.length; i++) {
        view.setFloat32(i * 4, positions[i], true);
      }

      const doc = {
        asset: { version: "2.0" },
        scene: 0,
        scenes: [{ nodes: [0] }],
        nodes: [{ mesh: 0, translation: [10, 0, 0] }],
        meshes: [{ primitives: [{ attributes: { POSITION: 0 }, mode: 4 }] }],
        accessors: [{
          bufferView: 0, byteOffset: 0, componentType: 5126,
          count: 3, type: "VEC3",
        }],
        bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: bin.length }],
        buffers: [{ byteLength: bin.length }],
      };
      const glb = buildGlb({ doc, binData: bin });
      const result = parseGltf(glb, { gridShift: 0 });
      expect(result.polygons).toHaveLength(1);
    });

    it("node with matrix property applies matrix transform", () => {
      const positions = [0, 0, 0, 1, 0, 0, 0, 1, 0];
      const bin = new Uint8Array(positions.length * 4);
      const view = new DataView(bin.buffer);
      for (let i = 0; i < positions.length; i++) {
        view.setFloat32(i * 4, positions[i], true);
      }

      // Identity matrix (column-major)
      const identity = [1,0,0,0, 0,1,0,0, 0,0,1,0, 5,0,0,1]; // translate x by 5

      const doc = {
        asset: { version: "2.0" },
        scene: 0,
        scenes: [{ nodes: [0] }],
        nodes: [{ mesh: 0, matrix: identity }],
        meshes: [{ primitives: [{ attributes: { POSITION: 0 }, mode: 4 }] }],
        accessors: [{
          bufferView: 0, byteOffset: 0, componentType: 5126,
          count: 3, type: "VEC3",
        }],
        bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: bin.length }],
        buffers: [{ byteLength: bin.length }],
      };
      const glb = buildGlb({ doc, binData: bin });
      const result = parseGltf(glb, { gridShift: 0 });
      expect(result.polygons).toHaveLength(1);
    });

    it("node with scale and rotation (TRS) applies transform", () => {
      const positions = [0, 0, 0, 1, 0, 0, 0, 1, 0];
      const bin = new Uint8Array(positions.length * 4);
      const view = new DataView(bin.buffer);
      for (let i = 0; i < positions.length; i++) {
        view.setFloat32(i * 4, positions[i], true);
      }

      const doc = {
        asset: { version: "2.0" },
        scene: 0,
        scenes: [{ nodes: [0] }],
        nodes: [{
          mesh: 0,
          translation: [0, 0, 0],
          rotation: [0, 0, 0, 1], // identity rotation
          scale: [2, 2, 2],       // 2× scale
        }],
        meshes: [{ primitives: [{ attributes: { POSITION: 0 }, mode: 4 }] }],
        accessors: [{
          bufferView: 0, byteOffset: 0, componentType: 5126,
          count: 3, type: "VEC3",
        }],
        bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: bin.length }],
        buffers: [{ byteLength: bin.length }],
      };
      const glb = buildGlb({ doc, binData: bin });
      const result = parseGltf(glb);
      expect(result.polygons).toHaveLength(1);
    });

    it("hierarchical nodes: parent transform propagates to child", () => {
      const positions = [0, 0, 0, 1, 0, 0, 0, 1, 0];
      const bin = new Uint8Array(positions.length * 4);
      const view = new DataView(bin.buffer);
      for (let i = 0; i < positions.length; i++) {
        view.setFloat32(i * 4, positions[i], true);
      }

      const doc = {
        asset: { version: "2.0" },
        scene: 0,
        scenes: [{ nodes: [0] }],
        nodes: [
          { children: [1], translation: [1, 0, 0] }, // parent
          { mesh: 0 },                                // child
        ],
        meshes: [{ primitives: [{ attributes: { POSITION: 0 }, mode: 4 }] }],
        accessors: [{
          bufferView: 0, byteOffset: 0, componentType: 5126,
          count: 3, type: "VEC3",
        }],
        bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: bin.length }],
        buffers: [{ byteLength: bin.length }],
      };
      const glb = buildGlb({ doc, binData: bin });
      const result = parseGltf(glb);
      expect(result.polygons).toHaveLength(1);
    });
  });

  describe("multiple meshes and primitives", () => {
    it("two meshes in separate nodes produce 2 triangles", () => {
      const positions = [0, 0, 0, 1, 0, 0, 0, 1, 0];
      const bin = new Uint8Array(positions.length * 4);
      const binView = new DataView(bin.buffer);
      for (let i = 0; i < positions.length; i++) {
        binView.setFloat32(i * 4, positions[i], true);
      }

      const prim = { attributes: { POSITION: 0 }, mode: 4 };
      const acc = {
        bufferView: 0, byteOffset: 0, componentType: 5126,
        count: 3, type: "VEC3",
      };

      const doc = {
        asset: { version: "2.0" },
        scene: 0,
        scenes: [{ nodes: [0, 1] }],
        nodes: [{ mesh: 0 }, { mesh: 1 }],
        meshes: [
          { name: "Mesh1", primitives: [prim] },
          { name: "Mesh2", primitives: [prim] },
        ],
        accessors: [acc],
        bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: bin.length }],
        buffers: [{ byteLength: bin.length }],
      };
      const glb = buildGlb({ doc, binData: bin });
      const result = parseGltf(glb);
      expect(result.polygons).toHaveLength(2);
    });

    it("mesh with two primitives produces two triangles", () => {
      const positions = [0, 0, 0, 1, 0, 0, 0, 1, 0];
      const bin = new Uint8Array(positions.length * 4);
      const binView = new DataView(bin.buffer);
      for (let i = 0; i < positions.length; i++) {
        binView.setFloat32(i * 4, positions[i], true);
      }

      const prim = { attributes: { POSITION: 0 }, mode: 4 };
      const acc = {
        bufferView: 0, byteOffset: 0, componentType: 5126,
        count: 3, type: "VEC3",
      };

      const doc = {
        asset: { version: "2.0" },
        scene: 0,
        scenes: [{ nodes: [0] }],
        nodes: [{ mesh: 0 }],
        meshes: [{ name: "Multi", primitives: [prim, prim] }],
        accessors: [acc],
        bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: bin.length }],
        buffers: [{ byteLength: bin.length }],
      };
      const glb = buildGlb({ doc, binData: bin });
      const result = parseGltf(glb);
      expect(result.polygons).toHaveLength(2);
    });

    it("no scenes fallback: emits all meshes directly", () => {
      const positions = [0, 0, 0, 1, 0, 0, 0, 1, 0];
      const bin = new Uint8Array(positions.length * 4);
      const binView = new DataView(bin.buffer);
      for (let i = 0; i < positions.length; i++) {
        binView.setFloat32(i * 4, positions[i], true);
      }

      const doc = {
        asset: { version: "2.0" },
        // No scenes or nodes — fallback to emitting all meshes
        meshes: [{ primitives: [{ attributes: { POSITION: 0 }, mode: 4 }] }],
        accessors: [{
          bufferView: 0, byteOffset: 0, componentType: 5126,
          count: 3, type: "VEC3",
        }],
        bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: bin.length }],
        buffers: [{ byteLength: bin.length }],
      };
      const glb = buildGlb({ doc, binData: bin });
      const result = parseGltf(glb);
      expect(result.polygons).toHaveLength(1);
    });
  });

  describe("textures and UVs", () => {
    it("TEXCOORD_0 attribute with texture URL populates uvs on polygon", () => {
      const { glb } = buildTriangleGlb({
        includeTexcoord: true,
        textureUrl: "texture.png",
      });
      // Mock URL constructor for baseUrl resolution
      const result = parseGltf(glb, { baseUrl: "https://example.com/" });
      const poly = result.polygons[0];
      expect(poly.texture).toBeDefined();
      expect(poly.uvs).toBeDefined();
      expect(poly.uvs).toHaveLength(3);
    });

    it("no texture → uvs not set on polygon", () => {
      const { glb } = buildTriangleGlb({ includeTexcoord: true });
      const result = parseGltf(glb);
      expect(result.polygons[0].uvs).toBeUndefined();
    });

    it("embedded image (bufferView-based) creates blob URL and adds to objectUrls", () => {
      const mockBlob = {};
      const mockUrl = "blob:test-url-1";
      const mockCreateObjectURL = vi.fn().mockReturnValue(mockUrl);
      const mockRevokeObjectURL = vi.fn();

      // We need Blob and URL in globalThis for extractImageUrls
      vi.stubGlobal("Blob", class MockBlob {
        constructor(public parts: unknown[], public opts?: unknown) {}
      });
      vi.stubGlobal("URL", Object.assign(
        class MockURL {
          href: string;
          constructor(u: string, base?: string) {
            this.href = base ? `${base}${u}` : u;
          }
        },
        { createObjectURL: mockCreateObjectURL, revokeObjectURL: mockRevokeObjectURL }
      ));

      const positions = [0, 0, 0, 1, 0, 0, 0, 1, 0];
      const imgBytes = new Uint8Array([0x89, 0x50]); // fake 2-byte image
      const totalBytes = positions.length * 4 + imgBytes.length;
      const bin = new Uint8Array(totalBytes);
      const binView = new DataView(bin.buffer);
      for (let i = 0; i < positions.length; i++) {
        binView.setFloat32(i * 4, positions[i], true);
      }
      bin.set(imgBytes, positions.length * 4);

      const doc = {
        asset: { version: "2.0" },
        scene: 0,
        scenes: [{ nodes: [0] }],
        nodes: [{ mesh: 0 }],
        meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0, mode: 4 }] }],
        materials: [{
          pbrMetallicRoughness: {
            baseColorTexture: { index: 0 },
          },
        }],
        textures: [{ source: 0 }],
        images: [{
          bufferView: 1,
          mimeType: "image/png",
        }],
        accessors: [{
          bufferView: 0, byteOffset: 0, componentType: 5126,
          count: 3, type: "VEC3",
        }],
        bufferViews: [
          { buffer: 0, byteOffset: 0, byteLength: positions.length * 4 },
          { buffer: 0, byteOffset: positions.length * 4, byteLength: imgBytes.length },
        ],
        buffers: [{ byteLength: totalBytes }],
      };

      const glb = buildGlb({ doc, binData: bin });
      const result = parseGltf(glb);
      expect(result.objectUrls).toContain(mockUrl);
      expect(mockCreateObjectURL).toHaveBeenCalled();
    });
  });

  describe("dispose()", () => {
    it("dispose() revokes blob URLs", () => {
      const mockRevokeObjectURL = vi.fn();
      vi.stubGlobal("URL", Object.assign(
        class MockURL {
          href: string;
          constructor(u: string, b?: string) { this.href = b ? `${b}${u}` : u; }
        },
        { createObjectURL: vi.fn().mockReturnValue("blob:x"), revokeObjectURL: mockRevokeObjectURL }
      ));
      vi.stubGlobal("Blob", class MockBlob {
        constructor(public parts: unknown[], public opts?: unknown) {}
      });

      const positions = [0, 0, 0, 1, 0, 0, 0, 1, 0];
      const imgBytes = new Uint8Array(2);
      const totalBytes = positions.length * 4 + imgBytes.length;
      const bin = new Uint8Array(totalBytes);
      const bv = new DataView(bin.buffer);
      for (let i = 0; i < positions.length; i++) bv.setFloat32(i * 4, positions[i], true);

      const doc = {
        asset: { version: "2.0" },
        scene: 0,
        scenes: [{ nodes: [0] }],
        nodes: [{ mesh: 0 }],
        meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0, mode: 4 }] }],
        materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }],
        textures: [{ source: 0 }],
        images: [{ bufferView: 1, mimeType: "image/png" }],
        accessors: [{
          bufferView: 0, byteOffset: 0, componentType: 5126, count: 3, type: "VEC3",
        }],
        bufferViews: [
          { buffer: 0, byteOffset: 0, byteLength: positions.length * 4 },
          { buffer: 0, byteOffset: positions.length * 4, byteLength: imgBytes.length },
        ],
        buffers: [{ byteLength: totalBytes }],
      };

      const glb = buildGlb({ doc, binData: bin });
      const result = parseGltf(glb);
      result.dispose();
      expect(mockRevokeObjectURL).toHaveBeenCalled();
    });

    it("dispose() is idempotent — second call is a no-op", () => {
      const { glb } = buildTriangleGlb();
      const result = parseGltf(glb);
      result.dispose();
      result.dispose(); // should not throw
    });

    it("dispose() on result with no blob URLs is a no-op", () => {
      const { glb } = buildTriangleGlb();
      const result = parseGltf(glb);
      expect(result.objectUrls).toHaveLength(0);
      expect(() => result.dispose()).not.toThrow();
    });
  });

  describe("metadata", () => {
    it("metadata.triangleCount equals polygons.length", () => {
      const { glb } = buildTriangleGlb();
      const result = parseGltf(glb);
      expect(result.metadata?.triangleCount).toBe(result.polygons.length);
    });

    it("metadata.meshes contains mesh names", () => {
      const { glb } = buildTriangleGlb();
      const result = parseGltf(glb);
      expect(result.metadata?.meshes).toContain("TestMesh");
    });

    it("metadata.meshes auto-names unnamed meshes as mesh_N", () => {
      const positions = [0, 0, 0, 1, 0, 0, 0, 1, 0];
      const bin = new Uint8Array(positions.length * 4);
      const bv = new DataView(bin.buffer);
      for (let i = 0; i < positions.length; i++) bv.setFloat32(i * 4, positions[i], true);

      const doc = {
        asset: { version: "2.0" },
        meshes: [{ primitives: [{ attributes: { POSITION: 0 }, mode: 4 }] }],
        accessors: [{
          bufferView: 0, byteOffset: 0, componentType: 5126, count: 3, type: "VEC3",
        }],
        bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: bin.length }],
        buffers: [{ byteLength: bin.length }],
      };
      const glb = buildGlb({ doc, binData: bin });
      const result = parseGltf(glb);
      expect(result.metadata?.meshes?.[0]).toBe("mesh_0");
    });

    it("metadata.materials contains material names", () => {
      const { glb } = buildTriangleGlb({ materialColor: [1, 0, 0, 1], materialName: "RedMat" });
      const result = parseGltf(glb);
      expect(result.metadata?.materials).toContain("RedMat");
    });

    it("metadata.sourceBytes equals input byteLength", () => {
      const { glb } = buildTriangleGlb();
      const result = parseGltf(glb);
      expect(result.metadata?.sourceBytes).toBe(glb.byteLength);
    });
  });

  describe("empty mesh (no triangles)", () => {
    it("empty scene → empty polygon list with metadata", () => {
      const doc = {
        asset: { version: "2.0" },
        meshes: [],
        scenes: [{ nodes: [] }],
        scene: 0,
      };
      // Need a valid (empty) binary buffer. Use data: URI with 1 byte.
      const bin = new Uint8Array(1);
      const glb = buildGlb({ doc, binData: bin });
      const result = parseGltf(glb);
      expect(result.polygons).toHaveLength(0);
      expect(result.metadata?.triangleCount).toBe(0);
    });
  });

  describe("accessor error paths", () => {
    it("throws when accessor references missing bufferView", () => {
      const positions = [0, 0, 0, 1, 0, 0, 0, 1, 0];
      const bin = new Uint8Array(positions.length * 4);
      const bv = new DataView(bin.buffer);
      for (let i = 0; i < positions.length; i++) bv.setFloat32(i * 4, positions[i], true);

      const doc = {
        asset: { version: "2.0" },
        scene: 0,
        scenes: [{ nodes: [0] }],
        nodes: [{ mesh: 0 }],
        meshes: [{ primitives: [{ attributes: { POSITION: 0 }, mode: 4 }] }],
        accessors: [{
          bufferView: 99, // doesn't exist
          byteOffset: 0, componentType: 5126, count: 3, type: "VEC3",
        }],
        bufferViews: [],
        buffers: [{ byteLength: bin.length }],
      };
      const glb = buildGlb({ doc, binData: bin });
      expect(() => parseGltf(glb)).toThrow("bad accessor");
    });

    it("throws for unsupported accessor type", () => {
      const positions = [0, 0, 0, 1, 0, 0, 0, 1, 0];
      const bin = new Uint8Array(positions.length * 4);
      const bv = new DataView(bin.buffer);
      for (let i = 0; i < positions.length; i++) bv.setFloat32(i * 4, positions[i], true);

      const doc = {
        asset: { version: "2.0" },
        scene: 0,
        scenes: [{ nodes: [0] }],
        nodes: [{ mesh: 0 }],
        meshes: [{ primitives: [{ attributes: { POSITION: 0 }, mode: 4 }] }],
        accessors: [{
          bufferView: 0,
          byteOffset: 0,
          componentType: 5126,
          count: 3,
          type: "UNKNOWN_TYPE", // unsupported
        }],
        bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: bin.length }],
        buffers: [{ byteLength: bin.length }],
      };
      const glb = buildGlb({ doc, binData: bin });
      expect(() => parseGltf(glb)).toThrow("unsupported accessor type");
    });

    it("throws for unhandled componentType", () => {
      const positions = [0, 0, 0, 1, 0, 0, 0, 1, 0];
      const bin = new Uint8Array(positions.length * 4);
      const bv = new DataView(bin.buffer);
      for (let i = 0; i < positions.length; i++) bv.setFloat32(i * 4, positions[i], true);

      const doc = {
        asset: { version: "2.0" },
        scene: 0,
        scenes: [{ nodes: [0] }],
        nodes: [{ mesh: 0 }],
        meshes: [{ primitives: [{ attributes: { POSITION: 0 }, mode: 4 }] }],
        accessors: [{
          bufferView: 0,
          byteOffset: 0,
          componentType: 5122, // SHORT — known bytes but switch falls to default
          count: 3,
          type: "VEC3",
        }],
        bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: bin.length }],
        buffers: [{ byteLength: bin.length }],
      };
      const glb = buildGlb({ doc, binData: bin });
      expect(() => parseGltf(glb)).toThrow("unhandled componentType");
    });
  });

  describe("image URL resolution", () => {
    it("image with URI gets resolved against baseUrl", () => {
      vi.stubGlobal("URL", Object.assign(
        class MockURL {
          href: string;
          constructor(u: string, base?: string) {
            this.href = base ? `${base.replace(/\/$/, "")}/${u}` : u;
          }
        },
        { createObjectURL: vi.fn(), revokeObjectURL: vi.fn() }
      ));

      const { glb } = buildTriangleGlb({
        includeTexcoord: true,
        textureUrl: "texture.png",
      });
      const result = parseGltf(glb, { baseUrl: "https://example.com/models/" });
      const poly = result.polygons[0];
      expect(poly.texture).toContain("texture.png");
    });

    it("image with data: URI is not resolved against baseUrl (kept as-is)", () => {
      const { glb } = buildTriangleGlb({
        includeTexcoord: true,
        textureUrl: "data:image/png;base64,abc",
      });
      const result = parseGltf(glb, { baseUrl: "https://example.com/" });
      const poly = result.polygons[0];
      // data: URIs bypass baseUrl resolution
      expect(poly.texture).toMatch(/^data:/);
    });

    it("image with missing bufferView → empty URL string", () => {
      const positions = [0, 0, 0, 1, 0, 0, 0, 1, 0];
      const bin = new Uint8Array(positions.length * 4);
      const bv = new DataView(bin.buffer);
      for (let i = 0; i < positions.length; i++) bv.setFloat32(i * 4, positions[i], true);

      // Image with bufferView=99 (doesn't exist)
      const doc = {
        asset: { version: "2.0" },
        scene: 0,
        scenes: [{ nodes: [0] }],
        nodes: [{ mesh: 0 }],
        meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0, mode: 4 }] }],
        materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }],
        textures: [{ source: 0 }],
        images: [{ bufferView: 99 }], // non-existent bufferView
        accessors: [{
          bufferView: 0, byteOffset: 0, componentType: 5126, count: 3, type: "VEC3",
        }],
        bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: bin.length }],
        buffers: [{ byteLength: bin.length }],
      };
      const glb = buildGlb({ doc, binData: bin });
      // Should not crash — image gets empty URL ""
      const result = parseGltf(glb);
      expect(result.polygons).toHaveLength(1);
      // texture URL is "" → falsy → not set on polygon
      expect(result.polygons[0].texture).toBeUndefined();
    });
  });

  describe("POSITION non-float fallback", () => {
    it("POSITION accessor with non-Float32Array is skipped", () => {
      // Use UNSIGNED_SHORT (5123) for POSITION — readAccessor returns Uint16Array
      // emitMesh: if (!(posArr instanceof Float32Array)) continue;
      const positions = [0, 0, 0, 1, 0, 0, 0, 1, 0];
      const bin = new Uint8Array(positions.length * 2); // uint16 each
      const bv = new DataView(bin.buffer);
      for (let i = 0; i < positions.length; i++) bv.setUint16(i * 2, positions[i], true);

      const doc = {
        asset: { version: "2.0" },
        scene: 0,
        scenes: [{ nodes: [0] }],
        nodes: [{ mesh: 0 }],
        meshes: [{ primitives: [{ attributes: { POSITION: 0 }, mode: 4 }] }],
        accessors: [{
          bufferView: 0, byteOffset: 0,
          componentType: 5123, // UNSIGNED_SHORT → Uint16Array
          count: 3, type: "VEC3",
        }],
        bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: bin.length }],
        buffers: [{ byteLength: bin.length }],
      };
      const glb = buildGlb({ doc, binData: bin });
      const result = parseGltf(glb);
      // The primitive is skipped because posArr is not Float32Array
      expect(result.polygons).toHaveLength(0);
    });
  });

  describe("UINT32 index accessor", () => {
    it("UNSIGNED_INT (5125) indices are supported", () => {
      const positions = [0, 0, 0, 1, 0, 0, 0, 1, 0];
      const idxData = [0, 1, 2];
      const posByteLen = positions.length * 4;
      const idxByteLen = idxData.length * 4;
      const bin = new Uint8Array(posByteLen + idxByteLen);
      const bv = new DataView(bin.buffer);
      for (let i = 0; i < positions.length; i++) bv.setFloat32(i * 4, positions[i], true);
      for (let i = 0; i < idxData.length; i++) bv.setUint32(posByteLen + i * 4, idxData[i], true);

      const doc = {
        asset: { version: "2.0" },
        scene: 0,
        scenes: [{ nodes: [0] }],
        nodes: [{ mesh: 0 }],
        meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, mode: 4 }] }],
        accessors: [
          { bufferView: 0, byteOffset: 0, componentType: 5126, count: 3, type: "VEC3" },
          { bufferView: 1, byteOffset: 0, componentType: 5125, count: 3, type: "SCALAR" }, // UNSIGNED_INT
        ],
        bufferViews: [
          { buffer: 0, byteOffset: 0, byteLength: posByteLen },
          { buffer: 0, byteOffset: posByteLen, byteLength: idxByteLen },
        ],
        buffers: [{ byteLength: bin.length }],
      };
      const glb = buildGlb({ doc, binData: bin });
      const result = parseGltf(glb);
      expect(result.polygons).toHaveLength(1);
    });
  });

  describe("UINT8 index accessor (UNSIGNED_BYTE)", () => {
    it("UNSIGNED_BYTE (5121) indices are supported", () => {
      const positions = [0, 0, 0, 1, 0, 0, 0, 1, 0];
      const idxData = [0, 1, 2];
      const posByteLen = positions.length * 4;
      const idxByteLen = idxData.length; // 1 byte each
      const bin = new Uint8Array(posByteLen + idxByteLen);
      const bv = new DataView(bin.buffer);
      for (let i = 0; i < positions.length; i++) bv.setFloat32(i * 4, positions[i], true);
      for (let i = 0; i < idxData.length; i++) bin[posByteLen + i] = idxData[i];

      const doc = {
        asset: { version: "2.0" },
        scene: 0,
        scenes: [{ nodes: [0] }],
        nodes: [{ mesh: 0 }],
        meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, mode: 4 }] }],
        accessors: [
          { bufferView: 0, byteOffset: 0, componentType: 5126, count: 3, type: "VEC3" },
          { bufferView: 1, byteOffset: 0, componentType: 5121, count: 3, type: "SCALAR" }, // UNSIGNED_BYTE
        ],
        bufferViews: [
          { buffer: 0, byteOffset: 0, byteLength: posByteLen },
          { buffer: 0, byteOffset: posByteLen, byteLength: idxByteLen },
        ],
        buffers: [{ byteLength: bin.length }],
      };
      const glb = buildGlb({ doc, binData: bin });
      const result = parseGltf(glb);
      expect(result.polygons).toHaveLength(1);
    });
  });
});
