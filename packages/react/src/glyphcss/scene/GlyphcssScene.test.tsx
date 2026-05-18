import { describe, it, expect, afterEach, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { GlyphcssScene } from "./GlyphcssScene";
import { GlyphcssMesh } from "./GlyphcssMesh";
import { GlyphcssOrbitControls } from "../controls/GlyphcssOrbitControls";
import type { Polygon } from "@glyphcss/core";

const POLYGON: Polygon = {
  vertices: [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
  ],
  color: "#ff0000",
};

function renderScene(
  sceneProps: React.ComponentProps<typeof GlyphcssScene>,
  children?: React.ReactNode,
): HTMLElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      React.createElement(GlyphcssScene, sceneProps, children),
    ),
  );
  return container;
}

describe("GlyphcssScene — basic rendering", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("renders a .glyphcss-host element", () => {
    const container = renderScene({});
    const host = container.querySelector(".glyphcss-host");
    expect(host).toBeTruthy();
  });

  it("renders a .glyphcss-scene element inside the host", () => {
    const container = renderScene({});
    const scene = container.querySelector(".glyphcss-scene");
    expect(scene).toBeTruthy();
  });

  it("renders a .glyphcss-output <pre> inside the scene", () => {
    const container = renderScene({});
    const pre = container.querySelector(".glyphcss-output");
    expect(pre).toBeTruthy();
    expect(pre?.tagName.toLowerCase()).toBe("pre");
  });

  it("applies custom className to the host element", () => {
    const container = renderScene({ className: "my-scene" });
    const host = container.querySelector(".glyphcss-host");
    expect(host?.classList.contains("my-scene")).toBe(true);
  });

  it("renders children inside the host", () => {
    const container = renderScene(
      {},
      React.createElement("div", { className: "my-child" }, "hello"),
    );
    const child = container.querySelector(".my-child");
    expect(child).toBeTruthy();
    expect(child?.textContent).toBe("hello");
  });
});

describe("GlyphcssScene — options forwarding", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("renders with custom cols/rows", () => {
    const container = renderScene({ cols: 40, rows: 12 });
    const scene = container.querySelector(".glyphcss-scene");
    expect(scene).toBeTruthy();
  });

  it("renders in wireframe mode without errors", () => {
    expect(() => renderScene({ mode: "wireframe" })).not.toThrow();
  });

  it("renders with useColors=false without errors", () => {
    expect(() => renderScene({ useColors: false })).not.toThrow();
  });
});

describe("GlyphcssScene — GlyphcssMesh child", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("mounts a GlyphcssMesh without throwing", () => {
    expect(() =>
      renderScene(
        {},
        React.createElement(GlyphcssMesh, { polygons: [POLYGON] }),
      ),
    ).not.toThrow();
  });

  it("GlyphcssMesh renders a wrapper div", () => {
    const container = renderScene(
      {},
      React.createElement(GlyphcssMesh, { id: "test-mesh", polygons: [POLYGON] }),
    );
    const mesh = container.querySelector(".glyphcss-mesh");
    expect(mesh).toBeTruthy();
  });
});

describe("GlyphcssScene — controls", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("GlyphcssOrbitControls mounts without throwing", () => {
    expect(() =>
      renderScene(
        {},
        React.createElement(GlyphcssOrbitControls, { drag: false, wheel: false }),
      ),
    ).not.toThrow();
  });
});

describe("GlyphcssScene — error (no context)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("GlyphcssMesh throws when used outside GlyphcssScene", () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    expect(() => {
      act(() =>
        root.render(React.createElement(GlyphcssMesh, { polygons: [] })),
      );
    }).toThrow();
  });
});
