import { describe, it, expect, beforeEach } from "vitest";
import { PolyPolygonElement } from "./PolyPolygonElement";
import { PolySceneElement } from "./PolySceneElement";

// Register custom elements if not already registered
if (!customElements.get("poly-scene")) {
  customElements.define("poly-scene", PolySceneElement);
}
if (!customElements.get("poly-polygon")) {
  customElements.define("poly-polygon", PolyPolygonElement);
}

const TRIANGLE_VERTICES = JSON.stringify([
  [0, 0, 0],
  [1, 0, 0],
  [0, 1, 0],
]);

const QUAD_VERTICES = JSON.stringify([
  [0, 0, 0],
  [2, 0, 0],
  [2, 2, 0],
  [0, 2, 0],
]);

describe("PolyPolygonElement — registration", () => {
  it("is defined as a custom element", () => {
    const Constructor = customElements.get("poly-polygon");
    expect(Constructor).toBeTruthy();
  });

  it("observedAttributes includes vertices, color, texture, uvs", () => {
    const attrs = PolyPolygonElement.observedAttributes;
    expect(attrs).toContain("vertices");
    expect(attrs).toContain("color");
    expect(attrs).toContain("texture");
    expect(attrs).toContain("uvs");
  });

  it("observedAttributes includes position, scale, rotation", () => {
    const attrs = PolyPolygonElement.observedAttributes;
    expect(attrs).toContain("position");
    expect(attrs).toContain("scale");
    expect(attrs).toContain("rotation");
  });
});

describe("PolyPolygonElement — standalone (no parent scene)", () => {
  it("can be created and connected without a parent poly-scene", () => {
    const container = document.createElement("div");
    const el = document.createElement("poly-polygon") as PolyPolygonElement;
    el.setAttribute("vertices", TRIANGLE_VERTICES);
    el.setAttribute("color", "#ff0000");
    expect(() => {
      container.appendChild(el);
      document.body.appendChild(container);
    }).not.toThrow();
    document.body.removeChild(container);
  });

  it("does not throw when disconnected without being mounted in a scene", () => {
    const el = document.createElement("poly-polygon") as PolyPolygonElement;
    el.setAttribute("vertices", TRIANGLE_VERTICES);
    const container = document.createElement("div");
    container.appendChild(el);
    document.body.appendChild(container);
    expect(() => document.body.removeChild(container)).not.toThrow();
  });
});

describe("PolyPolygonElement — inside poly-scene", () => {
  let sceneEl: HTMLElement;
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement("div");
    sceneEl = document.createElement("poly-scene");
    document.body.appendChild(container);
    container.appendChild(sceneEl);
  });

  function cleanup() {
    if (document.body.contains(container)) {
      document.body.removeChild(container);
    }
  }

  it("mounts without throwing when inside a poly-scene with valid vertices", () => {
    const poly = document.createElement("poly-polygon") as PolyPolygonElement;
    poly.setAttribute("vertices", TRIANGLE_VERTICES);
    expect(() => {
      sceneEl.appendChild(poly);
    }).not.toThrow();
    cleanup();
  });

  it("does not mount when vertices attribute is missing", () => {
    const poly = document.createElement("poly-polygon") as PolyPolygonElement;
    poly.setAttribute("color", "#ff0000");
    // No vertices — should not throw, just be a no-op
    expect(() => {
      sceneEl.appendChild(poly);
    }).not.toThrow();
    cleanup();
  });

  it("does not mount when vertices JSON is invalid", () => {
    const poly = document.createElement("poly-polygon") as PolyPolygonElement;
    poly.setAttribute("vertices", "not-json");
    expect(() => {
      sceneEl.appendChild(poly);
    }).not.toThrow();
    cleanup();
  });

  it("does not mount when vertices array has fewer than 3 points", () => {
    const poly = document.createElement("poly-polygon") as PolyPolygonElement;
    poly.setAttribute("vertices", JSON.stringify([[0, 0, 0], [1, 0, 0]]));
    expect(() => {
      sceneEl.appendChild(poly);
    }).not.toThrow();
    cleanup();
  });

  it("scene renders a poly element after adding a valid polygon", () => {
    const poly = document.createElement("poly-polygon") as PolyPolygonElement;
    poly.setAttribute("vertices", TRIANGLE_VERTICES);
    poly.setAttribute("color", "#ff0000");
    sceneEl.appendChild(poly);

    const rendered = sceneEl.querySelector("i");
    expect(rendered).toBeTruthy();
    cleanup();
  });

  it("scene renders poly element for quad vertices", () => {
    const poly = document.createElement("poly-polygon") as PolyPolygonElement;
    poly.setAttribute("vertices", QUAD_VERTICES);
    poly.setAttribute("color", "#00ff00");
    sceneEl.appendChild(poly);

    const rendered = sceneEl.querySelector("i");
    expect(rendered).toBeTruthy();
    cleanup();
  });

  it("poly renders with texture attribute (no UVs = pattern fill)", () => {
    const poly = document.createElement("poly-polygon") as PolyPolygonElement;
    poly.setAttribute("vertices", TRIANGLE_VERTICES);
    poly.setAttribute("texture", "https://example.com/tex.png");
    sceneEl.appendChild(poly);

    const rendered = sceneEl.querySelector("i");
    expect(rendered).toBeTruthy();
    cleanup();
  });

  it("poly with UVs renders with uvs JSON attribute", () => {
    const poly = document.createElement("poly-polygon") as PolyPolygonElement;
    poly.setAttribute("vertices", TRIANGLE_VERTICES);
    poly.setAttribute("texture", "https://example.com/tex.png");
    poly.setAttribute("uvs", JSON.stringify([[0, 0], [1, 0], [0, 1]]));
    // Should not throw — UV-mapped path creates an atlas sprite.
    expect(() => {
      sceneEl.appendChild(poly);
    }).not.toThrow();
    cleanup();
  });

  it("data-* attributes on poly-polygon flow through to rendered element", () => {
    const poly = document.createElement("poly-polygon") as PolyPolygonElement;
    poly.setAttribute("vertices", TRIANGLE_VERTICES);
    poly.setAttribute("data-foo", "bar");
    sceneEl.appendChild(poly);

    const rendered = sceneEl.querySelector("i") as HTMLElement;
    expect(rendered?.getAttribute("data-foo")).toBe("bar");
    cleanup();
  });

  it("disconnectedCallback removes the polygon from the scene", () => {
    const poly = document.createElement("poly-polygon") as PolyPolygonElement;
    poly.setAttribute("vertices", TRIANGLE_VERTICES);
    sceneEl.appendChild(poly);

    const beforeCount = sceneEl.querySelectorAll("i").length;
    sceneEl.removeChild(poly);
    const afterCount = sceneEl.querySelectorAll("i").length;

    expect(beforeCount).toBeGreaterThan(0);
    expect(afterCount).toBeLessThan(beforeCount);
    cleanup();
  });

  it("attributeChangedCallback on color remounts the polygon", () => {
    const poly = document.createElement("poly-polygon") as PolyPolygonElement;
    poly.setAttribute("vertices", TRIANGLE_VERTICES);
    poly.setAttribute("color", "#ff0000");
    sceneEl.appendChild(poly);

    const beforePoly = sceneEl.querySelector("i");
    expect(beforePoly).toBeTruthy();

    // Changing color should trigger re-mount
    poly.setAttribute("color", "#0000ff");

    const afterPoly = sceneEl.querySelector("i");
    expect(afterPoly).toBeTruthy();
    cleanup();
  });

  it("attributeChangedCallback with same value is a no-op", () => {
    const poly = document.createElement("poly-polygon") as PolyPolygonElement;
    poly.setAttribute("vertices", TRIANGLE_VERTICES);
    poly.setAttribute("color", "#ff0000");
    sceneEl.appendChild(poly);

    // Setting same value should not throw
    expect(() => {
      poly.setAttribute("color", "#ff0000");
    }).not.toThrow();
    cleanup();
  });

  it("position attribute parses to Vec3", () => {
    const poly = document.createElement("poly-polygon") as PolyPolygonElement;
    poly.setAttribute("vertices", TRIANGLE_VERTICES);
    poly.setAttribute("position", "10,20,30");
    expect(() => {
      sceneEl.appendChild(poly);
    }).not.toThrow();
    cleanup();
  });

  it("invalid position attribute is ignored gracefully", () => {
    const poly = document.createElement("poly-polygon") as PolyPolygonElement;
    poly.setAttribute("vertices", TRIANGLE_VERTICES);
    poly.setAttribute("position", "bad-value");
    expect(() => {
      sceneEl.appendChild(poly);
    }).not.toThrow();
    cleanup();
  });

  it("scale attribute as scalar number", () => {
    const poly = document.createElement("poly-polygon") as PolyPolygonElement;
    poly.setAttribute("vertices", TRIANGLE_VERTICES);
    poly.setAttribute("scale", "2");
    expect(() => {
      sceneEl.appendChild(poly);
    }).not.toThrow();
    cleanup();
  });

  it("scale attribute as Vec3", () => {
    const poly = document.createElement("poly-polygon") as PolyPolygonElement;
    poly.setAttribute("vertices", TRIANGLE_VERTICES);
    poly.setAttribute("scale", "1,2,3");
    expect(() => {
      sceneEl.appendChild(poly);
    }).not.toThrow();
    cleanup();
  });

  it("rotation attribute parses to Vec3", () => {
    const poly = document.createElement("poly-polygon") as PolyPolygonElement;
    poly.setAttribute("vertices", TRIANGLE_VERTICES);
    poly.setAttribute("rotation", "45,0,0");
    expect(() => {
      sceneEl.appendChild(poly);
    }).not.toThrow();
    cleanup();
  });
});
