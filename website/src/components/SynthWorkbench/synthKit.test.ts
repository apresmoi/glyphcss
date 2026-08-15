import { describe, expect, it } from "vitest";
import { GlyphFieldSynthEffect as fieldSynth } from "@glyphcss/effects";
import { buildWavePathD, resolveSpaceChange, soloParams, synthDefaults } from "./synthKit";

// P1-1 — solo previews used to lie for layered patches: soloParams() forced
// the previewed voice onto default layer 1 and default (unshaped) layer
// params, discarding layerN and layerCombine/Threshold/Invert/Blend/Amp. A
// thresholded/inverted layer previewed as if none of that shaping existed.
describe("soloParams", () => {
  it("copies the SOURCE layer's shaping (threshold+invert+blend+combine+amp) onto layer 1", () => {
    const params = {
      ...synthDefaults(),
      amp3: 0.7, field3: "radial", wave3: "sin", freq3: 4, speed3: 1, layer3: 3,
      layerCombine3: "add", layerThresholdOn3: true, layerThreshold3: 0.4,
      layerInvert3: true, layerBlend3: "min", layerAmp3: 0.6,
    };
    const solo = soloParams(params, 3);

    // The previewed voice always lands on layer 1 (a solo preview is a
    // single active voice — every layer folds identically for one voice).
    expect(solo.layer1).toBe(1);
    // ...but layer 1's own shaping must read like the SOURCE layer (3) did,
    // not the flat default a bare `layer1: 1` copy would leave in place.
    expect(solo.layerCombine1).toBe("add");
    expect(solo.layerThresholdOn1).toBe(true);
    expect(solo.layerThreshold1).toBe(0.4);
    expect(solo.layerInvert1).toBe(true);
    expect(solo.layerBlend1).toBe("min");
    expect(solo.layerAmp1).toBe(0.6);
    // The voice's own oscillator params still come along unchanged.
    expect(solo.field1).toBe("radial");
    expect(solo.amp1).toBe(1);
    // Layers 2/3 stay unpopulated — only voice 1 (amp 1) is active.
    expect(solo.amp2).toBe(0);
  });

  it("defaults to layer 1's own (unshaped) params when the source voice never left layer 1", () => {
    const params = { ...synthDefaults(), amp1: 1, field1: "angular" };
    const solo = soloParams(params, 1);
    expect(solo.layer1).toBe(1);
    expect(solo.layerThresholdOn1).toBe(false);
    expect(solo.layerInvert1).toBe(false);
    expect(solo.layerAmp1).toBe(1);
  });
});

// P1-3 — the Mapping dropdown wrote `space` directly, bypassing the 2D/3D
// toggle's validity guard: from {space:"object", render:"carve"}, picking a
// 2D mapping persisted {space:"surface", render:"carve"}, which
// validateParams rejects (carve requires space:"object"). `resolveSpaceChange`
// is the single guard both the toggle and the dropdown now route through.
describe("resolveSpaceChange", () => {
  it("leaving \"object\" forces render back to \"paint\"", () => {
    expect(resolveSpaceChange("surface")).toEqual({ render: "paint" });
    expect(resolveSpaceChange("auto")).toEqual({ render: "paint" });
    expect(resolveSpaceChange("scene")).toEqual({ render: "paint" });
  });

  it("entering \"object\" syncs the stage to the cube shape, not render", () => {
    expect(resolveSpaceChange("object")).toEqual({ shape: "cube" });
  });

  it("repro: object+carve, then Mapping dropdown -> surface yields params that pass validateParams", () => {
    const params = { ...synthDefaults(), space: "object", render: "carve" };
    const change = resolveSpaceChange("surface");
    const next = { ...params, space: "surface", ...(change.render ? { render: change.render } : {}) };

    expect(next.render).toBe("paint");
    expect(() => fieldSynth.program.validateParams?.(next as never)).not.toThrow();
  });

  it("without the fix (writing space directly) the same repro fails validateParams", () => {
    const params = { ...synthDefaults(), space: "object", render: "carve" };
    const next = { ...params, space: "surface" };
    expect(() => fieldSynth.program.validateParams?.(next as never)).toThrow();
  });
});

// VOLUMETRIC-2.md §2: a non-periodic `step` wave swept across the old 0..1
// window (`raw * freq - time*speed + phase`, with `raw` in 0..1) never
// crosses zero for the common freq>0/time=0/phase=0 case, previewing as a
// constant line. `buildWavePathD` must use a symmetric sweep window for
// non-periodic waves instead, so the edge is visible.
describe("buildWavePathD", () => {
  function pathYValues(d: string): number[] {
    return d.trim().split(/\s+/)
      .filter((tok) => tok !== "")
      .map((tok) => Number(tok.replace(/^[ML]/, "")))
      .filter((_, i) => i % 2 === 1); // every other numeric token is a y coordinate (M x y L x y ...)
  }

  it("a step wave at default freq/time/phase is NOT a constant line (the regression this fix targets)", () => {
    const d = buildWavePathD("step", 3, 0, 1, 0, 100, 30);
    const ys = pathYValues(d);
    const distinct = new Set(ys.map((y) => Math.round(y * 100)));
    expect(distinct.size).toBeGreaterThan(1);
  });

  it("a step wave's preview shows both the low and high level (a real edge, not just noise)", () => {
    const d = buildWavePathD("step", 3, 0, 1, 0, 100, 30);
    const ys = pathYValues(d);
    const midY = 15;
    expect(Math.min(...ys)).toBeLessThan(midY - 5); // amp*(-1) side
    expect(Math.max(...ys)).toBeGreaterThan(midY + 5); // amp*(+1) side
  });

  it("a periodic wave (sin) keeps sweeping the un-shifted 0..1 window (unaffected by this fix)", () => {
    const withPhase = buildWavePathD("sin", 1, 0, 1, 0, 100, 30, 0.5, 0);
    // At raw=0 (the first sample), sin's argument is `0*freq - 0 + 0 = 0` ->
    // synthWave("sin", 0) = 0 -> y = midY. Confirms the window still starts
    // at raw=0, not -0.5, for a periodic wave.
    const ys = pathYValues(withPhase);
    expect(ys[0]).toBeCloseTo(15, 5);
  });
});
