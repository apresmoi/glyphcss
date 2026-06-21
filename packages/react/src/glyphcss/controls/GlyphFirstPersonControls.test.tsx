import { describe, it, expect, afterEach, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { GlyphScene } from "../scene/GlyphScene";
import { GlyphPerspectiveCamera } from "../camera/GlyphPerspectiveCamera";
import { GlyphFirstPersonControls } from "./GlyphFirstPersonControls";

function renderScene(
  controlsProps: React.ComponentProps<typeof GlyphFirstPersonControls> = {},
): { container: HTMLElement; root: ReturnType<typeof createRoot> } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      React.createElement(
        GlyphPerspectiveCamera,
        {},
        React.createElement(
          GlyphScene,
          {},
          React.createElement(GlyphFirstPersonControls, controlsProps),
        ),
      ),
    ),
  );
  return { container, root };
}

describe("GlyphFirstPersonControls — mount inside scene", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("mounts without throwing", () => {
    expect(() => renderScene()).not.toThrow();
  });

  it("scene host is present after mounting first-person controls", () => {
    const { container } = renderScene();
    expect(container.querySelector(".glyph-host")).toBeTruthy();
  });

  it("accepts lookEnabled=false without throwing", () => {
    expect(() => renderScene({ lookEnabled: false })).not.toThrow();
  });

  it("accepts moveEnabled=false without throwing", () => {
    expect(() => renderScene({ moveEnabled: false })).not.toThrow();
  });

  it("accepts custom moveSpeed and lookSensitivity", () => {
    expect(() => renderScene({ moveSpeed: 0.1, lookSensitivity: 0.01 })).not.toThrow();
  });

  it("accepts invertY=true", () => {
    expect(() => renderScene({ invertY: true })).not.toThrow();
  });

  it("updates props without throwing", () => {
    const { container, root } = renderScene({ lookEnabled: true, moveEnabled: true });
    act(() =>
      root.render(
        React.createElement(
          GlyphPerspectiveCamera,
          {},
          React.createElement(
            GlyphScene,
            {},
            React.createElement(GlyphFirstPersonControls, { lookEnabled: false, moveEnabled: false }),
          ),
        ),
      ),
    );
    expect(container.querySelector(".glyph-scene")).toBeTruthy();
  });

  it("unmounts cleanly", () => {
    const { container, root } = renderScene();
    act(() => root.unmount());
    expect(container.querySelector(".glyph-output")).toBeFalsy();
  });
});

describe("GlyphFirstPersonControls — outside scene", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("throws when mounted outside GlyphScene", () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    expect(() => {
      act(() =>
        root.render(React.createElement(GlyphFirstPersonControls, {})),
      );
    }).toThrow();
  });
});
