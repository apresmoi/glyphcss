import { describe, it, expect, beforeEach } from "vitest";
import { injectBaseStyles } from "./styles";

describe("injectBaseStyles", () => {
  beforeEach(() => {
    // Remove any previously injected style so tests are isolated
    const existing = document.getElementById("polycss-styles");
    if (existing) existing.remove();
  });

  it("injects a <style> element into document.head", () => {
    injectBaseStyles(document);
    const el = document.getElementById("polycss-styles");
    expect(el).toBeTruthy();
    expect(el?.tagName.toLowerCase()).toBe("style");
  });

  it("is idempotent — calling twice adds only one element", () => {
    injectBaseStyles(document);
    injectBaseStyles(document);
    const els = document.querySelectorAll("#polycss-styles");
    expect(els.length).toBe(1);
  });

  it("sets the style content containing polycss-scene class", () => {
    injectBaseStyles(document);
    const el = document.getElementById("polycss-styles")!;
    expect(el.textContent).toContain(".polycss-scene");
  });

  it("sets the style content containing polycss-camera class", () => {
    injectBaseStyles(document);
    const el = document.getElementById("polycss-styles")!;
    expect(el.textContent).toContain(".polycss-camera");
  });

  it("puts static polygon rendering defaults in .polycss-scene i", () => {
    injectBaseStyles(document);
    const el = document.getElementById("polycss-styles")!;
    expect(el.textContent).toContain(".polycss-scene i");
    expect(el.textContent).toContain("font-style: normal");
    expect(el.textContent).toContain("transform-origin: 0 0");
    expect(el.textContent).toContain("backface-visibility: hidden");
    expect(el.textContent).toContain("background-repeat: no-repeat");
  });

  it("does nothing when doc is null-ish", () => {
    // Should not throw
    expect(() =>
      injectBaseStyles(null as unknown as Document)
    ).not.toThrow();
  });
});
