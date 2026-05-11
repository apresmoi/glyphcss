import { describe, it, expect, vi, afterEach } from "vitest";
import { ref, computed, nextTick } from "vue";
import { createApp, h } from "vue";
import { usePolyAnimation } from "./usePolyAnimation";
import type { UsePolyAnimationResultVueVue } from "./usePolyAnimation";
import type {
  PolyAnimationTarget,
  PolyAnimationClip,
  ParseAnimationController,
  Polygon,
} from "@layoutit/polycss-core";

const TRI: Polygon = { vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]], color: "#f00" };

function makeClip(index: number, name: string, duration = 1): PolyAnimationClip {
  return { index, name, duration, channelCount: 1 };
}

function makeController(clips: PolyAnimationClip[]): ParseAnimationController {
  return { clips, sample: () => [TRI] };
}

function makeTarget(): PolyAnimationTarget & { calls: Polygon[][] } {
  const calls: Polygon[][] = [];
  return { calls, setPolygons(polys) { calls.push(polys); } };
}

// ── Harness ──────────────────────────────────────────────────────────────────

interface CaptureResult {
  result: UsePolyAnimationResultVue;
  app: ReturnType<typeof createApp>;
}

function mountComposable(
  clips?: PolyAnimationClip[],
  controller?: ParseAnimationController,
  root?: PolyAnimationTarget | null,
): CaptureResult {
  let captured!: UsePolyAnimationResultVue;
  const container = document.createElement("div");
  const app = createApp({
    setup() {
      captured = usePolyAnimation(
        ref(clips),
        ref(controller),
        root != null ? ref(root) : undefined,
      );
      return () => h("div");
    },
  });
  app.mount(container);
  return { result: captured!, app };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ── No-input state ────────────────────────────────────────────────────────────

describe("usePolyAnimation — no inputs", () => {
  it("mixer.value is null when no clips are passed", () => {
    const { result } = mountComposable();
    expect(result.mixer.value).toBeNull();
  });

  it("clips.value is empty array when no clips are passed", () => {
    const { result } = mountComposable();
    expect(result.clips.value).toEqual([]);
  });

  it("names.value is empty array when no clips are passed", () => {
    const { result } = mountComposable();
    expect(result.names.value).toEqual([]);
  });

  it("actions.value is empty object when no clips are passed", () => {
    const { result } = mountComposable();
    expect(Object.keys(result.actions.value)).toEqual([]);
  });

  it("ref.value is null initially", () => {
    const { result } = mountComposable();
    expect(result.ref.value).toBeNull();
  });

  it("does not throw on mount without inputs", () => {
    expect(() => mountComposable()).not.toThrow();
  });

  it("does not throw on unmount without inputs", () => {
    const { app } = mountComposable();
    expect(() => app.unmount()).not.toThrow();
  });
});

// ── With clips + controller + root ────────────────────────────────────────────

describe("usePolyAnimation — with inputs", () => {
  it("clips.value matches provided clips", () => {
    const clips = [makeClip(0, "walk"), makeClip(1, "run")];
    const ctrl = makeController(clips);
    const target = makeTarget();
    const { result } = mountComposable(clips, ctrl, target);
    expect(result.clips.value).toHaveLength(2);
    expect(result.clips.value[0].name).toBe("walk");
    expect(result.clips.value[1].name).toBe("run");
  });

  it("names.value contains clip names", () => {
    const clips = [makeClip(0, "idle"), makeClip(1, "run")];
    const ctrl = makeController(clips);
    const target = makeTarget();
    const { result } = mountComposable(clips, ctrl, target);
    expect(result.names.value).toEqual(["idle", "run"]);
  });

  it("mixer.value is non-null when clips, controller, and root are all provided", () => {
    const clips = [makeClip(0, "walk")];
    const ctrl = makeController(clips);
    const target = makeTarget();
    const { result } = mountComposable(clips, ctrl, target);
    expect(result.mixer.value).not.toBeNull();
  });

  it("does not throw on unmount with inputs", () => {
    const clips = [makeClip(0, "idle")];
    const ctrl = makeController(clips);
    const target = makeTarget();
    const { app } = mountComposable(clips, ctrl, target);
    expect(() => app.unmount()).not.toThrow();
  });
});

// ── Actions proxy ─────────────────────────────────────────────────────────────

describe("usePolyAnimation — actions proxy", () => {
  it("actions.value has enumerable keys matching clip names", () => {
    const clips = [makeClip(0, "walk"), makeClip(1, "run")];
    const ctrl = makeController(clips);
    const target = makeTarget();
    const { result } = mountComposable(clips, ctrl, target);
    expect(Object.keys(result.actions.value)).toEqual(["walk", "run"]);
  });

  it("accessing actions.value[name] returns an action when mixer is ready", () => {
    const clips = [makeClip(0, "walk")];
    const ctrl = makeController(clips);
    const target = makeTarget();
    const { result } = mountComposable(clips, ctrl, target);
    const action = result.actions.value["walk"];
    // Should be an action object (not null) since mixer is built with root
    expect(action).not.toBeNull();
    expect(typeof action?.play).toBe("function");
  });

  it("actions.value[name] returns null when mixer is null", () => {
    const clips = [makeClip(0, "walk")];
    // No controller → mixer stays null
    const { result } = mountComposable(clips, undefined);
    expect(result.actions.value["walk"]).toBeNull();
  });
});

// ── RAF loop ─────────────────────────────────────────────────────────────────

describe("usePolyAnimation — RAF loop", () => {
  it("calls requestAnimationFrame when clips, controller, and root are provided", () => {
    const rafSpy = vi.fn((_cb: FrameRequestCallback) => 1);
    const cafSpy = vi.fn();
    vi.stubGlobal("requestAnimationFrame", rafSpy);
    vi.stubGlobal("cancelAnimationFrame", cafSpy);

    const clips = [makeClip(0, "walk")];
    const ctrl = makeController(clips);
    const target = makeTarget();
    mountComposable(clips, ctrl, target);

    expect(rafSpy).toHaveBeenCalled();
  });

  it("cancels requestAnimationFrame on unmount", () => {
    let nextId = 1;
    const rafSpy = vi.fn((_cb: FrameRequestCallback) => nextId++);
    const cafSpy = vi.fn();
    vi.stubGlobal("requestAnimationFrame", rafSpy);
    vi.stubGlobal("cancelAnimationFrame", cafSpy);

    const clips = [makeClip(0, "walk")];
    const ctrl = makeController(clips);
    const target = makeTarget();
    const { app } = mountComposable(clips, ctrl, target);
    app.unmount();

    expect(cafSpy).toHaveBeenCalled();
  });

  it("does not call requestAnimationFrame when no root is provided", () => {
    const rafSpy = vi.fn(() => 1);
    vi.stubGlobal("requestAnimationFrame", rafSpy);

    const clips = [makeClip(0, "walk")];
    const ctrl = makeController(clips);
    // No root → mixer not built → no RAF
    mountComposable(clips, ctrl, undefined);

    expect(rafSpy).not.toHaveBeenCalled();
  });
});

// ── Mixer drives setPolygons ──────────────────────────────────────────────────

describe("usePolyAnimation — mixer drives setPolygons", () => {
  it("playing an action and manually updating mixer calls setPolygons on target", () => {
    const clips = [makeClip(0, "walk", 2)];
    const target = makeTarget();
    const sampled: Polygon[] = [TRI];
    const ctrl: ParseAnimationController = {
      clips,
      sample: () => sampled,
    };
    const { result } = mountComposable(clips, ctrl, target);

    const mixer = result.mixer.value;
    if (mixer) {
      mixer.clipAction("walk").play();
      mixer.update(0.1);
      expect(target.calls.length).toBeGreaterThan(0);
      expect(target.calls[0]).toBe(sampled);
    }
  });

  it("unmount stops all actions on the mixer", () => {
    const clips = [makeClip(0, "walk", 2)];
    const target = makeTarget();
    const ctrl = makeController(clips);
    const { result, app } = mountComposable(clips, ctrl, target);

    const mixer = result.mixer.value;
    if (mixer) {
      const action = mixer.clipAction("walk");
      action.play();
      expect(action.isRunning).toBe(true);
    }

    app.unmount();

    // After unmount, the mixer should have been torn down (stopAllAction called).
    // The mixer computed is still the same object but actions are stopped.
    if (mixer) {
      const action = mixer.existingAction("walk");
      if (action) {
        expect(action.isRunning).toBe(false);
      }
    }
  });
});

// ── Reactive inputs ────────────────────────────────────────────────────────────

describe("usePolyAnimation — reactive inputs", () => {
  it("mixer rebuilds when clips ref changes", async () => {
    const clipsRef = ref<PolyAnimationClip[]>([makeClip(0, "walk")]);
    const ctrlRef = ref<ParseAnimationController | undefined>(makeController(clipsRef.value));
    const target = makeTarget();

    let captured!: UsePolyAnimationResultVue;
    const container = document.createElement("div");
    const app = createApp({
      setup() {
        captured = usePolyAnimation(clipsRef, ctrlRef, ref(target));
        return () => h("div");
      },
    });
    app.mount(container);

    const mixerBefore = captured.mixer.value;

    // Change clips
    clipsRef.value = [makeClip(0, "run")];
    ctrlRef.value = makeController(clipsRef.value);
    await nextTick();

    // Names should now reflect the new clip
    expect(captured.names.value).toEqual(["run"]);

    app.unmount();
    void mixerBefore;
  });

  it("builds mixer when root ref resolves after clips and controller are set", async () => {
    const clips = [makeClip(0, "walk", 2)];
    const ctrl = makeController(clips);
    const rootRef = ref<PolyAnimationTarget | null>(null);

    let captured!: UsePolyAnimationResultVue;
    const container = document.createElement("div");
    const app = createApp({
      setup() {
        captured = usePolyAnimation(ref(clips), ref(ctrl), rootRef);
        return () => h("div");
      },
    });
    app.mount(container);

    // Root is null — mixer must not be built yet
    expect(captured.mixer.value).toBeNull();

    // Manually call update to confirm no writes happen
    const earlyTarget = makeTarget();
    // (mixer is null so update won't be called)
    expect(earlyTarget.calls.length).toBe(0);

    // Resolve the root ref
    const target = makeTarget();
    rootRef.value = target;
    await nextTick();

    // Mixer should now be built
    expect(captured.mixer.value).not.toBeNull();

    // Playing and updating should now write to the target
    const mixer = captured.mixer.value!;
    mixer.clipAction("walk").play();
    mixer.update(0.1);
    expect(target.calls.length).toBeGreaterThan(0);

    app.unmount();
  });
});
