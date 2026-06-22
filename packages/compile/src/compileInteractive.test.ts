import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { compileInteractive, toCodepenPrefill } from "./compileInteractive";

const DOG = fileURLToPath(new URL("../../../website/public/gallery/glb/Dog.glb", import.meta.url));

describe("compileInteractive", () => {
  it("default (orbit) → self-contained snippet with the orbit control, decimated", async () => {
    const r = await compileInteractive(DOG, { autoCenter: true, rotX: 60, rotY: 45, zoom: 0.5 });
    expect(r.interactions).toEqual(["orbit"]);
    expect(r.html).toContain('<div id="glyph">');
    expect(r.html).toContain('<script type="module">');
    expect(r.html).toContain("createGlyphOrbitControls");
    expect(r.html).toContain("esm.sh/glyphcss");
    expect(r.polygonCount).toBeGreaterThan(0);
    expect(r.polygonCount).toBeLessThanOrEqual(r.sourcePolygonCount);
  });

  it("declaring only the needed control tree-shakes the others", async () => {
    const fpv = await compileInteractive(DOG, { interactions: ["fpv"], autoCenter: true });
    expect(fpv.html).toContain("createGlyphFirstPersonControls");
    expect(fpv.html).not.toContain("createGlyphOrbitControls");
    expect(fpv.html).not.toContain("createGlyphMapControls");

    const pan = await compileInteractive(DOG, { interactions: ["pan", "zoom"], autoCenter: true });
    expect(pan.html).toContain("createGlyphMapControls");
    expect(pan.html).toContain("wheel: true");
    expect(pan.html).not.toContain("createGlyphFirstPersonControls");
  });

  it("orbit vs orbit+zoom: zoom enables the wheel and a finer decimation grid", async () => {
    const orbit = await compileInteractive(DOG, { interactions: ["orbit"], autoCenter: true });
    const zoom = await compileInteractive(DOG, { interactions: ["orbit", "zoom"], autoCenter: true });
    expect(orbit.html).toContain("wheel: false");
    expect(zoom.html).toContain("wheel: true");
    // Finer grid (zoom can get closer) → keeps at least as many triangles.
    expect(zoom.polygonCount).toBeGreaterThanOrEqual(orbit.polygonCount);
  });

  it("static ([]) → no control wired", async () => {
    const r = await compileInteractive(DOG, { interactions: [], autoCenter: true });
    expect(r.html).not.toContain("Controls(");
  });

  it("toCodepenPrefill → POST target + valid JSON payload", async () => {
    const r = await compileInteractive(DOG, { interactions: ["orbit", "zoom"], autoCenter: true });
    const pre = toCodepenPrefill(r, "dog");
    expect(pre.action).toBe("https://codepen.io/pen/define");
    const data = JSON.parse(pre.data);
    expect(data.title).toBe("dog");
    expect(data.html).toContain("createGlyphOrbitControls");
    expect(data.css).toContain("glyph-output");
  });

  it("decimation actually shrinks an over-detailed mesh", async () => {
    const r = await compileInteractive(DOG, { interactions: ["orbit"], decimateGrid: 16, autoCenter: true });
    expect(r.polygonCount).toBeLessThan(r.sourcePolygonCount);
  });
});
