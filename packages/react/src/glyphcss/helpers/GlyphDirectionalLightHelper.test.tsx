import { describe, it, expect, afterEach, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { GlyphScene } from "../scene/GlyphScene";
import { GlyphDirectionalLightHelper } from "./GlyphDirectionalLightHelper";

function renderScene(
  helperProps: React.ComponentProps<typeof GlyphDirectionalLightHelper> = {},
): { container: HTMLElement; root: ReturnType<typeof createRoot> } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      React.createElement(
        GlyphScene,
        {},
        React.createElement(GlyphDirectionalLightHelper, helperProps),
      ),
    ),
  );
  return { container, root };
}

describe("GlyphDirectionalLightHelper — mount inside scene", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("mounts without throwing", () => {
    expect(() => renderScene()).not.toThrow();
  });

  it("scene host is present after mounting light helper", () => {
    const { container } = renderScene();
    expect(container.querySelector(".glyph-host")).toBeTruthy();
  });

  it("scene output <pre> is present after mounting light helper", () => {
    const { container } = renderScene();
    expect(container.querySelector(".glyph-output")).toBeTruthy();
  });

  it("accepts custom position", () => {
    expect(() => renderScene({ position: [2, 3, 4] })).not.toThrow();
  });

  it("accepts custom color", () => {
    expect(() => renderScene({ color: "#ff0000" })).not.toThrow();
  });

  it("accepts custom size", () => {
    expect(() => renderScene({ size: 0.5 })).not.toThrow();
  });

  it("accepts all custom props combined", () => {
    expect(() =>
      renderScene({ position: [5, 5, 5], color: "#00ff00", size: 0.2 }),
    ).not.toThrow();
  });

  it("updates position prop without throwing", () => {
    const { container, root } = renderScene({ position: [1, 1, 1] });
    act(() =>
      root.render(
        React.createElement(
          GlyphScene,
          {},
          React.createElement(GlyphDirectionalLightHelper, { position: [2, 2, 2] }),
        ),
      ),
    );
    expect(container.querySelector(".glyph-output")).toBeTruthy();
  });

  it("unmounts cleanly", () => {
    const { container, root } = renderScene({ position: [1, 1, 1] });
    act(() => root.unmount());
    expect(container.querySelector(".glyph-output")).toBeFalsy();
  });
});

describe("GlyphDirectionalLightHelper — outside scene", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("throws when mounted outside GlyphScene", () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    expect(() => {
      act(() =>
        root.render(React.createElement(GlyphDirectionalLightHelper, {})),
      );
    }).toThrow();
  });
});
