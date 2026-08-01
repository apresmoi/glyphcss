import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import jpeg from "jpeg-js";
import { PNG } from "pngjs";
import type { Polygon } from "@glyphcss/core";
import { buildNodeTextureSamplerBundle, buildNodeTextureSamplers, materializeNodeTextureUrls, releaseNodeTextureUrls } from "./textureBakeNode";

const polygon = (texture: string): Polygon => ({ vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]], uvs: [[0, 0], [1, 0], [0, 1]], texture });
const rgba = Buffer.from([32, 96, 160, 255]);

describe("buildNodeTextureSamplers", () => {
  it("rejects a partial authored texture set instead of permitting flat fallback", async () => {
    const root = await mkdtemp(join(tmpdir(), "glyphcss-texture-"));
    try {
      const png = new PNG({ width: 1, height: 1 }); png.data.set(rgba);
      const good = join(root, "good.png"); await writeFile(good, PNG.sync.write(png));
      await expect(buildNodeTextureSamplers([polygon(good), polygon(join(root, "missing.png"))])).rejects.toThrow(/decode failed.*missing\.png/i);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("decodes PNG, JPEG, and PNG data URIs into deterministic sampler pixels", async () => {
    const root = await mkdtemp(join(tmpdir(), "glyphcss-texture-"));
    try {
      const png = new PNG({ width: 1, height: 1 }); png.data.set(rgba);
      const pngBytes = PNG.sync.write(png), pngPath = join(root, "pixel.png"), jpegPath = join(root, "pixel.jpg");
      await writeFile(pngPath, pngBytes); await writeFile(jpegPath, jpeg.encode({ data: rgba, width: 1, height: 1 }, 100).data);
      const dataUri = `data:image/png;base64,${pngBytes.toString("base64")}`;
      const percentDataUri = `data:image/png,${Array.from(pngBytes, (byte) => `%${byte.toString(16).padStart(2, "0")}`).join("")}`;
      const samplers = await buildNodeTextureSamplers([polygon(pngPath), polygon(jpegPath), polygon(dataUri), polygon(percentDataUri)]);
      expect([...samplers.keys()]).toEqual([dataUri, percentDataUri, jpegPath, pngPath].sort());
      expect([...samplers.get(pngPath)!.data].slice(0, 4)).toEqual([...rgba]);
      expect([...samplers.get(dataUri)!.data].slice(0, 4)).toEqual([...rgba]);
      expect([...samplers.get(percentDataUri)!.data].slice(0, 4)).toEqual([...rgba]);
      const decodedJpeg = samplers.get(jpegPath)!.data;
      expect(Math.abs(decodedJpeg[0] - rgba[0])).toBeLessThanOrEqual(3);
      expect(Math.abs(decodedJpeg[1] - rgba[1])).toBeLessThanOrEqual(3);
      expect(Math.abs(decodedJpeg[2] - rgba[2])).toBeLessThanOrEqual(3);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("uses the frozen shared PNG/JPEG decoded hashes rather than an independent Node codec path", async () => {
    const root = await mkdtemp(join(tmpdir(), "glyphcss-texture-"));
    try {
      const png = new PNG({ width: 1, height: 1 }); png.data.set(rgba);
      const pngPath = join(root, "pixel.png"), jpegPath = join(root, "pixel.jpg");
      await writeFile(pngPath, PNG.sync.write(png));
      await writeFile(jpegPath, jpeg.encode({ data: rgba, width: 1, height: 1 }, 100).data);
      const bundle = await buildNodeTextureSamplerBundle([polygon(pngPath), polygon(jpegPath)]);
      expect(bundle.sources.map((source) => [source.mimeType, source.decodedPixelSha256])).toEqual([
        ["image/jpeg", "e71d478badac2b62b13deb36f9865a1a0247f2a0ddb4ab6cb877f0e4af95d63a"],
        ["image/png", "979202bd0bcc9e1f5925f08dbfc8e41c3c588ce78ea95af25025d71802030b57"],
      ]);
      for (const source of bundle.sources) expect(createHash("sha256").update(bundle.samplers.get(source.handle)!.data).digest("hex")).toBe(source.decodedPixelSha256);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("uses the shared decoder's trailing-PNG normalization without changing source-byte provenance", async () => {
    const root = await mkdtemp(join(tmpdir(), "glyphcss-texture-"));
    try {
      const png = new PNG({ width: 1, height: 1 }); png.data.set(rgba);
      const pngPath = join(root, "trailing.png");
      await writeFile(pngPath, Buffer.concat([PNG.sync.write(png), Buffer.from([0xde, 0xad, 0xbe, 0xef])]));
      const bundle = await buildNodeTextureSamplerBundle([polygon(pngPath)]);
      expect(bundle.sources[0]!.decodedPixelSha256).toBe("979202bd0bcc9e1f5925f08dbfc8e41c3c588ce78ea95af25025d71802030b57");
      expect(bundle.sources[0]!.byteSha256).not.toBe(createHash("sha256").update(PNG.sync.write(png)).digest("hex"));
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("materializes a Node embedded-GLB blob URL before it can enter control hashes", async () => {
    const png = new PNG({ width: 1, height: 1 }); png.data.set(rgba);
    const url = URL.createObjectURL(new Blob([PNG.sync.write(png)], { type: "image/png" }));
    try {
      const polygons = await materializeNodeTextureUrls([polygon(url)]);
      expect(polygons[0]!.texture).toMatch(/^glyph-node-texture:\/\/[a-f0-9]{64}$/);
      const bundle = await buildNodeTextureSamplerBundle(polygons);
      const samplers = bundle.samplers;
      expect([...samplers.values()][0]!.data[0]).toBe(rgba[0]);
      expect(bundle.sources[0]).toMatchObject({ handle: polygons[0]!.texture, mimeType: "image/png", width: 1, height: 1 });
      expect(bundle.sources[0]!.byteSha256).toBe(polygons[0]!.texture!.slice("glyph-node-texture://".length));
      await expect(buildNodeTextureSamplers([...polygons])).resolves.toHaveProperty("size", 1);
    } finally { URL.revokeObjectURL(url); }
  });

  it("keeps shared content handles live until every loaded mesh is disposed", async () => {
    const png = new PNG({ width: 1, height: 1 }); png.data.set(rgba);
    const url = URL.createObjectURL(new Blob([PNG.sync.write(png)], { type: "image/png" }));
    try {
      const first = await materializeNodeTextureUrls([polygon(url)]);
      const second = await materializeNodeTextureUrls([polygon(url)]);
      releaseNodeTextureUrls(first);
      await expect(buildNodeTextureSamplers(second)).resolves.toHaveProperty("size", 1);
      releaseNodeTextureUrls(second);
    } finally { URL.revokeObjectURL(url); }
  });
});
