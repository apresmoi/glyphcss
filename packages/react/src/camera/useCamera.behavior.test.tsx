import { describe, it, expect, vi, afterEach } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { useCamera } from "./useCamera";
import type { UseCameraResult, UseCameraOptions } from "./useCamera";

function CameraTestHarness({
  onResult,
  ...options
}: UseCameraOptions & { onResult: (result: UseCameraResult) => void }) {
  const result = useCamera(options);
  onResult(result);
  return null;
}

function captureHook(options: UseCameraOptions = {}): UseCameraResult {
  let captured: UseCameraResult | null = null;
  const container = document.createElement("div");
  const root = createRoot(container);
  act(() =>
    root.render(
      <CameraTestHarness
        {...options}
        onResult={(r) => {
          captured = r;
        }}
      />
    )
  );
  return captured!;
}

describe("useCamera behavior", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("default camera state", () => {
    it("starts with standard defaults for zoom, rotation, and target", () => {
      const result = captureHook();
      const state = result.store.getState().cameraState;
      expect(state.zoom).toBe(0.65);
      expect(state.rotX).toBe(65);
      expect(state.rotY).toBe(45);
      expect(state.target).toEqual([0, 0, 0]);
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

    it("applies custom target", () => {
      const result = captureHook({ target: [5, 10, 0] });
      const state = result.store.getState().cameraState;
      expect(state.target).toEqual([5, 10, 0]);
    });
  });

  describe("prop changes update camera handle", () => {
    it("updates the camera handle when rotation props change", () => {
      let captured: UseCameraResult | null = null;
      const container = document.createElement("div");
      const root = createRoot(container);

      act(() =>
        root.render(
          <CameraTestHarness
            rotX={65}
            rotY={45}
            onResult={(r) => { captured = r; }}
          />
        )
      );

      act(() =>
        root.render(
          <CameraTestHarness
            rotX={65}
            rotY={135}
            onResult={(r) => { captured = r; }}
          />
        )
      );

      expect(captured!.cameraRef.current.state.rotY).toBe(135);
      expect(captured!.store.getState().cameraState.rotY).toBe(135);
    });

    it("updates the camera handle zoom directly", () => {
      let captured: UseCameraResult | null = null;
      const container = document.createElement("div");
      const root = createRoot(container);

      act(() =>
        root.render(
          <CameraTestHarness
            zoom={1.0}
            onResult={(r) => { captured = r; }}
          />
        )
      );
      expect(captured!.cameraRef.current.state.zoom).toBe(1.0);

      act(() =>
        root.render(
          <CameraTestHarness
            zoom={2.5}
            onResult={(r) => { captured = r; }}
          />
        )
      );
      expect(captured!.cameraRef.current.state.zoom).toBe(2.5);
    });
  });
});
