import { describe, it, expect } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { usePolyCamera } from "./useCamera";
import type { UseCameraResult } from "./useCamera";

function CameraTestHarness({
  onResult,
  ...options
}: Parameters<typeof usePolyCamera>[0] & { onResult: (result: UseCameraResult) => void }) {
  const result = usePolyCamera(options);
  onResult(result);
  return null;
}

function captureHook(options: Parameters<typeof usePolyCamera>[0] = {}): UseCameraResult {
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

describe("useCamera", () => {
  it("returns default camera state via store", () => {
    const result = captureHook();
    const state = result.store.getState().cameraState;
    expect(state.zoom).toBe(0.65);
    expect(state.rotX).toBe(65);
    expect(state.rotY).toBe(45);
    expect(state.target).toEqual([0, 0, 0]);
  });

  it("applies initial zoom", () => {
    const result = captureHook({ zoom: 1.5 });
    expect(result.store.getState().cameraState.zoom).toBe(1.5);
  });

  it("applies initial rotation", () => {
    const result = captureHook({ rotX: 90, rotY: 180 });
    const state = result.store.getState().cameraState;
    expect(state.rotX).toBe(90);
    expect(state.rotY).toBe(180);
  });

  it("applies initial target", () => {
    const result = captureHook({ target: [1, 2, 0] });
    expect(result.store.getState().cameraState.target).toEqual([1, 2, 0]);
  });
});
