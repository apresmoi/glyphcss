import { describe, it, expect, afterEach, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { GlyphScene } from "../scene/GlyphScene";
import { GlyphPerspectiveCamera } from "./GlyphPerspectiveCamera";

function renderScene(
  cameraProps: React.ComponentProps<typeof GlyphPerspectiveCamera> = {},
): { container: HTMLElement; root: ReturnType<typeof createRoot> } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      React.createElement(
        GlyphScene,
        {},
        React.createElement(GlyphPerspectiveCamera, cameraProps),
      ),
    ),
  );
  return { container, root };
}

describe("GlyphPerspectiveCamera — mount inside scene", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("mounts without throwing", () => {
    expect(() => renderScene()).not.toThrow();
  });

  it("scene host is still rendered after mounting camera", () => {
    const { container } = renderScene({ distance: 5 });
    expect(container.querySelector(".glyph-host")).toBeTruthy();
  });

  it("scene output <pre> is still rendered after mounting camera", () => {
    const { container } = renderScene({ distance: 5 });
    expect(container.querySelector(".glyph-output")).toBeTruthy();
  });

  it("accepts distance prop without throwing", () => {
    expect(() => renderScene({ distance: 10 })).not.toThrow();
  });

  it("accepts rotX and rotY props without throwing", () => {
    expect(() => renderScene({ rotX: 0.5, rotY: 1.2 })).not.toThrow();
  });

  it("accepts zoom prop without throwing", () => {
    expect(() => renderScene({ zoom: 0.6 })).not.toThrow();
  });

  it("accepts stretch prop without throwing", () => {
    expect(() => renderScene({ stretch: 1.5 })).not.toThrow();
  });

  it("accepts center prop without throwing", () => {
    expect(() => renderScene({ center: [0.3, 0.7] })).not.toThrow();
  });

  it("re-renders when distance changes", () => {
    const { container, root } = renderScene({ distance: 3 });
    expect(container.querySelector(".glyph-output")).toBeTruthy();
    act(() =>
      root.render(
        React.createElement(
          GlyphScene,
          {},
          React.createElement(GlyphPerspectiveCamera, { distance: 7 }),
        ),
      ),
    );
    expect(container.querySelector(".glyph-output")).toBeTruthy();
  });

  it("unmounts cleanly and host is removed", () => {
    const { container, root } = renderScene({ distance: 3 });
    act(() => root.unmount());
    expect(container.querySelector(".glyph-output")).toBeFalsy();
  });
});

describe("GlyphPerspectiveCamera — outside scene", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("throws when mounted outside GlyphScene", () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    expect(() => {
      act(() =>
        root.render(React.createElement(GlyphPerspectiveCamera, {})),
      );
    }).toThrow();
  });
});
