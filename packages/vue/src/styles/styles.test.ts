import { describe, it, expect, beforeEach } from "vitest";
import { injectBaseStyles } from "./styles";

describe("injectBaseStyles", () => {
  beforeEach(() => {
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

  it("contains .polycss-scene rule", () => {
    injectBaseStyles(document);
    const el = document.getElementById("polycss-styles")!;
    expect(el.textContent).toContain(".polycss-scene");
  });

  it("contains .polycss-camera rule", () => {
    injectBaseStyles(document);
    const el = document.getElementById("polycss-styles")!;
    expect(el.textContent).toContain(".polycss-camera");
  });

  it("does nothing when doc is null-ish", () => {
    expect(() =>
      injectBaseStyles(null as unknown as Document)
    ).not.toThrow();
  });
});
