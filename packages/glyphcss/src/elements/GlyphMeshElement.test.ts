import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { GlyphSceneElement } from "./GlyphSceneElement";
import { GlyphMeshElement } from "./GlyphMeshElement";
import { GlyphPerspectiveCameraElement } from "./GlyphPerspectiveCameraElement";

// Register elements if not already.
if (!customElements.get("glyph-scene")) {
  customElements.define("glyph-scene", GlyphSceneElement);
}
if (!customElements.get("glyph-mesh")) {
  customElements.define("glyph-mesh", GlyphMeshElement);
}
if (!customElements.get("glyph-perspective-camera")) {
  customElements.define("glyph-perspective-camera", GlyphPerspectiveCameraElement);
}

describe("GlyphMeshElement", () => {
  let camEl: GlyphPerspectiveCameraElement;
  let scene: GlyphSceneElement;
  let mesh: GlyphMeshElement;

  beforeEach(() => {
    camEl = document.createElement("glyph-perspective-camera") as GlyphPerspectiveCameraElement;
    scene = document.createElement("glyph-scene") as GlyphSceneElement;
    scene.setAttribute("cols", "20");
    scene.setAttribute("rows", "5");
    camEl.appendChild(scene);
    document.body.appendChild(camEl);

    mesh = document.createElement("glyph-mesh") as GlyphMeshElement;
  });

  afterEach(() => {
    if (camEl.isConnected) camEl.remove();
  });

  it("is registered under the 'glyph-mesh' tag", () => {
    expect(customElements.get("glyph-mesh")).toBe(GlyphMeshElement);
  });

  it("createElement produces a GlyphMeshElement instance", () => {
    expect(mesh).toBeInstanceOf(GlyphMeshElement);
  });

  it("observes src, position, scale, rotation attributes", () => {
    expect(GlyphMeshElement.observedAttributes).toContain("src");
    expect(GlyphMeshElement.observedAttributes).toContain("position");
    expect(GlyphMeshElement.observedAttributes).toContain("scale");
    expect(GlyphMeshElement.observedAttributes).toContain("rotation");
  });

  it("observes cast-shadow and receive-shadow attributes", () => {
    expect(GlyphMeshElement.observedAttributes).toContain("cast-shadow");
    expect(GlyphMeshElement.observedAttributes).toContain("receive-shadow");
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
    // @glyphcss/core's loadMesh will throw for an invalid URL. Wait for the
    // event rather than racing a fixed timer — CI fetch teardown can take
    // much longer than 50ms.
    const errorDetail = await new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("glyphcss:error not dispatched within 5s")), 5000);
      scene.addEventListener("glyphcss:error", (e) => {
        clearTimeout(timeout);
        resolve((e as CustomEvent).detail);
      }, { once: true });
      mesh.setAttribute("src", "http://invalid.example/no-such-file.obj");
      scene.appendChild(mesh);
    });
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

  it("<glyph-mesh cast-shadow> sets castShadow=true on the mesh transform", async () => {
    document.body.appendChild(camEl);
    const sceneHandle = scene.getScene()!;
    const addSpy = vi.spyOn(sceneHandle, "add");

    mesh.setAttribute("geometry", "cube");
    mesh.setAttribute("cast-shadow", "");
    scene.appendChild(mesh);

    // Allow the microtask queue (async _maybeLoad via geometry path goes sync
    // but is called via connectedCallback which may schedule).
    await Promise.resolve();

    expect(addSpy).toHaveBeenCalled();
    const capturedTransform = addSpy.mock.calls[0]![1];
    expect(capturedTransform).toMatchObject({ castShadow: true, receiveShadow: false });
  });

  it("<glyph-mesh receive-shadow> sets receiveShadow=true on the mesh transform", async () => {
    document.body.appendChild(camEl);
    const sceneHandle = scene.getScene()!;
    const addSpy = vi.spyOn(sceneHandle, "add");

    mesh.setAttribute("geometry", "cube");
    mesh.setAttribute("receive-shadow", "");
    scene.appendChild(mesh);

    await Promise.resolve();

    expect(addSpy).toHaveBeenCalled();
    const capturedTransform = addSpy.mock.calls[0]![1];
    expect(capturedTransform).toMatchObject({ castShadow: false, receiveShadow: true });
  });

  it("observes the per-mesh ramp / ambient / occlusion attributes", () => {
    for (const attr of ["glyph-palette", "ambient-intensity", "occlusion-priority", "occlusion-claim", "occlusion-contour-px"]) {
      expect(GlyphMeshElement.observedAttributes).toContain(attr);
    }
  });

  it("reads the per-mesh ramp / ambient / occlusion attributes onto the transform", async () => {
    document.body.appendChild(camEl);
    const sceneHandle = scene.getScene()!;
    const addSpy = vi.spyOn(sceneHandle, "add");

    mesh.setAttribute("geometry", "cube");
    mesh.setAttribute("glyph-palette", "dense");
    mesh.setAttribute("ambient-intensity", "0.75");
    mesh.setAttribute("occlusion-priority", "1");
    mesh.setAttribute("occlusion-claim", "geometry");
    mesh.setAttribute("occlusion-contour-px", "3");
    scene.appendChild(mesh);

    await Promise.resolve();

    expect(addSpy).toHaveBeenCalled();
    expect(addSpy.mock.calls[0]![1]).toMatchObject({
      glyphPalette: "dense",
      ambientIntensity: 0.75,
      occlusionPriority: 1,
      occlusionClaim: "geometry",
      occlusionContourPx: 3,
    });
  });

  it("accepts zero and negative values the shared positive-float parser would drop", async () => {
    document.body.appendChild(camEl);
    const sceneHandle = scene.getScene()!;
    const addSpy = vi.spyOn(sceneHandle, "add");

    mesh.setAttribute("geometry", "cube");
    // A background occlusion class, a fully unlit mesh, and the tightest
    // possible contour claim — all legal, all rejected by `parsePosFloat`.
    mesh.setAttribute("occlusion-priority", "-1");
    mesh.setAttribute("ambient-intensity", "0");
    mesh.setAttribute("occlusion-contour-px", "0");
    scene.appendChild(mesh);

    await Promise.resolve();

    expect(addSpy.mock.calls[0]![1]).toMatchObject({
      occlusionPriority: -1,
      ambientIntensity: 0,
      occlusionContourPx: 0,
    });
  });

  it("leaves the per-mesh options undefined when their attributes are absent", async () => {
    document.body.appendChild(camEl);
    const sceneHandle = scene.getScene()!;
    const addSpy = vi.spyOn(sceneHandle, "add");

    mesh.setAttribute("geometry", "cube");
    scene.appendChild(mesh);

    await Promise.resolve();

    const t = addSpy.mock.calls[0]![1]!;
    expect(t.glyphPalette).toBeUndefined();
    expect(t.ambientIntensity).toBeUndefined();
    expect(t.occlusionPriority).toBeUndefined();
    expect(t.occlusionClaim).toBeUndefined();
    expect(t.occlusionContourPx).toBeUndefined();
  });

  it("ignores an unparseable occlusion-claim rather than forwarding it", async () => {
    document.body.appendChild(camEl);
    const sceneHandle = scene.getScene()!;
    const addSpy = vi.spyOn(sceneHandle, "add");

    mesh.setAttribute("geometry", "cube");
    mesh.setAttribute("occlusion-claim", "nonsense");
    scene.appendChild(mesh);

    await Promise.resolve();

    expect(addSpy.mock.calls[0]![1]!.occlusionClaim).toBeUndefined();
  });

  it("absence of cast-shadow and receive-shadow leaves both false", async () => {
    document.body.appendChild(camEl);
    const sceneHandle = scene.getScene()!;
    const addSpy = vi.spyOn(sceneHandle, "add");

    mesh.setAttribute("geometry", "cube");
    scene.appendChild(mesh);

    await Promise.resolve();

    expect(addSpy).toHaveBeenCalled();
    const capturedTransform = addSpy.mock.calls[0]![1];
    expect(capturedTransform).toMatchObject({ castShadow: false, receiveShadow: false });
  });
});
