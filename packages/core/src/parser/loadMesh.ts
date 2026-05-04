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
import type { ObjParseOptions } from "./parseObj";
import type { GltfParseOptions } from "./parseGltf";
import { parseObj } from "./parseObj";
import { parseGltf } from "./parseGltf";
import { parseMtl } from "./parseMtl";

export interface LoadMeshOptions {
  /**
   * Base URL for resolving relative texture/buffer URIs inside the mesh
   * (passed through to `parseGltf` for embedded image extraction). When
   * omitted, the URL passed to `loadMesh` is used as the base.
   */
  baseUrl?: string;
  /**
   * Companion `.mtl` URL for OBJ files. When set, loadMesh fetches the
   * mtl, runs `parseMtl`, and threads `materialColors` + `materialTextures`
   * into `parseObj` — so the OBJ renders with its authored materials.
   * Texture paths inside the mtl are resolved against the mtl URL.
   * Ignored for `.glb` / `.gltf` (they carry materials inline).
   */
  mtlUrl?: string;
  /** Forwarded to `parseObj` (merged with materials derived from `mtlUrl`). */
  objOptions?: ObjParseOptions;
  /** Forwarded to `parseGltf`. */
  gltfOptions?: GltfParseOptions;
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

    let objOptions: ObjParseOptions | undefined = options?.objOptions;
    if (options?.mtlUrl) {
      const mtlRes = await fetchFn(options.mtlUrl);
      if (!mtlRes.ok) throw new Error(`${FETCH_NAME}: ${options.mtlUrl} → ${mtlRes.status}`);
      const mtlText = await mtlRes.text();
      const { colors, textures } = parseMtl(mtlText);
      // Resolve texture paths against the mtl's own URL so relative paths
      // like "wood.png" inside the mtl become absolute under the mtl's dir.
      const resolvedTextures: Record<string, string> = {};
      // URL is a global in both browsers and Node; cast to sidestep core's
      // ES2020-only lib config (no DOM types).
      const URLCtor = (globalThis as { URL?: new (url: string, base?: string) => { toString(): string } }).URL;
      for (const [name, path] of Object.entries(textures)) {
        if (URLCtor) {
          try {
            resolvedTextures[name] = new URLCtor(path, options.mtlUrl).toString();
            continue;
          } catch { /* fall through */ }
        }
        resolvedTextures[name] = path;
      }
      objOptions = {
        ...(objOptions ?? {}),
        materialColors: { ...colors, ...(objOptions?.materialColors ?? {}) },
        materialTextures: { ...resolvedTextures, ...(objOptions?.materialTextures ?? {}) },
      };
    }

    return parseObj(text, objOptions);
  }

  if (ext === "glb" || ext === "gltf") {
    const res = await fetchFn(url);
    if (!res.ok) throw new Error(`${FETCH_NAME}: ${url} → ${res.status}`);
    const buf = await res.arrayBuffer();
    return parseGltf(buf, { baseUrl, ...(options?.gltfOptions ?? {}) });
  }

  throw new Error(`${FETCH_NAME}: unsupported extension ".${ext}" (supported: obj, glb, gltf)`);
}
