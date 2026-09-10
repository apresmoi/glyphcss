import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { GlyphSceneElement } from "./GlyphSceneElement";
import { GlyphHotspotElement } from "./GlyphHotspotElement";
import { GlyphPerspectiveCameraElement } from "./GlyphPerspectiveCameraElement";

if (!customElements.get("glyph-scene")) {
  customElements.define("glyph-scene", GlyphSceneElement);
}
if (!customElements.get("glyph-hotspot")) {
  customElements.define("glyph-hotspot", GlyphHotspotElement);
}
if (!customElements.get("glyph-perspective-camera")) {
  customElements.define("glyph-perspective-camera", GlyphPerspectiveCameraElement);
}

describe("GlyphHotspotElement", () => {
  let camEl: GlyphPerspectiveCameraElement;
  let sceneEl: GlyphSceneElement;
  let hotspot: GlyphHotspotElement;

  beforeEach(() => {
    camEl = document.createElement("glyph-perspective-camera") as GlyphPerspectiveCameraElement;
    sceneEl = document.createElement("glyph-scene") as GlyphSceneElement;
    sceneEl.setAttribute("cols", "20");
    sceneEl.setAttribute("rows", "5");
    camEl.appendChild(sceneEl);
    document.body.appendChild(camEl);

    hotspot = document.createElement("glyph-hotspot") as GlyphHotspotElement;
  });

  afterEach(() => {
    if (camEl.isConnected) camEl.remove();
  });

  it("is registered under the 'glyph-hotspot' tag", () => {
    expect(customElements.get("glyph-hotspot")).toBe(GlyphHotspotElement);
  });

  it("createElement produces a GlyphHotspotElement instance", () => {
    expect(hotspot).toBeInstanceOf(GlyphHotspotElement);
  });

  it("observes at, size, hotspot-id attributes", () => {
    expect(GlyphHotspotElement.observedAttributes).toContain("at");
    expect(GlyphHotspotElement.observedAttributes).toContain("size");
    expect(GlyphHotspotElement.observedAttributes).toContain("hotspot-id");
  });

  it("connects without throwing when placed outside a scene", () => {
    hotspot.setAttribute("at", "0,0,0");
    expect(() => { document.body.appendChild(hotspot); }).not.toThrow();
    hotspot.remove();
  });

  it("connects without throwing when placed inside a scene without 'at'", () => {
    // Without a valid `at` attribute, registration is skipped silently.
    expect(() => { sceneEl.appendChild(hotspot); }).not.toThrow();
  });

  it("registers with the scene when at attribute is valid", async () => {
    hotspot.setAttribute("at", "0,0,0");
    hotspot.setAttribute("hotspot-id", "hs1");
    sceneEl.appendChild(hotspot);
    await Promise.resolve();
    // Observable effect: a .glyph-hotspot element appears in the hotspot layer.
    const hsEl = sceneEl.querySelector(".glyph-hotspot[data-hotspot-id='hs1']");
    expect(hsEl).toBeTruthy();
  });

  it("removing the element removes its hotspot from the scene", async () => {
    hotspot.setAttribute("at", "0,1,0");
    hotspot.setAttribute("hotspot-id", "hs-remove");
    sceneEl.appendChild(hotspot);
    await Promise.resolve();
    expect(sceneEl.querySelector("[data-hotspot-id='hs-remove']")).toBeTruthy();

    hotspot.remove();
    await Promise.resolve();
    expect(sceneEl.querySelector("[data-hotspot-id='hs-remove']")).toBeFalsy();
  });

  it("changing at attribute re-registers the hotspot", async () => {
    hotspot.setAttribute("at", "0,0,0");
    hotspot.setAttribute("hotspot-id", "hs-move");
    sceneEl.appendChild(hotspot);
    await Promise.resolve();
    expect(sceneEl.querySelector("[data-hotspot-id='hs-move']")).toBeTruthy();

    // Change position — should remove old and add new.
    hotspot.setAttribute("at", "1,1,1");
    await Promise.resolve();
    // Hotspot with same id should still be present after re-registration.
    expect(sceneEl.querySelector("[data-hotspot-id='hs-move']")).toBeTruthy();
  });

  it("dispatches glyphcss:hotspot-click on the element when overlay is clicked", async () => {
    hotspot.setAttribute("at", "0,0,0");
    hotspot.setAttribute("hotspot-id", "hs-click");
    sceneEl.appendChild(hotspot);
    await Promise.resolve();

    let clickDetail: unknown = null;
    // The event bubbles from the GlyphHotspotElement itself.
    hotspot.addEventListener("glyphcss:hotspot-click", (e) => {
      clickDetail = (e as CustomEvent).detail;
    });

    // The click handler is attached to the overlay div in the hotspot layer,
    // which calls this.dispatchEvent on the GlyphHotspotElement.
    // We can simulate the click by finding the overlay and clicking it.
    const overlayEl = sceneEl.querySelector(".glyph-hotspot[data-hotspot-id='hs-click']") as HTMLElement;
    expect(overlayEl).toBeTruthy();
    overlayEl.click();

    expect(clickDetail).toEqual({ id: "hs-click" });
  });

  it("falls back to element id for hotspot id when hotspot-id is absent", async () => {
    hotspot.setAttribute("at", "0,0,0");
    hotspot.setAttribute("id", "my-hs");
    sceneEl.appendChild(hotspot);
    await Promise.resolve();
    const overlayEl = sceneEl.querySelector("[data-hotspot-id='my-hs']");
    expect(overlayEl).toBeTruthy();
  });

  it("invalid at value (non-numeric) silently skips registration", () => {
    hotspot.setAttribute("at", "bad,values,here");
    expect(() => { sceneEl.appendChild(hotspot); }).not.toThrow();
    // No hotspot overlay should appear.
    expect(sceneEl.querySelectorAll(".glyph-hotspot").length).toBe(0);
  });

  /**
   * Mirrors the React and Vue wrappers' own "moving the anchor" case.
   * `GlyphHotspotHandle.setAt` exists so a moving anchor does not destroy the
   * overlay element — its doc: remove-and-re-add "destroys and re-creates the
   * element, losing whatever the consumer wrote on it and restarting any CSS
   * transition on it". Here the element's own children have been MOVED into
   * that overlay, so a re-registration walks them out and back in on every
   * anchor change.
   */
  it("moves a changed `at` in place, keeping the overlay element and its children", () => {
    const child = document.createElement("span");
    child.className = "tooltip";
    hotspot.appendChild(child);
    hotspot.setAttribute("hotspot-id", "hs-move");
    hotspot.setAttribute("at", "0,0,0");
    sceneEl.appendChild(hotspot);

    const overlay = camEl.querySelector("[data-hotspot-id='hs-move']");
    expect(overlay).toBeTruthy();
    expect(overlay!.contains(child)).toBe(true);

    hotspot.setAttribute("at", "0,5,0");
    // The SAME overlay, still holding the SAME child node.
    expect(camEl.querySelector("[data-hotspot-id='hs-move']")).toBe(overlay);
    expect(overlay!.contains(child)).toBe(true);
    expect(camEl.querySelectorAll("[data-hotspot-id='hs-move']").length).toBe(1);
  });

  it("still re-registers when the hotspot-id changes", () => {
    hotspot.setAttribute("hotspot-id", "first");
    hotspot.setAttribute("at", "0,0,0");
    sceneEl.appendChild(hotspot);
    expect(camEl.querySelector("[data-hotspot-id='first']")).toBeTruthy();

    hotspot.setAttribute("hotspot-id", "second");
    expect(camEl.querySelector("[data-hotspot-id='first']")).toBeFalsy();
    expect(camEl.querySelector("[data-hotspot-id='second']")).toBeTruthy();
  });
});
