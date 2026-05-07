/**
 * <PolyControls> (Vue) tests — drag/wheel/animate behavior, prop
 * reactivity, and unmount cleanup.
 *
 * Assertions target `cameraRef.value.state` (the source of truth for
 * camera mutations) via a context-capture helper component, rather than
 * sceneEl.style.transform. The DOM transform is written through Vue's
 * useCamera applyTransformDirect, which has its own render-cycle
 * timing quirks (it depends on PolyScene's local-ref → context-ref
 * watch firing) — those are out of scope for verifying PolyControls
 * itself. State changes are what PolyControls promises; transform DOM
 * sync is PolyScene's contract.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createApp, defineComponent, h, inject, nextTick, ref, type App } from "vue";
import type { CameraHandle } from "@polycss/core";
import { PolyCamera } from "../camera/PolyCamera";
import { PolyScene } from "../scene/PolyScene";
import { PolyCameraContextKey } from "../camera/context";
import { PolyControls } from "./PolyControls";
import type { PolyControlsProps } from "./PolyControls";

let rafQueue: Array<(now: number) => void> = [];
let rafId = 0;

function installManualRaf(): void {
  rafQueue = [];
  rafId = 0;
  vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb: FrameRequestCallback) => {
    rafQueue.push(cb);
    return ++rafId;
  });
  vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation(() => {
    rafQueue = [];
  });
}

function tickFrame(advanceMs: number, baseTime: { now: number }): void {
  baseTime.now += advanceMs;
  const frames = rafQueue;
  rafQueue = [];
  for (const f of frames) f(baseTime.now);
}

function dispatchPointer(
  el: HTMLElement,
  type: "pointerdown" | "pointermove" | "pointerup",
  init: { x: number; y: number; pointerId?: number; isPrimary?: boolean },
): void {
  el.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId: init.pointerId ?? 1,
      isPrimary: init.isPrimary ?? true,
      clientX: init.x,
      clientY: init.y,
    }),
  );
}

function dispatchWheel(el: HTMLElement, deltaY: number, deltaMode = 0): void {
  el.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY, deltaMode }));
}

function findCameraEl(container: HTMLElement): HTMLElement {
  const el = container.querySelector(".polycss-camera") as HTMLElement | null;
  if (!el) throw new Error("no .polycss-camera found");
  return el;
}

interface MountResult {
  container: HTMLElement;
  app: App;
  /** The camera handle's ref — mutated by PolyControls handlers. */
  cameraRef: { value: CameraHandle };
}

/**
 * Render <PolyCamera><PolyScene><PolyControls /></PolyScene></PolyCamera>.
 * Inside the scene, also mount a hidden ContextProbe child that injects
 * the camera context and exposes cameraRef so tests can assert on
 * cameraRef.value.state.
 */
function mount(
  controlsProps: PolyControlsProps = {},
  cameraProps: Record<string, unknown> = {},
): MountResult {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let captured: { value: CameraHandle } | null = null;
  const ContextProbe = defineComponent({
    setup() {
      const ctx = inject(PolyCameraContextKey);
      if (ctx) captured = ctx.cameraRef;
      return () => null;
    },
  });
  const app = createApp({
    setup() {
      return () =>
        h(PolyCamera, cameraProps, {
          default: () =>
            h(PolyScene, {}, {
              default: () => [h(PolyControls, controlsProps), h(ContextProbe)],
            }),
        });
    },
  });
  app.mount(container);
  if (!captured) throw new Error("ContextProbe never captured camera context");
  return { container, app, cameraRef: captured };
}

describe("PolyControls (Vue)", () => {
  let mounted: MountResult | null = null;

  beforeEach(() => {
    installManualRaf();
  });

  afterEach(() => {
    if (mounted) {
      mounted.app.unmount();
      mounted.container.remove();
      mounted = null;
    }
    vi.restoreAllMocks();
  });

  // ── Defaults ────────────────────────────────────────────────────────────
  it("renders nothing visible (returns null)", () => {
    mounted = mount();
    expect(mounted.container.querySelectorAll("[data-polycontrols]").length).toBe(0);
  });

  it("attaches drag handlers by default (camera el gets grab cursor + touch-action)", () => {
    mounted = mount();
    const cameraEl = findCameraEl(mounted.container);
    expect(cameraEl.style.cursor).toBe("grab");
    expect(cameraEl.style.touchAction).toBe("none");
  });

  it("does not start an rAF loop when animate is omitted", () => {
    mounted = mount();
    expect(rafQueue.length).toBe(0);
  });

  it("does not attach drag handlers when drag={false}", () => {
    mounted = mount({ drag: false });
    const cameraEl = findCameraEl(mounted.container);
    expect(cameraEl.style.cursor).toBe("");
  });

  // ── Pointer drag ────────────────────────────────────────────────────────
  it("pointer drag updates rotY in camera state", () => {
    mounted = mount({}, { rotY: 45 });
    const cameraEl = findCameraEl(mounted.container);
    dispatchPointer(cameraEl, "pointerdown", { x: 100, y: 100 });
    dispatchPointer(cameraEl, "pointermove", { x: 200, y: 100 });
    dispatchPointer(cameraEl, "pointerup", { x: 200, y: 100 });
    // Drag tracks the pointer: drag-right (+100 px) → rotY -25 → 45-25 = 20.
    expect(mounted.cameraRef.value.state.rotY).toBeCloseTo(20, 1);
  });

  it("pointer drag updates rotX (clamped to [0, 100])", () => {
    mounted = mount({}, { rotX: 50 });
    const cameraEl = findCameraEl(mounted.container);
    dispatchPointer(cameraEl, "pointerdown", { x: 0, y: 100 });
    dispatchPointer(cameraEl, "pointermove", { x: 0, y: 60 }); // -40 px
    dispatchPointer(cameraEl, "pointerup", { x: 0, y: 60 });
    // dY = -40 / 4 = -10. rotX = 50 - (-10) = 60.
    expect(mounted.cameraRef.value.state.rotX).toBeCloseTo(60, 1);
  });

  it("invert as a number multiplies sensitivity", () => {
    mounted = mount({ invert: 2 }, { rotY: 0 });
    const cameraEl = findCameraEl(mounted.container);
    dispatchPointer(cameraEl, "pointerdown", { x: 100, y: 100 });
    dispatchPointer(cameraEl, "pointermove", { x: 200, y: 100 });
    dispatchPointer(cameraEl, "pointerup", { x: 200, y: 100 });
    // invert:2 → 2× sensitivity in default direction → -50 deg → wraps to 310.
    expect(mounted.cameraRef.value.state.rotY).toBeCloseTo(310, 1);
  });

  // ── Wheel zoom ──────────────────────────────────────────────────────────
  it("wheel zoom updates camera state zoom", () => {
    mounted = mount({}, { zoom: 1 });
    const cameraEl = findCameraEl(mounted.container);
    dispatchWheel(cameraEl, -100);
    expect(mounted.cameraRef.value.state.zoom).toBeGreaterThan(1);
  });

  it("does not handle wheel when wheel={false}", () => {
    mounted = mount({ wheel: false }, { zoom: 1 });
    const cameraEl = findCameraEl(mounted.container);
    dispatchWheel(cameraEl, -100);
    expect(mounted.cameraRef.value.state.zoom).toBe(1);
  });

  it("clamps zoom to {min, max}", () => {
    mounted = mount({ zoom: { min: 0.5, max: 2 } }, { zoom: 1 });
    const cameraEl = findCameraEl(mounted.container);
    for (let i = 0; i < 20; i++) dispatchWheel(cameraEl, -1000);
    expect(mounted.cameraRef.value.state.zoom).toBe(2);
  });

  // ── Animate ─────────────────────────────────────────────────────────────
  it("animate queues an rAF tick", () => {
    mounted = mount({ animate: { speed: 0.3 } });
    expect(rafQueue.length).toBe(1);
  });

  it("animate rotates rotY per tick (dt-normalized)", () => {
    mounted = mount({ animate: { speed: 1 } }, { rotY: 0 });
    const baseTime = { now: 0 };
    tickFrame(16.67, baseTime);
    // First tick uses ANIM_FRAME_MS fallback → +1 deg.
    expect(mounted.cameraRef.value.state.rotY).toBeCloseTo(1, 4);
  });

  it("dt-clamps a long pause to 50 ms", () => {
    mounted = mount({ animate: { speed: 1 } }, { rotY: 0 });
    const baseTime = { now: 0 };
    tickFrame(16.67, baseTime);  // anchor: +1 deg → rotY = 1
    tickFrame(5000, baseTime);   // huge gap, clamped to 50 ms → +3 deg → rotY ≈ 4
    expect(mounted.cameraRef.value.state.rotY).toBeCloseTo(4, 1);
  });

  it("animate axis 'x' rotates rotX, leaves rotY untouched", () => {
    mounted = mount({ animate: { speed: 1, axis: "x" } }, { rotX: 30, rotY: 60 });
    const baseTime = { now: 0 };
    tickFrame(16.67, baseTime);
    expect(mounted.cameraRef.value.state.rotX).toBeCloseTo(31, 1);
    expect(mounted.cameraRef.value.state.rotY).toBe(60);
  });

  // ── Lifecycle ───────────────────────────────────────────────────────────
  it("unmount cancels rAF and removes pointer listeners", () => {
    mounted = mount({ animate: { speed: 1 } });
    const cameraEl = findCameraEl(mounted.container);
    expect(rafQueue.length).toBe(1);
    mounted.app.unmount();
    expect(rafQueue.length).toBe(0);
    expect(cameraEl.style.cursor).toBe("");
    // Skip the afterEach unmount (already done).
    mounted.container.remove();
    mounted = null;
  });

  // ── Reactive prop watchers ────────────────────────────────────────────
  // Toggling drag/wheel/animate via reactive props (instead of remounting)
  // must propagate through the watch() callbacks inside PolyControls.
  describe("reactive prop changes", () => {
    it("flipping drag from false → true attaches the drag handlers (cursor flips to grab)", async () => {
      const container = document.createElement("div");
      document.body.appendChild(container);
      const dragOn = ref(false);
      const app = createApp({
        setup() {
          return () =>
            h(PolyCamera, {}, {
              default: () =>
                h(PolyScene, {}, {
                  default: () => h(PolyControls, { drag: dragOn.value }),
                }),
            });
        },
      });
      app.mount(container);
      const cameraEl = container.querySelector(".polycss-camera") as HTMLElement;
      expect(cameraEl.style.cursor).toBe("");
      dragOn.value = true;
      await nextTick();
      expect(cameraEl.style.cursor).toBe("grab");
      app.unmount();
      container.remove();
    });

    it("flipping drag from true → false detaches drag handlers", async () => {
      const container = document.createElement("div");
      document.body.appendChild(container);
      const dragOn = ref(true);
      const app = createApp({
        setup() {
          return () =>
            h(PolyCamera, {}, {
              default: () =>
                h(PolyScene, {}, {
                  default: () => h(PolyControls, { drag: dragOn.value }),
                }),
            });
        },
      });
      app.mount(container);
      const cameraEl = container.querySelector(".polycss-camera") as HTMLElement;
      expect(cameraEl.style.cursor).toBe("grab");
      dragOn.value = false;
      await nextTick();
      expect(cameraEl.style.cursor).toBe("");
      app.unmount();
      container.remove();
    });

    it("flipping wheel from false → true attaches the wheel handler", async () => {
      const container = document.createElement("div");
      document.body.appendChild(container);
      const wheelOn = ref(false);
      let capturedScene: { state: { zoom: number } } | null = null;
      const Probe = defineComponent({
        setup() {
          const ctx = inject(PolyCameraContextKey)!;
          capturedScene = ctx.cameraRef.value;
          return () => null;
        },
      });
      const app = createApp({
        setup() {
          return () =>
            h(PolyCamera, { zoom: 1 }, {
              default: () =>
                h(PolyScene, {}, {
                  default: () => [h(PolyControls, { wheel: wheelOn.value }), h(Probe)],
                }),
            });
        },
      });
      app.mount(container);
      const cameraEl = container.querySelector(".polycss-camera") as HTMLElement;
      // Initially wheel is off → wheel events shouldn't change zoom.
      const before = capturedScene!.state.zoom;
      dispatchWheel(cameraEl, -100);
      expect(capturedScene!.state.zoom).toBe(before);
      // Flip to on.
      wheelOn.value = true;
      await nextTick();
      dispatchWheel(cameraEl, -100);
      expect(capturedScene!.state.zoom).toBeGreaterThan(before);
      app.unmount();
      container.remove();
    });

    it("flipping wheel from true → false detaches the wheel handler", async () => {
      const container = document.createElement("div");
      document.body.appendChild(container);
      const wheelOn = ref(true);
      let capturedScene: { state: { zoom: number } } | null = null;
      const Probe = defineComponent({
        setup() {
          const ctx = inject(PolyCameraContextKey)!;
          capturedScene = ctx.cameraRef.value;
          return () => null;
        },
      });
      const app = createApp({
        setup() {
          return () =>
            h(PolyCamera, { zoom: 1 }, {
              default: () =>
                h(PolyScene, {}, {
                  default: () => [h(PolyControls, { wheel: wheelOn.value }), h(Probe)],
                }),
            });
        },
      });
      app.mount(container);
      const cameraEl = container.querySelector(".polycss-camera") as HTMLElement;
      // Toggle wheel off.
      wheelOn.value = false;
      await nextTick();
      const beforeZoom = capturedScene!.state.zoom;
      dispatchWheel(cameraEl, -100);
      expect(capturedScene!.state.zoom).toBe(beforeZoom);
      app.unmount();
      container.remove();
    });

    it("flipping animate from false → object starts the rAF loop", async () => {
      const container = document.createElement("div");
      document.body.appendChild(container);
      const anim = ref<false | { speed: number }>(false);
      const app = createApp({
        setup() {
          return () =>
            h(PolyCamera, {}, {
              default: () =>
                h(PolyScene, {}, {
                  default: () => h(PolyControls, { animate: anim.value }),
                }),
            });
        },
      });
      app.mount(container);
      expect(rafQueue.length).toBe(0);
      anim.value = { speed: 0.3 };
      await nextTick();
      expect(rafQueue.length).toBe(1);
      app.unmount();
      container.remove();
    });

    it("warns + no-ops when used outside <PolyCamera>", () => {
      const container = document.createElement("div");
      document.body.appendChild(container);
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const app = createApp({
        setup() {
          // PolyControls outside any PolyCamera → no context to inject.
          return () => h(PolyControls);
        },
      });
      app.mount(container);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("PolyControls"),
      );
      // No rAF queued, no event listeners attached anywhere visible.
      expect(rafQueue.length).toBe(0);
      app.unmount();
      container.remove();
    });

    it("flipping animate from object → false stops the rAF loop", async () => {
      const container = document.createElement("div");
      document.body.appendChild(container);
      const anim = ref<false | { speed: number }>({ speed: 0.3 });
      const app = createApp({
        setup() {
          return () =>
            h(PolyCamera, {}, {
              default: () =>
                h(PolyScene, {}, {
                  default: () => h(PolyControls, { animate: anim.value }),
                }),
            });
        },
      });
      app.mount(container);
      expect(rafQueue.length).toBe(1);
      anim.value = false;
      await nextTick();
      expect(rafQueue.length).toBe(0);
      app.unmount();
      container.remove();
    });
  });

  // ── Three.js OrbitControls-style emits (change / interaction-start / -end)
  describe("event emits", () => {
    it("@change fires per pointermove with the post-mutation camera", () => {
      // Vue maps `onChange` listener prop → `change` emit subscription.
      const onChange = vi.fn();
      mounted = mount(
        { onChange } as PolyControlsProps & Record<string, unknown>,
        { rotY: 45 },
      );
      const cameraEl = findCameraEl(mounted.container);
      dispatchPointer(cameraEl, "pointerdown", { x: 100, y: 100 });
      dispatchPointer(cameraEl, "pointermove", { x: 200, y: 100 });
      dispatchPointer(cameraEl, "pointermove", { x: 250, y: 100 });
      dispatchPointer(cameraEl, "pointerup", { x: 250, y: 100 });
      expect(onChange).toHaveBeenCalledTimes(2);
      const last = onChange.mock.calls[onChange.mock.calls.length - 1][0];
      // Final rotY = 45 - (250-100)/4 = 7.5
      expect(last.rotY).toBeCloseTo(7.5, 4);
      expect(typeof last.rotX).toBe("number");
      expect(typeof last.zoom).toBe("number");
    });

    it("@interaction-start / -end fire once per drag gesture and carry camera", () => {
      const onInteractionStart = vi.fn();
      const onInteractionEnd = vi.fn();
      mounted = mount(
        { onInteractionStart, onInteractionEnd } as PolyControlsProps & Record<string, unknown>,
        { rotY: 45 },
      );
      const cameraEl = findCameraEl(mounted.container);
      dispatchPointer(cameraEl, "pointerdown", { x: 100, y: 100 });
      dispatchPointer(cameraEl, "pointermove", { x: 200, y: 100 });
      dispatchPointer(cameraEl, "pointermove", { x: 250, y: 100 });
      dispatchPointer(cameraEl, "pointerup", { x: 250, y: 100 });
      expect(onInteractionStart).toHaveBeenCalledTimes(1);
      expect(onInteractionEnd).toHaveBeenCalledTimes(1);
      const startCam = onInteractionStart.mock.calls[0][0];
      const endCam = onInteractionEnd.mock.calls[0][0];
      expect(startCam.rotY).toBeCloseTo(45, 4);
      // After dragging right by 150 px, rotY = 45 - 150/4 = 7.5
      expect(endCam.rotY).toBeCloseTo(7.5, 4);
    });

    it("wheel emits @interaction-start, @change per event, @interaction-end after idle", () => {
      vi.useFakeTimers();
      const onInteractionStart = vi.fn();
      const onChange = vi.fn();
      const onInteractionEnd = vi.fn();
      mounted = mount({
        onChange,
        onInteractionStart,
        onInteractionEnd,
      } as PolyControlsProps & Record<string, unknown>);
      const cameraEl = findCameraEl(mounted.container);
      dispatchWheel(cameraEl, -50);
      dispatchWheel(cameraEl, -50);
      expect(onInteractionStart).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledTimes(2);
      expect(onInteractionEnd).toHaveBeenCalledTimes(0);
      vi.advanceTimersByTime(160);
      expect(onInteractionEnd).toHaveBeenCalledTimes(1);
      vi.useRealTimers();
    });

    it("autorotate fires @change per tick but no interaction start/end", () => {
      const onChange = vi.fn();
      const onInteractionStart = vi.fn();
      const onInteractionEnd = vi.fn();
      mounted = mount({
        animate: { speed: 1 },
        onChange,
        onInteractionStart,
        onInteractionEnd,
      } as PolyControlsProps & Record<string, unknown>);
      const baseTime = { now: 0 };
      tickFrame(16.67, baseTime);
      tickFrame(16.67, baseTime);
      expect(onChange).toHaveBeenCalledTimes(2);
      expect(onInteractionStart).not.toHaveBeenCalled();
      expect(onInteractionEnd).not.toHaveBeenCalled();
    });
  });
});
