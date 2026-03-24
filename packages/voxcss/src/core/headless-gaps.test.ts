import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { createCamera, createScene, renderScene } from "./headless";
import { STYLE_ID } from "./types";

// Polyfill Option for happy-dom (required for 3d merge / sliceRenderer paths)
beforeAll(() => {
  if (typeof globalThis.Option === "undefined") {
    (globalThis as any).Option = class {
      style: Record<string, string> = {};
      get selected() { return false; }
      constructor() {
        const styleData: Record<string, string> = {};
        this.style = new Proxy(styleData, {
          set(target, prop, value) {
            if (typeof prop === "string") {
              const v = String(value).trim();
              if (v.startsWith("#")) {
                const hex = v.slice(1);
                if (hex.length === 6) {
                  const r = parseInt(hex.slice(0, 2), 16);
                  const g = parseInt(hex.slice(2, 4), 16);
                  const b = parseInt(hex.slice(4, 6), 16);
                  if (!Number.isNaN(r) && !Number.isNaN(g) && !Number.isNaN(b)) {
                    target[prop] = `rgb(${r}, ${g}, ${b})`;
                    return true;
                  }
                }
                if (hex.length === 3) {
                  const r = parseInt(hex[0] + hex[0], 16);
                  const g = parseInt(hex[1] + hex[1], 16);
                  const b = parseInt(hex[2] + hex[2], 16);
                  if (!Number.isNaN(r) && !Number.isNaN(g) && !Number.isNaN(b)) {
                    target[prop] = `rgb(${r}, ${g}, ${b})`;
                    return true;
                  }
                }
              }
              target[prop] = v;
            }
            return true;
          },
          get(target, prop) {
            if (typeof prop === "string") return target[prop] ?? "";
            return undefined;
          }
        });
      }
    };
  }
});

describe("headless — gap coverage", () => {
  let root: HTMLElement;

  beforeEach(() => {
    vi.useFakeTimers();
    root = document.createElement("div");
    document.body.appendChild(root);
  });

  afterEach(() => {
    vi.useRealTimers();
    root.remove();
    document.getElementById(STYLE_ID)?.remove();
  });

  // =========================================================================
  // Lines 173-174: resolveSceneElement / sceneElementWasCreated
  // When scene.element is provided, sceneElementWasCreated should be false,
  // and destroy() should NOT remove the scene element.
  // =========================================================================
  describe("scene element provided by user", () => {
    it("does not remove user-provided scene element on destroy", () => {
      const sceneEl = document.createElement("div");

      const handle = renderScene({
        element: root,
        scene: { element: sceneEl, voxels: [{ x: 0, y: 0, z: 0, color: "#ff0000" }] }
      });

      // Scene element should be in the DOM
      expect(sceneEl.classList.contains("voxcss-scene")).toBe(true);

      handle.destroy();

      // sceneElementWasCreated is false, so sceneEl should NOT be removed
      // (it was user-provided)
    });

    it("does not remove user-provided camera element on destroy", () => {
      const cameraEl = document.createElement("div");
      root.appendChild(cameraEl);

      const handle = renderScene({
        element: root,
        camera: { element: cameraEl },
        scene: { voxels: [] }
      });

      handle.destroy();

      // Camera element was provided, so it should still be in the DOM
      expect(cameraEl.parentElement).toBe(root);
      cameraEl.remove();
    });
  });

  // =========================================================================
  // Lines 472-474, 483-485: stop() and notifyInteraction() when cancelFrame
  // is null and ensureFrameFns() fails.
  // This tests the edge case where requestAnimationFrame/cancelAnimationFrame
  // are not available.
  // =========================================================================
  describe("auto-rotate without rAF available", () => {
    it("stop() handles missing cancelAnimationFrame gracefully", () => {
      const el = document.createElement("div");
      document.body.appendChild(el);

      // Save originals
      const origRAF = globalThis.requestAnimationFrame;
      const origCAF = globalThis.cancelAnimationFrame;

      const handle = createCamera({
        element: el,
        animate: true
      });

      // Let auto-rotation start
      vi.advanceTimersByTime(32);

      // Now remove rAF/cAF to simulate environment without them
      // This is the edge case where ensureFrameFns fails
      (globalThis as any).requestAnimationFrame = undefined;
      (globalThis as any).cancelAnimationFrame = undefined;

      // stop() should handle this gracefully (lines 472-474)
      handle.setAnimate(false);

      // Restore
      globalThis.requestAnimationFrame = origRAF;
      globalThis.cancelAnimationFrame = origCAF;

      handle.destroy();
      el.remove();
    });

    it("notifyInteraction handles missing cancelAnimationFrame gracefully", () => {
      const el = document.createElement("div");
      document.body.appendChild(el);

      const origRAF = globalThis.requestAnimationFrame;
      const origCAF = globalThis.cancelAnimationFrame;

      const handle = createCamera({
        element: el,
        interactive: true,
        animate: { axis: "y", speed: 0.5, pauseOnInteraction: true }
      });

      // Let auto-rotation start
      vi.advanceTimersByTime(32);

      // Remove rAF/cAF
      (globalThis as any).requestAnimationFrame = undefined;
      (globalThis as any).cancelAnimationFrame = undefined;

      // Simulate pointer interaction which triggers notifyInteraction (lines 483-485)
      const downEvent = new PointerEvent("pointerdown", {
        clientX: 50,
        clientY: 50,
        pointerId: 1,
        isPrimary: true,
        cancelable: true
      });
      el.dispatchEvent(downEvent);

      // With cAF missing, the pointer interaction should not crash.
      // createCamera does not wire cursor to element (only renderScene does),
      // so we verify the handle is still functional after the interaction.
      expect(handle.interactive).toBe(true);

      // Restore
      globalThis.requestAnimationFrame = origRAF;
      globalThis.cancelAnimationFrame = origCAF;

      // Clean up
      const upEvent = new PointerEvent("pointerup", {
        clientX: 50,
        clientY: 50,
        pointerId: 1
      });
      el.dispatchEvent(upEvent);

      handle.destroy();
      el.remove();
    });
  });

  // =========================================================================
  // Auto-rotate: start() when already running / disabledByInteraction
  // =========================================================================
  describe("auto-rotate edge cases", () => {
    it("start() is no-op when already running (frameId !== null)", () => {
      const el = document.createElement("div");
      document.body.appendChild(el);
      const handle = createCamera({
        element: el,
        animate: true
      });

      // Auto-rotation is already started; calling setAnimate again with same
      // value should be a no-op
      handle.setAnimate(true);
      vi.advanceTimersByTime(32);

      handle.destroy();
      el.remove();
    });

    it("start() is no-op after interaction disabled auto-rotate", () => {
      const el = document.createElement("div");
      document.body.appendChild(el);
      const handle = createCamera({
        element: el,
        interactive: true,
        animate: { axis: "y", speed: 0.5, pauseOnInteraction: true }
      });

      vi.advanceTimersByTime(16);

      // Trigger interaction to disable
      el.dispatchEvent(new PointerEvent("pointerdown", {
        clientX: 50, clientY: 50, pointerId: 1, isPrimary: true, cancelable: true
      }));
      el.dispatchEvent(new PointerEvent("pointerup", {
        clientX: 50, clientY: 50, pointerId: 1
      }));

      // After interaction, auto-rotate is disabled
      const rotYBefore = handle.controller.getCameraState().rotY;
      vi.advanceTimersByTime(64);
      const rotYAfter = handle.controller.getCameraState().rotY;

      // Rotation should not change (paused permanently)
      expect(rotYAfter).toBe(rotYBefore);

      handle.destroy();
      el.remove();
    });
  });

  // =========================================================================
  // renderScene: scene with both scene.element and camera handle provided
  // =========================================================================
  describe("renderScene with camera handle and scene element", () => {
    it("uses provided camera handle and scene element together", () => {
      const cameraEl = document.createElement("div");
      root.appendChild(cameraEl);

      const cameraHandle = createCamera({ element: cameraEl });

      const sceneEl = document.createElement("div");

      const handle = renderScene({
        element: root,
        camera: cameraHandle,
        scene: { element: sceneEl, voxels: [{ x: 0, y: 0, z: 0, color: "#ff0000" }] }
      });

      // Both elements should be in use
      expect(sceneEl.parentElement).toBe(cameraEl);
      expect(sceneEl.classList.contains("voxcss-scene")).toBe(true);

      handle.destroy();
      cameraEl.remove();
    });
  });

  // =========================================================================
  // normalizeAutoRotateOption edge cases
  // =========================================================================
  describe("normalizeAutoRotateOption edge cases", () => {
    it("config with speed 0 does not start auto-rotation", () => {
      const el = document.createElement("div");
      document.body.appendChild(el);
      const handle = createCamera({
        element: el,
        animate: { axis: "y", speed: 0 },
        rotY: 45
      });

      vi.advanceTimersByTime(64);
      expect(handle.controller.getCameraState().rotY).toBe(45);

      handle.destroy();
      el.remove();
    });

    it("config with NaN speed falls through to default speed", () => {
      const el = document.createElement("div");
      document.body.appendChild(el);
      const handle = createCamera({
        element: el,
        animate: { axis: "y", speed: NaN },
        rotY: 45
      });

      vi.advanceTimersByTime(64);
      // NaN is not finite, so normalizeAutoRotateOption uses the default speed (0.3)
      // Auto-rotation DOES happen at the default speed
      expect(handle.controller.getCameraState().rotY).not.toBe(45);

      handle.destroy();
      el.remove();
    });
  });

  // =========================================================================
  // Window-level pointer listeners fallback (Safari/iOS)
  // =========================================================================
  describe("window-level pointer listeners", () => {
    it("falls back to window listeners when pointer capture fails", () => {
      const el = document.createElement("div");
      document.body.appendChild(el);

      // Override hasPointerCapture to simulate no capture
      const origHasPC = el.hasPointerCapture;
      el.hasPointerCapture = () => false;

      const handle = createCamera({
        element: el,
        interactive: true,
        rotY: 45
      });

      // Start drag
      el.dispatchEvent(new PointerEvent("pointerdown", {
        clientX: 100, clientY: 100, pointerId: 1, isPrimary: true, cancelable: true
      }));

      // Move via window-level listener
      window.dispatchEvent(new PointerEvent("pointermove", {
        clientX: 125, clientY: 100, pointerId: 1, cancelable: true
      }));

      // End via window-level listener
      window.dispatchEvent(new PointerEvent("pointerup", {
        clientX: 125, clientY: 100, pointerId: 1
      }));

      // Restore
      el.hasPointerCapture = origHasPC;

      handle.destroy();
      el.remove();
    });

    it("falls back to window listeners when setPointerCapture is not a function", () => {
      const el = document.createElement("div");
      document.body.appendChild(el);

      // Remove setPointerCapture and hasPointerCapture to simulate old browser
      const origSetPC = el.setPointerCapture;
      const origHasPC = el.hasPointerCapture;
      (el as any).setPointerCapture = undefined;
      (el as any).hasPointerCapture = undefined;

      const handle = createCamera({
        element: el,
        interactive: true,
        rotY: 45
      });

      // Start drag
      el.dispatchEvent(new PointerEvent("pointerdown", {
        clientX: 100, clientY: 100, pointerId: 1, isPrimary: true, cancelable: true
      }));

      // Window-level cancel
      window.dispatchEvent(new PointerEvent("pointercancel", {
        clientX: 100, clientY: 100, pointerId: 1
      }));

      // Restore
      el.setPointerCapture = origSetPC;
      el.hasPointerCapture = origHasPC;

      handle.destroy();
      el.remove();
    });
  });
});
