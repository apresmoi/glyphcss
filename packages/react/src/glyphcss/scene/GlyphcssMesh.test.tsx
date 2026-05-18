import { describe, it, expect, afterEach, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { GlyphcssScene } from "./GlyphcssScene";
import { GlyphcssMesh } from "./GlyphcssMesh";
import type { Polygon } from "@glyphcss/core";

const POLYGON: Polygon = {
  vertices: [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
  ],
  color: "#ff0000",
};

function renderMesh(
  meshProps: React.ComponentProps<typeof GlyphcssMesh>,
): HTMLElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      React.createElement(GlyphcssScene, {}, React.createElement(GlyphcssMesh, meshProps)),
    ),
  );
  return container;
}

describe("GlyphcssMesh (React) — id prop wiring", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("sets data-glyphcss-mesh-id on the wrapper div when id is given", () => {
    const container = renderMesh({ id: "my-mesh", polygons: [POLYGON] });
    const el = container.querySelector("[data-glyphcss-mesh-id='my-mesh']");
    expect(el).toBeTruthy();
  });

  it("does not set data-glyphcss-mesh-id when id is omitted", () => {
    const container = renderMesh({ polygons: [POLYGON] });
    const el = container.querySelector("[data-glyphcss-mesh-id]");
    // attribute may be present but value should be empty/undefined
    if (el) {
      expect(el.getAttribute("data-glyphcss-mesh-id")).toBeFalsy();
    }
  });
});

describe("GlyphcssMesh (React) — event props accepted", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("accepts onPointerDown without throwing", () => {
    expect(() =>
      renderMesh({ polygons: [POLYGON], onPointerDown: vi.fn() }),
    ).not.toThrow();
  });

  it("accepts onPointerUp without throwing", () => {
    expect(() =>
      renderMesh({ polygons: [POLYGON], onPointerUp: vi.fn() }),
    ).not.toThrow();
  });

  it("accepts onPointerMove without throwing", () => {
    expect(() =>
      renderMesh({ polygons: [POLYGON], onPointerMove: vi.fn() }),
    ).not.toThrow();
  });

  it("accepts onPointerEnter without throwing", () => {
    expect(() =>
      renderMesh({ polygons: [POLYGON], onPointerEnter: vi.fn() }),
    ).not.toThrow();
  });

  it("accepts onPointerLeave without throwing", () => {
    expect(() =>
      renderMesh({ polygons: [POLYGON], onPointerLeave: vi.fn() }),
    ).not.toThrow();
  });

  it("accepts onClick without throwing", () => {
    expect(() =>
      renderMesh({ polygons: [POLYGON], onClick: vi.fn() }),
    ).not.toThrow();
  });

  it("accepts onWheel without throwing", () => {
    expect(() =>
      renderMesh({ polygons: [POLYGON], onWheel: vi.fn() }),
    ).not.toThrow();
  });
});
