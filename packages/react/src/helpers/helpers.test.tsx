import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
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
});

function renderHelper(node: React.ReactElement): HTMLElement {
  const container = document.createElement("div");
  const root = createRoot(container);
  act(() => root.render(node));
  return container;
}

describe("PolyAxesHelper", () => {
  it("renders 18 polygon elements (6 quads × 3 axes)", () => {
    const container = renderHelper(<PolyAxesHelper size={4} />);
    const polys = container.querySelectorAll("i,b,s,u");
    expect(polys.length).toBe(18);
  });

  it("wraps polygons inside a .polycss-mesh wrapper", () => {
    const container = renderHelper(<PolyAxesHelper />);
    expect(container.querySelector(".polycss-mesh")).not.toBeNull();
  });

  it("doubles the polygon count when negative is on (still 18 — same number of bars, longer span)", () => {
    // Negative just stretches the bars from -size..+size; the face count is
    // unchanged (still 6 per axis).
    const container = renderHelper(<PolyAxesHelper negative />);
    expect(container.querySelectorAll("i,b,s,u").length).toBe(18);
  });
});

describe("PolyDirectionalLightHelper", () => {
  it("renders 8 polygon elements (octahedron faces)", () => {
    const container = renderHelper(
      <PolyDirectionalLightHelper light={{ direction: [0, 0, 1] }} />,
    );
    expect(container.querySelectorAll("u").length).toBe(8);
  });

  it("wraps polygons inside a .polycss-mesh wrapper", () => {
    const container = renderHelper(
      <PolyDirectionalLightHelper light={{ direction: [0, 0, 1] }} />,
    );
    expect(container.querySelector(".polycss-mesh")).not.toBeNull();
  });

  it("translates the marker via the wrapper transform when direction + distance are set", () => {
    const container = renderHelper(
      <PolyDirectionalLightHelper
        light={{ direction: [0, 0, 1] }}
        distance={2}
      />,
    );
    const wrapper = container.querySelector(".polycss-mesh") as HTMLElement;
    // Direction (0,0,1) → world (0,0,distance). World→CSS swap: CSS-z = world-Z.
    // distance=2, TILE=50 → translate3d(0px, 0px, 100px).
    expect(wrapper.style.transform).toContain("translate3d(0px, 0px, 100px)");
  });

  it("offsets the marker by the target world coords", () => {
    const container = renderHelper(
      <PolyDirectionalLightHelper
        light={{ direction: [0, 0, 1] }}
        target={[1, 2, 3]}
        distance={1}
      />,
    );
    const wrapper = container.querySelector(".polycss-mesh") as HTMLElement;
    // target=(1,2,3), direction=(0,0,1)*distance=(0,0,1) → world=(1,2,4)
    // CSS = (worldY*50, worldX*50, worldZ*50) = (100, 50, 200).
    expect(wrapper.style.transform).toContain("translate3d(100px, 50px, 200px)");
  });
});
