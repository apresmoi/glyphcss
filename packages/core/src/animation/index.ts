/**
 * GlyphcssAnimationMixer — three.js-shaped animation API for glyphcss.
 *
 * Mirrors three.js's AnimationMixer + AnimationAction surface closely enough
 * that users familiar with drei's `useAnimations` can migrate without friction.
 *
 * Loop mode constants match three.js numeric values exactly:
 *   LoopOnce = 2200, LoopRepeat = 2201, LoopPingPong = 2202
 */
import type { ParseAnimationClip, ParseAnimationController } from "../parser/types";
import type { Polygon } from "../types";

// ── Loop mode constants (match three.js) ────────────────────────────────────

export const LoopOnce = 2200 as const;
export const LoopRepeat = 2201 as const;
export const LoopPingPong = 2202 as const;

export type LoopMode = typeof LoopOnce | typeof LoopRepeat | typeof LoopPingPong;

// Re-export clip type under the Glyphcss-prefixed alias.
export type { ParseAnimationClip as GlyphcssAnimationClip };

/**
 * Minimal target interface the mixer requires. `GlyphcssMeshHandle` from both
 * the glyphcss vanilla API and the React/Vue frameworks satisfies this
 * structurally — no import needed.
 */
export interface GlyphcssAnimationTarget {
  setPolygons(polygons: Polygon[]): void;
}

/**
 * Per-clip playback action. Mirrors three.js `AnimationAction` method surface.
 * All mutating methods return `this` for chaining.
 */
export interface GlyphcssAnimationAction {
  /** Start playing (sets weight=1, resets time if not already playing). */
  play(): GlyphcssAnimationAction;
  /** Stop playing and reset time to 0. */
  stop(): GlyphcssAnimationAction;
  /** Reset time to 0 without stopping. */
  reset(): GlyphcssAnimationAction;
  /** Fade weight from 0 to 1 over `durationSeconds`. */
  fadeIn(durationSeconds: number): GlyphcssAnimationAction;
  /** Fade weight from current to 0 over `durationSeconds`. */
  fadeOut(durationSeconds: number): GlyphcssAnimationAction;
  /**
   * Cross-fade from this action to `target` over `durationSeconds`.
   * Fades this out and target in simultaneously.
   */
  crossFadeTo(target: GlyphcssAnimationAction, durationSeconds: number): GlyphcssAnimationAction;
  /**
   * Cross-fade from `from` into this action over `durationSeconds`.
   * Sugar for `from.fadeOut(d); this.fadeIn(d)`.
   */
  crossFadeFrom(from: GlyphcssAnimationAction, durationSeconds: number): GlyphcssAnimationAction;
  /** Set loop mode and repetition count. */
  setLoop(mode: LoopMode, repetitions: number): GlyphcssAnimationAction;
  /** Override the effective time scale. */
  setEffectiveTimeScale(scale: number): GlyphcssAnimationAction;
  /** Override the effective weight. */
  setEffectiveWeight(weight: number): GlyphcssAnimationAction;
  /** When true, the action freezes on the last frame after finishing. */
  clampWhenFinished: boolean;
  /** Playback speed multiplier. Default 1. */
  timeScale: number;
  /** Blend weight [0, 1]. Default 1. */
  weight: number;
  /** Current playback position in seconds. */
  time: number;
  /**
   * When false, the action contributes 0 weight to the blend even if
   * `weight > 0`. Time still advances. Default true.
   */
  enabled: boolean;
  /**
   * When true, time does NOT advance on `mixer.update()` but the action
   * remains active and contributes its current weight to the blend. Default false.
   */
  paused: boolean;
  /** Whether the action is currently playing. */
  readonly isRunning: boolean;
}

/**
 * Drives one or more `GlyphcssAnimationAction`s against a single mesh target.
 * Mirrors the three.js `AnimationMixer` API.
 */
export interface GlyphcssAnimationMixer {
  /**
   * Return the action for a clip (by index or name). Creates the action if it
   * doesn't exist yet (lazy instantiation, same as three.js).
   */
  clipAction(clip: number | string): GlyphcssAnimationAction;
  /**
   * Return an existing action without creating one. Returns null if the
   * action hasn't been instantiated yet.
   */
  existingAction(clip: number | string): GlyphcssAnimationAction | null;
  /**
   * Advance all active actions by `deltaSeconds` and apply the resulting
   * polygon frame to the root target. Call this once per animation frame.
   */
  update(deltaSeconds: number): void;
  /** Stop all active actions. */
  stopAllAction(): void;
  /** Remove a cached action for `clip`. */
  uncacheClip(clip: number | string): void;
  /** Remove all cached actions for this mixer's root. */
  uncacheRoot(): void;
}

// ── Implementation ───────────────────────────────────────────────────────────

interface FadeState {
  from: number;
  to: number;
  elapsed: number;
  duration: number;
}

function createAction(
  clip: ParseAnimationClip,
  controller: ParseAnimationController,
): GlyphcssAnimationAction {
  let _time = 0;
  let _weight = 1;
  let _timeScale = 1;
  let _loopMode: LoopMode = LoopRepeat;
  let _repetitions = Infinity;
  let _completedReps = 0;
  let _running = false;
  let _fade: FadeState | null = null;
  let _enabled = true;
  let _paused = false;

  const action: GlyphcssAnimationAction = {
    clampWhenFinished: false,

    get timeScale() { return _timeScale; },
    set timeScale(v) { _timeScale = v; },

    get weight() { return _weight; },
    set weight(v) { _weight = v; },

    get time() { return _time; },
    set time(v) { _time = v; },

    get isRunning() { return _running; },

    get enabled() { return _enabled; },
    set enabled(v) { _enabled = v; },

    get paused() { return _paused; },
    set paused(v) { _paused = v; },

    play() {
      _running = true;
      return action;
    },

    stop() {
      _running = false;
      _time = 0;
      _completedReps = 0;
      _fade = null;
      return action;
    },

    reset() {
      _time = 0;
      _completedReps = 0;
      return action;
    },

    fadeIn(durationSeconds: number) {
      _fade = { from: 0, to: 1, elapsed: 0, duration: durationSeconds };
      _weight = 0;
      return action;
    },

    fadeOut(durationSeconds: number) {
      _fade = { from: _weight, to: 0, elapsed: 0, duration: durationSeconds };
      return action;
    },

    crossFadeTo(target: GlyphcssAnimationAction, durationSeconds: number) {
      action.fadeOut(durationSeconds);
      target.fadeIn(durationSeconds);
      return action;
    },

    crossFadeFrom(from: GlyphcssAnimationAction, durationSeconds: number) {
      from.fadeOut(durationSeconds);
      action.fadeIn(durationSeconds);
      return action;
    },

    setLoop(mode: LoopMode, repetitions: number) {
      _loopMode = mode;
      _repetitions = repetitions;
      return action;
    },

    setEffectiveTimeScale(scale: number) {
      _timeScale = scale;
      return action;
    },

    setEffectiveWeight(weight: number) {
      _weight = weight;
      return action;
    },
  };

  // Expose internals for the mixer's update loop via a symbol-keyed extension.
  // Using a closure-captured object keeps the interface clean.
  (action as unknown as { _internal: ActionInternal })._internal = {
    get clip() { return clip; },
    get time() { return _time; },
    get weight() { return _weight; },
    get enabled() { return _enabled; },
    get paused() { return _paused; },
    get running() { return _running; },
    get loopMode() { return _loopMode; },
    get repetitions() { return _repetitions; },
    get completedReps() { return _completedReps; },
    set completedReps(v) { _completedReps = v; },
    get clampWhenFinished() { return action.clampWhenFinished; },
    get timeScale() { return _timeScale; },
    get fade() { return _fade; },
    advance(dt: number): void {
      if (!_running) return;

      // Advance fade (always happens even when paused, so fades complete)
      if (_fade) {
        _fade.elapsed += dt;
        const t = _fade.duration > 0 ? Math.min(_fade.elapsed / _fade.duration, 1) : 1;
        _weight = _fade.from + (_fade.to - _fade.from) * t;
        if (t >= 1) {
          _weight = _fade.to;
          _fade = null;
          if (_weight <= 0) {
            _running = false;
            return;
          }
        }
      }

      // When paused, time does not advance.
      if (_paused) return;

      // Advance time
      const duration = clip.duration;
      if (duration <= 0) return;

      _time += dt * _timeScale;

      if (_loopMode === LoopOnce) {
        if (_time >= duration) {
          _time = action.clampWhenFinished ? duration : 0;
          _running = false;
        }
      } else if (_loopMode === LoopRepeat) {
        if (_time >= duration) {
          const wrapped = _time % duration;
          const repsThisAdvance = Math.floor(_time / duration);
          _completedReps += repsThisAdvance;
          _time = wrapped;
          if (_repetitions !== Infinity && _completedReps >= _repetitions) {
            _time = action.clampWhenFinished ? duration : 0;
            _running = false;
          }
        }
      } else {
        // LoopPingPong
        if (duration > 0) {
          const cycle = duration * 2;
          const phase = _time % cycle;
          if (_time >= cycle) {
            const repsThisAdvance = Math.floor(_time / cycle);
            _completedReps += repsThisAdvance;
            if (_repetitions !== Infinity && _completedReps >= _repetitions) {
              _time = action.clampWhenFinished ? duration : 0;
              _running = false;
            } else {
              _time = phase;
            }
          }
        }
      }
    },
    sampleTime(): number {
      if (_loopMode === LoopPingPong) {
        const duration = clip.duration;
        const cycle = duration * 2;
        const phase = _time % cycle;
        return phase <= duration ? phase : cycle - phase;
      }
      return _time;
    },
  };

  return action;
}

interface ActionInternal {
  readonly clip: ParseAnimationClip;
  readonly time: number;
  readonly weight: number;
  readonly enabled: boolean;
  readonly paused: boolean;
  readonly running: boolean;
  readonly loopMode: LoopMode;
  readonly repetitions: number;
  completedReps: number;
  readonly clampWhenFinished: boolean;
  readonly timeScale: number;
  readonly fade: FadeState | null;
  advance(dt: number): void;
  sampleTime(): number;
}

function getInternal(action: GlyphcssAnimationAction): ActionInternal {
  return (action as unknown as { _internal: ActionInternal })._internal;
}

function resolveClip(
  clips: ParseAnimationClip[],
  key: number | string,
): ParseAnimationClip | undefined {
  if (typeof key === "number") return clips[key];
  return clips.find((c) => c.name === key);
}

export function createGlyphcssAnimationMixer(
  root: GlyphcssAnimationTarget,
  controller: ParseAnimationController,
): GlyphcssAnimationMixer {
  const actionCache = new Map<number, GlyphcssAnimationAction>();

  function clipAction(key: number | string): GlyphcssAnimationAction {
    const clip = resolveClip(controller.clips, key);
    if (!clip) {
      throw new Error(
        `GlyphcssAnimationMixer: no clip found for key "${key}". Available: ${controller.clips.map((c) => c.name).join(", ")}`,
      );
    }
    let action = actionCache.get(clip.index);
    if (!action) {
      action = createAction(clip, controller);
      actionCache.set(clip.index, action);
    }
    return action;
  }

  function existingAction(key: number | string): GlyphcssAnimationAction | null {
    const clip = resolveClip(controller.clips, key);
    if (!clip) return null;
    return actionCache.get(clip.index) ?? null;
  }

  function update(deltaSeconds: number): void {
    // Collect active actions, advance each, blend polygons, apply to root.
    const active: Array<{ internal: ActionInternal; clip: ParseAnimationClip }> = [];

    for (const action of actionCache.values()) {
      const internal = getInternal(action);
      internal.advance(deltaSeconds);
      if (internal.running && internal.enabled) {
        active.push({ internal, clip: internal.clip });
      }
    }

    if (active.length === 0) return;

    if (active.length === 1) {
      // Fast path: single active action — no blending needed.
      const { internal, clip } = active[0];
      const polygons = controller.sample(clip.name, internal.sampleTime());
      root.setPolygons(polygons);
      return;
    }

    // Multi-action: weight-blend polygon vertex positions.
    // Normalize weights so they sum to 1. If sum is 0, skip update.
    let totalWeight = 0;
    for (const { internal } of active) totalWeight += internal.weight;
    if (totalWeight <= 0) return;

    // Sample each clip and blend positions proportionally.
    // We use the first clip's polygon count as the reference topology.
    const frames = active.map(({ internal, clip }) => ({
      polygons: controller.sample(clip.name, internal.sampleTime()),
      weight: internal.weight / totalWeight,
    }));

    const refPolygons = frames[0].polygons;
    if (refPolygons.length === 0) return;

    // Build blended polygon array. For each polygon, blend each vertex
    // component using each frame's weight. Non-positional fields (color,
    // material, texture) are taken from the frame with the highest weight.
    const blended: Polygon[] = refPolygons.map((refPoly, pi) => {
      const blendedVertices = refPoly.vertices.map((refVert, vi) => {
        let x = 0, y = 0, z = 0;
        for (const { polygons, weight } of frames) {
          const poly = polygons[pi];
          if (!poly) continue;
          const vert = poly.vertices[vi];
          if (!vert) continue;
          x += vert[0] * weight;
          y += vert[1] * weight;
          z += vert[2] * weight;
        }
        return [x, y, z] as [number, number, number];
      });
      return { ...refPoly, vertices: blendedVertices };
    });

    root.setPolygons(blended);
  }

  function stopAllAction(): void {
    for (const action of actionCache.values()) {
      action.stop();
    }
  }

  function uncacheClip(key: number | string): void {
    const clip = resolveClip(controller.clips, key);
    if (clip) actionCache.delete(clip.index);
  }

  function uncacheRoot(): void {
    actionCache.clear();
  }

  return { clipAction, existingAction, update, stopAllAction, uncacheClip, uncacheRoot };
}
