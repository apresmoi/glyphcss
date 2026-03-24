import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mountCameraBinding, ensureCameraController } from "./domBindings";
import { sceneController, type SceneController } from "./sceneController";

describe("ensureCameraController", () => {
  it("returns the controller when not null", () => {
    const controller = sceneController();
    expect(ensureCameraController(controller)).toBe(controller);
  });

  it("throws when controller is null", () => {
    expect(() => ensureCameraController(null)).toThrow("voxcss: controller is not ready yet.");
  });
});

describe("mountCameraBinding", () => {
  let element: HTMLElement;
  let controller: SceneController;

  beforeEach(() => {
    vi.useFakeTimers();
    element = document.createElement("div");
    document.body.appendChild(element);
  });

  afterEach(() => {
    vi.useRealTimers();
    element.remove();
  });

  describe("creation and API", () => {
    it("returns an object with destroy, update, startAutoRotate, stopAutoRotate", () => {
      const onSnapshot = vi.fn();
      const binding = mountCameraBinding(element, {}, onSnapshot);

      expect(binding).toBeDefined();
      expect(typeof binding.destroy).toBe("function");
      expect(typeof binding.update).toBe("function");
      expect(typeof binding.startAutoRotate).toBe("function");
      expect(typeof binding.stopAutoRotate).toBe("function");

      binding.destroy();
    });

    it("adds voxcss-camera class to the element", () => {
      const onSnapshot = vi.fn();
      const binding = mountCameraBinding(element, {}, onSnapshot);

      expect(element.classList.contains("voxcss-camera")).toBe(true);

      binding.destroy();
    });
  });

  describe("snapshot subscription", () => {
    it("calls onSnapshot immediately upon subscription with snapshot data", () => {
      const onSnapshot = vi.fn();
      const binding = mountCameraBinding(element, {}, onSnapshot);

      // subscribeSnapshot calls the listener immediately with the current snapshot
      expect(onSnapshot).toHaveBeenCalled();
      const snapshot = onSnapshot.mock.calls[0][0];
      expect(snapshot).not.toBeNull();
      expect(snapshot.controller).toBeDefined();
      expect(snapshot.boxStyle).toBeDefined();
      expect(snapshot.walls).toBeDefined();
      expect(snapshot.camera).toBeDefined();
      expect(typeof snapshot.cursor).toBe("string");

      binding.destroy();
    });

    it("calls onCursor callback when provided", () => {
      const onSnapshot = vi.fn();
      const onCursor = vi.fn();
      const binding = mountCameraBinding(element, {}, onSnapshot, onCursor);

      expect(onCursor).toHaveBeenCalledWith("default");

      binding.destroy();
    });

    it("cursor is 'default' when interactive is false", () => {
      const onSnapshot = vi.fn();
      const binding = mountCameraBinding(element, { interactive: false }, onSnapshot);

      const snapshot = onSnapshot.mock.calls[0][0];
      expect(snapshot.cursor).toBe("default");

      binding.destroy();
    });

    it("cursor is 'grab' when interactive is true", () => {
      const onSnapshot = vi.fn();
      const binding = mountCameraBinding(element, { interactive: true }, onSnapshot);

      const snapshot = onSnapshot.mock.calls[0][0];
      expect(snapshot.cursor).toBe("grab");

      binding.destroy();
    });
  });

  describe("camera props forwarding", () => {
    it("applies zoom to camera state", () => {
      const onSnapshot = vi.fn();
      const binding = mountCameraBinding(element, { zoom: 2 }, onSnapshot);

      const snapshot = onSnapshot.mock.calls[0][0];
      expect(snapshot.camera.zoom).toBe(2);

      binding.destroy();
    });

    it("applies rotX and rotY to camera state", () => {
      const onSnapshot = vi.fn();
      const binding = mountCameraBinding(
        element,
        { rotX: 30, rotY: 90 },
        onSnapshot
      );

      const snapshot = onSnapshot.mock.calls[0][0];
      expect(snapshot.camera.rotX).toBe(30);
      expect(snapshot.camera.rotY).toBe(90);

      binding.destroy();
    });

    it("applies pan and tilt to camera state", () => {
      const onSnapshot = vi.fn();
      const binding = mountCameraBinding(
        element,
        { pan: 10, tilt: 20 },
        onSnapshot
      );

      const snapshot = onSnapshot.mock.calls[0][0];
      expect(snapshot.camera.pan).toBe(10);
      expect(snapshot.camera.tilt).toBe(20);

      binding.destroy();
    });
  });

  describe("update()", () => {
    it("updates camera zoom and emits new snapshot", () => {
      const onSnapshot = vi.fn();
      const binding = mountCameraBinding(element, { zoom: 1 }, onSnapshot);

      onSnapshot.mockClear();
      binding.update({ zoom: 2 });

      expect(onSnapshot).toHaveBeenCalled();
      const snapshot = onSnapshot.mock.calls[0][0];
      expect(snapshot.camera.zoom).toBe(2);

      binding.destroy();
    });

    it("updates camera rotation and emits new snapshot", () => {
      const onSnapshot = vi.fn();
      const binding = mountCameraBinding(element, { rotX: 65, rotY: 45 }, onSnapshot);

      onSnapshot.mockClear();
      binding.update({ rotX: 30, rotY: 180 });

      expect(onSnapshot).toHaveBeenCalled();
      const snapshot = onSnapshot.mock.calls[0][0];
      expect(snapshot.camera.rotX).toBe(30);
      expect(snapshot.camera.rotY).toBe(180);

      binding.destroy();
    });

    it("toggles interactive on via update", () => {
      const onSnapshot = vi.fn();
      const binding = mountCameraBinding(element, { interactive: false }, onSnapshot);

      expect(onSnapshot.mock.calls[0][0].cursor).toBe("default");

      onSnapshot.mockClear();
      binding.update({ interactive: true });

      // After enabling interactive, snapshot cursor should be grab
      const latestCall = onSnapshot.mock.calls[onSnapshot.mock.calls.length - 1];
      if (latestCall) {
        expect(latestCall[0].cursor).toBe("grab");
      }

      binding.destroy();
    });

    it("toggles interactive off via update", () => {
      const onSnapshot = vi.fn();
      const binding = mountCameraBinding(element, { interactive: true }, onSnapshot);

      onSnapshot.mockClear();
      binding.update({ interactive: false });

      // After disabling interactive, cursor should become default
      const latestCall = onSnapshot.mock.calls[onSnapshot.mock.calls.length - 1];
      if (latestCall) {
        expect(latestCall[0].cursor).toBe("default");
      }

      binding.destroy();
    });
  });

  describe("destroy()", () => {
    it("calls onSnapshot with null on destroy", () => {
      const onSnapshot = vi.fn();
      const binding = mountCameraBinding(element, {}, onSnapshot);

      onSnapshot.mockClear();
      binding.destroy();

      expect(onSnapshot).toHaveBeenCalledWith(null);
    });

    it("calls onCursor with 'default' on destroy", () => {
      const onSnapshot = vi.fn();
      const onCursor = vi.fn();
      const binding = mountCameraBinding(element, {}, onSnapshot, onCursor);

      onCursor.mockClear();
      binding.destroy();

      expect(onCursor).toHaveBeenCalledWith("default");
    });

    it("does not emit further snapshots after destroy", () => {
      const onSnapshot = vi.fn();
      const binding = mountCameraBinding(element, { interactive: true }, onSnapshot);

      // Get the controller reference before destroying
      const snapshot = onSnapshot.mock.calls[0][0];
      const ctrl = snapshot.controller;

      binding.destroy();
      onSnapshot.mockClear();

      // Updating the controller directly after destroy should not trigger our callback
      ctrl.updateCamera({ zoom: 5 });
      expect(onSnapshot).not.toHaveBeenCalled();
    });
  });

  describe("startAutoRotate() and stopAutoRotate()", () => {
    it("startAutoRotate triggers snapshot on subsequent update", () => {
      const onSnapshot = vi.fn();
      const binding = mountCameraBinding(element, {}, onSnapshot);
      onSnapshot.mockClear(); // clear mount snapshot

      binding.startAutoRotate(true);
      binding.update({ zoom: 2 });
      expect(onSnapshot).toHaveBeenCalled();
      const snapshot = onSnapshot.mock.calls[onSnapshot.mock.calls.length - 1][0];
      expect(snapshot.camera.zoom).toBe(2);

      binding.destroy();
    });

    it("stopAutoRotate allows subsequent updates", () => {
      const onSnapshot = vi.fn();
      const binding = mountCameraBinding(element, { animate: true }, onSnapshot);
      onSnapshot.mockClear(); // clear mount snapshot

      binding.stopAutoRotate();
      binding.update({ zoom: 1.5 });
      expect(onSnapshot).toHaveBeenCalled();
      const snapshot = onSnapshot.mock.calls[onSnapshot.mock.calls.length - 1][0];
      expect(snapshot.camera.zoom).toBe(1.5);

      binding.destroy();
    });

    it("startAutoRotate with numeric speed triggers snapshot on subsequent update", () => {
      const onSnapshot = vi.fn();
      const binding = mountCameraBinding(element, {}, onSnapshot);
      onSnapshot.mockClear(); // clear mount snapshot

      binding.startAutoRotate(0.5);
      binding.update({ zoom: 3 });
      expect(onSnapshot).toHaveBeenCalled();
      const snapshot = onSnapshot.mock.calls[onSnapshot.mock.calls.length - 1][0];
      expect(snapshot.camera.zoom).toBe(3);

      binding.destroy();
    });

    it("startAutoRotate with config object triggers snapshot on subsequent update", () => {
      const onSnapshot = vi.fn();
      const binding = mountCameraBinding(element, {}, onSnapshot);
      onSnapshot.mockClear(); // clear mount snapshot

      binding.startAutoRotate({ axis: "x", speed: 1, pauseOnInteraction: false });
      binding.update({ zoom: 4 });
      expect(onSnapshot).toHaveBeenCalled();
      const snapshot = onSnapshot.mock.calls[onSnapshot.mock.calls.length - 1][0];
      expect(snapshot.camera.zoom).toBe(4);

      binding.destroy();
    });
  });

  describe("pointer events", () => {
    it("attaches pointer event listeners when interactive is true", () => {
      const onSnapshot = vi.fn();
      const addEventSpy = vi.spyOn(element, "addEventListener");

      const binding = mountCameraBinding(element, { interactive: true }, onSnapshot);

      const eventTypes = addEventSpy.mock.calls.map((call) => call[0]);
      expect(eventTypes).toContain("pointerdown");
      expect(eventTypes).toContain("pointermove");
      expect(eventTypes).toContain("pointerup");
      expect(eventTypes).toContain("pointercancel");

      addEventSpy.mockRestore();
      binding.destroy();
    });

    it("does not attach pointer event listeners when interactive is false", () => {
      const onSnapshot = vi.fn();
      const addEventSpy = vi.spyOn(element, "addEventListener");

      const binding = mountCameraBinding(element, { interactive: false }, onSnapshot);

      const eventTypes = addEventSpy.mock.calls.map((call) => call[0]);
      expect(eventTypes).not.toContain("pointerdown");

      addEventSpy.mockRestore();
      binding.destroy();
    });

    it("detaches pointer listeners when interactive is toggled off via update", () => {
      const onSnapshot = vi.fn();
      const removeEventSpy = vi.spyOn(element, "removeEventListener");

      const binding = mountCameraBinding(element, { interactive: true }, onSnapshot);

      binding.update({ interactive: false });

      const removedTypes = removeEventSpy.mock.calls.map((call) => call[0]);
      expect(removedTypes).toContain("pointerdown");
      expect(removedTypes).toContain("pointermove");
      expect(removedTypes).toContain("pointerup");
      expect(removedTypes).toContain("pointercancel");

      removeEventSpy.mockRestore();
      binding.destroy();
    });

    it("drag updates camera rotation via controller", () => {
      const onSnapshot = vi.fn();
      const binding = mountCameraBinding(
        element,
        { interactive: true, rotX: 65, rotY: 45 },
        onSnapshot
      );

      // Simulate pointerdown
      const downEvent = new PointerEvent("pointerdown", {
        clientX: 100,
        clientY: 100,
        pointerId: 1,
        isPrimary: true,
        cancelable: true
      });
      element.dispatchEvent(downEvent);

      onSnapshot.mockClear();

      // Simulate pointermove with delta
      const moveEvent = new PointerEvent("pointermove", {
        clientX: 125,
        clientY: 110,
        pointerId: 1,
        cancelable: true
      });
      element.dispatchEvent(moveEvent);

      // A snapshot should have been emitted with changed camera
      expect(onSnapshot).toHaveBeenCalled();
      const snapshot = onSnapshot.mock.calls[onSnapshot.mock.calls.length - 1][0];
      // rotY changes based on horizontal delta (25px), rotX based on vertical delta (10px)
      // speed = 5, so dX = 25/5 = 5, dY = 10/5 = 2
      // rotY = (45 - 5 + 360) % 360 = 40
      // rotX = max(0, min(100, 65 - 2)) = 63
      expect(snapshot.camera.rotY).toBe(40);
      expect(snapshot.camera.rotX).toBe(63);

      // Simulate pointerup
      const upEvent = new PointerEvent("pointerup", {
        clientX: 125,
        clientY: 110,
        pointerId: 1
      });
      element.dispatchEvent(upEvent);

      binding.destroy();
    });

    it("cursor becomes 'grabbing' during drag", () => {
      const onSnapshot = vi.fn();
      const binding = mountCameraBinding(
        element,
        { interactive: true },
        onSnapshot
      );

      onSnapshot.mockClear();

      const downEvent = new PointerEvent("pointerdown", {
        clientX: 100,
        clientY: 100,
        pointerId: 1,
        isPrimary: true,
        cancelable: true
      });
      element.dispatchEvent(downEvent);

      // Find the snapshot emitted during drag
      expect(onSnapshot).toHaveBeenCalled();
      const snapshot = onSnapshot.mock.calls[onSnapshot.mock.calls.length - 1][0];
      expect(snapshot.cursor).toBe("grabbing");

      // Simulate pointerup to end drag
      const upEvent = new PointerEvent("pointerup", {
        clientX: 100,
        clientY: 100,
        pointerId: 1
      });
      element.dispatchEvent(upEvent);

      binding.destroy();
    });

    it("cursor returns to 'grab' after drag ends", () => {
      const onSnapshot = vi.fn();
      const binding = mountCameraBinding(
        element,
        { interactive: true },
        onSnapshot
      );

      // Start drag
      const downEvent = new PointerEvent("pointerdown", {
        clientX: 100,
        clientY: 100,
        pointerId: 1,
        isPrimary: true,
        cancelable: true
      });
      element.dispatchEvent(downEvent);

      onSnapshot.mockClear();

      // End drag
      const upEvent = new PointerEvent("pointerup", {
        clientX: 100,
        clientY: 100,
        pointerId: 1
      });
      element.dispatchEvent(upEvent);

      expect(onSnapshot).toHaveBeenCalled();
      const snapshot = onSnapshot.mock.calls[onSnapshot.mock.calls.length - 1][0];
      expect(snapshot.cursor).toBe("grab");

      binding.destroy();
    });

    it("ignores non-primary pointer events", () => {
      const onSnapshot = vi.fn();
      const binding = mountCameraBinding(
        element,
        { interactive: true },
        onSnapshot
      );

      onSnapshot.mockClear();

      // Dispatch non-primary pointerdown
      const downEvent = new PointerEvent("pointerdown", {
        clientX: 100,
        clientY: 100,
        pointerId: 2,
        isPrimary: false,
        cancelable: true
      });
      element.dispatchEvent(downEvent);

      // Should not change cursor to grabbing
      // If snapshot was emitted, cursor should still be grab
      if (onSnapshot.mock.calls.length > 0) {
        const snapshot = onSnapshot.mock.calls[onSnapshot.mock.calls.length - 1][0];
        expect(snapshot.cursor).not.toBe("grabbing");
      }

      binding.destroy();
    });

    it("pointercancel ends the drag", () => {
      const onSnapshot = vi.fn();
      const binding = mountCameraBinding(
        element,
        { interactive: true },
        onSnapshot
      );

      // Start drag
      const downEvent = new PointerEvent("pointerdown", {
        clientX: 100,
        clientY: 100,
        pointerId: 1,
        isPrimary: true,
        cancelable: true
      });
      element.dispatchEvent(downEvent);

      onSnapshot.mockClear();

      // Cancel the pointer
      const cancelEvent = new PointerEvent("pointercancel", {
        clientX: 100,
        clientY: 100,
        pointerId: 1
      });
      element.dispatchEvent(cancelEvent);

      expect(onSnapshot).toHaveBeenCalled();
      const snapshot = onSnapshot.mock.calls[onSnapshot.mock.calls.length - 1][0];
      expect(snapshot.cursor).toBe("grab");

      binding.destroy();
    });

    it("ignores pointermove from a different pointer id", () => {
      const onSnapshot = vi.fn();
      const binding = mountCameraBinding(
        element,
        { interactive: true, rotX: 65, rotY: 45 },
        onSnapshot
      );

      // Start drag with pointer 1
      const downEvent = new PointerEvent("pointerdown", {
        clientX: 100,
        clientY: 100,
        pointerId: 1,
        isPrimary: true,
        cancelable: true
      });
      element.dispatchEvent(downEvent);

      onSnapshot.mockClear();

      // Move with pointer 2 (different id) — should be ignored
      const moveEvent = new PointerEvent("pointermove", {
        clientX: 200,
        clientY: 200,
        pointerId: 2,
        cancelable: true
      });
      element.dispatchEvent(moveEvent);

      // No rotation update should have happened from the mismatched pointer
      // The only snapshot that might have been emitted is from the drag itself
      for (const call of onSnapshot.mock.calls) {
        const s = call[0];
        // rotY should not change from drag with pointer 2
        expect(s.camera.rotY).toBe(45);
        expect(s.camera.rotX).toBe(65);
      }

      // Clean up
      const upEvent = new PointerEvent("pointerup", {
        clientX: 100,
        clientY: 100,
        pointerId: 1
      });
      element.dispatchEvent(upEvent);

      binding.destroy();
    });

    it("sets touch-action and user-select on element when interactive", () => {
      const onSnapshot = vi.fn();
      const binding = mountCameraBinding(element, { interactive: true }, onSnapshot);

      expect(element.style.touchAction).toBe("none");
      expect(element.style.userSelect).toBe("none");

      binding.destroy();
    });

    it("restores touch-action and user-select on destroy", () => {
      element.style.touchAction = "auto";
      element.style.userSelect = "text";

      const onSnapshot = vi.fn();
      const binding = mountCameraBinding(element, { interactive: true }, onSnapshot);

      binding.destroy();

      expect(element.style.touchAction).toBe("auto");
      expect(element.style.userSelect).toBe("text");
    });
  });

  describe("perspective", () => {
    it("applies default perspective to element", () => {
      const onSnapshot = vi.fn();
      const binding = mountCameraBinding(element, {}, onSnapshot);

      expect(element.style.perspective).toBe("8000px");

      binding.destroy();
    });

    it("applies custom perspective value", () => {
      const onSnapshot = vi.fn();
      const binding = mountCameraBinding(element, { perspective: 5000 }, onSnapshot);

      expect(element.style.perspective).toBe("5000px");

      binding.destroy();
    });

    it("disables perspective when set to false", () => {
      const onSnapshot = vi.fn();
      const binding = mountCameraBinding(element, { perspective: false }, onSnapshot);

      expect(element.style.perspective).toBe("none");

      binding.destroy();
    });

    it("updates perspective via update()", () => {
      const onSnapshot = vi.fn();
      const binding = mountCameraBinding(element, { perspective: 8000 }, onSnapshot);

      binding.update({ perspective: 3000 });
      expect(element.style.perspective).toBe("3000px");

      binding.destroy();
    });
  });

  describe("boxStyle in snapshot", () => {
    it("boxStyle includes transform, width, height", () => {
      const onSnapshot = vi.fn();
      const binding = mountCameraBinding(element, {}, onSnapshot);

      const snapshot = onSnapshot.mock.calls[0][0];
      expect(snapshot.boxStyle).toBeDefined();
      expect(typeof snapshot.boxStyle.transform).toBe("string");
      expect(typeof snapshot.boxStyle.width).toBe("string");
      expect(typeof snapshot.boxStyle.height).toBe("string");

      binding.destroy();
    });
  });

  describe("walls in snapshot", () => {
    it("contains all six face keys", () => {
      const onSnapshot = vi.fn();
      const binding = mountCameraBinding(element, {}, onSnapshot);

      const snapshot = onSnapshot.mock.calls[0][0];
      const walls = snapshot.walls;
      expect(walls).toHaveProperty("t");
      expect(walls).toHaveProperty("b");
      expect(walls).toHaveProperty("bl");
      expect(walls).toHaveProperty("br");
      expect(walls).toHaveProperty("fl");
      expect(walls).toHaveProperty("fr");

      binding.destroy();
    });

    it("walls change when camera is rotated to different angle", () => {
      const onSnapshot = vi.fn();
      const binding = mountCameraBinding(element, { rotX: 65, rotY: 45 }, onSnapshot);

      const walls1 = onSnapshot.mock.calls[0][0].walls;

      onSnapshot.mockClear();
      binding.update({ rotY: 225 });

      expect(onSnapshot).toHaveBeenCalled();
      const walls2 = onSnapshot.mock.calls[onSnapshot.mock.calls.length - 1][0].walls;

      // At rotY=225, fr/bl/fl/br visibility should differ from rotY=45
      expect(walls2.fr).not.toBe(walls1.fr);

      binding.destroy();
    });
  });

  describe("invert pointer", () => {
    it("applies invert option through update", () => {
      const onSnapshot = vi.fn();
      const binding = mountCameraBinding(
        element,
        { interactive: true, rotX: 65, rotY: 45 },
        onSnapshot
      );

      // Enable inverted pointer
      binding.update({ invert: true });

      // Start drag
      const downEvent = new PointerEvent("pointerdown", {
        clientX: 100,
        clientY: 100,
        pointerId: 1,
        isPrimary: true,
        cancelable: true
      });
      element.dispatchEvent(downEvent);

      onSnapshot.mockClear();

      // Move pointer
      const moveEvent = new PointerEvent("pointermove", {
        clientX: 125,
        clientY: 100,
        pointerId: 1,
        cancelable: true
      });
      element.dispatchEvent(moveEvent);

      expect(onSnapshot).toHaveBeenCalled();
      const snapshot = onSnapshot.mock.calls[onSnapshot.mock.calls.length - 1][0];
      // With invert=true, multiplier is -1, so dX = (25 * -1) / 5 = -5
      // rotY = (45 - (-5) + 360) % 360 = 50
      expect(snapshot.camera.rotY).toBe(50);

      // End drag
      const upEvent = new PointerEvent("pointerup", {
        clientX: 125,
        clientY: 100,
        pointerId: 1
      });
      element.dispatchEvent(upEvent);

      binding.destroy();
    });
  });
});
