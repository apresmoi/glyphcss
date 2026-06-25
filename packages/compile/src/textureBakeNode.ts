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
import { PNG } from "pngjs";
import jpeg from "jpeg-js";
import type { Polygon, Vec2 } from "@glyphcss/core";

interface Img { w: number; h: number; data: Uint8Array | Buffer; }

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

async function decode(path: string): Promise<Img | null> {
  const fp = toFilePath(path);
  try {
    const buf = await readFile(fp);
    if (/\.png$/i.test(fp)) { const p = PNG.sync.read(buf); return { w: p.width, h: p.height, data: p.data }; }
    if (/\.jpe?g$/i.test(fp)) { const j = jpeg.decode(buf, { useTArray: true }); return { w: j.width, h: j.height, data: j.data }; }
  } catch { /* unreadable / unsupported → skip */ }
  return null;
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
  const cache = new Map<string, Img | null>();
  const get = async (url: string): Promise<Img | null> => {
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
        out.push({ ...p, color: sampleFace(img, uvs), texture: undefined, textureTriangles: undefined, uvs: undefined });
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
