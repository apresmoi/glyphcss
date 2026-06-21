import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { GlyphSceneElement } from "./GlyphSceneElement";
import { GlyphFirstPersonControlsElement } from "./GlyphFirstPersonControlsElement";
import { GlyphPerspectiveCameraElement } from "./GlyphPerspectiveCameraElement";

if (!customElements.get("glyph-scene")) {
  customElements.define("glyph-scene", GlyphSceneElement);
}
if (!customElements.get("glyph-first-person-controls")) {
  customElements.define("glyph-first-person-controls", GlyphFirstPersonControlsElement);
}
if (!customElements.get("glyph-perspective-camera")) {
  customElements.define("glyph-perspective-camera", GlyphPerspectiveCameraElement);
}

describe("GlyphFirstPersonControlsElement", () => {
  let camEl: GlyphPerspectiveCameraElement;
  let sceneEl: GlyphSceneElement;
  let controls: GlyphFirstPersonControlsElement;

  beforeEach(() => {
    camEl = document.createElement("glyph-perspective-camera") as GlyphPerspectiveCameraElement;
    sceneEl = document.createElement("glyph-scene") as GlyphSceneElement;
    sceneEl.setAttribute("cols", "20");
    sceneEl.setAttribute("rows", "5");
    camEl.appendChild(sceneEl);
    document.body.appendChild(camEl);
    controls = document.createElement("glyph-first-person-controls") as GlyphFirstPersonControlsElement;
  });

  afterEach(() => {
    if (controls.isConnected) controls.remove();
    if (camEl.isConnected) camEl.remove();
  });

  it("is registered under the 'glyph-first-person-controls' tag", () => {
    expect(customElements.get("glyph-first-person-controls")).toBe(GlyphFirstPersonControlsElement);
  });

  it("createElement produces a GlyphFirstPersonControlsElement instance", () => {
    expect(controls).toBeInstanceOf(GlyphFirstPersonControlsElement);
  });

  it("declares the documented observed attributes", () => {
    const attrs = GlyphFirstPersonControlsElement.observedAttributes;
    for (const a of ["look-enabled", "move-enabled", "jump-enabled", "crouch-enabled", "move-speed", "eye-height", "look-sensitivity"]) {
      expect(attrs).toContain(a);
    }
  });

  it("connects without throwing inside a perspective scene", () => {
    expect(() => { sceneEl.appendChild(controls); }).not.toThrow();
  });

  it("no-ops (does not throw) when connected outside a scene", () => {
    expect(() => { document.body.appendChild(controls); }).not.toThrow();
    controls.remove();
  });

  it("disconnectedCallback cleans up without throwing", () => {
    sceneEl.appendChild(controls);
    expect(() => { controls.remove(); }).not.toThrow();
  });
});
