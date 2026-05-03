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
  format: "glb";
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
          const mtlColors = mtlText ? parseMtl(mtlText) : {};
          const opts: ObjParseOptions = {
            ...load.options,
            materialColors: { ...mtlColors, ...load.options?.materialColors },
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
        const parsed = parseGltf(buf, load.options);
        setState({ voxels: parsed.voxels, loading: false, error: null });
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        setState({ voxels: [], loading: false, error: msg });
      }
    };

    run();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(load)]);

  return state;
}
