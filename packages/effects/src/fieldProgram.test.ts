import { describe, expect, it } from "vitest";
import {
  evaluateFieldProgram,
  marchField,
  SYNTH_FIELDS,
  synthWave,
  type FieldLayer,
  type FieldProgram,
  type FieldVoice,
} from "./fieldProgram";

function voice(overrides: Partial<FieldVoice> = {}): FieldVoice {
  return {
    field: "linearX",
    wave: "sin",
    freq: 1,
    speed: 0,
    amp: 1,
    phase: 0,
    duty: 0.5,
    angle: 0,
    origin: { u: 0, v: 0, w: 0 },
    color: "#ffffff",
    ...overrides,
  };
}

function singleLayerProgram(voices: readonly FieldVoice[], combine = "add", domain: "2d" | "3d" = "2d"): FieldProgram {
  const layer: FieldLayer = { voices, combine, thresholdOn: false, threshold: 0, invert: false, blend: "multiply", amp: 1 };
  return { domain, layers: [layer] };
}

describe("SYNTH_FIELDS", () => {
  it("appends linearZ at the end — append-only ordering (the /synth URL codec encodes enum values by index)", () => {
    expect(SYNTH_FIELDS).toEqual(["radial", "linearX", "linearY", "diagonal", "angular", "spiral", "noise", "linearZ"]);
  });
});

describe("synthWave duty", () => {
  it("shapes only the square wave's high fraction; default 0.5 matches the pre-duty p<0.5 split", () => {
    expect(synthWave("square", 0.3)).toBe(1); // default duty 0.5: 0.3 < 0.5
    expect(synthWave("square", 0.3, 0.5)).toBe(1);
    expect(synthWave("square", 0.7)).toBe(-1); // default duty 0.5: 0.7 >= 0.5
    // A duty of 0.2 moves the high/low split: 0.3 is now past it.
    expect(synthWave("square", 0.3, 0.2)).toBe(-1);
    expect(synthWave("square", 0.1, 0.2)).toBe(1);
  });

  it("is ignored by every non-square wave kind", () => {
    for (const kind of ["sin", "triangle", "saw"] as const) {
      expect(synthWave(kind, 0.37, 0.1)).toBe(synthWave(kind, 0.37, 0.9));
      expect(synthWave(kind, 0.37, 0.1)).toBe(synthWave(kind, 0.37));
    }
  });
});

describe("evaluateFieldProgram: phase", () => {
  it("adds phase (in cycles) to the wave argument for every field/wave kind; default 0 is a no-op", () => {
    for (const wave of ["sin", "triangle", "saw", "square"] as const) {
      for (const phase of [0, 0.15, -1 / 3]) {
        // freq 0 makes the field spatially uniform (raw*freq = 0); speed -1
        // turns `time` directly into the wave argument, isolating phase's
        // effect from the spatial field math (mirrors stock.test.ts's own
        // waveform-shape test).
        const program = singleLayerProgram([voice({ field: "linearX", wave, freq: 0, speed: -1, phase })]);
        const time = 0.4;
        const result = evaluateFieldProgram(program, 5, 5, 0, time);
        const expected = synthWave(wave, time + phase);
        expect(result.combined).toBeCloseTo(expected, 10);
      }
    }
  });

  it("noise ignores phase (it has no synthWave 'wave argument' to add it to)", () => {
    const withoutPhase = evaluateFieldProgram(singleLayerProgram([voice({ field: "noise", freq: 2, speed: 0, phase: 0 })]), 0.3, 0.7, 0, 1.1);
    const withPhase = evaluateFieldProgram(singleLayerProgram([voice({ field: "noise", freq: 2, speed: 0, phase: 0.42 })]), 0.3, 0.7, 0, 1.1);
    expect(withPhase.combined).toBe(withoutPhase.combined);
  });
});

describe("evaluateFieldProgram: the 2D path is a separate branch, not z=0 through one formula", () => {
  it("diagonal: 2D keeps (x+y)/√2, volumetric uses (x+y+z)/√3 — they disagree even at z=0", () => {
    const x = 3, y = 4;
    const program2D = singleLayerProgram([voice({ field: "diagonal", wave: "sin", freq: 1, speed: 0 })]);
    const program3D = singleLayerProgram([voice({ field: "diagonal", wave: "sin", freq: 1, speed: 0 })], "add", "3d");
    const result2D = evaluateFieldProgram(program2D, x, y, 0, 0, 0, 0, 0);
    const result3D = evaluateFieldProgram(program3D, x, y, 0, 0, 0, 0, 0);
    const expected2D = synthWave("sin", ((x + y) * 0.70710678) * 1);
    const expected3D = synthWave("sin", ((x + y + 0) / Math.sqrt(3)) * 1);
    expect(result2D.combined).toBeCloseTo(expected2D, 6);
    expect(result3D.combined).toBeCloseTo(expected3D, 6);
    expect(result2D.combined).not.toBeCloseTo(result3D.combined, 3);
  });

  it("radial: 2D ignores z, volumetric is the spherical distance from origin", () => {
    // Point A is offset only in X/Y; point B has the SAME planar (x,y) as the
    // origin but is offset purely along Z. A 2D (planar) radial reads these
    // as very different distances; a spherical (volumetric) radial can be
    // made to read them as equal by picking |A| == |B|.
    // freq 0.29 avoids the coincidence where sin(distance*freq*2*PI) happens
    // to land on a zero crossing for the distance-5 case (distance 0 always
    // gives sin(0)=0 regardless of freq, since radial's raw value is 0 there).
    const program2D = singleLayerProgram([voice({ field: "radial", wave: "sin", freq: 0.29, speed: 0 })]);
    const program3D = singleLayerProgram([voice({ field: "radial", wave: "sin", freq: 0.29, speed: 0 })], "add", "3d");
    const twoD_A = evaluateFieldProgram(program2D, 3, 4, 0, 0, 0, 0, 0); // planar distance 5
    const twoD_B = evaluateFieldProgram(program2D, 0, 0, 5, 0, 0, 0, 0); // planar distance 0
    expect(twoD_B.combined).toBe(0);
    expect(Math.abs(twoD_A.combined)).toBeGreaterThan(0.2);
    expect(twoD_A.combined).not.toBeCloseTo(twoD_B.combined, 1);

    const threeD_A = evaluateFieldProgram(program3D, 3, 4, 0, 0, 0, 0, 0); // spherical distance 5
    const threeD_B = evaluateFieldProgram(program3D, 0, 0, 5, 0, 0, 0, 0); // spherical distance 5
    expect(threeD_A.combined).toBeCloseTo(threeD_B.combined, 6);
  });

  it("linearZ: no 2D meaning — falls back to the same default (radial) an unrecognized field already gets; volumetric reads z directly", () => {
    const program2D = singleLayerProgram([voice({ field: "linearZ", wave: "sin", freq: 2, speed: 0 })]);
    const program3D = singleLayerProgram([voice({ field: "linearZ", wave: "sin", freq: 2, speed: 0 })], "add", "3d");
    const twoD = evaluateFieldProgram(program2D, 3, 4, 7, 0, 0, 0, 0);
    const radialProgram = singleLayerProgram([voice({ field: "radial", wave: "sin", freq: 2, speed: 0 })]);
    const twoDRadial = evaluateFieldProgram(radialProgram, 3, 4, 7, 0, 0, 0, 0);
    expect(twoD.combined).toBeCloseTo(twoDRadial.combined, 10);

    const threeD = evaluateFieldProgram(program3D, 3, 4, 0.6, 0, 0, 0, 0);
    const expected = synthWave("sin", 0.6 * 2);
    expect(threeD.combined).toBeCloseTo(expected, 6);
  });

  it("noise: 2D keeps synthNoise3(x,y,time), volumetric uses a genuinely 4D hash that varies with z", () => {
    const program2D = singleLayerProgram([voice({ field: "noise", freq: 3, speed: 0.5 })]);
    const program3D = singleLayerProgram([voice({ field: "noise", freq: 3, speed: 0.5 })], "add", "3d");
    const twoD = evaluateFieldProgram(program2D, 1.7, 2.3, 0, 0.9, 0, 0, 0);
    const twoDAgain = evaluateFieldProgram(program2D, 1.7, 2.3, 999, 0.9, 0, 0, 0); // z ignored in 2D
    expect(twoD.combined).toBe(twoDAgain.combined);

    const threeD_zA = evaluateFieldProgram(program3D, 1.7, 2.3, 0, 0.9, 0, 0, 0);
    const threeD_zB = evaluateFieldProgram(program3D, 1.7, 2.3, 4.2, 0.9, 0, 0, 0);
    expect(threeD_zA.combined).not.toBe(threeD_zB.combined);
    expect(Number.isFinite(threeD_zA.combined)).toBe(true);
    expect(threeD_zA.combined).toBeGreaterThanOrEqual(-1);
    expect(threeD_zA.combined).toBeLessThanOrEqual(1);

    // Deterministic for identical inputs.
    expect(evaluateFieldProgram(program3D, 1.7, 2.3, 4.2, 0.9, 0, 0, 0).combined).toBe(threeD_zB.combined);
  });
});

describe("evaluateFieldProgram: origin resolution", () => {
  it("combines the call-level origin with each voice's own relative origin offset", () => {
    const program = singleLayerProgram([voice({ field: "radial", wave: "sin", freq: 1, speed: 0, origin: { u: 2, v: 0, w: 0 } })]);
    // Voice origin (2, 0, 0) plus call-level origin (3, 0, 0) => absolute
    // centre (5, 0, 0). A point at (5, 0, 0) is then exactly ON that centre
    // (distance 0).
    const atCentre = evaluateFieldProgram(program, 5, 0, 0, 0, 3, 0, 0);
    const expected = synthWave("sin", 0);
    expect(atCentre.combined).toBeCloseTo(expected, 10);
  });

  it("defaults the call-level origin to (0, 0, 0) when omitted", () => {
    const program = singleLayerProgram([voice({ field: "radial", wave: "sin", freq: 1, speed: 0 })]);
    const withDefault = evaluateFieldProgram(program, 3, 4, 0, 0);
    const withExplicitZero = evaluateFieldProgram(program, 3, 4, 0, 0, 0, 0, 0);
    expect(withDefault.combined).toBe(withExplicitZero.combined);
  });
});

describe("evaluateFieldProgram: IR is unbounded — the schema's SYNTH_VOICES=6 is a frontend-only cap", () => {
  it("evaluates a single-layer program of more than 6 voices correctly", () => {
    // 9 unit-amp linearX square voices at distinct frequencies, `add`-folded.
    // Each contributes exactly +1 or -1 (freq*x with x=0 => phase alone), so
    // the fold's mix-weight formula (first voice enters at its own weight,
    // each later voice blends toward combine(stack, voice) by its weight) is
    // independently checkable against a reference implementation that has no
    // 6-voice assumption baked in.
    const n = 9;
    const voices: FieldVoice[] = [];
    for (let k = 0; k < n; k++) {
      // Alternate phase so voices don't all agree (would trivially fold to
      // the same value regardless of whether the loop actually visits all 9).
      voices.push(voice({ field: "linearX", wave: "square", freq: 0, speed: 0, phase: k % 2 === 0 ? 0 : 0.6, amp: 1 }));
    }
    const program = singleLayerProgram(voices, "add");
    const result = evaluateFieldProgram(program, 0, 0, 0, 0);
    expect(result.active).toBe(n);

    // Reference fold, independent of the evaluator's own implementation:
    // `add` combine makes combineSynth(add, a, b) = a + b, and the
    // mix-weight fold with amp=1 for every voice reduces to a plain running
    // sum (combined_k = combined_{k-1} + 1*(combine(combined_{k-1}, o) -
    // combined_{k-1}) = combined_{k-1} + o).
    let expected = 0;
    for (let k = 0; k < n; k++) {
      const o = synthWave("square", k % 2 === 0 ? 0 : 0.6);
      expected += o;
    }
    expect(result.combined).toBeCloseTo(expected, 10);
  });

  it("evaluates a hand-built multi-layer (3 layers x 3 voices) Menger-membership program at depth 3 — the seam proof (VOLUMETRIC.md acceptance 2b)", () => {
    // Unit-domain convention: base-3 digit k of an axis is selected by
    // `freq 3^(k-1)`, `wave: square`, `duty: 1/3`, `phase: -1/3` (the exact
    // "middle third" selector from VOLUMETRIC.md's Step 3). Per scale: three
    // axis voices, `add`-folded (waves output +-1, sum in {-3,-1,1,3}, ">0"
    // means >=2 axes mid); threshold at 0 then invert so solid=+1, hole=-1;
    // layers AND together via `min` (the +-1 AND).
    function scaleLayer(k: number): FieldLayer {
      const freq = 3 ** (k - 1);
      const axisVoice = (field: string): FieldVoice => voice({ field, wave: "square", freq, speed: 0, duty: 1 / 3, phase: -1 / 3, amp: 1 });
      return {
        voices: [axisVoice("linearX"), axisVoice("linearY"), axisVoice("linearZ")],
        combine: "add",
        thresholdOn: true,
        threshold: 0,
        invert: true,
        blend: "min",
        amp: 1,
      };
    }
    const program: FieldProgram = { domain: "3d", layers: [scaleLayer(1), scaleLayer(2), scaleLayer(3)] };

    function mengerSolid(x: number, y: number, z: number, depth: number): boolean {
      let cx = x, cy = y, cz = z;
      for (let d = 0; d < depth; d++) {
        cx *= 3; cy *= 3; cz *= 3;
        const mx = ((cx % 3) + 3) % 3, my = ((cy % 3) + 3) % 3, mz = ((cz % 3) + 3) % 3;
        const midCount = (mx > 1 && mx < 2 ? 1 : 0) + (my > 1 && my < 2 ? 1 : 0) + (mz > 1 && mz < 2 ? 1 : 0);
        if (midCount >= 2) return false;
        cx = cx - Math.floor(cx / 3) * 3; cy = cy - Math.floor(cy / 3) * 3; cz = cz - Math.floor(cz / 3) * 3;
      }
      return true;
    }

    // Sample off the third-boundaries (1/3 is float-inexact): a small offset
    // grid over the unit cube, at scale-3 resolution so depth-3 features are
    // resolvable.
    let checked = 0;
    let solidCount = 0;
    let holeCount = 0;
    for (let ix = 0; ix < 27; ix++) {
      for (let iy = 0; iy < 27; iy++) {
        for (let iz = 0; iz < 27; iz++) {
          const x = (ix + 0.5) / 27;
          const y = (iy + 0.5) / 27;
          const z = (iz + 0.5) / 27;
          const result = evaluateFieldProgram(program, x, y, z, 0, 0, 0, 0);
          const engineIsSolid = result.combined > 0;
          const refIsSolid = mengerSolid(x, y, z, 3);
          expect(engineIsSolid).toBe(refIsSolid);
          checked++;
          if (refIsSolid) solidCount++; else holeCount++;
        }
      }
    }
    expect(checked).toBe(27 * 27 * 27);
    // Sanity: the sampled grid actually contains both solid and hole regions
    // (otherwise the assertion above would pass vacuously).
    expect(solidCount).toBeGreaterThan(0);
    expect(holeCount).toBeGreaterThan(0);
  });
});

describe("evaluateFieldProgram: layer shaping (VOLUMETRIC.md's Step 3)", () => {
  // freq 0 makes the field spatially uniform (raw*freq = 0 regardless of
  // x/y/z), so a 50%-duty square wave's phase alone selects the constant
  // sign — the same trick the "IR is unbounded" 9-voice test above uses.
  function constVoice(sign: 1 | -1): FieldVoice {
    return voice({ field: "linearX", wave: "square", freq: 0, speed: 0, phase: sign === 1 ? 0 : 0.6 });
  }

  function oneLayerProgram(voices: readonly FieldVoice[], overrides: Partial<FieldLayer> = {}): FieldProgram {
    const layer: FieldLayer = { voices, combine: "add", thresholdOn: false, threshold: 0, invert: false, blend: "multiply", amp: 1, ...overrides };
    return { domain: "2d", layers: [layer] };
  }

  it("threshold outputs strictly +-1 at the v>t boundary, never {0,1}", () => {
    // add-fold of +1 and -1 => combined exactly 0, which is NOT > 0 (the
    // boundary case a {0,1} indicator could get wrong).
    const atBoundary = oneLayerProgram([constVoice(1), constVoice(-1)], { thresholdOn: true, threshold: 0 });
    expect(evaluateFieldProgram(atBoundary, 0, 0, 0, 0).combined).toBe(-1);

    // add-fold of +1 and +1 => combined exactly 2, which IS > 0.
    const abovePositive = oneLayerProgram([constVoice(1), constVoice(1)], { thresholdOn: true, threshold: 0 });
    expect(evaluateFieldProgram(abovePositive, 0, 0, 0, 0).combined).toBe(1);
  });

  it("invert unconditionally negates, whether threshold is on or off", () => {
    const rawInverted = oneLayerProgram([constVoice(1)], { invert: true });
    expect(evaluateFieldProgram(rawInverted, 0, 0, 0, 0).combined).toBe(-1);

    const thresholdInverted = oneLayerProgram([constVoice(1)], { thresholdOn: true, threshold: 0, invert: true });
    expect(evaluateFieldProgram(thresholdInverted, 0, 0, 0, 0).combined).toBe(-1);
  });

  it("layerAmp is a mix weight entering the stack, mirroring voice.amp one level up", () => {
    // Layer 1 enters the stack raw (value 1); layer 2 (-1) blends toward
    // combine("add", stack, -1) by its own amp — amp 1 lands exactly on the
    // combine result, amp 0.5 lands half-way between the pre- and post-blend
    // stack value, same mix-weight formula `foldVoices` uses for voice.amp.
    const layer1 = { voices: [constVoice(1)], combine: "add", thresholdOn: false, threshold: 0, invert: false, blend: "multiply", amp: 1 } satisfies FieldLayer;
    const fullAmp: FieldProgram = { domain: "2d", layers: [layer1, { voices: [constVoice(-1)], combine: "add", thresholdOn: false, threshold: 0, invert: false, blend: "add", amp: 1 }] };
    const halfAmp: FieldProgram = { domain: "2d", layers: [layer1, { voices: [constVoice(-1)], combine: "add", thresholdOn: false, threshold: 0, invert: false, blend: "add", amp: 0.5 }] };
    expect(evaluateFieldProgram(fullAmp, 0, 0, 0, 0).combined).toBeCloseTo(0, 10); // combine("add", 1, -1) = 0
    expect(evaluateFieldProgram(halfAmp, 0, 0, 0, 0).combined).toBeCloseTo(0.5, 10); // 1 + 0.5*(0-1)
  });

  it("min-blend performs the +-1 AND across layers — solid overall iff every layer says solid", () => {
    function thresholdLayer(sign: 1 | -1, blend = "add"): FieldLayer {
      return { voices: [constVoice(sign)], combine: "add", thresholdOn: true, threshold: 0, invert: false, blend, amp: 1 };
    }
    const solidSolid: FieldProgram = { domain: "2d", layers: [thresholdLayer(1), thresholdLayer(1, "min")] };
    const solidHole: FieldProgram = { domain: "2d", layers: [thresholdLayer(1), thresholdLayer(-1, "min")] };
    const holeSolid: FieldProgram = { domain: "2d", layers: [thresholdLayer(-1), thresholdLayer(1, "min")] };
    expect(evaluateFieldProgram(solidSolid, 0, 0, 0, 0).combined).toBe(1);
    expect(evaluateFieldProgram(solidHole, 0, 0, 0, 0).combined).toBe(-1);
    expect(evaluateFieldProgram(holeSolid, 0, 0, 0, 0).combined).toBe(-1);
  });

  it("a layer with no active (amp > 0) voices is skipped in the fold, exactly like an amp-0 voice", () => {
    const skippedEmpty: FieldProgram = {
      domain: "2d",
      layers: [
        { voices: [constVoice(1)], combine: "add", thresholdOn: false, threshold: 0, invert: false, blend: "multiply", amp: 1 },
        { voices: [], combine: "add", thresholdOn: false, threshold: 0, invert: false, blend: "multiply", amp: 1 }, // empty
        { voices: [constVoice(-1)], combine: "add", thresholdOn: false, threshold: 0, invert: false, blend: "add", amp: 1 },
      ],
    };
    // If the empty middle layer wrongly entered the multiply-blend fold with
    // a phantom folded value of 0, the whole stack would collapse to 0
    // regardless of the populated layers — this checks it folds layer 1 and
    // layer 3 directly (add(1, -1) = 0 via the THIRD layer's own blend, not
    // an empty-layer-poisoned value).
    const result = evaluateFieldProgram(skippedEmpty, 0, 0, 0, 0);
    expect(result.combined).toBeCloseTo(0, 10);
    expect(result.active).toBe(2); // only the two populated layers' voices count
  });
});

describe("marchField", () => {
  it("hits an analytic slab (sampler > 0 past a known boundary) at the correct parameter and position", () => {
    // Sampler is affine along the ray (a straight x-threshold), so the
    // marcher's linear-interpolation refinement is EXACT, independent of
    // step count.
    const entry: [number, number, number] = [0, 0, 0];
    const exit: [number, number, number] = [10, 0, 0];
    const boundaryX = 6.25;
    const sampler = (x: number) => x - boundaryX;
    const result = marchField(entry, exit, sampler, { steps: 8 });
    expect(result.hit).toBe(true);
    if (result.hit) {
      expect(result.t).toBeCloseTo(boundaryX / 10, 10);
      expect(result.x).toBeCloseTo(boundaryX, 8);
      expect(result.y).toBeCloseTo(0, 10);
      expect(result.z).toBeCloseTo(0, 10);
      expect(result.distance).toBeCloseTo(boundaryX, 8);
    }
  });

  it("returns hit at t=0 when the entry point is already solid", () => {
    const result = marchField([1, 1, 1], [5, 5, 5], () => 1, { steps: 4 });
    expect(result.hit).toBe(true);
    if (result.hit) {
      expect(result.t).toBe(0);
      expect(result.distance).toBe(0);
      expect([result.x, result.y, result.z]).toEqual([1, 1, 1]);
    }
  });

  it("misses when the sampler never crosses into solid along the segment", () => {
    const result = marchField([0, 0, 0], [10, 0, 0], () => -1, { steps: 16 });
    expect(result.hit).toBe(false);
  });

  it("misses a degenerate segment (entry === exit) instead of dividing by zero", () => {
    const result = marchField([2, 3, 4], [2, 3, 4], () => 1, { steps: 8 });
    expect(result.hit).toBe(false);
  });

  it("raises the step count via the Nyquist floor (2 * chordLength * finestFreq), clamped to maxSteps", () => {
    // A sampler that only reports "solid" for a thin band the coarse minimum
    // step count would step over entirely, but a high finestFreq forces
    // enough steps to catch it.
    const entry: [number, number, number] = [0, 0, 0];
    const exit: [number, number, number] = [1, 0, 0];
    // 0.5625 sits squarely between two of the coarse grid's 0.125-spaced
    // sample points (0.5 and 0.625), so an 8-step march genuinely steps over
    // the band rather than clipping it by coincidence.
    const bandCenter = 0.5625;
    const bandHalfWidth = 0.004;
    const sampler = (x: number) => (Math.abs(x - bandCenter) < bandHalfWidth ? 1 : -1);

    const coarse = marchField(entry, exit, sampler, { steps: 8, finestFreq: 0 });
    expect(coarse.hit).toBe(false);

    const fine = marchField(entry, exit, sampler, { steps: 8, finestFreq: 200, maxSteps: 256 });
    expect(fine.hit).toBe(true);
    if (fine.hit) expect(Math.abs(fine.x - bandCenter)).toBeLessThan(bandHalfWidth * 2);
  });

  it("hardens against a NaN sampler value mid-march: never returns NaN hit coordinates (carve's per-cell caller could otherwise emit an unrenderable cell)", () => {
    // The sampler is NaN for x < 3 (poisoning `prevValue` across several
    // marched steps), then a real step function crosses to solid at x = 6 —
    // several finite, non-solid samples (x = 3, 4, 5) intervene between the
    // NaN region and the crossing, so the crossing itself is ordinarily
    // bracketed and this pins plain finite-coordinate hardening, not the
    // NaN-adjacent-bracket case (see the tests below for that).
    const entry: [number, number, number] = [0, 0, 0];
    const exit: [number, number, number] = [10, 0, 0];
    const sampler = (x: number): number => (x < 3 ? NaN : x - 6 > 0 ? 1 : -1);
    const result = marchField(entry, exit, sampler, { steps: 10 });
    expect(result.hit).toBe(true);
    if (result.hit) {
      expect(Number.isFinite(result.t)).toBe(true);
      expect(Number.isFinite(result.distance)).toBe(true);
      expect(Number.isFinite(result.x)).toBe(true);
      expect(Number.isFinite(result.y)).toBe(true);
      expect(Number.isFinite(result.z)).toBe(true);
    }
  });

  it("reports the raw sample position (not an earlier, interpolated one) when the sample immediately before a solid crossing is NaN", () => {
    // Regression for the reviewer's repro: a sampler that is NaN until x = 3
    // and solid from x = 3 on previously reported a hit at x = 2 (the
    // position of the last NaN sample, via `denom` collapsing to NaN and the
    // old `Number.isFinite(denom)` fallback snapping to `prevT`) instead of
    // the correct x = 3 — a false position derived from an invalid bracket.
    let call = 0;
    const sampler = (): number => {
      call++;
      if (call === 1) return -1; // entry sample: not solid
      if (call <= 4) return NaN; // three marched steps poison prevValue
      return 1; // final marched step crosses to solid with prevValue === NaN
    };
    const result = marchField([0, 0, 0], [4, 0, 0], sampler, { steps: 4 });
    expect(result.hit).toBe(true);
    if (result.hit) {
      // Unbracketed: no interpolation, hit lands exactly on the raw solid
      // sample (t = 1, x = 4) — never at the preceding (NaN) sample's t = 0.75.
      expect(result.t).toBe(1);
      expect(result.x).toBe(4);
      expect(result.sampleT).toBe(1);
      expect(result.sampleX).toBe(4);
      expect(result.distance).toBe(4);
      expect(result.sampleDistance).toBe(4);
    }
  });

  it("reports a miss when the sampler is NaN everywhere along the chord (no finite solid sample exists)", () => {
    const result = marchField([0, 0, 0], [10, 0, 0], () => NaN, { steps: 8 });
    expect(result.hit).toBe(false);
  });

  it("does not bridge a false crossing interpolation across a NaN gap: a finite non-solid sample two steps back must not bracket a later solid sample across an intervening NaN", () => {
    // x=0..8, step 1. Two separate NaN gaps (x=2 and x=4) sit between finite
    // non-solid samples (x=1, x=3) and the eventual solid sample (x=5). A
    // fix that merely "skipped" NaN samples and kept reaching back to the
    // last finite value would interpolate a crossing between x=3 (-0.4) and
    // x=5 (1) — landing somewhere around x=3.6, which is not a real
    // position this field ever reported evidence for. The correct contract
    // treats the NaN at x=4 (the sample immediately before the hit) as
    // invalidating the bracket outright: hit at the raw x=5 sample.
    const sampler = (x: number): number => (x === 2 || x === 4 ? NaN : x < 5 ? -1 : 1);
    const result = marchField([0, 0, 0], [8, 0, 0], sampler, { steps: 8 });
    expect(result.hit).toBe(true);
    if (result.hit) {
      expect(result.t).toBeCloseTo(5 / 8, 10);
      expect(result.x).toBeCloseTo(5, 10);
      expect(result.sampleX).toBeCloseTo(5, 10);
    }
  });

  it("P1-B regression: the emission point and the falloff distance describe the same location, not the interpolated crossing vs. the raw sample", () => {
    // Reviewer's exact repro: a threshold field that is 0 before x = 0.5 and
    // 1 from x = 0.5 on, marched in 4 steps over a unit chord. The secant
    // refinement collapses to the bracket's start (`prevValue` is exactly 0
    // at x = 0.25, so `localT = -0/1 = 0`), reporting `distance = 0.25` —
    // but the confirmed-solid raw sample carve actually emits at is x = 0.5.
    // A caller pairing that emission point with the interpolated `distance`
    // (as carve did pre-fix) fades the point as if it were twice as close as
    // it actually is. `sampleDistance` is the fix: it always describes the
    // same point as `sampleX/Y/Z`.
    const sampler = (x: number): number => (x < 0.5 ? 0 : 1);
    const result = marchField([0, 0, 0], [1, 0, 0], sampler, { steps: 4 });
    expect(result.hit).toBe(true);
    if (result.hit) {
      expect(result.distance).toBeCloseTo(0.25, 10);
      expect(result.sampleX).toBeCloseTo(0.5, 10);
      expect(result.sampleDistance).toBeCloseTo(0.5, 10);
      expect(result.sampleDistance).not.toBeCloseTo(result.distance, 5);
    }
  });

  it("never exceeds maxSteps regardless of finestFreq", () => {
    const calls: number[] = [];
    const sampler = (x: number) => { calls.push(x); return -1; };
    marchField([0, 0, 0], [1, 0, 0], sampler, { steps: 8, finestFreq: 1e6, maxSteps: 32 });
    // entry sample + up to `maxSteps` marched samples.
    expect(calls.length).toBeLessThanOrEqual(33);
  });
});
