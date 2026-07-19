import { describe, it, expect } from "vitest";
import { buildGlyphInteractiveExport, glyphCodepenPrefill } from "./interactiveExport";
import type { Polygon } from "@glyphcss/core";

const TRIANGLE: Polygon[] = [
  { vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]], color: "#ff0000" },
  { vertices: [[0, 0, 1], [1, 0, 1], [0, 1, 1]], color: "#00ff00" },
];

describe("buildGlyphInteractiveExport — effect option", () => {
  it("no effect → unchanged output (regression guard)", () => {
    const r = buildGlyphInteractiveExport(TRIANGLE, { interactions: ["orbit"] });
    expect(r.html).not.toContain("@glyphcss/effects");
    expect(r.html).not.toContain("getGlyphEffect");
    expect(r.html).not.toContain("addEffectLayer");
    expect(r.html).not.toContain("requestAnimationFrame");
  });

  it("animated effect → effects CDN import, getGlyphEffect lookup, addEffectLayer, inlined params, rAF clock", () => {
    const r = buildGlyphInteractiveExport(TRIANGLE, {
      interactions: ["orbit"],
      effect: {
        id: "field-synth",
        params: { space: "surface", field1: "radial", amp1: 0.5, time: 999 },
        blend: "replace",
        timeScale: 2,
      },
    });
    expect(r.html).toContain('import { getGlyphEffect } from "https://esm.sh/@glyphcss/effects?deps=glyphcss";');
    expect(r.html).toContain('getGlyphEffect("field-synth")');
    expect(r.html).toContain("scene.addEffectLayer({ effect: getGlyphEffect(\"field-synth\"), blend: \"replace\", params:");
    // Params are inlined without the authored `time` key — the clock owns it.
    const paramsMatch = r.html.match(/params: (\{[^}]*\})/);
    expect(paramsMatch).not.toBeNull();
    const params = JSON.parse(paramsMatch![1]);
    expect(params).toEqual({ space: "surface", field1: "radial", amp1: 0.5 });
    expect(params.time).toBeUndefined();
    // rAF clock drives params.time at the declared speed.
    expect(r.html).toContain("requestAnimationFrame(_tick)");
    expect(r.html).toContain("glyphEffect.params.time = ((now - _t0) / 1000) * 2;");
  });

  it("static effect (no timeScale) → mounts the layer but emits no rAF clock", () => {
    const r = buildGlyphInteractiveExport(TRIANGLE, {
      interactions: [],
      effect: { id: "matrix-rain", params: { density: 0.5 } },
    });
    expect(r.html).toContain('getGlyphEffect("matrix-rain")');
    expect(r.html).toContain("scene.addEffectLayer(");
    // Default blend is "over" (glyphcss's own addEffectLayer default) when unset.
    expect(r.html).toContain('blend: "over"');
    expect(r.html).not.toContain("requestAnimationFrame");
    expect(r.html).not.toContain("_tick");
  });

  it("timeScale: 0 is treated as static — no clock emitted", () => {
    const r = buildGlyphInteractiveExport(TRIANGLE, {
      interactions: ["orbit"],
      effect: { id: "scan", params: {}, timeScale: 0 },
    });
    expect(r.html).toContain("scene.addEffectLayer(");
    expect(r.html).not.toContain("requestAnimationFrame");
  });

  it("cdnVersion pins both the glyphcss and @glyphcss/effects CDN imports, plus the deps dedupe query", () => {
    const r = buildGlyphInteractiveExport(TRIANGLE, {
      interactions: ["orbit"],
      cdnVersion: "0.1.1",
      effect: { id: "glitch", params: {}, timeScale: 1 },
    });
    expect(r.html).toContain('from "https://esm.sh/glyphcss@0.1.1";');
    expect(r.html).toContain(
      'import { getGlyphEffect } from "https://esm.sh/@glyphcss/effects@0.1.1?deps=glyphcss@0.1.1";',
    );
  });

  it("mounts the effect after controls in both the normal and FPV branches", () => {
    const normal = buildGlyphInteractiveExport(TRIANGLE, {
      interactions: ["orbit"],
      effect: { id: "wipe", params: {}, timeScale: 1 },
    });
    const orbitIdx = normal.html.indexOf("createGlyphOrbitControls(");
    const effectIdx = normal.html.indexOf("scene.addEffectLayer(");
    expect(orbitIdx).toBeGreaterThan(-1);
    expect(effectIdx).toBeGreaterThan(orbitIdx);

    const fpv = buildGlyphInteractiveExport(TRIANGLE, {
      interactions: ["fpv"],
      autoCenter: true,
      effect: { id: "wipe", params: {}, timeScale: 1 },
    });
    const fpvSetupIdx = fpv.html.indexOf("fpv.setOrigin(");
    const fpvEffectIdx = fpv.html.indexOf("scene.addEffectLayer(");
    expect(fpvSetupIdx).toBeGreaterThan(-1);
    expect(fpvEffectIdx).toBeGreaterThan(fpvSetupIdx);
  });

  it("glyphCodepenPrefill carries the effect-mounting script through the pen payload", () => {
    const r = buildGlyphInteractiveExport(TRIANGLE, {
      interactions: ["orbit"],
      effect: { id: "ripple", params: {}, timeScale: 1 },
    });
    const pre = glyphCodepenPrefill(r, "effect-demo");
    const data = JSON.parse(pre.data);
    expect(data.html).toContain('getGlyphEffect("ripple")');
    expect(data.html).toContain("requestAnimationFrame(_tick)");
  });
});
