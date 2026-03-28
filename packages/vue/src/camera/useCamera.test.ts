import { describe, it, expect, vi, afterEach } from "vitest";
import { createApp, h, ref, computed, nextTick } from "vue";
import type { Ref } from "vue";
import { useCamera } from "./useCamera";
import type { UseCameraResult, UseCameraOptions } from "./useCamera";

function captureHook(options: UseCameraOptions = {}): UseCameraResult {
  let captured: UseCameraResult | null = null;
  const container = document.createElement("div");
  const optionsRef = computed(() => options);
  const app = createApp({
    setup() {
      captured = useCamera(optionsRef);
      return () => h("div");
    },
  });
  app.mount(container);
  return captured!;
}

describe("useCamera behavior", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("default camera state", () => {
    it("starts with standard defaults for zoom, rotation, pan, tilt, and depthOffset", () => {
      const result = captureHook();
      const state = result.store.getState().cameraState;
      expect(state.zoom).toBe(0.65);
      expect(state.rotX).toBe(65);
      expect(state.rotY).toBe(45);
      expect(state.pan).toBe(0);
      expect(state.tilt).toBe(0);
      expect(state.depthOffset).toBe(20);
    });

    it("returns grab cursor by default (useCamera always starts with grab)", () => {
      const result = captureHook();
      expect(result.cursor.value).toBe("grab");
    });
  });

  describe("initial camera props", () => {
    it("applies custom zoom", () => {
      const result = captureHook({ zoom: 2.0 });
      expect(result.store.getState().cameraState.zoom).toBe(2.0);
    });

    it("applies custom rotX and rotY", () => {
      const result = captureHook({ rotX: 30, rotY: 120 });
      const state = result.store.getState().cameraState;
      expect(state.rotX).toBe(30);
      expect(state.rotY).toBe(120);
    });

    it("applies custom pan and tilt", () => {
      const result = captureHook({ pan: 10, tilt: 5 });
      const state = result.store.getState().cameraState;
      expect(state.pan).toBe(10);
      expect(state.tilt).toBe(5);
    });
  });

  describe("prop changes update camera handle", () => {
    it("updates the camera handle when rotation props change across a wall-mask boundary", async () => {
      const opts = ref<UseCameraOptions>({ rotX: 65, rotY: 45 });
      let captured: UseCameraResult | null = null;
      const container = document.createElement("div");
      const app = createApp({
        setup() {
          captured = useCamera(computed(() => opts.value));
          return () => h("div");
        },
      });
      app.mount(container);

      const maskBefore = captured!.store.getState().wallMask;

      opts.value = { rotX: 65, rotY: 135 };
      await nextTick();

      const maskAfter = captured!.store.getState().wallMask;
      expect(maskAfter).not.toEqual(maskBefore);
      expect(captured!.cameraRef.value.state.rotY).toBe(135);
    });

    it("updates the camera handle zoom directly", async () => {
      const opts = ref<UseCameraOptions>({ zoom: 1.0 });
      let captured: UseCameraResult | null = null;
      const container = document.createElement("div");
      const app = createApp({
        setup() {
          captured = useCamera(computed(() => opts.value));
          return () => h("div");
        },
      });
      app.mount(container);

      expect(captured!.cameraRef.value.state.zoom).toBe(1.0);

      opts.value = { zoom: 2.5 };
      await nextTick();

      expect(captured!.cameraRef.value.state.zoom).toBe(2.5);
    });
  });

  describe("cursor changes based on interaction state", () => {
    it("shows grab cursor when interactive", () => {
      const result = captureHook({ interactive: true });
      expect(result.cursor.value).toBe("grab");
    });

    it("shows grab cursor when not interactive (cursor is always grab in useCamera)", () => {
      const result = captureHook({ interactive: false });
      // The Vue useCamera always starts with "grab" — the VoxCamera component controls
      // whether to apply it based on the interactive prop.
      expect(result.cursor.value).toBe("grab");
    });
  });

  describe("auto-rotate", () => {
    it("schedules animation frame when animate is true", () => {
      const rafSpy = vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation(() => 1);
      const container = document.createElement("div");
      const app = createApp({
        setup() {
          useCamera(computed(() => ({ animate: true } as UseCameraOptions)));
          return () => h("div");
        },
      });
      app.mount(container);

      expect(rafSpy).toHaveBeenCalled();
    });

    it("does not schedule animation when animate is false", () => {
      const rafSpy = vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation(() => 1);
      const container = document.createElement("div");
      const app = createApp({
        setup() {
          useCamera(computed(() => ({ animate: false } as UseCameraOptions)));
          return () => h("div");
        },
      });
      app.mount(container);

      expect(rafSpy).not.toHaveBeenCalled();
    });

    it("updates the camera handle rotation over time via animation frames", () => {
      let captured: UseCameraResult | null = null;
      const callbacks: FrameRequestCallback[] = [];
      vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
        callbacks.push(cb);
        return callbacks.length;
      });

      const container = document.createElement("div");
      const app = createApp({
        setup() {
          captured = useCamera(computed(() => ({ rotY: 0, animate: true } as UseCameraOptions)));
          return () => h("div");
        },
      });
      app.mount(container);

      const initialRotY = captured!.cameraRef.value.state.rotY;

      for (let i = 0; i < 10 && callbacks.length > 0; i++) {
        const cb = callbacks.shift()!;
        cb(performance.now());
      }

      const updatedRotY = captured!.cameraRef.value.state.rotY;
      expect(updatedRotY).not.toBe(initialRotY);
    });
  });
});
