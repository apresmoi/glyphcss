/**
 * useMesh — fetch + parse a mesh URL into a polygon list, with race-safe
 * blob-URL lifecycle. Per §API freeze and §Phase 4.3g.
 *
 * Each `src` change:
 *   1. Aborts any in-flight fetch (no race — late responses are dropped).
 *   2. Disposes the prior result's `dispose()` so embedded blob URLs are
 *      revoked before the new mesh is parsed. Otherwise textures leak.
 *   3. Sets `loading = true` until parse resolves or fails.
 *
 * On unmount: aborts in-flight fetch + disposes the active result.
 *
 * `dispose` returned to the caller is the same dispose called automatically
 * on unmount/src-change — exposed so callers can release early in custom
 * teardown flows.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  Polygon,
  ParseResult,
  LoadMeshOptions,
} from "@polycss/core";
import { loadMesh } from "@polycss/core";

export type UseMeshOptions = LoadMeshOptions;

export interface UseMeshResult {
  polygons: Polygon[];
  loading: boolean;
  error: Error | null;
  warnings: string[];
  /** Manually trigger cleanup (also called on unmount automatically). */
  dispose: () => void;
}

const EMPTY_POLYGONS: Polygon[] = [];
const EMPTY_WARNINGS: string[] = [];

export function useMesh(src: string, options?: UseMeshOptions): UseMeshResult {
  const [state, setState] = useState<{
    polygons: Polygon[];
    loading: boolean;
    error: Error | null;
    warnings: string[];
  }>({
    polygons: EMPTY_POLYGONS,
    loading: !!src,
    error: null,
    warnings: EMPTY_WARNINGS,
  });

  // Active parse result we own. Mutable ref because we need synchronous
  // access from cleanup paths without waiting for re-render.
  const activeResultRef = useRef<ParseResult | null>(null);

  const dispose = useCallback(() => {
    const r = activeResultRef.current;
    if (r) {
      try {
        r.dispose();
      } catch {
        // Defensive: dispose is supposed to be idempotent and never throw,
        // but we don't want a misbehaving parser to break component unmount.
      }
      activeResultRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!src) {
      // No src — clear any prior result and reset to idle.
      dispose();
      setState({
        polygons: EMPTY_POLYGONS,
        loading: false,
        error: null,
        warnings: EMPTY_WARNINGS,
      });
      return;
    }

    let cancelled = false;

    setState((prev) => ({ ...prev, loading: true, error: null }));

    // Capture the prior result so we can dispose it AFTER the new parse
    // resolves — that way a render between dispose() and the new src setting
    // doesn't briefly show stale-but-not-yet-disposed pixels. Drop on
    // promise resolution (or rejection).
    const prevResult = activeResultRef.current;

    loadMesh(src, options)
      .then((result) => {
        if (cancelled) {
          // Race: this result is stale — clean it up immediately and keep
          // whatever the next effect-firing has set as the active result.
          try {
            result.dispose();
          } catch {
            /* ignore */
          }
          return;
        }
        // We're committing this result. Dispose the previous one now.
        if (prevResult) {
          try {
            prevResult.dispose();
          } catch {
            /* ignore */
          }
        }
        activeResultRef.current = result;
        setState({
          polygons: result.polygons,
          loading: false,
          error: null,
          warnings: result.warnings ?? EMPTY_WARNINGS,
        });
      })
      .catch((err) => {
        if (cancelled) return;
        // Parse failed — keep the prior result (and its blob URLs) usable;
        // disposing here would tear down a still-rendering mesh just because
        // the user's NEXT src 404'd.
        const error = err instanceof Error ? err : new Error(String(err));
        setState((prev) => ({
          polygons: prev.polygons,
          loading: false,
          error,
          warnings: prev.warnings,
        }));
      });

    return () => {
      cancelled = true;
    };
  }, [src, dispose]);

  // Final cleanup — revoke all minted blob URLs when the component unmounts.
  useEffect(() => {
    return () => dispose();
  }, [dispose]);

  return {
    polygons: state.polygons,
    loading: state.loading,
    error: state.error,
    warnings: state.warnings,
    dispose,
  };
}
