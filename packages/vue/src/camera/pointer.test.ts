import { describe, it, expect, vi, afterEach } from "vitest";
import { createApp, h, computed } from "vue";
import { useCamera } from "./useCamera";
import type { UseCameraResult, UseCameraOptions } from "./useCamera";

function makePointerEvent(
  type: string,
  overrides: Partial<{
    clientX: number;
    clientY: number;
    pointerId: number;
    isPrimary: boolean;
  }> = {}
): PointerEvent {
  return {
    clientX: overrides.clientX ?? 0,
    clientY: overrides.clientY ?? 0,
    pointerId: overrides.pointerId ?? 1,
    isPrimary: overrides.isPrimary ?? true,
    preventDefault: vi.fn(),
    currentTarget: {
      setPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn(),
    },
  } as unknown as PointerEvent;
}

function mountCamera(options: UseCameraOptions = {}): UseCameraResult {
  let captured: UseCameraResult | null = null;
  const container = document.createElement("div");
  const app = createApp({
    setup() {
      captured = useCamera(computed(() => options));
      return () => h("div");
    },
  });
  app.mount(container);
  return captured!;
}

describe("pointer interaction behavior", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("pointer down sets dragging state", () => {
    it("changes cursor to grabbing after pointer down", () => {
      const result = mountCamera({ interactive: true });
      expect(result.cursor.value).toBe("grab");

      const downEvent = makePointerEvent("pointerdown");
      result.onPointerDown(downEvent);

      expect(result.cursor.value).toBe("grabbing");
    });
  });

  describe("pointer move during drag updates camera rotation", () => {
    it("updates rotY when dragging horizontally", () => {
      const result = mountCamera({ interactive: true, rotY: 45 });
      const initialRotY = result.cameraRef.value.state.rotY;

      const downEvent = makePointerEvent("pointerdown", { clientX: 100, clientY: 100 });
      result.onPointerDown(downEvent);

      const moveEvent = makePointerEvent("pointermove", { clientX: 150, clientY: 100 });
      result.onPointerMove(moveEvent);

      const updatedRotY = result.cameraRef.value.state.rotY;
      expect(updatedRotY).not.toBe(initialRotY);
    });
  });

  describe("pointer up ends drag", () => {
    it("restores cursor to grab after pointer up", () => {
      const result = mountCamera({ interactive: true });

      const downEvent = makePointerEvent("pointerdown");
      result.onPointerDown(downEvent);
      expect(result.cursor.value).toBe("grabbing");

      const upEvent = makePointerEvent("pointerup");
      result.onPointerUp(upEvent);

      expect(result.cursor.value).toBe("grab");
    });
  });

  describe("pointer move without prior down does nothing", () => {
    it("does not change camera rotation when not dragging", () => {
      const result = mountCamera({ interactive: true, rotY: 45 });
      const initialRotY = result.cameraRef.value.state.rotY;

      const moveEvent = makePointerEvent("pointermove", { clientX: 200, clientY: 200 });
      result.onPointerMove(moveEvent);

      expect(result.cameraRef.value.state.rotY).toBe(initialRotY);
    });
  });

  describe("invert option reverses drag direction", () => {
    it("moves rotation in opposite direction when invert is true", () => {
      const resultNormal = mountCamera({ interactive: true, invert: false });
      const normalInitialRotY = resultNormal.cameraRef.value.state.rotY;

      const downNormal = makePointerEvent("pointerdown", { clientX: 100, clientY: 100 });
      resultNormal.onPointerDown(downNormal);
      const moveNormal = makePointerEvent("pointermove", { clientX: 200, clientY: 100 });
      resultNormal.onPointerMove(moveNormal);

      const normalDelta = resultNormal.cameraRef.value.state.rotY - normalInitialRotY;

      const resultInvert = mountCamera({ interactive: true, invert: true });
      const invertInitialRotY = resultInvert.cameraRef.value.state.rotY;

      const downInvert = makePointerEvent("pointerdown", { clientX: 100, clientY: 100 });
      resultInvert.onPointerDown(downInvert);
      const moveInvert = makePointerEvent("pointermove", { clientX: 200, clientY: 100 });
      resultInvert.onPointerMove(moveInvert);

      const invertDelta = resultInvert.cameraRef.value.state.rotY - invertInitialRotY;

      expect(normalDelta).not.toBe(0);
      expect(Math.sign(invertDelta)).toBe(-Math.sign(normalDelta));
    });
  });

  describe("animation pauses on pointer interaction", () => {
    it("pauses auto-rotate when pauseOnInteraction is true and pointer down occurs", () => {
      const callbacks: FrameRequestCallback[] = [];
      vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
        callbacks.push(cb);
        return callbacks.length;
      });

      const result = mountCamera({
        interactive: true,
        rotY: 0,
        animate: { speed: 1, pauseOnInteraction: true },
      });

      // Run a few animation frames to confirm rotation advances
      for (let i = 0; i < 5 && callbacks.length > 0; i++) {
        const cb = callbacks.shift()!;
        cb(performance.now());
      }

      const rotYBeforePause = result.cameraRef.value.state.rotY;
      expect(rotYBeforePause).not.toBe(0);

      // Now trigger pointer down to pause
      const downEvent = makePointerEvent("pointerdown");
      result.onPointerDown(downEvent);

      // Run more animation frames -- rotation should NOT advance further
      const rotYAtPause = result.cameraRef.value.state.rotY;
      for (let i = 0; i < 5 && callbacks.length > 0; i++) {
        const cb = callbacks.shift()!;
        cb(performance.now());
      }

      const rotYAfterPause = result.cameraRef.value.state.rotY;
      expect(rotYAfterPause).toBe(rotYAtPause);
    });
  });
});
