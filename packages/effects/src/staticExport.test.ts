import { describe, expect, it } from "vitest";
import { spherePolygons, type Polygon } from "glyphcss";
import { buildGlyphFieldSynthStaticExport, type GlyphFieldSynthStaticExportOptions } from "./staticExport";

function mesh(): Polygon[] {
  return spherePolygons({ center: [0, 0, 0], size: 4, subdivisions: 1, color: "#8fb3d9" });
}

// Mirrors website/src/components/SynthWorkbench/SynthWorkbench.tsx `flatQuad`
// (the /synth page's default "plane" shape): a flat square in the world XY
// plane, z=0, linear 0..1 UVs across the whole quad — the case whose
// per-cell field-synth domain coordinate is an exact affine function of
// (col,row).
function planeMesh(size = 3): Polygon[] {
  return [{
    vertices: [[-size, -size, 0], [size, -size, 0], [size, size, 0], [-size, size, 0]],
    uvs: [[0, 0], [1, 0], [1, 1], [0, 1]],
    color: "#8fb3d9",
  }];
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

  describe("Phase 2 volumetric/duty/phase params unsupported by the inlined runtime", () => {
    it("rejects space: \"object\"", () => {
      expect(() => buildGlyphFieldSynthStaticExport(mesh(), baseOptions({
        params: { ...baseOptions().params, space: "object" },
      }))).toThrow(/space.*"object"/);
    });

    it("rejects field1: \"linearZ\" on an active voice", () => {
      expect(() => buildGlyphFieldSynthStaticExport(mesh(), baseOptions({
        params: { ...baseOptions().params, field1: "linearZ", amp1: 1 },
      }))).toThrow(/linearZ/);
    });

    it("rejects duty1 !== 0.5 on an active voice", () => {
      expect(() => buildGlyphFieldSynthStaticExport(mesh(), baseOptions({
        params: { ...baseOptions().params, duty1: 0.25, amp1: 1 },
      }))).toThrow(/duty1/);
    });

    it("rejects phase1 !== 0 on an active voice", () => {
      expect(() => buildGlyphFieldSynthStaticExport(mesh(), baseOptions({
        params: { ...baseOptions().params, phase1: 0.3, amp1: 1 },
      }))).toThrow(/phase1/);
    });

    it("rejects originW1 !== 0 on an active voice", () => {
      expect(() => buildGlyphFieldSynthStaticExport(mesh(), baseOptions({
        params: { ...baseOptions().params, originW1: 0.5, amp1: 1 },
      }))).toThrow(/originW1/);
    });

    it("does NOT reject linearZ/duty/phase/originW when the voice carrying them is inactive (amp 0)", () => {
      const result = buildGlyphFieldSynthStaticExport(mesh(), baseOptions({
        params: {
          ...baseOptions().params,
          amp3: 0, field3: "linearZ", duty3: 0.1, phase3: 0.7, originW3: 0.9,
        },
      }));
      expect(result.js).toContain("requestAnimationFrame");
    });

    it("existing green cases (default duty/phase/originW, non-object space) still export", () => {
      const result = buildGlyphFieldSynthStaticExport(mesh(), baseOptions());
      expect(result.js).toContain("requestAnimationFrame");
    });
  });

  it("a flat, head-on, fully-covered plane drops the per-cell table entirely: no DATA at all", () => {
    const result = buildGlyphFieldSynthStaticExport(planeMesh(), baseOptions({
      rotX: 0,
      rotY: 0,
      zoom: 150,
      cols: 24,
      rows: 12,
    }));
    // A flat, evenly-lit, fully-covered, head-on plane hoists every per-cell
    // field it bakes (coords → affine scalars, shade → a constant, cx/cy →
    // constants, col/row → derivable from the loop index, base → unread) —
    // nothing is left for `DATA` to carry, so `var DATA=` is omitted
    // entirely rather than emitted as `{}`.
    expect(result.js).not.toMatch(/var DATA=/);
    expect(result.js).toMatch(/^var CFG=/);

    const cfgMatch = result.js.match(/var CFG=(\{.*\});\s*"use strict"/s);
    expect(cfgMatch).not.toBeNull();
    const cfg = JSON.parse(cfgMatch![1]!) as {
      aff: number[] | null; skipBase: boolean; full: boolean; cols: number;
      shFixed: boolean; sh: number; cxFixed: boolean; cyFixed: boolean;
    };

    // 6 fitted scalars driving `x = aff[0]*col + aff[1]*row + aff[2]`
    // (and the `y` analogue) at runtime instead of a per-cell table.
    expect(cfg.aff).not.toBeNull();
    expect(cfg.aff).toHaveLength(6);
    expect(cfg.aff!.every((n) => Number.isFinite(n))).toBe(true);
    expect(cfg.skipBase).toBe(true);
    expect(cfg.full).toBe(true);
    expect(cfg.cols).toBe(24);
    expect(cfg.shFixed).toBe(true);
    expect(cfg.cxFixed).toBe(true);
    expect(cfg.cyFixed).toBe(true);
    expect(result.js).toContain("var col0=C.full?k%C.cols:D.c[k],row0=C.full?(k/C.cols)|0:D.r[k];");
    expect(result.js).toContain("C.aff?C.aff[0]*col0+C.aff[1]*row0+C.aff[2]:D.x[k]");
    expect(result.js).toContain("typeof DATA<\"u\"?DATA:0");
  });

  it("a curved surface (sphere) keeps the baked per-cell coordinate AND index table — never mis-detected as affine or full", () => {
    const result = buildGlyphFieldSynthStaticExport(mesh(), baseOptions());
    const dataMatch = result.js.match(/var DATA=(\{.*?\});var CFG=/);
    expect(dataMatch).not.toBeNull();
    const data = JSON.parse(dataMatch![1]!) as { c: number[]; r: number[]; x: number[]; y: number[]; bg: string[]; bc: number[] };
    const cfgMatch = result.js.match(/var CFG=(\{.*\});\s*"use strict"/s);
    const cfg = JSON.parse(cfgMatch![1]!) as { aff: number[] | null; skipBase: boolean; full: boolean };

    expect(cfg.aff).toBeNull();
    expect(cfg.skipBase).toBe(false);
    expect(cfg.full).toBe(false);
    // Sparse (silhouette-gapped) bakes genuinely need the per-cell index
    // table — there's no formula for "which cells are covered".
    expect(Array.isArray(data.c)).toBe(true);
    expect(Array.isArray(data.r)).toBe(true);
    expect(data.c.length).toBeGreaterThan(0);
    expect(data.c.length).toBe(data.r.length);
    expect(Array.isArray(data.x)).toBe(true);
    expect(Array.isArray(data.y)).toBe(true);
    expect(data.x.length).toBeGreaterThan(0);
    expect(Array.isArray(data.bg)).toBe(true);
    expect(Array.isArray(data.bc)).toBe(true);
  });

  it("a partially-covered plane (not filling the grid) keeps the index table and base grid even though coordinates are still affine", () => {
    const result = buildGlyphFieldSynthStaticExport(planeMesh(), baseOptions({
      rotX: 0,
      rotY: 0,
      zoom: 40, // small enough that the quad doesn't fill the 24x12 grid
      cols: 24,
      rows: 12,
    }));
    const dataMatch = result.js.match(/var DATA=(\{.*?\});var CFG=/);
    expect(dataMatch).not.toBeNull();
    const data = JSON.parse(dataMatch![1]!) as Record<string, unknown>;
    const cfgMatch = result.js.match(/var CFG=(\{.*\});\s*"use strict"/s);
    const cfg = JSON.parse(cfgMatch![1]!) as { aff: number[] | null; skipBase: boolean; full: boolean };

    // Coordinates are still an exact affine function of (col,row) on a flat
    // plane regardless of how much of the grid it covers.
    expect(cfg.aff).not.toBeNull();
    expect(data.x).toBeUndefined();
    // But it's not fully covered, so the index table stays (col/row can't be
    // derived from the loop index without a formula for which cells exist).
    expect(cfg.full).toBe(false);
    expect(Array.isArray(data.c)).toBe(true);
    expect((data.c as unknown[]).length).toBeGreaterThan(0);
    // The base is genuinely needed here too (uncovered cells fall back to
    // it), so it must NOT be skipped.
    expect(cfg.skipBase).toBe(false);
    expect(data.bg).toBeDefined();
    expect(data.bc).toBeDefined();
  });

  it("opacity < 1 with a fully-covered `replace` plane drops the index table (still fully covered) but keeps the base grid (input genuinely still shows through)", () => {
    const result = buildGlyphFieldSynthStaticExport(planeMesh(), baseOptions({
      rotX: 0,
      rotY: 0,
      zoom: 150,
      cols: 24,
      rows: 12,
      opacity: 0.5,
    }));
    const dataMatch = result.js.match(/var DATA=(\{.*?\});var CFG=/);
    expect(dataMatch).not.toBeNull();
    const data = JSON.parse(dataMatch![1]!) as Record<string, unknown>;
    const cfgMatch = result.js.match(/var CFG=(\{.*\});\s*"use strict"/s);
    const cfg = JSON.parse(cfgMatch![1]!) as { skipBase: boolean; full: boolean };

    expect(cfg.full).toBe(true);
    expect(cfg.skipBase).toBe(false);
    // Fully covered, so the index table is still droppable independent of
    // whether the base is skipped.
    expect(data.c).toBeUndefined();
    expect(data.r).toBeUndefined();
    expect(data.bg).toBeDefined();
    expect(data.bc).toBeDefined();
  });
});
