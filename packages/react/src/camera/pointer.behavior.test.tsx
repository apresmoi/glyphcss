import { describe, it, expect, vi, afterEach } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { useCamera } from "./useCamera";
import type { UseCameraResult, UseCameraOptions } from "./useCamera";
import type { PointerEvent as ReactPointerEvent } from "react";

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

function makePointerEvent(
  type: string,
  overrides: Partial<{
    clientX: number;
    clientY: number;
    pointerId: number;
    isPrimary: boolean;
  }> = {}
): ReactPointerEvent<HTMLDivElement> {
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
  } as unknown as ReactPointerEvent<HTMLDivElement>;
}

describe("pointer interaction behavior", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("pointer down sets dragging state", () => {
    it("changes cursor to grabbing after pointer down", () => {
      let captured: UseCameraResult | null = null;
      const container = document.createElement("div");
      const root = createRoot(container);

      act(() =>
        root.render(
          <CameraTestHarness
            interactive={true}
            onResult={(r) => {
              captured = r;
            }}
          />
        )
      );

      expect(captured!.cursor).toBe("grab");

      const downEvent = makePointerEvent("pointerdown");
      act(() => {
        captured!.onPointerDown(downEvent);
      });

      // Re-render to pick up state change
      act(() =>
        root.render(
          <CameraTestHarness
            interactive={true}
            onResult={(r) => {
              captured = r;
            }}
          />
        )
      );

      expect(captured!.cursor).toBe("grabbing");
    });
  });

  describe("pointer move during drag updates camera rotation", () => {
    it("updates rotY when dragging horizontally", () => {
      let captured: UseCameraResult | null = null;
      const container = document.createElement("div");
      const root = createRoot(container);

      act(() =>
        root.render(
          <CameraTestHarness
            interactive={true}
            rotY={45}
            onResult={(r) => {
              captured = r;
            }}
          />
        )
      );

      const initialRotY = captured!.cameraRef.current.state.rotY;

      const downEvent = makePointerEvent("pointerdown", { clientX: 100, clientY: 100 });
      act(() => {
        captured!.onPointerDown(downEvent);
      });

      const moveEvent = makePointerEvent("pointermove", { clientX: 150, clientY: 100 });
      act(() => {
        captured!.onPointerMove(moveEvent);
      });

      const updatedRotY = captured!.cameraRef.current.state.rotY;
      expect(updatedRotY).not.toBe(initialRotY);
    });
  });

  describe("pointer up ends drag", () => {
    it("restores cursor to grab after pointer up", () => {
      let captured: UseCameraResult | null = null;
      const container = document.createElement("div");
      const root = createRoot(container);

      act(() =>
        root.render(
          <CameraTestHarness
            interactive={true}
            onResult={(r) => {
              captured = r;
            }}
          />
        )
      );

      const downEvent = makePointerEvent("pointerdown");
      act(() => {
        captured!.onPointerDown(downEvent);
      });

      const upEvent = makePointerEvent("pointerup");
      act(() => {
        captured!.onPointerUp(upEvent);
      });

      // Re-render to pick up state change
      act(() =>
        root.render(
          <CameraTestHarness
            interactive={true}
            onResult={(r) => {
              captured = r;
            }}
          />
        )
      );

      expect(captured!.cursor).toBe("grab");
    });
  });

  describe("pointer move without prior down does nothing", () => {
    it("does not change camera rotation when not dragging", () => {
      const result = captureHook({ interactive: true, rotY: 45 });
      const initialRotY = result.cameraRef.current.state.rotY;

      const moveEvent = makePointerEvent("pointermove", { clientX: 200, clientY: 200 });
      act(() => {
        result.onPointerMove(moveEvent);
      });

      expect(result.cameraRef.current.state.rotY).toBe(initialRotY);
    });
  });

  describe("invert option reverses drag direction", () => {
    it("moves rotation in opposite direction when invert is true", () => {
      // Normal drag
      let capturedNormal: UseCameraResult | null = null;
      const containerNormal = document.createElement("div");
      const rootNormal = createRoot(containerNormal);

      act(() =>
        rootNormal.render(
          <CameraTestHarness
            interactive={true}
            invert={false}
            onResult={(r) => {
              capturedNormal = r;
            }}
          />
        )
      );

      const normalInitialRotY = capturedNormal!.cameraRef.current.state.rotY;

      const downNormal = makePointerEvent("pointerdown", { clientX: 100, clientY: 100 });
      act(() => {
        capturedNormal!.onPointerDown(downNormal);
      });

      const moveNormal = makePointerEvent("pointermove", { clientX: 200, clientY: 100 });
      act(() => {
        capturedNormal!.onPointerMove(moveNormal);
      });

      const normalDelta = capturedNormal!.cameraRef.current.state.rotY - normalInitialRotY;

      // Inverted drag — separate mount so the camera handle is fresh
      let capturedInvert: UseCameraResult | null = null;
      const containerInvert = document.createElement("div");
      const rootInvert = createRoot(containerInvert);

      act(() =>
        rootInvert.render(
          <CameraTestHarness
            interactive={true}
            invert={true}
            onResult={(r) => {
              capturedInvert = r;
            }}
          />
        )
      );

      const invertInitialRotY = capturedInvert!.cameraRef.current.state.rotY;

      const downInvert = makePointerEvent("pointerdown", { clientX: 100, clientY: 100 });
      act(() => {
        capturedInvert!.onPointerDown(downInvert);
      });

      const moveInvert = makePointerEvent("pointermove", { clientX: 200, clientY: 100 });
      act(() => {
        capturedInvert!.onPointerMove(moveInvert);
      });

      const invertDelta = capturedInvert!.cameraRef.current.state.rotY - invertInitialRotY;

      // The deltas should have opposite signs
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

      let captured: UseCameraResult | null = null;
      const container = document.createElement("div");
      const root = createRoot(container);

      act(() =>
        root.render(
          <CameraTestHarness
            interactive={true}
            rotY={0}
            animate={{ speed: 1, pauseOnInteraction: true }}
            onResult={(r) => {
              captured = r;
            }}
          />
        )
      );

      // Run a few animation frames to confirm rotation advances
      act(() => {
        for (let i = 0; i < 5 && callbacks.length > 0; i++) {
          const cb = callbacks.shift()!;
          cb(performance.now());
        }
      });

      const rotYBeforePause = captured!.cameraRef.current.state.rotY;
      expect(rotYBeforePause).not.toBe(0); // Animation was running

      // Now trigger pointer down to pause
      const downEvent = makePointerEvent("pointerdown");
      act(() => {
        captured!.onPointerDown(downEvent);
      });

      // Run more animation frames — rotation should NOT advance further
      const rotYAtPause = captured!.cameraRef.current.state.rotY;
      act(() => {
        for (let i = 0; i < 5 && callbacks.length > 0; i++) {
          const cb = callbacks.shift()!;
          cb(performance.now());
        }
      });

      const rotYAfterPause = captured!.cameraRef.current.state.rotY;
      expect(rotYAfterPause).toBe(rotYAtPause);
    });
  });
});
