import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { GlyphSceneElement } from "./GlyphSceneElement";
import { GlyphOrbitControlsElement } from "./GlyphOrbitControlsElement";
import { GlyphPerspectiveCameraElement } from "./GlyphPerspectiveCameraElement";

if (!customElements.get("glyph-scene")) {
  customElements.define("glyph-scene", GlyphSceneElement);
}
if (!customElements.get("glyph-orbit-controls")) {
  customElements.define("glyph-orbit-controls", GlyphOrbitControlsElement);
}
if (!customElements.get("glyph-perspective-camera")) {
  customElements.define("glyph-perspective-camera", GlyphPerspectiveCameraElement);
}

describe("GlyphOrbitControlsElement", () => {
  let camEl: GlyphPerspectiveCameraElement;
  let sceneEl: GlyphSceneElement;
  let controls: GlyphOrbitControlsElement;

  beforeEach(() => {
    camEl = document.createElement("glyph-perspective-camera") as GlyphPerspectiveCameraElement;
    sceneEl = document.createElement("glyph-scene") as GlyphSceneElement;
    sceneEl.setAttribute("cols", "20");
    sceneEl.setAttribute("rows", "5");
    camEl.appendChild(sceneEl);
    document.body.appendChild(camEl);

    controls = document.createElement("glyph-orbit-controls") as GlyphOrbitControlsElement;
  });

  afterEach(() => {
    if (controls.isConnected) controls.remove();
    if (camEl.isConnected) camEl.remove();
  });

  it("is registered under the 'glyph-orbit-controls' tag", () => {
    expect(customElements.get("glyph-orbit-controls")).toBe(GlyphOrbitControlsElement);
  });

  it("createElement produces a GlyphOrbitControlsElement instance", () => {
    expect(controls).toBeInstanceOf(GlyphOrbitControlsElement);
  });

  it("observes drag, wheel, invert, pitch-range, mode, animate-speed, animate-axis, zoom-range, pan attributes", () => {
    expect(GlyphOrbitControlsElement.observedAttributes).toContain("drag");
    expect(GlyphOrbitControlsElement.observedAttributes).toContain("wheel");
    expect(GlyphOrbitControlsElement.observedAttributes).toContain("invert");
    expect(GlyphOrbitControlsElement.observedAttributes).toContain("pitch-range");
    expect(GlyphOrbitControlsElement.observedAttributes).toContain("mode");
    expect(GlyphOrbitControlsElement.observedAttributes).toContain("animate-speed");
    expect(GlyphOrbitControlsElement.observedAttributes).toContain("animate-axis");
    expect(GlyphOrbitControlsElement.observedAttributes).toContain("zoom-range");
    expect(GlyphOrbitControlsElement.observedAttributes).toContain("pan");
  });

  it("zoom-range='1,2' clamps wheel zoom to those bounds", () => {
    controls.setAttribute("zoom-range", "1,2");
    sceneEl.appendChild(controls);
    const scene = sceneEl.getScene();
    expect(scene).toBeTruthy();
    for (let i = 0; i < 40; i++) {
      scene!.host.dispatchEvent(new WheelEvent("wheel", { deltaY: 10000, bubbles: true }));
    }
    expect(scene!.camera.zoom).toBeCloseTo(1, 6);
  });

  it("zoom-range='none' disables the clamp", () => {
    controls.setAttribute("zoom-range", "none");
    sceneEl.appendChild(controls);
    const scene = sceneEl.getScene();
    expect(scene).toBeTruthy();
    for (let i = 0; i < 20; i++) {
      scene!.host.dispatchEvent(new WheelEvent("wheel", { deltaY: 500, bubbles: true }));
    }
    expect(scene!.camera.zoom).toBeLessThan(0.1);
  });

  it("pan='false' disables the middle-button pan gesture", () => {
    controls.setAttribute("pan", "false");
    sceneEl.appendChild(controls);
    const scene = sceneEl.getScene();
    expect(scene).toBeTruthy();
    const target0 = [...scene!.camera.target];
    const host = scene!.host;
    host.dispatchEvent(new PointerEvent("pointerdown", { clientX: 0, clientY: 0, pointerId: 1, isPrimary: true, button: 1, bubbles: true }));
    host.dispatchEvent(new PointerEvent("pointermove", { clientX: 40, clientY: 0, pointerId: 1, isPrimary: true, button: 1, bubbles: true }));
    host.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1, isPrimary: true, bubbles: true }));
    expect([...scene!.camera.target]).toEqual(target0);
  });

  it("mode='trackball' engages the matrix camera path", () => {
    controls.setAttribute("mode", "trackball");
    sceneEl.appendChild(controls);
    const scene = sceneEl.getScene();
    expect(scene?.camera.useMat).toBe(true);
  });

  it("pitch-range='none' allows the camera past ±90 degrees", () => {
    controls.setAttribute("pitch-range", "none");
    sceneEl.appendChild(controls);
    const scene = sceneEl.getScene();
    expect(scene).toBeTruthy();
    scene!.camera.rotX = 0;
    const host = scene!.host;
    host.dispatchEvent(new PointerEvent("pointerdown", { clientX: 0, clientY: 0, pointerId: 1, isPrimary: true, bubbles: true }));
    host.dispatchEvent(new PointerEvent("pointermove", { clientX: 0, clientY: 1000, pointerId: 1, isPrimary: true, bubbles: true }));
    host.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1, isPrimary: true, bubbles: true }));
    expect(scene!.camera.rotX).toBeCloseTo(-250, 5);
  });

  it("pitch-range='-30,30' clamps to a custom range", () => {
    controls.setAttribute("pitch-range", "-30,30");
    sceneEl.appendChild(controls);
    const scene = sceneEl.getScene();
    expect(scene).toBeTruthy();
    scene!.camera.rotX = 0;
    const host = scene!.host;
    host.dispatchEvent(new PointerEvent("pointerdown", { clientX: 0, clientY: 0, pointerId: 1, isPrimary: true, bubbles: true }));
    host.dispatchEvent(new PointerEvent("pointermove", { clientX: 0, clientY: 1000, pointerId: 1, isPrimary: true, bubbles: true }));
    host.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1, isPrimary: true, bubbles: true }));
    expect(scene!.camera.rotX).toBe(-30);
  });

  // P2-a (codex gpt-5.6-sol fix round 1): _readOptions() used to OMIT
  // pitch-range/mode from the options object entirely when the attribute
  // was absent, and createGlyphOrbitControls's update() only overwrites a
  // field when the key is PRESENT in opts — so removing the attribute left
  // the previous value stuck instead of restoring the library default.
  it("removing pitch-range restores the default [-90, 90] clamp", () => {
    controls.setAttribute("pitch-range", "-30,30");
    sceneEl.appendChild(controls);
    const scene = sceneEl.getScene();
    expect(scene).toBeTruthy();

    controls.removeAttribute("pitch-range");
    scene!.camera.rotX = 0;
    const host = scene!.host;
    host.dispatchEvent(new PointerEvent("pointerdown", { clientX: 0, clientY: 0, pointerId: 1, isPrimary: true, bubbles: true }));
    host.dispatchEvent(new PointerEvent("pointermove", { clientX: 0, clientY: 1000, pointerId: 1, isPrimary: true, bubbles: true }));
    host.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1, isPrimary: true, bubbles: true }));
    // Default clamp is [-90, 90], not the removed [-30, 30].
    expect(scene!.camera.rotX).toBe(-90);
  });

  it("removing mode restores the default 'turntable' mode", () => {
    controls.setAttribute("mode", "trackball");
    sceneEl.appendChild(controls);
    const scene = sceneEl.getScene();
    expect(scene).toBeTruthy();
    expect(scene!.camera.useMat).toBe(true);

    controls.removeAttribute("mode");
    expect(scene!.camera.useMat).toBe(false);
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
    // Create a fresh camera+scene tree (not yet connected) and insert controls first.
    const freshCam = document.createElement("glyph-perspective-camera") as GlyphPerspectiveCameraElement;
    const freshScene = document.createElement("glyph-scene") as GlyphSceneElement;
    freshScene.setAttribute("cols", "10");
    freshScene.setAttribute("rows", "5");
    freshCam.appendChild(freshScene);
    // Append controls into scene before camera+scene is connected — scene not ready yet.
    freshScene.appendChild(controls);
    // Now connect camera — triggers camera-ready then scene-ready.
    expect(() => { document.body.appendChild(freshCam); }).not.toThrow();
    freshCam.remove();
  });
});
