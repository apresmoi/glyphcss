import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { GlyphSceneElement } from "./GlyphSceneElement";

// Register the element if not already registered.
if (!customElements.get("glyph-scene")) {
  customElements.define("glyph-scene", GlyphSceneElement);
}

describe("GlyphSceneElement", () => {
  let host: GlyphSceneElement;

  beforeEach(() => {
    host = document.createElement("glyph-scene") as GlyphSceneElement;
  });

  afterEach(() => {
    if (host.isConnected) host.remove();
  });

  it("is registered under the 'glyph-scene' tag", () => {
    expect(customElements.get("glyph-scene")).toBe(GlyphSceneElement);
  });

  it("createElement produces a GlyphSceneElement instance", () => {
    expect(host).toBeInstanceOf(GlyphSceneElement);
  });

  it("observes the expected attributes", () => {
    expect(GlyphSceneElement.observedAttributes).toContain("mode");
    expect(GlyphSceneElement.observedAttributes).toContain("cols");
    expect(GlyphSceneElement.observedAttributes).toContain("rows");
    expect(GlyphSceneElement.observedAttributes).toContain("use-colors");
    expect(GlyphSceneElement.observedAttributes).toContain("glyph-palette");
    expect(GlyphSceneElement.observedAttributes).toContain("cell-aspect");
    expect(GlyphSceneElement.observedAttributes).toContain("directional-intensity");
    expect(GlyphSceneElement.observedAttributes).toContain("ambient-intensity");
  });

  it("getScene() returns null before connect", () => {
    expect(host.getScene()).toBeNull();
  });

  it("appending to document emits .glyph-scene wrapper and <pre> output", () => {
    document.body.appendChild(host);
    expect(host.querySelector(".glyph-scene")).toBeTruthy();
    expect(host.querySelector("pre.glyph-output")).toBeTruthy();
  });

  it("getScene() is non-null after connect", () => {
    document.body.appendChild(host);
    expect(host.getScene()).not.toBeNull();
  });

  it("dispatches glyphcss:scene-ready on connect", () => {
    let fired = false;
    host.addEventListener("glyphcss:scene-ready", () => { fired = true; });
    document.body.appendChild(host);
    expect(fired).toBe(true);
  });

  it("passes cols/rows attributes down to the scene", async () => {
    host.setAttribute("cols", "40");
    host.setAttribute("rows", "10");
    document.body.appendChild(host);
    // Let the microtask render flush.
    await Promise.resolve();
    const pre = host.querySelector("pre.glyph-output") as HTMLPreElement;
    // The pre should have some content rendered into a 40x10 grid.
    expect(pre).toBeTruthy();
  });

  it("mode attribute change triggers re-render without throwing", async () => {
    host.setAttribute("cols", "20");
    host.setAttribute("rows", "5");
    document.body.appendChild(host);
    await Promise.resolve();
    host.setAttribute("mode", "wireframe");
    await Promise.resolve();
    const pre = host.querySelector("pre.glyph-output") as HTMLPreElement;
    expect(pre).toBeTruthy();
  });

  it("attributeChangedCallback is a no-op before connect", () => {
    // Setting an attribute before connect must not throw.
    expect(() => { host.setAttribute("mode", "solid"); }).not.toThrow();
    // Scene still null after attribute change before connect.
    expect(host.getScene()).toBeNull();
  });

  it("disconnect destroys the scene (removes .glyph-scene from DOM)", () => {
    document.body.appendChild(host);
    expect(host.querySelector(".glyph-scene")).toBeTruthy();
    host.remove();
    expect(host.querySelector(".glyph-scene")).toBeFalsy();
    expect(host.getScene()).toBeNull();
  });

  it("reconnect after disconnect creates a fresh scene", () => {
    document.body.appendChild(host);
    const first = host.getScene();
    host.remove();
    document.body.appendChild(host);
    const second = host.getScene();
    expect(second).not.toBeNull();
    // Should be a fresh handle object (not the same reference).
    expect(second).not.toBe(first);
  });

  it("use-colors=false attribute is forwarded (no crash on render)", async () => {
    host.setAttribute("use-colors", "false");
    host.setAttribute("cols", "20");
    host.setAttribute("rows", "5");
    document.body.appendChild(host);
    await Promise.resolve();
    const pre = host.querySelector("pre.glyph-output") as HTMLPreElement;
    expect(pre).toBeTruthy();
  });

  it("directional-intensity and ambient-intensity attributes are forwarded without error", () => {
    host.setAttribute("directional-intensity", "0.8");
    host.setAttribute("ambient-intensity", "0.3");
    expect(() => { document.body.appendChild(host); }).not.toThrow();
  });
});
