import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { packGlyphControlTensor } from "glyphcss";
import type { GlyphControlFrame } from "glyphcss";
import { writeGlyphControlMaps } from "./controlMaps";

const hash = (value: string) => value.repeat(64);
function frame(): GlyphControlFrame {
  return { visibleAscii: "X", semanticAscii: "A", visibleColor: new Uint32Array([0xffffffff]), semanticColor: new Uint32Array([0xff102030]), targetRgb: new Uint32Array([0xff8040]), albedoRgb: new Uint32Array([0x804020]), coverage: new Uint8Array([1]), winnerPolygon: new Int32Array([0]), classId: new Int32Array([1]), instanceId: new Int32Array([0]), surfaceId: new Int32Array([0]), instanceLookup: ["instance/a"], surfaceLookup: ["surface/a"], depth: new Float64Array([5]), shade: new Float32Array([.5]), normal: new Float32Array([0, 0, 1]), worldPosition: new Float32Array([0, 0, 0]), surfaceUv: new Float32Array([.5, .5]), metadata: { scene: { schemaVersion: "control-scene/v1", id: "scene/a", dictionaryId: "dictionary/a", dictionarySha256: hash("d"), geometrySha256: hash("e"), polygonOrderSha256: hash("f"), contentSha256: hash("b"), instances: [{ id: "instance/a", classId: 1 }], surfaces: [{ id: "surface/a", instanceId: "instance/a" }], polygonSurfaceIds: ["surface/a"] }, dictionary: { schemaVersion: "glyph-object-dictionary/v2", id: "dictionary/a", contentSha256: hash("d"), font: { id: "font/a", version: "1", sha256: hash("a") } }, camera: { kind: "orthographic", rotX: 0, rotY: 0, center: [0, 0], mat: null, useMat: false, distance: 0, perspective: 0, zoom: 1, stretch: 1, fovScale: 1, target: [0, 0, 0], eyeMode: false }, cols: 1, rows: 1, cellAspect: 2, supersample: 1 } };
}
const normalization = { depth: { near: 0, far: 10 }, world: { min: [-1, -1, -1] as [number, number, number], max: [1, 1, 1] as [number, number, number] } };

describe("writeGlyphControlMaps", () => {
  it("keeps the default publication on the frozen v1 contract", async () => {
    const root = await mkdtemp(join(tmpdir(), "glyph-control-export-"));
    try {
      const source = frame(); const result = await writeGlyphControlMaps({ destination: join(root, "sample"), frames: [{ frame: source }], normalization, glyphOutput: "semantic" });
      expect(result.manifest.schemaVersion).toBe("glyph-control-export/v1");
      expect(await readFile(join(root, "sample", "frames", "frame-000000", "selected.txt"), "utf8")).toBe("A");
      const tensor = new Uint8Array(await readFile(join(root, "sample", "frames", "frame-000000", "tensor-keyframe-f32.bin")));
      expect(tensor).toEqual(new Uint8Array(packGlyphControlTensor(source, normalization).keyframe.buffer));
      expect(result.manifest.frames[0]!.files).not.toHaveProperty("albedo-rgb-u32");
      expect(result.manifest.frames[0]!.files).not.toHaveProperty("target-rgb-u32");
      await expect(readFile(join(root, "sample", "frames", "frame-000000", "albedo-rgb-u32.bin"))).rejects.toThrow();
      await expect(readFile(join(root, "sample", "frames", "frame-000000", "target-rgb-u32.bin"))).rejects.toThrow();
      expect(JSON.parse(await readFile(result.manifestPath, "utf8")).contentSha256).toBe(result.manifest.contentSha256);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("writes separately hashed B44 albedo and target maps only with the explicit opt-in", async () => {
    const root = await mkdtemp(join(tmpdir(), "glyph-control-export-"));
    try {
      const source = frame(); const result = await writeGlyphControlMaps({ destination: join(root, "sample"), frames: [{ frame: source }], normalization, appearanceRgb: "albedo-and-target" });
      expect(result.manifest.schemaVersion).toBe("glyph-control-export/v2");
      expect(result.manifest.appearanceRgb).toBe("albedo-and-target");
      const albedo = new Uint8Array(await readFile(join(root, "sample", "frames", "frame-000000", "albedo-rgb-u32.bin")));
      const target = new Uint8Array(await readFile(join(root, "sample", "frames", "frame-000000", "target-rgb-u32.bin")));
      expect(albedo).toEqual(new Uint8Array(source.albedoRgb.buffer));
      expect(target).toEqual(new Uint8Array(source.targetRgb.buffer));
      expect(result.manifest.files[result.manifest.frames[0]!.files["albedo-rgb-u32"]!]).toBeDefined();
      expect(result.manifest.files[result.manifest.frames[0]!.files["target-rgb-u32"]!]).toBeDefined();
      expect(JSON.parse(await readFile(result.manifestPath, "utf8")).contentSha256).toBe(result.manifest.contentSha256);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("stabilizes the 13-significant-digit platform boundary while preserving meaningful control changes", async () => {
    const root = await mkdtemp(join(tmpdir(), "glyph-control-export-"));
    try {
      const darwin = frame(); darwin.depth[0] = 0.0036019107497491506; darwin.normal[0] = -0;
      const linux = frame(); linux.depth[0] = 0.0036019107497491432; linux.normal[0] = 0;
      const changed = frame(); changed.depth[0] = darwin.depth[0] + 1e-10;
      const a = await writeGlyphControlMaps({ destination: join(root, "darwin"), frames: [{ frame: darwin }], normalization });
      const b = await writeGlyphControlMaps({ destination: join(root, "linux"), frames: [{ frame: linux }], normalization });
      const c = await writeGlyphControlMaps({ destination: join(root, "changed"), frames: [{ frame: changed }], normalization });
      const map = (name: string) => readFile(join(root, name, "frames", "frame-000000", "depth-f64.bin"));
      expect(await map("linux")).toEqual(await map("darwin"));
      expect(await map("changed")).not.toEqual(await map("darwin"));
      expect(b.manifest.contentSha256).toBe(a.manifest.contentSha256);
      expect(c.manifest.contentSha256).not.toBe(a.manifest.contentSha256);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("refuses overwrite and leaves a destination untouched on an injected failure", async () => {
    const root = await mkdtemp(join(tmpdir(), "glyph-control-export-")); const destination = join(root, "sample");
    try {
      await writeGlyphControlMaps({ destination, frames: [{ frame: frame() }], normalization });
      await expect(writeGlyphControlMaps({ destination, frames: [{ frame: frame() }], normalization })).rejects.toThrow(/refusing/);
      const before = await readFile(join(destination, "manifest.json"), "utf8");
      await expect(writeGlyphControlMaps({ destination: join(root, "failed"), frames: [{ frame: frame() }], normalization, failAfterWrites: 2 })).rejects.toThrow(/injected/);
      await expect(readFile(join(root, "failed", "manifest.json"))).rejects.toThrow();
      expect(await readFile(join(destination, "manifest.json"), "utf8")).toBe(before);
      await writeFile(join(root, "marker"), "ok");
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("fails closed when a second trajectory frame has stale polygon-order lineage", async () => {
    const root = await mkdtemp(join(tmpdir(), "glyph-control-export-"));
    try {
      const stale = frame();
      (stale.metadata.scene as { polygonOrderSha256: string }).polygonOrderSha256 = hash("0");
      await expect(writeGlyphControlMaps({ destination: join(root, "stale"), frames: [{ frame: frame() }, { frame: stale }], normalization })).rejects.toThrow(/post-load polygon order/);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
