import { describe, it, expect, afterEach, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { GlyphScene } from "../scene/GlyphScene";
import { GlyphCamera } from "./GlyphCamera";

function renderScene(
  cameraProps: React.ComponentProps<typeof GlyphCamera> = {},
): { container: HTMLElement; root: ReturnType<typeof createRoot> } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      React.createElement(
        GlyphCamera,
        cameraProps,
        React.createElement(GlyphScene, {}),
      ),
    ),
  );
  return { container, root };
}

describe("GlyphCamera (alias for Orthographic) — wraps scene", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("mounts without throwing", () => {
    expect(() => renderScene()).not.toThrow();
  });

  it("scene host is present after mounting GlyphCamera", () => {
    const { container } = renderScene({ zoom: 0.5 });
    expect(container.querySelector(".glyph-host")).toBeTruthy();
  });

  it("accepts zoom prop", () => {
    expect(() => renderScene({ zoom: 0.8 })).not.toThrow();
  });

  it("accepts rotX/rotY props", () => {
    expect(() => renderScene({ rotX: 1, rotY: 0.5 })).not.toThrow();
  });

  it("unmounts cleanly", () => {
    const { container, root } = renderScene({ zoom: 0.4 });
    act(() => root.unmount());
    expect(container.querySelector(".glyph-output")).toBeFalsy();
  });
});

describe("GlyphCamera — standalone (no scene child)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("mounts without throwing when used without a scene child", () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    expect(() => {
      act(() =>
        root.render(React.createElement(GlyphCamera, {})),
      );
    }).not.toThrow();
  });
});
