import { describe, it, expect, afterEach, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { GlyphScene } from "../scene/GlyphScene";
import { GlyphOrthographicCamera } from "./GlyphOrthographicCamera";

function renderScene(
  cameraProps: React.ComponentProps<typeof GlyphOrthographicCamera> = {},
): { container: HTMLElement; root: ReturnType<typeof createRoot> } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      React.createElement(
        GlyphOrthographicCamera,
        cameraProps,
        React.createElement(GlyphScene, {}),
      ),
    ),
  );
  return { container, root };
}

describe("GlyphOrthographicCamera — wraps scene", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("mounts without throwing", () => {
    expect(() => renderScene()).not.toThrow();
  });

  it("scene host is still rendered when orthographic camera wraps it", () => {
    const { container } = renderScene();
    expect(container.querySelector(".glyph-host")).toBeTruthy();
  });

  it("scene output <pre> is present after mounting orthographic camera", () => {
    const { container } = renderScene();
    expect(container.querySelector(".glyph-output")).toBeTruthy();
  });

  it("accepts zoom prop without throwing", () => {
    expect(() => renderScene({ zoom: 0.6 })).not.toThrow();
  });

  it("accepts rotX and rotY props without throwing", () => {
    expect(() => renderScene({ rotX: 0.3, rotY: 0.8 })).not.toThrow();
  });

  it("accepts center prop without throwing", () => {
    expect(() => renderScene({ center: [0.4, 0.6] })).not.toThrow();
  });

  it("re-renders when zoom changes", () => {
    const { container, root } = renderScene({ zoom: 0.4 });
    expect(container.querySelector(".glyph-output")).toBeTruthy();
    act(() =>
      root.render(
        React.createElement(
          GlyphOrthographicCamera,
          { zoom: 0.8 },
          React.createElement(GlyphScene, {}),
        ),
      ),
    );
    expect(container.querySelector(".glyph-output")).toBeTruthy();
  });

  it("unmounts cleanly", () => {
    const { container, root } = renderScene({ zoom: 0.5 });
    act(() => root.unmount());
    expect(container.querySelector(".glyph-output")).toBeFalsy();
  });
});

describe("GlyphOrthographicCamera — standalone (no scene child)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("mounts without throwing when used without a scene child", () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    expect(() => {
      act(() =>
        root.render(React.createElement(GlyphOrthographicCamera, {})),
      );
    }).not.toThrow();
  });
});
