/**
 * usePolyAnimation — Vue 3 composable mirroring drei's `useAnimations`.
 *
 * Returns a `mixer`, `actions`, `clips`, `names`, and `ref`. The mixer is
 * built when `clips`, `controller`, and a root `PolyAnimationTarget` are all
 * available. Drives `mixer.update(dt)` via `requestAnimationFrame` using
 * `performance.now()` deltas (no three.js dependency).
 *
 * Accepts `MaybeRef` for all inputs so callers can pass either a plain value
 * or a reactive `Ref<>`.
 *
 * Lifecycle:
 *   - Mixer is rebuilt whenever `clips` or `controller` changes.
 *   - RAF loop starts with a valid mixer; stops on input change or unmount.
 *   - On unmount, all actions are stopped and the mixer cache is cleared.
 */
import {
  ref,
  watch,
  onUnmounted,
  computed,
} from "vue";
import type { Ref, ComputedRef, MaybeRef } from "vue";
import { createPolyAnimationMixer } from "@layoutit/polycss-core";
import type {
  PolyAnimationClip,
  PolyAnimationAction,
  PolyAnimationMixer,
  PolyAnimationTarget,
  ParseAnimationController,
} from "@layoutit/polycss-core";

export type { PolyAnimationClip, PolyAnimationAction, PolyAnimationMixer };

export interface UsePolyAnimationResultVue {
  /** Attach to a mesh handle when not passing `root` directly. */
  ref: Ref<PolyAnimationTarget | null>;
  /** The active mixer, or null if inputs are not ready yet. */
  mixer: ComputedRef<PolyAnimationMixer | null>;
  /** Resolved clip list. */
  clips: ComputedRef<PolyAnimationClip[]>;
  /** Clip names in input order. */
  names: ComputedRef<string[]>;
  /**
   * Lazy action proxy keyed by clip name. Accessing `actions.value["walk"]`
   * instantiates the action via the mixer. Returns null when mixer is null.
   */
  actions: ComputedRef<Record<string, PolyAnimationAction | null>>;
}

function unwrapRef<T>(v: MaybeRef<T>): T {
  return (v && typeof v === "object" && "value" in (v as object))
    ? (v as Ref<T>).value
    : (v as T);
}

export function usePolyAnimation(
  clips: MaybeRef<PolyAnimationClip[] | undefined>,
  controller: MaybeRef<ParseAnimationController | undefined>,
  root?: MaybeRef<PolyAnimationTarget | null | undefined>,
): UsePolyAnimationResultVue {
  // Internal ref: used as the root target when `root` is not passed.
  const internalRef = ref<PolyAnimationTarget | null>(null);

  // Plain mutable state (not reactive) — we don't want Vue to track mixer
  // internals. The mixerSignal ref is a reactive counter that we increment
  // to signal computed properties to re-evaluate.
  let _mixer: PolyAnimationMixer | null = null;
  let _rafId: number | null = null;
  let _lastTime: number | null = null;
  // Reactive signal: incremented whenever the mixer is replaced.
  const _mixerEpoch = ref(0);

  function resolveRoot(): PolyAnimationTarget | null {
    if (root == null) return internalRef.value;
    const r = unwrapRef(root);
    return r ?? internalRef.value;
  }

  function stopRaf(): void {
    if (_rafId !== null) {
      cancelAnimationFrame(_rafId);
      _rafId = null;
    }
    _lastTime = null;
  }

  function teardown(): void {
    stopRaf();
    if (_mixer) {
      _mixer.stopAllAction();
      _mixer.uncacheRoot();
      _mixer = null;
      _mixerEpoch.value++;
    }
  }

  function startLoop(): void {
    if (_rafId !== null) return;
    function tick(now: number): void {
      if (_lastTime === null) {
        _lastTime = now;
        _rafId = requestAnimationFrame(tick);
        return;
      }
      const dt = (now - _lastTime) / 1000;
      _lastTime = now;
      _mixer?.update(dt);
      _rafId = requestAnimationFrame(tick);
    }
    _rafId = requestAnimationFrame(tick);
  }

  function rebuild(): void {
    teardown();
    const resolvedClips = unwrapRef(clips);
    const resolvedCtrl = unwrapRef(controller);
    if (!resolvedClips || resolvedClips.length === 0 || !resolvedCtrl) return;
    const resolvedRoot = resolveRoot();
    if (!resolvedRoot) return;
    _mixer = createPolyAnimationMixer(resolvedRoot, resolvedCtrl);
    _mixerEpoch.value++;
    startLoop();
  }

  // Watch clips, controller, and root; rebuild mixer when any changes.
  // Including root ensures the mixer is built when a root ref resolves
  // after initial render (common pattern with template refs).
  const stopWatch = watch(
    () => {
      const c = unwrapRef(clips);
      const ctrl = unwrapRef(controller);
      const r = root != null ? unwrapRef(root) : internalRef.value;
      return { c, ctrl, r };
    },
    () => rebuild(),
    { immediate: true, deep: false },
  );

  onUnmounted(() => {
    stopWatch();
    teardown();
  });

  // ── Computed API ─────────────────────────────────────────────────────────

  const resolvedClipsComputed = computed<PolyAnimationClip[]>(() => {
    const c = unwrapRef(clips);
    return c ?? [];
  });

  const namesComputed = computed<string[]>(() =>
    resolvedClipsComputed.value.map((c) => c.name)
  );

  // `mixer` computed reads _mixerEpoch to invalidate when the mixer changes.
  const mixerComputed = computed<PolyAnimationMixer | null>(() => {
    void _mixerEpoch.value; // subscribe to epoch changes
    return _mixer;
  });

  const actionsComputed = computed<Record<string, PolyAnimationAction | null>>(() => {
    void _mixerEpoch.value; // subscribe to epoch changes
    const clips_ = resolvedClipsComputed.value;
    const result: Record<string, PolyAnimationAction | null> = {};
    for (const clip of clips_) {
      Object.defineProperty(result, clip.name, {
        enumerable: true,
        get() {
          if (!_mixer) return null;
          try {
            return _mixer.clipAction(clip.name);
          } catch {
            return null;
          }
        },
      });
    }
    return result;
  });

  return {
    ref: internalRef,
    mixer: mixerComputed,
    clips: resolvedClipsComputed,
    names: namesComputed,
    actions: actionsComputed,
  };
}
