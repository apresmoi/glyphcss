import { describe, expect, it } from "vitest";
import {
  buildGlyphFieldDistanceOracle,
  buildGlyphFieldProgram,
  effectiveVoiceFinestFreq,
  evaluateFieldProgram,
  fieldStepCount,
  integrateField,
  marchField,
  marchGlyphFieldSphere,
  mengerFractalSdf,
  sampleFieldVoice,
  sierpinskiFractalSdf,
  validateGlyphFieldProgram,
  SPHERE_MARCH_MAX_STEPS,
  SPHERE_MARCH_OVERSHOOT_EPSILON,
  SPHERE_MARCH_SAFETY,
  SPHERE_MARCH_STALL_ADVANCE,
  SPHERE_MARCH_STALL_STEPS,
  SYNTH_COMBINES,
  SYNTH_FIELDS,
  SYNTH_WAVES,
  synthWave,
  type FieldDistanceSampler,
  type FieldLayer,
  type FieldProgram,
  type FieldSampler,
  type FieldVoice,
} from "./fieldProgram";
// The equivalence-bar tests below compile the REAL "Menger SDF"/"Sierpinski
// SDF" presets (VOLUMETRIC-3.md §3's own fixtures) through the SAME
// params->IR compile field-synth's `evaluate()` uses, instead of a
// hand-rolled program that could drift from what actually ships — the same
// "compile once, evaluate everywhere" discipline `compileFieldSynthProgram`'s
// own doc describes.
import {
  buildFieldSynthVoices,
  compileFieldSynthProgram,
  compileFieldVoices,
  defaultGlyphEffectParams,
  fieldSynth,
  gyroidXrayPreset,
  mengerSdfPreset,
  mengerSpongePreset,
  resolveFieldSynthLayerShapes,
  sierpinskiPyramidPreset,
  sierpinskiSdfPreset,
  type AnyParams,
  type GlyphEffectPreset,
} from "./stock";
// The equivalence-bar tests below harvest REAL objectPosition -> objectExit
// chords from an actual rendered scene (the same "passive observer layer"
// pattern stock.test.ts's own dynamicRequirements test uses) rather than
// synthetic random rays, which measurably over-stress the sphere tracer
// with near-tangent geometry a real camera never produces (see that
// describe block's own findings).
import type { Polygon, Vec3 } from "@glyphcss/core";
import { createGlyphOrthographicCamera, createGlyphScene, defineGlyphEffect } from "glyphcss";

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
  it("appends linearZ, then the SDF family (gyroid, menger, sierpinski) at the end — append-only ordering (the /synth URL codec encodes enum values by index)", () => {
    expect(SYNTH_FIELDS).toEqual([
      "radial", "linearX", "linearY", "diagonal", "angular", "spiral", "noise", "linearZ",
      "gyroid", "menger", "sierpinski",
    ]);
  });
});

describe("SYNTH_WAVES", () => {
  it("appends step at the end — append-only ordering (the /synth URL codec encodes enum values by index)", () => {
    expect(SYNTH_WAVES).toEqual(["sin", "triangle", "saw", "square", "step"]);
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

  it("evaluates a hand-built multi-layer (3 layers x 3 voices) Menger-membership program at depth 3 — the seam proof (VOLUMETRIC.md acceptance 2b), and a `buildGlyphFieldProgram`-built equivalent produces the SAME program (VOLUMETRIC-3.md §4 acceptance 6: builder-built depth-3 program == hand-built IR acceptance output)", () => {
    // Unit-domain convention: base-3 digit k of an axis is selected by
    // `freq 3^(k-1)`, `wave: square`, `duty: 1/3`, `phase: -1/3` (the exact
    // "middle third" selector from VOLUMETRIC.md's Step 3). Per scale: three
    // axis voices, `add`-folded (waves output +-1, sum in {-3,-1,1,3}, ">0"
    // means >=2 axes mid); threshold at 0 then invert so solid=+1, hole=-1;
    // layers AND together via `min` (the +-1 AND).
    function scaleLayer(k: number, sourceIndexBase: number): FieldLayer {
      const freq = 3 ** (k - 1);
      const axisVoice = (field: string, sourceIndex: number): FieldVoice => voice({
        field, wave: "square", freq, speed: 0, duty: 1 / 3, phase: -1 / 3, amp: 1, sourceIndex, iter: 3,
      });
      return {
        voices: [
          axisVoice("linearX", sourceIndexBase),
          axisVoice("linearY", sourceIndexBase + 1),
          axisVoice("linearZ", sourceIndexBase + 2),
        ],
        combine: "add",
        thresholdOn: true,
        threshold: 0,
        invert: true,
        blend: "min",
        amp: 1,
      };
    }
    // `sourceIndex` filled in above (0, 3, 6 per layer) to match
    // `buildGlyphFieldProgram`'s own flat-authoring-order numbering exactly
    // — the ORIGINAL hand-built program (VOLUMETRIC.md acceptance 2b) never
    // set it (irrelevant there, since only `result.combined` was checked,
    // never `result.winner`), but the equality assertion below needs the
    // two programs to agree bit-for-bit.
    const handBuiltProgram: FieldProgram = { domain: "3d", layers: [scaleLayer(1, 0), scaleLayer(2, 3), scaleLayer(3, 6)] };

    // The SAME recipe through the pleasant authoring surface
    // (VOLUMETRIC-3.md §4's program builder) — `buildGlyphFieldProgram`
    // fills every IR default (speed 0, amp 1, angle 0, origin {0,0,0},
    // color "#ffffff", iter 3, and — the one that matters here —
    // `sourceIndex` in flat authoring order) the exact same way the
    // `voice()` test helper above does, so the two programs should come out
    // byte-for-byte identical.
    function builtScaleLayer(k: number) {
      const freq = 3 ** (k - 1);
      const axisVoice = (field: string) => ({ field, wave: "square", freq, duty: 1 / 3, phase: -1 / 3 });
      return {
        voices: [axisVoice("linearX"), axisVoice("linearY"), axisVoice("linearZ")],
        combine: "add",
        thresholdOn: true,
        threshold: 0,
        invert: true,
        blend: "min",
      };
    }
    const builtProgram = buildGlyphFieldProgram({
      domain: "3d",
      layers: [builtScaleLayer(1), builtScaleLayer(2), builtScaleLayer(3)],
    });
    expect(builtProgram).toEqual(handBuiltProgram);

    // The rest of this test runs the SAME behavioral assertions the
    // original hand-built-only version did, now through the builder's own
    // output — proving it's not just structurally equal but behaviorally
    // correct too.
    const program = builtProgram;

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

  it("evaluates a hand-built multi-layer (2 layers x 3 voices) Sierpinski-membership program at depth 3 — the base-2 seam proof (VOLUMETRIC-2.md acceptance 4, \"scale 3 via IR\")", () => {
    // The corner-tetra recipe's binary-ladder sibling of the Menger seam
    // proof above: base-2 digit k of an axis is selected by `freq 2^(k-1)`,
    // `wave: square`, `duty: 1/2`, `phase: -1/2` (upper-half selector,
    // VOLUMETRIC-2.md's addendum), same add/threshold/invert/min shape. The
    // schema-level "Sierpinski pyramid" preset only ships 2 scales (its
    // pyramid stage caps at depth 2 — see stock.ts), so this hand-built
    // 3-layer IR program is the only place depth 3 is exercised at all,
    // proving the IR itself is not limited to the shipped preset's depth.
    function scaleLayer(k: number): FieldLayer {
      const freq = 2 ** (k - 1);
      const axisVoice = (field: string): FieldVoice => voice({ field, wave: "square", freq, speed: 0, duty: 1 / 2, phase: -1 / 2, amp: 1 });
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

    function sierpinskiSolid(x: number, y: number, z: number, depth: number): boolean {
      let cx = x, cy = y, cz = z;
      for (let d = 0; d < depth; d++) {
        cx *= 2; cy *= 2; cz *= 2;
        const mx = ((cx % 2) + 2) % 2, my = ((cy % 2) + 2) % 2, mz = ((cz % 2) + 2) % 2;
        const upperCount = (mx >= 1 ? 1 : 0) + (my >= 1 ? 1 : 0) + (mz >= 1 ? 1 : 0);
        if (upperCount >= 2) return false;
        cx = cx - Math.floor(cx / 2) * 2; cy = cy - Math.floor(cy / 2) * 2; cz = cz - Math.floor(cz / 2) * 2;
      }
      return true;
    }

    // Off the half-boundaries (0.5 is float-exact but the digit boundaries at
    // deeper scales, e.g. 1/4, are not) — offset grid over the unit cube at
    // scale-8 (2^3) resolution so depth-3 features are resolvable.
    let checked = 0;
    let solidCount = 0;
    let holeCount = 0;
    for (let ix = 0; ix < 24; ix++) {
      for (let iy = 0; iy < 24; iy++) {
        for (let iz = 0; iz < 24; iz++) {
          const x = (ix + 0.37) / 24;
          const y = (iy + 0.37) / 24;
          const z = (iz + 0.37) / 24;
          const result = evaluateFieldProgram(program, x, y, z, 0, 0, 0, 0);
          const engineIsSolid = result.combined > 0;
          const refIsSolid = sierpinskiSolid(x, y, z, 3);
          expect(engineIsSolid).toBe(refIsSolid);
          checked++;
          if (refIsSolid) solidCount++; else holeCount++;
        }
      }
    }
    expect(checked).toBe(24 * 24 * 24);
    // Sanity: the sampled grid actually contains both solid and hole regions
    // (otherwise the assertion above would pass vacuously).
    expect(solidCount).toBeGreaterThan(0);
    expect(holeCount).toBeGreaterThan(0);
  });
});

describe("buildGlyphFieldProgram (VOLUMETRIC-3.md §4, program builder)", () => {
  it("fills every IR default field-synth's own schema uses for an untouched layer/voice", () => {
    const program = buildGlyphFieldProgram({ layers: [{ voices: [{ field: "radial", wave: "sin", freq: 3 }] }] });
    expect(program).toEqual({
      domain: "2d",
      layers: [{
        voices: [{
          field: "radial", wave: "sin", freq: 3, speed: 0, amp: 1, phase: 0, duty: 0.5, angle: 0,
          origin: { u: 0, v: 0, w: 0 }, color: "#ffffff", iter: 3, sourceIndex: 0,
        }],
        combine: "multiply", thresholdOn: false, threshold: 0, invert: false, blend: "multiply", amp: 1,
      }],
    });
  });

  it("numbers sourceIndex in FLAT authoring order across layers (not per-layer, and not reset per layer)", () => {
    const program = buildGlyphFieldProgram({
      layers: [
        { voices: [{ field: "radial", wave: "sin", freq: 1 }, { field: "angular", wave: "sin", freq: 2 }] },
        { voices: [{ field: "spiral", wave: "sin", freq: 3 }] },
      ],
    });
    expect(program.layers[0]!.voices.map((v) => v.sourceIndex)).toEqual([0, 1]);
    expect(program.layers[1]!.voices.map((v) => v.sourceIndex)).toEqual([2]);
  });

  it("honors every explicit override, including the layer's own `mix` -> FieldLayer.amp rename", () => {
    const program = buildGlyphFieldProgram({
      domain: "3d",
      layers: [{
        voices: [{
          field: "menger", wave: "step", freq: 0.5, speed: 0.1, amp: 0.7, phase: 0.2, duty: 0.3, angle: 45,
          originU: 0.1, originV: 0.2, originW: 0.3, color: "#abcdef", iter: 2,
        }],
        combine: "min", thresholdOn: true, threshold: 0.5, invert: true, blend: "max", mix: 0.6,
      }],
    });
    expect(program.domain).toBe("3d");
    const layer = program.layers[0]!;
    expect(layer.combine).toBe("min");
    expect(layer.thresholdOn).toBe(true);
    expect(layer.threshold).toBe(0.5);
    expect(layer.invert).toBe(true);
    expect(layer.blend).toBe("max");
    expect(layer.amp).toBe(0.6);
    const v = layer.voices[0]!;
    expect(v).toMatchObject({
      field: "menger", wave: "step", freq: 0.5, speed: 0.1, amp: 0.7, phase: 0.2, duty: 0.3, angle: 45,
      origin: { u: 0.1, v: 0.2, w: 0.3 }, color: "#abcdef", iter: 2, sourceIndex: 0,
    });
  });

  it("a built program evaluates correctly through evaluateFieldProgram (not just the IR shape, the runtime seam too)", () => {
    const program = buildGlyphFieldProgram({
      layers: [{ voices: [{ field: "linearX", wave: "square", freq: 1, duty: 0.25, phase: 0 }] }],
    });
    // duty 0.25: solid ("high") for t in [0, 0.25) of each cycle.
    expect(evaluateFieldProgram(program, 0.1, 0, 0, 0).combined).toBe(1);
    expect(evaluateFieldProgram(program, 0.5, 0, 0, 0).combined).toBe(-1);
  });
});

describe("validateGlyphFieldProgram (VOLUMETRIC-3.md §4, program-as-data validator)", () => {
  function validProgram(): FieldProgram {
    return buildGlyphFieldProgram({
      layers: [{ voices: [{ field: "radial", wave: "sin", freq: 3 }] }],
    });
  }

  it("accepts a builder-built program", () => {
    expect(() => validateGlyphFieldProgram(validProgram())).not.toThrow();
  });

  it("accepts a hand-built program with every optional field present", () => {
    expect(() => validateGlyphFieldProgram({
      domain: "3d",
      layers: [{
        voices: [{
          field: "menger", wave: "step", freq: 1, speed: 0, amp: 1, phase: 0, duty: 0.5, angle: 0,
          origin: { u: 0, v: 0, w: 0 }, color: "#fff", iter: 3, sourceIndex: 0,
        }],
        combine: "min", thresholdOn: false, threshold: 0, invert: false, blend: "multiply", amp: 1,
      }],
    })).not.toThrow();
  });

  it.each([undefined, null, 42, "nope", []])("rejects a non-object program (%j)", (bad) => {
    expect(() => validateGlyphFieldProgram(bad)).toThrow(TypeError);
  });

  it("rejects an unrecognized domain", () => {
    const program = { ...validProgram(), domain: "4d" };
    expect(() => validateGlyphFieldProgram(program)).toThrow(/domain/);
  });

  it("rejects a missing/empty layers array", () => {
    expect(() => validateGlyphFieldProgram({ domain: "2d", layers: [] })).toThrow(/layers/);
    expect(() => validateGlyphFieldProgram({ domain: "2d" })).toThrow(/layers/);
  });

  it("rejects a non-array layer.voices", () => {
    const program = validProgram();
    const bad = { ...program, layers: [{ ...program.layers[0]!, voices: "nope" }] };
    expect(() => validateGlyphFieldProgram(bad)).toThrow(/voices/);
  });

  it.each(SYNTH_COMBINES.filter((op) => op !== "argmax"))("accepts every non-argmax layer.combine value (%s)", (combine) => {
    const program = validProgram();
    const ok = { ...program, layers: [{ ...program.layers[0]!, combine }] };
    expect(() => validateGlyphFieldProgram(ok)).not.toThrow();
  });

  it("rejects an unrecognized layer.combine", () => {
    const program = validProgram();
    const bad = { ...program, layers: [{ ...program.layers[0]!, combine: "bogus" }] };
    expect(() => validateGlyphFieldProgram(bad)).toThrow(/combine/);
  });

  it("rejects layer.blend \"argmax\" (layers are value-folded, not selected by identity)", () => {
    const program = validProgram();
    const bad = { ...program, layers: [{ ...program.layers[0]!, blend: "argmax" }] };
    expect(() => validateGlyphFieldProgram(bad)).toThrow(/blend/);
  });

  it("rejects a non-finite layer.threshold/amp", () => {
    const program = validProgram();
    expect(() => validateGlyphFieldProgram({
      ...program, layers: [{ ...program.layers[0]!, threshold: Number.NaN }],
    })).toThrow(/threshold/);
    expect(() => validateGlyphFieldProgram({
      ...program, layers: [{ ...program.layers[0]!, amp: Number.POSITIVE_INFINITY }],
    })).toThrow(/amp/);
  });

  it("rejects an unrecognized voice.field/voice.wave", () => {
    const program = validProgram();
    const badField = { ...program, layers: [{ ...program.layers[0]!, voices: [{ ...program.layers[0]!.voices[0]!, field: "bogus" }] }] };
    expect(() => validateGlyphFieldProgram(badField)).toThrow(/field/);
    const badWave = { ...program, layers: [{ ...program.layers[0]!, voices: [{ ...program.layers[0]!.voices[0]!, wave: "bogus" }] }] };
    expect(() => validateGlyphFieldProgram(badWave)).toThrow(/wave/);
  });

  it("rejects a non-finite voice numeric field", () => {
    const program = validProgram();
    for (const key of ["freq", "speed", "amp", "phase", "duty", "angle"] as const) {
      const bad = {
        ...program,
        layers: [{ ...program.layers[0]!, voices: [{ ...program.layers[0]!.voices[0]!, [key]: Number.NaN }] }],
      };
      expect(() => validateGlyphFieldProgram(bad), key).toThrow();
    }
  });

  it("rejects a malformed voice.origin", () => {
    const program = validProgram();
    const bad = { ...program, layers: [{ ...program.layers[0]!, voices: [{ ...program.layers[0]!.voices[0]!, origin: { u: 0, v: 0 } }] }] };
    expect(() => validateGlyphFieldProgram(bad)).toThrow(/origin/);
  });

  it("rejects a non-string/empty voice.color", () => {
    const program = validProgram();
    const bad = { ...program, layers: [{ ...program.layers[0]!, voices: [{ ...program.layers[0]!.voices[0]!, color: "" }] }] };
    expect(() => validateGlyphFieldProgram(bad)).toThrow(/color/);
  });

  it("rejects a negative or non-integer voice.sourceIndex when present", () => {
    const program = validProgram();
    const negative = { ...program, layers: [{ ...program.layers[0]!, voices: [{ ...program.layers[0]!.voices[0]!, sourceIndex: -1 }] }] };
    expect(() => validateGlyphFieldProgram(negative)).toThrow(/sourceIndex/);
    const fractional = { ...program, layers: [{ ...program.layers[0]!, voices: [{ ...program.layers[0]!.voices[0]!, sourceIndex: 1.5 }] }] };
    expect(() => validateGlyphFieldProgram(fractional)).toThrow(/sourceIndex/);
  });
});

describe("synthWave: step (VOLUMETRIC-2.md §2, non-periodic)", () => {
  it("thresholds at 0: +1 when t >= 0, else -1", () => {
    expect(synthWave("step", -0.001)).toBe(-1);
    expect(synthWave("step", 0)).toBe(1);
    expect(synthWave("step", 0.001)).toBe(1);
    expect(synthWave("step", -50)).toBe(-1);
    expect(synthWave("step", 50)).toBe(1);
  });

  it("phase shifts the threshold (it's added to t before the caller ever reaches synthWave, so this exercises the same knob a voice's phase drives)", () => {
    // A voice adds phase to the wave argument, so probing synthWave directly
    // at t + phase is exactly equivalent.
    const t = 0.3;
    expect(synthWave("step", t + -0.4)).toBe(-1); // 0.3 - 0.4 = -0.1 < 0
    expect(synthWave("step", t + -0.2)).toBe(1); // 0.3 - 0.2 = 0.1 >= 0
  });

  it("duty is ignored (a step has no cycle to shape)", () => {
    expect(synthWave("step", 0.5, 0)).toBe(synthWave("step", 0.5, 1));
    expect(synthWave("step", -0.5, 0)).toBe(synthWave("step", -0.5, 1));
  });

  it("is non-periodic: unlike every other wave, output does not repeat every 1 cycle", () => {
    // A periodic wave (e.g. sin) folds t into 0..1 first, so t and t+1 always
    // agree. Step does not fold: crossing exactly one full "cycle" past the
    // threshold does not un-cross it.
    expect(synthWave("step", -0.5)).toBe(-1);
    expect(synthWave("step", -0.5 + 1)).toBe(1); // would still be -1 if step folded like a periodic wave
    expect(synthWave("step", -0.5 + 100)).toBe(1);
  });
});

// Depth-`iter` first-principles membership references (VOLUMETRIC-2.md §2 /
// its addendum), independent of `mengerFractalSdf`/`sierpinskiFractalSdf` —
// these are hand-derived digit rules, not a re-derivation of the engine's own
// SDF construction, so agreement between the two is a genuine cross-check.
// `mengerSolid` mirrors the "3D seam proof" test above (base-3 middle-third
// digit); `sierpinskiSolid` is its base-2 sibling from the corner-tetra
// recipe (VOLUMETRIC-2.md's addendum: "at every binary scale, at most one
// axis is in its upper half").
function mengerSolidRef(x: number, y: number, z: number, depth: number): boolean {
  let cx = x, cy = y, cz = z;
  for (let d = 0; d < depth; d++) {
    cx *= 3; cy *= 3; cz *= 3;
    const mx = ((cx % 3) + 3) % 3, my = ((cy % 3) + 3) % 3, mz = ((cz % 3) + 3) % 3;
    const midCount = (mx > 1 && mx < 2 ? 1 : 0) + (my > 1 && my < 2 ? 1 : 0) + (mz > 1 && mz < 2 ? 1 : 0);
    if (midCount >= 2) return false;
    cx -= Math.floor(cx / 3) * 3; cy -= Math.floor(cy / 3) * 3; cz -= Math.floor(cz / 3) * 3;
  }
  return true;
}

function sierpinskiSolidRef(x: number, y: number, z: number, depth: number): boolean {
  let cx = x, cy = y, cz = z;
  for (let d = 0; d < depth; d++) {
    cx *= 2; cy *= 2; cz *= 2;
    const mx = ((cx % 2) + 2) % 2, my = ((cy % 2) + 2) % 2, mz = ((cz % 2) + 2) % 2;
    const upperCount = (mx >= 1 ? 1 : 0) + (my >= 1 ? 1 : 0) + (mz >= 1 ? 1 : 0);
    if (upperCount >= 2) return false;
    cx -= Math.floor(cx / 2) * 2; cy -= Math.floor(cy / 2) * 2; cz -= Math.floor(cz / 2) * 2;
  }
  return true;
}

describe("sampleFieldVoice: SDF voice family (VOLUMETRIC-2.md §2, acceptance 5)", () => {
  // The engine reads `menger`/`sierpinski` as `raw = -sdf`, so a solid point
  // (sdf < 0) reads `raw > 0`; at phase 0/speed 0/time 0, `t = raw`, so
  // `t > 0` is "solid" per the engine. Uses `wave: "step"` explicitly
  // (P1-A fixer pass): the distance-fidelity rewrite makes `raw` a genuine
  // Euclidean distance, no longer bounded near [-0.5, 0.5] the way the old
  // CSG-max approximation happened to stay — the DEFAULT `sin` wave this
  // helper used to rely on wraps sign every half cycle, so a `|raw| > 0.5`
  // point (routine now, e.g. deep inside a large kept region) can read
  // `sin(2*pi*t) > 0` while `t < 0`. `step` (`t >= 0 ? 1 : -1`) is what every
  // real SDF preset actually uses (VOLUMETRIC-2.md §2's `step` section) and
  // is monotonic in sign for any magnitude, which is what this helper's own
  // "t > 0 is solid" contract requires.
  function engineSolid(field: "menger" | "sierpinski", x: number, y: number, z: number, iter: number): boolean {
    const o = sampleFieldVoice(voice({ field, wave: "step", freq: 1, iter }), x, y, z, 0, 0, 0, 0, false);
    return o > 0;
  }

  it("menger(iter 2) sign-agrees with the depth-2 recipe reference on a sampled grid away from band boundaries", () => {
    const N = 27;
    let checked = 0, solidCount = 0, holeCount = 0;
    for (let ix = 0; ix < N; ix++) {
      for (let iy = 0; iy < N; iy++) {
        for (let iz = 0; iz < N; iz++) {
          const x = (ix + 0.37) / N, y = (iy + 0.37) / N, z = (iz + 0.37) / N;
          // Skip points near a depth-2 (1/9) band boundary — 0.37/N keeps the
          // grid off any exact third, but guard defensively anyway.
          let nearBoundary = false;
          for (const c of [x, y, z]) {
            const frac9 = ((c * 9) % 1 + 1) % 1;
            if (frac9 < 0.05 || frac9 > 0.95) nearBoundary = true;
          }
          if (nearBoundary) continue;
          const ref = mengerSolidRef(x, y, z, 2);
          const eng = engineSolid("menger", x, y, z, 2);
          expect(eng).toBe(ref);
          checked++;
          if (ref) solidCount++; else holeCount++;
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
    expect(solidCount).toBeGreaterThan(0);
    expect(holeCount).toBeGreaterThan(0);
  });

  it("sierpinski(iter 2) sign-agrees with the depth-2 corner-tetra recipe reference on a sampled grid away from band boundaries", () => {
    const N = 27;
    let checked = 0, solidCount = 0, holeCount = 0;
    for (let ix = 0; ix < N; ix++) {
      for (let iy = 0; iy < N; iy++) {
        for (let iz = 0; iz < N; iz++) {
          const x = (ix + 0.37) / N, y = (iy + 0.37) / N, z = (iz + 0.37) / N;
          let nearBoundary = false;
          for (const c of [x, y, z]) {
            const frac4 = ((c * 4) % 1 + 1) % 1;
            if (frac4 < 0.05 || frac4 > 0.95) nearBoundary = true;
          }
          if (nearBoundary) continue;
          const ref = sierpinskiSolidRef(x, y, z, 2);
          const eng = engineSolid("sierpinski", x, y, z, 2);
          expect(eng).toBe(ref);
          checked++;
          if (ref) solidCount++; else holeCount++;
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
    expect(solidCount).toBeGreaterThan(0);
    expect(holeCount).toBeGreaterThan(0);
  });

  it("gyroid is 2π-normalized: raw is periodic with period 1 domain unit along every axis (freq 1)", () => {
    const gv = voice({ field: "gyroid", wave: "sin", freq: 1, speed: 0, phase: 0 });
    for (let i = 0; i < 30; i++) {
      const x = Math.random() * 4 - 1, y = Math.random() * 4 - 1, z = Math.random() * 4 - 1;
      const a = sampleFieldVoice(gv, x, y, z, 0, 0, 0, 0, false);
      const bx = sampleFieldVoice(gv, x + 1, y, z, 0, 0, 0, 0, false);
      const by = sampleFieldVoice(gv, x, y + 1, z, 0, 0, 0, 0, false);
      const bz = sampleFieldVoice(gv, x, y, z + 1, 0, 0, 0, 0, false);
      expect(bx).toBeCloseTo(a, 9);
      expect(by).toBeCloseTo(a, 9);
      expect(bz).toBeCloseTo(a, 9);
    }
  });

  it("SDF origin translation moves the fractal: sampling at (origin + p) equals sampling the untranslated field at p", () => {
    // gyroid(0,0,0) = sin(0)cos(0)+sin(0)cos(0)+sin(0)cos(0) = 0 exactly —
    // an analytic zero, no reference implementation needed.
    const gv = voice({ field: "gyroid", wave: "step", freq: 1, speed: 0, phase: 0 });
    // Translated by (0.05, 0.05, 0.6): sampling AT that offset lands exactly
    // on the analytic zero (q = p - origin = 0), so t = 0 -> step = +1.
    const atTranslatedZero = sampleFieldVoice(gv, 0.05, 0.05, 0.6, 0.05, 0.05, 0.6, 0, false);
    expect(atTranslatedZero).toBe(1);
    // A linear field would ignore cx/cy/cz entirely (this exact call would
    // read identically to the untranslated one) — the SDF branch must not:
    // evaluating the SAME absolute point without the origin lands on the
    // gyroid's NEGATIVE side instead, proving the origin genuinely moved the
    // fractal rather than being a no-op.
    const untranslatedSamePoint = sampleFieldVoice(gv, 0.05, 0.05, 0.6, 0, 0, 0, 0, false);
    expect(untranslatedSamePoint).toBe(-1);
    // Translating by the origin is equivalent to shifting the sample point by
    // the SAME amount in the opposite direction with no origin at all.
    const shiftedNoOrigin = sampleFieldVoice(gv, 0, 0, 0, 0, 0, 0, 0, false);
    expect(atTranslatedZero).toBe(shiftedNoOrigin);
  });

  it("phase erodes/dilates the SDF iso-surface (an iso-level offset, not a translation)", () => {
    // gyroid(0,0,0) = 0 exactly (see above) -> t = phase at that point
    // (speed 0, time 0) -> step's threshold sits exactly at phase = 0.
    const below = voice({ field: "gyroid", wave: "step", freq: 1, speed: 0, phase: -0.01 });
    const at = voice({ field: "gyroid", wave: "step", freq: 1, speed: 0, phase: 0 });
    const above = voice({ field: "gyroid", wave: "step", freq: 1, speed: 0, phase: 0.01 });
    expect(sampleFieldVoice(below, 0, 0, 0, 0, 0, 0, 0, false)).toBe(-1); // eroded away
    expect(sampleFieldVoice(at, 0, 0, 0, 0, 0, 0, 0, false)).toBe(1);
    expect(sampleFieldVoice(above, 0, 0, 0, 0, 0, 0, 0, false)).toBe(1); // dilated

    // Broader monotonicity check over a grid: increasing phase never turns a
    // solid cell into a hole (dilation only grows the solid set).
    const loPhaseVoice = voice({ field: "menger", wave: "step", freq: 1, iter: 2, speed: 0, phase: -0.5 });
    const hiPhaseVoice = voice({ field: "menger", wave: "step", freq: 1, iter: 2, speed: 0, phase: 0.5 });
    let anyDifference = false;
    for (let ix = 0; ix < 12; ix++) {
      for (let iy = 0; iy < 12; iy++) {
        for (let iz = 0; iz < 12; iz++) {
          const x = (ix + 0.5) / 12, y = (iy + 0.5) / 12, z = (iz + 0.5) / 12;
          const lo = sampleFieldVoice(loPhaseVoice, x, y, z, 0, 0, 0, 0, false);
          const hi = sampleFieldVoice(hiPhaseVoice, x, y, z, 0, 0, 0, 0, false);
          if (lo === 1) expect(hi).toBe(1); // never erodes a point that was already solid at lower phase
          if (lo !== hi) anyDifference = true;
        }
      }
    }
    expect(anyDifference).toBe(true); // sanity: phase actually moved the boundary somewhere
  });

  it("applies freq exactly ONCE (to the SDF/implicit's own domain argument, not again on the wave argument) — the freq^2 shells regression is the pinned counter-case", () => {
    // Two (x, freq) pairs holding q = x*freq constant must produce IDENTICAL
    // output if freq applies exactly once, at the SDF-argument stage: a
    // second `* freq` on the wave argument (the shipped `raw*freq - ...`
    // line every other field uses) would make freq 2's output differ from
    // freq 4's despite the SDF/gyroid's own raw value being identical.
    const pairs: readonly (readonly [number, number])[] = [[0.3, 2], [0.15, 4], [0.6, 1]];
    for (const field of ["gyroid", "menger", "sierpinski"] as const) {
      const outputs = pairs.map(([x, freq]) => {
        const y = x, z = x; // scale all three axes together to keep q constant on every axis
        const v = voice({ field, wave: "sin", freq, iter: 2, speed: 0, phase: 0 });
        return sampleFieldVoice(v, x, y, z, 0, 0, 0, 0, false);
      });
      for (let i = 1; i < outputs.length; i++) {
        expect(outputs[i]).toBeCloseTo(outputs[0]!, 10);
      }
    }
  });
});

// P1-A fixer pass: the shipped construction (IQ's CSG-max cross-subtraction
// for menger, and its base-2 sierpinski sibling) is sign-exact but NOT a
// genuine Euclidean signed distance to the depth-`iter` box/tetra union —
// the max-fold doesn't preserve distance, and sierpinski's periodic `mod`
// reduction leaked outside the unit cell. `mengerFractalSdf`/
// `sierpinskiFractalSdf` were rewritten to a recursive box-union descent
// (min of exact leaf-box SDFs, branch-and-bound pruned) — these tests pin
// the review's own counterexamples and cross-check genuine distance fidelity
// against an independent brute-force leaf-box enumeration, not a
// re-derivation of the fix's own algorithm.
describe("mengerFractalSdf / sierpinskiFractalSdf: distance fidelity (VOLUMETRIC-2.md §2, P1-A fixer pass)", () => {
  // Same exact box SDF `fractalUnionSdf` uses internally — re-derived here,
  // not imported, so this brute-force reference can't share a bug with the
  // implementation under test.
  function sdfBoxRef(px: number, py: number, pz: number, bx: number, by: number, bz: number): number {
    const dx = Math.abs(px) - bx, dy = Math.abs(py) - by, dz = Math.abs(pz) - bz;
    const ax = Math.max(dx, 0), ay = Math.max(dy, 0), az = Math.max(dz, 0);
    return Math.hypot(ax, ay, az) + Math.min(Math.max(dx, Math.max(dy, dz)), 0);
  }

  // Brute-force: explicitly enumerate EVERY kept leaf box at depth `depth`
  // (no pruning, no shared code with `fractalUnionSdf`) and take the min
  // distance — the textbook-exact "distance to a union of boxes" formula,
  // used here as ground truth rather than as an optimization. Kept
  // conditions mirror `mengerSolidRef`/`sierpinskiSolidRef` above (the
  // "midCount"/"upperCount" digit rules), not the fix's own offset tables.
  function mengerBoxes(depth: number): { cx: number; cy: number; cz: number; half: number }[] {
    let boxes = [{ cx: 0, cy: 0, cz: 0, half: 0.5 }];
    for (let lvl = 0; lvl < depth; lvl++) {
      const next: typeof boxes = [];
      for (const b of boxes) {
        const childHalf = b.half / 3;
        for (let oz = -1; oz <= 1; oz++) {
          for (let oy = -1; oy <= 1; oy++) {
            for (let ox = -1; ox <= 1; ox++) {
              const zeros = (ox === 0 ? 1 : 0) + (oy === 0 ? 1 : 0) + (oz === 0 ? 1 : 0);
              if (zeros >= 2) continue; // matches mengerSolidRef's "midCount >= 2 -> hole"
              next.push({ cx: b.cx + ox * childHalf * 2, cy: b.cy + oy * childHalf * 2, cz: b.cz + oz * childHalf * 2, half: childHalf });
            }
          }
        }
      }
      boxes = next;
    }
    return boxes;
  }
  function sierpinskiBoxes(depth: number): { cx: number; cy: number; cz: number; half: number }[] {
    let boxes = [{ cx: 0, cy: 0, cz: 0, half: 0.5 }];
    for (let lvl = 0; lvl < depth; lvl++) {
      const next: typeof boxes = [];
      for (const b of boxes) {
        const childHalf = b.half / 2;
        for (let oz = -1; oz <= 1; oz += 2) {
          for (let oy = -1; oy <= 1; oy += 2) {
            for (let ox = -1; ox <= 1; ox += 2) {
              const uppers = (ox === 1 ? 1 : 0) + (oy === 1 ? 1 : 0) + (oz === 1 ? 1 : 0);
              if (uppers >= 2) continue; // matches sierpinskiSolidRef's "upperCount >= 2 -> hole"
              next.push({ cx: b.cx + ox * childHalf, cy: b.cy + oy * childHalf, cz: b.cz + oz * childHalf, half: childHalf });
            }
          }
        }
      }
      boxes = next;
    }
    return boxes;
  }
  function bruteForceSdf(boxes: { cx: number; cy: number; cz: number; half: number }[], x: number, y: number, z: number): number {
    const px = x - 0.5, py = y - 0.5, pz = z - 0.5;
    let best = Infinity;
    for (const b of boxes) {
      const d = sdfBoxRef(px - b.cx, py - b.cy, pz - b.cz, b.half, b.half, b.half);
      if (d < best) best = d;
    }
    return best;
  }

  it("menger: matches the brute-force box union on a grid — inside, outside, and near-surface (iter 1-2)", () => {
    for (const iter of [1, 2]) {
      const boxes = mengerBoxes(iter);
      let checked = 0;
      // Covers [-0.3, 1.3]^3 at a coarse step: inside the unit cell, well
      // outside it, and (via the irregular 0.37 offset) plenty of near-
      // surface samples without landing exactly on a boundary.
      for (let ix = -3; ix <= 13; ix++) {
        for (let iy = -3; iy <= 13; iy++) {
          for (let iz = -3; iz <= 13; iz++) {
            const x = (ix + 0.37) / 10, y = (iy + 0.37) / 10, z = (iz + 0.37) / 10;
            const ref = bruteForceSdf(boxes, x, y, z);
            const got = mengerFractalSdf(x, y, z, iter);
            expect(got).toBeCloseTo(ref, 9);
            checked++;
          }
        }
      }
      expect(checked).toBeGreaterThan(0);
    }
  });

  it("sierpinski: matches the brute-force box union on a grid — inside, outside, and near-surface (iter 1-2)", () => {
    for (const iter of [1, 2]) {
      const boxes = sierpinskiBoxes(iter);
      let checked = 0;
      for (let ix = -3; ix <= 13; ix++) {
        for (let iy = -3; iy <= 13; iy++) {
          for (let iz = -3; iz <= 13; iz++) {
            const x = (ix + 0.37) / 10, y = (iy + 0.37) / 10, z = (iz + 0.37) / 10;
            const ref = bruteForceSdf(boxes, x, y, z);
            const got = sierpinskiFractalSdf(x, y, z, iter);
            expect(got).toBeCloseTo(ref, 9);
            checked++;
          }
        }
      }
      expect(checked).toBeGreaterThan(0);
    }
  });

  // The review's own three counterexamples, pinned exactly.
  it("pins the reviewer's menger iter-1 counterexample at the domain center: true distance 0.235702, not the old construction's 0.166667", () => {
    expect(mengerFractalSdf(0.5, 0.5, 0.5, 1)).toBeCloseTo(0.235702, 5);
  });

  it("pins the reviewer's sierpinski iter-1 counterexample just outside the domain corner: true distance 0.712420, not the old construction's near-zero leak (0.006495)", () => {
    const d = sierpinskiFractalSdf(1.00375, 1.00375, 1.00375, 1);
    expect(d).toBeCloseTo(0.712420, 5);
    // The old periodic-`mod` construction reported this point as almost ON
    // the surface — a real fix must land nowhere near that value.
    expect(Math.abs(d - 0.006495)).toBeGreaterThan(0.5);
  });

  it("sierpinski: errors do not grow through iter 1-3 outside the domain — every iter agrees with its own brute-force reference at the same outside point", () => {
    const x = 1.00375, y = 1.00375, z = 1.00375;
    for (const iter of [1, 2, 3]) {
      const ref = bruteForceSdf(sierpinskiBoxes(iter), x, y, z);
      expect(sierpinskiFractalSdf(x, y, z, iter)).toBeCloseTo(ref, 6);
    }
  });

  it("outside the unit cell, distance grows monotonically with separation from the domain (no periodic leak)", () => {
    for (const field of ["menger", "sierpinski"] as const) {
      const sample = (t: number) => field === "menger" ? mengerFractalSdf(t, t, t, 3) : sierpinskiFractalSdf(t, t, t, 3);
      let prev = sample(1.0);
      for (let t = 1.05; t <= 3; t += 0.05) {
        const cur = sample(t);
        // Monotone non-decreasing along a ray moving straight away from the
        // domain's far corner — a periodic construction would instead
        // oscillate back down near zero at each repeated period.
        expect(cur).toBeGreaterThanOrEqual(prev - 1e-9);
        prev = cur;
      }
      // And genuinely large far away — not a bounded periodic residual.
      expect(sample(3)).toBeGreaterThan(2);
    }
  });

  it("sign-exactness is preserved: distance-fidelity fix agrees with the existing digit-rule membership tests (menger/sierpinski, depth 2)", () => {
    const N = 12;
    for (let ix = 0; ix < N; ix++) {
      for (let iy = 0; iy < N; iy++) {
        for (let iz = 0; iz < N; iz++) {
          const x = (ix + 0.37) / N, y = (iy + 0.37) / N, z = (iz + 0.37) / N;
          let nearBoundary = false;
          for (const c of [x, y, z]) {
            const frac9 = ((c * 9) % 1 + 1) % 1;
            if (frac9 < 0.05 || frac9 > 0.95) nearBoundary = true;
          }
          if (nearBoundary) continue;
          expect(mengerFractalSdf(x, y, z, 2) < 0).toBe(mengerSolidRef(x, y, z, 2));
          expect(sierpinskiFractalSdf(x, y, z, 2) < 0).toBe(sierpinskiSolidRef(x, y, z, 2));
        }
      }
    }
  });
});

describe("effectiveVoiceFinestFreq (VOLUMETRIC-2.md §2)", () => {
  it("menger: freq * 3^iter", () => {
    expect(effectiveVoiceFinestFreq(voice({ field: "menger", freq: 2, iter: 3 }))).toBeCloseTo(2 * 27, 10);
    expect(effectiveVoiceFinestFreq(voice({ field: "menger", freq: 1, iter: 4 }))).toBeCloseTo(81, 10);
  });

  it("sierpinski: freq * 2^iter", () => {
    expect(effectiveVoiceFinestFreq(voice({ field: "sierpinski", freq: 2, iter: 3 }))).toBeCloseTo(2 * 8, 10);
    expect(effectiveVoiceFinestFreq(voice({ field: "sierpinski", freq: 1, iter: 4 }))).toBeCloseTo(16, 10);
  });

  it("gyroid: freq * 2, independent of iter", () => {
    expect(effectiveVoiceFinestFreq(voice({ field: "gyroid", freq: 3 }))).toBeCloseTo(6, 10);
  });

  it("every other field: unchanged (exactly freq)", () => {
    for (const field of ["radial", "linearX", "linearY", "diagonal", "angular", "spiral", "noise", "linearZ"]) {
      expect(effectiveVoiceFinestFreq(voice({ field, freq: 5 }))).toBe(5);
    }
  });

  it("menger/sierpinski default to iter 3 when omitted, matching the schema default", () => {
    expect(effectiveVoiceFinestFreq(voice({ field: "menger", freq: 1 }))).toBeCloseTo(27, 10);
    expect(effectiveVoiceFinestFreq(voice({ field: "sierpinski", freq: 1 }))).toBeCloseTo(8, 10);
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

// VOLUMETRIC-2.md §1 "The integrator": the step-count floor `marchField` used
// privately is now a shared, exported helper both `marchField` and
// `integrateField` consume, so the two can never disagree about resolution.
describe("fieldStepCount", () => {
  it("floors to the `steps` minimum when finestFreq is absent or 0", () => {
    expect(fieldStepCount(100)).toBe(48); // schema default
    expect(fieldStepCount(100, { steps: 12 })).toBe(12);
    expect(fieldStepCount(100, { steps: 12, finestFreq: 0 })).toBe(12);
  });

  it("raises the count via the Nyquist floor ceil(2 * chordLength * finestFreq)", () => {
    expect(fieldStepCount(10, { steps: 8, finestFreq: 1 })).toBe(20);
    expect(fieldStepCount(3.3, { steps: 8, finestFreq: 9 })).toBe(Math.max(8, Math.ceil(2 * 3.3 * 9)));
  });

  it("the Nyquist floor never lowers the count below `steps`", () => {
    expect(fieldStepCount(0.01, { steps: 48, finestFreq: 1 })).toBe(48);
  });

  it("clamps to maxSteps regardless of how high the Nyquist floor would otherwise go", () => {
    expect(fieldStepCount(1e6, { steps: 8, finestFreq: 1e6, maxSteps: 64 })).toBe(64);
  });

  it("clamps `steps` itself to at least 1 and never above maxSteps", () => {
    expect(fieldStepCount(1, { steps: 0 })).toBe(1);
    expect(fieldStepCount(1, { steps: 999, maxSteps: 32 })).toBe(32);
  });
});

// VOLUMETRIC-2.md §1 "The integrator": `integrateGlyphField`'s internal name.
// xray's sibling to `marchField` — sampler-agnostic, midpoint quadrature.
describe("integrateField", () => {
  it("midpoint quadrature is exact for a constant sampler: sum = value * chordLength", () => {
    const result = integrateField([0, 0, 0], [10, 0, 0], () => 1, { steps: 5 });
    expect(result.sum).toBeCloseTo(10, 10);
    expect(result.steps).toBe(5);
    expect(result.chordLength).toBeCloseTo(10, 10);
  });

  it("samples at t_i = (i + 1/2)/steps * chordLength, dt = chordLength/steps — no endpoint double-counting", () => {
    const positions: number[] = [];
    integrateField([0, 0, 0], [8, 0, 0], (x) => { positions.push(x); return 1; }, { steps: 4, finestFreq: 0 });
    expect(positions).toEqual([1, 3, 5, 7]); // (i+0.5)/4 * 8 for i=0..3
  });

  it("a non-finite sample contributes 0 to the sum, not NaN", () => {
    // Same 4-sample grid as above; poison the i=1 sample (x=3) with NaN.
    const clean = integrateField([0, 0, 0], [8, 0, 0], () => 1, { steps: 4 });
    const poisoned = integrateField([0, 0, 0], [8, 0, 0], (x) => (x === 3 ? NaN : 1), { steps: 4 });
    expect(Number.isFinite(poisoned.sum)).toBe(true);
    // Poisoned sum is exactly one sample's worth (dt = 2) less than clean.
    expect(clean.sum - poisoned.sum).toBeCloseTo(2, 10);
  });

  it("a degenerate segment (entry === exit) integrates to zero, not a divide-by-zero/NaN", () => {
    const result = integrateField([2, 3, 4], [2, 3, 4], () => 1, { steps: 8 });
    expect(result).toEqual({ sum: 0, steps: 0, chordLength: 0 });
  });

  it("a non-finite entry/exit coordinate also degrades to the zero-sum result, not NaN propagation", () => {
    const result = integrateField([0, 0, 0], [NaN, 0, 0], () => 1, { steps: 8 });
    expect(result.sum).toBe(0);
    expect(result.steps).toBe(0);
    expect(Number.isFinite(result.chordLength)).toBe(true);
  });

  it("resolves its step count through the SAME shared `fieldStepCount` helper marchField uses", () => {
    const opts = { steps: 8, finestFreq: 9, maxSteps: 256 };
    const chordLength = 3.3;
    const result = integrateField([0, 0, 0], [chordLength, 0, 0], () => 0, opts);
    expect(result.steps).toBe(fieldStepCount(chordLength, opts));
  });

  it("an explicit steps/maxSteps override (finestFreq: 0) forces an EXACT step count regardless of chordLength — the mechanism xray's uniform-step-per-evaluate design relies on", () => {
    const short = integrateField([0, 0, 0], [1, 0, 0], () => 1, { steps: 40, maxSteps: 40, finestFreq: 0 });
    const long = integrateField([0, 0, 0], [100, 0, 0], () => 1, { steps: 40, maxSteps: 40, finestFreq: 0 });
    expect(short.steps).toBe(40);
    expect(long.steps).toBe(40);
  });
});

// ---- sphere tracing for carve (VOLUMETRIC-3.md §3) -----------------------

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function sdfVoice(overrides: Partial<FieldVoice> = {}): FieldVoice {
  return {
    field: "menger",
    wave: "step",
    freq: 1,
    speed: 0,
    amp: 1,
    phase: 0,
    duty: 0.5,
    angle: 0,
    origin: { u: 0, v: 0, w: 0 },
    color: "#ffffff",
    iter: 1,
    ...overrides,
  };
}

function distanceLayerProgram(voices: readonly FieldVoice[], overrides: Partial<FieldLayer> = {}): FieldProgram {
  const layer: FieldLayer = {
    voices, combine: "min", thresholdOn: false, threshold: 0, invert: false, blend: "multiply", amp: 1,
    ...overrides,
  };
  return { domain: "3d", layers: [layer] };
}

const REGIME_PARAMS = { bias: 0.5, gain: 1 }; // field-synth's own schema defaults — already qualifying

describe("buildGlyphFieldDistanceOracle — qualifying predicate (VOLUMETRIC-3.md §3)", () => {
  it("accepts a single-voice menger layer in the step-selective regime", () => {
    expect(buildGlyphFieldDistanceOracle(distanceLayerProgram([sdfVoice()]), REGIME_PARAMS, 0)).not.toBeNull();
  });

  it("accepts sierpinski too", () => {
    expect(buildGlyphFieldDistanceOracle(distanceLayerProgram([sdfVoice({ field: "sierpinski" })]), REGIME_PARAMS, 0)).not.toBeNull();
  });

  it("accepts invert — a genuine distance negated is still a genuine distance, to the complement's boundary", () => {
    expect(buildGlyphFieldDistanceOracle(distanceLayerProgram([sdfVoice()], { invert: true }), REGIME_PARAMS, 0)).not.toBeNull();
  });

  it("accepts multiple active voices in the same layer, all menger/sierpinski/step/amp1", () => {
    const program = distanceLayerProgram([sdfVoice(), sdfVoice({ field: "sierpinski", origin: { u: 0.3, v: 0, w: 0 } })]);
    expect(buildGlyphFieldDistanceOracle(program, REGIME_PARAMS, 0)).not.toBeNull();
  });

  it("rejects gyroid — no genuine distance reading, even though it shares the SDF voice family's coordinate derivation", () => {
    expect(buildGlyphFieldDistanceOracle(distanceLayerProgram([sdfVoice({ field: "gyroid" })]), REGIME_PARAMS, 0)).toBeNull();
  });

  it("rejects a non-step wave (warps the raw SDF through a non-distance-preserving nonlinearity)", () => {
    expect(buildGlyphFieldDistanceOracle(distanceLayerProgram([sdfVoice({ wave: "sin" })]), REGIME_PARAMS, 0)).toBeNull();
  });

  it("rejects amp !== 1 (amp is a mix weight, not a distance scale)", () => {
    expect(buildGlyphFieldDistanceOracle(distanceLayerProgram([sdfVoice({ amp: 0.5 })]), REGIME_PARAMS, 0)).toBeNull();
    expect(buildGlyphFieldDistanceOracle(distanceLayerProgram([sdfVoice({ amp: 0 })]), REGIME_PARAMS, 0)).toBeNull();
  });

  it('rejects a layer combine other than "min" — the qualifying intersection fold', () => {
    expect(buildGlyphFieldDistanceOracle(distanceLayerProgram([sdfVoice()], { combine: "add" }), REGIME_PARAMS, 0)).toBeNull();
    expect(buildGlyphFieldDistanceOracle(distanceLayerProgram([sdfVoice()], { combine: "max" }), REGIME_PARAMS, 0)).toBeNull();
  });

  it("rejects the layer's own threshold being on", () => {
    expect(buildGlyphFieldDistanceOracle(distanceLayerProgram([sdfVoice()], { thresholdOn: true }), REGIME_PARAMS, 0)).toBeNull();
  });

  it("rejects more than one populated layer, even when both are individually qualifying", () => {
    const layerA: FieldLayer = { voices: [sdfVoice()], combine: "min", thresholdOn: false, threshold: 0, invert: false, blend: "multiply", amp: 1 };
    const layerB: FieldLayer = { voices: [sdfVoice({ field: "sierpinski" })], combine: "min", thresholdOn: false, threshold: 0, invert: false, blend: "multiply", amp: 1 };
    const program: FieldProgram = { domain: "3d", layers: [layerA, layerB] };
    expect(buildGlyphFieldDistanceOracle(program, REGIME_PARAMS, 0)).toBeNull();
  });

  it("rejects a non-positive or non-finite voice frequency", () => {
    expect(buildGlyphFieldDistanceOracle(distanceLayerProgram([sdfVoice({ freq: 0 })]), REGIME_PARAMS, 0)).toBeNull();
    expect(buildGlyphFieldDistanceOracle(distanceLayerProgram([sdfVoice({ freq: -1 })]), REGIME_PARAMS, 0)).toBeNull();
  });

  it("rejects an empty (no active voices) program", () => {
    expect(buildGlyphFieldDistanceOracle(distanceLayerProgram([sdfVoice({ amp: 0 })]), REGIME_PARAMS, 0)).toBeNull();
  });

  describe("bias/gain regime: bias + gain/2 > 0 && bias - gain/2 <= 0 (VOLUMETRIC-3.md §3)", () => {
    const program = distanceLayerProgram([sdfVoice()]);

    it("accepts the schema default (bias 0.5, gain 1) — the upper bound sits exactly on the inclusive <= 0 edge", () => {
      expect(buildGlyphFieldDistanceOracle(program, { bias: 0.5, gain: 1 }, 0)).not.toBeNull();
    });

    it("rejects an all-solid regime (bias - gain/2 > 0: even the -1 step reads solid)", () => {
      expect(buildGlyphFieldDistanceOracle(program, { bias: 2, gain: 0 }, 0)).toBeNull();
    });

    it("rejects an all-empty regime (bias + gain/2 <= 0: even the +1 step reads empty)", () => {
      expect(buildGlyphFieldDistanceOracle(program, { bias: -2, gain: 0 }, 0)).toBeNull();
      // Exactly on the exclusive `> 0` boundary: bias+gain/2 === 0 must reject.
      expect(buildGlyphFieldDistanceOracle(program, { bias: -0.5, gain: 1 }, 0)).toBeNull();
    });
  });
});

describe("buildGlyphFieldDistanceOracle — oracle unit-correctness (VOLUMETRIC-3.md §3)", () => {
  it.each([1, 2, 3])("freq %i: D's gradient along a flat leaf-box face is exactly 1 domain-unit-per-domain-unit — the ÷freq division (overshoot regression pinned)", (freq) => {
    // A point directly above the iter-1 corner child box (offset (-1,-1,+1)
    // in the 20-of-27 digit rule, VOLUMETRIC-2.md §2), well within its flat
    // top face's footprint (domain x,y in [0, 1/3], probed at 0.15/freq):
    // the nearest surface there is an exact axis-aligned plane, so `raw` is
    // EXACTLY `freq*pz - 1` and D(pz) = pz - 1/freq is EXACTLY linear in pz
    // with slope 1 — not `freq` (the rejected undivided reading this pins
    // against; undivided would report slope `freq`, e.g. 3x at freq 3,
    // matching the "measured 2.9x" figure from the design doc's regime
    // table up to this test's simpler exact-plane setup).
    const oracle = buildGlyphFieldDistanceOracle(distanceLayerProgram([sdfVoice({ freq, iter: 1 })]), REGIME_PARAMS, 0)!;
    expect(oracle).not.toBeNull();
    const px = 0.15 / freq, py = 0.15 / freq;
    const pz1 = 1.05 / freq, pz2 = 1.15 / freq;
    const d1 = oracle(px, py, pz1);
    const d2 = oracle(px, py, pz2);
    const slope = (d2 - d1) / (pz2 - pz1);
    expect(slope).toBeCloseTo(1, 6);
  });
});

describe("buildGlyphFieldDistanceOracle — intersection semantics: max-of-distances, not min (VOLUMETRIC-3.md §3, reviewer-caught)", () => {
  it("two menger voices at far-apart origins: max(D_A, D_B) agrees with the real ±1-step solid test; min(D_A, D_B) would not", () => {
    const voiceA = sdfVoice({ origin: { u: 0, v: 0, w: 0 } });
    const voiceB = sdfVoice({ origin: { u: 100, v: 0, w: 0 } });
    const program = distanceLayerProgram([voiceA, voiceB]);
    const oracle = buildGlyphFieldDistanceOracle(program, REGIME_PARAMS, 0)!;
    expect(oracle).not.toBeNull();

    const oracleA = buildGlyphFieldDistanceOracle(distanceLayerProgram([voiceA]), REGIME_PARAMS, 0)!;
    const oracleB = buildGlyphFieldDistanceOracle(distanceLayerProgram([voiceB]), REGIME_PARAMS, 0)!;

    const px = 0.2, py = 0.2, pz = 0.2; // deep inside voiceA's solid corner cube; nowhere near voiceB's
    const dA = oracleA(px, py, pz);
    const dB = oracleB(px, py, pz);
    const dCombined = oracle(px, py, pz);

    const real = evaluateFieldProgram(program, px, py, pz, 0).combined;
    const density = clamp01(REGIME_PARAMS.bias + REGIME_PARAMS.gain * real * 0.5);

    expect(dA).toBeLessThanOrEqual(0); // voice A alone: solid
    expect(dB).toBeGreaterThan(0); // voice B alone: nowhere close, empty
    expect(density).toBe(0); // real intersection field: NOT solid (B disqualifies it)

    // The executed counter-case: min-of-distances would terminate inside
    // the union, wrongly reporting solid where the real test says empty.
    const wrongMinOfDistances = Math.min(dA, dB);
    expect(wrongMinOfDistances).toBeLessThanOrEqual(0);

    // The oracle's actual max-fold agrees with the real solid test instead.
    expect(dCombined).toBeGreaterThan(0);
    expect(dCombined).toBeCloseTo(dB, 10);
  });
});

describe("marchGlyphFieldSphere (VOLUMETRIC-3.md §3)", () => {
  it("entry already inside the solid (D(entry) <= 0) hits immediately at t = 0, mirroring marchField's own entry-solid short circuit", () => {
    const alwaysInside: FieldDistanceSampler = () => -1;
    const result = marchGlyphFieldSphere([0.2, 0.3, 0.4], [1.2, 0.3, 0.4], alwaysInside, () => 1);
    expect(result.hit).toBe(true);
    if (result.hit) {
      expect(result.t).toBe(0);
      expect(result.distance).toBe(0);
      expect(result.sampleT).toBe(0);
      expect(result.sampleDistance).toBe(0);
      expect([result.x, result.y, result.z]).toEqual([0.2, 0.3, 0.4]);
      expect([result.sampleX, result.sampleY, result.sampleZ]).toEqual([0.2, 0.3, 0.4]);
    }
  });

  it("a degenerate segment (entry === exit) always misses", () => {
    const result = marchGlyphFieldSphere([0.2, 0.3, 0.4], [0.2, 0.3, 0.4], () => -1, () => 1);
    expect(result.hit).toBe(false);
  });

  it("steps by SPHERE_MARCH_SAFETY * D, overshoots into the solid, and confirms with the real sampler before emitting — the confirmed hit's t/distance/x/y/z equal its own sampleT/sampleDistance/sampleX/Y/Z", () => {
    // A deliberately over-aggressive (non-Lipschitz-1) synthetic oracle —
    // slope magnitude 2, not the 1 a genuine SDF guarantees — so
    // `SPHERE_MARCH_SAFETY * D` steps PAST the zero crossing at x = 0.5
    // after a single step (entry D = 1 > 0; step 0.9*1 = 0.9 -> x = 0.9,
    // D = 1 - 1.8 = -0.8 <= 0), exercising the overshoot+confirm path
    // deterministically instead of relying on a real fractal's geometry.
    const oracle: FieldDistanceSampler = (x) => 1 - 2 * x;
    const realSampler: FieldSampler = (x) => (x >= 0.5 ? 1 : -1); // the "real" field this distance approximates
    const result = marchGlyphFieldSphere([0, 0, 0], [1, 0, 0], oracle, realSampler);
    expect(result.hit).toBe(true);
    if (result.hit) {
      expect(result.t).toBe(result.sampleT);
      expect(result.distance).toBe(result.sampleDistance);
      expect(result.x).toBe(result.sampleX);
      expect(result.x).toBeGreaterThanOrEqual(0.5); // genuinely past the crossing
      expect(realSampler(result.x, 0, 0, 0)).toBeGreaterThan(0); // genuinely confirmed solid
    }
  });

  it("an unconfirmed sign change (the real sampler disagrees with the oracle at the overshoot sample) reports a miss, not a false hit", () => {
    const oracle: FieldDistanceSampler = (x) => 1 - 2 * x; // same over-aggressive oracle as above
    const neverSolid: FieldSampler = () => -1; // the real field never agrees
    const result = marchGlyphFieldSphere([0, 0, 0], [1, 0, 0], oracle, neverSolid);
    expect(result.hit).toBe(false);
  });

  it("stepping past exit without a sign change or a stall is a genuine miss (the tracer legitimately found nothing) — no fallback attempted", () => {
    let fallbackCalls = 0;
    const farOutside: FieldDistanceSampler = () => 10; // one step (0.9*10=9) already clears a chord of length 1
    const sampler: FieldSampler = () => { fallbackCalls++; return 1; };
    const result = marchGlyphFieldSphere([0, 0, 0], [1, 0, 0], farOutside, sampler);
    expect(result.hit).toBe(false);
    // The sampler is ONLY ever called to confirm a sign change or to run the
    // fixed-step fallback (`marchField` samples its own entry first thing) —
    // neither happened here, so it must never have been called at all.
    expect(fallbackCalls).toBe(0);
  });

  describe("stall / step-cap-pressure fallback (VOLUMETRIC-3.md §3, amended after Phase 3 measurement)", () => {
    it("SPHERE_MARCH_STALL_STEPS consecutive stall-sized advances trigger the fixed-step fallback over the remaining segment — and RESTORES a hit sphere-alone would have missed", () => {
      // A synthetic oracle that stalls (advance stays well under
      // SPHERE_MARCH_STALL_ADVANCE) for the first several steps — mimicking
      // the measured "stuck near an off-ray feature" pathology — then NEVER
      // recovers on its own (stays a tiny constant forever, so without the
      // fallback this would exhaust the step cap and miss, exactly like the
      // pre-amendment behavior this test pins the fix for). The REAL field,
      // however, genuinely has solid material starting at x = 0.5 — evidence
      // the fixed-step fallback (not sphere-stepping) must be what finds it.
      const stallAdvance = SPHERE_MARCH_STALL_ADVANCE / 2; // safely below the threshold
      const oracle: FieldDistanceSampler = () => stallAdvance / SPHERE_MARCH_SAFETY; // constant -> constant tiny advance forever
      const sampler: FieldSampler = (x) => (x >= 0.5 ? 1 : -1);
      const result = marchGlyphFieldSphere([0, 0, 0], [1, 0, 0], oracle, sampler, { steps: 64, maxSteps: 256, finestFreq: 0 });
      expect(result.hit).toBe(true);
      if (result.hit) {
        // `sampleX` (not `x`): a fallback hit comes from `marchField`'s OWN
        // secant-refined/raw-sample split (see `marchGlyphFieldSphere`'s
        // doc) — only the raw sample is guaranteed to resample solid; the
        // interpolated `x` can legitimately land fractionally short of it,
        // exactly as `marchField`'s own plateau-discipline doc describes.
        expect(result.sampleX).toBeGreaterThanOrEqual(0.5);
        expect(sampler(result.sampleX, 0, 0, 0)).toBeGreaterThan(0);
        // Fell back well within the step budget — stalled after exactly
        // SPHERE_MARCH_STALL_STEPS advances, each far short of reaching 0.5.
        expect(result.distance).toBeLessThan(SPHERE_MARCH_STALL_STEPS * stallAdvance + 0.5);
      }
    });

    it("fewer than SPHERE_MARCH_STALL_STEPS tiny advances in a row do NOT trigger the fallback — a single small step immediately preceding a genuine crossing resolves normally via the sign-change path", () => {
      // D shrinks for two steps (below the stall threshold) then goes
      // negative on the third — a legitimate, fast convergence onto a real
      // crossing, not a persistent stall. Must resolve via ordinary
      // distance-stepping (confirmed sample near the crossing), not the
      // fallback (which would still find it, but this test is specifically
      // pinning that the stall detector doesn't false-trigger on this case).
      let step = 0;
      const smallAdvance = SPHERE_MARCH_STALL_ADVANCE / 2;
      const oracle: FieldDistanceSampler = (x) => {
        if (x === 0) return smallAdvance / SPHERE_MARCH_SAFETY; // entry check
        step++;
        if (step < 3) return smallAdvance / SPHERE_MARCH_SAFETY; // two tiny, non-crossing steps
        return -1; // third step: genuine sign change
      };
      const sampler: FieldSampler = () => 1; // confirms whatever the oracle finds
      const result = marchGlyphFieldSphere([0, 0, 0], [1, 0, 0], oracle, sampler, { steps: 64, maxSteps: 256, finestFreq: 0 });
      expect(result.hit).toBe(true);
      if (result.hit) {
        // Distance-stepping's own emission: t === sampleT (no marchField
        // secant split), unlike a fallback-produced hit.
        expect(result.t).toBe(result.sampleT);
      }
    });

    it("step-cap pressure (no stall, but D never resolves within the budget) also falls back, instead of a bare cap-exhaustion miss", () => {
      // A MODERATE, non-stalling constant D (well above the stall
      // threshold) that nonetheless never goes negative on its own: sphere-
      // stepping alone would exhaust SPHERE_MARCH_MAX_STEPS steps without a
      // sign change under the pre-amendment contract. The chord is sized so
      // MAX_STEPS steps of this D never reach the exit (dist stays well
      // under chordLength throughout), isolating step-cap pressure from the
      // "stepped past exit" miss path.
      const moderateD = 0.01; // advance 0.009/step; 64 steps ~= 0.576, well under a chord of length 100
      const oracle: FieldDistanceSampler = () => moderateD;
      const sampler: FieldSampler = (x) => (x >= 50 ? 1 : -1); // solid far beyond anything sphere-stepping alone reaches
      const result = marchGlyphFieldSphere([0, 0, 0], [100, 0, 0], oracle, sampler, { steps: 64, maxSteps: 256, finestFreq: 0 });
      expect(result.hit).toBe(true); // restored by the fixed-step fallback over the remaining segment
    });

    it("pure miss only when the fallback segment ALSO finds nothing", () => {
      const stallAdvance = SPHERE_MARCH_STALL_ADVANCE / 2;
      const oracle: FieldDistanceSampler = () => stallAdvance / SPHERE_MARCH_SAFETY;
      const neverSolid: FieldSampler = () => -1; // fallback's own march finds nothing either
      const result = marchGlyphFieldSphere([0, 0, 0], [1, 0, 0], oracle, neverSolid, { steps: 64, maxSteps: 256, finestFreq: 0 });
      expect(result.hit).toBe(false);
    });

    it("the fallback samples the SAME step-density inputs (steps/maxSteps/finestFreq) passed through opts, via the shared fieldStepCount helper — a higher finestFreq raises the fallback's own resolution exactly like it would for a direct marchField call", () => {
      // A thin solid band the LOW-resolution fallback (finestFreq 0, floor
      // steps only) is expected to step over entirely, but a HIGH-resolution
      // fallback (finestFreq high enough to raise the Nyquist floor) should
      // resolve — proving `opts.finestFreq` genuinely reaches the fallback's
      // own `fieldStepCount` call, not a fixed/ignored value.
      const stallAdvance = SPHERE_MARCH_STALL_ADVANCE / 2;
      const oracle: FieldDistanceSampler = () => stallAdvance / SPHERE_MARCH_SAFETY;
      const bandLo = 0.501, bandHi = 0.509; // ~0.008-wide band
      const sampler: FieldSampler = (x) => (x >= bandLo && x <= bandHi ? 1 : -1);
      const lowRes = marchGlyphFieldSphere([0, 0, 0], [1, 0, 0], oracle, sampler, { steps: 8, maxSteps: 256, finestFreq: 0 });
      const highRes = marchGlyphFieldSphere([0, 0, 0], [1, 0, 0], oracle, sampler, { steps: 8, maxSteps: 256, finestFreq: 200 });
      expect(lowRes.hit).toBe(false);
      expect(highRes.hit).toBe(true);
    });
  });
});

describe("marchGlyphFieldSphere / marchField — the four-part equivalence bar on the shipped SDF presets (VOLUMETRIC-3.md §3)", () => {
  function boxPolygons(half: number): Polygon[] {
    const faces: Vec3[][] = [
      [[-half, -half, half], [half, -half, half], [half, half, half], [-half, half, half]],
      [[-half, -half, -half], [-half, half, -half], [half, half, -half], [half, -half, -half]],
      [[-half, half, -half], [-half, half, half], [half, half, half], [half, half, -half]],
      [[-half, -half, half], [-half, -half, -half], [half, -half, -half], [half, -half, half]],
      [[half, -half, half], [half, -half, -half], [half, half, -half], [half, half, half]],
      [[-half, -half, -half], [-half, -half, half], [-half, half, half], [-half, half, -half]],
    ];
    return faces.map((vertices) => ({ vertices, color: "#8899cc" }));
  }

  // Compiles the SAME params -> IR path `fieldSynth.program.evaluate()` runs
  // internally (see stock.ts's own `evaluate()` for the identical sequence),
  // so this test's `program`/`density`/`finestFreq` can never drift from
  // what the real carve path actually marches.
  function compileFixture(presetParams: Record<string, number | string | boolean>) {
    const merged = { ...defaultGlyphEffectParams(fieldSynth), ...presetParams } as unknown as AnyParams;
    const voices = buildFieldSynthVoices(merged);
    const scale = merged.scale as number;
    const compiledVoices = compileFieldVoices(voices, scale);
    const layerShapes = resolveFieldSynthLayerShapes(merged);
    const program = compileFieldSynthProgram(compiledVoices, layerShapes, true);
    const bias = merged.bias as number, gain = merged.gain as number, time = merged.time as number;
    const originX = (merged.originU as number) * scale, originY = (merged.originV as number) * scale;
    let finestFreq = 0;
    for (const v of compiledVoices) if (v.amp > 0) finestFreq = Math.max(finestFreq, effectiveVoiceFinestFreq(v));
    const density: FieldSampler = (x, y, z, t) => clamp01(
      bias + gain * evaluateFieldProgram(program, x, y, z, t, originX, originY, 0).combined * 0.5,
    );
    return { program, density, bias, gain, time, originX, originY, finestFreq, marchSteps: merged.marchSteps as number, scale };
  }

  async function flushRender(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
  }

  // Real objectPosition/objectExit chords through an actual rendered cube —
  // the same "passive observer layer sharing the shared base grid" pattern
  // stock.test.ts's own dynamicRequirements test uses — not synthetic random
  // rays, which turn out to be far more adversarial than a real camera ever
  // produces (see this test's own findings below).
  async function harvestRealRays(
    polys: readonly Polygon[],
    presetParams: Record<string, number | string | boolean>,
  ): Promise<{ length: number; objectPosition: Float32Array; objectExit: Float32Array; coverage: Float32Array }> {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const scene = createGlyphScene(host, {
      cols: 120, rows: 48, useColors: false, doubleSided: true,
      camera: createGlyphOrthographicCamera({ zoom: 200, rotX: 8, rotY: 8 }),
    });
    scene.add(polys as Polygon[]);
    scene.addEffectLayer({
      effect: fieldSynth,
      params: { ...defaultGlyphEffectParams(fieldSynth), ...presetParams } as never,
      blend: "replace",
    });
    let captured: { length: number; objectPosition: Float32Array; objectExit: Float32Array; coverage: Float32Array } | undefined;
    scene.addEffectLayer({
      effect: defineGlyphEffect<{ phase: number }>({
        evaluate({ base, target }) {
          if (base.objectPosition && base.objectExit) {
            captured = {
              length: base.length,
              objectPosition: Float32Array.from(base.objectPosition as ArrayLike<number>),
              objectExit: Float32Array.from(base.objectExit as ArrayLike<number>),
              coverage: Float32Array.from(target.coverage as ArrayLike<number>),
            };
          }
        },
      }),
      params: { phase: 0 },
    });
    await flushRender();
    scene.destroy();
    host.remove();
    return captured!;
  }

  interface EquivalenceStats {
    fixedHits: number;
    sphereHits: number;
    bothHits: number;
    glyphMismatches: number;
    /** Shared hits whose sphere result came from pure distance-stepping —
     *  `t === sampleT` is a reliable tell (both are computed as the exact
     *  same `confirmDist / chordLength` expression — see
     *  `marchGlyphFieldSphere`'s doc); a fallback-produced hit almost never
     *  has that property, since it carries `marchField`'s own independent
     *  secant-refined-vs-raw split instead. */
    pureSphereBothHits: number;
    /** Among PURE distance-stepping hits only: sphere's confirmed sample is
     *  FARTHER from entry than fixed's, beyond
     *  `SPHERE_MARCH_OVERSHOOT_EPSILON` slack — sphere's own confirm step
     *  deliberately overshoots the true crossing by up to that epsilon (see
     *  `marchGlyphFieldSphere`'s doc), so a fixed-step raw sample landing
     *  marginally earlier on the SAME wall is expected, not a violation;
     *  should still be 0 beyond that margin. Bar (c)'s "≤" half holds
     *  exactly HERE because pure distance-stepping converges continuously
     *  toward the true nearest crossing along the ray — a guarantee that
     *  does NOT carry over to a fallback hit (see `fallbackBothHits`'s doc). */
    pureSphereFartherThanFixed: number;
    /** Among PURE distance-stepping hits only: fixed's distance exceeds
     *  sphere's by more than one fixed-step length — legitimate when sphere
     *  finds a thinner feature the fixed grid stepped clean over (a
     *  DIFFERENT, nearer crossing), which is the exact case bar (a)
     *  explicitly permits. */
    pureSphereOneStepViolations: number;
    /** Shared hits produced by the stall/step-cap-pressure fixed-step
     *  fallback (VOLUMETRIC-3.md §3, amended). A fallback hit is a SEPARATE
     *  `marchField` call over the REMAINING sub-segment, quantized on its
     *  own independent grid (a different chord length -> a different
     *  `fieldStepCount`-derived step size and offset) — it has no
     *  mathematical guarantee of landing within one step of, or before, a
     *  plain fixed-step call's OWN independently-gridded result over the
     *  FULL original chord, unlike pure distance-stepping's continuous
     *  convergence. Measured directly: up to ~0.13 domain units apart on
     *  the Menger SDF preset (real rendered rays, iter 3) — several fixed
     *  steps, not one. Bar (b) — identical RAMP GLYPH — is the invariant
     *  that actually holds here (and is the one that matters for rendered
     *  output): asserted below across ALL shared hits, fallback included. */
    fallbackBothHits: number;
  }

  function compareOnRealRays(
    fx: ReturnType<typeof compileFixture>,
    captured: { length: number; objectPosition: Float32Array; objectExit: Float32Array; coverage: Float32Array },
  ): EquivalenceStats {
    const oracle = buildGlyphFieldDistanceOracle(fx.program, { bias: fx.bias, gain: fx.gain }, fx.time);
    expect(oracle).not.toBeNull(); // both shipped SDF presets qualify by construction
    const glyphs = " .:-=+*#%@";
    const rampMax = glyphs.length - 1;
    const rampGlyph = (x: number, y: number, z: number): string => {
      const v = clamp01(fx.bias + fx.gain * evaluateFieldProgram(fx.program, x, y, z, fx.time, fx.originX, fx.originY, 0).combined * 0.5);
      return glyphs[Math.min(rampMax, Math.max(0, Math.round(v * rampMax)))]!;
    };

    const stats: EquivalenceStats = {
      fixedHits: 0, sphereHits: 0, bothHits: 0, glyphMismatches: 0,
      pureSphereBothHits: 0, pureSphereFartherThanFixed: 0, pureSphereOneStepViolations: 0,
      fallbackBothHits: 0,
    };
    for (let i = 0; i < captured.length; i++) {
      if (captured.coverage[i]! <= 0) continue;
      const px = captured.objectPosition[i * 3]!, py = captured.objectPosition[i * 3 + 1]!, pz = captured.objectPosition[i * 3 + 2]!;
      if (!Number.isFinite(px) || !Number.isFinite(py) || !Number.isFinite(pz)) continue;
      const exx = captured.objectExit[i * 3]!, exy = captured.objectExit[i * 3 + 1]!, exz = captured.objectExit[i * 3 + 2]!;
      if (!Number.isFinite(exx) || !Number.isFinite(exy) || !Number.isFinite(exz)) continue;
      const entry: [number, number, number] = [px * fx.scale, py * fx.scale, pz * fx.scale];
      const exit: [number, number, number] = [exx * fx.scale, exy * fx.scale, exz * fx.scale];
      const chordLength = Math.hypot(exit[0] - entry[0], exit[1] - entry[1], exit[2] - entry[2]);
      if (!(chordLength > 0)) continue;

      const fixed = marchField(entry, exit, fx.density, { steps: fx.marchSteps, maxSteps: 256, finestFreq: fx.finestFreq, time: fx.time });
      const sphere = marchGlyphFieldSphere(entry, exit, oracle!, fx.density, {
        time: fx.time, originX: fx.originX, originY: fx.originY, originZ: 0,
        steps: fx.marchSteps, maxSteps: 256, finestFreq: fx.finestFreq,
      });
      if (fixed.hit) stats.fixedHits++;
      if (sphere.hit) stats.sphereHits++;
      if (fixed.hit && sphere.hit) {
        stats.bothHits++;
        if (rampGlyph(fixed.sampleX, fixed.sampleY, fixed.sampleZ) !== rampGlyph(sphere.sampleX, sphere.sampleY, sphere.sampleZ)) {
          stats.glyphMismatches++;
        }
        // `t === sampleT` reliably distinguishes a pure distance-stepping
        // hit (both are the exact same `confirmDist / chordLength`
        // expression) from a fallback-produced one (marchField's own,
        // generally different, secant-refined-vs-raw split) — see
        // `EquivalenceStats.fallbackBothHits`'s doc for why the two need
        // different invariants.
        if (sphere.t === sphere.sampleT) {
          stats.pureSphereBothHits++;
          if (sphere.sampleDistance > fixed.sampleDistance + 2 * SPHERE_MARCH_OVERSHOOT_EPSILON) stats.pureSphereFartherThanFixed++;
          const steps = fieldStepCount(chordLength, { steps: fx.marchSteps, maxSteps: 256, finestFreq: fx.finestFreq });
          const stepSize = chordLength / steps;
          if (fixed.sampleDistance - sphere.sampleDistance > stepSize + 1e-6) stats.pureSphereOneStepViolations++;
        } else {
          stats.fallbackBothHits++;
        }
      }
    }
    return stats;
  }

  // Both presets target their own stage's real geometry (VOLUMETRIC-3.md
  // §3's own fixtures — see the presets' own doc comments in stock.ts):
  // "Menger SDF" the centered cube (extent 3), "Sierpinski SDF" the
  // uncentered [0, 3]^3 corner box the real pyramid stage occupies.
  const CASES: readonly [string, GlyphEffectPreset<typeof fieldSynth.parameterSchema>, readonly Polygon[]][] = [
    ["Menger SDF", mengerSdfPreset, boxPolygons(1.5)],
    ["Sierpinski SDF", sierpinskiSdfPreset, boxPolygons(1.5).map((p) => ({ ...p, vertices: p.vertices.map(([x, y, z]: Vec3) => [x + 1.5, y + 1.5, z + 1.5] as Vec3) }))],
  ];

  for (const [name, preset, polys] of CASES) {
    it(`${name}: on real rendered objectPosition -> objectExit chords, (a) hit set is a STRICT superset (stall/cap-pressure fallback restores every cell fixed-step finds), (b) identical ramp glyph and (c) sphere distance <= fixed distance hold on every shared-hit cell`, async () => {
      const captured = await harvestRealRays(polys, preset.params as Record<string, number | string | boolean>);
      const fx = compileFixture(preset.params as Record<string, number | string | boolean>);
      const stats = compareOnRealRays(fx, captured);

      expect(stats.fixedHits).toBeGreaterThan(0);

      // (a) — STRICT (VOLUMETRIC-3.md §3, amended after the Phase 3
      // measurement below): the stall/step-cap-pressure fallback finishes a
      // stuck ray exactly as fixed-step would from that point on, so the
      // sphere hit set is now a hit-set superset BY CONSTRUCTION, not a
      // measured approximation. Every one of fixed-step's hits (140 for
      // Menger SDF post-centering-fix — was 218 pre-fix, re-pinned
      // deliberately below alongside the fix, not a regression: the
      // corrected preset's lattice cell has an equal margin on every face
      // instead of one edge flush and the opposite side clipped, so fewer
      // cells are covered overall — 153 for Sierpinski SDF, unaffected by
      // that fix) is also a sphere hit — the pre-amendment measurement was
      // 182/218 (~83%) and 127/153 (~83%): naive (non-relaxed)
      // distance-stepping alone stalls approaching a nearby OFF-ray feature
      // (`D` shrinks toward a small positive residual near a DIFFERENT
      // surface than the one the ray actually crosses) and used to exhaust
      // the step cap without ever trying the fixed grid; falling back to
      // `marchField` over the remaining segment the instant a stall or cap
      // pressure is detected closes that gap completely.
      expect(stats.bothHits).toBe(stats.fixedHits);
      expect(stats.sphereHits).toBeGreaterThanOrEqual(stats.fixedHits);

      // (b) — holds exactly, every time, on real geometry, ACROSS EVERY
      // SHARED HIT INCLUDING FALLBACK-PRODUCED ONES: the two marchers never
      // disagree about which ramp step a shared hit belongs to — the
      // practically meaningful equivalence claim, since it's what the
      // rendered `<pre>` actually shows.
      expect(stats.glyphMismatches).toBe(0);

      // Sanity: the fallback isn't a theoretical path that never actually
      // fires. Whether the PURE (non-fallback) bucket also fires on this
      // exact scene is preset-dependent, not a general guarantee: the
      // centered Menger SDF fix (freq1 0.4 -> 0.5) compresses the same
      // iter-3 recursion into a physically smaller lattice cell (object
      // units per lattice unit drops from 1/0.4=2.5 to 1/0.5=2.0), so its
      // finest walls are thinner in absolute terms — exactly the condition
      // that trips the stall detector (`SPHERE_MARCH_STALL_ADVANCE` is a
      // fixed domain-unit threshold) — and on this pinned real-rendered
      // scene EVERY ray now stalls at least once (measured: 0/140 pure).
      // Sierpinski SDF is untouched by that fix and still exercises both
      // buckets (measured: 3/153 pure), so it keeps the stronger assertion.
      expect(stats.pureSphereBothHits).toBeGreaterThanOrEqual(name === "Menger SDF" ? 0 : 1);
      expect(stats.fallbackBothHits).toBeGreaterThan(0);
      expect(stats.pureSphereBothHits + stats.fallbackBothHits).toBe(stats.bothHits);

      // (c) — holds in its literal "≤ fixed and within one fixed step" form
      // ONLY for PURE distance-stepping hits (continuous convergence toward
      // the true nearest on-ray crossing gives it that guarantee). A
      // fallback hit is a SEPARATE `marchField` call over its own
      // independently-quantized remaining sub-segment — no such guarantee
      // relative to a plain fixed-step call over the FULL original chord
      // (measured directly: up to ~0.13 domain units apart on Menger SDF,
      // several fixed steps, not one — see `fallbackBothHits`'s doc). That
      // gap is an inherent, expected consequence of the amendment's two
      // separate grids, not a new equivalence-bar violation: (b) above is
      // the invariant that actually holds across both buckets.
      expect(stats.pureSphereFartherThanFixed).toBe(0);
      // Guard the ratio against a 0/0 NaN when a preset (Menger SDF, see
      // above) has zero pure hits on this scene — vacuously within bounds,
      // not a violation, since there are no pure hits to violate it.
      if (stats.pureSphereBothHits > 0) {
        expect(stats.pureSphereOneStepViolations / stats.pureSphereBothHits).toBeLessThan(0.05);
      }
    });
  }
});

// Diagnosed follow-up (reported live: "the Menger SDF preset's fractal is
// not centered on the cube"). Root cause: the SDF branch's lattice-cell
// anchor (`f = 0` at `objectPosition = originU+originU1` per axis,
// `sampleFieldVoice`'s doc in fieldProgram.ts) is independent of `freq`, and
// the schema's combined origin range bottoms out at -1 — an earlier
// revision picked `freq1: 0.4` to land the CUBE's `+1.5` edge exactly on
// the lattice's `f = 1` boundary, which only anchors ONE edge and leaves
// all the slack on the opposite side (visibly off-center). The fix (see
// `mengerSdfPreset`'s doc in stock.ts) is `freq1: 0.5`, chosen so the
// lattice's OWN center (`f = 0.5` on every axis) lands exactly at the
// cube's object-space center (0, 0, 0) instead. The Menger sponge
// construction is symmetric under reflection about its own lattice center
// (removing the recursive middle-third cross at every depth is invariant
// under `f -> 1-f` on each axis), so a correctly centered preset must
// satisfy `D(p) === D(-p)` along each axis through the origin — this is
// the oracle-level assertion a coordinate-offset bug like the diagnosed one
// cannot pass by accident.
describe("mengerSdfPreset centering (diagnosed VOLUMETRIC-3.md §3 follow-up)", () => {
  function oracleOf(preset: { params: Record<string, unknown> }) {
    const merged = { ...defaultGlyphEffectParams(fieldSynth), ...(preset.params as Record<string, number | string | boolean>) } as unknown as AnyParams;
    const voices = buildFieldSynthVoices(merged);
    const scale = merged.scale as number;
    const compiledVoices = compileFieldVoices(voices, scale);
    const layerShapes = resolveFieldSynthLayerShapes(merged);
    const program = compileFieldSynthProgram(compiledVoices, layerShapes, true);
    const oracle = buildGlyphFieldDistanceOracle(program, { bias: merged.bias as number, gain: merged.gain as number }, 0);
    if (!oracle) throw new Error("expected mengerSdfPreset to qualify for the sphere-tracing oracle");
    return oracle;
  }

  it("the lattice cell's own center point (object-space origin) is the fractal's recursively-removed center — always outside the solid", () => {
    const oracle = oracleOf(mengerSdfPreset);
    // The Menger construction removes the middle-third cross at every
    // recursion depth, including the cell dead center — the oracle's raw
    // SDF convention is the geometric one (negative = inside the solid,
    // matching `marchGlyphFieldSphere`'s own "D(entry) <= 0 -> hit"
    // contract), so D > 0 (outside the solid) at the cube's own
    // object-space center is the direct consequence of the lattice cell's
    // center (f=0.5,0.5,0.5) landing exactly there.
    expect(oracle(0, 0, 0)).toBeGreaterThan(0);
  });

  it("D(p) === D(-p) along each axis through the object-space center — the anisotropy counter-case: an off-center lattice (e.g. the pre-fix freq1: 0.4) breaks this", () => {
    const oracle = oracleOf(mengerSdfPreset);
    const probes = [0.1, 0.3, 0.5, 0.7, 0.9, 1.0, 1.2, 1.4];
    for (const p of probes) {
      expect(oracle(p, 0, 0)).toBeCloseTo(oracle(-p, 0, 0), 10);
      expect(oracle(0, p, 0)).toBeCloseTo(oracle(0, -p, 0), 10);
      expect(oracle(0, 0, p)).toBeCloseTo(oracle(0, 0, -p), 10);
    }
  });

  it("sierpinskiSdfPreset's uncentered [0,3]^3 pyramid stage needs no origin correction — its own lattice-corner-at-domain-origin mapping is confirmed, not assumed: f=0 at objectPosition 0 and f=1 at objectPosition 3 on every axis", () => {
    const oracle = oracleOf(sierpinskiSdfPreset);
    // The pyramid stage's own corner tetra spans objectPosition [0,3]^3 with
    // its corner already at the domain origin (sierpinskiSdfPreset's own
    // doc in stock.ts) — scale 1/3 alone maps it exactly onto [0,1]^3, so
    // the oracle's raw SDF sample at the lattice's OWN center (f=0.5 on
    // every axis, i.e. objectPosition 1.5) should read the same
    // recursively-removed-center hole `mengerSdfPreset`'s corrected preset
    // does, confirming the existing (uncentered-on-purpose) alignment is
    // intact, not silently different from what the doc claims.
    expect(oracle(1.5, 1.5, 1.5)).toBeGreaterThan(0);
  });
});

describe("buildGlyphFieldDistanceOracle — non-qualifying byte-identity (VOLUMETRIC-3.md §3, acceptance 1)", () => {
  // The two RECIPE presets (linear voices, periodic square waves) can never
  // qualify — the oracle only reads the SDF voice family — so a carve
  // render of either stays on the fixed-step path exactly as before this
  // phase existed. Direct proof, alongside the full existing hash suite
  // (stock.test.ts) passing unchanged.
  function compiledProgramOf(preset: { params: Record<string, unknown> }): { program: FieldProgram; bias: number; gain: number } {
    const merged = { ...defaultGlyphEffectParams(fieldSynth), ...(preset.params as Record<string, number | string | boolean>) } as unknown as AnyParams;
    const voices = buildFieldSynthVoices(merged);
    const scale = merged.scale as number;
    const compiledVoices = compileFieldVoices(voices, scale);
    const layerShapes = resolveFieldSynthLayerShapes(merged);
    const program = compileFieldSynthProgram(compiledVoices, layerShapes, true);
    return { program, bias: merged.bias as number, gain: merged.gain as number };
  }

  it("mengerSpongePreset (linear recipe) never qualifies", () => {
    const { program, bias, gain } = compiledProgramOf(mengerSpongePreset);
    expect(buildGlyphFieldDistanceOracle(program, { bias, gain }, 0)).toBeNull();
  });

  it("sierpinskiPyramidPreset (linear recipe) never qualifies", () => {
    const { program, bias, gain } = compiledProgramOf(sierpinskiPyramidPreset);
    expect(buildGlyphFieldDistanceOracle(program, { bias, gain }, 0)).toBeNull();
  });

  it("gyroidXrayPreset never qualifies (gyroid is explicitly excluded, and it's xray besides)", () => {
    const { program, bias, gain } = compiledProgramOf(gyroidXrayPreset);
    expect(buildGlyphFieldDistanceOracle(program, { bias, gain }, 0)).toBeNull();
  });
});






