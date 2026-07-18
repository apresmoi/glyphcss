import { describe, expect, it } from "vitest";
import { spherePolygons, type Polygon } from "glyphcss";
import { buildGlyphFieldSynthStaticExport, type GlyphFieldSynthStaticExportOptions } from "./staticExport";

function mesh(): Polygon[] {
  return spherePolygons({ center: [0, 0, 0], size: 4, subdivisions: 1, color: "#8fb3d9" });
}

function baseOptions(overrides: Partial<GlyphFieldSynthStaticExportOptions> = {}): GlyphFieldSynthStaticExportOptions {
  return {
    params: {
      space: "surface",
      scale: 2.5,
      field1: "radial", wave1: "sin", freq1: 6, speed1: 0.5, amp1: 1,
      field2: "angular", wave2: "saw", freq2: 4, speed2: 0.3, amp2: 0.6,
      combine: "multiply",
      glyphs: " .:-=+*#%@",
      color: "#7df9ff",
      colorB: "#ff4fa3",
      gradient: 0.5,
    },
    blend: "replace",
    loopSeconds: 4,
    cols: 24,
    rows: 12,
    rotX: 62,
    rotY: 38,
    zoom: 3,
    ...overrides,
  };
}

describe("buildGlyphFieldSynthStaticExport", () => {
  it("rejects an unsupported effect id", () => {
    expect(() => buildGlyphFieldSynthStaticExport(mesh(), { ...baseOptions(), effect: "matrix-rain" as never }))
      .toThrow(/field-synth/);
  });

  it("rejects a non-positive grid or loop", () => {
    expect(() => buildGlyphFieldSynthStaticExport(mesh(), baseOptions({ cols: 0 }))).toThrow();
    expect(() => buildGlyphFieldSynthStaticExport(mesh(), baseOptions({ rows: 0 }))).toThrow();
    expect(() => buildGlyphFieldSynthStaticExport(mesh(), baseOptions({ loopSeconds: 0 }))).toThrow();
  });

  it("produces a non-empty base frame", () => {
    const result = buildGlyphFieldSynthStaticExport(mesh(), baseOptions());
    const dataMatch = result.js.match(/var DATA=(\{.*?\});var CFG=/);
    expect(dataMatch).not.toBeNull();
    const data = JSON.parse(dataMatch![1]!) as { c: number[]; r: number[]; x: number[]; bg: string[] };
    expect(data.c.length).toBeGreaterThan(0);
    expect(data.c.length).toBe(data.r.length);
    expect(data.c.length).toBe(data.x.length);
    expect(data.bg.some((g) => g !== " ")).toBe(true);
  });

  it("is fully self-contained: no imports, no network URLs, no @glyphcss package reference", () => {
    const result = buildGlyphFieldSynthStaticExport(mesh(), baseOptions());
    for (const source of [result.html, result.css, result.js, result.pen.html, result.pen.css, result.pen.js]) {
      expect(source).not.toMatch(/\bimport\s/);
      expect(source).not.toMatch(/\brequire\(/);
      expect(source).not.toMatch(/https?:\/\//);
      expect(source).not.toMatch(/@glyphcss/);
    }
    // The JS payload specifically must never mention the `glyphcss` package
    // itself (a title like "glyphcss field synth" in the HTML doc is fine —
    // it's copy, not a dependency).
    expect(result.js).not.toMatch(/\bglyphcss\b/);
  });

  it("inlines the field-synth math and an animation loop, with no glyphcss import", () => {
    const result = buildGlyphFieldSynthStaticExport(mesh(), baseOptions());
    expect(result.js).toContain("requestAnimationFrame");
    // Oscillator / combine / dither primitives — the hand-written vanilla-JS port.
    expect(result.js).toContain("function osc(");
    expect(result.js).toContain("function combine(");
    expect(result.js).toContain("function noise3(");
    expect(result.js).toContain("function thr(");
    expect(result.html).toContain("<pre id=\"g\">");
  });

  it("bakes the supplied params (loop seconds, ramp, combine mode) into CFG", () => {
    const result = buildGlyphFieldSynthStaticExport(mesh(), baseOptions({ loopSeconds: 7.5 }));
    const cfgMatch = result.js.match(/var CFG=(\{.*\});\s*"use strict"/s);
    expect(cfgMatch).not.toBeNull();
    const cfg = JSON.parse(cfgMatch![1]!) as {
      loop: number;
      combine: string;
      ramp: string[];
      blend: string;
      voices: { amp: number }[];
    };
    expect(cfg.loop).toBe(7.5);
    expect(cfg.combine).toBe("multiply");
    expect(cfg.ramp.join("")).toBe(" .:-=+*#%@");
    // Only voices with amp > 0 are shipped (field1 + field2 above; the other four defaulted to amp 0).
    expect(cfg.voices.length).toBe(2);
  });

  it("reads the REAL mounted blend verbatim instead of the effect definition's own defaultBlend", () => {
    const replaceResult = buildGlyphFieldSynthStaticExport(mesh(), baseOptions({ blend: "replace" }));
    const overResult = buildGlyphFieldSynthStaticExport(mesh(), baseOptions({ blend: "over" }));
    expect(replaceResult.js).toMatch(/"blend":"replace"/);
    expect(overResult.js).toMatch(/"blend":"over"/);
  });

  it("respects useColors: false by emitting plain-text output with no color spans", () => {
    const result = buildGlyphFieldSynthStaticExport(mesh(), baseOptions({ useColors: false }));
    expect(result.js).toMatch(/"useColors":false/);
    expect(result.js).toContain("pre.textContent=text");
  });

  it("throws when field-synth's own param validation rejects the patch", () => {
    expect(() => buildGlyphFieldSynthStaticExport(mesh(), baseOptions({ params: { glyphs: "" } }))).toThrow();
  });
});
