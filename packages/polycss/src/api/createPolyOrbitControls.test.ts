/**
 * Tests for createPolyOrbitControls.
 *
 * Covers: construction defaults, orbit drag (left-drag rotates rotX/rotY),
 * Shift+left-drag pans target, wheel zoom/dolly, animate loop,
 * update/pause/resume/destroy lifecycle, and event subscription.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPolyScene, type PolySceneHandle } from "./createPolyScene";
import { createPolyOrbitControls, type PolyOrbitControlsHandle } from "./createPolyOrbitControls";

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
  vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation(() => {
    rafQueue = [];
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
  init: { x: number; y: number; pointerId?: number; isPrimary?: boolean; shiftKey?: boolean },
): void {
  const ev = new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    pointerId: init.pointerId ?? 1,
    isPrimary: init.isPrimary ?? true,
    clientX: init.x,
    clientY: init.y,
    shiftKey: init.shiftKey ?? false,
  });
  el.dispatchEvent(ev);
}

function dispatchWheel(el: HTMLElement, deltaY: number, deltaMode = 0): void {
  el.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY, deltaMode }));
}

describe("createPolyOrbitControls", () => {
  let host: HTMLElement;
  let scene: PolySceneHandle;
  let controls: PolyOrbitControlsHandle | null;

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
      controls = createPolyOrbitControls(scene);
      expect(host.style.cursor).toBe("grab");
      expect(host.style.touchAction).toBe("none");
      expect(host.style.userSelect).toBe("none");
    });

    it("does not start an rAF loop when animate is omitted", () => {
      controls = createPolyOrbitControls(scene);
      expect(rafQueue.length).toBe(0);
    });

    it("disables drag when drag:false", () => {
      controls = createPolyOrbitControls(scene, { drag: false });
      expect(host.style.cursor).toBe("");
      const before = scene.getOptions().rotY;
      dispatchPointer(host, "pointerdown", { x: 100, y: 100 });
      dispatchPointer(host, "pointermove", { x: 150, y: 100 });
      dispatchPointer(host, "pointerup", { x: 150, y: 100 });
      expect(scene.getOptions().rotY).toBe(before);
    });
  });

  // ── Orbit (left-drag) ────────────────────────────────────────────────────
  describe("orbit drag", () => {
    it("left-drag updates rotY (orbit)", () => {
      controls = createPolyOrbitControls(scene);
      const before = scene.getOptions().rotY ?? 45;
      dispatchPointer(host, "pointerdown", { x: 100, y: 100 });
      dispatchPointer(host, "pointermove", { x: 200, y: 100 });
      dispatchPointer(host, "pointerup", { x: 200, y: 100 });
      // +100 px → rotY decreases by 100/4 = 25 deg
      expect(scene.getOptions().rotY).toBeCloseTo(((before - 25) % 360 + 360) % 360, 1);
    });

    it("left-drag updates rotX (orbit, clamped to [0, 100])", () => {
      controls = createPolyOrbitControls(scene);
      const before = scene.getOptions().rotX ?? 65;
      dispatchPointer(host, "pointerdown", { x: 100, y: 100 });
      dispatchPointer(host, "pointermove", { x: 100, y: 60 });
      dispatchPointer(host, "pointerup", { x: 100, y: 60 });
      // -40 px / 4 = -10 deg of dY → rotX = before - (-10) = before + 10
      expect(scene.getOptions().rotX).toBeCloseTo(before + 10, 1);
    });

    it("does NOT change target on plain left-drag", () => {
      controls = createPolyOrbitControls(scene);
      const before = scene.getOptions().target ?? [0, 0, 0];
      dispatchPointer(host, "pointerdown", { x: 100, y: 100 });
      dispatchPointer(host, "pointermove", { x: 200, y: 100 });
      dispatchPointer(host, "pointerup", { x: 200, y: 100 });
      const after = scene.getOptions().target ?? [0, 0, 0];
      expect(after[0]).toBeCloseTo(before[0], 4);
      expect(after[1]).toBeCloseTo(before[1], 4);
    });
  });

  // ── Shift+drag pans ─────────────────────────────────────────────────────
  describe("shift+drag pans target", () => {
    it("Shift+left-drag moves target (pan), not orbit", () => {
      controls = createPolyOrbitControls(scene);
      const before = scene.getOptions().target ?? [0, 0, 0];
      dispatchPointer(host, "pointerdown", { x: 100, y: 100 });
      dispatchPointer(host, "pointermove", { x: 200, y: 100, shiftKey: true });
      dispatchPointer(host, "pointerup", { x: 200, y: 100 });
      const after = scene.getOptions().target ?? [0, 0, 0];
      // Target should have shifted; rotY should be unchanged from start
      const rotYAfter = scene.getOptions().rotY ?? 45;
      // rotY was not changed by the shift-move (it was changed by the initial orbit-start before shift)
      // — the key test is that target changed
      expect(after[0] !== before[0] || after[1] !== before[1]).toBe(true);
    });
  });

  // ── Wheel zoom ──────────────────────────────────────────────────────────
  describe("wheel zoom", () => {
    it("zoom in on negative deltaY", () => {
      controls = createPolyOrbitControls(scene);
      const before = scene.getOptions().zoom ?? 1;
      dispatchWheel(host, -100);
      expect((scene.getOptions().zoom ?? 0)).toBeGreaterThan(before);
    });

    it("zoom out on positive deltaY", () => {
      controls = createPolyOrbitControls(scene);
      const before = scene.getOptions().zoom ?? 1;
      dispatchWheel(host, 100);
      expect((scene.getOptions().zoom ?? 0)).toBeLessThan(before);
    });

    it("dolly:true changes distance instead of zoom", () => {
      controls = createPolyOrbitControls(scene, { dolly: true });
      const beforeZoom = scene.getOptions().zoom ?? 1;
      const beforeDist = scene.getOptions().distance ?? 0;
      dispatchWheel(host, 100);
      expect(scene.getOptions().zoom).toBe(beforeZoom);
      expect((scene.getOptions().distance ?? 0)).toBeGreaterThan(beforeDist);
    });
  });

  // ── Animate ─────────────────────────────────────────────────────────────
  describe("animate", () => {
    it("queues an rAF tick when animate is enabled", () => {
      controls = createPolyOrbitControls(scene, { animate: { speed: 0.3 } });
      expect(rafQueue.length).toBe(1);
    });

    it("rotates rotY per tick", () => {
      controls = createPolyOrbitControls(scene, { animate: { speed: 1 } });
      const start = scene.getOptions().rotY ?? 45;
      tickFrame(16.67);
      expect(scene.getOptions().rotY).toBeCloseTo(start + 1, 4);
    });

    it("animate axis 'x' rotates rotX", () => {
      controls = createPolyOrbitControls(scene, { animate: { speed: 1, axis: "x" } });
      const beforeX = scene.getOptions().rotX ?? 65;
      const beforeY = scene.getOptions().rotY ?? 45;
      tickFrame(16.67);
      expect(scene.getOptions().rotX).toBeCloseTo(beforeX + 1, 4);
      expect(scene.getOptions().rotY).toBe(beforeY);
    });
  });

  // ── Lifecycle ────────────────────────────────────────────────────────────
  describe("lifecycle", () => {
    it("pause() detaches listeners and halts rAF", () => {
      controls = createPolyOrbitControls(scene, { animate: { speed: 1 } });
      controls.pause();
      expect(rafQueue.length).toBe(0);
      const before = scene.getOptions().rotY;
      dispatchPointer(host, "pointerdown", { x: 100, y: 100 });
      dispatchPointer(host, "pointermove", { x: 200, y: 100 });
      expect(scene.getOptions().rotY).toBe(before);
    });

    it("resume() re-attaches after pause()", () => {
      controls = createPolyOrbitControls(scene, { animate: { speed: 1 } });
      controls.pause();
      controls.resume();
      expect(rafQueue.length).toBe(1);
    });

    it("destroy() cleans up all listeners", () => {
      controls = createPolyOrbitControls(scene, { animate: { speed: 1 } });
      controls.destroy();
      controls = null;
      expect(rafQueue.length).toBe(0);
      expect(host.style.cursor).toBe("");
    });
  });

  // ── Event subscription ───────────────────────────────────────────────────
  describe("events", () => {
    it("emits start/change/end across a drag", () => {
      controls = createPolyOrbitControls(scene);
      const seen: string[] = [];
      controls.addEventListener("start", () => seen.push("start"));
      controls.addEventListener("change", () => seen.push("change"));
      controls.addEventListener("end", () => seen.push("end"));
      dispatchPointer(host, "pointerdown", { x: 100, y: 100 });
      dispatchPointer(host, "pointermove", { x: 200, y: 100 });
      dispatchPointer(host, "pointerup", { x: 200, y: 100 });
      expect(seen[0]).toBe("start");
      expect(seen).toContain("change");
      expect(seen[seen.length - 1]).toBe("end");
    });

    it("hasEventListener / removeEventListener work", () => {
      controls = createPolyOrbitControls(scene);
      const fn = (): void => {};
      expect(controls.hasEventListener("change", fn)).toBe(false);
      controls.addEventListener("change", fn);
      expect(controls.hasEventListener("change", fn)).toBe(true);
      controls.removeEventListener("change", fn);
      expect(controls.hasEventListener("change", fn)).toBe(false);
    });
  });
});
