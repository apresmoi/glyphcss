import { describe, expect, it } from "vitest";
import {
  effectiveVoiceFinestFreq,
  evaluateFieldProgram,
  fieldStepCount,
  integrateField,
  marchField,
  mengerFractalSdf,
  sampleFieldVoice,
  sierpinskiFractalSdf,
  SYNTH_FIELDS,
  SYNTH_WAVES,
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
