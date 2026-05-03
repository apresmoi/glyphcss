import { useEffect, useState } from "react";
import { parseObj, parseMtl, parseGltf } from "@layoutit/voxcss";
import type {
  GltfParseOptions, InputVoxel, ObjParseOptions,
} from "@layoutit/voxcss";

export interface MeshModelState {
  voxels: InputVoxel[];
  loading: boolean;
  error: string | null;
}

const EMPTY_STATE: MeshModelState = { voxels: [], loading: true, error: null };

interface ObjOptions {
  format: "obj";
  url: string;
  /** Optional companion .mtl URL — colors merge into parseObj.materialColors. */
  mtlUrl?: string;
  options?: ObjParseOptions;
}
interface GltfOptions {
  /** Both `.glb` (binary) and `.gltf` (JSON, possibly with embedded data:
   * URI buffer) are handled by the same path — parseGltf dispatches on
   * the file's first 4 bytes. */
  format: "glb" | "gltf";
  url: string;
  options?: GltfParseOptions;
}
type LoadOptions = ObjOptions | GltfOptions;

/**
 * Fetch a .obj or .glb (with optional .mtl) and parse into voxcss triangle
 * voxels. Refetches when `url` / `mtlUrl` / format / options change.
 *
 * The options object is JSON-stringified into the dep list so callers don't
 * need to memoize — small enough for the kinds of options we pass.
 */
export function useObjModel(load: LoadOptions): MeshModelState {
  const [state, setState] = useState<MeshModelState>(EMPTY_STATE);

  useEffect(() => {
    let cancelled = false;
    // Track blob URLs minted by parseGltf for embedded textures so we can
    // revoke them on unmount / re-fetch. parseObj has no such artifacts.
    let activeObjectUrls: string[] = [];
    setState({ voxels: [], loading: true, error: null });

    const run = async () => {
      try {
        if (load.format === "obj") {
          // .obj is text. If a sibling .mtl is provided, fetch it too and
          // merge its name → color map into the parseObj options. The .mtl
          // takes precedence over hex-name auto-detection (so an explicit
          // Kd in the .mtl overrides the name-as-hex fallback).
          const [objText, mtlText] = await Promise.all([
            fetch(load.url).then((r) => {
              if (!r.ok) throw new Error(`fetch ${load.url} → ${r.status}`);
              return r.text();
            }),
            load.mtlUrl
              ? fetch(load.mtlUrl).then((r) => (r.ok ? r.text() : null))
              : Promise.resolve(null),
          ]);
          if (cancelled) return;
          const mtl = mtlText ? parseMtl(mtlText) : { colors: {}, textures: {} };
          // map_Kd paths in .mtl are relative to the .mtl file. Resolve them
          // against the .mtl URL so the browser can fetch the image. Absolute
          // URLs (http://…) and root-absolute paths (/…) pass through.
          const resolvedTextures: Record<string, string> = {};
          for (const [name, path] of Object.entries(mtl.textures)) {
            resolvedTextures[name] = load.mtlUrl ? new URL(path, new URL(load.mtlUrl, window.location.href)).href : path;
          }
          const opts: ObjParseOptions = {
            ...load.options,
            materialColors: { ...mtl.colors, ...load.options?.materialColors },
            materialTextures: { ...resolvedTextures, ...load.options?.materialTextures },
          };
          const parsed = parseObj(objText, opts);
          setState({ voxels: parsed.voxels, loading: false, error: null });
          return;
        }
        // .glb is binary.
        const buf = await fetch(load.url).then((r) => {
          if (!r.ok) throw new Error(`fetch ${load.url} → ${r.status}`);
          return r.arrayBuffer();
        });
        if (cancelled) return;
        // Resolve external image URIs against the file's URL — Kenney-style
        // GLBs reference `Textures/colormap.png` relative to the glb itself.
        const absUrl = new URL(load.url, window.location.href).href;
        const parsed = parseGltf(buf, { ...load.options, baseUrl: absUrl });
        activeObjectUrls = parsed.objectUrls;
        setState({ voxels: parsed.voxels, loading: false, error: null });
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        setState({ voxels: [], loading: false, error: msg });
      }
    };

    run();
    return () => {
      cancelled = true;
      // Revoke any GLB-embedded image blob URLs the previous parse created.
      for (const u of activeObjectUrls) URL.revokeObjectURL(u);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(load)]);

  return state;
}
