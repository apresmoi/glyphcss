/**
 * Tests for createPolyMapControls.
 *
 * Covers: construction defaults, pan drag (left-drag moves target, not orbit),
 * right-drag orbits, wheel zoom/dolly, animate loop, lifecycle, and events.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPolyScene, type PolySceneHandle } from "./createPolyScene";
import { createPolyMapControls, type PolyMapControlsHandle } from "./createPolyMapControls";

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
  el.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId: init.pointerId ?? 1,
      isPrimary: init.isPrimary ?? true,
      clientX: init.x,
      clientY: init.y,
      shiftKey: init.shiftKey ?? false,
    }),
  );
}

function dispatchWheel(el: HTMLElement, deltaY: number, deltaMode = 0): void {
  el.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY, deltaMode }));
}

describe("createPolyMapControls", () => {
  let host: HTMLElement;
  let scene: PolySceneHandle;
  let controls: PolyMapControlsHandle | null;

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
      controls = createPolyMapControls(scene);
      expect(host.style.cursor).toBe("grab");
      expect(host.style.touchAction).toBe("none");
      expect(host.style.userSelect).toBe("none");
    });

    it("does not start an rAF loop when animate is omitted", () => {
      controls = createPolyMapControls(scene);
      expect(rafQueue.length).toBe(0);
    });
  });

  // ── Pan drag (left-drag) ────────────────────────────────────────────────
  describe("pan drag", () => {
    it("left-drag moves target (pan), does not change rotY", () => {
      controls = createPolyMapControls(scene);
      const beforeRotY = scene.getOptions().rotY ?? 45;
      const beforeTarget = scene.getOptions().target ?? [0, 0, 0];
      dispatchPointer(host, "pointerdown", { x: 100, y: 100 });
      dispatchPointer(host, "pointermove", { x: 200, y: 100 });
      dispatchPointer(host, "pointerup", { x: 200, y: 100 });
      // rotY should be unchanged (pan, not orbit)
      expect(scene.getOptions().rotY).toBe(beforeRotY);
      // target should have changed
      const afterTarget = scene.getOptions().target ?? [0, 0, 0];
      expect(afterTarget[0] !== beforeTarget[0] || afterTarget[1] !== beforeTarget[1]).toBe(true);
    });

    it("Shift+left-drag orbits (rotY changes, target unchanged)", () => {
      controls = createPolyMapControls(scene);
      const beforeRotY = scene.getOptions().rotY ?? 45;
      const beforeTarget = scene.getOptions().target ?? [0, 0, 0];
      dispatchPointer(host, "pointerdown", { x: 100, y: 100 });
      dispatchPointer(host, "pointermove", { x: 200, y: 100, shiftKey: true });
      dispatchPointer(host, "pointerup", { x: 200, y: 100 });
      // rotY should have changed (orbit on shift+drag)
      const afterRotY = scene.getOptions().rotY ?? 0;
      expect(afterRotY).not.toBe(beforeRotY);
      // target should be unchanged
      const afterTarget = scene.getOptions().target ?? [0, 0, 0];
      expect(afterTarget[0]).toBeCloseTo(beforeTarget[0], 4);
      expect(afterTarget[1]).toBeCloseTo(beforeTarget[1], 4);
    });
  });

  // ── Wheel zoom ──────────────────────────────────────────────────────────
  describe("wheel zoom", () => {
    it("zoom in on negative deltaY", () => {
      controls = createPolyMapControls(scene);
      const before = scene.getOptions().zoom ?? 1;
      dispatchWheel(host, -100);
      expect(scene.getOptions().zoom ?? 0).toBeGreaterThan(before);
    });

    it("dolly:true changes distance instead of zoom", () => {
      controls = createPolyMapControls(scene, { dolly: true });
      const beforeZoom = scene.getOptions().zoom ?? 1;
      dispatchWheel(host, 100);
      expect(scene.getOptions().zoom).toBe(beforeZoom);
      expect(scene.getOptions().distance ?? 0).toBeGreaterThan(0);
    });
  });

  // ── Animate ─────────────────────────────────────────────────────────────
  describe("animate", () => {
    it("queues an rAF tick when animate is enabled", () => {
      controls = createPolyMapControls(scene, { animate: { speed: 0.3 } });
      expect(rafQueue.length).toBe(1);
    });

    it("rotates rotY per tick", () => {
      controls = createPolyMapControls(scene, { animate: { speed: 1 } });
      const start = scene.getOptions().rotY ?? 45;
      tickFrame(16.67);
      expect(scene.getOptions().rotY).toBeCloseTo(start + 1, 4);
    });
  });

  // ── Lifecycle ────────────────────────────────────────────────────────────
  describe("lifecycle", () => {
    it("pause() detaches listeners", () => {
      controls = createPolyMapControls(scene, { animate: { speed: 1 } });
      controls.pause();
      expect(rafQueue.length).toBe(0);
      const before = scene.getOptions().rotY;
      dispatchPointer(host, "pointerdown", { x: 100, y: 100 });
      dispatchPointer(host, "pointermove", { x: 200, y: 100 });
      expect(scene.getOptions().rotY).toBe(before);
    });

    it("resume() re-attaches after pause()", () => {
      controls = createPolyMapControls(scene, { animate: { speed: 1 } });
      controls.pause();
      controls.resume();
      expect(rafQueue.length).toBe(1);
    });

    it("destroy() is idempotent", () => {
      controls = createPolyMapControls(scene);
      controls.destroy();
      expect(() => controls!.destroy()).not.toThrow();
      controls = null;
    });
  });

  // ── Events ───────────────────────────────────────────────────────────────
  describe("events", () => {
    it("emits start/change/end across a drag", () => {
      controls = createPolyMapControls(scene);
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

    it("right-mousedown emits a start event", () => {
      controls = createPolyMapControls(scene);
      const seen: string[] = [];
      controls.addEventListener("start", () => seen.push("start"));
      host.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 2 }));
      expect(seen).toContain("start");
    });
  });
});
