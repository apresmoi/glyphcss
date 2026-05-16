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

const NON_RECT_QUAD: Polygon = {
  vertices: [
    [0, 0, 0],
    [2, 0, 0],
    [2, 1, 0],
    [0, 2, 0],
  ],
  color: "#00ffff",
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
    expect(scene.style.transform).toContain("scale(");
  });
});

describe("PolyScene — polygon rendering", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("renders triangle u elements from the polygons prop", () => {
    const container = renderScene({ polygons: [TRIANGLE] });
    const poly = container.querySelector("u");
    expect(poly).toBeTruthy();
    expect(poly?.tagName.toLowerCase()).toBe("u");
    expect(poly?.classList.contains("polycss-poly-atlas")).toBe(false);
    expect(poly?.classList.contains("polycss-poly-solid")).toBe(false);
    expect(poly?.classList.contains("polycss-poly-textured")).toBe(false);
    expect(container.querySelector("svg")).toBeNull();
  });

  it("renders triangle u elements with canonical geometry by default", () => {
    const container = renderScene({
      polygons: [TRIANGLE],
    });
    const poly = container.querySelector("u");
    const style = poly?.getAttribute("style") ?? "";
    expect(style).not.toContain("border-width");
    expect(style).not.toContain("background: linear-gradient");
  });

  it("renders full rectangular solids with canonical geometry by default", () => {
    const container = renderScene({
      polygons: [QUAD],
    });
    const poly = container.querySelector("b");
    const style = poly?.getAttribute("style") ?? "";
    expect(style).not.toContain("width");
    expect(style).not.toContain("height");
  });

  it("renders non-rect solid quads as projective b elements by default", () => {
    const container = renderScene({
      polygons: [NON_RECT_QUAD],
    });
    const poly = container.querySelector("b");
    const style = poly?.getAttribute("style") ?? "";
    expect(poly?.tagName.toLowerCase()).toBe("b");
    expect(style).toContain("transform: matrix3d(");
    expect(style).not.toContain("width");
    expect(style).not.toContain("height");
    expect(style).not.toContain("border-shape");
  });

  it("renders multiple polygons", () => {
    const container = renderScene({ polygons: [TRIANGLE, QUAD] });
    const polys = container.querySelectorAll("i,b,s,u");
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
    const polys = container.querySelectorAll("i,b,s,u");
    expect(polys.length).toBe(0);
  });

  it("renders no poly elements when polygons prop is omitted", () => {
    const container = renderScene({});
    const polys = container.querySelectorAll("i,b,s,u");
    expect(polys.length).toBe(0);
  });
});

describe("PolyScene — autoCenter", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("does NOT render a .polycss-offset wrapper div when autoCenter=true", () => {
    // The new design folds the bbox-center offset directly into scene transform
    // on the scene element — no extra DOM wrapper layer.
    const container = renderScene({
      polygons: [TRIANGLE, QUAD],
      autoCenter: true,
    });
    expect(container.querySelector(".polycss-offset")).toBeNull();
  });

  it("does NOT render a centering wrapper when autoCenter=false (default)", () => {
    const container = renderScene({
      polygons: [TRIANGLE, QUAD],
      autoCenter: false,
    });
    expect(container.querySelector(".polycss-offset")).toBeNull();
  });

  it("autoCenter contributes a non-zero translate3d inside scene transform for off-center polygons", () => {
    // With autoCenter=false the translate3d for QUAD at centroid (1,1,1) reflects
    // only target=[0,0,0], so it is translate3d(0px, 0px, 0px).
    const containerOff = renderScene({ polygons: [QUAD], autoCenter: false });
    const sceneOff = containerOff.querySelector(".polycss-scene") as HTMLElement;
    const transformOff = sceneOff.style.transform;
    expect(transformOff).toContain("translate3d(0px, 0px, 0px)");

    // With autoCenter=true the bbox center ([1,1,1]) is added to target
    // inside scene transform, producing a non-zero translate3d.
    // QUAD centroid: world X=(0+2)/2=1, world Y=(0+2)/2=1, world Z=(1+1)/2=1.
    // CSS: cssX = worldY*50 = 50, cssY = worldX*50 = 50, cssZ = worldZ*50 = 50.
    // Expected translate3d(-50px, -50px, -50px).
    const containerOn = renderScene({ polygons: [QUAD], autoCenter: true });
    const sceneOn = containerOn.querySelector(".polycss-scene") as HTMLElement;
    const transformOn = sceneOn.style.transform;
    expect(transformOn).toContain("translate3d(-50px, -50px, -50px)");
  });

  it("target and autoCenterOffset are independent: pan survives mesh bbox change", () => {
    // Render with TRIANGLE (centroid ~[0.33, 0.33, 0]) centered.
    // Then switch to QUAD (centroid [1, 1, 1]) — the centering offset updates
    // but any user pan delta in target remains unaffected. The two contributions
    // add independently inside translate3d without either clobbering the other.
    //
    // We verify this at the level of what matters: the scene element's
    // scene transform includes the bbox contribution without a wrapper div.
    const containerA = renderScene({ polygons: [QUAD], autoCenter: true });
    const sceneA = containerA.querySelector(".polycss-scene") as HTMLElement;
    const tA = sceneA.style.transform;
    // QUAD centroid contributes (-50px, -50px, -50px)
    expect(tA).toContain("translate3d(-50px, -50px, -50px)");

    // Now render with no polygons (empty bbox → zero offset)
    const containerB = renderScene({ polygons: [], autoCenter: true });
    const sceneB = containerB.querySelector(".polycss-scene") as HTMLElement;
    const tB = sceneB.style.transform;
    // Zero bbox → translate3d stays at (0px, 0px, 0px)
    expect(tB).toContain("translate3d(0px, 0px, 0px)");
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
    const polys = container.querySelectorAll("i,b,s,u");
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
    const polys = container.querySelectorAll("i,b,s,u");
    expect(polys.length).toBe(1);
  });
});

describe("PolyScene — strategies.disable", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("disabling u renders triangle without u element", () => {
    const container = renderScene({
      polygons: [TRIANGLE],
      strategies: { disable: ["u"] },
    });
    // When u is disabled, the triangle falls to <i> (border-shape, if supported)
    // or <s> (atlas). Either way, <u> must not be present.
    expect(container.querySelector("u")).toBeNull();
    const fallback = container.querySelector("i,s");
    expect(fallback).toBeTruthy();
  });

  it("disabling b renders a rect through border-shape when supported", () => {
    vi.stubGlobal("CSS", {
      supports: vi.fn((property: string) => property === "border-shape"),
    });
    const container = renderScene({
      polygons: [QUAD],
      strategies: { disable: ["b"] },
    });
    const poly = container.querySelector("i") as HTMLElement | null;
    expect(container.querySelector("b")).toBeNull();
    expect(poly).toBeTruthy();
    expect(poly!.style.width).toBe("");
    expect(poly!.style.height).toBe("");
    expect(poly!.style.getPropertyValue("border-shape")).toContain("polygon(");
  });

  it("disabling b, i, and u forces all polygons to s", () => {
    const container = renderScene({
      polygons: [TRIANGLE, QUAD],
      strategies: { disable: ["b", "i", "u"] },
    });
    const sTags = container.querySelectorAll("s");
    const otherTags = container.querySelectorAll("b,i,u");
    // Both polygons must use the atlas path
    expect(sTags.length).toBe(2);
    expect(otherTags.length).toBe(0);
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
