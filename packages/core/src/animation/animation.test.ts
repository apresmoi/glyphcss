import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createGlyphcssAnimationMixer,
  LoopOnce,
  LoopRepeat,
  LoopPingPong,
} from "./index";
import type {
  GlyphcssAnimationTarget,
  GlyphcssAnimationAction,
} from "./index";
import type { ParseAnimationController, ParseAnimationClip } from "../parser/types";
import type { Polygon } from "../types";

// ── Test helpers ─────────────────────────────────────────────────────────────

const TRI_A: Polygon = { vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]], color: "#f00" };
const TRI_B: Polygon = { vertices: [[0, 0, 1], [1, 0, 1], [0, 1, 1]], color: "#f00" };

function makeClip(index: number, name: string, duration = 1): ParseAnimationClip {
  return { index, name, duration, channelCount: 1 };
}

function makeController(
  clips: ParseAnimationClip[],
  sampleFn?: (clip: number | string, t: number) => Polygon[],
): ParseAnimationController {
  return {
    clips,
    sample: sampleFn ?? ((_clip, _t) => [TRI_A]),
  };
}

function makeTarget(): GlyphcssAnimationTarget & { calls: Polygon[][] } {
  const calls: Polygon[][] = [];
  return {
    calls,
    setPolygons(polys) { calls.push(polys); },
  };
}

// ── Loop constants ────────────────────────────────────────────────────────────

describe("loop mode constants", () => {
  it("LoopOnce is 2200", () => expect(LoopOnce).toBe(2200));
  it("LoopRepeat is 2201", () => expect(LoopRepeat).toBe(2201));
  it("LoopPingPong is 2202", () => expect(LoopPingPong).toBe(2202));
});

// ── createGlyphcssAnimationMixer basic lifecycle ──────────────────────────────────

describe("createGlyphcssAnimationMixer", () => {
  it("returns mixer with expected methods", () => {
    const ctrl = makeController([makeClip(0, "run")]);
    const target = makeTarget();
    const mixer = createGlyphcssAnimationMixer(target, ctrl);
    expect(typeof mixer.clipAction).toBe("function");
    expect(typeof mixer.existingAction).toBe("function");
    expect(typeof mixer.update).toBe("function");
    expect(typeof mixer.stopAllAction).toBe("function");
    expect(typeof mixer.uncacheClip).toBe("function");
    expect(typeof mixer.uncacheRoot).toBe("function");
  });

  it("clipAction by name returns an action", () => {
    const ctrl = makeController([makeClip(0, "run")]);
    const mixer = createGlyphcssAnimationMixer(makeTarget(), ctrl);
    const action = mixer.clipAction("run");
    expect(action).toBeDefined();
  });

  it("clipAction by index returns the same instance as by name", () => {
    const ctrl = makeController([makeClip(0, "run")]);
    const mixer = createGlyphcssAnimationMixer(makeTarget(), ctrl);
    const byName = mixer.clipAction("run");
    const byIndex = mixer.clipAction(0);
    expect(byName).toBe(byIndex);
  });

  it("existingAction returns null before clip is instantiated", () => {
    const ctrl = makeController([makeClip(0, "run")]);
    const mixer = createGlyphcssAnimationMixer(makeTarget(), ctrl);
    expect(mixer.existingAction("run")).toBeNull();
  });

  it("existingAction returns the action after clipAction is called", () => {
    const ctrl = makeController([makeClip(0, "run")]);
    const mixer = createGlyphcssAnimationMixer(makeTarget(), ctrl);
    const action = mixer.clipAction("run");
    expect(mixer.existingAction("run")).toBe(action);
  });

  it("clipAction throws for unknown clip name", () => {
    const ctrl = makeController([makeClip(0, "run")]);
    const mixer = createGlyphcssAnimationMixer(makeTarget(), ctrl);
    expect(() => mixer.clipAction("nonexistent")).toThrow();
  });
});

// ── Action lifecycle ──────────────────────────────────────────────────────────

describe("GlyphcssAnimationAction lifecycle", () => {
  it("is not running after creation", () => {
    const ctrl = makeController([makeClip(0, "run")]);
    const mixer = createGlyphcssAnimationMixer(makeTarget(), ctrl);
    const action = mixer.clipAction("run");
    expect(action.isRunning).toBe(false);
  });

  it("play() sets isRunning = true", () => {
    const ctrl = makeController([makeClip(0, "run")]);
    const mixer = createGlyphcssAnimationMixer(makeTarget(), ctrl);
    const action = mixer.clipAction("run");
    action.play();
    expect(action.isRunning).toBe(true);
  });

  it("stop() resets time to 0 and sets isRunning = false", () => {
    const ctrl = makeController([makeClip(0, "run")]);
    const mixer = createGlyphcssAnimationMixer(makeTarget(), ctrl);
    const action = mixer.clipAction("run");
    action.play();
    action.time = 0.5;
    action.stop();
    expect(action.isRunning).toBe(false);
    expect(action.time).toBe(0);
  });

  it("reset() sets time to 0 without stopping", () => {
    const ctrl = makeController([makeClip(0, "run")]);
    const mixer = createGlyphcssAnimationMixer(makeTarget(), ctrl);
    const action = mixer.clipAction("run");
    action.play();
    action.time = 0.5;
    action.reset();
    expect(action.isRunning).toBe(true);
    expect(action.time).toBe(0);
  });

  it("play() returns `this` for chaining", () => {
    const ctrl = makeController([makeClip(0, "run")]);
    const mixer = createGlyphcssAnimationMixer(makeTarget(), ctrl);
    const action = mixer.clipAction("run");
    expect(action.play()).toBe(action);
  });

  it("stop() returns `this` for chaining", () => {
    const ctrl = makeController([makeClip(0, "run")]);
    const mixer = createGlyphcssAnimationMixer(makeTarget(), ctrl);
    const action = mixer.clipAction("run");
    expect(action.stop()).toBe(action);
  });
});

// ── update() → polygons applied ──────────────────────────────────────────────

describe("mixer.update() applies polygons", () => {
  it("does not call setPolygons when no actions are running", () => {
    const ctrl = makeController([makeClip(0, "run")]);
    const target = makeTarget();
    const mixer = createGlyphcssAnimationMixer(target, ctrl);
    mixer.clipAction("run"); // instantiate but don't play
    mixer.update(0.1);
    expect(target.calls.length).toBe(0);
  });

  it("calls setPolygons when an action is playing", () => {
    const ctrl = makeController([makeClip(0, "run")]);
    const target = makeTarget();
    const mixer = createGlyphcssAnimationMixer(target, ctrl);
    mixer.clipAction("run").play();
    mixer.update(0.1);
    expect(target.calls.length).toBe(1);
  });

  it("passes the sampled polygons to setPolygons", () => {
    const sampled: Polygon[] = [TRI_A];
    const ctrl = makeController([makeClip(0, "run")], () => sampled);
    const target = makeTarget();
    const mixer = createGlyphcssAnimationMixer(target, ctrl);
    mixer.clipAction("run").play();
    mixer.update(0.1);
    expect(target.calls[0]).toBe(sampled);
  });

  it("advances time with update()", () => {
    const ctrl = makeController([makeClip(0, "run", 2)]);
    const target = makeTarget();
    const mixer = createGlyphcssAnimationMixer(target, ctrl);
    const action = mixer.clipAction("run");
    action.play();
    mixer.update(0.5);
    expect(action.time).toBeCloseTo(0.5);
    mixer.update(0.3);
    expect(action.time).toBeCloseTo(0.8);
  });

  it("passes correct sample time to controller.sample", () => {
    const sampleTimes: number[] = [];
    const clip = makeClip(0, "run", 2);
    const ctrl: ParseAnimationController = {
      clips: [clip],
      sample: (_name, t) => {
        sampleTimes.push(t);
        return [TRI_A];
      },
    };
    const mixer = createGlyphcssAnimationMixer(makeTarget(), ctrl);
    mixer.clipAction("run").play();
    mixer.update(0.4);
    expect(sampleTimes[0]).toBeCloseTo(0.4);
  });
});

// ── LoopOnce ──────────────────────────────────────────────────────────────────

describe("LoopOnce", () => {
  it("stops after one full duration", () => {
    const ctrl = makeController([makeClip(0, "run", 1)]);
    const target = makeTarget();
    const mixer = createGlyphcssAnimationMixer(target, ctrl);
    const action = mixer.clipAction("run");
    action.setLoop(LoopOnce, 1).play();
    mixer.update(1.1);
    expect(action.isRunning).toBe(false);
  });

  it("clamps time to duration when clampWhenFinished is true", () => {
    const ctrl = makeController([makeClip(0, "run", 1)]);
    const mixer = createGlyphcssAnimationMixer(makeTarget(), ctrl);
    const action = mixer.clipAction("run");
    action.setLoop(LoopOnce, 1);
    action.clampWhenFinished = true;
    action.play();
    mixer.update(1.5);
    expect(action.time).toBe(1);
    expect(action.isRunning).toBe(false);
  });

  it("resets time to 0 when clampWhenFinished is false", () => {
    const ctrl = makeController([makeClip(0, "run", 1)]);
    const mixer = createGlyphcssAnimationMixer(makeTarget(), ctrl);
    const action = mixer.clipAction("run");
    action.setLoop(LoopOnce, 1);
    action.clampWhenFinished = false;
    action.play();
    mixer.update(1.5);
    expect(action.time).toBe(0);
    expect(action.isRunning).toBe(false);
  });

  it("does not loop past the end", () => {
    const ctrl = makeController([makeClip(0, "run", 1)]);
    const target = makeTarget();
    const mixer = createGlyphcssAnimationMixer(target, ctrl);
    const action = mixer.clipAction("run");
    action.setLoop(LoopOnce, 1).play();
    mixer.update(0.9);
    expect(action.isRunning).toBe(true);
    mixer.update(0.2);
    expect(action.isRunning).toBe(false);
  });
});

// ── LoopRepeat ────────────────────────────────────────────────────────────────

describe("LoopRepeat", () => {
  it("wraps time modulo duration", () => {
    const ctrl = makeController([makeClip(0, "run", 1)]);
    const mixer = createGlyphcssAnimationMixer(makeTarget(), ctrl);
    const action = mixer.clipAction("run");
    action.setLoop(LoopRepeat, Infinity).play();
    mixer.update(1.7);
    expect(action.time).toBeCloseTo(0.7);
  });

  it("keeps running after one full cycle", () => {
    const ctrl = makeController([makeClip(0, "run", 1)]);
    const mixer = createGlyphcssAnimationMixer(makeTarget(), ctrl);
    const action = mixer.clipAction("run");
    action.setLoop(LoopRepeat, Infinity).play();
    mixer.update(2.5);
    expect(action.isRunning).toBe(true);
  });

  it("stops after exhausting repetitions", () => {
    const ctrl = makeController([makeClip(0, "run", 1)]);
    const mixer = createGlyphcssAnimationMixer(makeTarget(), ctrl);
    const action = mixer.clipAction("run");
    action.setLoop(LoopRepeat, 2).play();
    mixer.update(2.5); // 2 full reps + 0.5
    expect(action.isRunning).toBe(false);
  });
});

// ── LoopPingPong ──────────────────────────────────────────────────────────────

describe("LoopPingPong", () => {
  it("time goes forward then backward", () => {
    const ctrl = makeController([makeClip(0, "run", 1)]);
    const mixer = createGlyphcssAnimationMixer(makeTarget(), ctrl);
    const action = mixer.clipAction("run");
    action.setLoop(LoopPingPong, Infinity).play();

    // At t=0.7, still in forward phase → sample at 0.7
    mixer.update(0.7);
    expect(action.time).toBeCloseTo(0.7);

    // Advance past the turn-around (total 1.5 → 0.5 into reverse)
    // After full update: time is in range [0,1], internal phase maps to 0.5
    const target = makeTarget();
    const mixer2 = createGlyphcssAnimationMixer(target, ctrl);
    const action2 = mixer2.clipAction("run");
    action2.setLoop(LoopPingPong, Infinity).play();
    mixer2.update(1.3);
    // After 1.3s: phase in cycle(2s) = 1.3 → reverse → sampleTime = 2 - 1.3 = 0.7
    expect(target.calls.length).toBeGreaterThan(0);
    expect(action2.isRunning).toBe(true);
  });

  it("sample time at 1.5s on a 1s clip is 0.5", () => {
    const sampleTimes: number[] = [];
    const clip = makeClip(0, "run", 1);
    const ctrl: ParseAnimationController = {
      clips: [clip],
      sample: (_name, t) => {
        sampleTimes.push(t);
        return [TRI_A];
      },
    };
    const mixer = createGlyphcssAnimationMixer(makeTarget(), ctrl);
    const action = mixer.clipAction("run");
    action.setLoop(LoopPingPong, Infinity).play();
    mixer.update(1.5);
    // cycle = 2, phase = 1.5, 1.5 > 1 → sampleTime = 2 - 1.5 = 0.5
    expect(sampleTimes[0]).toBeCloseTo(0.5);
  });

  it("sample time goes forward to 1.0 then backward toward 0.7 over two updates", () => {
    const sampleTimes: number[] = [];
    const clip = makeClip(0, "run", 1);
    const ctrl: ParseAnimationController = {
      clips: [clip],
      sample: (_name, t) => {
        sampleTimes.push(t);
        return [TRI_A];
      },
    };
    const mixer = createGlyphcssAnimationMixer(makeTarget(), ctrl);
    const action = mixer.clipAction("run");
    action.setLoop(LoopPingPong, Infinity).play();

    // After 1.0s: phase = 1.0, sampleTime = 1.0 (at the peak)
    mixer.update(1.0);
    expect(sampleTimes[0]).toBeCloseTo(1.0);

    // After 0.3s more (total 1.3s): phase = 1.3, sampleTime = 2 - 1.3 = 0.7
    mixer.update(0.3);
    expect(sampleTimes[1]).toBeCloseTo(0.7);

    expect(action.isRunning).toBe(true);
  });
});

// ── setEffectiveTimeScale ─────────────────────────────────────────────────────

describe("setEffectiveTimeScale", () => {
  it("returns this for chaining", () => {
    const ctrl = makeController([makeClip(0, "run")]);
    const mixer = createGlyphcssAnimationMixer(makeTarget(), ctrl);
    const action = mixer.clipAction("run");
    expect(action.setEffectiveTimeScale(2)).toBe(action);
  });

  it("half speed: time advances at half rate", () => {
    const ctrl = makeController([makeClip(0, "run", 10)]);
    const mixer = createGlyphcssAnimationMixer(makeTarget(), ctrl);
    const action = mixer.clipAction("run");
    action.setEffectiveTimeScale(0.5).play();
    mixer.update(1);
    expect(action.time).toBeCloseTo(0.5);
  });

  it("double speed: time advances at double rate", () => {
    const ctrl = makeController([makeClip(0, "run", 10)]);
    const mixer = createGlyphcssAnimationMixer(makeTarget(), ctrl);
    const action = mixer.clipAction("run");
    action.setEffectiveTimeScale(2).play();
    mixer.update(1);
    expect(action.time).toBeCloseTo(2);
  });
});

// ── fadeIn / fadeOut ──────────────────────────────────────────────────────────

describe("fadeIn / fadeOut", () => {
  it("fadeIn transitions weight from 0 to 1", () => {
    const ctrl = makeController([makeClip(0, "run", 10)]);
    const mixer = createGlyphcssAnimationMixer(makeTarget(), ctrl);
    const action = mixer.clipAction("run");
    action.fadeIn(1).play();
    expect(action.weight).toBeCloseTo(0);
    mixer.update(0.5);
    expect(action.weight).toBeCloseTo(0.5, 1);
    mixer.update(0.5);
    expect(action.weight).toBeCloseTo(1);
  });

  it("fadeOut transitions weight toward 0 and stops action", () => {
    const ctrl = makeController([makeClip(0, "run", 10)]);
    const mixer = createGlyphcssAnimationMixer(makeTarget(), ctrl);
    const action = mixer.clipAction("run");
    action.play();
    action.weight = 1;
    action.fadeOut(1);
    mixer.update(1.1);
    expect(action.isRunning).toBe(false);
  });

  it("fadeIn returns this", () => {
    const ctrl = makeController([makeClip(0, "run")]);
    const mixer = createGlyphcssAnimationMixer(makeTarget(), ctrl);
    const action = mixer.clipAction("run");
    expect(action.fadeIn(1)).toBe(action);
  });

  it("fadeOut returns this", () => {
    const ctrl = makeController([makeClip(0, "run")]);
    const mixer = createGlyphcssAnimationMixer(makeTarget(), ctrl);
    const action = mixer.clipAction("run");
    expect(action.fadeOut(1)).toBe(action);
  });
});

// ── crossFadeTo ───────────────────────────────────────────────────────────────

describe("crossFadeTo", () => {
  it("fades out the source and fades in the target", () => {
    const clips = [makeClip(0, "walk", 10), makeClip(1, "run", 10)];
    const ctrl = makeController(clips, () => [TRI_A]);
    const mixer = createGlyphcssAnimationMixer(makeTarget(), ctrl);
    const walk = mixer.clipAction("walk");
    const run = mixer.clipAction("run");
    walk.play();
    walk.weight = 1;
    walk.crossFadeTo(run, 1);
    run.play();
    mixer.update(0.5);
    // walk weight approaches 0, run weight approaches 0.5
    expect(walk.weight).toBeCloseTo(0.5, 1);
    expect(run.weight).toBeCloseTo(0.5, 1);
  });

  it("returns this for chaining", () => {
    const clips = [makeClip(0, "walk", 10), makeClip(1, "run", 10)];
    const ctrl = makeController(clips);
    const mixer = createGlyphcssAnimationMixer(makeTarget(), ctrl);
    const walk = mixer.clipAction("walk");
    const run = mixer.clipAction("run");
    expect(walk.crossFadeTo(run, 1)).toBe(walk);
  });
});

// ── setEffectiveWeight ────────────────────────────────────────────────────────

describe("setEffectiveWeight", () => {
  it("sets weight and returns this", () => {
    const ctrl = makeController([makeClip(0, "run")]);
    const mixer = createGlyphcssAnimationMixer(makeTarget(), ctrl);
    const action = mixer.clipAction("run");
    const result = action.setEffectiveWeight(0.7);
    expect(action.weight).toBeCloseTo(0.7);
    expect(result).toBe(action);
  });
});

// ── stopAllAction ─────────────────────────────────────────────────────────────

describe("stopAllAction", () => {
  it("stops all running actions", () => {
    const clips = [makeClip(0, "walk", 5), makeClip(1, "run", 5)];
    const ctrl = makeController(clips);
    const mixer = createGlyphcssAnimationMixer(makeTarget(), ctrl);
    const walk = mixer.clipAction("walk").play();
    const run = mixer.clipAction("run").play();
    mixer.stopAllAction();
    expect(walk.isRunning).toBe(false);
    expect(run.isRunning).toBe(false);
  });

  it("after stopAllAction, update does not call setPolygons", () => {
    const ctrl = makeController([makeClip(0, "run", 5)]);
    const target = makeTarget();
    const mixer = createGlyphcssAnimationMixer(target, ctrl);
    mixer.clipAction("run").play();
    mixer.stopAllAction();
    mixer.update(0.1);
    expect(target.calls.length).toBe(0);
  });
});

// ── uncacheClip / uncacheRoot ─────────────────────────────────────────────────

describe("uncacheClip / uncacheRoot", () => {
  it("uncacheClip removes the cached action so existingAction returns null", () => {
    const ctrl = makeController([makeClip(0, "run")]);
    const mixer = createGlyphcssAnimationMixer(makeTarget(), ctrl);
    mixer.clipAction("run");
    mixer.uncacheClip("run");
    expect(mixer.existingAction("run")).toBeNull();
  });

  it("uncacheRoot removes all cached actions", () => {
    const clips = [makeClip(0, "walk"), makeClip(1, "run")];
    const ctrl = makeController(clips);
    const mixer = createGlyphcssAnimationMixer(makeTarget(), ctrl);
    mixer.clipAction("walk");
    mixer.clipAction("run");
    mixer.uncacheRoot();
    expect(mixer.existingAction("walk")).toBeNull();
    expect(mixer.existingAction("run")).toBeNull();
  });

  it("uncacheClip by index works the same as by name", () => {
    const ctrl = makeController([makeClip(0, "run")]);
    const mixer = createGlyphcssAnimationMixer(makeTarget(), ctrl);
    mixer.clipAction("run");
    mixer.uncacheClip(0);
    expect(mixer.existingAction("run")).toBeNull();
  });
});

// ── setLoop + clampWhenFinished ───────────────────────────────────────────────

describe("setLoop + clampWhenFinished", () => {
  it("LoopOnce + clampWhenFinished: time stays at duration after finish", () => {
    const ctrl = makeController([makeClip(0, "run", 1)]);
    const mixer = createGlyphcssAnimationMixer(makeTarget(), ctrl);
    const action = mixer.clipAction("run");
    action.setLoop(LoopOnce, 1);
    action.clampWhenFinished = true;
    action.play();
    mixer.update(2);
    expect(action.time).toBe(1);
    expect(action.isRunning).toBe(false);
  });

  it("setLoop returns this", () => {
    const ctrl = makeController([makeClip(0, "run")]);
    const mixer = createGlyphcssAnimationMixer(makeTarget(), ctrl);
    const action = mixer.clipAction("run");
    expect(action.setLoop(LoopOnce, 1)).toBe(action);
  });
});

// ── Multi-action blending ─────────────────────────────────────────────────────

describe("multi-action blending", () => {
  it("blends vertex positions proportional to weights", () => {
    const clips = [makeClip(0, "a", 10), makeClip(1, "b", 10)];
    const polyA: Polygon = { vertices: [[0, 0, 0]], color: "#f00" };
    const polyB: Polygon = { vertices: [[2, 0, 0]], color: "#f00" };
    const ctrl: ParseAnimationController = {
      clips,
      sample: (name, _t) => name === "a" ? [polyA] : [polyB],
    };
    const target = makeTarget();
    const mixer = createGlyphcssAnimationMixer(target, ctrl);
    const actionA = mixer.clipAction("a");
    const actionB = mixer.clipAction("b");
    actionA.setEffectiveWeight(0.5).play();
    actionB.setEffectiveWeight(0.5).play();
    mixer.update(0.1);
    // Blended x = 0 * 0.5 + 2 * 0.5 = 1
    expect(target.calls[0][0].vertices[0][0]).toBeCloseTo(1);
  });
});

// ── crossFadeFrom ─────────────────────────────────────────────────────────────

describe("crossFadeFrom", () => {
  it("fades in this action and fades out the from action", () => {
    const clips = [makeClip(0, "walk", 10), makeClip(1, "run", 10)];
    const ctrl = makeController(clips, () => [TRI_A]);
    const mixer = createGlyphcssAnimationMixer(makeTarget(), ctrl);
    const walk = mixer.clipAction("walk");
    const run = mixer.clipAction("run");
    walk.play();
    walk.weight = 1;
    run.crossFadeFrom(walk, 1);
    run.play();
    mixer.update(0.5);
    // walk weight approaches 0, run weight approaches 0.5
    expect(walk.weight).toBeCloseTo(0.5, 1);
    expect(run.weight).toBeCloseTo(0.5, 1);
  });

  it("returns this for chaining", () => {
    const clips = [makeClip(0, "walk", 10), makeClip(1, "run", 10)];
    const ctrl = makeController(clips);
    const mixer = createGlyphcssAnimationMixer(makeTarget(), ctrl);
    const walk = mixer.clipAction("walk");
    const run = mixer.clipAction("run");
    expect(run.crossFadeFrom(walk, 1)).toBe(run);
  });
});

// ── enabled ────────────────────────────────────────────────────────────────────

describe("enabled", () => {
  it("defaults to true", () => {
    const ctrl = makeController([makeClip(0, "run", 10)]);
    const mixer = createGlyphcssAnimationMixer(makeTarget(), ctrl);
    const action = mixer.clipAction("run");
    expect(action.enabled).toBe(true);
  });

  it("when false, does not drive setPolygons even while running", () => {
    const ctrl = makeController([makeClip(0, "run", 10)]);
    const target = makeTarget();
    const mixer = createGlyphcssAnimationMixer(target, ctrl);
    const action = mixer.clipAction("run");
    action.play();
    action.enabled = false;
    mixer.update(0.1);
    expect(target.calls.length).toBe(0);
  });

  it("when false, time still advances", () => {
    const ctrl = makeController([makeClip(0, "run", 10)]);
    const mixer = createGlyphcssAnimationMixer(makeTarget(), ctrl);
    const action = mixer.clipAction("run");
    action.play();
    action.enabled = false;
    mixer.update(0.5);
    expect(action.time).toBeCloseTo(0.5);
    expect(action.isRunning).toBe(true);
  });

  it("re-enabling allows the action to contribute again", () => {
    const ctrl = makeController([makeClip(0, "run", 10)]);
    const target = makeTarget();
    const mixer = createGlyphcssAnimationMixer(target, ctrl);
    const action = mixer.clipAction("run");
    action.play();
    action.enabled = false;
    mixer.update(0.1);
    expect(target.calls.length).toBe(0);
    action.enabled = true;
    mixer.update(0.1);
    expect(target.calls.length).toBe(1);
  });
});

// ── paused ─────────────────────────────────────────────────────────────────────

describe("paused", () => {
  it("defaults to false", () => {
    const ctrl = makeController([makeClip(0, "run", 10)]);
    const mixer = createGlyphcssAnimationMixer(makeTarget(), ctrl);
    const action = mixer.clipAction("run");
    expect(action.paused).toBe(false);
  });

  it("when true, time does not advance", () => {
    const ctrl = makeController([makeClip(0, "run", 10)]);
    const mixer = createGlyphcssAnimationMixer(makeTarget(), ctrl);
    const action = mixer.clipAction("run");
    action.play();
    mixer.update(0.5); // advance to 0.5
    action.paused = true;
    mixer.update(1.0); // should not advance time
    expect(action.time).toBeCloseTo(0.5);
  });

  it("when true, action still contributes current weight to blend", () => {
    const ctrl = makeController([makeClip(0, "run", 10)]);
    const target = makeTarget();
    const mixer = createGlyphcssAnimationMixer(target, ctrl);
    const action = mixer.clipAction("run");
    action.play();
    action.paused = true;
    mixer.update(0.1);
    // Still running and enabled, so setPolygons should be called
    expect(target.calls.length).toBeGreaterThan(0);
  });

  it("unpausing resumes time advancement", () => {
    const ctrl = makeController([makeClip(0, "run", 10)]);
    const mixer = createGlyphcssAnimationMixer(makeTarget(), ctrl);
    const action = mixer.clipAction("run");
    action.play();
    mixer.update(0.5);
    action.paused = true;
    mixer.update(1.0);
    expect(action.time).toBeCloseTo(0.5);
    action.paused = false;
    mixer.update(0.3);
    expect(action.time).toBeCloseTo(0.8);
  });
});
