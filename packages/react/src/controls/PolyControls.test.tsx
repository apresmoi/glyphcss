/**
 * <PolyOrbitControls> tests — verifies it attaches to the existing
 * PolyCameraContext, runs animate with dt-clamping, mutates camera state
 * on drag/wheel, and cleans up on unmount.
 *
 * Because PolyOrbitControls reaches into the camera context (cameraElRef +
 * applyTransformDirect), the tests render it inside <PolyCamera><PolyScene>.
 * We deliberately leave PolyCamera's props minimal so we're
 * exercising PolyOrbitControls's handlers in isolation.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import React, { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { PolyCamera, type PolyCameraProps } from "../camera/PolyCamera";
import { PolyScene } from "../scene/PolyScene";
import { PolyOrbitControls, type PolyOrbitControlsProps } from "./PolyOrbitControls";
import { PolyMapControls } from "./PolyMapControls";

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

function dispatchWheel(el: HTMLElement, deltaY: number): void {
  el.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY }));
}

function findCameraEl(container: HTMLElement): HTMLElement {
  const el = container.querySelector(".polycss-camera") as HTMLElement | null;
  if (!el) throw new Error("no .polycss-camera found");
  return el;
}

function findSceneEl(container: HTMLElement): HTMLElement {
  const el = container.querySelector(".polycss-scene") as HTMLElement | null;
  if (!el) throw new Error("no .polycss-scene found");
  return el;
}

function orbitTree(controlsProps: PolyOrbitControlsProps = {}, cameraProps: PolyCameraProps = {}): ReactNode {
  return (
    <PolyCamera {...cameraProps}>
      <PolyScene>
        <PolyOrbitControls {...controlsProps} />
      </PolyScene>
    </PolyCamera>
  );
}

function mapTree(cameraProps: PolyCameraProps = {}): ReactNode {
  return (
    <PolyCamera {...cameraProps}>
      <PolyScene>
        <PolyMapControls />
      </PolyScene>
    </PolyCamera>
  );
}

describe("PolyOrbitControls", () => {
  let container: HTMLElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    installManualRaf();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  // ── Render & defaults ───────────────────────────────────────────────────
  it("renders nothing visible (returns null)", () => {
    root = createRoot(container);
    act(() => root.render(orbitTree()));
    expect(container.querySelectorAll("[data-polycontrols]").length).toBe(0);
  });

  it("attaches drag handlers by default (camera el gets grab cursor + touch-action)", () => {
    root = createRoot(container);
    act(() => root.render(orbitTree()));
    const cameraEl = findCameraEl(container);
    expect(cameraEl.style.cursor).toBe("grab");
    expect(cameraEl.style.touchAction).toBe("none");
  });

  it("does not start an rAF loop when animate is omitted", () => {
    root = createRoot(container);
    act(() => root.render(orbitTree()));
    expect(rafQueue.length).toBe(0);
  });

  it("does not attach drag handlers when drag={false}", () => {
    root = createRoot(container);
    act(() => root.render(orbitTree({ drag: false })));
    const cameraEl = findCameraEl(container);
    expect(cameraEl.style.cursor).toBe("");
  });

  // ── Pointer drag: orbit (left-drag) ────────────────────────────────────
  it("left-drag updates rotY in camera state (orbit)", () => {
    root = createRoot(container);
    act(() => root.render(orbitTree({}, { rotY: 45 })));
    const cameraEl = findCameraEl(container);
    dispatchPointer(cameraEl, "pointerdown", { x: 100, y: 100 });
    dispatchPointer(cameraEl, "pointermove", { x: 200, y: 100 });
    dispatchPointer(cameraEl, "pointerup", { x: 200, y: 100 });
    // Drag right (+100 px) → rotY decreases by 100/4 = 25 deg → 45 - 25 = 20.
    const sceneEl = findSceneEl(container);
    expect(sceneEl.style.transform).toContain("rotate(20deg)");
  });

  // ── Wheel zoom ──────────────────────────────────────────────────────────
  it("wheel zoom updates scene transform scale", () => {
    root = createRoot(container);
    act(() => root.render(orbitTree({}, { zoom: 1 })));
    const cameraEl = findCameraEl(container);
    dispatchWheel(cameraEl, -100);
    const sceneEl = findSceneEl(container);
    expect(sceneEl.style.transform).toMatch(/scale\(1\.\d+\)/);
  });

  it("does not handle wheel when wheel={false}", () => {
    root = createRoot(container);
    act(() => root.render(orbitTree({ wheel: false }, { zoom: 1 })));
    const cameraEl = findCameraEl(container);
    dispatchWheel(cameraEl, -100);
    const sceneEl = findSceneEl(container);
    expect(sceneEl.style.transform).toContain("scale(1)");
  });

  // ── Animate ─────────────────────────────────────────────────────────────
  it("animate queues an rAF tick", () => {
    root = createRoot(container);
    act(() => root.render(orbitTree({ animate: { speed: 0.3 } })));
    expect(rafQueue.length).toBe(1);
  });

  it("animate rotates rotY in the scene transform per tick", () => {
    root = createRoot(container);
    act(() => root.render(orbitTree({ animate: { speed: 1 } }, { rotY: 0 })));
    const baseTime = { now: 0 };
    act(() => tickFrame(16.67, baseTime));
    const sceneEl = findSceneEl(container);
    // First tick uses ANIM_FRAME_MS fallback → delta = 1 deg.
    expect(sceneEl.style.transform).toContain("rotate(1deg)");
  });

  it("dt-clamps a long pause to 50 ms", () => {
    root = createRoot(container);
    act(() => root.render(orbitTree({ animate: { speed: 1 } }, { rotY: 0 })));
    const baseTime = { now: 0 };
    act(() => tickFrame(16.67, baseTime));    // anchor → +1 deg, rotY = 1
    act(() => tickFrame(5000, baseTime));     // huge gap, clamped to 50 ms
    // delta on second tick = 1 × (50 / 16.67) ≈ 3 deg → rotY ≈ 4 deg.
    const sceneEl = findSceneEl(container);
    expect(sceneEl.style.transform).toMatch(/rotate\(4(\.\d+)?deg\)/);
  });

  it("animate axis 'x' rotates rotX, leaves rotY untouched", () => {
    root = createRoot(container);
    act(() => root.render(orbitTree({ animate: { speed: 1, axis: "x" } }, { rotX: 30, rotY: 60 })));
    const baseTime = { now: 0 };
    act(() => tickFrame(16.67, baseTime));
    const sceneEl = findSceneEl(container);
    expect(sceneEl.style.transform).toContain("rotateX(31deg)"); // 30 + 1
    expect(sceneEl.style.transform).toContain("rotate(60deg)");  // unchanged
  });

  // ── update / unmount ────────────────────────────────────────────────────
  it("flipping animate off via re-render stops the rAF loop", () => {
    root = createRoot(container);
    act(() => root.render(orbitTree({ animate: { speed: 1 } })));
    expect(rafQueue.length).toBe(1);
    act(() => root.render(orbitTree({ animate: false })));
    expect(rafQueue.length).toBe(0);
  });

  it("unmount removes pointer listeners and cancels rAF", () => {
    root = createRoot(container);
    act(() => root.render(orbitTree({ animate: { speed: 1 } })));
    const cameraEl = findCameraEl(container);
    act(() => root.render(<div />));
    expect(rafQueue.length).toBe(0);
    expect(cameraEl.style.cursor).toBe("");
  });

  // ── Edge-case branches ────────────────────────────────────────────────
  it("invert as a number multiplies sensitivity in the default direction", () => {
    root = createRoot(container);
    act(() => root.render(orbitTree({ invert: 2 }, { rotY: 0 })));
    const cameraEl = findCameraEl(container);
    dispatchPointer(cameraEl, "pointerdown", { x: 100, y: 100 });
    dispatchPointer(cameraEl, "pointermove", { x: 200, y: 100 });
    dispatchPointer(cameraEl, "pointerup", { x: 200, y: 100 });
    // invert:2 → 2× sensitivity in the default (- dX) direction
    // → -50 deg → wraps to 310.
    const sceneEl = findSceneEl(container);
    expect(sceneEl.style.transform).toContain("rotate(310deg)");
  });

  it("animate tick re-queues without mutating state when paused by drag", () => {
    root = createRoot(container);
    act(() => root.render(orbitTree({ animate: { speed: 1 } }, { rotY: 0 })));
    const cameraEl = findCameraEl(container);
    const baseTime = { now: 0 };
    dispatchPointer(cameraEl, "pointerdown", { x: 100, y: 100 });
    const sceneEl = findSceneEl(container);
    const before = sceneEl.style.transform;
    act(() => tickFrame(16.67, baseTime));
    act(() => tickFrame(16.67, baseTime));
    expect(sceneEl.style.transform).toBe(before);
    expect(rafQueue.length).toBe(1);
    dispatchPointer(cameraEl, "pointerup", { x: 100, y: 100 });
  });

  it("animate tick is a no-op when animate prop has flipped to false", () => {
    root = createRoot(container);
    act(() => root.render(orbitTree({ animate: { speed: 1 } }, { rotY: 0 })));
    expect(rafQueue.length).toBe(1);
    const queuedTick = rafQueue[0];
    act(() => root.render(orbitTree({ animate: false })));
    expect(rafQueue.length).toBe(0);
    queuedTick(16.67);
    expect(rafQueue.length).toBe(0);
  });

  // ── Event prop callbacks ──────────────────────────────────────────────
  describe("event prop callbacks", () => {
    it("onChange fires per pointermove with the post-mutation camera", () => {
      const onChange = vi.fn();
      root = createRoot(container);
      act(() => root.render(orbitTree({ onChange }, { rotY: 45 })));
      const cameraEl = findCameraEl(container);
      dispatchPointer(cameraEl, "pointerdown", { x: 100, y: 100 });
      dispatchPointer(cameraEl, "pointermove", { x: 200, y: 100 });
      dispatchPointer(cameraEl, "pointermove", { x: 250, y: 100 });
      dispatchPointer(cameraEl, "pointerup", { x: 250, y: 100 });
      expect(onChange).toHaveBeenCalledTimes(2);
      const [lastCall] = onChange.mock.calls[onChange.mock.calls.length - 1];
      // Final rotY = 45 - (250-100)/4 = 45 - 37.5 = 7.5
      expect(lastCall.rotY).toBeCloseTo(7.5, 4);
    });

    it("onInteractionStart / End fire once per drag gesture and carry camera", () => {
      const onInteractionStart = vi.fn();
      const onInteractionEnd = vi.fn();
      root = createRoot(container);
      act(() => root.render(orbitTree({ onInteractionStart, onInteractionEnd }, { rotY: 45 })));
      const cameraEl = findCameraEl(container);
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

    it("wheel emits onInteractionStart, onChange per event, onInteractionEnd after idle", () => {
      vi.useFakeTimers();
      const onInteractionStart = vi.fn();
      const onChange = vi.fn();
      const onInteractionEnd = vi.fn();
      root = createRoot(container);
      act(() => root.render(orbitTree({ onChange, onInteractionStart, onInteractionEnd })));
      const cameraEl = findCameraEl(container);
      dispatchWheel(cameraEl, -50);
      dispatchWheel(cameraEl, -50);
      expect(onInteractionStart).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledTimes(2);
      expect(onInteractionEnd).toHaveBeenCalledTimes(0);
      vi.advanceTimersByTime(160);
      expect(onInteractionEnd).toHaveBeenCalledTimes(1);
      vi.useRealTimers();
    });

    it("autorotate fires onChange per tick but no interaction start/end", () => {
      const onChange = vi.fn();
      const onInteractionStart = vi.fn();
      const onInteractionEnd = vi.fn();
      root = createRoot(container);
      act(() => root.render(orbitTree({
        animate: { speed: 1 },
        onChange,
        onInteractionStart,
        onInteractionEnd,
      })));
      const baseTime = { now: 0 };
      act(() => tickFrame(16.67, baseTime));
      act(() => tickFrame(16.67, baseTime));
      expect(onChange).toHaveBeenCalledTimes(2);
      expect(onInteractionStart).not.toHaveBeenCalled();
      expect(onInteractionEnd).not.toHaveBeenCalled();
    });

    it("re-rendering with a new onChange swaps to the new fn without re-attaching listeners", () => {
      const first = vi.fn();
      const second = vi.fn();
      root = createRoot(container);
      act(() => root.render(orbitTree({ onChange: first }, { rotY: 0 })));
      const cameraEl = findCameraEl(container);
      dispatchPointer(cameraEl, "pointerdown", { x: 100, y: 100 });
      dispatchPointer(cameraEl, "pointermove", { x: 200, y: 100 });
      dispatchPointer(cameraEl, "pointerup", { x: 200, y: 100 });
      expect(first).toHaveBeenCalledTimes(1);
      act(() => root.render(orbitTree({ onChange: second }, { rotY: 0 })));
      dispatchPointer(cameraEl, "pointerdown", { x: 100, y: 100 });
      dispatchPointer(cameraEl, "pointermove", { x: 200, y: 100 });
      dispatchPointer(cameraEl, "pointerup", { x: 200, y: 100 });
      expect(first).toHaveBeenCalledTimes(1); // unchanged
      expect(second).toHaveBeenCalledTimes(1);
    });

    it("a throwing onChange listener doesn't break siblings or future events", () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const bad = (): void => { throw new Error("boom"); };
      root = createRoot(container);
      act(() => root.render(orbitTree({ onChange: bad })));
      const cameraEl = findCameraEl(container);
      dispatchPointer(cameraEl, "pointerdown", { x: 100, y: 100 });
      expect(() => {
        dispatchPointer(cameraEl, "pointermove", { x: 200, y: 100 });
      }).not.toThrow();
      dispatchPointer(cameraEl, "pointerup", { x: 200, y: 100 });
      consoleSpy.mockRestore();
    });
  });
});

describe("PolyMapControls", () => {
  let container: HTMLElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    installManualRaf();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it("attaches drag handlers by default", () => {
    root = createRoot(container);
    act(() => root.render(mapTree()));
    const cameraEl = findCameraEl(container);
    expect(cameraEl.style.cursor).toBe("grab");
  });

  it("left-drag pans target (not orbit)", () => {
    root = createRoot(container);
    act(() => root.render(mapTree({ rotY: 0, rotX: 0 })));
    const cameraEl = findCameraEl(container);
    dispatchPointer(cameraEl, "pointerdown", { x: 100, y: 100 });
    dispatchPointer(cameraEl, "pointermove", { x: 200, y: 100 });
    dispatchPointer(cameraEl, "pointerup", { x: 200, y: 100 });
    // rotY should be unchanged — pan, not orbit
    const sceneEl = findSceneEl(container);
    expect(sceneEl.style.transform).toContain("rotate(0deg)");
    // The translate3d should have changed — target moved
    expect(sceneEl.style.transform).toContain("translate3d(");
  });
});
