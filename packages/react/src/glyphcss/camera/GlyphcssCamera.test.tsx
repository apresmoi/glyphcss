import { describe, it, expect, afterEach, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { GlyphcssScene } from "../scene/GlyphcssScene";
import { GlyphcssCamera } from "./GlyphcssCamera";

function renderScene(
  cameraProps: React.ComponentProps<typeof GlyphcssCamera> = {},
): { container: HTMLElement; root: ReturnType<typeof createRoot> } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      React.createElement(
        GlyphcssScene,
        {},
        React.createElement(GlyphcssCamera, cameraProps),
      ),
    ),
  );
  return { container, root };
}

describe("GlyphcssCamera (alias for Perspective) — mount inside scene", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("mounts without throwing", () => {
    expect(() => renderScene()).not.toThrow();
  });

  it("scene host is present after mounting GlyphcssCamera", () => {
    const { container } = renderScene({ distance: 5 });
    expect(container.querySelector(".glyphcss-host")).toBeTruthy();
  });

  it("accepts distance prop", () => {
    expect(() => renderScene({ distance: 8 })).not.toThrow();
  });

  it("accepts rotX/rotY props", () => {
    expect(() => renderScene({ rotX: 1, rotY: 0.5 })).not.toThrow();
  });

  it("unmounts cleanly", () => {
    const { container, root } = renderScene({ distance: 4 });
    act(() => root.unmount());
    expect(container.querySelector(".glyphcss-output")).toBeFalsy();
  });
});

describe("GlyphcssCamera — outside scene", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("throws when mounted outside GlyphcssScene", () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    expect(() => {
      act(() =>
        root.render(React.createElement(GlyphcssCamera, {})),
      );
    }).toThrow();
  });
});
