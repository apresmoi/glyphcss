import { describe, it, expect, afterEach, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { GlyphScene } from "./GlyphScene";
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
        GlyphScene,
        {},
        React.createElement(GlyphHotspot, hotspotProps, children),
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

  it("renders a sentinel div when children are provided", () => {
    const { container } = renderScene(
      { id: "hs-child", at: [0, 1, 0] },
      React.createElement("span", { className: "tooltip" }, "hello"),
    );
    // When children are provided, the sentinel div with data-glyph-hotspot-id is rendered
    const sentinel = container.querySelector("[data-glyph-hotspot-id='hs-child']");
    expect(sentinel).toBeTruthy();
  });

  it("renders children inside the sentinel", () => {
    const { container } = renderScene(
      { id: "hs-child2", at: [0, 1, 0] },
      React.createElement("span", { className: "tooltip-inner" }, "world"),
    );
    const tooltip = container.querySelector(".tooltip-inner");
    expect(tooltip).toBeTruthy();
    expect(tooltip?.textContent).toBe("world");
  });

  it("applies className to the sentinel div", () => {
    const { container } = renderScene(
      { id: "hs-cls", at: [0, 0, 0], className: "my-hotspot" },
      React.createElement("span", {}, "x"),
    );
    const sentinel = container.querySelector(".my-hotspot");
    expect(sentinel).toBeTruthy();
  });

  it("sentinel is removed after unmount", () => {
    const { container, root } = renderScene(
      { id: "hs-unmount", at: [0, 0, 0] },
      React.createElement("span", {}, "bye"),
    );
    act(() => root.unmount());
    expect(container.querySelector("[data-glyph-hotspot-id]")).toBeFalsy();
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
