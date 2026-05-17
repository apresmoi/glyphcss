import { describe, it, expect, afterEach, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { GlyphcssScene } from "../scene/GlyphcssScene";
import { GlyphcssPerspectiveCamera } from "./GlyphcssPerspectiveCamera";

function renderScene(
  cameraProps: React.ComponentProps<typeof GlyphcssPerspectiveCamera> = {},
): { container: HTMLElement; root: ReturnType<typeof createRoot> } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      React.createElement(
        GlyphcssScene,
        {},
        React.createElement(GlyphcssPerspectiveCamera, cameraProps),
      ),
    ),
  );
  return { container, root };
}

describe("GlyphcssPerspectiveCamera — mount inside scene", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("mounts without throwing", () => {
    expect(() => renderScene()).not.toThrow();
  });

  it("scene host is still rendered after mounting camera", () => {
    const { container } = renderScene({ distance: 5 });
    expect(container.querySelector(".glyphcss-host")).toBeTruthy();
  });

  it("scene output <pre> is still rendered after mounting camera", () => {
    const { container } = renderScene({ distance: 5 });
    expect(container.querySelector(".glyphcss-output")).toBeTruthy();
  });

  it("accepts distance prop without throwing", () => {
    expect(() => renderScene({ distance: 10 })).not.toThrow();
  });

  it("accepts rotX and rotY props without throwing", () => {
    expect(() => renderScene({ rotX: 0.5, rotY: 1.2 })).not.toThrow();
  });

  it("accepts scale prop without throwing", () => {
    expect(() => renderScene({ scale: 0.6 })).not.toThrow();
  });

  it("accepts stretch prop without throwing", () => {
    expect(() => renderScene({ stretch: 1.5 })).not.toThrow();
  });

  it("accepts center prop without throwing", () => {
    expect(() => renderScene({ center: [0.3, 0.7] })).not.toThrow();
  });

  it("re-renders when distance changes", () => {
    const { container, root } = renderScene({ distance: 3 });
    expect(container.querySelector(".glyphcss-output")).toBeTruthy();
    act(() =>
      root.render(
        React.createElement(
          GlyphcssScene,
          {},
          React.createElement(GlyphcssPerspectiveCamera, { distance: 7 }),
        ),
      ),
    );
    expect(container.querySelector(".glyphcss-output")).toBeTruthy();
  });

  it("unmounts cleanly and host is removed", () => {
    const { container, root } = renderScene({ distance: 3 });
    act(() => root.unmount());
    expect(container.querySelector(".glyphcss-output")).toBeFalsy();
  });
});

describe("GlyphcssPerspectiveCamera — outside scene", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("throws when mounted outside GlyphcssScene", () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    expect(() => {
      act(() =>
        root.render(React.createElement(GlyphcssPerspectiveCamera, {})),
      );
    }).toThrow();
  });
});
