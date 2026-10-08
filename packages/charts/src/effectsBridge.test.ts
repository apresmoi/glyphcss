/**
 * `composeGlyphChartEffects` (AGENTS.md "Charts" §8 "Effects on a 2D
 * chart", packet F3) — the charts-side half of the compositor gate.
 * Compositor-level mechanics (coverage, the tagged rejection, the nine
 * stock effects, determinism) are covered in glyphcss's own
 * `composeGlyphEffects.test.ts` and `@glyphcss/effects`' `composeOnChart.test.ts`;
 * these tests are specific to what a CHART hands the compositor: ink-derived
 * `baseShade`, plot-rect-normalized `uv0`, an untouched original `build`,
 * and the `canvas === colorCanvas` reuse.
 */
import { describe, expect, it } from "vitest";
import {
  defineGlyphEffect,
  GLYPH_EFFECT_REQUIREMENT_UNAVAILABLE,
  GlyphEffectOutputChannel,
  GlyphEffectRequirementUnavailableError,
  type GlyphEffectLayerOptions,
} from "glyphcss";
import { GlyphScrambleEffect } from "@glyphcss/effects";
import { buildGlyphChart, encodeGlyphChart } from "./render";
import { composeGlyphChartEffects } from "./effectsBridge";
import { glyphChartLine } from "./spec";

const GLYPH = GlyphEffectOutputChannel.Glyph;

function lineBuild() {
  return buildGlyphChart(glyphChartLine([3, 5, 2, 8]), { target: "chat", width: 20, height: 8, color: "none" });
}

const paintZ = defineGlyphEffect<{ phase: number }>({
  evaluate({ target, output }) {
    for (let i = 0; i < output.coverage.length; i++) {
      if (target.coverage[i]! <= 0) continue;
      output.glyph[i] = "Z";
      output.coverage[i] = 1;
      output.channels[i] = GLYPH;
    }
  },
});

describe("composeGlyphChartEffects", () => {
  it("actually changes the encoded text when a layer paints something", () => {
    const build = lineBuild();
    const before = encodeGlyphChart(build, "text");
    const composed = composeGlyphChartEffects(build, [{ effect: paintZ, params: { phase: 0 }, blend: "replace", target: "viewport" }]);
    const after = encodeGlyphChart(composed, "text");
    expect(after).not.toBe(before);
    expect(after).toContain("Z");
  });

  it("never mutates the original build — encoding it again after composing reproduces the same text", () => {
    const build = lineBuild();
    const before = encodeGlyphChart(build, "text");
    composeGlyphChartEffects(build, [{ effect: paintZ, params: { phase: 0 }, blend: "replace", target: "viewport" }]);
    expect(encodeGlyphChart(build, "text")).toBe(before);
  });

  it("baseShade reflects the canvas's own ink coverage — painted cells report 1, blank cells report 0", () => {
    const build = lineBuild();
    const seen: number[] = [];
    const probe = defineGlyphEffect<{ phase: number }>({
      optionalRequirements: ["baseShade"],
      evaluate({ base, target, output }) {
        for (let i = 0; i < output.coverage.length; i++) {
          if (target.coverage[i]! <= 0) continue;
          seen.push(base.shade ? base.shade[i]! : Number.NaN);
        }
      },
    });
    composeGlyphChartEffects(build, [{ effect: probe, params: { phase: 0 }, target: "viewport" }]);
    // Every covered cell (target: "viewport" = every cell) reported EXACTLY
    // its own ink state — 0 or 1, never anything continuous/undefined.
    for (const shade of seen) expect(shade === 0 || shade === 1).toBe(true);
    // At least one painted and one blank cell exist on a real line chart.
    expect(seen).toContain(1);
    expect(seen).toContain(0);
  });

  it("baseShade/coverage match canvas.ink exactly, including a painted-but-blank cell (shade: 0) — `grid.char !== \" \"` would wrongly report it as uncovered", () => {
    const build = lineBuild();
    // Paint one cell with a `shade: 0` fill: it counts as ink (contract 5's
    // "a painted cell counts as covered") but its glyph stays blank
    // (`grid.char === " "`), so a char-based predicate reports 0 there
    // while `canvas.ink` correctly reports 1.
    build.canvas.fillRect(0, 0, 0, 0, { fill: { shade: 0 } });
    expect(build.canvas.grid.char[0]).toBe(" ");
    expect(build.canvas.ink[0]).toBe(1);

    const seenAtZero: number[] = [];
    const probe = defineGlyphEffect<{ phase: number }>({
      optionalRequirements: ["baseShade"],
      evaluate({ base, target, output }) {
        if (target.coverage[0]! > 0) seenAtZero.push(base.shade ? base.shade[0]! : Number.NaN);
        // Confirm every OTHER covered cell still matches canvas.ink exactly.
        for (let i = 1; i < output.coverage.length; i++) {
          if (target.coverage[i]! <= 0) continue;
          expect(base.shade ? base.shade[i]! : Number.NaN).toBe(build.canvas.ink[i] ? 1 : 0);
        }
      },
    });
    composeGlyphChartEffects(build, [{ effect: probe, params: { phase: 0 }, target: "viewport" }]);
    expect(seenAtZero).toEqual([1]);
  });

  it("target: \"surfaces\" coverage matches canvas.ink exactly on a painted-but-blank cell — `target: \"viewport\"` can never catch this, since targetCoverageForCell resolves every isBase cell to a flat 1 regardless of ctx.coverage; only \"surfaces\" reads composeGlyphChartEffects' own coverage: inkCoverage(canvas) line", () => {
    const build = lineBuild();
    // Same painted-but-blank cell as the baseShade test above: ink=1,
    // glyph stays " ". Under the fix this cell is INSIDE a "surfaces"
    // target; under the old `grid.char !== " "` predicate it would read as
    // background and be excluded.
    build.canvas.fillRect(0, 0, 0, 0, { fill: { shade: 0 } });
    expect(build.canvas.grid.char[0]).toBe(" ");
    expect(build.canvas.ink[0]).toBe(1);

    // A genuinely untouched background cell — canvas.ink is 0 there under
    // both the fix and the old predicate, so it must stay outside the
    // target either way (this is what proves the probe actually exercises
    // per-cell exclusion, not just "touches everything").
    const blankIndex = build.canvas.grid.char.findIndex((glyph, i) => i !== 0 && glyph === " " && !build.canvas.ink[i]!);
    expect(blankIndex).toBeGreaterThan(-1);

    const touched: number[] = [];
    const probe = defineGlyphEffect<{ phase: number }>({
      evaluate({ target, output }) {
        for (let i = 0; i < output.coverage.length; i++) {
          if (target.coverage[i]! <= 0) continue;
          touched.push(i);
          output.glyph[i] = "Z";
          output.coverage[i] = 1;
          output.channels[i] = GLYPH;
        }
      },
    });
    composeGlyphChartEffects(build, [{ effect: probe, params: { phase: 0 }, target: "surfaces" }]);
    expect(touched).toContain(0);
    expect(touched).not.toContain(blankIndex);
  });

  it("uv0 is finite and plot-rect-normalized inside the plot, NaN outside it (the axis/title margin)", () => {
    const build = lineBuild();
    let sawInsidePlot = false;
    let sawOutsidePlot = false;
    const probe = defineGlyphEffect<{ phase: number }>({
      requirements: ["uv0"],
      evaluate({ base, coordinates, target, output }) {
        for (let i = 0; i < output.coverage.length; i++) {
          if (target.coverage[i]! <= 0) continue;
          const u = base.uv0![i * 2]!;
          const v = base.uv0![i * 2 + 1]!;
          const col = i % coordinates.sceneGridSize[0];
          const row = (i / coordinates.sceneGridSize[0]) | 0;
          const inPlot = col >= build.plot.x0 && col <= build.plot.x1 && row >= build.plot.y0 && row <= build.plot.y1;
          if (inPlot) {
            sawInsidePlot = true;
            expect(u).toBeGreaterThanOrEqual(0);
            expect(u).toBeLessThanOrEqual(1);
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThanOrEqual(1);
          } else {
            sawOutsidePlot = true;
            expect(Number.isFinite(u)).toBe(false);
            expect(Number.isFinite(v)).toBe(false);
          }
        }
      },
    });
    composeGlyphChartEffects(build, [{ effect: probe, params: { phase: 0 }, target: "viewport" }]);
    expect(sawInsidePlot).toBe(true);
    expect(sawOutsidePlot).toBe(true);
  });

  it("rejects a hard requirement a chart grid cannot supply, tagged GLYPH_EFFECT_REQUIREMENT_UNAVAILABLE", () => {
    const build = lineBuild();
    const needsWorldPosition = defineGlyphEffect<{ phase: number }>({
      requirements: ["worldPosition"],
      evaluate() {},
    });
    let caught: unknown;
    try {
      composeGlyphChartEffects(build, [{ effect: needsWorldPosition, params: { phase: 0 } }]);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(GlyphEffectRequirementUnavailableError);
    expect((caught as GlyphEffectRequirementUnavailableError).code).toBe(GLYPH_EFFECT_REQUIREMENT_UNAVAILABLE);
  });

  it("composing twice at the same time gives byte-identical text", () => {
    const build = lineBuild();
    const layers: readonly GlyphEffectLayerOptions[] = [{ effect: paintZ, params: { phase: 0 }, blend: "over", opacity: 0.5, target: "viewport" }];
    const first = encodeGlyphChart(composeGlyphChartEffects(build, layers), "text");
    const second = encodeGlyphChart(composeGlyphChartEffects(build, layers), "text");
    expect(second).toBe(first);
  });

  it("composing a TIME-DEPENDENT stock effect (scramble) twice at the same time gives byte-identical text — a constant custom effect can't catch a hidden non-deterministic source (Date.now(), Math.random(), leftover state) that only shows up when output actually varies with time", () => {
    const build = lineBuild();
    const layers: readonly GlyphEffectLayerOptions[] = [
      { effect: GlyphScrambleEffect, params: { time: 2.71828, amount: 0.9, seed: 7 }, blend: "over", target: "viewport" },
    ];
    const first = encodeGlyphChart(composeGlyphChartEffects(build, layers), "text");
    const second = encodeGlyphChart(composeGlyphChartEffects(build, layers), "text");
    expect(second).toBe(first);
    // Confirm the effect actually did something time-dependent (not a
    // no-op that would make the byte-identity claim vacuous).
    expect(first).not.toBe(encodeGlyphChart(build, "text"));
  });

  it("reuses one compose when canvas and colorCanvas are the same object (color: 'none')", () => {
    const build = lineBuild();
    expect(build.canvas).toBe(build.colorCanvas);
    const composed = composeGlyphChartEffects(build, [{ effect: paintZ, params: { phase: 0 }, target: "viewport" }]);
    expect(composed.canvas).toBe(composed.colorCanvas);
  });

  it("merges an ambient `time` into a definition layer's own params.time when its schema declares one", () => {
    const build = lineBuild();
    const seenTimes: number[] = [];
    const timeSchema = { time: { kind: "number", default: 0 } } as const;
    const probe = {
      id: "test.time-probe",
      version: 1,
      parameterSchema: timeSchema,
      program: defineGlyphEffect<{ time: number }>({
        evaluate({ params }) {
          seenTimes.push(params.time);
        },
      }),
    };
    composeGlyphChartEffects(build, [{ effect: probe }], { time: 42 });
    expect(seenTimes).toEqual([42]);
  });

  it("a caller-supplied params.time on a layer wins over the ambient time", () => {
    const build = lineBuild();
    const seenTimes: number[] = [];
    const timeSchema = { time: { kind: "number", default: 0 } } as const;
    const probe = {
      id: "test.time-probe-explicit",
      version: 1,
      parameterSchema: timeSchema,
      program: defineGlyphEffect<{ time: number }>({
        evaluate({ params }) {
          seenTimes.push(params.time);
        },
      }),
    };
    composeGlyphChartEffects(build, [{ effect: probe, params: { time: 7 } }], { time: 42 });
    expect(seenTimes).toEqual([7]);
  });

  it("never touches a layer with no `time` in its own schema", () => {
    const build = lineBuild();
    expect(() => composeGlyphChartEffects(build, [{ effect: paintZ, params: { phase: 0 } }], { time: 99 })).not.toThrow();
  });
});
