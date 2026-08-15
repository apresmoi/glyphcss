import { describe, expect, it } from "vitest";
import { GlyphFieldSynthEffect as fieldSynth } from "@glyphcss/effects";
import { PYRAMID_STAGE_SIZE, SHAPES, STAGE_HINTS, buildWavePathD, resolveSpaceChange, shapePolys, soloParams, stagePreviewShape, synthDefaults } from "./synthKit";

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

// VOLUMETRIC-2.md §3: STAGE_HINTS is keyed by the imported preset OBJECT's
// identity, not its display name — a name-keyed `Record<string, Hint>` (the
// old `PRESET_DENSITY` shape) would silently drop a hint the moment someone
// renames a preset's `.name`. This proves the binding actually survives a
// rename, not just that the table happens to be a Map.
describe("STAGE_HINTS (VOLUMETRIC-2.md §3, object-keyed stage hints)", () => {
  it("looks up by preset object identity — renaming a preset's display name after the fact doesn't drop its hint", () => {
    const preset = (fieldSynth.presets ?? []).find((p) => p.name === "Menger sponge");
    expect(preset).toBeDefined();
    const before = STAGE_HINTS.get(preset!);
    expect(before).toBeDefined();
    expect(before?.shape).toBe("cube");

    const original = preset!.name;
    (preset as { name: string }).name = "Renamed sponge";
    try {
      // A `Record<string, Hint>` keyed on the OLD name would now miss.
      expect(STAGE_HINTS.get(preset!)).toBe(before);
      expect(stagePreviewShape(preset!)).toBe("cube");
    } finally {
      (preset as { name: string }).name = original;
    }
  });

  it("every shipped stage-hinted preset resolves through STAGE_HINTS, and an un-hinted preset falls back to the space-derived default", () => {
    const menger = (fieldSynth.presets ?? []).find((p) => p.name === "Menger sponge")!;
    const sierpinski = (fieldSynth.presets ?? []).find((p) => p.name === "Sierpinski pyramid")!;
    const gyroid = (fieldSynth.presets ?? []).find((p) => p.name === "Gyroid xray")!;
    const sunburst = (fieldSynth.presets ?? []).find((p) => p.name === "Sunburst")!;
    expect(stagePreviewShape(menger)).toBe("cube");
    expect(stagePreviewShape(sierpinski)).toBe("pyramid");
    expect(stagePreviewShape(gyroid)).toBe("cube");
    // Sunburst has no stage hint and isn't volumetric (`space` defaults away
    // from "object") — falls back to the flat plane.
    expect(STAGE_HINTS.get(sunburst)).toBeUndefined();
    expect(stagePreviewShape(sunburst)).toBe("plane");
  });
});

// VOLUMETRIC-2.md §3: the `pyramid` stage is a binding contract, not
// cosmetics — its vertices must be EXACTLY the uncentered corner tetra
// (0,0,0), (s,0,0), (0,s,0), (0,0,s), not a centered variant (the "solid
// mass in the wrong octants" failure mode stock.test.ts's own stage-
// alignment counter-case pins on the effects side).
describe("shapePolys(\"pyramid\") (VOLUMETRIC-2.md §3, uncentered corner tetra)", () => {
  it("is appended at the END of the shape enum (append-only — URL-index-encoded)", () => {
    expect(SHAPES[SHAPES.length - 1]).toBe("pyramid");
  });

  it("produces exactly 4 triangular faces with vertices at the origin and the three axis corners at s = PYRAMID_STAGE_SIZE — not recentered", () => {
    const polys = shapePolys("pyramid") as unknown as { vertices: [number, number, number][] }[];
    expect(polys.length).toBe(4);
    const s = PYRAMID_STAGE_SIZE;
    const expected: [number, number, number][] = [[0, 0, 0], [s, 0, 0], [0, s, 0], [0, 0, s]];
    const seen = new Set<string>();
    for (const face of polys) {
      expect(face.vertices.length).toBe(3);
      for (const v of face.vertices) seen.add(v.join(","));
    }
    for (const v of expected) expect(seen.has(v.join(","))).toBe(true);
    expect(seen.size).toBe(4); // exactly these four points, no others

    // Uncentered: the bounding box spans [0, s] on every axis, not
    // [-s/2, s/2] — its centroid sits well away from the origin, unlike
    // every OTHER stage shape (which centers on `center`, default [0,0,0]).
    let minc = Infinity, maxc = -Infinity;
    for (const v of seen) for (const n of v.split(",").map(Number)) { if (n < minc) minc = n; if (n > maxc) maxc = n; }
    expect(minc).toBe(0);
    expect(maxc).toBe(s);
  });
});
