import { describe, it, expect, vi, afterEach } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { PolyCamera } from "../camera/PolyCamera";
import { PolyScene } from "./PolyScene";
import type { Polygon } from "@layoutit/polycss-core";

const TRIANGLE: Polygon = {
  vertices: [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
  ],
  color: "#ff0000",
};

const QUAD: Polygon = {
  vertices: [
    [0, 0, 1],
    [2, 0, 1],
    [2, 2, 1],
    [0, 2, 1],
  ],
  color: "#00ff00",
};

const TEXTURED_TRIANGLE: Polygon = {
  vertices: TRIANGLE.vertices,
  texture: "https://example.com/tex.png",
  uvs: [
    [0, 0],
    [1, 0],
    [0, 1],
  ],
};

function renderScene(
  sceneProps: React.ComponentProps<typeof PolyScene>,
  children?: React.ReactNode
): HTMLElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      React.createElement(
        PolyCamera,
        {},
        React.createElement(PolyScene, sceneProps, children)
      )
    )
  );
  return container;
}

describe("PolyScene — basic rendering", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("renders a .polycss-scene element", () => {
    const container = renderScene({});
    const scene = container.querySelector(".polycss-scene");
    expect(scene).toBeTruthy();
  });

  it("renders children inside the scene", () => {
    const container = renderScene(
      {},
      React.createElement("div", { className: "my-child" }, "hello")
    );
    const child = container.querySelector(".my-child");
    expect(child).toBeTruthy();
    expect(child?.textContent).toBe("hello");
  });

  it("applies custom className to polycss-scene", () => {
    const container = renderScene({ className: "my-scene" });
    const scene = container.querySelector(".polycss-scene");
    expect(scene?.classList.contains("my-scene")).toBe(true);
  });

  it("scene has data-polycss-lighting attribute", () => {
    const container = renderScene({});
    const scene = container.querySelector(".polycss-scene");
    expect(scene?.getAttribute("data-polycss-lighting")).toBe("baked");
  });

  it("scene leaves anchor positioning to base CSS", () => {
    const container = renderScene({});
    const scene = container.querySelector(".polycss-scene") as HTMLElement;
    expect(scene.style.top).toBe("");
    expect(scene.style.left).toBe("");
    expect(scene.style.getPropertyValue("--scene-transform")).toContain("scale(");
  });
});

describe("PolyScene — polygon rendering", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("renders polygon i elements from the polygons prop", () => {
    const container = renderScene({ polygons: [TRIANGLE] });
    const poly = container.querySelector("i");
    expect(poly).toBeTruthy();
    expect(poly?.tagName.toLowerCase()).toBe("i");
    expect(poly?.classList.contains("polycss-poly-atlas")).toBe(false);
    expect(poly?.classList.contains("polycss-poly-solid")).toBe(false);
    expect(poly?.classList.contains("polycss-poly-textured")).toBe(false);
    expect(container.querySelector("svg")).toBeNull();
  });

  it("renders multiple polygons", () => {
    const container = renderScene({ polygons: [TRIANGLE, QUAD] });
    const polys = container.querySelectorAll("i,b,s");
    expect(polys.length).toBe(2);
  });

  it("renders textured polygons as polygon s elements", () => {
    const container = renderScene({
      polygons: [TEXTURED_TRIANGLE],
    });
    const poly = container.querySelector("s");
    expect(poly).toBeTruthy();
    expect(poly?.tagName.toLowerCase()).toBe("s");
  });

  it("renders no poly elements when polygons prop is empty", () => {
    const container = renderScene({ polygons: [] });
    const polys = container.querySelectorAll("i,b,s");
    expect(polys.length).toBe(0);
  });

  it("renders no poly elements when polygons prop is omitted", () => {
    const container = renderScene({});
    const polys = container.querySelectorAll("i,b,s");
    expect(polys.length).toBe(0);
  });
});

describe("PolyScene — autoCenter", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("renders a centering wrapper div when autoCenter=true", () => {
    const container = renderScene({
      polygons: [TRIANGLE, QUAD],
      autoCenter: true,
    });
    const scene = container.querySelector(".polycss-scene");
    // There should be a child div with a translate3d transform
    const children = Array.from(scene?.children ?? []);
    const wrapperWithTransform = children.find((el) => {
      const style = (el as HTMLElement).style;
      return style.getPropertyValue("--offset-transform").includes("translate3d");
    });
    expect(wrapperWithTransform).toBeTruthy();
  });

  it("does NOT render a centering wrapper when autoCenter=false (default)", () => {
    const container = renderScene({
      polygons: [TRIANGLE, QUAD],
      autoCenter: false,
    });
    const scene = container.querySelector(".polycss-scene");
    const children = Array.from(scene?.children ?? []);
    const hasTranslate = children.some((el) => {
      const style = (el as HTMLElement).style;
      return style.getPropertyValue("--offset-transform").includes("translate3d");
    });
    // Without autoCenter, no centering wrapper
    expect(hasTranslate).toBe(false);
  });

  it("autoCenter wrapper's translate3d is non-zero for off-center polygons", () => {
    const container = renderScene({
      polygons: [QUAD],
      autoCenter: true,
    });
    const scene = container.querySelector(".polycss-scene");
    const children = Array.from(scene?.children ?? []);
    const wrapper = children.find((el) => {
      return (el as HTMLElement).style.getPropertyValue("--offset-transform").includes("translate3d");
    }) as HTMLElement | undefined;
    expect(wrapper).toBeTruthy();
    // QUAD centroid is at (1, 1, 1) in world space → translate3d should be non-zero
    const transform = wrapper!.style.getPropertyValue("--offset-transform");
    expect(transform).not.toBe("translate3d(0px, 0px, 0px)");
  });
});

describe("PolyScene — debugShowBackfaces", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("does not add debug class by default", () => {
    const container = renderScene({ polygons: [TRIANGLE] });
    const scene = container.querySelector(".polycss-scene");
    expect(scene?.classList.contains("polycss-debug-show-backfaces")).toBe(false);
  });

  it("does not add SVG debug overlays when debugShowBackfaces=true", () => {
    const container = renderScene({
      polygons: [TRIANGLE],
      debugShowBackfaces: true,
    });
    const debugFaces = container.querySelectorAll(".polycss-debug-backface");
    expect(debugFaces.length).toBe(0);
    expect(container.querySelector("svg")).toBeNull();
  });
});

describe("PolyScene — automatic merge", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("renders polygons without a merge prop", () => {
    const container = renderScene({
      polygons: [TRIANGLE, QUAD],
    });
    const polys = container.querySelectorAll("i,b,s");
    expect(polys.length).toBe(2);
  });

  it("collapses coplanar same-color triangles", () => {
    const tri1: Polygon = {
      vertices: [[0, 0, 0], [1, 0, 0], [1, 1, 0]],
      color: "#ff0000",
    };
    const tri2: Polygon = {
      vertices: [[0, 0, 0], [1, 1, 0], [0, 1, 0]],
      color: "#ff0000",
    };
    const container = renderScene({
      polygons: [tri1, tri2],
    });
    const polys = container.querySelectorAll("i,b,s");
    expect(polys.length).toBe(1);
  });
});

describe("PolyScene — error (no camera context)", () => {
  it("throws when used outside PolyCamera", () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    expect(() => {
      act(() =>
        root.render(React.createElement(PolyScene, {}))
      );
    }).toThrow();
  });
});
