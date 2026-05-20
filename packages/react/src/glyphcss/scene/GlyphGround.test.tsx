import { describe, it, expect, afterEach, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { GlyphScene } from "./GlyphScene";
import { GlyphGround } from "./GlyphGround";

function renderInScene(
  groundProps: React.ComponentProps<typeof GlyphGround> = {},
): HTMLElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      React.createElement(GlyphScene, {}, React.createElement(GlyphGround, groundProps)),
    ),
  );
  return container;
}

describe("GlyphGround (React) — mounts inside scene", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("mounts without throwing", () => {
    expect(() => renderInScene()).not.toThrow();
  });

  it("renders a .glyph-mesh wrapper inside the scene", () => {
    const container = renderInScene();
    expect(container.querySelector(".glyph-mesh")).toBeTruthy();
  });

  it("accepts size prop without throwing", () => {
    expect(() => renderInScene({ size: 10 })).not.toThrow();
  });

  it("accepts color prop without throwing", () => {
    expect(() => renderInScene({ color: "#888888" })).not.toThrow();
  });

  it("accepts position prop without throwing", () => {
    expect(() => renderInScene({ position: [0, -1, 0] })).not.toThrow();
  });

  it("accepts id prop without throwing", () => {
    expect(() => renderInScene({ id: "ground" })).not.toThrow();
  });

  it("sets data-glyph-mesh-id when id is provided", () => {
    const container = renderInScene({ id: "ground-plane" });
    const mesh = container.querySelector("[data-glyph-mesh-id='ground-plane']");
    expect(mesh).toBeTruthy();
  });
});

describe("GlyphGround (React) — throws outside scene", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("throws when mounted outside GlyphScene", () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    expect(() => {
      act(() => root.render(React.createElement(GlyphGround)));
    }).toThrow();
  });
});
