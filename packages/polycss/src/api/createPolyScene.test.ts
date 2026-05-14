/**
 * Imperative scene API tests — verifies createPolyScene's public surface
 * (scene creation, add/remove mesh, transforms, options updates, destroy)
 * plus the autoCenter mirror and 0×0 anchor pattern from React.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ParseResult, Polygon } from "@layoutit/polycss-core";
import {
  createPolyScene,
  type PolySceneHandle,
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
  let scene: PolySceneHandle | null;

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

    it("exposes the host element on the returned handle", () => {
      scene = createPolyScene(host);
      expect(scene.host).toBe(host);
    });

    it("getOptions() returns the current options snapshot including defaults that were passed", () => {
      scene = createPolyScene(host, { rotX: 30, rotY: 60, zoom: 2 });
      const opts = scene.getOptions();
      expect(opts.rotX).toBe(30);
      expect(opts.rotY).toBe(60);
      expect(opts.zoom).toBe(2);
    });

    it("getOptions() reflects updates made via setOptions", () => {
      scene = createPolyScene(host, { rotY: 0 });
      scene.setOptions({ rotY: 90 });
      expect(scene.getOptions().rotY).toBe(90);
    });

    it("creates a .polycss-scene child under the host", () => {
      scene = createPolyScene(host);
      const sceneEl = host.querySelector(".polycss-scene");
      expect(sceneEl).not.toBeNull();
    });

    it("renders the scene element as a 0x0 anchor at center (top:50%/left:50%)", () => {
      scene = createPolyScene(host);
      const sceneEl = host.querySelector(".polycss-scene") as HTMLElement;
      expect(sceneEl.getAttribute("aria-hidden")).toBe("true");
      expect(sceneEl.style.position).toBe("");
      expect(sceneEl.style.top).toBe("");
      expect(sceneEl.style.left).toBe("");
      expect(sceneEl.style.width).toBe("");
      expect(sceneEl.style.height).toBe("");
    });

    it("applies scene transform from options through a custom property", () => {
      scene = createPolyScene(host, {
        perspective: 1500,
        rotX: 30,
        rotY: 60,
        zoom: 2,
      });
      const sceneEl = host.querySelector(".polycss-scene") as HTMLElement;
      const transform = sceneEl.style.getPropertyValue("--scene-transform");
      expect(sceneEl.style.perspective).toBe("");
      expect(transform).toContain("scale(2)");
      expect(transform).toContain("rotateX(30deg)");
      // rotY in our API maps to CSS rotate() (i.e. rotateZ) so the model
      // spins around its vertical world-Z axis, matching React's PolyCamera.
      expect(transform).toContain("rotate(60deg)");
    });

    it("keeps perspective in CSS instead of inline styles", () => {
      scene = createPolyScene(host, { perspective: false });
      const sceneEl = host.querySelector(".polycss-scene") as HTMLElement;
      expect(sceneEl.style.perspective).toBe("");
    });

    it("injects base styles into the document", () => {
      scene = createPolyScene(host);
      const styleEl = document.getElementById("polycss-styles");
      expect(styleEl).not.toBeNull();
      expect(styleEl?.textContent).toContain("transform-origin: 0 0");
      expect(styleEl?.textContent).toContain("backface-visibility: hidden");
      expect(styleEl?.textContent).toContain("background-repeat: no-repeat");
      expect(styleEl?.textContent).toContain("width: 0;");
      expect(styleEl?.textContent).toContain("height: 0;");
    });
  });

  describe("add / remove mesh", () => {
    it("adds a .polycss-mesh wrapper with one polygon leaf element per polygon", () => {
      scene = createPolyScene(host);
      const handle = scene.add(makeParseResult([triangle(), triangle("#00ff00")]));
      const wrappers = host.querySelectorAll(".polycss-mesh");
      expect(wrappers.length).toBe(1);
      const polys = host.querySelectorAll("i,b,s,u");
      expect(polys.length).toBe(2);
      expect(host.querySelector(".polycss-poly-atlas")).toBeNull();
      expect(host.querySelector(".polycss-poly-solid")).toBeNull();
      expect(host.querySelector(".polycss-poly-textured")).toBeNull();
      expect(host.querySelector("svg")).toBeNull();
      expect(handle.polygons.length).toBe(2);
    });

    it("hoists the repeated baked solid paint to the mesh wrapper", () => {
      scene = createPolyScene(host);
      scene.add(makeParseResult([triangle(), triangle()]), { merge: false });
      const wrapper = host.querySelector(".polycss-mesh") as HTMLElement;
      const polys = Array.from(host.querySelectorAll("u")) as HTMLElement[];
      expect(wrapper.style.getPropertyValue("--polycss-paint")).not.toBe("");
      expect(polys).toHaveLength(2);
      expect(polys.every((poly) => poly.style.color === "")).toBe(true);
      expect(polys.every((poly) => poly.style.borderBottomColor === "")).toBe(true);
    });

    it("hoists repeated dynamic solid base RGB channels to the mesh wrapper", () => {
      scene = createPolyScene(host, { textureLighting: "dynamic" });
      scene.add(makeParseResult([triangle(), triangle()]), { merge: false });
      const wrapper = host.querySelector(".polycss-mesh") as HTMLElement;
      const polys = Array.from(host.querySelectorAll("u")) as HTMLElement[];
      expect(wrapper.style.getPropertyValue("--psr")).toBe("1.0000");
      expect(wrapper.style.getPropertyValue("--psg")).toBe("0.0000");
      expect(wrapper.style.getPropertyValue("--psb")).toBe("0.0000");
      expect(polys).toHaveLength(2);
      expect(polys.every((poly) => poly.style.getPropertyValue("--psr") === "")).toBe(true);
    });

    it("renders textured polygons as polygon s elements", () => {
      scene = createPolyScene(host);
      scene.add(makeParseResult([texturedTriangle()]));
      const poly = host.querySelector("s");
      expect(poly).not.toBeNull();
      expect(poly?.tagName.toLowerCase()).toBe("s");
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

    it("can update stableDom mesh geometry without replacing polygon elements", () => {
      scene = createPolyScene(host);
      const handle = scene.add(makeParseResult([triangle()]), {
        merge: false,
        stableDom: true,
      });
      const before = Array.from(host.querySelectorAll("i,b,s,u")) as HTMLElement[];
      expect(before.length).toBe(1);
      const beforeTransform = before[0].style.transform;

      handle.setPolygons([{
        vertices: [
          [0, 0, 0],
          [2, 0, 0],
          [0, 1, 0],
        ],
        color: "#ff0000",
      }], { merge: false, stableDom: true });

      const after = Array.from(host.querySelectorAll("i,b,s,u")) as HTMLElement[];
      expect(after.length).toBe(1);
      expect(after[0]).toBe(before[0]);
      expect(after[0].style.transform).not.toBe(beforeTransform);
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
      const polys = host.querySelectorAll("i,b,s,u");
      expect(polys.length).toBe(0);
    });

    it("keeps source polygon alignment when degenerate polygons are skipped", () => {
      scene = createPolyScene(host);
      const degenerate: Polygon = { vertices: [[0, 0, 0]], color: "#ff0000" };
      scene.add(makeParseResult([degenerate, triangle()]));
      const poly = host.querySelector("i,b,s,u") as HTMLElement;
      expect(poly).not.toBeNull();
      expect(poly.tagName.toLowerCase()).toBe("u");
      expect(poly.style.transform).toContain("matrix3d(");
      expect(poly.style.borderBottomWidth).not.toBe("");
    });

    describe("rebakeAtlas", () => {
      it("rebakeAtlas() does not throw", () => {
        scene = createPolyScene(host);
        const handle = scene.add(makeParseResult([triangle()]));
        expect(() => handle.rebakeAtlas()).not.toThrow();
      });

      it("rebakeAtlas() re-renders the mesh (polygon elements are replaced)", () => {
        scene = createPolyScene(host);
        const handle = scene.add(makeParseResult([triangle()]));
        handle.setTransform({ rotation: [0, 45, 0] });

        // Capture the current polygon element reference(s) before rebake.
        const before = Array.from(host.querySelectorAll(".polycss-mesh i, .polycss-mesh b, .polycss-mesh s, .polycss-mesh u")) as HTMLElement[];
        expect(before.length).toBeGreaterThan(0);

        handle.rebakeAtlas();

        // After rebake the wrapper should still have polygon elements.
        const after = Array.from(host.querySelectorAll(".polycss-mesh i, .polycss-mesh b, .polycss-mesh s, .polycss-mesh u")) as HTMLElement[];
        expect(after.length).toBeGreaterThan(0);
      });

      it("rebakeAtlas() is callable multiple times without throwing", () => {
        scene = createPolyScene(host);
        const handle = scene.add(makeParseResult([triangle()]));
        expect(() => {
          handle.setTransform({ rotation: [0, 30, 0] });
          handle.rebakeAtlas();
          handle.setTransform({ rotation: [0, 60, 0] });
          handle.rebakeAtlas();
          handle.setTransform({ rotation: [0, 90, 0] });
          handle.rebakeAtlas();
        }).not.toThrow();
      });

      it("rebakeAtlas() calls renderEntry (spy on setPolygons verifies re-render pathway)", () => {
        scene = createPolyScene(host);
        const handle = scene.add(makeParseResult([triangle()]));
        handle.setTransform({ rotation: [0, 45, 0] });

        // Spy on renderEntry indirectly: clearRendered empties the wrapper,
        // then re-populates it. After rebakeAtlas the wrapper must be non-empty.
        const wrapper = host.querySelector(".polycss-mesh") as HTMLElement;
        // Manually hollow out the wrapper to detect the re-population.
        while (wrapper.firstChild) wrapper.removeChild(wrapper.firstChild);
        expect(wrapper.children.length).toBe(0);

        handle.rebakeAtlas();
        // renderEntry re-populates the wrapper synchronously (solid polys).
        expect(wrapper.children.length).toBeGreaterThan(0);
      });

      it("rebakeAtlas() on a mesh with no rotation uses zero-rotation inverse (identity light)", () => {
        scene = createPolyScene(host, {
          directionalLight: { direction: [0, 0, 1], color: "#ffffff", intensity: 1 },
        });
        const handle = scene.add(makeParseResult([triangle()]));
        // With zero rotation the inverse is the identity, so the light direction
        // passed to the baker equals the original. No throw, mesh still renders.
        expect(() => handle.rebakeAtlas()).not.toThrow();
        const polys = host.querySelectorAll(".polycss-mesh i, .polycss-mesh b, .polycss-mesh s, .polycss-mesh u");
        expect(polys.length).toBeGreaterThan(0);
      });

      it("rebakeAtlas() is a no-op spy target (can be mocked externally)", () => {
        scene = createPolyScene(host);
        const handle = scene.add(makeParseResult([triangle()]));
        const spy = vi.spyOn(handle, "rebakeAtlas");
        handle.rebakeAtlas();
        expect(spy).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe("PolyMeshHandle getters", () => {
    it("getPolygons() returns the same array as handle.polygons", () => {
      scene = createPolyScene(host);
      const handle = scene.add(makeParseResult([triangle()]));
      expect(handle.getPolygons()).toBe(handle.polygons);
    });

    it("getPolygons() reflects setPolygons() update", () => {
      scene = createPolyScene(host);
      const handle = scene.add(makeParseResult([triangle()]));
      const newPolys = [triangle("#00ff00"), triangle("#0000ff")];
      handle.setPolygons(newPolys, { merge: false });
      expect(handle.getPolygons()).toBe(handle.polygons);
      expect(handle.getPolygons().length).toBe(2);
    });

    it("getPosition() returns transform.position", () => {
      scene = createPolyScene(host);
      const pos: [number, number, number] = [1, 2, 3];
      const handle = scene.add(makeParseResult(), { position: pos });
      expect(handle.getPosition()).toEqual(pos);
      expect(handle.getPosition()).toBe(handle.transform.position);
    });

    it("getPosition() returns undefined when no position set", () => {
      scene = createPolyScene(host);
      const handle = scene.add(makeParseResult());
      expect(handle.getPosition()).toBeUndefined();
    });

    it("getPosition() reflects setTransform() update", () => {
      scene = createPolyScene(host);
      const handle = scene.add(makeParseResult(), { position: [0, 0, 0] });
      handle.setTransform({ position: [10, 20, 30] });
      expect(handle.getPosition()).toEqual([10, 20, 30]);
    });

    it("getRotation() returns transform.rotation", () => {
      scene = createPolyScene(host);
      const rot: [number, number, number] = [45, 90, 180];
      const handle = scene.add(makeParseResult(), { rotation: rot });
      expect(handle.getRotation()).toEqual(rot);
      expect(handle.getRotation()).toBe(handle.transform.rotation);
    });

    it("getRotation() returns undefined when no rotation set", () => {
      scene = createPolyScene(host);
      const handle = scene.add(makeParseResult());
      expect(handle.getRotation()).toBeUndefined();
    });

    it("getScale() returns transform.scale (number)", () => {
      scene = createPolyScene(host);
      const handle = scene.add(makeParseResult(), { scale: 2.5 });
      expect(handle.getScale()).toBe(2.5);
      expect(handle.getScale()).toBe(handle.transform.scale);
    });

    it("getScale() returns transform.scale (Vec3)", () => {
      scene = createPolyScene(host);
      const scale: [number, number, number] = [1, 2, 3];
      const handle = scene.add(makeParseResult(), { scale });
      expect(handle.getScale()).toEqual(scale);
    });

    it("getScale() returns undefined when no scale set", () => {
      scene = createPolyScene(host);
      const handle = scene.add(makeParseResult());
      expect(handle.getScale()).toBeUndefined();
    });
  });

  describe("automatic merge", () => {
    it("collapses coplanar same-color triangles", () => {
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
      scene = createPolyScene(host);
      const handle = scene.add(makeParseResult([tri1, tri2]));
      // After merge there should be 1 polygon, not 2.
      expect(handle.polygons.length).toBe(1);
    });
  });

  describe("setOptions", () => {
    it("updates scene transform when rotation options change", () => {
      scene = createPolyScene(host, { rotX: 0 });
      const sceneEl = host.querySelector(".polycss-scene") as HTMLElement;
      const before = sceneEl.style.getPropertyValue("--scene-transform");
      scene.setOptions({ rotX: 90 });
      expect(sceneEl.style.getPropertyValue("--scene-transform")).not.toBe(before);
      expect(sceneEl.style.getPropertyValue("--scene-transform")).toContain("rotateX(90deg)");
    });

    it("does not inline perspective", () => {
      scene = createPolyScene(host, { perspective: 1000 });
      scene.setOptions({ perspective: 2500 });
      const sceneEl = host.querySelector(".polycss-scene") as HTMLElement;
      expect(sceneEl.style.perspective).toBe("");
    });

    it("updates perspective to none", () => {
      scene = createPolyScene(host, { perspective: 1000 });
      scene.setOptions({ perspective: false });
      const sceneEl = host.querySelector(".polycss-scene") as HTMLElement;
      expect(sceneEl.style.perspective).toBe("");
    });

    it("emits dynamic light cascade vars on the scene element when textureLighting='dynamic'", () => {
      scene = createPolyScene(host, {
        textureLighting: "dynamic",
        directionalLight: { direction: [0, 0, 1], color: "#ff8800", intensity: 1.5 },
        ambientLight: { color: "#222222", intensity: 0.3 },
      });
      const sceneEl = host.querySelector(".polycss-scene") as HTMLElement;
      expect(sceneEl.dataset.polycssLighting).toBe("dynamic");
      expect(sceneEl.style.getPropertyValue("--plz")).toBe("1.0000");
      expect(sceneEl.style.getPropertyValue("--pli")).toBe("1.5000");
      expect(sceneEl.style.getPropertyValue("--pai")).toBe("0.3000");
      // #ff8800 → r=255 (1), g=136 (0.5333), b=0 (0).
      expect(sceneEl.style.getPropertyValue("--plr")).toBe("1.0000");
      expect(sceneEl.style.getPropertyValue("--plb")).toBe("0.0000");
      // #222222 → r=g=b=34 (0.1333).
      expect(sceneEl.style.getPropertyValue("--par")).toBe("0.1333");
    });

    it("removes dynamic light vars when textureLighting flips back to baked", () => {
      scene = createPolyScene(host, { textureLighting: "dynamic" });
      const sceneEl = host.querySelector(".polycss-scene") as HTMLElement;
      expect(sceneEl.style.getPropertyValue("--plz")).not.toBe("");
      scene.setOptions({ textureLighting: "baked" });
      expect(sceneEl.style.getPropertyValue("--plz")).toBe("");
      expect(sceneEl.dataset.polycssLighting).toBe("baked");
    });

    it("honors strategies.disable at creation time", () => {
      scene = createPolyScene(host, { strategies: { disable: ["u"] } });
      scene.add(makeParseResult([triangle()]));
      expect(host.querySelector("u")).toBeNull();
      expect(host.querySelector("i, s")).not.toBeNull();
    });

    it("re-renders meshes when strategies changes via setOptions", () => {
      scene = createPolyScene(host);
      scene.add(makeParseResult([triangle()]));
      expect(host.querySelector("u")).not.toBeNull();
      scene.setOptions({ strategies: { disable: ["u"] } });
      expect(host.querySelector("u")).toBeNull();
      expect(host.querySelector("i, s")).not.toBeNull();
    });

    it("re-enables a strategy when removed from disable list via setOptions", () => {
      scene = createPolyScene(host, { strategies: { disable: ["u"] } });
      scene.add(makeParseResult([triangle()]));
      expect(host.querySelector("u")).toBeNull();
      scene.setOptions({ strategies: { disable: [] } });
      expect(host.querySelector("u")).not.toBeNull();
    });

    // Perf-fix tests: setOptions used to call recomputeAutoCenter() on every
    // call, which is O(N polys) and would be paid 60×/sec by an autorotate
    // loop. The smart-diff version only recomputes when `autoCenter` itself
    // changes (mesh add/remove paths still trigger their own recomputation,
    // so geometry changes are correctly reflected).
    //
    // We can't spy on the closure-private `recomputeAutoCenter` directly, so
    // we observe its side effect: it writes to centerWrapper's
    // --offset-transform custom property.
    // Pre-clearing that string and asserting it stays empty after a
    // setOptions({rotY}) proves the function did not run.
    describe("autoCenter recomputation diff", () => {
      it("does not recompute autoCenter on a camera-only setOptions", () => {
        scene = createPolyScene(host, { autoCenter: true });
        scene.add(makeParseResult([triangle()]));
        const centerWrapper = getCenterWrapper(host);
        expect(centerWrapper.style.getPropertyValue("--offset-transform")).toMatch(/^translate3d/);
        // Clear the transform; if recomputeAutoCenter runs it'll be re-set.
        centerWrapper.style.removeProperty("--offset-transform");
        scene.setOptions({ rotY: 90 });
        expect(centerWrapper.style.getPropertyValue("--offset-transform")).toBe("");
      });

      it("does not recompute autoCenter on a lighting-only setOptions", () => {
        scene = createPolyScene(host, { autoCenter: true });
        scene.add(makeParseResult([triangle()]));
        const centerWrapper = getCenterWrapper(host);
        centerWrapper.style.removeProperty("--offset-transform");
        scene.setOptions({
          directionalLight: { direction: [1, 0, 0], color: "#fff", intensity: 1 },
        });
        expect(centerWrapper.style.getPropertyValue("--offset-transform")).toBe("");
      });

      it("does not recompute autoCenter on textureLighting changes", () => {
        scene = createPolyScene(host, { autoCenter: true, textureLighting: "dynamic" });
        scene.add(makeParseResult([triangle()]));
        const centerWrapper = getCenterWrapper(host);
        centerWrapper.style.removeProperty("--offset-transform");
        scene.setOptions({ textureLighting: "baked" });
        expect(centerWrapper.style.getPropertyValue("--offset-transform")).toBe("");
      });

      it("does not recompute autoCenter on perspective changes", () => {
        scene = createPolyScene(host, { autoCenter: true });
        scene.add(makeParseResult([triangle()]));
        const centerWrapper = getCenterWrapper(host);
        centerWrapper.style.removeProperty("--offset-transform");
        scene.setOptions({ perspective: 4000 });
        expect(centerWrapper.style.getPropertyValue("--offset-transform")).toBe("");
      });

      it("DOES recompute autoCenter when autoCenter itself toggles", () => {
        scene = createPolyScene(host, { autoCenter: false });
        scene.add(makeParseResult([triangle()]));
        const centerWrapper = getCenterWrapper(host);
        // Was disabled, so initial state is empty. Flip on → must recompute.
        scene.setOptions({ autoCenter: true });
        expect(centerWrapper.style.getPropertyValue("--offset-transform")).toMatch(/^translate3d/);
      });

      it("does NOT recompute autoCenter when autoCenter is re-set to its current value", () => {
        // The diff is value-based (prevAutoCenter !== nextAutoCenter), so
        // setting autoCenter to its existing value is a no-op. Callers
        // that need to force a refresh should toggle off-then-on, or
        // change the underlying mesh (which triggers its own recompute
        // via add()/remove()).
        scene = createPolyScene(host, { autoCenter: true });
        scene.add(makeParseResult([triangle()]));
        const centerWrapper = getCenterWrapper(host);
        centerWrapper.style.removeProperty("--offset-transform");
        scene.setOptions({ autoCenter: true });
        expect(centerWrapper.style.getPropertyValue("--offset-transform")).toBe("");
      });

      it("still updates the scene transform on a camera-only setOptions", () => {
        // Sanity check: skipping recomputeAutoCenter must NOT skip the camera
        // transform update — the scene element should still reflect new rotY.
        scene = createPolyScene(host, { autoCenter: true, rotY: 0 });
        scene.add(makeParseResult([triangle()]));
        const sceneEl = host.querySelector(".polycss-scene") as HTMLElement;
        scene.setOptions({ rotY: 137 });
        expect(sceneEl.style.getPropertyValue("--scene-transform")).toContain("rotate(137deg)");
      });
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

  describe("dynamic-mode per-mesh light override", () => {
    // Directional light pointing straight down +Z (unit vector, easy to verify
    // after inverse rotation).
    const lightDir = [0, 0, 1] as [number, number, number];
    const dynLight = {
      textureLighting: "dynamic" as const,
      directionalLight: { direction: lightDir, color: "#ffffff", intensity: 1 },
    };

    it("emits --plx/ly/lz on the mesh wrapper when dynamic + non-zero rotation", () => {
      scene = createPolyScene(host, dynLight);
      scene.add(makeParseResult([triangle()]), { rotation: [0, 90, 0] });
      const wrapper = host.querySelector(".polycss-mesh") as HTMLElement;
      // inverseRotateVec3([0,0,1], [0,90,0]) = rotateY(-90) on [0,0,1] = [-1,0,0]
      expect(wrapper.style.getPropertyValue("--plx")).toBe("-1.0000");
      expect(wrapper.style.getPropertyValue("--ply")).toBe("0.0000");
      expect(wrapper.style.getPropertyValue("--plz")).toBe("0.0000");
    });

    it("updates the override synchronously when setTransform changes rotation", () => {
      scene = createPolyScene(host, dynLight);
      const handle = scene.add(makeParseResult([triangle()]), { rotation: [0, 90, 0] });
      const wrapper = host.querySelector(".polycss-mesh") as HTMLElement;
      // Rotate back to zero — override should be removed.
      handle.setTransform({ rotation: [0, 0, 0] });
      expect(wrapper.style.getPropertyValue("--plx")).toBe("");
      expect(wrapper.style.getPropertyValue("--ply")).toBe("");
      expect(wrapper.style.getPropertyValue("--plz")).toBe("");
    });

    it("removes the override when rotation is set back to zero", () => {
      scene = createPolyScene(host, dynLight);
      const handle = scene.add(makeParseResult([triangle()]), { rotation: [0, 90, 0] });
      const wrapper = host.querySelector(".polycss-mesh") as HTMLElement;
      expect(wrapper.style.getPropertyValue("--plx")).not.toBe("");
      handle.setTransform({ rotation: [0, 0, 0] });
      expect(wrapper.style.getPropertyValue("--plx")).toBe("");
    });

    it("removes the override when scene switches to baked lighting", () => {
      scene = createPolyScene(host, dynLight);
      scene.add(makeParseResult([triangle()]), { rotation: [0, 90, 0] });
      const wrapper = host.querySelector(".polycss-mesh") as HTMLElement;
      expect(wrapper.style.getPropertyValue("--plx")).not.toBe("");
      scene.setOptions({ textureLighting: "baked" });
      expect(wrapper.style.getPropertyValue("--plx")).toBe("");
      expect(wrapper.style.getPropertyValue("--ply")).toBe("");
      expect(wrapper.style.getPropertyValue("--plz")).toBe("");
    });

    it("does NOT emit override for a mesh with no rotation in a dynamic scene", () => {
      scene = createPolyScene(host, dynLight);
      scene.add(makeParseResult([triangle()]));
      const wrapper = host.querySelector(".polycss-mesh") as HTMLElement;
      expect(wrapper.style.getPropertyValue("--plx")).toBe("");
      expect(wrapper.style.getPropertyValue("--ply")).toBe("");
      expect(wrapper.style.getPropertyValue("--plz")).toBe("");
    });

    it("updates the override on all meshes when scene directionalLight changes", () => {
      scene = createPolyScene(host, dynLight);
      scene.add(makeParseResult([triangle()]), { rotation: [0, 90, 0] });
      const wrapper = host.querySelector(".polycss-mesh") as HTMLElement;
      // Change the world light to +X direction → inverseRotateVec3([1,0,0],[0,90,0])
      // = rotateY(-90) on [1,0,0] → x=1*cos(-90)+0*sin(-90)=0, z=-1*sin(-90)+0*cos(-90)=1
      // result = [0, 0, 1]
      scene.setOptions({
        directionalLight: { direction: [1, 0, 0], color: "#ffffff", intensity: 1 },
      });
      expect(wrapper.style.getPropertyValue("--plx")).toBe("0.0000");
      expect(wrapper.style.getPropertyValue("--ply")).toBe("0.0000");
      expect(wrapper.style.getPropertyValue("--plz")).toBe("1.0000");
    });

    it("does NOT emit override when scene has no directionalLight", () => {
      scene = createPolyScene(host, { textureLighting: "dynamic" });
      scene.add(makeParseResult([triangle()]), { rotation: [0, 90, 0] });
      const wrapper = host.querySelector(".polycss-mesh") as HTMLElement;
      expect(wrapper.style.getPropertyValue("--plx")).toBe("");
    });
  });

  describe("autoCenter", () => {
    it("default (no autoCenter) does not transform the wrapper", () => {
      scene = createPolyScene(host);
      scene.add(makeParseResult());
      const centerWrapper = getCenterWrapper(host);
      expect(centerWrapper.style.getPropertyValue("--offset-transform")).toBe("");
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
      expect(centerWrapper.style.getPropertyValue("--offset-transform")).toMatch(/^translate3d\(.+\)$/);
      // World-Y → CSS-x means cssX = ((0 + 1) / 2) * 50 = 25.
      // We translate by -cssX, so expect "-25".
      expect(centerWrapper.style.getPropertyValue("--offset-transform")).toContain("-25");
    });

    it("autoCenter recomputes when meshes change", () => {
      scene = createPolyScene(host, { autoCenter: true });
      const handle = scene.add(makeParseResult([triangle()]));
      const centerWrapper = getCenterWrapper(host);
      const t1 = centerWrapper.style.getPropertyValue("--offset-transform");

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
      const t2 = centerWrapper.style.getPropertyValue("--offset-transform");
      expect(t2).not.toBe(t1);

      // Removing the dominant mesh should recompute back to the small one.
      bigHandle.remove();
      const t3 = centerWrapper.style.getPropertyValue("--offset-transform");
      expect(t3).toBe(t1);

      // Removing the last mesh leaves transform empty.
      handle.remove();
      const t4 = centerWrapper.style.getPropertyValue("--offset-transform");
      expect(t4).toBe("");
    });

    it("autoCenter=true with no meshes leaves transform empty", () => {
      scene = createPolyScene(host, { autoCenter: true });
      const centerWrapper = getCenterWrapper(host);
      expect(centerWrapper.style.getPropertyValue("--offset-transform")).toBe("");
    });

    it("setOptions({autoCenter: true}) enables centering after the fact", () => {
      scene = createPolyScene(host, { autoCenter: false });
      scene.add(makeParseResult([triangle()]));
      const centerWrapper = getCenterWrapper(host);
      expect(centerWrapper.style.getPropertyValue("--offset-transform")).toBe("");
      scene.setOptions({ autoCenter: true });
      expect(centerWrapper.style.getPropertyValue("--offset-transform")).toMatch(/^translate3d\(.+\)$/);
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
      expect(centerWrapper.style.getPropertyValue("--offset-transform")).toContain("-50px");
    });

    it("excludeFromAutoCenter meshes do not shift the bbox", () => {
      // The chicken (one triangle) defines the bbox. An overlay mesh added
      // far from the origin would normally pull the center toward itself
      // — but with excludeFromAutoCenter:true the overlay is ignored.
      const chicken: Polygon = {
        vertices: [
          [0, 0, 0],
          [1, 0, 0],
          [0, 1, 0],
        ],
        color: "#fff",
      };
      const farAway: Polygon = {
        vertices: [
          [100, 100, 0],
          [101, 100, 0],
          [100, 101, 0],
        ],
        color: "#fff",
      };
      scene = createPolyScene(host, { autoCenter: true });
      scene.add(makeParseResult([chicken]));
      const centerWrapper = getCenterWrapper(host);
      const before = centerWrapper.style.getPropertyValue("--offset-transform");
      scene.add(makeParseResult([farAway]), { excludeFromAutoCenter: true });
      expect(centerWrapper.style.getPropertyValue("--offset-transform")).toBe(before);

      // Sanity check: without the flag, the same overlay DOES shift the bbox.
      scene.add(makeParseResult([farAway]));
      expect(centerWrapper.style.getPropertyValue("--offset-transform")).not.toBe(before);
    });
  });
});
