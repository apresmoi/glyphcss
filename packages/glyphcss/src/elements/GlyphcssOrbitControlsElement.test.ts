import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { GlyphcssSceneElement } from "./GlyphcssSceneElement";
import { GlyphcssOrbitControlsElement } from "./GlyphcssOrbitControlsElement";

if (!customElements.get("glyphcss-scene")) {
  customElements.define("glyphcss-scene", GlyphcssSceneElement);
}
if (!customElements.get("glyphcss-orbit-controls")) {
  customElements.define("glyphcss-orbit-controls", GlyphcssOrbitControlsElement);
}

describe("GlyphcssOrbitControlsElement", () => {
  let sceneEl: GlyphcssSceneElement;
  let controls: GlyphcssOrbitControlsElement;

  beforeEach(() => {
    sceneEl = document.createElement("glyphcss-scene") as GlyphcssSceneElement;
    sceneEl.setAttribute("cols", "20");
    sceneEl.setAttribute("rows", "5");
    document.body.appendChild(sceneEl);

    controls = document.createElement("glyphcss-orbit-controls") as GlyphcssOrbitControlsElement;
  });

  afterEach(() => {
    if (controls.isConnected) controls.remove();
    if (sceneEl.isConnected) sceneEl.remove();
  });

  it("is registered under the 'glyphcss-orbit-controls' tag", () => {
    expect(customElements.get("glyphcss-orbit-controls")).toBe(GlyphcssOrbitControlsElement);
  });

  it("createElement produces a GlyphcssOrbitControlsElement instance", () => {
    expect(controls).toBeInstanceOf(GlyphcssOrbitControlsElement);
  });

  it("observes drag, wheel, invert, animate-speed, animate-axis attributes", () => {
    expect(GlyphcssOrbitControlsElement.observedAttributes).toContain("drag");
    expect(GlyphcssOrbitControlsElement.observedAttributes).toContain("wheel");
    expect(GlyphcssOrbitControlsElement.observedAttributes).toContain("invert");
    expect(GlyphcssOrbitControlsElement.observedAttributes).toContain("animate-speed");
    expect(GlyphcssOrbitControlsElement.observedAttributes).toContain("animate-axis");
  });

  it("connects without throwing inside a scene", () => {
    expect(() => { sceneEl.appendChild(controls); }).not.toThrow();
  });

  it("connects without throwing outside a scene (no scene parent)", () => {
    expect(() => { document.body.appendChild(controls); }).not.toThrow();
    controls.remove();
  });

  it("attaches grab cursor style to scene host on connect", () => {
    sceneEl.appendChild(controls);
    // createGlyphcssOrbitControls sets cursor:'grab' on the host when drag is enabled.
    expect(sceneEl.style.cursor).toBe("grab");
  });

  it("drag=false removes grab cursor", () => {
    controls.setAttribute("drag", "false");
    sceneEl.appendChild(controls);
    expect(sceneEl.style.cursor).toBe("");
  });

  it("disconnect cleans up cursor style on scene host", () => {
    sceneEl.appendChild(controls);
    expect(sceneEl.style.cursor).toBe("grab");
    controls.remove();
    expect(sceneEl.style.cursor).toBe("");
  });

  it("attribute change updates controls without throwing", () => {
    sceneEl.appendChild(controls);
    expect(() => { controls.setAttribute("invert", "true"); }).not.toThrow();
  });

  it("waits for glyphcss:scene-ready when attached before scene is ready", () => {
    // Detach scene, create a fresh one (not yet connected) and insert controls first.
    sceneEl.remove();
    const freshScene = document.createElement("glyphcss-scene") as GlyphcssSceneElement;
    freshScene.setAttribute("cols", "10");
    freshScene.setAttribute("rows", "5");
    // Append controls into scene before scene is connected — scene not ready yet.
    freshScene.appendChild(controls);
    // Now connect scene — dispatches glyphcss:scene-ready which controls listens to.
    expect(() => { document.body.appendChild(freshScene); }).not.toThrow();
    freshScene.remove();
  });
});
