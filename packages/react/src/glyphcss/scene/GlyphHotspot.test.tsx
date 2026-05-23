import { describe, it, expect, afterEach, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { GlyphScene } from "./GlyphScene";
import { GlyphPerspectiveCamera } from "../camera/GlyphPerspectiveCamera";
import { GlyphHotspot } from "./GlyphHotspot";

function renderScene(
  hotspotProps: React.ComponentProps<typeof GlyphHotspot>,
  children?: React.ReactNode,
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
          React.createElement(GlyphHotspot, hotspotProps, children),
        ),
      ),
    ),
  );
  return { container, root };
}

describe("GlyphHotspot — mount inside scene (no children)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("mounts without throwing", () => {
    expect(() =>
      renderScene({ id: "hs1", at: [0, 0, 0] }),
    ).not.toThrow();
  });

  it("scene host is present after mounting hotspot", () => {
    const { container } = renderScene({ id: "hs1", at: [0, 0, 0] });
    expect(container.querySelector(".glyph-host")).toBeTruthy();
  });

  it("renders null (no DOM node) when no children", () => {
    const { container } = renderScene({ id: "hs1", at: [0, 0, 0] });
    // With no children/onClick/className, GlyphHotspot returns null
    expect(container.querySelector("[data-glyph-hotspot-id]")).toBeFalsy();
  });

  it("accepts a size prop without throwing", () => {
    expect(() =>
      renderScene({ id: "hs2", at: [1, 2, 3], size: [3, 2] }),
    ).not.toThrow();
  });

  it("unmounts cleanly", () => {
    const { container, root } = renderScene({ id: "hs1", at: [0, 0, 0] });
    act(() => root.unmount());
    expect(container.querySelector(".glyph-output")).toBeFalsy();
  });
});

describe("GlyphHotspot — mount inside scene (with children)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("portals children into the hotspot overlay element", () => {
    const { container } = renderScene(
      { id: "hs-child", at: [0, 1, 0] },
      React.createElement("span", { className: "tooltip" }, "hello"),
    );
    // Children are portalled into the div.glyph-hotspot[data-hotspot-id] overlay.
    const overlay = container.querySelector("[data-hotspot-id='hs-child']");
    expect(overlay).toBeTruthy();
    expect(overlay?.querySelector(".tooltip")).toBeTruthy();
  });

  it("renders children inside the hotspot overlay", () => {
    const { container } = renderScene(
      { id: "hs-child2", at: [0, 1, 0] },
      React.createElement("span", { className: "tooltip-inner" }, "world"),
    );
    const tooltip = container.querySelector(".tooltip-inner");
    expect(tooltip).toBeTruthy();
    expect(tooltip?.textContent).toBe("world");
  });

  it("applies className to the hotspot overlay element", () => {
    const { container } = renderScene(
      { id: "hs-cls", at: [0, 0, 0], className: "my-hotspot" },
      React.createElement("span", {}, "x"),
    );
    const overlay = container.querySelector(".my-hotspot");
    expect(overlay).toBeTruthy();
  });

  it("overlay and children are removed after unmount", () => {
    const { container, root } = renderScene(
      { id: "hs-unmount", at: [0, 0, 0] },
      React.createElement("span", {}, "bye"),
    );
    act(() => root.unmount());
    expect(container.querySelector("[data-hotspot-id='hs-unmount']")).toBeFalsy();
  });
});

describe("GlyphHotspot — outside scene", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("throws when mounted outside GlyphScene", () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    expect(() => {
      act(() =>
        root.render(
          React.createElement(GlyphHotspot, { id: "err", at: [0, 0, 0] }),
        ),
      );
    }).toThrow();
  });
});
