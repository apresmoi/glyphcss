import { createHash } from "node:crypto";
import jpeg from "jpeg-js";
import { PNG } from "pngjs";
import { describe, expect, it, vi } from "vitest";
import { buildTextureSamplers, decodeGlyphTextureBytes, sampleTexel, type Polygon } from "../index";

const rgba = Uint8Array.from([
  17, 34, 51, 255,
  61, 79, 97, 127,
  113, 131, 149, 0,
  173, 191, 211, 255,
]);

function fixturePng(): Uint8Array {
  const image = new PNG({ width: 2, height: 2 });
  image.data.set(rgba);
  return PNG.sync.write(image);
}

function fixtureJpeg(): Uint8Array {
  return jpeg.encode({ data: Buffer.from(rgba), width: 2, height: 2 }, 100).data;
}

const polygon = (texture: string): Polygon => ({
  vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
  uvs: [[0, 0], [1, 0], [0, 1]],
  texture,
});

describe("B44 shared source-byte texture decoder", () => {
  it("has identical decoded bytes for the PNG and JPEG implementations used by Node and browser paths", async () => {
    for (const [bytes, expectedHash, expectedBytes] of [
      [fixturePng(), "ed01d4ba54390845187878b4033346f7c38b74c1744906eceae5c0e827ed4a8a", [17, 34, 51, 255, 61, 79, 97, 127, 113, 131, 149, 0, 173, 191, 211, 255]],
      [fixtureJpeg(), "46cddca4fba3161fb1812e555ff187a83e3f23875d7f84db2b35a10d9fc6d8bd", [18, 33, 50, 255, 61, 79, 97, 255, 113, 131, 149, 255, 172, 191, 211, 255]],
    ] as const) {
      const decoded = await decodeGlyphTextureBytes(bytes);
      expect(decoded).not.toBeNull();
      expect(decoded?.width).toBe(2);
      expect(decoded?.height).toBe(2);
      expect(createHash("sha256").update(decoded!.data).digest("hex")).toBe(expectedHash);
      expect([...decoded!.data]).toEqual(expectedBytes);
    }
  });

  it("uses the exact decoded source bytes for nearest/clamp UV samples", async () => {
    const bytes = fixturePng();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(bytes, { status: 200 }));
    try {
      const sampler = (await buildTextureSamplers([polygon("https://fixture.invalid/texture.png")], { decodePolicy: "shared-exact" })).get("https://fixture.invalid/texture.png")!;
      const expected = (await decodeGlyphTextureBytes(bytes))!;
      expect([...sampler.data]).toEqual([...expected.data]);
      expect(sampleTexel(sampler, 0, 1)).toEqual({ r: 17, g: 34, b: 51, a: 255 });
      expect(sampleTexel(sampler, 1, 0)).toEqual({ r: 173, g: 191, b: 211, a: 255 });
    } finally { fetchSpy.mockRestore(); }
  });

  it("normalizes trailing PNG bytes inside the shared decoder while retaining source-byte ownership outside it", async () => {
    const source = fixturePng();
    const trailing = Uint8Array.from([...source, 0xde, 0xad, 0xbe, 0xef]);
    const decoded = await decodeGlyphTextureBytes(trailing);
    expect(createHash("sha256").update(decoded!.data).digest("hex")).toBe("ed01d4ba54390845187878b4033346f7c38b74c1744906eceae5c0e827ed4a8a");
    expect(createHash("sha256").update(trailing).digest("hex")).not.toBe(createHash("sha256").update(source).digest("hex"));
  });

  it("rejects unsupported or unfetchable source bytes in shared-exact mode instead of falling back to canvas", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(Uint8Array.of(1, 2, 3), { status: 200 }));
    try {
      await expect(buildTextureSamplers([polygon("https://fixture.invalid/not-an-image")], { decodePolicy: "shared-exact" })).rejects.toThrow(/shared-exact texture decoder does not support/);
    } finally { fetchSpy.mockRestore(); }
  });

  it("keeps the canvas path available only to ordinary runtime sampling", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("cross-origin fetch blocked"));
    class RuntimeImage {
      naturalWidth = 1;
      naturalHeight = 1;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_value: string) { queueMicrotask(() => this.onload?.()); }
    }
    vi.stubGlobal("Image", RuntimeImage);
    vi.stubGlobal("document", { createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({ drawImage: () => undefined, getImageData: () => ({ data: Uint8Array.from([7, 8, 9, 255]) }) }),
    }) });
    try {
      const sampler = (await buildTextureSamplers([polygon("https://fixture.invalid/runtime-only.webp")])).get("https://fixture.invalid/runtime-only.webp");
      expect(sampler?.data).toEqual(Uint8Array.from([7, 8, 9, 255]));
      expect(fetchSpy).not.toHaveBeenCalled();
      await expect(buildTextureSamplers([polygon("https://fixture.invalid/runtime-only.webp")], { decodePolicy: "shared-exact" })).rejects.toThrow(/shared-exact texture decode failed/);
    } finally {
      fetchSpy.mockRestore();
      vi.unstubAllGlobals();
    }
  });
});
