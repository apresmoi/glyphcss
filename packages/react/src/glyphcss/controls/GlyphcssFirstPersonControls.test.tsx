import { describe, it, expect, afterEach, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { GlyphcssScene } from "../scene/GlyphcssScene";
import { GlyphcssFirstPersonControls } from "./GlyphcssFirstPersonControls";

function renderScene(
  controlsProps: React.ComponentProps<typeof GlyphcssFirstPersonControls> = {},
): { container: HTMLElement; root: ReturnType<typeof createRoot> } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      React.createElement(
        GlyphcssScene,
        {},
        React.createElement(GlyphcssFirstPersonControls, controlsProps),
      ),
    ),
  );
  return { container, root };
}

describe("GlyphcssFirstPersonControls — mount inside scene", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("mounts without throwing", () => {
    expect(() => renderScene()).not.toThrow();
  });

  it("scene host is present after mounting first-person controls", () => {
    const { container } = renderScene();
    expect(container.querySelector(".glyphcss-host")).toBeTruthy();
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
          GlyphcssScene,
          {},
          React.createElement(GlyphcssFirstPersonControls, { drag: false, keyboard: false }),
        ),
      ),
    );
    expect(container.querySelector(".glyphcss-scene")).toBeTruthy();
  });

  it("unmounts cleanly", () => {
    const { container, root } = renderScene();
    act(() => root.unmount());
    expect(container.querySelector(".glyphcss-output")).toBeFalsy();
  });
});

describe("GlyphcssFirstPersonControls — outside scene", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("throws when mounted outside GlyphcssScene", () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    expect(() => {
      act(() =>
        root.render(React.createElement(GlyphcssFirstPersonControls, {})),
      );
    }).toThrow();
  });
});
