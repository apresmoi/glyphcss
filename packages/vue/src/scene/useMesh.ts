/**
 * useMesh — Vue 3 composable. Fetches + parses a mesh URL into a polygon
 * list, with race-safe blob-URL lifecycle.
 *
 * Each `src` change:
 *   1. Cancels any in-flight fetch (the old promise resolve is silently dropped).
 *   2. Disposes the prior result's `dispose()` so embedded blob URLs are revoked.
 *   3. Sets `loading = true` until parse resolves or fails.
 *
 * On unmount: disposes the active result via `onUnmounted`.
 *
 * `dispose` returned to the caller is the same dispose called automatically
 * on unmount/src-change — exposed so callers can release early.
 */
import { ref, watch, onUnmounted } from "vue";
import type { Ref } from "vue";
import type {
  Polygon,
  ParseResult,
  LoadMeshOptions,
} from "@layoutit/polycss-core";
import { loadMesh } from "@layoutit/polycss-core";

export type UseMeshOptions = LoadMeshOptions;

export interface UseMeshResult {
  polygons: Ref<Polygon[]>;
  loading: Ref<boolean>;
  error: Ref<Error | null>;
  warnings: Ref<string[]>;
  /** Manually trigger cleanup (also called on unmount automatically). */
  dispose: () => void;
}

const EMPTY_POLYGONS: Polygon[] = [];
const EMPTY_WARNINGS: string[] = [];

export function usePolyMesh(src: Ref<string>, options?: UseMeshOptions): UseMeshResult {
  const polygons = ref<Polygon[]>(EMPTY_POLYGONS);
  const loading = ref<boolean>(!!src.value);
  const error = ref<Error | null>(null);
  const warnings = ref<string[]>(EMPTY_WARNINGS);

  // Active parse result we own. Plain mutable variable (not reactive) because
  // we need synchronous access from cleanup paths without a re-render cycle.
  let activeResult: ParseResult | null = null;

  function dispose(): void {
    if (activeResult) {
      try {
        activeResult.dispose();
      } catch {
        // Defensive: dispose is supposed to be idempotent and never throw.
      }
      activeResult = null;
    }
  }

  watch(
    src,
    (newSrc, _oldSrc, onCleanup) => {
      if (!newSrc) {
        // No src — clear any prior result and reset to idle.
        dispose();
        polygons.value = EMPTY_POLYGONS;
        loading.value = false;
        error.value = null;
        warnings.value = EMPTY_WARNINGS;
        return;
      }

      let cancelled = false;

      loading.value = true;
      error.value = null;

      // Keep hold of the previous result so we can dispose it AFTER the new
      // parse resolves — same pattern as React's useMesh.
      const prevResult = activeResult;

      loadMesh(newSrc, options)
        .then((result) => {
          if (cancelled) {
            // Race: stale result — clean it up immediately.
            try { result.dispose(); } catch { /* ignore */ }
            return;
          }
          // Dispose previous result now that we're committing the new one.
          if (prevResult) {
            try { prevResult.dispose(); } catch { /* ignore */ }
          }
          activeResult = result;
          polygons.value = result.polygons;
          loading.value = false;
          error.value = null;
          warnings.value = result.warnings ?? EMPTY_WARNINGS;
        })
        .catch((err) => {
          if (cancelled) return;
          const e = err instanceof Error ? err : new Error(String(err));
          // Keep the prior result usable if the new src fails.
          loading.value = false;
          error.value = e;
        });

      onCleanup(() => {
        cancelled = true;
      });
    },
    { immediate: true }
  );

  onUnmounted(() => {
    dispose();
  });

  return {
    polygons: polygons as Ref<Polygon[]>,
    loading,
    error,
    warnings: warnings as Ref<string[]>,
    dispose,
  };
}
