/**
 * loadMesh — high-level fetch+parse dispatcher. Picks the parser by file
 * extension, fetches the URL, runs the parser, returns the unified
 * `ParseResult`.
 *
 * Supported:
 *   - `.obj`  → text fetch + `parseObj`
 *   - `.glb`  → ArrayBuffer fetch + `parseGltf`
 *   - `.gltf` → ArrayBuffer fetch + `parseGltf` (caller may pass `baseUrl`)
 *   - `.vox`  → ArrayBuffer fetch + `parseVox`
 *
 * `.mtl` is rejected — it's a material file, not a mesh. Use `parseMtl`
 * directly if you want to read materials.
 *
 * Other extensions throw. Future formats (STL, PLY) plug in here.
 */
import type { ParseResult } from "./types";
import type { ObjParseOptions } from "./parseObj";
import type { GltfParseOptions } from "./parseGltf";
import type { VoxParseOptions } from "./parseVox";
import { parseObj } from "./parseObj";
import { parseGltf } from "./parseGltf";
import { parseMtl } from "./parseMtl";
import { parseVox } from "./parseVox";
import { bakeSolidTextureSamples, type SolidTextureSampleOptions } from "./solidTextureSamples";
import { mergePolygons } from "../merge/mergePolygons";
import { cullInteriorPolygons } from "../cull/cullInteriorPolygons";

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
  /** Forwarded to `parseVox`. */
  voxOptions?: VoxParseOptions;
  /**
   * Converts texture-backed faces whose UV samples are a uniform color into
   * solid-color polygons before culling/merging. This avoids atlas sprites for
   * low-poly models that use texture atlases as color swatches.
   */
  solidTextureSamples?: boolean | SolidTextureSampleOptions;
}

const FETCH_NAME = "loadMesh";

/**
 * Wrap a ParseResult, replacing its polygon list with the post-processed
 * version: first cull polygons that are fully interior (never visible from
 * any external camera direction — saves cascade walk on hidden geometry),
 * then merge coplanar same-color triangles into n-gons (reduces N further
 * for the cascade walk). Both passes run once at parse time so every
 * downstream consumer (vanilla createPolyScene, React/Vue Poly children,
 * custom renderers) benefits without per-frame cost.
 *
 * Order matters: interior cull runs FIRST so it sees the original triangle
 * topology (with crisp inside/outside boundaries via Möller-Trumbore on
 * triangles). mergePolygons then collapses what's left.
 */
function withMergedPolygons(result: ParseResult): ParseResult {
  const surface = cullInteriorPolygons(result.polygons);
  const merged = mergePolygons(surface);
  if (merged.length === result.polygons.length) return result; // nothing changed
  return { ...result, polygons: merged };
}

async function withSolidTextureSamples(result: ParseResult, options?: LoadMeshOptions): Promise<ParseResult> {
  const setting = options?.solidTextureSamples;
  if (setting === false) return result;
  return bakeSolidTextureSamples(
    result,
    typeof setting === "object" ? setting : undefined,
  );
}

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
      // ES2020-only lib config (no DOM types). The URL constructor requires
      // an ABSOLUTE base — a path like "/gallery/obj/cottage.mtl" throws.
      // Anchor against document.baseURI in browsers (or strip the directory
      // portion manually) so a relative `map_Kd cottage.png` reads as
      // sibling-of-mtl, not sibling-of-current-page.
      const URLCtor = (globalThis as {
        URL?: new (url: string, base?: string) => { toString(): string };
      }).URL;
      const docBase = (globalThis as { document?: { baseURI?: string } }).document?.baseURI;
      let absMtlUrl = options.mtlUrl;
      if (URLCtor && docBase) {
        try {
          absMtlUrl = new URLCtor(options.mtlUrl, docBase).toString();
        } catch { /* keep raw */ }
      }
      for (const [name, path] of Object.entries(textures)) {
        if (URLCtor) {
          try {
            resolvedTextures[name] = new URLCtor(path, absMtlUrl).toString();
            continue;
          } catch { /* fall through */ }
        }
        // No URL constructor or both bases failed — manual sibling resolution.
        const slash = options.mtlUrl.lastIndexOf("/");
        const dir = slash >= 0 ? options.mtlUrl.slice(0, slash + 1) : "";
        resolvedTextures[name] = path.startsWith("/") || /^https?:\/\//.test(path)
          ? path
          : dir + path;
      }
      objOptions = {
        ...(objOptions ?? {}),
        materialColors: { ...colors, ...(objOptions?.materialColors ?? {}) },
        materialTextures: { ...resolvedTextures, ...(objOptions?.materialTextures ?? {}) },
      };
    }

    const parsed = parseObj(text, objOptions);
    return withMergedPolygons(await withSolidTextureSamples(parsed, options));
  }

  if (ext === "glb" || ext === "gltf") {
    const res = await fetchFn(url);
    if (!res.ok) throw new Error(`${FETCH_NAME}: ${url} → ${res.status}`);
    const buf = await res.arrayBuffer();
    const parsed = parseGltf(buf, { baseUrl, ...(options?.gltfOptions ?? {}) });
    return withMergedPolygons(await withSolidTextureSamples(parsed, options));
  }

  if (ext === "vox") {
    const res = await fetchFn(url);
    if (!res.ok) throw new Error(`${FETCH_NAME}: ${url} → ${res.status}`);
    const buf = await res.arrayBuffer();
    return withMergedPolygons(parseVox(buf, options?.voxOptions));
  }

  throw new Error(`${FETCH_NAME}: unsupported extension ".${ext}" (supported: obj, glb, gltf, vox)`);
}
