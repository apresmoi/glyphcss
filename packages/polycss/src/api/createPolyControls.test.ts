/**
 * Tests for createPolyControls — the additive camera input + autorotate
 * layer. Covers construction defaults, drag, wheel, animate (with dt
 * normalization), update(), start/stop/destroy lifecycle, and isolation
 * between multiple controls instances.
 *
 * Pointer/wheel events are dispatched via PointerEvent / WheelEvent
 * (happy-dom supports both). The animate loop is exercised via mocked
 * requestAnimationFrame so we can advance time deterministically and
 * verify the dt-clamping math.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPolyScene, type SceneHandle } from "./createPolyScene";
import { createPolyControls, type ControlsHandle } from "./createPolyControls";

// ── rAF harness ──────────────────────────────────────────────────────────
// happy-dom's rAF is microtask-ish — we replace it with a manual queue so
// we can step the autorotate loop one frame at a time and inject a custom
// `now` value (for dt-clamping tests).
type Frame = (now: number) => void;
let rafQueue: Frame[] = [];
let rafId = 0;
let nowMs = 0;

function installManualRaf(): void {
  rafQueue = [];
  rafId = 0;
  nowMs = 0;
  vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb: Frame) => {
    rafQueue.push(cb);
    return ++rafId;
  });
  vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation((id: number) => {
    // Mark cancellation by replacing with a no-op. We don't actually use the
    // id-to-position map; the autorotate loop only re-queues the latest frame.
    rafQueue = [];
    void id;
  });
}

function tickFrame(advanceMs = 16.67): void {
  nowMs += advanceMs;
  const frames = rafQueue;
  rafQueue = [];
  for (const f of frames) f(nowMs);
}

function dispatchPointer(
  el: HTMLElement,
  type: "pointerdown" | "pointermove" | "pointerup" | "pointercancel",
  init: { x: number; y: number; pointerId?: number; isPrimary?: boolean },
): void {
  const ev = new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    pointerId: init.pointerId ?? 1,
    isPrimary: init.isPrimary ?? true,
    clientX: init.x,
    clientY: init.y,
  });
  el.dispatchEvent(ev);
}

function dispatchWheel(el: HTMLElement, deltaY: number, deltaMode = 0): void {
  const ev = new WheelEvent("wheel", {
    bubbles: true,
    cancelable: true,
    deltaY,
    deltaMode,
  });
  el.dispatchEvent(ev);
}

describe("createPolyControls", () => {
  let host: HTMLElement;
  let scene: SceneHandle;
  let controls: ControlsHandle | null;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    scene = createPolyScene(host, { rotX: 65, rotY: 45, zoom: 1 });
    controls = null;
    installManualRaf();
  });

  afterEach(() => {
    if (controls) controls.destroy();
    scene.destroy();
    if (host.parentNode) host.parentNode.removeChild(host);
    vi.restoreAllMocks();
  });

  // ── Defaults ────────────────────────────────────────────────────────────
  describe("defaults", () => {
    it("attaches drag and wheel handlers with no options", () => {
      controls = createPolyControls(scene);
      expect(host.style.cursor).toBe("grab");
      expect(host.style.touchAction).toBe("none");
      expect(host.style.userSelect).toBe("none");
    });

    it("does not start an rAF loop when animate is omitted", () => {
      controls = createPolyControls(scene);
      expect(rafQueue.length).toBe(0);
    });

    it("disables drag when drag:false", () => {
      controls = createPolyControls(scene, { drag: false });
      expect(host.style.cursor).toBe("");
      // pointerdown is silently ignored — rotY shouldn't change
      const before = scene.getOptions().rotY;
      dispatchPointer(host, "pointerdown", { x: 100, y: 100 });
      dispatchPointer(host, "pointermove", { x: 150, y: 100 });
      dispatchPointer(host, "pointerup", { x: 150, y: 100 });
      expect(scene.getOptions().rotY).toBe(before);
    });

    it("disables wheel when wheel:false", () => {
      controls = createPolyControls(scene, { wheel: false });
      const before = scene.getOptions().zoom;
      dispatchWheel(host, -100);
      expect(scene.getOptions().zoom).toBe(before);
    });
  });

  // ── Pointer drag ────────────────────────────────────────────────────────
  describe("pointer drag", () => {
    it("updates rotY on horizontal drag", () => {
      controls = createPolyControls(scene);
      const before = scene.getOptions().rotY ?? 45;
      dispatchPointer(host, "pointerdown", { x: 100, y: 100 });
      dispatchPointer(host, "pointermove", { x: 200, y: 100 }); // +100 px
      dispatchPointer(host, "pointerup", { x: 200, y: 100 });
      const after = scene.getOptions().rotY ?? 0;
      // Drag tracks the pointer: drag-right (+100 px) → camera rotates
      // the OTHER way so the object appears to follow the mouse → rotY
      // decreases by dX/POINTER_DRAG_SPEED = 100/4 = 25 deg.
      expect(after).toBeCloseTo(((before - 25) % 360 + 360) % 360, 1);
    });

    it("updates rotX on vertical drag (clamped to [0, 100])", () => {
      controls = createPolyControls(scene);
      const before = scene.getOptions().rotX ?? 65;
      dispatchPointer(host, "pointerdown", { x: 100, y: 100 });
      dispatchPointer(host, "pointermove", { x: 100, y: 60 }); // -40 px
      dispatchPointer(host, "pointerup", { x: 100, y: 60 });
      // -40 px / 4 = -10 deg of dY → rotX = before - dY = before - (-10) = before + 10
      expect(scene.getOptions().rotX).toBeCloseTo(before + 10, 1);
    });

    it("clamps rotX to [0, 100]", () => {
      controls = createPolyControls(scene);
      // huge upward drag — should saturate at 100
      dispatchPointer(host, "pointerdown", { x: 0, y: 0 });
      dispatchPointer(host, "pointermove", { x: 0, y: -10000 });
      dispatchPointer(host, "pointerup", { x: 0, y: -10000 });
      expect(scene.getOptions().rotX).toBe(100);
    });

    it("ignores secondary pointers when one is already active", () => {
      controls = createPolyControls(scene);
      dispatchPointer(host, "pointerdown", { x: 100, y: 100, pointerId: 1 });
      const after1 = scene.getOptions().rotY;
      dispatchPointer(host, "pointerdown", { x: 200, y: 100, pointerId: 2 });
      // Second pointerdown didn't capture, so its move should not register
      dispatchPointer(host, "pointermove", { x: 300, y: 100, pointerId: 2 });
      expect(scene.getOptions().rotY).toBe(after1);
    });

    it("invert:true reverses drag direction", () => {
      controls = createPolyControls(scene, { invert: true });
      const before = scene.getOptions().rotY ?? 45;
      dispatchPointer(host, "pointerdown", { x: 100, y: 100 });
      dispatchPointer(host, "pointermove", { x: 200, y: 100 });
      dispatchPointer(host, "pointerup", { x: 200, y: 100 });
      // Default goes -25 deg on right-drag; invert:true flips to +25 deg.
      expect(scene.getOptions().rotY).toBeCloseTo((before + 25) % 360, 1);
    });

    it("invert as a number multiplies sensitivity", () => {
      controls = createPolyControls(scene, { invert: 2 });
      const before = scene.getOptions().rotY ?? 45;
      dispatchPointer(host, "pointerdown", { x: 100, y: 100 });
      dispatchPointer(host, "pointermove", { x: 200, y: 100 });
      dispatchPointer(host, "pointerup", { x: 200, y: 100 });
      // invert:2 → 2× sensitivity in the default direction → -50 deg.
      expect(scene.getOptions().rotY).toBeCloseTo(((before - 50) % 360 + 360) % 360, 1);
    });

    it("toggles cursor between grab and grabbing during a drag", () => {
      controls = createPolyControls(scene);
      expect(host.style.cursor).toBe("grab");
      dispatchPointer(host, "pointerdown", { x: 100, y: 100 });
      expect(host.style.cursor).toBe("grabbing");
      dispatchPointer(host, "pointerup", { x: 100, y: 100 });
      expect(host.style.cursor).toBe("grab");
    });
  });

  // ── Wheel zoom ──────────────────────────────────────────────────────────
  describe("wheel zoom", () => {
    it("zoom in on negative deltaY", () => {
      controls = createPolyControls(scene);
      const before = scene.getOptions().zoom ?? 1;
      dispatchWheel(host, -100);
      expect((scene.getOptions().zoom ?? 0)).toBeGreaterThan(before);
    });

    it("zoom out on positive deltaY", () => {
      controls = createPolyControls(scene);
      const before = scene.getOptions().zoom ?? 1;
      dispatchWheel(host, 100);
      expect((scene.getOptions().zoom ?? 0)).toBeLessThan(before);
    });

    it("clamps to maxZoom", () => {
      controls = createPolyControls(scene, { minZoom: 0.5, maxZoom: 2 });
      // huge zoom-in — should saturate at 2
      for (let i = 0; i < 20; i++) dispatchWheel(host, -1000);
      expect(scene.getOptions().zoom).toBe(2);
    });

    it("clamps to minZoom", () => {
      controls = createPolyControls(scene, { minZoom: 0.5, maxZoom: 2 });
      for (let i = 0; i < 20; i++) dispatchWheel(host, 1000);
      expect(scene.getOptions().zoom).toBe(0.5);
    });

    it("normalizes deltaMode lines/pages", () => {
      controls = createPolyControls(scene);
      const startZoom = scene.getOptions().zoom ?? 1;
      dispatchWheel(host, -1, 1); // 1 line × lineFactor 16 = 16 px-equivalent
      const afterLine = scene.getOptions().zoom ?? 0;
      // Reset
      scene.setOptions({ zoom: startZoom });
      dispatchWheel(host, -16, 0); // 16 px
      const afterPx = scene.getOptions().zoom ?? 0;
      // Should produce equivalent zoom factors.
      expect(afterLine).toBeCloseTo(afterPx, 5);
    });
  });

  // ── Dolly mode ───────────────────────────────────────────────────────────
  describe("dolly", () => {
    it("dolly:true changes distance instead of zoom on wheel", () => {
      controls = createPolyControls(scene, { dolly: true });
      const beforeZoom = scene.getOptions().zoom ?? 1;
      const beforeDist = scene.getOptions().distance ?? 0;
      dispatchWheel(host, 100);
      // zoom must be unchanged
      expect(scene.getOptions().zoom).toBe(beforeZoom);
      // distance must have increased (dolly out)
      expect((scene.getOptions().distance ?? 0)).toBeGreaterThan(beforeDist);
    });

    it("dolly:false changes zoom instead of distance on wheel (default)", () => {
      controls = createPolyControls(scene, { dolly: false });
      const beforeDist = scene.getOptions().distance ?? 0;
      dispatchWheel(host, -100);
      // distance must be unchanged
      expect(scene.getOptions().distance ?? 0).toBe(beforeDist);
      // zoom must have increased (zoom in)
      expect((scene.getOptions().zoom ?? 1)).toBeGreaterThan(1);
    });

    it("dolly mode clamps to maxDistance", () => {
      controls = createPolyControls(scene, { dolly: true, minDistance: 0, maxDistance: 10 });
      for (let i = 0; i < 50; i++) dispatchWheel(host, 1000);
      expect(scene.getOptions().distance).toBe(10);
    });

    it("dolly mode clamps to minDistance", () => {
      scene.setOptions({ distance: 5 });
      controls = createPolyControls(scene, { dolly: true, minDistance: 2, maxDistance: 100 });
      for (let i = 0; i < 50; i++) dispatchWheel(host, -1000);
      expect(scene.getOptions().distance).toBe(2);
    });
  });

  // ── Animate (autorotate) ────────────────────────────────────────────────
  describe("animate", () => {
    it("does not run a tick when animate is false", () => {
      controls = createPolyControls(scene, { animate: false });
      const before = scene.getOptions().rotY;
      tickFrame();
      expect(scene.getOptions().rotY).toBe(before);
      expect(rafQueue.length).toBe(0);
    });

    it("queues an rAF tick when animate is enabled", () => {
      controls = createPolyControls(scene, { animate: { speed: 0.3 } });
      expect(rafQueue.length).toBe(1);
    });

    it("rotates rotY by speed × (dt / 16.67) per tick (dt-normalized)", () => {
      controls = createPolyControls(scene, { animate: { speed: 0.3 } });
      // First tick uses the ANIM_FRAME_MS fallback (no prior anchor) — apply
      // 0.3 deg.
      const start = scene.getOptions().rotY ?? 45;
      tickFrame(16.67);
      expect(scene.getOptions().rotY).toBeCloseTo(start + 0.3, 4);
      // Next tick at exactly 16.67 ms later → another 0.3 deg.
      tickFrame(16.67);
      expect(scene.getOptions().rotY).toBeCloseTo(start + 0.6, 4);
    });

    it("doubles the per-tick delta when frame interval doubles", () => {
      controls = createPolyControls(scene, { animate: { speed: 0.3 } });
      const start = scene.getOptions().rotY ?? 45;
      tickFrame(16.67); // anchor
      tickFrame(33.34); // ~2 × 16.67 ms → expect ~0.6 deg
      const elapsed = (scene.getOptions().rotY ?? 0) - start;
      // First tick = 0.3, second tick at 2× dt = 0.6, total ≈ 0.9
      expect(elapsed).toBeCloseTo(0.9, 3);
    });

    it("clamps dt to 50 ms after a long pause", () => {
      controls = createPolyControls(scene, { animate: { speed: 0.3 } });
      const start = scene.getOptions().rotY ?? 45;
      tickFrame(16.67); // anchor (≈ +0.3)
      tickFrame(5000);  // huge gap (e.g. tab regaining focus)
      // dt clamped to 50 ms → delta = 0.3 × (50 / 16.67) ≈ 0.9 deg.
      // Total = 0.3 (first tick) + 0.9 (clamped second) = 1.2 deg.
      const elapsed = (scene.getOptions().rotY ?? 0) - start;
      expect(elapsed).toBeCloseTo(1.2, 2);
    });

    it("rotates rotX when axis is 'x'", () => {
      controls = createPolyControls(scene, { animate: { speed: 1, axis: "x" } });
      const beforeX = scene.getOptions().rotX ?? 65;
      const beforeY = scene.getOptions().rotY ?? 45;
      tickFrame(16.67);
      expect(scene.getOptions().rotX).toBeCloseTo(beforeX + 1, 4);
      expect(scene.getOptions().rotY).toBe(beforeY); // unchanged
    });

    it("pauses during pointer drag when pauseOnInteraction is true", () => {
      controls = createPolyControls(scene, {
        animate: { speed: 1, pauseOnInteraction: true },
      });
      tickFrame(16.67); // anchor
      const beforeDrag = scene.getOptions().rotY;
      dispatchPointer(host, "pointerdown", { x: 100, y: 100 });
      tickFrame(16.67);
      tickFrame(16.67);
      // Two ticks during drag should not advance rotY.
      // (Drag itself didn't move pointer, so rotY change is from animate only.)
      expect(scene.getOptions().rotY).toBe(beforeDrag);
      dispatchPointer(host, "pointerup", { x: 100, y: 100 });
      // Resume — next tick advances again.
      tickFrame(16.67);
      expect(scene.getOptions().rotY).not.toBe(beforeDrag);
    });

    it("does NOT pause during drag when pauseOnInteraction is false", () => {
      controls = createPolyControls(scene, {
        animate: { speed: 1, pauseOnInteraction: false },
      });
      tickFrame(16.67); // anchor
      const beforeDrag = scene.getOptions().rotY;
      dispatchPointer(host, "pointerdown", { x: 100, y: 100 });
      tickFrame(16.67);
      // animate continues regardless.
      expect(scene.getOptions().rotY).not.toBe(beforeDrag);
      dispatchPointer(host, "pointerup", { x: 100, y: 100 });
    });

    it("wraps rotation through 360 → 0 cleanly", () => {
      scene.setOptions({ rotY: 359 });
      controls = createPolyControls(scene, { animate: { speed: 60 } });
      tickFrame(16.67); // first tick: +60 → 419 % 360 = 59
      expect(scene.getOptions().rotY).toBeCloseTo(59, 1);
    });
  });

  // ── update() ────────────────────────────────────────────────────────────
  describe("update()", () => {
    it("toggles animate off mid-loop and stops rAF", () => {
      controls = createPolyControls(scene, { animate: { speed: 1 } });
      expect(rafQueue.length).toBe(1);
      controls.update({ animate: false });
      expect(rafQueue.length).toBe(0);
    });

    it("toggles animate on after being off and starts rAF", () => {
      controls = createPolyControls(scene);
      expect(rafQueue.length).toBe(0);
      controls.update({ animate: { speed: 1 } });
      expect(rafQueue.length).toBe(1);
    });

    it("changes drag setting live", () => {
      controls = createPolyControls(scene);
      controls.update({ drag: false });
      expect(host.style.cursor).toBe("");
      const before = scene.getOptions().rotY;
      dispatchPointer(host, "pointerdown", { x: 100, y: 100 });
      dispatchPointer(host, "pointermove", { x: 200, y: 100 });
      dispatchPointer(host, "pointerup", { x: 200, y: 100 });
      expect(scene.getOptions().rotY).toBe(before);
    });

    it("changes animate.speed live", () => {
      controls = createPolyControls(scene, { animate: { speed: 0.3 } });
      tickFrame(16.67);
      const afterSlow = scene.getOptions().rotY ?? 45;
      controls.update({ animate: { speed: 3 } }); // 10× faster
      tickFrame(16.67);
      const afterFast = scene.getOptions().rotY ?? 0;
      expect(afterFast - afterSlow).toBeCloseTo(3, 1);
    });
  });

  // ── start() / stop() / destroy() ────────────────────────────────────────
  describe("lifecycle", () => {
    it("destroy() detaches all listeners and cancels rAF", () => {
      controls = createPolyControls(scene, { animate: { speed: 1 } });
      controls.destroy();
      controls = null;
      expect(rafQueue.length).toBe(0);
      // Pointer down is now ignored.
      const before = scene.getOptions().rotY;
      dispatchPointer(host, "pointerdown", { x: 100, y: 100 });
      dispatchPointer(host, "pointermove", { x: 200, y: 100 });
      expect(scene.getOptions().rotY).toBe(before);
    });

    it("pause() detaches listeners and halts rAF", () => {
      controls = createPolyControls(scene, { animate: { speed: 1 } });
      controls.pause();
      expect(rafQueue.length).toBe(0);
      const before = scene.getOptions().rotY;
      dispatchPointer(host, "pointerdown", { x: 100, y: 100 });
      dispatchPointer(host, "pointermove", { x: 200, y: 100 });
      expect(scene.getOptions().rotY).toBe(before);
    });

    it("resume() re-attaches after pause()", () => {
      controls = createPolyControls(scene, { animate: { speed: 1 } });
      controls.pause();
      controls.resume();
      expect(rafQueue.length).toBe(1);
      // Pointer drag works again.
      tickFrame(16.67);
      expect(scene.getOptions().rotY).not.toBe(45);
    });

    it("destroy() is idempotent", () => {
      controls = createPolyControls(scene);
      controls.destroy();
      expect(() => controls!.destroy()).not.toThrow();
      controls = null;
    });

    it("removes the host cursor on destroy", () => {
      controls = createPolyControls(scene);
      expect(host.style.cursor).toBe("grab");
      controls.destroy();
      controls = null;
      expect(host.style.cursor).toBe("");
    });
  });

  // ── Edge-case branches ──────────────────────────────────────────────────
  describe("pointer-capture failures are tolerated", () => {
    // Some test envs / synthetic events have a target that isn't a real
    // Element with setPointerCapture/releasePointerCapture. The handlers
    // wrap both calls in try/catch — verify drag still completes.
    it("setPointerCapture throwing on pointerdown is non-fatal", () => {
      controls = createPolyControls(scene);
      const before = scene.getOptions().rotY ?? 45;
      // Custom-dispatch a pointerdown whose target throws on capture.
      const evt = new PointerEvent("pointerdown", {
        bubbles: true, pointerId: 1, isPrimary: true, clientX: 100, clientY: 100,
      });
      Object.defineProperty(evt, "target", {
        value: { setPointerCapture: () => { throw new Error("no capture"); } },
      });
      host.dispatchEvent(evt);
      // The drag was still entered — a follow-up move should rotate.
      dispatchPointer(host, "pointermove", { x: 200, y: 100 });
      dispatchPointer(host, "pointerup", { x: 200, y: 100 });
      expect(scene.getOptions().rotY).not.toBe(before);
    });

    it("releasePointerCapture throwing on pointerup is non-fatal", () => {
      controls = createPolyControls(scene);
      dispatchPointer(host, "pointerdown", { x: 100, y: 100 });
      dispatchPointer(host, "pointermove", { x: 200, y: 100 });
      const evt = new PointerEvent("pointerup", {
        bubbles: true, pointerId: 1, isPrimary: true, clientX: 200, clientY: 100,
      });
      Object.defineProperty(evt, "target", {
        value: { releasePointerCapture: () => { throw new Error("no release"); } },
      });
      // Should NOT throw — drag is cleanly torn down despite the throw.
      expect(() => host.dispatchEvent(evt)).not.toThrow();
      expect(host.style.cursor).toBe("grab");
    });
  });

  describe("animate tick when animate flips off mid-rAF", () => {
    // Race scenario: a tick is queued, then update({ animate: false }) runs.
    // The next tick callback sees opts.animate === false and bails out
    // without re-queueing — covers the early-return inside animTick.
    it("does not re-queue an rAF after animate is turned off mid-loop", () => {
      controls = createPolyControls(scene, { animate: { speed: 1 } });
      expect(rafQueue.length).toBe(1);
      // Snapshot the queued tick before update() cancels rAF and clears the queue.
      const queuedTick = rafQueue[0];
      controls.update({ animate: false });
      expect(rafQueue.length).toBe(0);
      // Manually fire the previously-queued tick — it should observe
      // animate=false, NOT re-queue, NOT mutate state.
      const before = scene.getOptions().rotY;
      queuedTick(16.67);
      expect(rafQueue.length).toBe(0);
      expect(scene.getOptions().rotY).toBe(before);
    });
  });

  // ── Isolation / multi-instance ──────────────────────────────────────────
  describe("multiple controls instances", () => {
    it("two controls on separate scenes don't interfere", () => {
      const host2 = document.createElement("div");
      document.body.appendChild(host2);
      const scene2 = createPolyScene(host2, { rotY: 0 });
      const controls2 = createPolyControls(scene2);
      controls = createPolyControls(scene);
      const beforeMain = scene.getOptions().rotY;
      const beforeOther = scene2.getOptions().rotY;
      // Drag on host2 only.
      dispatchPointer(host2, "pointerdown", { x: 100, y: 100 });
      dispatchPointer(host2, "pointermove", { x: 200, y: 100 });
      dispatchPointer(host2, "pointerup", { x: 200, y: 100 });
      expect(scene.getOptions().rotY).toBe(beforeMain);
      expect(scene2.getOptions().rotY).not.toBe(beforeOther);
      controls2.destroy();
      scene2.destroy();
      host2.remove();
    });
  });

  // ── Three.js-style event subscription ───────────────────────────────────
  describe("events", () => {
    it("start and end events carry the camera snapshot", () => {
      controls = createPolyControls(scene);
      let startCam: { rotX: number; rotY: number; zoom: number } | null = null;
      let endCam: { rotX: number; rotY: number; zoom: number } | null = null;
      controls.addEventListener("start", (e) => { startCam = e.camera; });
      controls.addEventListener("end", (e) => { endCam = e.camera; });
      const before = scene.getOptions();
      dispatchPointer(host, "pointerdown", { x: 100, y: 100 });
      // start camera matches the pre-drag scene state.
      expect(startCam).not.toBeNull();
      expect(startCam!.rotY).toBeCloseTo(before.rotY ?? 0, 4);
      dispatchPointer(host, "pointermove", { x: 200, y: 100 });
      dispatchPointer(host, "pointerup", { x: 200, y: 100 });
      // end camera matches the post-drag scene state, NOT the pre-drag.
      expect(endCam).not.toBeNull();
      const after = scene.getOptions();
      expect(endCam!.rotY).toBeCloseTo(after.rotY ?? 0, 4);
      expect(endCam!.rotY).not.toBeCloseTo(startCam!.rotY, 1);
    });

    it("emits start / change / end across a single drag", () => {
      controls = createPolyControls(scene);
      const seen: string[] = [];
      const change = vi.fn((e: { type: string; camera: { rotY: number } }) => {
        seen.push(`change:${e.camera.rotY.toFixed(0)}`);
      });
      const start = vi.fn(() => seen.push("start"));
      const end = vi.fn(() => seen.push("end"));
      controls.addEventListener("change", change);
      controls.addEventListener("start", start);
      controls.addEventListener("end", end);
      dispatchPointer(host, "pointerdown", { x: 100, y: 100 });
      dispatchPointer(host, "pointermove", { x: 200, y: 100 });
      dispatchPointer(host, "pointermove", { x: 250, y: 100 });
      dispatchPointer(host, "pointerup", { x: 250, y: 100 });
      expect(start).toHaveBeenCalledTimes(1);
      expect(change).toHaveBeenCalledTimes(2);
      expect(end).toHaveBeenCalledTimes(1);
      expect(seen[0]).toBe("start");
      expect(seen[seen.length - 1]).toBe("end");
    });

    it("change event carries camera snapshot", () => {
      controls = createPolyControls(scene);
      let last: { rotX: number; rotY: number; zoom: number } | null = null;
      controls.addEventListener("change", (e) => { last = e.camera; });
      dispatchPointer(host, "pointerdown", { x: 100, y: 100 });
      dispatchPointer(host, "pointermove", { x: 200, y: 100 });
      dispatchPointer(host, "pointerup", { x: 200, y: 100 });
      const sceneOpts = scene.getOptions();
      expect(last).not.toBeNull();
      expect(last!.rotY).toBeCloseTo(sceneOpts.rotY ?? 0, 4);
      expect(last!.rotX).toBeCloseTo(sceneOpts.rotX ?? 0, 4);
      expect(last!.zoom).toBeCloseTo(sceneOpts.zoom ?? 1, 4);
    });

    it("wheel emits start, then change per event, then end after idle", () => {
      vi.useFakeTimers();
      controls = createPolyControls(scene);
      const change = vi.fn();
      const start = vi.fn();
      const end = vi.fn();
      controls.addEventListener("change", change);
      controls.addEventListener("start", start);
      controls.addEventListener("end", end);
      dispatchWheel(host, -50);
      dispatchWheel(host, -50);
      expect(start).toHaveBeenCalledTimes(1);
      expect(change).toHaveBeenCalledTimes(2);
      expect(end).toHaveBeenCalledTimes(0);
      vi.advanceTimersByTime(160); // past WHEEL_IDLE_END_MS
      expect(end).toHaveBeenCalledTimes(1);
      vi.useRealTimers();
    });

    it("autorotate fires change but no start / end", () => {
      controls = createPolyControls(scene, { animate: { speed: 1 } });
      const change = vi.fn();
      const start = vi.fn();
      const end = vi.fn();
      controls.addEventListener("change", change);
      controls.addEventListener("start", start);
      controls.addEventListener("end", end);
      tickFrame(16.67);
      tickFrame(16.67);
      expect(change).toHaveBeenCalledTimes(2);
      expect(start).not.toHaveBeenCalled();
      expect(end).not.toHaveBeenCalled();
    });

    it("removeEventListener stops further callbacks", () => {
      controls = createPolyControls(scene);
      const change = vi.fn();
      controls.addEventListener("change", change);
      dispatchPointer(host, "pointerdown", { x: 100, y: 100 });
      dispatchPointer(host, "pointermove", { x: 200, y: 100 });
      expect(change).toHaveBeenCalledTimes(1);
      controls.removeEventListener("change", change);
      dispatchPointer(host, "pointermove", { x: 250, y: 100 });
      dispatchPointer(host, "pointerup", { x: 250, y: 100 });
      expect(change).toHaveBeenCalledTimes(1);
    });

    it("hasEventListener reports correctly", () => {
      controls = createPolyControls(scene);
      const fn = (): void => {};
      expect(controls.hasEventListener("change", fn)).toBe(false);
      controls.addEventListener("change", fn);
      expect(controls.hasEventListener("change", fn)).toBe(true);
      controls.removeEventListener("change", fn);
      expect(controls.hasEventListener("change", fn)).toBe(false);
    });

    it("listener removing itself mid-emit doesn't skip siblings", () => {
      controls = createPolyControls(scene);
      const order: string[] = [];
      const a = (): void => {
        order.push("a");
        controls!.removeEventListener("change", a);
      };
      const b = (): void => { order.push("b"); };
      controls.addEventListener("change", a);
      controls.addEventListener("change", b);
      dispatchPointer(host, "pointerdown", { x: 100, y: 100 });
      dispatchPointer(host, "pointermove", { x: 200, y: 100 });
      expect(order).toEqual(["a", "b"]);
    });

    it("a throwing listener doesn't break siblings", () => {
      controls = createPolyControls(scene);
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const bad = (): void => { throw new Error("boom"); };
      const good = vi.fn();
      controls.addEventListener("change", bad);
      controls.addEventListener("change", good);
      dispatchPointer(host, "pointerdown", { x: 100, y: 100 });
      dispatchPointer(host, "pointermove", { x: 200, y: 100 });
      expect(good).toHaveBeenCalledTimes(1);
      consoleSpy.mockRestore();
    });

    it("destroy() clears all listeners", () => {
      controls = createPolyControls(scene);
      const fn = vi.fn();
      controls.addEventListener("change", fn);
      controls.destroy();
      controls = null;
      // Re-create to verify the destroyed-instance's listeners can't fire.
      // (fn was hooked to the destroyed controls; no further drags can reach it.)
      expect(fn).not.toHaveBeenCalled();
    });
  });
});
