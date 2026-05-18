import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { GlyphcssSceneElement } from "./GlyphcssSceneElement";
import { GlyphcssPerspectiveCameraElement } from "./GlyphcssPerspectiveCameraElement";

if (!customElements.get("glyphcss-scene")) {
  customElements.define("glyphcss-scene", GlyphcssSceneElement);
}
if (!customElements.get("glyphcss-perspective-camera")) {
  customElements.define("glyphcss-perspective-camera", GlyphcssPerspectiveCameraElement);
}

describe("GlyphcssPerspectiveCameraElement", () => {
  let sceneEl: GlyphcssSceneElement;
  let cam: GlyphcssPerspectiveCameraElement;

  beforeEach(() => {
    sceneEl = document.createElement("glyphcss-scene") as GlyphcssSceneElement;
    sceneEl.setAttribute("cols", "20");
    sceneEl.setAttribute("rows", "5");
    document.body.appendChild(sceneEl);

    cam = document.createElement("glyphcss-perspective-camera") as GlyphcssPerspectiveCameraElement;
  });

  afterEach(() => {
    if (cam.isConnected) cam.remove();
    if (sceneEl.isConnected) sceneEl.remove();
  });

  it("is registered under the 'glyphcss-perspective-camera' tag", () => {
    expect(customElements.get("glyphcss-perspective-camera")).toBe(GlyphcssPerspectiveCameraElement);
  });

  it("createElement produces a GlyphcssPerspectiveCameraElement instance", () => {
    expect(cam).toBeInstanceOf(GlyphcssPerspectiveCameraElement);
  });

  it("observes rot-x, rot-y, distance, zoom, stretch attributes", () => {
    expect(GlyphcssPerspectiveCameraElement.observedAttributes).toContain("rot-x");
    expect(GlyphcssPerspectiveCameraElement.observedAttributes).toContain("rot-y");
    expect(GlyphcssPerspectiveCameraElement.observedAttributes).toContain("distance");
    expect(GlyphcssPerspectiveCameraElement.observedAttributes).toContain("zoom");
    expect(GlyphcssPerspectiveCameraElement.observedAttributes).toContain("stretch");
  });

  it("connects without throwing inside a scene", () => {
    expect(() => { sceneEl.appendChild(cam); }).not.toThrow();
  });

  it("connects without throwing outside a scene (no-op silently)", () => {
    expect(() => { document.body.appendChild(cam); }).not.toThrow();
    cam.remove();
  });

  it("applies rot-x attribute to scene camera on connect", () => {
    cam.setAttribute("rot-x", "0.5");
    sceneEl.appendChild(cam);
    const scene = sceneEl.getScene();
    expect(scene).not.toBeNull();
    // The camera kind should be perspective (the element replaced the default one).
    expect(scene!.camera.kind).toBe("perspective");
    expect(scene!.camera.rotX).toBeCloseTo(0.5, 5);
  });

  it("applies rot-y attribute to scene camera on connect", () => {
    cam.setAttribute("rot-y", "1.2");
    sceneEl.appendChild(cam);
    const scene = sceneEl.getScene();
    expect(scene!.camera.rotY).toBeCloseTo(1.2, 5);
  });

  it("applies distance attribute to scene camera", () => {
    cam.setAttribute("distance", "5");
    sceneEl.appendChild(cam);
    expect(sceneEl.getScene()!.camera.distance).toBeCloseTo(5, 5);
  });

  it("applies zoom attribute to scene camera", () => {
    cam.setAttribute("zoom", "0.6");
    sceneEl.appendChild(cam);
    expect(sceneEl.getScene()!.camera.zoom).toBeCloseTo(0.6, 5);
  });

  it("changing rot-x attribute updates camera", () => {
    sceneEl.appendChild(cam);
    cam.setAttribute("rot-x", "0.3");
    expect(sceneEl.getScene()!.camera.rotX).toBeCloseTo(0.3, 5);
  });

  it("attribute change is no-op when not inside a scene", () => {
    // cam is not in the DOM — should not throw.
    expect(() => { cam.setAttribute("rot-x", "1.0"); }).not.toThrow();
  });

  it("invalid numeric attribute (NaN) is ignored gracefully", () => {
    cam.setAttribute("rot-x", "not-a-number");
    expect(() => { sceneEl.appendChild(cam); }).not.toThrow();
  });
});
