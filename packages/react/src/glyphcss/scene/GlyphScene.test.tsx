import { describe, it, expect, afterEach, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { GlyphScene } from "./GlyphScene";
import { GlyphMesh } from "./GlyphMesh";
import { GlyphOrbitControls } from "../controls/GlyphOrbitControls";
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
  sceneProps: React.ComponentProps<typeof GlyphScene>,
  children?: React.ReactNode,
): HTMLElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      React.createElement(GlyphScene, sceneProps, children),
    ),
  );
  return container;
}

describe("GlyphScene — basic rendering", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("renders a .glyph-host element", () => {
    const container = renderScene({});
    const host = container.querySelector(".glyph-host");
    expect(host).toBeTruthy();
  });

  it("renders a .glyph-scene element inside the host", () => {
    const container = renderScene({});
    const scene = container.querySelector(".glyph-scene");
    expect(scene).toBeTruthy();
  });

  it("renders a .glyph-output <pre> inside the scene", () => {
    const container = renderScene({});
    const pre = container.querySelector(".glyph-output");
    expect(pre).toBeTruthy();
    expect(pre?.tagName.toLowerCase()).toBe("pre");
  });

  it("applies custom className to the host element", () => {
    const container = renderScene({ className: "my-scene" });
    const host = container.querySelector(".glyph-host");
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

describe("GlyphScene — options forwarding", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("renders with custom cols/rows", () => {
    const container = renderScene({ cols: 40, rows: 12 });
    const scene = container.querySelector(".glyph-scene");
    expect(scene).toBeTruthy();
  });

  it("renders in wireframe mode without errors", () => {
    expect(() => renderScene({ mode: "wireframe" })).not.toThrow();
  });

  it("renders with useColors=false without errors", () => {
    expect(() => renderScene({ useColors: false })).not.toThrow();
  });
});

describe("GlyphScene — GlyphMesh child", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("mounts a GlyphMesh without throwing", () => {
    expect(() =>
      renderScene(
        {},
        React.createElement(GlyphMesh, { polygons: [POLYGON] }),
      ),
    ).not.toThrow();
  });

  it("GlyphMesh renders a wrapper div", () => {
    const container = renderScene(
      {},
      React.createElement(GlyphMesh, { id: "test-mesh", polygons: [POLYGON] }),
    );
    const mesh = container.querySelector(".glyph-mesh");
    expect(mesh).toBeTruthy();
  });
});

describe("GlyphScene — controls", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("GlyphOrbitControls mounts without throwing", () => {
    expect(() =>
      renderScene(
        {},
        React.createElement(GlyphOrbitControls, { drag: false, wheel: false }),
      ),
    ).not.toThrow();
  });
});

describe("GlyphScene — error (no context)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("GlyphMesh throws when used outside GlyphScene", () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    expect(() => {
      act(() =>
        root.render(React.createElement(GlyphMesh, { polygons: [] })),
      );
    }).toThrow();
  });
});
