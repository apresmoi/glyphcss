import { describe, it, expect, beforeEach } from "vitest";
import { injectPolyBaseStyles } from "./styles";

describe("injectPolyBaseStyles", () => {
  beforeEach(() => {
    // Remove any previously injected style so tests are isolated
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

  it("sets the style content containing polycss-scene class", () => {
    injectPolyBaseStyles(document);
    const el = document.getElementById("polycss-styles")!;
    expect(el.textContent).toContain(".polycss-scene");
  });

  it("sets the style content containing polycss-camera class", () => {
    injectPolyBaseStyles(document);
    const el = document.getElementById("polycss-styles")!;
    expect(el.textContent).toContain(".polycss-camera");
  });

  it("puts static polygon rendering defaults on polygon leaf tags", () => {
    injectPolyBaseStyles(document);
    const el = document.getElementById("polycss-styles")!;
    expect(el.textContent).toContain(".polycss-scene i");
    expect(el.textContent).toContain(".polycss-scene b");
    expect(el.textContent).toContain(".polycss-scene s");
    expect(el.textContent).toContain("quotes: none");
    expect(el.textContent).toContain("font-weight: normal");
    expect(el.textContent).toContain("text-decoration: none");
    expect(el.textContent).toContain("box-sizing: border-box");
    expect(el.textContent).toContain("font-style: normal");
    expect(el.textContent).toContain("transform-origin: 0 0");
    expect(el.textContent).toContain("backface-visibility: hidden");
    expect(el.textContent).toContain("background-repeat: no-repeat");
    expect(el.textContent).toContain("width: 0px");
    expect(el.textContent).toContain("height: 0px");
  });

  it("does not require border-shape utility classes", () => {
    injectPolyBaseStyles(document);
    const el = document.getElementById("polycss-styles")!;
    expect(el.textContent).not.toContain("polycss-border-shape");
    expect(el.textContent).not.toContain("polycss-solid-css");
    expect(el.textContent).not.toContain("polycss-solid-triangle");
  });

  it("does nothing when doc is null-ish", () => {
    // Should not throw
    expect(() =>
      injectPolyBaseStyles(null as unknown as Document)
    ).not.toThrow();
  });
});
