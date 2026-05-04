import { useEffect, useState } from "react";
import { parseObj, parseMtl, parseGltf } from "@polycss/react";
import type {
  GltfParseOptions, Polygon, ObjParseOptions,
} from "@polycss/react";

export interface MeshModelState {
  voxels: Polygon[];
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
 * Fetch a .obj or .glb (with optional .mtl) and parse into polycss polygons.
 * Refetches when `url` / `mtlUrl` / format / options change.
 */
export function useObjModel(load: LoadOptions): MeshModelState {
  const [state, setState] = useState<MeshModelState>(EMPTY_STATE);

  useEffect(() => {
    let cancelled = false;
    let activeObjectUrls: string[] = [];
    setState({ voxels: [], loading: true, error: null });

    const run = async () => {
      try {
        if (load.format === "obj") {
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
          setState({ voxels: parsed.polygons, loading: false, error: null });
          return;
        }
        const buf = await fetch(load.url).then((r) => {
          if (!r.ok) throw new Error(`fetch ${load.url} → ${r.status}`);
          return r.arrayBuffer();
        });
        if (cancelled) return;
        const absUrl = new URL(load.url, window.location.href).href;
        const parsed = parseGltf(buf, { ...load.options, baseUrl: absUrl });
        activeObjectUrls = parsed.objectUrls;
        setState({ voxels: parsed.polygons, loading: false, error: null });
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        setState({ voxels: [], loading: false, error: msg });
      }
    };

    run();
    return () => {
      cancelled = true;
      for (const u of activeObjectUrls) URL.revokeObjectURL(u);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(load)]);

  return state;
}
