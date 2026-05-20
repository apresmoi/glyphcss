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
  let camEl: GlyphOrthographicCameraElement;
  let sceneEl: GlyphSceneElement;

  beforeEach(() => {
    camEl = document.createElement("glyph-orthographic-camera") as GlyphOrthographicCameraElement;
    sceneEl = document.createElement("glyph-scene") as GlyphSceneElement;
    sceneEl.setAttribute("cols", "20");
    sceneEl.setAttribute("rows", "5");
    camEl.appendChild(sceneEl);
  });

  afterEach(() => {
    if (camEl.isConnected) camEl.remove();
  });

  it("is registered under the 'glyph-orthographic-camera' tag", () => {
    expect(customElements.get("glyph-orthographic-camera")).toBe(GlyphOrthographicCameraElement);
  });

  it("createElement produces a GlyphOrthographicCameraElement instance", () => {
    expect(camEl).toBeInstanceOf(GlyphOrthographicCameraElement);
  });

  it("observes rot-x, rot-y, zoom attributes", () => {
    expect(GlyphOrthographicCameraElement.observedAttributes).toContain("rot-x");
    expect(GlyphOrthographicCameraElement.observedAttributes).toContain("rot-y");
    expect(GlyphOrthographicCameraElement.observedAttributes).toContain("zoom");
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

  it("scene is created with orthographic camera", () => {
    document.body.appendChild(camEl);
    expect(sceneEl.getScene()!.camera.kind).toBe("orthographic");
  });

  it("applies rot-x attribute to camera", () => {
    camEl.setAttribute("rot-x", "0.4");
    document.body.appendChild(camEl);
    expect(camEl.getCamera()!.rotX).toBeCloseTo(0.4, 5);
  });

  it("applies rot-y attribute to camera", () => {
    camEl.setAttribute("rot-y", "0.9");
    document.body.appendChild(camEl);
    expect(camEl.getCamera()!.rotY).toBeCloseTo(0.9, 5);
  });

  it("applies zoom attribute to camera", () => {
    camEl.setAttribute("zoom", "0.7");
    document.body.appendChild(camEl);
    expect(camEl.getCamera()!.zoom).toBeCloseTo(0.7, 5);
  });

  it("changing rot-y attribute updates camera", () => {
    document.body.appendChild(camEl);
    camEl.setAttribute("rot-y", "1.5");
    expect(camEl.getCamera()!.rotY).toBeCloseTo(1.5, 5);
  });

  it("attribute change before connect is a no-op (no throw)", () => {
    expect(() => { camEl.setAttribute("zoom", "2.0"); }).not.toThrow();
  });

  it("invalid zoom value is ignored gracefully", () => {
    camEl.setAttribute("zoom", "bad");
    expect(() => { document.body.appendChild(camEl); }).not.toThrow();
  });

  it("disconnects cleanly", () => {
    document.body.appendChild(camEl);
    expect(camEl.getCamera()).not.toBeNull();
    camEl.remove();
    expect(camEl.getCamera()).toBeNull();
  });
});
