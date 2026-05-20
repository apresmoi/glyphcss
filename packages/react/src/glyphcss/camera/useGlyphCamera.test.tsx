/**
 * Tests for useGlyphCamera via a thin consumer component.
 * We do not import renderHook — we test observable rendering behavior.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { GlyphScene } from "../scene/GlyphScene";
import { GlyphPerspectiveCamera } from "./GlyphPerspectiveCamera";
import { useGlyphCamera } from "./context";

/**
 * Consumer component that reads from GlyphCameraContext and renders the
 * cameraRef presence as a data attribute on a div.
 */
function CameraConsumer(): React.ReactElement {
  const { cameraRef } = useGlyphCamera();
  return React.createElement("div", {
    "data-has-camera": cameraRef.current !== null ? "true" : "false",
    className: "camera-consumer",
  });
}

function renderWithCamera(
  cameraProps: React.ComponentProps<typeof GlyphPerspectiveCamera> = {},
): { container: HTMLElement; root: ReturnType<typeof createRoot> } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      React.createElement(
        GlyphPerspectiveCamera,
        cameraProps,
        React.createElement(
          GlyphScene,
          {},
          React.createElement(CameraConsumer, null),
        ),
      ),
    ),
  );
  return { container, root };
}

describe("useGlyphCamera — via consumer inside camera context", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("consumer component renders inside the camera context", () => {
    const { container } = renderWithCamera({ distance: 5 });
    const consumer = container.querySelector(".camera-consumer");
    expect(consumer).toBeTruthy();
  });

  it("scene output is still rendered when camera consumer is present", () => {
    const { container } = renderWithCamera({ distance: 5 });
    expect(container.querySelector(".glyph-output")).toBeTruthy();
  });

  it("camera consumer mounts without throwing", () => {
    expect(() => renderWithCamera({ distance: 3 })).not.toThrow();
  });

  it("unmounts cleanly when camera and consumer are present", () => {
    const { container, root } = renderWithCamera({ distance: 3 });
    act(() => root.unmount());
    expect(container.querySelector(".glyph-output")).toBeFalsy();
  });
});

describe("useGlyphCamera — error when outside camera context", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("throws when used outside GlyphCamera", () => {
    // CameraConsumer calls useGlyphCamera which requires the camera context.
    const container = document.createElement("div");
    const root = createRoot(container);
    expect(() => {
      act(() =>
        root.render(
          React.createElement(CameraConsumer, null),
        ),
      );
    }).toThrow();
  });
});
