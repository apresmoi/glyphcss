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

  it("accepts drag=false without throwing", () => {
    expect(() => renderScene({ drag: false })).not.toThrow();
  });

  it("accepts keyboard=false without throwing", () => {
    expect(() => renderScene({ keyboard: false })).not.toThrow();
  });

  it("accepts custom moveSpeed and lookSpeed", () => {
    expect(() => renderScene({ moveSpeed: 0.1, lookSpeed: 0.01 })).not.toThrow();
  });

  it("accepts invert=true", () => {
    expect(() => renderScene({ invert: true })).not.toThrow();
  });

  it("updates props without throwing", () => {
    const { container, root } = renderScene({ drag: true, keyboard: true });
    act(() =>
      root.render(
        React.createElement(
          GlyphPerspectiveCamera,
          {},
          React.createElement(
            GlyphScene,
            {},
            React.createElement(GlyphFirstPersonControls, { drag: false, keyboard: false }),
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
