/**
 * loadMeshFromFile — load a mesh from the local filesystem (build-time / CLI).
 *
 * Reuses the library's `loadMesh` end-to-end (extension dispatch, sibling .mtl
 * probing, mesh-resolution optimization) by shimming `globalThis.fetch` with a
 * filesystem reader for the duration of the call. Texture-sample baking is
 * disabled (it needs browser image decoding) — the static render falls back to
 * material / vertex colors, exactly like the runtime before its async samplers.
 */
import { readFile } from "node:fs/promises";
import { loadMesh } from "@glyphcss/core";
import type { ParseResult, LoadMeshOptions } from "@glyphcss/core";

function stripQuery(url: string): string {
  return url.split("?")[0].split("#")[0];
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

export async function loadMeshFromFile(path: string, options?: LoadMeshOptions): Promise<ParseResult> {
  const g = globalThis as unknown as { fetch?: unknown };
  const prev = g.fetch;
  g.fetch = fileFetch as unknown as typeof fetch;
  try {
    return await loadMesh(path, { solidTextureSamples: false, ...options });
  } finally {
    g.fetch = prev as typeof fetch;
  }
}
