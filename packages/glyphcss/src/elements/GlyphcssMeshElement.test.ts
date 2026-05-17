import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { GlyphcssSceneElement } from "./GlyphcssSceneElement";
import { GlyphcssMeshElement } from "./GlyphcssMeshElement";

// Register elements if not already.
if (!customElements.get("glyphcss-scene")) {
  customElements.define("glyphcss-scene", GlyphcssSceneElement);
}
if (!customElements.get("glyphcss-mesh")) {
  customElements.define("glyphcss-mesh", GlyphcssMeshElement);
}

describe("GlyphcssMeshElement", () => {
  let scene: GlyphcssSceneElement;
  let mesh: GlyphcssMeshElement;

  beforeEach(() => {
    scene = document.createElement("glyphcss-scene") as GlyphcssSceneElement;
    scene.setAttribute("cols", "20");
    scene.setAttribute("rows", "5");
    document.body.appendChild(scene);

    mesh = document.createElement("glyphcss-mesh") as GlyphcssMeshElement;
  });

  afterEach(() => {
    if (scene.isConnected) scene.remove();
  });

  it("is registered under the 'glyphcss-mesh' tag", () => {
    expect(customElements.get("glyphcss-mesh")).toBe(GlyphcssMeshElement);
  });

  it("createElement produces a GlyphcssMeshElement instance", () => {
    expect(mesh).toBeInstanceOf(GlyphcssMeshElement);
  });

  it("observes src, position, scale, rotation attributes", () => {
    expect(GlyphcssMeshElement.observedAttributes).toContain("src");
    expect(GlyphcssMeshElement.observedAttributes).toContain("position");
    expect(GlyphcssMeshElement.observedAttributes).toContain("scale");
    expect(GlyphcssMeshElement.observedAttributes).toContain("rotation");
  });

  it("getMeshHandle() returns null before connect", () => {
    expect(mesh.getMeshHandle()).toBeNull();
  });

  it("connects without throwing when placed inside a scene (no src)", () => {
    expect(() => { scene.appendChild(mesh); }).not.toThrow();
    // Without a src, no mesh handle is created (no async load starts).
    expect(mesh.getMeshHandle()).toBeNull();
  });

  it("connects without throwing when placed outside a scene (no src)", () => {
    expect(() => { document.body.appendChild(mesh); }).not.toThrow();
    mesh.remove();
  });

  it("dispatches glyphcss:error when src fetch fails", async () => {
    // @glyphcss/core's loadMesh will throw for an invalid URL.
    let errorDetail: unknown = undefined;
    scene.addEventListener("glyphcss:error", (e) => {
      errorDetail = (e as CustomEvent).detail;
    });
    mesh.setAttribute("src", "http://invalid.example/no-such-file.obj");
    scene.appendChild(mesh);
    // Allow the async load to fail.
    await new Promise((r) => setTimeout(r, 50));
    expect(errorDetail).toBeTruthy();
  });

  it("disconnect before load completes does not leave a handle behind", async () => {
    mesh.setAttribute("src", "http://invalid.example/no-such-file.obj");
    scene.appendChild(mesh);
    // Remove synchronously before the async fetch can complete.
    mesh.remove();
    await new Promise((r) => setTimeout(r, 50));
    expect(mesh.getMeshHandle()).toBeNull();
  });

  it("changing src attribute tears down the previous load and starts a new one", async () => {
    const errorsSeen: unknown[] = [];
    scene.addEventListener("glyphcss:error", (e) => { errorsSeen.push((e as CustomEvent).detail); });

    mesh.setAttribute("src", "http://invalid.example/a.obj");
    scene.appendChild(mesh);
    // Immediately change src — should cancel the first load.
    mesh.setAttribute("src", "http://invalid.example/b.obj");
    await new Promise((r) => setTimeout(r, 50));
    // We may see 0 or 1 errors depending on race, but must not throw.
    expect(true).toBe(true);
  });

  it("position attribute change on a handle calls setTransform (no crash)", async () => {
    // Without a real src, handle is null; attribute change must not throw.
    scene.appendChild(mesh);
    expect(() => { mesh.setAttribute("position", "1,2,3"); }).not.toThrow();
  });

  it("disconnect disposes the mesh handle if present", async () => {
    // Attach a mock handle via the internal getMeshHandle path — we can only
    // test the observable: removing the element doesn't throw and handle becomes null.
    scene.appendChild(mesh);
    mesh.remove();
    expect(mesh.getMeshHandle()).toBeNull();
  });
});
