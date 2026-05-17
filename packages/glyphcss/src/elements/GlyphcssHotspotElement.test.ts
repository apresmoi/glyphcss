import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { GlyphcssSceneElement } from "./GlyphcssSceneElement";
import { GlyphcssHotspotElement } from "./GlyphcssHotspotElement";

if (!customElements.get("glyphcss-scene")) {
  customElements.define("glyphcss-scene", GlyphcssSceneElement);
}
if (!customElements.get("glyphcss-hotspot")) {
  customElements.define("glyphcss-hotspot", GlyphcssHotspotElement);
}

describe("GlyphcssHotspotElement", () => {
  let sceneEl: GlyphcssSceneElement;
  let hotspot: GlyphcssHotspotElement;

  beforeEach(() => {
    sceneEl = document.createElement("glyphcss-scene") as GlyphcssSceneElement;
    sceneEl.setAttribute("cols", "20");
    sceneEl.setAttribute("rows", "5");
    document.body.appendChild(sceneEl);

    hotspot = document.createElement("glyphcss-hotspot") as GlyphcssHotspotElement;
  });

  afterEach(() => {
    if (sceneEl.isConnected) sceneEl.remove();
  });

  it("is registered under the 'glyphcss-hotspot' tag", () => {
    expect(customElements.get("glyphcss-hotspot")).toBe(GlyphcssHotspotElement);
  });

  it("createElement produces a GlyphcssHotspotElement instance", () => {
    expect(hotspot).toBeInstanceOf(GlyphcssHotspotElement);
  });

  it("observes at, size, hotspot-id attributes", () => {
    expect(GlyphcssHotspotElement.observedAttributes).toContain("at");
    expect(GlyphcssHotspotElement.observedAttributes).toContain("size");
    expect(GlyphcssHotspotElement.observedAttributes).toContain("hotspot-id");
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
    // Observable effect: a .glyphcss-hotspot element appears in the hotspot layer.
    const hsEl = sceneEl.querySelector(".glyphcss-hotspot[data-hotspot-id='hs1']");
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
    // The event bubbles from the GlyphcssHotspotElement itself.
    hotspot.addEventListener("glyphcss:hotspot-click", (e) => {
      clickDetail = (e as CustomEvent).detail;
    });

    // The click handler is attached to the overlay div in the hotspot layer,
    // which calls this.dispatchEvent on the GlyphcssHotspotElement.
    // We can simulate the click by finding the overlay and clicking it.
    const overlayEl = sceneEl.querySelector(".glyphcss-hotspot[data-hotspot-id='hs-click']") as HTMLElement;
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
    expect(sceneEl.querySelectorAll(".glyphcss-hotspot").length).toBe(0);
  });
});
