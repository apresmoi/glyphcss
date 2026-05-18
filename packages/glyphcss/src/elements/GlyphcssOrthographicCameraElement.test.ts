import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { GlyphcssSceneElement } from "./GlyphcssSceneElement";
import { GlyphcssOrthographicCameraElement } from "./GlyphcssOrthographicCameraElement";

if (!customElements.get("glyphcss-scene")) {
  customElements.define("glyphcss-scene", GlyphcssSceneElement);
}
if (!customElements.get("glyphcss-orthographic-camera")) {
  customElements.define("glyphcss-orthographic-camera", GlyphcssOrthographicCameraElement);
}

describe("GlyphcssOrthographicCameraElement", () => {
  let sceneEl: GlyphcssSceneElement;
  let cam: GlyphcssOrthographicCameraElement;

  beforeEach(() => {
    sceneEl = document.createElement("glyphcss-scene") as GlyphcssSceneElement;
    sceneEl.setAttribute("cols", "20");
    sceneEl.setAttribute("rows", "5");
    document.body.appendChild(sceneEl);

    cam = document.createElement("glyphcss-orthographic-camera") as GlyphcssOrthographicCameraElement;
  });

  afterEach(() => {
    if (cam.isConnected) cam.remove();
    if (sceneEl.isConnected) sceneEl.remove();
  });

  it("is registered under the 'glyphcss-orthographic-camera' tag", () => {
    expect(customElements.get("glyphcss-orthographic-camera")).toBe(GlyphcssOrthographicCameraElement);
  });

  it("createElement produces a GlyphcssOrthographicCameraElement instance", () => {
    expect(cam).toBeInstanceOf(GlyphcssOrthographicCameraElement);
  });

  it("observes rot-x, rot-y, zoom attributes", () => {
    expect(GlyphcssOrthographicCameraElement.observedAttributes).toContain("rot-x");
    expect(GlyphcssOrthographicCameraElement.observedAttributes).toContain("rot-y");
    expect(GlyphcssOrthographicCameraElement.observedAttributes).toContain("zoom");
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
    // createGlyphcssOrthographicCamera maps zoom→scale.
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
