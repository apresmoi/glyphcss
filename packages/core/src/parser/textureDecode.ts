/**
 * B44 source pixels deliberately bypass the browser image pipeline. Canvas
 * decode may apply ICC/gamma conversion and premultiply/unpremultiply alpha;
 * this pure-JS decoder is shared with the Node corpus path instead.
 */
export interface GlyphDecodedTexture {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
  readonly mimeType: "image/png" | "image/jpeg";
}

interface PngjsModule {
  readonly default?: { PNG: { sync: { read(bytes: Uint8Array): { width: number; height: number; data: Uint8Array } } } };
  readonly PNG?: { sync: { read(bytes: Uint8Array): { width: number; height: number; data: Uint8Array } } };
}

interface JpegModule {
  readonly default?: { decode(bytes: Uint8Array, options: { useTArray: true; formatAsRGBA: true }): { width: number; height: number; data: Uint8Array } };
  readonly decode?: (bytes: Uint8Array, options: { useTArray: true; formatAsRGBA: true }) => { width: number; height: number; data: Uint8Array };
}

interface BufferModule { readonly Buffer: { from(bytes: Uint8Array): Uint8Array }; }

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10] as const;

function hasPrefix(bytes: Uint8Array, prefix: readonly number[]): boolean {
  return bytes.length >= prefix.length && prefix.every((value, index) => bytes[index] === value);
}

/**
 * PNG permits ancillary material after IEND in files encountered by the asset
 * corpus. Keep the complete encoded byte stream for provenance, but give the
 * exact same IEND-bounded payload to pngjs in Node and browser runtimes.
 */
function pngDecoderPayload(bytes: Uint8Array): Uint8Array {
  if (!hasPrefix(bytes, PNG_SIGNATURE)) return bytes;
  let offset: number = PNG_SIGNATURE.length;
  while (offset + 12 <= bytes.length) {
    const length = bytes[offset]! * 0x1000000 + bytes[offset + 1]! * 0x10000 + bytes[offset + 2]! * 0x100 + bytes[offset + 3]!;
    const end = offset + 12 + length;
    if (end > bytes.length) return bytes;
    if (bytes[offset + 4] === 73 && bytes[offset + 5] === 69 && bytes[offset + 6] === 78 && bytes[offset + 7] === 68) return bytes.subarray(0, end);
    offset = end;
  }
  return bytes;
}

/**
 * Decode source PNG/JPEG bytes with no color conversion or premultiplication.
 * The codec modules are lazy so ordinary glyph rendering does not ship or load
 * them; exact corpus callers opt in through `shared-exact`.
 */
export async function decodeGlyphTextureBytes(bytes: Uint8Array): Promise<GlyphDecodedTexture | null> {
  if (hasPrefix(bytes, PNG_SIGNATURE)) {
    const [pngModule, bufferModule] = await Promise.all([
      import("pngjs/browser.js") as Promise<PngjsModule>,
      import("buffer") as Promise<BufferModule>,
    ]);
    const pngjs = pngModule.default ?? pngModule;
    // pngjs's browser bundle uses its browserified Buffer API internally;
    // construct that compatible byte view explicitly rather than passing a
    // plain Uint8Array returned by fetch().
    const image = pngjs.PNG!.sync.read(bufferModule.Buffer.from(pngDecoderPayload(bytes)));
    return {
      width: image.width,
      height: image.height,
      data: new Uint8Array(image.data.buffer, image.data.byteOffset, image.data.byteLength),
      mimeType: "image/png",
    };
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    const jpegModule = await import("jpeg-js") as JpegModule;
    const decode = jpegModule.default?.decode ?? jpegModule.decode;
    if (!decode) throw new Error("jpeg-js decoder is unavailable");
    const image = decode(bytes, { useTArray: true, formatAsRGBA: true });
    return { width: image.width, height: image.height, data: image.data, mimeType: "image/jpeg" };
  }
  return null;
}
