import { describe, it, expect, beforeEach } from "vitest";
import { injectPolyBaseStyles } from "./styles";

describe("injectPolyBaseStyles", () => {
  beforeEach(() => {
    const existing = document.getElementById("polycss-styles");
    if (existing) existing.remove();
  });

  it("injects a <style> element into document.head", () => {
    injectPolyBaseStyles(document);
    const el = document.getElementById("polycss-styles");
    expect(el).toBeTruthy();
    expect(el?.tagName.toLowerCase()).toBe("style");
  });

  it("is idempotent — calling twice adds only one element", () => {
    injectPolyBaseStyles(document);
    injectPolyBaseStyles(document);
    const els = document.querySelectorAll("#polycss-styles");
    expect(els.length).toBe(1);
  });

  it("contains .polycss-scene rule", () => {
    injectPolyBaseStyles(document);
    const el = document.getElementById("polycss-styles")!;
    expect(el.textContent).toContain(".polycss-scene");
  });

  it("contains .polycss-camera rule", () => {
    injectPolyBaseStyles(document);
    const el = document.getElementById("polycss-styles")!;
    expect(el.textContent).toContain(".polycss-camera");
  });

  it("puts static polygon rendering defaults in .polycss-scene i", () => {
    injectPolyBaseStyles(document);
    const el = document.getElementById("polycss-styles")!;
    expect(el.textContent).toContain(".polycss-scene i");
    expect(el.textContent).toContain("font-style: normal");
    expect(el.textContent).toContain("transform-origin: 0 0");
    expect(el.textContent).toContain("backface-visibility: hidden");
    expect(el.textContent).toContain("background-repeat: no-repeat");
  });

  it("does nothing when doc is null-ish", () => {
    expect(() =>
      injectPolyBaseStyles(null as unknown as Document)
    ).not.toThrow();
  });
});
