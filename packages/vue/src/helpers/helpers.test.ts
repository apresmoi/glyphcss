import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createApp, h } from "vue";
import type { Component } from "vue";
import { PolyCamera } from "../camera/PolyCamera";
import { PolyScene } from "../scene/PolyScene";
import { PolyAxesHelper } from "./PolyAxesHelper";
import { PolyDirectionalLightHelper } from "./PolyDirectionalLightHelper";

beforeEach(() => {
  vi.stubGlobal("URL", {
    createObjectURL: vi.fn(() => "blob:helper-test"),
    revokeObjectURL: vi.fn(),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

function renderInScene(helper: Component, helperProps: Record<string, unknown> = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const app = createApp({
    setup() {
      return () =>
        h(PolyCamera, {}, {
          default: () =>
            h(PolyScene, {}, {
              default: () => h(helper as Component, helperProps),
            }),
        });
    },
  });
  app.mount(container);
  return { container, app };
}

describe("PolyAxesHelper (Vue)", () => {
  it("renders 18 polygon elements (6 quads × 3 axes)", () => {
    const { container } = renderInScene(PolyAxesHelper, { size: 4 });
    expect(container.querySelectorAll("i").length).toBe(18);
  });

  it("wraps polygons inside a .polycss-mesh wrapper", () => {
    const { container } = renderInScene(PolyAxesHelper);
    expect(container.querySelector(".polycss-mesh")).not.toBeNull();
  });

  it("keeps the polygon count at 18 even with negative axes (longer bars, same face count)", () => {
    const { container } = renderInScene(PolyAxesHelper, { negative: true });
    expect(container.querySelectorAll("i").length).toBe(18);
  });
});

describe("PolyDirectionalLightHelper (Vue)", () => {
  it("renders 8 polygon elements (octahedron faces)", () => {
    const { container } = renderInScene(PolyDirectionalLightHelper, {
      light: { direction: [0, 0, 1] },
    });
    expect(container.querySelectorAll("i").length).toBe(8);
  });

  it("translates the marker via the wrapper transform when direction + distance are set", () => {
    const { container } = renderInScene(PolyDirectionalLightHelper, {
      light: { direction: [0, 0, 1] },
      distance: 2,
    });
    const wrapper = container.querySelector(".polycss-mesh") as HTMLElement;
    // direction (0,0,1)*distance=2 → world (0,0,2). CSS-z = world-Z*TILE = 100.
    expect(wrapper.style.transform).toContain("translate3d(0px, 0px, 100px)");
  });

  it("offsets the marker by the target world coords", () => {
    const { container } = renderInScene(PolyDirectionalLightHelper, {
      light: { direction: [0, 0, 1] },
      target: [1, 2, 3],
      distance: 1,
    });
    const wrapper = container.querySelector(".polycss-mesh") as HTMLElement;
    // target=(1,2,3), dir*1=(0,0,1) → world=(1,2,4); CSS=(worldY*50, worldX*50, worldZ*50).
    expect(wrapper.style.transform).toContain("translate3d(100px, 50px, 200px)");
  });
});
