/**
 * Imperative scene API tests — verifies createPolyScene's public surface
 * (scene creation, add/remove mesh, transforms, options updates, destroy)
 * plus the autoCenter mirror and 0×0 anchor pattern from React.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ParseResult, Polygon } from "@polycss/core";
import {
  createPolyScene,
  type SceneHandle,
} from "./createPolyScene";

function triangle(color = "#ff0000"): Polygon {
  return {
    vertices: [
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
    ],
    color,
  };
}

function texturedTriangle(): Polygon {
  return {
    vertices: triangle().vertices,
    texture: "https://example.com/tex.png",
    uvs: [
      [0, 0],
      [1, 0],
      [0, 1],
    ],
  };
}

function makeParseResult(polygons: Polygon[] = [triangle()]): ParseResult {
  let disposed = false;
  return {
    polygons,
    objectUrls: [],
    warnings: [],
    dispose: () => {
      disposed = true;
    },
    get _disposed() {
      return disposed;
    },
  } as ParseResult & { readonly _disposed: boolean };
}

function getCenterWrapper(host: HTMLElement): HTMLElement {
  const sceneEl = host.querySelector(".polycss-scene") as HTMLElement | null;
  const wrapper = sceneEl?.firstElementChild as HTMLElement | null;
  expect(wrapper).not.toBeNull();
  return wrapper!;
}

describe("createPolyScene", () => {
  let host: HTMLElement;
  let scene: SceneHandle | null;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    scene = null;
  });

  afterEach(() => {
    if (scene) scene.destroy();
    if (host.parentNode) host.parentNode.removeChild(host);
  });

  describe("scene creation", () => {
    it("throws when host is missing", () => {
      expect(() =>
        createPolyScene(null as unknown as HTMLElement),
      ).toThrow(/host must be an HTMLElement/);
    });

    it("creates a .polycss-scene child under the host", () => {
      scene = createPolyScene(host);
      const sceneEl = host.querySelector(".polycss-scene");
      expect(sceneEl).not.toBeNull();
    });

    it("renders the scene element as a 0x0 anchor at center (top:50%/left:50%)", () => {
      scene = createPolyScene(host);
      const sceneEl = host.querySelector(".polycss-scene") as HTMLElement;
      expect(sceneEl.style.position).toBe("absolute");
      expect(sceneEl.style.top).toBe("50%");
      expect(sceneEl.style.left).toBe("50%");
      expect(sceneEl.style.width).toBe("0px");
      expect(sceneEl.style.height).toBe("0px");
    });

    it("applies perspective + transform from options", () => {
      scene = createPolyScene(host, {
        perspective: 1500,
        rotX: 30,
        rotY: 60,
        zoom: 2,
      });
      const sceneEl = host.querySelector(".polycss-scene") as HTMLElement;
      expect(sceneEl.style.perspective).toBe("1500px");
      expect(sceneEl.style.transform).toContain("scale(2)");
      expect(sceneEl.style.transform).toContain("rotateX(30deg)");
      // rotY in our API maps to CSS rotate() (i.e. rotateZ) so the model
      // spins around its vertical world-Z axis, matching React's PolyCamera.
      expect(sceneEl.style.transform).toContain("rotate(60deg)");
    });

    it("sets perspective to none when perspective=false", () => {
      scene = createPolyScene(host, { perspective: false });
      const sceneEl = host.querySelector(".polycss-scene") as HTMLElement;
      expect(sceneEl.style.perspective).toBe("none");
    });

    it("injects base styles into the document", () => {
      scene = createPolyScene(host);
      const styleEl = document.getElementById("polycss-styles");
      expect(styleEl).not.toBeNull();
      expect(styleEl?.textContent).toContain("transform-origin: 0 0");
      expect(styleEl?.textContent).toContain("backface-visibility: hidden");
      expect(styleEl?.textContent).toContain("background-repeat: no-repeat");
    });
  });

  describe("add / remove mesh", () => {
    it("adds a .polycss-mesh wrapper with one polygon div per polygon", () => {
      scene = createPolyScene(host);
      const handle = scene.add(makeParseResult([triangle(), triangle("#00ff00")]));
      const wrappers = host.querySelectorAll(".polycss-mesh");
      expect(wrappers.length).toBe(1);
      const polys = host.querySelectorAll(".polycss-poly");
      expect(polys.length).toBe(2);
      expect(host.querySelector(".polycss-poly-atlas")).toBeNull();
      expect(host.querySelector(".polycss-poly-solid")).toBeNull();
      expect(host.querySelector(".polycss-poly-textured")).toBeNull();
      expect(host.querySelector("svg")).toBeNull();
      expect(handle.polygons.length).toBe(2);
    });

    it("renders textured polygons as polygon divs", () => {
      scene = createPolyScene(host);
      scene.add(makeParseResult([texturedTriangle()]));
      const poly = host.querySelector(".polycss-poly");
      expect(poly).not.toBeNull();
      expect(poly?.tagName.toLowerCase()).toBe("div");
    });

    it("applies mesh transform CSS", () => {
      scene = createPolyScene(host);
      scene.add(makeParseResult(), {
        position: [10, 20, 30],
        rotation: [45, 0, 0],
        scale: 2,
      });
      const wrapper = host.querySelector(".polycss-mesh") as HTMLElement;
      expect(wrapper.style.transform).toContain("translate3d(10px, 20px, 30px)");
      expect(wrapper.style.transform).toContain("rotateX(45deg)");
      expect(wrapper.style.transform).toContain("scale3d(2, 2, 2)");
    });

    it("handle.remove() detaches the wrapper from the DOM", () => {
      scene = createPolyScene(host);
      const handle = scene.add(makeParseResult());
      expect(host.querySelectorAll(".polycss-mesh").length).toBe(1);
      handle.remove();
      expect(host.querySelectorAll(".polycss-mesh").length).toBe(0);
    });

    it("handle.setTransform() updates the wrapper transform without re-mount", () => {
      scene = createPolyScene(host);
      const handle = scene.add(makeParseResult(), { position: [0, 0, 0] });
      handle.setTransform({ position: [5, 5, 5] });
      const wrapper = host.querySelector(".polycss-mesh") as HTMLElement;
      expect(wrapper.style.transform).toContain("translate3d(5px, 5px, 5px)");
    });

    it("handle.dispose() detaches the wrapper AND calls parseResult.dispose()", () => {
      scene = createPolyScene(host);
      const pr = makeParseResult();
      const handle = scene.add(pr);
      handle.dispose();
      expect(host.querySelectorAll(".polycss-mesh").length).toBe(0);
      expect((pr as ParseResult & { _disposed: boolean })._disposed).toBe(true);
    });

    it("handle.dispose() is idempotent", () => {
      scene = createPolyScene(host);
      const pr = makeParseResult();
      const handle = scene.add(pr);
      handle.dispose();
      expect(() => handle.dispose()).not.toThrow();
    });

    it("supports vec3 scale", () => {
      scene = createPolyScene(host);
      scene.add(makeParseResult(), { scale: [1, 2, 3] });
      const wrapper = host.querySelector(".polycss-mesh") as HTMLElement;
      expect(wrapper.style.transform).toContain("scale3d(1, 2, 3)");
    });

    it("renders nothing for degenerate polygons", () => {
      scene = createPolyScene(host);
      const degenerate: Polygon = { vertices: [[0, 0, 0]], color: "#ff0000" };
      scene.add(makeParseResult([degenerate]));
      const polys = host.querySelectorAll(".polycss-poly");
      expect(polys.length).toBe(0);
    });

    it("keeps source polygon alignment when degenerate polygons are skipped", () => {
      scene = createPolyScene(host);
      const degenerate: Polygon = { vertices: [[0, 0, 0]], color: "#ff0000" };
      scene.add(makeParseResult([degenerate, triangle()]));
      const poly = host.querySelector(".polycss-poly") as HTMLElement;
      expect(poly).not.toBeNull();
      expect(poly.classList.contains("polycss-dir-pz")).toBe(true);
    });
  });

  describe("merge option", () => {
    it("merge=auto runs mergePolygons (collapses coplanar same-color triangles)", () => {
      // Two triangles forming a quad, both red, should merge to 1 polygon.
      const tri1: Polygon = {
        vertices: [
          [0, 0, 0],
          [1, 0, 0],
          [1, 1, 0],
        ],
        color: "#ff0000",
      };
      const tri2: Polygon = {
        vertices: [
          [0, 0, 0],
          [1, 1, 0],
          [0, 1, 0],
        ],
        color: "#ff0000",
      };
      scene = createPolyScene(host, { merge: "auto" });
      const handle = scene.add(makeParseResult([tri1, tri2]));
      // After merge there should be 1 polygon, not 2.
      expect(handle.polygons.length).toBe(1);
    });

    it("merge=off (default) keeps polygons as-is", () => {
      const tri1 = triangle();
      const tri2 = triangle("#00ff00");
      scene = createPolyScene(host, { merge: "off" });
      const handle = scene.add(makeParseResult([tri1, tri2]));
      expect(handle.polygons.length).toBe(2);
    });
  });

  describe("setOptions", () => {
    it("updates scene transform when rotation options change", () => {
      scene = createPolyScene(host, { rotX: 0 });
      const sceneEl = host.querySelector(".polycss-scene") as HTMLElement;
      const before = sceneEl.style.transform;
      scene.setOptions({ rotX: 90 });
      expect(sceneEl.style.transform).not.toBe(before);
      expect(sceneEl.style.transform).toContain("rotateX(90deg)");
    });

    it("updates perspective", () => {
      scene = createPolyScene(host, { perspective: 1000 });
      scene.setOptions({ perspective: 2500 });
      const sceneEl = host.querySelector(".polycss-scene") as HTMLElement;
      expect(sceneEl.style.perspective).toBe("2500px");
    });

    it("updates perspective to none", () => {
      scene = createPolyScene(host, { perspective: 1000 });
      scene.setOptions({ perspective: false });
      const sceneEl = host.querySelector(".polycss-scene") as HTMLElement;
      expect(sceneEl.style.perspective).toBe("none");
    });
  });

  describe("destroy", () => {
    it("removes the scene element from the host", () => {
      scene = createPolyScene(host);
      expect(host.querySelector(".polycss-scene")).not.toBeNull();
      scene.destroy();
      expect(host.querySelector(".polycss-scene")).toBeNull();
      scene = null;
    });

    it("disposes all registered meshes (calls parseResult.dispose())", () => {
      scene = createPolyScene(host);
      const pr1 = makeParseResult();
      const pr2 = makeParseResult();
      scene.add(pr1);
      scene.add(pr2);
      scene.destroy();
      scene = null;
      expect((pr1 as ParseResult & { _disposed: boolean })._disposed).toBe(true);
      expect((pr2 as ParseResult & { _disposed: boolean })._disposed).toBe(true);
    });
  });

  describe("autoCenter", () => {
    it("default (no autoCenter) does not transform the wrapper", () => {
      scene = createPolyScene(host);
      scene.add(makeParseResult());
      const centerWrapper = getCenterWrapper(host);
      expect(centerWrapper.style.transform).toBe("");
    });

    it("autoCenter=true applies translate3d that re-centers polygons", () => {
      // Triangle whose bbox center is at (0.5, 0.5, 0).
      const t: Polygon = {
        vertices: [
          [0, 0, 0],
          [1, 0, 0],
          [0, 1, 0],
        ],
        color: "#ff0000",
      };
      scene = createPolyScene(host, { autoCenter: true });
      scene.add(makeParseResult([t]));
      const centerWrapper = getCenterWrapper(host);
      expect(centerWrapper.style.transform).toMatch(/^translate3d\(.+\)$/);
      // World-Y → CSS-x means cssX = ((0 + 1) / 2) * 50 = 25.
      // We translate by -cssX, so expect "-25".
      expect(centerWrapper.style.transform).toContain("-25");
    });

    it("autoCenter recomputes when meshes change", () => {
      scene = createPolyScene(host, { autoCenter: true });
      const handle = scene.add(makeParseResult([triangle()]));
      const centerWrapper = getCenterWrapper(host);
      const t1 = centerWrapper.style.transform;

      // Add a second mesh with different bbox.
      const big: Polygon = {
        vertices: [
          [0, 0, 0],
          [10, 0, 0],
          [0, 10, 0],
        ],
        color: "#00ff00",
      };
      const bigHandle = scene.add(makeParseResult([big]));
      const t2 = centerWrapper.style.transform;
      expect(t2).not.toBe(t1);

      // Removing the dominant mesh should recompute back to the small one.
      bigHandle.remove();
      const t3 = centerWrapper.style.transform;
      expect(t3).toBe(t1);

      // Removing the last mesh leaves transform empty.
      handle.remove();
      const t4 = centerWrapper.style.transform;
      expect(t4).toBe("");
    });

    it("autoCenter=true with no meshes leaves transform empty", () => {
      scene = createPolyScene(host, { autoCenter: true });
      const centerWrapper = getCenterWrapper(host);
      expect(centerWrapper.style.transform).toBe("");
    });

    it("setOptions({autoCenter: true}) enables centering after the fact", () => {
      scene = createPolyScene(host, { autoCenter: false });
      scene.add(makeParseResult([triangle()]));
      const centerWrapper = getCenterWrapper(host);
      expect(centerWrapper.style.transform).toBe("");
      scene.setOptions({ autoCenter: true });
      expect(centerWrapper.style.transform).toMatch(/^translate3d\(.+\)$/);
    });

    it("autoCenter uses the fixed default Z elevation", () => {
      // Triangle whose bbox in Z is [0, 2]. Center Z is 1 * 50 = 50.
      const tri: Polygon = {
        vertices: [
          [0, 0, 0],
          [1, 0, 0],
          [0, 0, 2],
        ],
        color: "#fff",
      };
      scene = createPolyScene(host, { autoCenter: true });
      scene.add(makeParseResult([tri]));
      const centerWrapper = getCenterWrapper(host);
      expect(centerWrapper.style.transform).toContain("-50px");
    });
  });
});
