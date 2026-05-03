import { useEffect, useState } from "react";
import { parseObj } from "@layoutit/voxcss";
import type { ObjParseOptions } from "@layoutit/voxcss";
import type { Voxel } from "@layoutit/voxcss/react";

export interface ObjModelState {
  voxels: Voxel[];
  loading: boolean;
  error: string | null;
}

const EMPTY_STATE: ObjModelState = { voxels: [], loading: true, error: null };

/**
 * Fetch an `.obj` file from `/public` and parse it into voxcss triangle
 * voxels via `parseObj`. Reruns when `url` or any option changes.
 *
 * The hook key for the options object should be stable across renders —
 * either define it outside the component or memoize.
 */
export function useObjModel(url: string, options?: ObjParseOptions): ObjModelState {
  const [state, setState] = useState<ObjModelState>(EMPTY_STATE);

  useEffect(() => {
    let cancelled = false;
    setState({ voxels: [], loading: true, error: null });
    fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`fetch ${url} → ${r.status}`);
        return r.text();
      })
      .then((text) => {
        if (cancelled) return;
        const parsed = parseObj(text, options);
        setState({ voxels: parsed.voxels, loading: false, error: null });
      })
      .catch((err) => {
        if (cancelled) return;
        setState({ voxels: [], loading: false, error: String(err.message ?? err) });
      });
    return () => { cancelled = true; };
    // The options object is stringified in the dep list so callers don't
    // need to memoize — small/cheap for the kinds of options we pass.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, JSON.stringify(options ?? null)]);

  return state;
}
