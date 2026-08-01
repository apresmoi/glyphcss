/**
 * bakeTexturesNode — decode mesh textures in Node and bake each textured face to
 * its sampled color. The library's texture sampling needs a browser (canvas), so
 * the CLI couldn't show texture colors — here we decode PNG/JPG ourselves and
 * sample per face, giving true colors in the terminal / build output.
 *
 * Per-face sampling averages the triangle's UV corners + centroid (one color per
 * face) — enough for the ASCII grid's resolution.
 */
import { readFile } from "node:fs/promises";
import { resolveObjectURL } from "node:buffer";
import { createHash } from "node:crypto";
import { decodeGlyphTextureBytes, polygonTexture, type Polygon, type TextureSampler, type Vec2 } from "@glyphcss/core";

interface Img { w: number; h: number; data: Uint8Array | Buffer; }
interface EmbeddedTexture { mime: string; bytes: Buffer; }
interface DecodedTexture { image: Img; mimeType: string; bytes: Buffer; }

export interface GlyphNodeTextureSource {
  readonly handle: string;
  readonly byteSha256: string;
  readonly decodedPixelSha256: string;
  readonly mimeType: string;
  readonly width: number;
  readonly height: number;
}

export interface GlyphNodeTextureSamplerBundle {
  readonly samplers: Map<string, TextureSampler>;
  readonly sources: readonly GlyphNodeTextureSource[];
}

// Node's `blob:` URLs are process-local and external URLs encode checkout
// paths.  Prepared meshes therefore use content handles.  The byte registry is
// explicitly released with the loader result so corpus workers cannot retain a
// whole prior run, while a copied polygon array still resolves the same stable
// content identity during an in-flight render.
const textureBytesByHandle = new Map<string, EmbeddedTexture & { references: number }>();
const textureHandlesForPolygons = new WeakMap<object, readonly string[]>();

function stripQuery(url: string): string {
  return url.split("?")[0].split("#")[0];
}

/** Normalize a texture ref to a readable filesystem path (handles http://localhost
 *  / file:// forms that the loader can produce when a DOM base URL is present). */
function toFilePath(url: string): string {
  const clean = stripQuery(url);
  if (/^https?:\/\//i.test(clean)) { try { return decodeURIComponent(new URL(clean).pathname); } catch { /* keep */ } }
  if (clean.startsWith("file://")) { try { return decodeURIComponent(new URL(clean).pathname); } catch { /* keep */ } }
  return clean;
}

function percentDecodedBytes(value: string): Buffer {
  const bytes: number[] = [];
  for (let index = 0; index < value.length; index++) {
    if (value[index] === "%" && /^[0-9a-f]{2}$/i.test(value.slice(index + 1, index + 3))) {
      bytes.push(Number.parseInt(value.slice(index + 1, index + 3), 16)); index += 2;
    } else bytes.push(...Buffer.from(value[index]!, "utf8"));
  }
  return Buffer.from(bytes);
}

async function decode(path: string, embeddedTextures?: ReadonlyMap<string, EmbeddedTexture>): Promise<DecodedTexture | null> {
  const fp = toFilePath(path);
  try {
    const data = /^data:([^;,]+)?(?:;base64)?,(.*)$/s.exec(path);
    let mime = data?.[1]?.toLowerCase();
    let buf: Buffer;
    if (data) buf = path.includes(";base64,") ? Buffer.from(data[2], "base64") : percentDecodedBytes(data[2]);
    else if (path.startsWith("glyph-node-texture://")) {
      const embedded = embeddedTextures?.get(path);
      if (!embedded) return null;
      mime = embedded.mime; buf = embedded.bytes;
    }
    else if (path.startsWith("blob:")) {
      const blob = resolveObjectURL(path);
      if (!blob) return null;
      mime = blob.type.toLowerCase();
      buf = Buffer.from(await blob.arrayBuffer());
    } else buf = await readFile(fp);
    // Pass full encoded source bytes. The shared decoder performs its identical
    // internal PNG payload normalization in both browser and Node paths while
    // this `buf` remains the provenance-hashed source byte stream.
    const decoded = await decodeGlyphTextureBytes(buf);
    if (decoded) return { image: { w: decoded.width, h: decoded.height, data: decoded.data }, mimeType: mime || decoded.mimeType, bytes: buf };
  } catch (error) { throw new Error(`glyphcss: texture decode failed for ${path}: ${error instanceof Error ? error.message : String(error)}`); }
  return null;
}

/** Replace Node-process-local embedded GLB blob URLs before they enter hashes. */
export async function materializeNodeTextureUrls(polygons: readonly Polygon[]): Promise<Polygon[]> {
  const urls = new Map<string, string>();
  const bytesByUrl = new Map<string, EmbeddedTexture>();
  for (const polygon of polygons) {
    const texture = polygonTexture(polygon);
    if (!texture || texture.startsWith("glyph-node-texture://")) continue;
    if (!urls.has(texture)) {
      const decoded = await decode(texture);
      if (!decoded) throw new Error(`glyphcss: texture URL is unreadable: ${texture}`);
      const handle = `glyph-node-texture://${createHash("sha256").update(decoded.bytes).digest("hex")}`;
      urls.set(texture, handle);
      bytesByUrl.set(texture, { mime: decoded.mimeType, bytes: decoded.bytes });
    }
  }
  if (!urls.size) return [...polygons];
  const materialized = polygons.map((polygon) => {
    const texture = polygonTexture(polygon), replacement = texture ? urls.get(texture) : undefined;
    if (!replacement) return polygon;
    const textureTriangles = polygon.textureTriangles?.map((triangle) => triangle.texture === texture ? { ...triangle, texture: replacement } : triangle);
    return polygon.material?.texture === texture
      ? { ...polygon, material: { ...polygon.material, texture: replacement } }
      : { ...polygon, texture: replacement, ...(textureTriangles ? { textureTriangles } : {}) };
  });
  for (const [blobUrl, handle] of urls) {
    const bytes = bytesByUrl.get(blobUrl)!;
    const existing = textureBytesByHandle.get(handle);
    if (existing && !existing.bytes.equals(bytes.bytes)) throw new Error(`glyphcss: texture handle collision: ${handle}`);
    if (existing) existing.references += 1;
    else textureBytesByHandle.set(handle, { ...bytes, references: 1 });
  }
  textureHandlesForPolygons.set(materialized, [...new Set(urls.values())]);
  return materialized;
}

/** Release byte authority retained for a prepared mesh once its loader result is disposed. */
export function releaseNodeTextureUrls(polygons: readonly Polygon[]): void {
  for (const handle of textureHandlesForPolygons.get(polygons as object) ?? []) {
    const retained = textureBytesByHandle.get(handle);
    if (!retained) continue;
    if (retained.references <= 1) textureBytesByHandle.delete(handle);
    else retained.references -= 1;
  }
  textureHandlesForPolygons.delete(polygons as object);
}

/**
 * Decode PNG/JPEG texture sources into the exact nearest/clamp sampler shape
 * used by core's per-cell renderer. Unlike `bakeTexturesNode`, this preserves
 * authored UVs and lets the depth-winning scan fill choose every target texel.
 */
export async function buildNodeTextureSamplers(polygons: readonly Polygon[]): Promise<Map<string, TextureSampler>> {
  return (await buildNodeTextureSamplerBundle(polygons)).samplers;
}

/** Decode every render-bound texture once and expose hashes without serializing image bytes into manifests. */
export async function buildNodeTextureSamplerBundle(polygons: readonly Polygon[]): Promise<GlyphNodeTextureSamplerBundle> {
  const urls = new Set<string>();
  for (const polygon of polygons) {
    const texture = polygonTexture(polygon);
    if (texture) urls.add(texture);
  }
  const out = new Map<string, TextureSampler>();
  const sources: GlyphNodeTextureSource[] = [];
  const missing: string[] = [];
  for (const url of [...urls].sort()) {
    const image = await decode(url, textureBytesByHandle);
    if (!image) { missing.push(url); continue; }
    out.set(url, { width: image.image.w, height: image.image.h, data: image.image.data, lowDetail: false });
    sources.push({
      handle: url,
      byteSha256: createHash("sha256").update(image.bytes).digest("hex"),
      decodedPixelSha256: createHash("sha256").update(image.image.data).digest("hex"),
      mimeType: image.mimeType,
      width: image.image.w,
      height: image.image.h,
    });
  }
  if (missing.length) throw new Error(`glyphcss: Node texture decoding is incomplete: ${missing.join(", ")}`);
  return { samplers: out, sources };
}

function texelAt(img: Img, u: number, v: number): [number, number, number] {
  const x = Math.min(img.w - 1, Math.max(0, Math.round(u * (img.w - 1))));
  const y = Math.min(img.h - 1, Math.max(0, Math.round((1 - v) * (img.h - 1)))); // image v is flipped
  const i = (y * img.w + x) * 4; // both decoders give RGBA
  return [img.data[i], img.data[i + 1], img.data[i + 2]];
}

function sampleFace(img: Img, uvs: [Vec2, Vec2, Vec2]): string {
  const pts: Vec2[] = [uvs[0], uvs[1], uvs[2], [(uvs[0][0] + uvs[1][0] + uvs[2][0]) / 3, (uvs[0][1] + uvs[1][1] + uvs[2][1]) / 3]];
  let r = 0, g = 0, b = 0;
  for (const [u, v] of pts) { const c = texelAt(img, u, v); r += c[0]; g += c[1]; b += c[2]; }
  const n = pts.length;
  const h = (x: number) => Math.round(x / n).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

export async function bakeTexturesNode(polygons: Polygon[]): Promise<Polygon[]> {
  const cache = new Map<string, DecodedTexture | null>();
  const get = async (url: string): Promise<DecodedTexture | null> => {
    if (!cache.has(url)) cache.set(url, await decode(url));
    return cache.get(url) ?? null;
  };
  const out: Polygon[] = [];
  for (const p of polygons) {
    const tt = p.textureTriangles?.[0];
    const tex = p.texture ?? p.material?.texture ?? tt?.texture;
    const uvs = tt?.uvs ?? (p.uvs && p.uvs.length >= 3 ? [p.uvs[0], p.uvs[1], p.uvs[2]] as [Vec2, Vec2, Vec2] : undefined);
    if (tex && uvs) {
      const img = await get(tex);
      if (img) {
        out.push({ ...p, color: sampleFace(img.image, uvs), texture: undefined, textureTriangles: undefined, uvs: undefined });
        continue;
      }
    }
    out.push(p);
  }
  return out;
}

/** Does any polygon carry a texture reference? */
export function hasTextures(polygons: Polygon[]): boolean {
  return polygons.some((p) => p.texture || p.material?.texture || (p.textureTriangles?.[0]?.texture));
}
