// @vitest-environment node
//
// The 3D static exit's own target x charset x colour matrix (packet C3's
// own acceptance: "the target x charset x colour matrix keeps working in
// 3D... faithfully downgrading with a visible note, never silently"),
// mirroring `chartsWorkbenchRender.targetMatrix.test.ts`'s node-level shape
// for the 2D exit. Every cell must either succeed outright or degrade with
// a ledger entry — never throw.
import { describe, expect, it } from "vitest";
import { CHART_CHARSETS, CHART_COLORS, CHART_TARGETS } from "./chartsWorkbenchState";
import { renderCharts3dStatic } from "./chartsWorkbench3dRender";
import { createCharts3dViewState } from "./chartsWorkbench3d";

const VIEW = createCharts3dViewState();
const BRAILLE_RANGE = /[⠀-⣿]/;

describe("renderCharts3dStatic — target x charset x colour matrix", () => {
  it("every combination resolves ok, never throws", () => {
    for (const target of CHART_TARGETS) {
      for (const charset of CHART_CHARSETS) {
        for (const color of CHART_COLORS) {
          const result = renderCharts3dStatic({ view: VIEW, target, charset, color, width: 40, height: 16 });
          expect(result.ok, `${target}/${charset}/${color}`).toBe(true);
        }
      }
    }
  });

  it("braille downgrades to the default ramp with no braille glyphs in the output (glyphcss's solid mode has no braille encoder)", () => {
    for (const target of CHART_TARGETS) {
      const result = renderCharts3dStatic({ view: VIEW, target, charset: "braille", color: "none", width: 40, height: 16 });
      expect(result.ok).toBe(true);
      if (result.ok) expect(BRAILLE_RANGE.test(result.text)).toBe(false);
    }
  });

  it("color: css produces html on every target (mirrors the 2D exit's own C2 fix, AGENTS.md's TargetPreview)", () => {
    for (const target of CHART_TARGETS) {
      const result = renderCharts3dStatic({ view: VIEW, target, charset: "box", color: "css", width: 40, height: 16 });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.html).toBeDefined();
    }
  });

  it("an ANSI colour mode produces SGR-escaped text, and color: none/css never do", () => {
    for (const color of ["ansi16", "ansi256", "truecolor"] as const) {
      const result = renderCharts3dStatic({ view: VIEW, target: "web", charset: "box", color, width: 40, height: 16 });
      expect(result.ok, color).toBe(true);
      if (result.ok) expect(result.text.includes("\x1b[")).toBe(true);
    }
    for (const color of ["none", "css"] as const) {
      const result = renderCharts3dStatic({ view: VIEW, target: "web", charset: "box", color, width: 40, height: 16 });
      expect(result.ok, color).toBe(true);
      if (result.ok) expect(result.text.includes("\x1b[")).toBe(false);
    }
  });

  it("a resolve error (unknown dataset) is reported, never thrown", () => {
    const badView = { ...VIEW, source: { kind: "dataset" as const, id: "no-such-dataset" } };
    const result = renderCharts3dStatic({ view: badView, target: "web", charset: "box", color: "none", width: 40, height: 16 });
    expect(result.ok).toBe(false);
  });
});
