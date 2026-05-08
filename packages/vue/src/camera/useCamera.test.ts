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
    it("updates the camera handle when rotation props change across a direction-bin boundary", async () => {
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

      opts.value = { rotX: 65, rotY: 135 };
      await nextTick();

      expect(captured!.cameraRef.value.state.rotY).toBe(135);
      expect(captured!.store.getState().cameraState.rotY).toBe(135);
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

});
