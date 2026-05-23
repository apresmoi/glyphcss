import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { GlyphSceneElement } from "./GlyphSceneElement";
import { GlyphMapControlsElement } from "./GlyphMapControlsElement";
import { GlyphPerspectiveCameraElement } from "./GlyphPerspectiveCameraElement";

if (!customElements.get("glyph-scene")) {
  customElements.define("glyph-scene", GlyphSceneElement);
}
if (!customElements.get("glyph-map-controls")) {
  customElements.define("glyph-map-controls", GlyphMapControlsElement);
}
if (!customElements.get("glyph-perspective-camera")) {
  customElements.define("glyph-perspective-camera", GlyphPerspectiveCameraElement);
}

describe("GlyphMapControlsElement", () => {
  let camEl: GlyphPerspectiveCameraElement;
  let sceneEl: GlyphSceneElement;
  let controls: GlyphMapControlsElement;

  beforeEach(() => {
    camEl = document.createElement("glyph-perspective-camera") as GlyphPerspectiveCameraElement;
    sceneEl = document.createElement("glyph-scene") as GlyphSceneElement;
    sceneEl.setAttribute("cols", "20");
    sceneEl.setAttribute("rows", "5");
    camEl.appendChild(sceneEl);
    document.body.appendChild(camEl);

    controls = document.createElement("glyph-map-controls") as GlyphMapControlsElement;
  });

  afterEach(() => {
    if (controls.isConnected) controls.remove();
    if (camEl.isConnected) camEl.remove();
  });

  it("is registered under the 'glyph-map-controls' tag", () => {
    expect(customElements.get("glyph-map-controls")).toBe(GlyphMapControlsElement);
  });

  it("createElement produces a GlyphMapControlsElement instance", () => {
    expect(controls).toBeInstanceOf(GlyphMapControlsElement);
  });

  it("observes drag, wheel, invert attributes", () => {
    expect(GlyphMapControlsElement.observedAttributes).toContain("drag");
    expect(GlyphMapControlsElement.observedAttributes).toContain("wheel");
    expect(GlyphMapControlsElement.observedAttributes).toContain("invert");
  });

  it("connects without throwing inside a scene", () => {
    expect(() => { sceneEl.appendChild(controls); }).not.toThrow();
  });

  it("connects without throwing outside a scene", () => {
    expect(() => { document.body.appendChild(controls); }).not.toThrow();
    controls.remove();
  });

  it("attaches grab cursor style to scene host on connect", () => {
    sceneEl.appendChild(controls);
    expect(sceneEl.style.cursor).toBe("grab");
  });

  it("drag=false omits grab cursor", () => {
    controls.setAttribute("drag", "false");
    sceneEl.appendChild(controls);
    expect(sceneEl.style.cursor).toBe("");
  });

  it("disconnect cleans up cursor on scene host", () => {
    sceneEl.appendChild(controls);
    expect(sceneEl.style.cursor).toBe("grab");
    controls.remove();
    expect(sceneEl.style.cursor).toBe("");
  });

  it("attribute change updates controls without throwing", () => {
    sceneEl.appendChild(controls);
    expect(() => { controls.setAttribute("wheel", "false"); }).not.toThrow();
  });

  it("waits for glyphcss:scene-ready when connected before scene is ready", () => {
    const freshCam = document.createElement("glyph-perspective-camera") as GlyphPerspectiveCameraElement;
    const freshScene = document.createElement("glyph-scene") as GlyphSceneElement;
    freshScene.setAttribute("cols", "10");
    freshScene.setAttribute("rows", "5");
    freshCam.appendChild(freshScene);
    freshScene.appendChild(controls);
    expect(() => { document.body.appendChild(freshCam); }).not.toThrow();
    freshCam.remove();
  });

  it("invert=true attribute is forwarded without error", () => {
    controls.setAttribute("invert", "true");
    expect(() => { sceneEl.appendChild(controls); }).not.toThrow();
  });
});
