/**
 * <PolyOrbitControls> (Vue) tests — drag/wheel/animate behavior, prop
 * reactivity, and unmount cleanup.
 *
 * Assertions target `cameraRef.value.state` (the source of truth for
 * camera mutations) via a context-capture helper component.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createApp, defineComponent, h, inject, nextTick, ref, type App } from "vue";
import type { CameraHandle } from "@layoutit/polycss-core";
import { PolyCamera } from "../camera/PolyCamera";
import { PolyScene } from "../scene/PolyScene";
import { PolyCameraContextKey } from "../camera/context";
import { PolyOrbitControls } from "./PolyOrbitControls";
import { PolyMapControls } from "./PolyMapControls";
import type { PolyOrbitControlsProps } from "./PolyOrbitControls";

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
  cameraRef: { value: CameraHandle };
}

function mount(
  controlsProps: PolyOrbitControlsProps = {},
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
              default: () => [h(PolyOrbitControls, controlsProps), h(ContextProbe)],
            }),
        });
    },
  });
  app.mount(container);
  if (!captured) throw new Error("ContextProbe never captured camera context");
  return { container, app, cameraRef: captured };
}

function mountMap(
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
              default: () => [h(PolyMapControls), h(ContextProbe)],
            }),
        });
    },
  });
  app.mount(container);
  if (!captured) throw new Error("ContextProbe never captured camera context");
  return { container, app, cameraRef: captured };
}

describe("PolyOrbitControls (Vue)", () => {
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

  // ── Pointer drag (orbit) ────────────────────────────────────────────────
  it("pointer drag (left) updates rotY in camera state (orbit)", () => {
    mounted = mount({}, { rotY: 45 });
    const cameraEl = findCameraEl(mounted.container);
    dispatchPointer(cameraEl, "pointerdown", { x: 100, y: 100 });
    dispatchPointer(cameraEl, "pointermove", { x: 200, y: 100 });
    dispatchPointer(cameraEl, "pointerup", { x: 200, y: 100 });
    // Drag right (+100 px) → rotY -25 → 45-25 = 20.
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

  it("clamps zoom to minZoom/maxZoom", () => {
    mounted = mount({ minZoom: 0.5, maxZoom: 2 }, { zoom: 1 });
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
    expect(mounted.cameraRef.value.state.rotY).toBeCloseTo(1, 4);
  });

  it("dt-clamps a long pause to 50 ms", () => {
    mounted = mount({ animate: { speed: 1 } }, { rotY: 0 });
    const baseTime = { now: 0 };
    tickFrame(16.67, baseTime);
    tickFrame(5000, baseTime);
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
    mounted.container.remove();
    mounted = null;
  });

  // ── Reactive prop watchers ────────────────────────────────────────────
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
                  default: () => h(PolyOrbitControls, { drag: dragOn.value }),
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
                  default: () => h(PolyOrbitControls, { drag: dragOn.value }),
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
                  default: () => [h(PolyOrbitControls, { wheel: wheelOn.value }), h(Probe)],
                }),
            });
        },
      });
      app.mount(container);
      const cameraEl = container.querySelector(".polycss-camera") as HTMLElement;
      const before = capturedScene!.state.zoom;
      dispatchWheel(cameraEl, -100);
      expect(capturedScene!.state.zoom).toBe(before);
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
                  default: () => [h(PolyOrbitControls, { wheel: wheelOn.value }), h(Probe)],
                }),
            });
        },
      });
      app.mount(container);
      const cameraEl = container.querySelector(".polycss-camera") as HTMLElement;
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
                  default: () => h(PolyOrbitControls, { animate: anim.value }),
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
          return () => h(PolyOrbitControls);
        },
      });
      app.mount(container);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("PolyOrbitControls"),
      );
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
                  default: () => h(PolyOrbitControls, { animate: anim.value }),
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

  // ── Dolly mode ─────────────────────────────────────────────────────────
  describe("dolly mode", () => {
    it("wheel with dolly=true changes distance, not zoom", () => {
      mounted = mount({ dolly: true }, { zoom: 1 });
      const cameraEl = findCameraEl(mounted.container);
      const beforeZoom = mounted.cameraRef.value.state.zoom;
      dispatchWheel(cameraEl, 100);
      expect(mounted.cameraRef.value.state.zoom).toBe(beforeZoom);
      expect(mounted.cameraRef.value.state.distance).toBeGreaterThan(0);
    });

    it("dolly is clamped by maxDistance", () => {
      mounted = mount({ dolly: true, maxDistance: 10 }, { zoom: 1 });
      const cameraEl = findCameraEl(mounted.container);
      for (let i = 0; i < 50; i++) dispatchWheel(cameraEl, 1000);
      expect(mounted.cameraRef.value.state.distance).toBe(10);
    });

    it("dolly is clamped by minDistance (cannot go below 0)", () => {
      mounted = mount({ dolly: true, minDistance: 0 }, { zoom: 1 });
      const cameraEl = findCameraEl(mounted.container);
      for (let i = 0; i < 50; i++) dispatchWheel(cameraEl, -1000);
      expect(mounted.cameraRef.value.state.distance).toBeGreaterThanOrEqual(0);
    });

    it("dolly=false (default) still changes zoom, not distance", () => {
      mounted = mount({ dolly: false }, { zoom: 1 });
      const cameraEl = findCameraEl(mounted.container);
      const beforeDist = mounted.cameraRef.value.state.distance;
      dispatchWheel(cameraEl, -100);
      expect(mounted.cameraRef.value.state.zoom).toBeGreaterThan(1);
      expect(mounted.cameraRef.value.state.distance).toBe(beforeDist);
    });
  });

  // ── Three.js OrbitControls-style emits ────────────────────────────────
  describe("event emits", () => {
    it("@change fires per pointermove with the post-mutation camera", () => {
      const onChange = vi.fn();
      mounted = mount(
        { onChange } as PolyOrbitControlsProps & Record<string, unknown>,
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
        { onInteractionStart, onInteractionEnd } as PolyOrbitControlsProps & Record<string, unknown>,
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
      } as PolyOrbitControlsProps & Record<string, unknown>);
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
      } as PolyOrbitControlsProps & Record<string, unknown>);
      const baseTime = { now: 0 };
      tickFrame(16.67, baseTime);
      tickFrame(16.67, baseTime);
      expect(onChange).toHaveBeenCalledTimes(2);
      expect(onInteractionStart).not.toHaveBeenCalled();
      expect(onInteractionEnd).not.toHaveBeenCalled();
    });
  });
});

describe("PolyMapControls (Vue)", () => {
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

  it("attaches drag handlers by default", () => {
    mounted = mountMap();
    const cameraEl = findCameraEl(mounted.container);
    expect(cameraEl.style.cursor).toBe("grab");
  });

  it("left-drag pans target (does not change rotY)", () => {
    mounted = mountMap({ rotY: 45, rotX: 0, zoom: 1 });
    const cameraEl = findCameraEl(mounted.container);
    dispatchPointer(cameraEl, "pointerdown", { x: 100, y: 100 });
    dispatchPointer(cameraEl, "pointermove", { x: 200, y: 100 });
    dispatchPointer(cameraEl, "pointerup", { x: 200, y: 100 });
    // rotY should be unchanged — this is pan, not orbit
    expect(mounted.cameraRef.value.state.rotY).toBeCloseTo(45, 1);
    // target should have changed
    const target = mounted.cameraRef.value.state.target;
    expect(target[0] !== 0 || target[1] !== 0).toBe(true);
  });

  it("wheel with dolly=true changes distance, not zoom (PolyMapControls)", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    let captured: { value: CameraHandle } | null = null;
    const Probe = defineComponent({
      setup() {
        const ctx = inject(PolyCameraContextKey);
        if (ctx) captured = ctx.cameraRef;
        return () => null;
      },
    });
    const app = createApp({
      setup() {
        return () =>
          h(PolyCamera, { zoom: 1 }, {
            default: () =>
              h(PolyScene, {}, {
                default: () => [h(PolyMapControls, { dolly: true }), h(Probe)],
              }),
          });
      },
    });
    app.mount(container);
    const cameraEl = container.querySelector(".polycss-camera") as HTMLElement;
    const beforeZoom = captured!.value.state.zoom;
    dispatchWheel(cameraEl, 100);
    expect(captured!.value.state.zoom).toBe(beforeZoom);
    expect(captured!.value.state.distance).toBeGreaterThan(0);
    app.unmount();
    container.remove();
  });
});
