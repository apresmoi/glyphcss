import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { GlyphcssSceneElement } from "./GlyphcssSceneElement";
import { GlyphcssMapControlsElement } from "./GlyphcssMapControlsElement";

if (!customElements.get("glyphcss-scene")) {
  customElements.define("glyphcss-scene", GlyphcssSceneElement);
}
if (!customElements.get("glyphcss-map-controls")) {
  customElements.define("glyphcss-map-controls", GlyphcssMapControlsElement);
}

describe("GlyphcssMapControlsElement", () => {
  let sceneEl: GlyphcssSceneElement;
  let controls: GlyphcssMapControlsElement;

  beforeEach(() => {
    sceneEl = document.createElement("glyphcss-scene") as GlyphcssSceneElement;
    sceneEl.setAttribute("cols", "20");
    sceneEl.setAttribute("rows", "5");
    document.body.appendChild(sceneEl);

    controls = document.createElement("glyphcss-map-controls") as GlyphcssMapControlsElement;
  });

  afterEach(() => {
    if (controls.isConnected) controls.remove();
    if (sceneEl.isConnected) sceneEl.remove();
  });

  it("is registered under the 'glyphcss-map-controls' tag", () => {
    expect(customElements.get("glyphcss-map-controls")).toBe(GlyphcssMapControlsElement);
  });

  it("createElement produces a GlyphcssMapControlsElement instance", () => {
    expect(controls).toBeInstanceOf(GlyphcssMapControlsElement);
  });

  it("observes drag, wheel, invert attributes", () => {
    expect(GlyphcssMapControlsElement.observedAttributes).toContain("drag");
    expect(GlyphcssMapControlsElement.observedAttributes).toContain("wheel");
    expect(GlyphcssMapControlsElement.observedAttributes).toContain("invert");
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
    sceneEl.remove();
    const freshScene = document.createElement("glyphcss-scene") as GlyphcssSceneElement;
    freshScene.setAttribute("cols", "10");
    freshScene.setAttribute("rows", "5");
    freshScene.appendChild(controls);
    expect(() => { document.body.appendChild(freshScene); }).not.toThrow();
    freshScene.remove();
  });

  it("invert=true attribute is forwarded without error", () => {
    controls.setAttribute("invert", "true");
    expect(() => { sceneEl.appendChild(controls); }).not.toThrow();
  });
});
