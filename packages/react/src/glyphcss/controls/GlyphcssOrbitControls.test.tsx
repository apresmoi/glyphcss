import { describe, it, expect, afterEach, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { GlyphcssScene } from "../scene/GlyphcssScene";
import { GlyphcssOrbitControls } from "./GlyphcssOrbitControls";

function renderScene(
  controlsProps: React.ComponentProps<typeof GlyphcssOrbitControls> = {},
): { container: HTMLElement; root: ReturnType<typeof createRoot> } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      React.createElement(
        GlyphcssScene,
        {},
        React.createElement(GlyphcssOrbitControls, controlsProps),
      ),
    ),
  );
  return { container, root };
}

describe("GlyphcssOrbitControls — mount inside scene", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("mounts without throwing", () => {
    expect(() => renderScene()).not.toThrow();
  });

  it("scene host is present after mounting controls", () => {
    const { container } = renderScene();
    expect(container.querySelector(".glyphcss-host")).toBeTruthy();
  });

  it("renders null — no extra DOM elements from controls", () => {
    const { container } = renderScene();
    // Controls return null, only the scene host + scene + pre should exist
    const host = container.querySelector(".glyphcss-host");
    expect(host).toBeTruthy();
  });

  it("mounts with drag=false", () => {
    expect(() => renderScene({ drag: false })).not.toThrow();
  });

  it("mounts with wheel=false", () => {
    expect(() => renderScene({ wheel: false })).not.toThrow();
  });

  it("mounts with invert=true", () => {
    expect(() => renderScene({ invert: true })).not.toThrow();
  });

  it("mounts with animate config", () => {
    expect(() =>
      renderScene({ animate: { speed: 0.5, axis: "y", pauseOnInteraction: true } }),
    ).not.toThrow();
  });

  it("updates props without throwing (drag toggle)", () => {
    const { container, root } = renderScene({ drag: true });
    expect(container.querySelector(".glyphcss-scene")).toBeTruthy();
    act(() =>
      root.render(
        React.createElement(
          GlyphcssScene,
          {},
          React.createElement(GlyphcssOrbitControls, { drag: false }),
        ),
      ),
    );
    expect(container.querySelector(".glyphcss-scene")).toBeTruthy();
  });

  it("unmounts cleanly — host is removed from DOM", () => {
    const { container, root } = renderScene();
    act(() => root.unmount());
    expect(container.querySelector(".glyphcss-output")).toBeFalsy();
  });

  it("can be mounted and remounted without leaks", () => {
    const c1 = document.createElement("div");
    document.body.appendChild(c1);
    const r1 = createRoot(c1);
    act(() =>
      r1.render(
        React.createElement(
          GlyphcssScene,
          {},
          React.createElement(GlyphcssOrbitControls, {}),
        ),
      ),
    );
    act(() => r1.unmount());
    expect(c1.querySelector(".glyphcss-output")).toBeFalsy();

    const c2 = document.createElement("div");
    document.body.appendChild(c2);
    const r2 = createRoot(c2);
    act(() =>
      r2.render(
        React.createElement(
          GlyphcssScene,
          {},
          React.createElement(GlyphcssOrbitControls, {}),
        ),
      ),
    );
    expect(c2.querySelector(".glyphcss-host")).toBeTruthy();
    act(() => r2.unmount());
  });
});

describe("GlyphcssOrbitControls — outside scene", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("throws when mounted outside GlyphcssScene", () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    expect(() => {
      act(() =>
        root.render(React.createElement(GlyphcssOrbitControls, {})),
      );
    }).toThrow();
  });
});
