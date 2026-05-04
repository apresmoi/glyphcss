/**
 * loadMesh — high-level fetch+parse dispatcher. Picks the parser by file
 * extension, fetches the URL, runs the parser, returns the unified
 * `ParseResult`.
 *
 * Supported:
 *   - `.obj`  → text fetch + `parseObj`
 *   - `.glb`  → ArrayBuffer fetch + `parseGltf`
 *   - `.gltf` → ArrayBuffer fetch + `parseGltf` (caller may pass `baseUrl`)
 *
 * `.mtl` is rejected — it's a material file, not a mesh. Use `parseMtl`
 * directly if you want to read materials.
 *
 * Other extensions throw. Future formats (STL, PLY) plug in here.
 */
import type { ParseResult } from "./types";
import { parseObj } from "./parseObj";
import { parseGltf } from "./parseGltf";

export interface LoadMeshOptions {
  /**
   * Base URL for resolving relative texture/buffer URIs inside the mesh
   * (passed through to `parseGltf` for embedded image extraction). When
   * omitted, the URL passed to `loadMesh` is used as the base.
   */
  baseUrl?: string;
}

const FETCH_NAME = "loadMesh";

function extensionOf(url: string): string {
  const clean = url.split("?")[0].split("#")[0];
  const dot = clean.lastIndexOf(".");
  if (dot < 0) return "";
  return clean.slice(dot + 1).toLowerCase();
}

export async function loadMesh(url: string, options?: LoadMeshOptions): Promise<ParseResult> {
  const ext = extensionOf(url);

  if (ext === "mtl") {
    throw new Error(`${FETCH_NAME}: .mtl is a material file, not a mesh — use parseMtl directly`);
  }

  const fetchFn = (globalThis as unknown as { fetch?: (url: string) => Promise<{ ok: boolean; status: number; text: () => Promise<string>; arrayBuffer: () => Promise<ArrayBuffer> }> }).fetch;
  if (!fetchFn) {
    throw new Error(`${FETCH_NAME}: no fetch() in this environment`);
  }
  const baseUrl = options?.baseUrl ?? url;

  if (ext === "obj") {
    const res = await fetchFn(url);
    if (!res.ok) throw new Error(`${FETCH_NAME}: ${url} → ${res.status}`);
    const text = await res.text();
    return parseObj(text);
  }

  if (ext === "glb" || ext === "gltf") {
    const res = await fetchFn(url);
    if (!res.ok) throw new Error(`${FETCH_NAME}: ${url} → ${res.status}`);
    const buf = await res.arrayBuffer();
    return parseGltf(buf, { baseUrl });
  }

  throw new Error(`${FETCH_NAME}: unsupported extension ".${ext}" (supported: obj, glb, gltf)`);
}
