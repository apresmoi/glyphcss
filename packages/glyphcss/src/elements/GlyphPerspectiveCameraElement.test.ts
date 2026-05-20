import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { GlyphSceneElement } from "./GlyphSceneElement";
import { GlyphPerspectiveCameraElement } from "./GlyphPerspectiveCameraElement";

if (!customElements.get("glyph-scene")) {
  customElements.define("glyph-scene", GlyphSceneElement);
}
if (!customElements.get("glyph-perspective-camera")) {
  customElements.define("glyph-perspective-camera", GlyphPerspectiveCameraElement);
}

describe("GlyphPerspectiveCameraElement", () => {
  let camEl: GlyphPerspectiveCameraElement;
  let sceneEl: GlyphSceneElement;

  beforeEach(() => {
    camEl = document.createElement("glyph-perspective-camera") as GlyphPerspectiveCameraElement;
    sceneEl = document.createElement("glyph-scene") as GlyphSceneElement;
    sceneEl.setAttribute("cols", "20");
    sceneEl.setAttribute("rows", "5");
    camEl.appendChild(sceneEl);
  });

  afterEach(() => {
    if (camEl.isConnected) camEl.remove();
  });

  it("is registered under the 'glyph-perspective-camera' tag", () => {
    expect(customElements.get("glyph-perspective-camera")).toBe(GlyphPerspectiveCameraElement);
  });

  it("createElement produces a GlyphPerspectiveCameraElement instance", () => {
    expect(camEl).toBeInstanceOf(GlyphPerspectiveCameraElement);
  });

  it("observes rot-x, rot-y, distance, zoom, stretch attributes", () => {
    expect(GlyphPerspectiveCameraElement.observedAttributes).toContain("rot-x");
    expect(GlyphPerspectiveCameraElement.observedAttributes).toContain("rot-y");
    expect(GlyphPerspectiveCameraElement.observedAttributes).toContain("distance");
    expect(GlyphPerspectiveCameraElement.observedAttributes).toContain("zoom");
    expect(GlyphPerspectiveCameraElement.observedAttributes).toContain("stretch");
  });

  it("getCamera() returns null before connect", () => {
    expect(camEl.getCamera()).toBeNull();
  });

  it("connects without throwing", () => {
    expect(() => { document.body.appendChild(camEl); }).not.toThrow();
  });

  it("getCamera() is non-null after connect", () => {
    document.body.appendChild(camEl);
    expect(camEl.getCamera()).not.toBeNull();
  });

  it("dispatches glyph:camera-ready on connect", () => {
    let fired = false;
    camEl.addEventListener("glyph:camera-ready", () => { fired = true; });
    document.body.appendChild(camEl);
    expect(fired).toBe(true);
  });

  it("scene is created with correct camera kind", () => {
    document.body.appendChild(camEl);
    expect(sceneEl.getScene()!.camera.kind).toBe("perspective");
  });

  it("applies rot-x attribute to camera on connect", () => {
    camEl.setAttribute("rot-x", "0.5");
    document.body.appendChild(camEl);
    expect(camEl.getCamera()!.rotX).toBeCloseTo(0.5, 5);
  });

  it("applies rot-y attribute to camera on connect", () => {
    camEl.setAttribute("rot-y", "1.2");
    document.body.appendChild(camEl);
    expect(camEl.getCamera()!.rotY).toBeCloseTo(1.2, 5);
  });

  it("applies distance attribute to camera", () => {
    camEl.setAttribute("distance", "5");
    document.body.appendChild(camEl);
    expect(camEl.getCamera()!.distance).toBeCloseTo(5, 5);
  });

  it("applies zoom attribute to camera", () => {
    camEl.setAttribute("zoom", "0.6");
    document.body.appendChild(camEl);
    expect(camEl.getCamera()!.zoom).toBeCloseTo(0.6, 5);
  });

  it("changing rot-x attribute updates camera", () => {
    document.body.appendChild(camEl);
    camEl.setAttribute("rot-x", "0.3");
    expect(camEl.getCamera()!.rotX).toBeCloseTo(0.3, 5);
  });

  it("attribute change before connect is a no-op (no throw)", () => {
    expect(() => { camEl.setAttribute("rot-x", "1.0"); }).not.toThrow();
  });

  it("invalid numeric attribute (NaN) is ignored gracefully", () => {
    camEl.setAttribute("rot-x", "not-a-number");
    expect(() => { document.body.appendChild(camEl); }).not.toThrow();
  });

  it("disconnects cleanly", () => {
    document.body.appendChild(camEl);
    expect(camEl.getCamera()).not.toBeNull();
    camEl.remove();
    expect(camEl.getCamera()).toBeNull();
  });
});
