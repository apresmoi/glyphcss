// @vitest-environment node
//
// The 3D static exit's own target x charset x colour matrix (packet C3's
// own acceptance: "the target x charset x colour matrix keeps working in
// 3D... faithfully downgrading with a visible note, never silently"),
// mirroring `chartsWorkbenchRender.targetMatrix.test.ts`'s node-level shape
// for the 2D exit. Every cell must either succeed outright or degrade with
// a ledger entry — never throw.
import { describe, expect, it } from "vitest";
import { glyphChart3dCharsetDegrades } from "@glyphcss/charts/3d";
import { CHART_CHARSETS, CHART_COLORS, CHART_TARGETS } from "../model/chartsWorkbenchState";
import { renderCharts3dStatic } from "./chartsWorkbench3dRender";
import { createCharts3dViewState } from "../model/chartsWorkbench3d";

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

  // Fix round 4 (glyphcss/charts C2 fix round 2, `AGENTS.md`'s "Charts 3D"):
  // braille is no longer an unsupported downgrade — `glyphChart3dCharsetDegrades`
  // (the library's own predicate this page's Charset toggle already reads,
  // `ChartsDock.tsx`) returns `false` for it now, since it resolves to a
  // REAL depth-tested wireframe render (`style: "wireframe"`, glyphcss's
  // braille encoder is wireframe-only) — genuinely different output from
  // `ascii`/`box`, not a faithful downgrade to the same ramp. This test's
  // own premise ("no braille glyphs in the output") was the PRE-fix
  // behaviour; asserting it now would pin a regression back in, not a
  // property. Following the library predicate directly (never a hardcoded
  // charset list, matching `chartsWorkbench3d.test.ts`'s and
  // `Charts3dViewport.lifecycle.test.tsx`'s own idiom) is what keeps this
  // test honest if the library's own supported-charset set changes again.
  it("every charset glyphChart3dCharsetDegrades flags renders WITHOUT the charset's own real glyphs (a faithful downgrade); every charset it does NOT flag renders WITH them", () => {
    for (const target of CHART_TARGETS) {
      for (const charset of CHART_CHARSETS) {
        const result = renderCharts3dStatic({ view: VIEW, target, charset, color: "none", width: 40, height: 16 });
        expect(result.ok, `${target}/${charset}`).toBe(true);
        if (!result.ok) continue;
        if (charset !== "braille") continue; // the one charset this matrix's own text output can check by REGEX (box/ascii glyphs overlap plain punctuation)
        const hasBraille = BRAILLE_RANGE.test(result.text);
        const shouldDegrade = glyphChart3dCharsetDegrades(charset);
        expect(hasBraille, `${target}/${charset}: glyphChart3dCharsetDegrades=${shouldDegrade}`).toBe(!shouldDegrade);
      }
    }
  });

  // MUTATION sanity: `glyphChart3dCharsetDegrades("braille")` really is
  // `false` today (round 2's own fix) — if the library ever re-degrades
  // braille, THIS assertion goes red first, naming exactly which premise
  // moved, rather than the sweep above merely going red with no context.
  it("MUTATION: glyphChart3dCharsetDegrades('braille') is false (braille genuinely renders now) — the premise the sweep above depends on", () => {
    expect(glyphChart3dCharsetDegrades("braille")).toBe(false);
    expect(glyphChart3dCharsetDegrades("blocks")).toBe(true); // the one charset still genuinely unsupported (always-overlaid box/tick geometry disables the halfblock/quadrant encoder)
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
