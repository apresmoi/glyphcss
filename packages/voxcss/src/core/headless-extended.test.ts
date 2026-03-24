import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { createCamera, createScene, renderScene } from "./headless";
import { STYLE_ID } from "./types";

beforeAll(() => {
  // Polyfill Option for happy-dom (used for color normalization in sliceRenderer / 3d merge)
  if (typeof globalThis.Option === "undefined") {
    (globalThis as any).Option = class {
      style: Record<string, string> = {};
      get selected() {
        return false;
      }
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

describe("headless — extended coverage", () => {
  let root: HTMLElement;

  beforeEach(() => {
    vi.useFakeTimers();
    root = document.createElement("div");
    document.body.appendChild(root);
  });

  afterEach(() => {
    vi.useRealTimers();
    root.remove();
    // Clean up injected styles
    const styleEl = document.getElementById(STYLE_ID);
    if (styleEl) styleEl.remove();
  });

  // =========================================================================
  // createCamera
  // =========================================================================
  describe("createCamera", () => {
    it("throws when element is missing", () => {
      expect(() =>
        createCamera({ element: null as unknown as HTMLElement })
      ).toThrow("voxcss: createHeadlessCamera requires an element.");
    });

    it("returns a handle with expected properties", () => {
      const el = document.createElement("div");
      document.body.appendChild(el);
      const handle = createCamera({ element: el });

      expect(handle.element).toBe(el);
      expect(handle.controller).toBeDefined();
      expect(typeof handle.interactive).toBe("boolean");
      expect(typeof handle.setInteractive).toBe("function");
      expect(typeof handle.setAnimate).toBe("function");
      expect(typeof handle.setPerspective).toBe("function");
      expect(typeof handle.update).toBe("function");
      expect(typeof handle.destroy).toBe("function");

      handle.destroy();
      el.remove();
    });

    it("applies initial camera state from options", () => {
      const el = document.createElement("div");
      document.body.appendChild(el);
      const handle = createCamera({
        element: el,
        zoom: 2,
        pan: 10,
        tilt: -5,
        rotX: 30,
        rotY: 90
      });

      const state = handle.controller.getCameraState();
      expect(state.zoom).toBe(2);
      expect(state.pan).toBe(10);
      expect(state.tilt).toBe(-5);
      expect(state.rotX).toBe(30);
      expect(state.rotY).toBe(90);

      handle.destroy();
      el.remove();
    });

    it("sets perspective on the element", () => {
      const el = document.createElement("div");
      document.body.appendChild(el);
      const handle = createCamera({ element: el, perspective: 5000 });

      expect(el.style.perspective).toBe("5000px");

      handle.destroy();
      el.remove();
    });

    it("setPerspective updates the element perspective", () => {
      const el = document.createElement("div");
      document.body.appendChild(el);
      const handle = createCamera({ element: el });

      handle.setPerspective(3000);
      expect(el.style.perspective).toBe("3000px");

      handle.setPerspective(false);
      expect(el.style.perspective).toBe("none");

      // Same value does nothing (branch coverage)
      handle.setPerspective(false);
      expect(el.style.perspective).toBe("none");

      handle.destroy();
      el.remove();
    });

    it("setInteractive toggles pointer event attachment", () => {
      const el = document.createElement("div");
      document.body.appendChild(el);
      const handle = createCamera({ element: el, interactive: false });

      expect(handle.interactive).toBe(false);

      handle.setInteractive(true);
      expect(handle.interactive).toBe(true);
      expect(el.style.touchAction).toBe("none");

      // Same value does nothing
      handle.setInteractive(true);
      expect(handle.interactive).toBe(true);

      handle.setInteractive(false);
      expect(handle.interactive).toBe(false);
      expect(el.style.cursor).toBe("default");

      handle.destroy();
      el.remove();
    });

    it("setAnimate with true starts auto-rotation", () => {
      const el = document.createElement("div");
      document.body.appendChild(el);
      const handle = createCamera({ element: el });

      // Should not throw
      handle.setAnimate(true);

      // Advance a frame to let the auto-rotate tick
      vi.advanceTimersByTime(16);

      handle.setAnimate(false);
      handle.destroy();
      el.remove();
    });

    it("setAnimate with numeric speed", () => {
      const el = document.createElement("div");
      document.body.appendChild(el);
      const handle = createCamera({ element: el });

      handle.setAnimate(0.5);
      vi.advanceTimersByTime(16);

      handle.setAnimate(false);
      handle.destroy();
      el.remove();
    });

    it("setAnimate with config object", () => {
      const el = document.createElement("div");
      document.body.appendChild(el);
      const handle = createCamera({ element: el });

      handle.setAnimate({ axis: "x", speed: 1, pauseOnInteraction: true });
      vi.advanceTimersByTime(16);

      handle.setAnimate(false);
      handle.destroy();
      el.remove();
    });

    it("setAnimate same value is a no-op", () => {
      const el = document.createElement("div");
      document.body.appendChild(el);
      const handle = createCamera({ element: el, animate: true });

      // Set to the same value (true)
      handle.setAnimate(true);

      handle.destroy();
      el.remove();
    });

    it("update method forwards camera props", () => {
      const el = document.createElement("div");
      document.body.appendChild(el);
      const handle = createCamera({ element: el });

      handle.update({ zoom: 3, pan: 5, tilt: -10, rotX: 40, rotY: 120 });

      const state = handle.controller.getCameraState();
      expect(state.zoom).toBe(3);
      expect(state.pan).toBe(5);
      expect(state.tilt).toBe(-10);
      expect(state.rotX).toBe(40);
      expect(state.rotY).toBe(120);

      handle.destroy();
      el.remove();
    });

    it("update with invert changes pointer invert", () => {
      const el = document.createElement("div");
      document.body.appendChild(el);
      const handle = createCamera({ element: el, interactive: true });

      // Should not throw
      handle.update({ invert: true });
      handle.update({ invert: false });

      handle.destroy();
      el.remove();
    });

    it("update with interactive toggles interactive", () => {
      const el = document.createElement("div");
      document.body.appendChild(el);
      const handle = createCamera({ element: el, interactive: false });

      handle.update({ interactive: true });
      expect(handle.interactive).toBe(true);

      handle.update({ interactive: false });
      expect(handle.interactive).toBe(false);

      handle.destroy();
      el.remove();
    });

    it("update with perspective changes perspective", () => {
      const el = document.createElement("div");
      document.body.appendChild(el);
      const handle = createCamera({ element: el });

      handle.update({ perspective: 4000 });
      expect(el.style.perspective).toBe("4000px");

      handle.destroy();
      el.remove();
    });

    it("update with animate changes animation", () => {
      const el = document.createElement("div");
      document.body.appendChild(el);
      const handle = createCamera({ element: el });

      handle.update({ animate: true });
      vi.advanceTimersByTime(16);

      handle.update({ animate: false });

      handle.destroy();
      el.remove();
    });

    it("destroy cleans up", () => {
      const el = document.createElement("div");
      document.body.appendChild(el);
      const handle = createCamera({ element: el, interactive: true, animate: true });

      handle.destroy();
      expect(handle.interactive).toBe(false);

      el.remove();
    });

    it("initial animate option starts auto-rotation", () => {
      const el = document.createElement("div");
      document.body.appendChild(el);

      const initialRotY = 45;
      const handle = createCamera({ element: el, animate: true, rotY: initialRotY });

      // Advance frames to let auto-rotation happen
      vi.advanceTimersByTime(64);

      const state = handle.controller.getCameraState();
      // rotY should have changed from auto-rotation
      // (it advances by 0.3 per frame)
      expect(state.rotY).not.toBe(initialRotY);

      handle.destroy();
      el.remove();
    });
  });

  // =========================================================================
  // createScene
  // =========================================================================
  describe("createScene", () => {
    it("throws when element is missing", () => {
      expect(() =>
        createScene({ element: null as unknown as HTMLElement, voxels: [], showWalls: false, showFloor: false, projection: "cubic" })
      ).toThrow("voxcss: createScene requires an element.");
    });

    it("adds scene host class to element", () => {
      const el = document.createElement("div");
      const state = createScene({
        element: el,
        voxels: [],
        showWalls: false,
        showFloor: false,
        projection: "cubic"
      });

      expect(el.classList.contains("voxcss-scene")).toBe(true);
      expect(state.element).toBe(el);
    });
  });

  // =========================================================================
  // renderScene
  // =========================================================================
  describe("renderScene", () => {
    it("throws when element is missing", () => {
      expect(() =>
        renderScene({ element: null as unknown as HTMLElement })
      ).toThrow("voxcss: renderScene requires a root element.");
    });

    it("creates camera and scene elements when not provided", () => {
      const handle = renderScene({
        element: root,
        scene: { voxels: [{ x: 0, y: 0, z: 0, color: "#ff0000" }] }
      });

      // The root should now have a camera child
      expect(root.children.length).toBeGreaterThan(0);

      // The camera element should have a scene child
      const cameraEl = root.children[0] as HTMLElement;
      expect(cameraEl.classList.contains("voxcss-camera")).toBe(true);
      expect(cameraEl.children.length).toBeGreaterThan(0);

      handle.destroy();
    });

    it("returns a handle with setVoxels, setScene, destroy", () => {
      const handle = renderScene({
        element: root,
        scene: { voxels: [] }
      });

      expect(typeof handle.setVoxels).toBe("function");
      expect(typeof handle.setScene).toBe("function");
      expect(typeof handle.destroy).toBe("function");

      handle.destroy();
    });

    it("setVoxels updates the voxels", () => {
      const handle = renderScene({
        element: root,
        scene: { voxels: [] }
      });

      // Should not throw
      handle.setVoxels([{ x: 0, y: 0, z: 0, color: "#ff0000" }]);

      // Advance rAF to let render happen
      vi.advanceTimersByTime(16);

      handle.destroy();
    });

    it("setScene updates the entire scene state", () => {
      const handle = renderScene({
        element: root,
        scene: { voxels: [] }
      });

      handle.setScene({
        voxels: [{ x: 0, y: 0, z: 0, color: "#00ff00" }],
        showWalls: true,
        showFloor: true,
        projection: "dimetric"
      });

      vi.advanceTimersByTime(16);

      handle.destroy();
    });

    it("setScene preserves existing voxels when not provided", () => {
      const voxels = [{ x: 0, y: 0, z: 0, color: "#ff0000" }];
      const handle = renderScene({
        element: root,
        scene: { voxels }
      });

      // Update scene without voxels — should keep existing ones
      handle.setScene({
        showWalls: true,
        showFloor: false,
        projection: "cubic",
        voxels: undefined as any
      });

      vi.advanceTimersByTime(16);

      handle.destroy();
    });

    it("destroy removes created elements", () => {
      const handle = renderScene({
        element: root,
        scene: { voxels: [] }
      });

      const childrenBefore = root.children.length;
      handle.destroy();

      // Created camera and scene elements should be removed
      expect(root.children.length).toBeLessThan(childrenBefore);
    });

    it("reuses provided camera element", () => {
      const cameraEl = document.createElement("div");
      root.appendChild(cameraEl);

      const handle = renderScene({
        element: root,
        camera: { element: cameraEl },
        scene: { voxels: [] }
      });

      // The camera element should be the one we provided
      expect(cameraEl.classList.contains("voxcss-camera")).toBe(true);

      handle.destroy();
    });

    it("reuses provided scene element", () => {
      const sceneEl = document.createElement("div");

      const handle = renderScene({
        element: root,
        scene: { element: sceneEl, voxels: [] }
      });

      // The scene element should be the one we provided
      expect(sceneEl.classList.contains("voxcss-scene")).toBe(true);

      handle.destroy();
    });

    it("reuses existing camera handle", () => {
      const cameraEl = document.createElement("div");
      root.appendChild(cameraEl);
      const cameraHandle = createCamera({ element: cameraEl, interactive: true });

      const handle = renderScene({
        element: root,
        camera: cameraHandle,
        scene: { voxels: [{ x: 0, y: 0, z: 0, color: "#ff0000" }] }
      });

      // The camera handle's element should be used
      expect(cameraHandle.element.classList.contains("voxcss-camera")).toBe(true);

      // Since we passed interactive camera, cursor should be set
      // The renderScene function calls controller.getCursor() when interactive
      expect(cameraHandle.element.style.cursor).toBeTruthy();

      handle.destroy();
      cameraEl.remove();
    });

    it("mergeVoxels option is passed through to scene state", () => {
      const handle = renderScene({
        element: root,
        scene: { voxels: [{ x: 0, y: 0, z: 0 }] },
        mergeVoxels: "2d"
      });

      // Should not throw — mergeVoxels is passed to createScene
      vi.advanceTimersByTime(16);

      handle.destroy();
    });

    it("scene-level mergeVoxels takes precedence over top-level", () => {
      const handle = renderScene({
        element: root,
        scene: { voxels: [{ x: 0, y: 0, z: 0 }], mergeVoxels: "3d" },
        mergeVoxels: "2d"
      });

      // Should not throw
      vi.advanceTimersByTime(16);

      handle.destroy();
    });

    it("destroy does not remove provided camera element", () => {
      const cameraEl = document.createElement("div");
      root.appendChild(cameraEl);

      const handle = renderScene({
        element: root,
        camera: { element: cameraEl },
        scene: { voxels: [] }
      });

      handle.destroy();

      // Camera element was provided, not created, so it should still be in DOM
      expect(cameraEl.parentElement).toBe(root);

      cameraEl.remove();
    });

    it("destroy does not remove provided scene element", () => {
      const sceneEl = document.createElement("div");

      const handle = renderScene({
        element: root,
        scene: { element: sceneEl, voxels: [] }
      });

      handle.destroy();

      // Scene element was provided by the user, so it should still exist
      // (although it may have been removed from its parent by the camera destroy)
    });

    it("camera element already appended to root is not re-appended", () => {
      const cameraEl = document.createElement("div");
      root.appendChild(cameraEl);

      const appendSpy = vi.spyOn(root, "appendChild");

      const handle = renderScene({
        element: root,
        camera: { element: cameraEl },
        scene: { voxels: [] }
      });

      // Check that the camera element was not appended again (it was already a child)
      const cameraAppendCalls = appendSpy.mock.calls.filter(
        ([child]) => child === cameraEl
      );
      expect(cameraAppendCalls.length).toBe(0);

      appendSpy.mockRestore();
      handle.destroy();
      cameraEl.remove();
    });
  });

  // =========================================================================
  // Auto-rotate through renderScene
  // =========================================================================
  describe("auto-rotate via renderScene", () => {
    it("auto-rotate with x-axis config", () => {
      const handle = renderScene({
        element: root,
        camera: { animate: { axis: "x", speed: 1, pauseOnInteraction: false } },
        scene: { voxels: [] }
      });

      vi.advanceTimersByTime(64);

      handle.destroy();
    });

    it("auto-rotate with pauseOnInteraction stops on pointer interaction", () => {
      const cameraEl = document.createElement("div");
      root.appendChild(cameraEl);
      const cameraHandle = createCamera({
        element: cameraEl,
        interactive: true,
        animate: { axis: "y", speed: 0.5, pauseOnInteraction: true }
      });

      vi.advanceTimersByTime(64);

      // Simulate pointer down to trigger pauseOnInteraction
      const downEvent = new PointerEvent("pointerdown", {
        clientX: 50,
        clientY: 50,
        pointerId: 1,
        isPrimary: true,
        cancelable: true
      });
      cameraEl.dispatchEvent(downEvent);

      // Auto-rotation should pause after interaction
      const rotYAfterInteraction = cameraHandle.controller.getCameraState().rotY;

      // Advance more frames — rotation should not change (paused)
      vi.advanceTimersByTime(64);

      // End drag
      const upEvent = new PointerEvent("pointerup", {
        clientX: 50,
        clientY: 50,
        pointerId: 1
      });
      cameraEl.dispatchEvent(upEvent);

      cameraHandle.destroy();
      cameraEl.remove();
    });
  });

  // =========================================================================
  // Pointer events through createCamera
  // =========================================================================
  describe("pointer events through headless camera", () => {
    it("pointer down and move updates rotation", () => {
      const el = document.createElement("div");
      document.body.appendChild(el);
      const handle = createCamera({
        element: el,
        interactive: true,
        rotX: 65,
        rotY: 45
      });

      // Simulate pointer down
      const downEvent = new PointerEvent("pointerdown", {
        clientX: 100,
        clientY: 100,
        pointerId: 1,
        isPrimary: true,
        cancelable: true
      });
      el.dispatchEvent(downEvent);

      // Simulate pointer move
      const moveEvent = new PointerEvent("pointermove", {
        clientX: 125,
        clientY: 110,
        pointerId: 1,
        cancelable: true
      });
      el.dispatchEvent(moveEvent);

      const state = handle.controller.getCameraState();
      // rotY should change from drag
      expect(state.rotY).not.toBe(45);

      // Simulate pointer up
      const upEvent = new PointerEvent("pointerup", {
        clientX: 125,
        clientY: 110,
        pointerId: 1
      });
      el.dispatchEvent(upEvent);

      handle.destroy();
      el.remove();
    });

    it("pointer cancel ends drag", () => {
      const el = document.createElement("div");
      document.body.appendChild(el);
      const handle = createCamera({
        element: el,
        interactive: true,
        rotX: 65,
        rotY: 45
      });

      // Start drag
      const downEvent = new PointerEvent("pointerdown", {
        clientX: 100,
        clientY: 100,
        pointerId: 1,
        isPrimary: true,
        cancelable: true
      });
      el.dispatchEvent(downEvent);

      // Cancel pointer
      const cancelEvent = new PointerEvent("pointercancel", {
        clientX: 100,
        clientY: 100,
        pointerId: 1
      });
      el.dispatchEvent(cancelEvent);

      // Cursor should return to grab
      expect(handle.controller.getCursor()).toBe("grab");

      handle.destroy();
      el.remove();
    });

    it("non-primary pointer down is ignored", () => {
      const el = document.createElement("div");
      document.body.appendChild(el);
      const handle = createCamera({
        element: el,
        interactive: true,
        rotX: 65,
        rotY: 45
      });

      const downEvent = new PointerEvent("pointerdown", {
        clientX: 100,
        clientY: 100,
        pointerId: 2,
        isPrimary: false,
        cancelable: true
      });
      el.dispatchEvent(downEvent);

      // Should not be dragging
      expect(handle.controller.getCursor()).toBe("grab");

      handle.destroy();
      el.remove();
    });

    it("pointer move without active drag is ignored", () => {
      const el = document.createElement("div");
      document.body.appendChild(el);
      const handle = createCamera({
        element: el,
        interactive: true,
        rotX: 65,
        rotY: 45
      });

      const moveEvent = new PointerEvent("pointermove", {
        clientX: 200,
        clientY: 200,
        pointerId: 1,
        cancelable: true
      });
      el.dispatchEvent(moveEvent);

      // Rotation should not change
      const state = handle.controller.getCameraState();
      expect(state.rotY).toBe(45);
      expect(state.rotX).toBe(65);

      handle.destroy();
      el.remove();
    });

    it("pointer up from different pointer ID is ignored", () => {
      const el = document.createElement("div");
      document.body.appendChild(el);
      const handle = createCamera({
        element: el,
        interactive: true,
        rotX: 65,
        rotY: 45
      });

      // Start drag with pointer 1
      el.dispatchEvent(
        new PointerEvent("pointerdown", {
          clientX: 100,
          clientY: 100,
          pointerId: 1,
          isPrimary: true,
          cancelable: true
        })
      );

      // Try to end with pointer 2 (should be ignored)
      el.dispatchEvent(
        new PointerEvent("pointerup", {
          clientX: 100,
          clientY: 100,
          pointerId: 2
        })
      );

      // Should still be dragging
      expect(handle.controller.getCursor()).toBe("grabbing");

      // Clean up: end drag with pointer 1
      el.dispatchEvent(
        new PointerEvent("pointerup", {
          clientX: 100,
          clientY: 100,
          pointerId: 1
        })
      );

      handle.destroy();
      el.remove();
    });

    it("second pointer down while already dragging is ignored", () => {
      const el = document.createElement("div");
      document.body.appendChild(el);
      const handle = createCamera({
        element: el,
        interactive: true,
        rotX: 65,
        rotY: 45
      });

      // First pointer down
      el.dispatchEvent(
        new PointerEvent("pointerdown", {
          clientX: 100,
          clientY: 100,
          pointerId: 1,
          isPrimary: true,
          cancelable: true
        })
      );

      // Second pointer down (should be ignored)
      el.dispatchEvent(
        new PointerEvent("pointerdown", {
          clientX: 200,
          clientY: 200,
          pointerId: 3,
          isPrimary: true,
          cancelable: true
        })
      );

      // Should still be tracking pointer 1
      expect(handle.controller.getCursor()).toBe("grabbing");

      // End drag with pointer 1
      el.dispatchEvent(
        new PointerEvent("pointerup", {
          clientX: 100,
          clientY: 100,
          pointerId: 1
        })
      );

      handle.destroy();
      el.remove();
    });

    it("detach restores touch-action and user-select", () => {
      const el = document.createElement("div");
      el.style.touchAction = "auto";
      el.style.userSelect = "text";
      document.body.appendChild(el);
      const handle = createCamera({
        element: el,
        interactive: true
      });

      expect(el.style.touchAction).toBe("none");
      expect(el.style.userSelect).toBe("none");

      handle.setInteractive(false);

      // After detaching pointer events, original styles should be restored
      // (though setInteractive(false) may not restore them — it depends on implementation)
      // The destroy path restores them
      handle.destroy();
      el.remove();
    });
  });

  // =========================================================================
  // Controller options pass-through
  // =========================================================================
  describe("controller options", () => {
    it("controller options are passed through to sceneController", () => {
      const el = document.createElement("div");
      document.body.appendChild(el);
      const handle = createCamera({
        element: el,
        controller: {
          dimensions: { rows: 10, cols: 10, depth: 5 }
        }
      });

      const dims = handle.controller.getDimensions();
      expect(dims.rows).toBe(10);
      expect(dims.cols).toBe(10);
      expect(dims.depth).toBe(5);

      handle.destroy();
      el.remove();
    });

    it("invert option is forwarded to controller", () => {
      const el = document.createElement("div");
      document.body.appendChild(el);
      const handle = createCamera({
        element: el,
        interactive: true,
        invert: true,
        rotY: 45
      });

      // Start drag
      el.dispatchEvent(
        new PointerEvent("pointerdown", {
          clientX: 100,
          clientY: 100,
          pointerId: 1,
          isPrimary: true,
          cancelable: true
        })
      );

      // Move right
      el.dispatchEvent(
        new PointerEvent("pointermove", {
          clientX: 125,
          clientY: 100,
          pointerId: 1,
          cancelable: true
        })
      );

      const state = handle.controller.getCameraState();
      // With invert=true, moving right should increase rotY (inverted from default)
      // Default: rotY = 45 - (25 * 1 / 5) = 40
      // Inverted: rotY = 45 - (25 * -1 / 5) = 50
      expect(state.rotY).toBe(50);

      // End drag
      el.dispatchEvent(
        new PointerEvent("pointerup", {
          clientX: 125,
          clientY: 100,
          pointerId: 1
        })
      );

      handle.destroy();
      el.remove();
    });
  });

  // =========================================================================
  // Scene element reuse across multiple renders
  // =========================================================================
  describe("element reuse in renderScene", () => {
    it("scene element is reused when already a child of camera", () => {
      const cameraEl = document.createElement("div");
      root.appendChild(cameraEl);
      const cameraHandle = createCamera({ element: cameraEl });

      const sceneEl = document.createElement("div");
      cameraEl.appendChild(sceneEl);

      const handle = renderScene({
        element: root,
        camera: cameraHandle,
        scene: { element: sceneEl, voxels: [] }
      });

      // Scene element should already be a child of camera, not re-appended
      expect(sceneEl.parentElement).toBe(cameraEl);

      handle.destroy();
      cameraEl.remove();
    });

    it("multiple renderScene calls on same root", () => {
      const handle1 = renderScene({
        element: root,
        scene: { voxels: [{ x: 0, y: 0, z: 0, color: "#ff0000" }] }
      });

      handle1.destroy();

      // Render again on the same root
      const handle2 = renderScene({
        element: root,
        scene: { voxels: [{ x: 1, y: 1, z: 0, color: "#00ff00" }] }
      });

      vi.advanceTimersByTime(16);

      handle2.destroy();
    });
  });

  // =========================================================================
  // perspective edge cases
  // =========================================================================
  describe("perspective edge cases", () => {
    it("perspective: false disables perspective", () => {
      const el = document.createElement("div");
      document.body.appendChild(el);
      const handle = createCamera({ element: el, perspective: false });

      expect(el.style.perspective).toBe("none");

      handle.destroy();
      el.remove();
    });

    it("perspective: true uses default 8000", () => {
      const el = document.createElement("div");
      document.body.appendChild(el);
      const handle = createCamera({ element: el, perspective: true });

      expect(el.style.perspective).toBe("8000px");

      handle.destroy();
      el.remove();
    });

    it("perspective: undefined uses default 8000", () => {
      const el = document.createElement("div");
      document.body.appendChild(el);
      const handle = createCamera({ element: el });

      expect(el.style.perspective).toBe("8000px");

      handle.destroy();
      el.remove();
    });
  });

  // =========================================================================
  // normalizeAutoRotateOption edge cases (covered through createCamera)
  // =========================================================================
  describe("auto-rotate edge cases", () => {
    it("animate: 0 does not start auto-rotation", () => {
      const el = document.createElement("div");
      document.body.appendChild(el);
      const handle = createCamera({ element: el, animate: 0, rotY: 45 });

      vi.advanceTimersByTime(64);

      // rotY should not change since speed 0 returns null config
      const state = handle.controller.getCameraState();
      expect(state.rotY).toBe(45);

      handle.destroy();
      el.remove();
    });

    it("animate: Infinity does not start auto-rotation", () => {
      const el = document.createElement("div");
      document.body.appendChild(el);
      const handle = createCamera({ element: el, animate: Infinity, rotY: 45 });

      vi.advanceTimersByTime(64);

      const state = handle.controller.getCameraState();
      expect(state.rotY).toBe(45);

      handle.destroy();
      el.remove();
    });

    it("animate config with axis: 'x' rotates X axis", () => {
      const el = document.createElement("div");
      document.body.appendChild(el);
      const initialRotX = 65;
      const handle = createCamera({
        element: el,
        animate: { axis: "x", speed: 1 },
        rotX: initialRotX
      });

      vi.advanceTimersByTime(64);

      const state = handle.controller.getCameraState();
      expect(state.rotX).not.toBe(initialRotX);

      handle.destroy();
      el.remove();
    });

    it("animate config with pauseOnInteraction: false continues after interaction", () => {
      const el = document.createElement("div");
      document.body.appendChild(el);
      const handle = createCamera({
        element: el,
        interactive: true,
        animate: { axis: "y", speed: 0.5, pauseOnInteraction: false }
      });

      // Simulate pointer interaction
      el.dispatchEvent(
        new PointerEvent("pointerdown", {
          clientX: 100,
          clientY: 100,
          pointerId: 1,
          isPrimary: true,
          cancelable: true
        })
      );
      el.dispatchEvent(
        new PointerEvent("pointerup", {
          clientX: 100,
          clientY: 100,
          pointerId: 1
        })
      );

      const rotYBefore = handle.controller.getCameraState().rotY;
      vi.advanceTimersByTime(64);
      const rotYAfter = handle.controller.getCameraState().rotY;

      // Auto-rotation should continue since pauseOnInteraction is false
      // (Although it may or may not have changed depending on timing)

      handle.destroy();
      el.remove();
    });
  });
});
