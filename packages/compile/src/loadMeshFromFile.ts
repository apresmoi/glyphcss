/**
 * loadMeshFromFile — load a mesh from the local filesystem (build-time / CLI).
 *
 * Reuses the library's `loadMesh` end-to-end (extension dispatch, mesh-resolution
 * optimization) by shimming `globalThis.fetch` with a filesystem reader for the
 * duration of the call. For `.obj` it auto-detects the companion `.mtl` (via the
 * `mtllib` line, falling back to the sibling name) so material colors load —
 * otherwise faces get arbitrary palette colors. Texture-sample baking is disabled
 * (needs browser image decoding); textured faces fall back to material color.
 */
import { readFile } from "node:fs/promises";
import { loadMesh } from "@glyphcss/core";
import type { ParseResult, LoadMeshOptions } from "@glyphcss/core";
import { bakeTexturesNode, hasTextures, materializeNodeTextureUrls, releaseNodeTextureUrls } from "./textureBakeNode";

function stripQuery(url: string): string {
  return url.split("?")[0].split("#")[0];
}

/** Find an OBJ's companion .mtl on disk: the `mtllib` reference, else `<base>.mtl`. */
async function siblingMtl(objPath: string): Promise<string | undefined> {
  const clean = stripQuery(objPath);
  const dir = clean.replace(/[^/\\]+$/, "");
  const candidates: string[] = [];
  try {
    const m = (await readFile(clean, "utf8")).match(/^\s*mtllib\s+(.+?)\s*$/im);
    if (m) candidates.push(dir + m[1].trim());
  } catch { /* the conventional sibling remains a useful last attempt */ }
  const conventional = clean.replace(/\.obj$/i, ".mtl");
  if (!candidates.includes(conventional)) candidates.push(conventional);
  for (const candidate of candidates) {
    try { await readFile(candidate); return candidate; } catch { /* try the next declared/conventional candidate */ }
  }
  return undefined;
}

interface FetchLike {
  ok: boolean;
  status: number;
  text: () => Promise<string>;
  arrayBuffer: () => Promise<ArrayBuffer>;
}

async function fileFetch(url: string): Promise<FetchLike> {
  const path = stripQuery(url);
  try {
    const buf = await readFile(path);
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    return {
      ok: true,
      status: 200,
      text: async () => buf.toString("utf8"),
      arrayBuffer: async () => ab,
    };
  } catch {
    // Missing file → 404-like, so loadMesh's sibling-.mtl probe degrades gracefully.
    return { ok: false, status: 404, text: async () => "", arrayBuffer: async () => new ArrayBuffer(0) };
  }
}

export interface LoadMeshFromFileOptions extends LoadMeshOptions {
  /** Preserve authored texture references and UVs for an exact per-cell caller. */
  preserveTextures?: boolean;
}

export async function loadMeshFromFile(path: string, options?: LoadMeshFromFileOptions): Promise<ParseResult> {
  const g = globalThis as unknown as { fetch?: unknown };
  const prev = g.fetch;
  g.fetch = fileFetch as unknown as typeof fetch;
  let result: ParseResult;
  try {
    const mtlUrl = options?.mtlUrl ?? (/\.obj(\?|$)/i.test(path) ? await siblingMtl(path) : undefined);
    result = await loadMesh(path, {
      solidTextureSamples: false,
      ...options,
      gltfOptions: options?.gltfOptions,
      mtlUrl,
    });
  } finally {
    g.fetch = prev as typeof fetch;
  }
  // Bake textures to per-face colors in Node (the library's sampler is browser-only),
  // so the CLI shows true texture colors instead of the flat material fallback.
  if (options?.preserveTextures && hasTextures(result.polygons)) {
    const polygons = await materializeNodeTextureUrls(result.polygons), dispose = result.dispose;
    return { ...result, polygons, dispose: () => { releaseNodeTextureUrls(polygons); dispose(); } };
  }
  if (hasTextures(result.polygons)) {
    return { ...result, polygons: await bakeTexturesNode(result.polygons) };
  }
  return result;
}
