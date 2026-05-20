import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { GlyphSceneElement } from "./GlyphSceneElement";
import { GlyphOrbitControlsElement } from "./GlyphOrbitControlsElement";

if (!customElements.get("glyph-scene")) {
  customElements.define("glyph-scene", GlyphSceneElement);
}
if (!customElements.get("glyph-orbit-controls")) {
  customElements.define("glyph-orbit-controls", GlyphOrbitControlsElement);
}

describe("GlyphOrbitControlsElement", () => {
  let sceneEl: GlyphSceneElement;
  let controls: GlyphOrbitControlsElement;

  beforeEach(() => {
    sceneEl = document.createElement("glyph-scene") as GlyphSceneElement;
    sceneEl.setAttribute("cols", "20");
    sceneEl.setAttribute("rows", "5");
    document.body.appendChild(sceneEl);

    controls = document.createElement("glyph-orbit-controls") as GlyphOrbitControlsElement;
  });

  afterEach(() => {
    if (controls.isConnected) controls.remove();
    if (sceneEl.isConnected) sceneEl.remove();
  });

  it("is registered under the 'glyph-orbit-controls' tag", () => {
    expect(customElements.get("glyph-orbit-controls")).toBe(GlyphOrbitControlsElement);
  });

  it("createElement produces a GlyphOrbitControlsElement instance", () => {
    expect(controls).toBeInstanceOf(GlyphOrbitControlsElement);
  });

  it("observes drag, wheel, invert, animate-speed, animate-axis attributes", () => {
    expect(GlyphOrbitControlsElement.observedAttributes).toContain("drag");
    expect(GlyphOrbitControlsElement.observedAttributes).toContain("wheel");
    expect(GlyphOrbitControlsElement.observedAttributes).toContain("invert");
    expect(GlyphOrbitControlsElement.observedAttributes).toContain("animate-speed");
    expect(GlyphOrbitControlsElement.observedAttributes).toContain("animate-axis");
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
    // createGlyphOrbitControls sets cursor:'grab' on the host when drag is enabled.
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
    const freshScene = document.createElement("glyph-scene") as GlyphSceneElement;
    freshScene.setAttribute("cols", "10");
    freshScene.setAttribute("rows", "5");
    // Append controls into scene before scene is connected — scene not ready yet.
    freshScene.appendChild(controls);
    // Now connect scene — dispatches glyphcss:scene-ready which controls listens to.
    expect(() => { document.body.appendChild(freshScene); }).not.toThrow();
    freshScene.remove();
  });
});
