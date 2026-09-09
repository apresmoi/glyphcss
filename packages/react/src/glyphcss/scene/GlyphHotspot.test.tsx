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

/**
 * `GlyphHotspotHandle.setAt` exists so a moving anchor does not destroy the
 * element: its own doc says remove-and-re-add "destroys and re-creates the
 * element, losing whatever the consumer wrote on it and restarting any CSS
 * transition on it". In React it costs more than that — the children are
 * portalled into that element, so re-creating it unmounts and remounts the
 * whole subtree and every piece of state in it goes with it.
 *
 * The reference case is a consumer that PLANTS its overlays on geometry that
 * arrives later (`@glyphcss/maps` re-anchors a label when a finer terrain
 * tier lands), i.e. an `at` that changes on its own, repeatedly, while the
 * user is doing something else in the tooltip.
 */
describe("GlyphHotspot — moving the anchor", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  /** A child that counts its own mounts, so a remount cannot go unnoticed. */
  function makeChild() {
    let mounts = 0;
    const Child = () => {
      React.useEffect(() => { mounts += 1; }, []);
      return React.createElement("span", { className: "tooltip" }, "hi");
    };
    return { Child, mounts: () => mounts };
  }

  it("keeps the overlay element and its children across an `at` change", () => {
    const { Child, mounts } = makeChild();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const render = (at: [number, number, number]) =>
      act(() => root.render(
        React.createElement(GlyphPerspectiveCamera, {},
          React.createElement(GlyphScene, {},
            React.createElement(GlyphHotspot, { id: "hs-move", at },
              React.createElement(Child)))),
      ));

    render([0, 0, 0]);
    const overlay = container.querySelector("[data-hotspot-id='hs-move']");
    const child = container.querySelector(".tooltip");
    expect(overlay).toBeTruthy();
    expect(mounts()).toBe(1);

    render([0, 5, 0]);
    // The SAME nodes, not equal-looking replacements.
    expect(container.querySelector("[data-hotspot-id='hs-move']")).toBe(overlay);
    expect(container.querySelector(".tooltip")).toBe(child);
    expect(mounts()).toBe(1);
    // And exactly one hotspot is registered, not two.
    expect(container.querySelectorAll("[data-hotspot-id='hs-move']").length).toBe(1);
  });

  it("still re-registers when the id changes", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const render = (id: string) =>
      act(() => root.render(
        React.createElement(GlyphPerspectiveCamera, {},
          React.createElement(GlyphScene, {},
            React.createElement(GlyphHotspot, { id, at: [0, 0, 0] },
              React.createElement("span", { className: "tooltip" }, "hi")))),
      ));
    render("first");
    expect(container.querySelector("[data-hotspot-id='first']")).toBeTruthy();
    render("second");
    expect(container.querySelector("[data-hotspot-id='first']")).toBeFalsy();
    expect(container.querySelector("[data-hotspot-id='second']")).toBeTruthy();
  });
});
