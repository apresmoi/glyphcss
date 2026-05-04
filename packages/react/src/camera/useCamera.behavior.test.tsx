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

    it("returns default cursor when not interactive", () => {
      const result = captureHook();
      expect(result.cursor).toBe("default");
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
    it("updates the camera handle when rotation props change across a direction-bin boundary", () => {
      let captured: UseCameraResult | null = null;
      const container = document.createElement("div");
      const root = createRoot(container);

      // Start at rotY=45
      act(() =>
        root.render(
          <CameraTestHarness
            rotX={65}
            rotY={45}
            onResult={(r) => { captured = r; }}
          />
        )
      );

      const dirBinBefore = captured!.store.getState().dirBin;

      // Move to rotY=135 — crosses a quadrant boundary so dirBin changes
      act(() =>
        root.render(
          <CameraTestHarness
            rotX={65}
            rotY={135}
            onResult={(r) => { captured = r; }}
          />
        )
      );

      const dirBinAfter = captured!.store.getState().dirBin;
      // Direction bin should have changed
      expect(dirBinAfter).not.toEqual(dirBinBefore);
      // Camera handle reflects the new rotation
      expect(captured!.cameraRef.current.state.rotY).toBe(135);
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

  describe("cursor changes based on interaction state", () => {
    it("shows grab cursor when interactive and not dragging", () => {
      const result = captureHook({ interactive: true });
      expect(result.cursor).toBe("grab");
    });

    it("shows default cursor when not interactive", () => {
      const result = captureHook({ interactive: false });
      expect(result.cursor).toBe("default");
    });
  });

  describe("auto-rotate", () => {
    it("schedules animation frame when animate is true", () => {
      const rafSpy = vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation(() => 1);

      const container = document.createElement("div");
      const root = createRoot(container);
      act(() =>
        root.render(
          <CameraTestHarness
            animate={true}
            onResult={() => {}}
          />
        )
      );

      expect(rafSpy).toHaveBeenCalled();
    });

    it("does not schedule animation when animate is false", () => {
      const rafSpy = vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation(() => 1);

      const container = document.createElement("div");
      const root = createRoot(container);
      act(() =>
        root.render(
          <CameraTestHarness
            animate={false}
            onResult={() => {}}
          />
        )
      );

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
      const root = createRoot(container);
      act(() =>
        root.render(
          <CameraTestHarness
            rotY={0}
            animate={true}
            onResult={(r) => { captured = r; }}
          />
        )
      );

      const initialRotY = captured!.cameraRef.current.state.rotY;

      // Simulate several animation frames
      act(() => {
        for (let i = 0; i < 10 && callbacks.length > 0; i++) {
          const cb = callbacks.shift()!;
          cb(performance.now());
        }
      });

      const updatedRotY = captured!.cameraRef.current.state.rotY;
      // Camera handle rotation should have advanced
      expect(updatedRotY).not.toBe(initialRotY);
    });
  });
});
