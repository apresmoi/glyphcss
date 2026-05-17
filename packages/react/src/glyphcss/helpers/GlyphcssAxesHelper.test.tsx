import { describe, it, expect, afterEach, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { GlyphcssScene } from "../scene/GlyphcssScene";
import { GlyphcssAxesHelper } from "./GlyphcssAxesHelper";

function renderScene(
  helperProps: React.ComponentProps<typeof GlyphcssAxesHelper> = {},
): { container: HTMLElement; root: ReturnType<typeof createRoot> } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      React.createElement(
        GlyphcssScene,
        {},
        React.createElement(GlyphcssAxesHelper, helperProps),
      ),
    ),
  );
  return { container, root };
}

describe("GlyphcssAxesHelper — mount inside scene", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("mounts without throwing", () => {
    expect(() => renderScene()).not.toThrow();
  });

  it("scene host is present after mounting axes helper", () => {
    const { container } = renderScene();
    expect(container.querySelector(".glyphcss-host")).toBeTruthy();
  });

  it("scene output <pre> is present after mounting axes helper", () => {
    const { container } = renderScene();
    expect(container.querySelector(".glyphcss-output")).toBeTruthy();
  });

  it("accepts size=2 without throwing", () => {
    expect(() => renderScene({ size: 2 })).not.toThrow();
  });

  it("accepts size=0.5 without throwing", () => {
    expect(() => renderScene({ size: 0.5 })).not.toThrow();
  });

  it("uses default size=1 without throwing", () => {
    expect(() => renderScene({})).not.toThrow();
  });

  it("updates size prop without throwing", () => {
    const { container, root } = renderScene({ size: 1 });
    act(() =>
      root.render(
        React.createElement(
          GlyphcssScene,
          {},
          React.createElement(GlyphcssAxesHelper, { size: 3 }),
        ),
      ),
    );
    expect(container.querySelector(".glyphcss-output")).toBeTruthy();
  });

  it("unmounts cleanly", () => {
    const { container, root } = renderScene({ size: 1 });
    act(() => root.unmount());
    expect(container.querySelector(".glyphcss-output")).toBeFalsy();
  });

  it("can be mounted twice in sequence without leaks", () => {
    const c1 = document.createElement("div");
    document.body.appendChild(c1);
    const r1 = createRoot(c1);
    act(() =>
      r1.render(
        React.createElement(GlyphcssScene, {}, React.createElement(GlyphcssAxesHelper, {})),
      ),
    );
    act(() => r1.unmount());
    expect(c1.querySelector(".glyphcss-output")).toBeFalsy();

    const c2 = document.createElement("div");
    document.body.appendChild(c2);
    const r2 = createRoot(c2);
    act(() =>
      r2.render(
        React.createElement(GlyphcssScene, {}, React.createElement(GlyphcssAxesHelper, { size: 2 })),
      ),
    );
    expect(c2.querySelector(".glyphcss-host")).toBeTruthy();
    act(() => r2.unmount());
  });
});

describe("GlyphcssAxesHelper — outside scene", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("throws when mounted outside GlyphcssScene", () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    expect(() => {
      act(() =>
        root.render(React.createElement(GlyphcssAxesHelper, {})),
      );
    }).toThrow();
  });
});
