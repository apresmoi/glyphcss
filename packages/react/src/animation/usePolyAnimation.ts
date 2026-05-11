/**
 * usePolyAnimation — React hook mirroring drei's `useAnimations`.
 *
 * Returns a `mixer`, `actions` record (lazy-instantiated per clip name),
 * `clips`, `names`, and `ref`. The `ref` can be attached to any imperative
 * handle that implements `PolyAnimationTarget` (i.e. exposes `setPolygons`).
 *
 * Drives `mixer.update(dt)` via `requestAnimationFrame`, computing dt from
 * `performance.now()` deltas (no three.js dependency).
 *
 * Lifecycle:
 *   - Mixer is created when `clips`, `controller`, and a root target are
 *     all available (resolved from `root` param or `internalRef`).
 *   - RAF loop starts when the mixer is built; stops on unmount or when
 *     `clips`/`controller` change and tear down the previous mixer.
 *   - Changing `clips` or `controller` tears down the old mixer and builds
 *     a new one.
 */
import { useEffect, useRef, useMemo } from "react";
import type { RefObject } from "react";
import { createPolyAnimationMixer } from "@layoutit/polycss-core";
import type {
  PolyAnimationClip,
  PolyAnimationAction,
  PolyAnimationMixer,
  PolyAnimationTarget,
  ParseAnimationController,
} from "@layoutit/polycss-core";

export type { PolyAnimationClip, PolyAnimationAction, PolyAnimationMixer };

export interface UsePolyAnimationResult {
  /** Attach to a `PolyAnimationTarget`-compatible handle when not using `root`. */
  ref: RefObject<PolyAnimationTarget | null>;
  /** The active mixer, or null if inputs are not ready yet. */
  mixer: PolyAnimationMixer | null;
  /** Resolved clip list (empty when `clips` is undefined). */
  clips: PolyAnimationClip[];
  /** Clip names in input order. */
  names: string[];
  /**
   * Lazy action proxy keyed by clip name. Accessing `actions["walk"]`
   * instantiates the action if it does not exist yet. Returns null when the
   * mixer is not ready.
   */
  actions: Record<string, PolyAnimationAction | null>;
}

function resolveRoot(
  rootArg: RefObject<PolyAnimationTarget | null> | PolyAnimationTarget | null | undefined,
): PolyAnimationTarget | null {
  if (!rootArg) return null;
  if ("current" in rootArg) return rootArg.current;
  return rootArg;
}

export function usePolyAnimation(
  clips: PolyAnimationClip[] | undefined,
  controller: ParseAnimationController | undefined,
  root?: RefObject<PolyAnimationTarget | null> | PolyAnimationTarget | null,
): UsePolyAnimationResult {
  // Internal ref — users can attach this to any PolyAnimationTarget-compatible
  // handle when they don't pass `root` explicitly.
  const internalRef = useRef<PolyAnimationTarget | null>(null);

  // Stable ref to the live mixer. Updated synchronously inside effects.
  const mixerRef = useRef<PolyAnimationMixer | null>(null);

  // Build (and tear down) the mixer whenever clips or controller change.
  useEffect(() => {
    if (!clips || clips.length === 0 || !controller) {
      mixerRef.current = null;
      return;
    }
    const resolvedRoot = resolveRoot(root) ?? internalRef.current;
    if (!resolvedRoot) {
      mixerRef.current = null;
      return;
    }
    mixerRef.current = createPolyAnimationMixer(resolvedRoot, controller);
    return () => {
      mixerRef.current?.stopAllAction();
      mixerRef.current?.uncacheRoot();
      mixerRef.current = null;
    };
    // `root` is intentionally excluded: changing only the target reference
    // doesn't rebuild the mixer. Users change `clips` or `controller` to
    // trigger a rebuild.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clips, controller]);

  // RAF loop — drives mixer.update(dt) each animation frame.
  useEffect(() => {
    if (!clips || clips.length === 0 || !controller) return;

    let rafId: number;
    let lastTime: number | null = null;

    function tick(now: number) {
      if (lastTime === null) {
        lastTime = now;
        rafId = requestAnimationFrame(tick);
        return;
      }
      const dt = (now - lastTime) / 1000;
      lastTime = now;
      mixerRef.current?.update(dt);
      rafId = requestAnimationFrame(tick);
    }

    rafId = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(rafId);
      lastTime = null;
    };
  }, [clips, controller]);

  const resolvedClips = clips ?? [];
  const resolvedNames = resolvedClips.map((c) => c.name);

  // Lazy actions proxy: accessing actions[name] instantiates via clipAction.
  const actions = useMemo<Record<string, PolyAnimationAction | null>>(() => {
    const target: Record<string, PolyAnimationAction | null> = {};
    for (const clip of resolvedClips) {
      Object.defineProperty(target, clip.name, {
        enumerable: true,
        get() {
          const m = mixerRef.current;
          if (!m) return null;
          try {
            return m.clipAction(clip.name);
          } catch {
            return null;
          }
        },
      });
    }
    return target;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedClips]);

  return {
    ref: internalRef,
    mixer: mixerRef.current,
    clips: resolvedClips,
    names: resolvedNames,
    actions,
  };
}
