/**
 * <poly-scene> custom element tests — registration, attribute parsing,
 * connect/disconnect lifecycle, attribute changes.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PolySceneElement } from "./PolySceneElement";

beforeAll(() => {
  if (!customElements.get("poly-scene")) {
    customElements.define("poly-scene", PolySceneElement);
  }
});

describe("PolySceneElement", () => {
  let host: HTMLElement;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  afterEach(() => {
    if (host.parentNode) host.parentNode.removeChild(host);
  });

  describe("registration", () => {
    it("is registered as <poly-scene>", () => {
      expect(customElements.get("poly-scene")).toBe(PolySceneElement);
    });

    it("includes the documented observed attributes", () => {
      const observed = PolySceneElement.observedAttributes;
      expect(observed).toContain("perspective");
      expect(observed).toContain("rot-x");
      expect(observed).toContain("rot-y");
      expect(observed).toContain("zoom");
      expect(observed).toContain("merge");
      expect(observed).toContain("projection");
      expect(observed).toContain("light-direction");
      expect(observed).toContain("light-color");
      expect(observed).toContain("light-ambient");
      expect(observed).toContain("light-ambient-color");
      expect(observed).toContain("auto-center");
    });
  });

  describe("connectedCallback", () => {
    it("creates a SceneHandle on connect, exposed via getScene()", () => {
      const el = document.createElement("poly-scene") as PolySceneElement;
      expect(el.getScene()).toBeNull();
      host.appendChild(el);
      expect(el.getScene()).not.toBeNull();
    });

    it("dispatches polycss:scene-ready on connect", () => {
      const el = document.createElement("poly-scene") as PolySceneElement;
      let dispatched = false;
      el.addEventListener("polycss:scene-ready", () => {
        dispatched = true;
      });
      host.appendChild(el);
      expect(dispatched).toBe(true);
    });

    it("inserts a .polycss-scene wrapper into the element", () => {
      const el = document.createElement("poly-scene") as PolySceneElement;
      host.appendChild(el);
      expect(el.querySelector(".polycss-scene")).not.toBeNull();
    });

    it("is idempotent — re-running connectedCallback doesn't recreate the scene", () => {
      const el = document.createElement("poly-scene") as PolySceneElement;
      host.appendChild(el);
      const first = el.getScene();
      el.connectedCallback();
      expect(el.getScene()).toBe(first);
    });
  });

  describe("disconnectedCallback", () => {
    it("destroys the scene on disconnect", () => {
      const el = document.createElement("poly-scene") as PolySceneElement;
      host.appendChild(el);
      expect(el.getScene()).not.toBeNull();
      host.removeChild(el);
      expect(el.getScene()).toBeNull();
    });
  });

  describe("attribute parsing", () => {
    it("parses perspective as a number", () => {
      const el = document.createElement("poly-scene") as PolySceneElement;
      el.setAttribute("perspective", "2000");
      host.appendChild(el);
      const sceneEl = el.querySelector(".polycss-scene") as HTMLElement;
      expect(sceneEl.style.perspective).toBe("2000px");
    });

    it("parses rot-x and rot-y as numbers", () => {
      const el = document.createElement("poly-scene") as PolySceneElement;
      el.setAttribute("rot-x", "30");
      el.setAttribute("rot-y", "60");
      host.appendChild(el);
      const sceneEl = el.querySelector(".polycss-scene") as HTMLElement;
      expect(sceneEl.style.transform).toContain("rotateX(30deg)");
      // rotY in our API maps to CSS rotate() (i.e. rotateZ) so the model
      // spins around its vertical world-Z axis, matching React's PolyCamera.
      expect(sceneEl.style.transform).toContain("rotate(60deg)");
    });

    it("parses zoom as a number", () => {
      const el = document.createElement("poly-scene") as PolySceneElement;
      el.setAttribute("zoom", "1.5");
      host.appendChild(el);
      const sceneEl = el.querySelector(".polycss-scene") as HTMLElement;
      expect(sceneEl.style.transform).toContain("scale(1.5)");
    });

    it("ignores invalid number attribute values", () => {
      const el = document.createElement("poly-scene") as PolySceneElement;
      el.setAttribute("perspective", "not-a-number");
      host.appendChild(el);
      const sceneEl = el.querySelector(".polycss-scene") as HTMLElement;
      // Falls back to default DEFAULT_PERSPECTIVE (8000) — matches
      // React's PolyCamera so the same scene looks the same on both paths.
      expect(sceneEl.style.perspective).toBe("8000px");
    });

    it("parses light-direction as a comma-separated Vec3", () => {
      const el = document.createElement("poly-scene") as PolySceneElement;
      el.setAttribute("light-direction", "1, 0, 0");
      el.setAttribute("light-color", "#ff0000");
      el.setAttribute("light-ambient", "0.5");
      host.appendChild(el);
      // No throw means parse succeeded.
      expect(el.getScene()).not.toBeNull();
    });

    it("ignores malformed light-direction", () => {
      const el = document.createElement("poly-scene") as PolySceneElement;
      el.setAttribute("light-direction", "1, 0");
      host.appendChild(el);
      expect(el.getScene()).not.toBeNull();
    });

    it("accepts merge=auto and merge=off; ignores other values", () => {
      const elA = document.createElement("poly-scene") as PolySceneElement;
      elA.setAttribute("merge", "auto");
      host.appendChild(elA);
      expect(elA.getScene()).not.toBeNull();

      const elB = document.createElement("poly-scene") as PolySceneElement;
      elB.setAttribute("merge", "garbage");
      host.appendChild(elB);
      expect(elB.getScene()).not.toBeNull();
    });

    it("parses projection=cubic and projection=dimetric", () => {
      const el = document.createElement("poly-scene") as PolySceneElement;
      el.setAttribute("projection", "dimetric");
      host.appendChild(el);
      expect(el.getScene()).not.toBeNull();
    });

    it("parses auto-center as a boolean (presence)", () => {
      const el = document.createElement("poly-scene") as PolySceneElement;
      el.setAttribute("auto-center", "");
      host.appendChild(el);
      // Verify autoCenter wrapper exists
      expect(
        el.querySelector("[data-polycss-auto-center-wrapper]"),
      ).not.toBeNull();
    });
  });

  describe("attributeChangedCallback", () => {
    it("re-applies options when an attribute changes", () => {
      const el = document.createElement("poly-scene") as PolySceneElement;
      el.setAttribute("rot-x", "0");
      host.appendChild(el);
      const sceneEl = el.querySelector(".polycss-scene") as HTMLElement;
      const before = sceneEl.style.transform;
      el.setAttribute("rot-x", "90");
      expect(sceneEl.style.transform).not.toBe(before);
      expect(sceneEl.style.transform).toContain("rotateX(90deg)");
    });

    it("noop when oldValue === newValue", () => {
      const el = document.createElement("poly-scene") as PolySceneElement;
      host.appendChild(el);
      // No throw on bogus same-same call
      expect(() =>
        el.attributeChangedCallback("rot-x", null, null),
      ).not.toThrow();
    });

    it("noop when scene is not yet initialized", () => {
      const el = document.createElement("poly-scene") as PolySceneElement;
      // Not connected — no scene
      expect(() =>
        el.attributeChangedCallback("rot-x", "0", "10"),
      ).not.toThrow();
    });
  });
});
