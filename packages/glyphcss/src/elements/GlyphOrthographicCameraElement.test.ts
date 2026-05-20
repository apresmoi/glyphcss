import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { GlyphSceneElement } from "./GlyphSceneElement";
import { GlyphOrthographicCameraElement } from "./GlyphOrthographicCameraElement";

if (!customElements.get("glyph-scene")) {
  customElements.define("glyph-scene", GlyphSceneElement);
}
if (!customElements.get("glyph-orthographic-camera")) {
  customElements.define("glyph-orthographic-camera", GlyphOrthographicCameraElement);
}

describe("GlyphOrthographicCameraElement", () => {
  let sceneEl: GlyphSceneElement;
  let cam: GlyphOrthographicCameraElement;

  beforeEach(() => {
    sceneEl = document.createElement("glyph-scene") as GlyphSceneElement;
    sceneEl.setAttribute("cols", "20");
    sceneEl.setAttribute("rows", "5");
    document.body.appendChild(sceneEl);

    cam = document.createElement("glyph-orthographic-camera") as GlyphOrthographicCameraElement;
  });

  afterEach(() => {
    if (cam.isConnected) cam.remove();
    if (sceneEl.isConnected) sceneEl.remove();
  });

  it("is registered under the 'glyph-orthographic-camera' tag", () => {
    expect(customElements.get("glyph-orthographic-camera")).toBe(GlyphOrthographicCameraElement);
  });

  it("createElement produces a GlyphOrthographicCameraElement instance", () => {
    expect(cam).toBeInstanceOf(GlyphOrthographicCameraElement);
  });

  it("observes rot-x, rot-y, zoom attributes", () => {
    expect(GlyphOrthographicCameraElement.observedAttributes).toContain("rot-x");
    expect(GlyphOrthographicCameraElement.observedAttributes).toContain("rot-y");
    expect(GlyphOrthographicCameraElement.observedAttributes).toContain("zoom");
  });

  it("connects without throwing inside a scene", () => {
    expect(() => { sceneEl.appendChild(cam); }).not.toThrow();
  });

  it("connects without throwing outside a scene", () => {
    expect(() => { document.body.appendChild(cam); }).not.toThrow();
    cam.remove();
  });

  it("replaces the scene camera with an orthographic camera on connect", () => {
    sceneEl.appendChild(cam);
    expect(sceneEl.getScene()!.camera.kind).toBe("orthographic");
  });

  it("applies rot-x attribute to scene camera", () => {
    cam.setAttribute("rot-x", "0.4");
    sceneEl.appendChild(cam);
    expect(sceneEl.getScene()!.camera.rotX).toBeCloseTo(0.4, 5);
  });

  it("applies rot-y attribute to scene camera", () => {
    cam.setAttribute("rot-y", "0.9");
    sceneEl.appendChild(cam);
    expect(sceneEl.getScene()!.camera.rotY).toBeCloseTo(0.9, 5);
  });

  it("applies zoom as the camera scale", () => {
    // createGlyphOrthographicCamera maps zoom→scale.
    cam.setAttribute("zoom", "0.7");
    sceneEl.appendChild(cam);
    expect(sceneEl.getScene()!.camera.zoom).toBeCloseTo(0.7, 5);
  });

  it("changing rot-y attribute updates camera", () => {
    sceneEl.appendChild(cam);
    cam.setAttribute("rot-y", "1.5");
    expect(sceneEl.getScene()!.camera.rotY).toBeCloseTo(1.5, 5);
  });

  it("attribute change without scene parent is a no-op (no throw)", () => {
    expect(() => { cam.setAttribute("zoom", "2.0"); }).not.toThrow();
  });

  it("invalid zoom value is ignored gracefully", () => {
    cam.setAttribute("zoom", "bad");
    expect(() => { sceneEl.appendChild(cam); }).not.toThrow();
  });
});
