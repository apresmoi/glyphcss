/**
 * Tests for the helper custom elements — <poly-axes-helper> and
 * <poly-directional-light-helper>. They register themselves with the
 * nearest <poly-scene> via scene.add() and render polygon <i> elements
 * inside a .polycss-mesh wrapper.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PolySceneElement } from "./PolySceneElement";
import { PolyAxesHelperElement } from "./PolyAxesHelperElement";
import { PolyDirectionalLightHelperElement } from "./PolyDirectionalLightHelperElement";

beforeAll(() => {
  if (!customElements.get("poly-scene")) {
    customElements.define("poly-scene", PolySceneElement);
  }
  if (!customElements.get("poly-axes-helper")) {
    customElements.define("poly-axes-helper", PolyAxesHelperElement);
  }
  if (!customElements.get("poly-directional-light-helper")) {
    customElements.define(
      "poly-directional-light-helper",
      PolyDirectionalLightHelperElement,
    );
  }
});

describe("PolyAxesHelperElement", () => {
  let host: HTMLElement;
  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
  });
  afterEach(() => {
    if (host.parentNode) host.parentNode.removeChild(host);
  });

  it("is registered as <poly-axes-helper>", () => {
    expect(customElements.get("poly-axes-helper")).toBe(PolyAxesHelperElement);
  });

  it("renders 18 polygon <i> elements inside the scene's mesh wrapper", () => {
    host.innerHTML = `
      <poly-scene>
        <poly-axes-helper size="4"></poly-axes-helper>
      </poly-scene>
    `;
    const polys = host.querySelectorAll(".polycss-scene .polycss-mesh i");
    expect(polys.length).toBe(18);
  });

  it("does nothing when not nested inside a <poly-scene>", () => {
    host.innerHTML = `<poly-axes-helper></poly-axes-helper>`;
    expect(host.querySelectorAll(".polycss-mesh").length).toBe(0);
  });

  it("removes its mesh on disconnect", () => {
    host.innerHTML = `
      <poly-scene>
        <poly-axes-helper></poly-axes-helper>
      </poly-scene>
    `;
    expect(host.querySelectorAll(".polycss-mesh").length).toBe(1);
    const helper = host.querySelector("poly-axes-helper") as HTMLElement;
    helper.remove();
    expect(host.querySelectorAll(".polycss-mesh").length).toBe(0);
  });
});

describe("PolyDirectionalLightHelperElement", () => {
  let host: HTMLElement;
  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
  });
  afterEach(() => {
    if (host.parentNode) host.parentNode.removeChild(host);
  });

  it("is registered as <poly-directional-light-helper>", () => {
    expect(customElements.get("poly-directional-light-helper")).toBe(
      PolyDirectionalLightHelperElement,
    );
  });

  it("renders 8 polygon <i> elements (octahedron faces) when direction is set", () => {
    host.innerHTML = `
      <poly-scene>
        <poly-directional-light-helper direction="0,0,1"></poly-directional-light-helper>
      </poly-scene>
    `;
    const polys = host.querySelectorAll(".polycss-scene .polycss-mesh i");
    expect(polys.length).toBe(8);
  });

  it("translates the wrapper to direction × distance (with axis swap)", () => {
    host.innerHTML = `
      <poly-scene>
        <poly-directional-light-helper direction="0,0,1" distance="2">
        </poly-directional-light-helper>
      </poly-scene>
    `;
    const wrapper = host.querySelector(".polycss-mesh") as HTMLElement;
    // direction=(0,0,1) × distance=2 → world (0,0,2). CSS-z = world-Z*TILE = 100.
    expect(wrapper.style.transform).toContain("translate3d(0px, 0px, 100px)");
  });

  it("respects the `target` attribute as the orbit center", () => {
    host.innerHTML = `
      <poly-scene>
        <poly-directional-light-helper
          direction="0,0,1"
          target="1,2,3"
          distance="1">
        </poly-directional-light-helper>
      </poly-scene>
    `;
    const wrapper = host.querySelector(".polycss-mesh") as HTMLElement;
    // target=(1,2,3), dir*1=(0,0,1) → world=(1,2,4); CSS=(worldY*50, worldX*50, worldZ*50).
    expect(wrapper.style.transform).toContain("translate3d(100px, 50px, 200px)");
  });

  it("does nothing when not nested inside a <poly-scene>", () => {
    host.innerHTML = `<poly-directional-light-helper direction="0,0,1"></poly-directional-light-helper>`;
    expect(host.querySelectorAll(".polycss-mesh").length).toBe(0);
  });
});
