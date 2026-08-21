import { describe, expect, it } from "vitest";
import {
  buildGlyphFieldProgram,
  evaluateFieldProgram,
  evaluateFieldProgramInterpreted,
  SYNTH_COMBINES,
  SYNTH_FIELDS,
  SYNTH_WAVES,
  type FieldLayerInput,
  type FieldProgram,
  type FieldVoiceInput,
  type FieldVoiceRawOverride,
} from "./fieldProgram";

// Perf packet: "compile a FieldProgram ONCE into a specialized evaluation
// closure, reused across every probe until the program changes." This file
// is the hard requirement that makes that safe: `evaluateFieldProgram`
// (compiled, cached by program identity) must agree with
// `evaluateFieldProgramInterpreted` (the untouched reference evaluator)
// bit-for-bit — `===`, not an epsilon — because this is a pure dispatch
// optimization; ANY float difference means the compile reordered
// arithmetic, which is a bug, not an acceptable rounding difference.
//
// A fixed-seed PRNG (not `Math.random()`) keeps a failure reproducible
// instead of a one-in-a-thousand flake, and steers well clear of the
// singular points a couple of fields have at their own origin (`angular`/
// `spiral`'s `atan2(0, 0)`) without needing to special-case them.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = mulberry32(0xc0ffee);
const rand = (lo: number, hi: number) => lo + rng() * (hi - lo);
// Keeps every domain coordinate at least this far from the origin — the one
// point `angular`/`spiral` are genuinely undefined at (atan2(0, 0)) — while
// still spanning positive and negative, sub-unit and multi-unit magnitudes.
const coord = () => (rng() < 0.5 ? -1 : 1) * rand(0.15, 3.2);

function assertExactParity(program: FieldProgram, samples: number, label: string): void {
  for (let i = 0; i < samples; i++) {
    const x = coord(), y = coord(), z = coord();
    const time = rand(-5, 5);
    const originX = rand(-1.5, 1.5), originY = rand(-1.5, 1.5), originZ = rand(-1.5, 1.5);
    const interpreted = evaluateFieldProgramInterpreted(program, x, y, z, time, originX, originY, originZ);
    const compiled = evaluateFieldProgram(program, x, y, z, time, originX, originY, originZ);
    expect(compiled.combined, `${label} combined @ sample ${i} (x=${x},y=${y},z=${z},t=${time})`).toBe(interpreted.combined);
    expect(compiled.winner, `${label} winner @ sample ${i}`).toBe(interpreted.winner);
    expect(compiled.active, `${label} active @ sample ${i}`).toBe(interpreted.active);
  }
}

const DOMAINS = ["2d", "3d"] as const;
const SAMPLES_PER_PROGRAM = 24;

function randomVoiceInput(field: string, wave: string, amp: number): FieldVoiceInput {
  return {
    field,
    wave,
    freq: rand(0.4, 3.5),
    speed: rand(-2, 2),
    amp,
    phase: rand(-1.5, 1.5),
    duty: rand(0.1, 0.9),
    angle: rand(-180, 180),
    originU: rand(-1, 1),
    originV: rand(-1, 1),
    originW: rand(-1, 1),
    iter: 1 + Math.floor(rng() * 3), // 1..3, keeps the SDF branch cheap in a sweep this wide
  };
}

describe("compiled field-program evaluator — exact parity with the interpreted reference", () => {
  describe("every field x every wave x both domains (single voice, full amp)", () => {
    for (const domain of DOMAINS) {
      for (const field of SYNTH_FIELDS) {
        for (const wave of SYNTH_WAVES) {
          it(`${domain} / ${field} / ${wave}`, () => {
            const program = buildGlyphFieldProgram({
              domain,
              layers: [{ voices: [randomVoiceInput(field, wave, 1)] }],
            });
            assertExactParity(program, SAMPLES_PER_PROGRAM, `${domain}/${field}/${wave}`);
          });
        }
      }
    }
  });

  describe("every intra-layer combine, multi-voice (amp < 1 per voice, one amp-0 skipped voice)", () => {
    for (const domain of DOMAINS) {
      for (const combine of SYNTH_COMBINES) {
        it(`${domain} / combine=${combine}`, () => {
          const voices: FieldVoiceInput[] = [
            randomVoiceInput("linearX", "square", 0.6),
            randomVoiceInput("radial", "sin", 1),
            randomVoiceInput("menger", "step", 0.35),
            randomVoiceInput("noise", "triangle", 0), // amp 0 -> must be skipped identically by both paths
            randomVoiceInput("gyroid", "saw", 0.8),
          ];
          const program = buildGlyphFieldProgram({ domain, layers: [{ voices, combine }] });
          assertExactParity(program, SAMPLES_PER_PROGRAM, `${domain}/combine=${combine}`);
        });
      }
    }
  });

  describe("beyond UNROLL_MAX (6 active voices/layer) — the generic loop-fallback fold path", () => {
    for (const domain of DOMAINS) {
      for (const combine of SYNTH_COMBINES) {
        it(`${domain} / combine=${combine} / n=6`, () => {
          const voices: FieldVoiceInput[] = [
            randomVoiceInput("linearX", "square", 0.6),
            randomVoiceInput("radial", "sin", 1),
            randomVoiceInput("menger", "step", 0.35),
            randomVoiceInput("gyroid", "saw", 0.8),
            randomVoiceInput("noise", "triangle", 1),
            randomVoiceInput("diagonal", "square", 0.4),
          ];
          const program = buildGlyphFieldProgram({ domain, layers: [{ voices, combine }] });
          assertExactParity(program, SAMPLES_PER_PROGRAM, `${domain}/combine=${combine}/n=6`);
        });
      }
    }
  });

  describe("every cross-layer blend x thresholdOn x invert (amp < 1 per layer)", () => {
    const blends = SYNTH_COMBINES.filter((op) => op !== "argmax"); // layers never blend by argmax
    for (const domain of DOMAINS) {
      for (const blend of blends) {
        for (const thresholdOn of [false, true]) {
          for (const invert of [false, true]) {
            it(`${domain} / blend=${blend} / thresholdOn=${thresholdOn} / invert=${invert}`, () => {
              const layer = (voices: FieldVoiceInput[], mix: number): FieldLayerInput => ({
                voices,
                combine: "add",
                thresholdOn,
                threshold: rand(-0.5, 0.5),
                invert,
                blend,
                mix,
              });
              const program = buildGlyphFieldProgram({
                domain,
                layers: [
                  layer([randomVoiceInput("linearY", "square", 1), randomVoiceInput("spiral", "sin", 0.5)], 0.7),
                  layer([randomVoiceInput("sierpinski", "step", 1)], 1),
                  layer([randomVoiceInput("diagonal", "triangle", 0.4), randomVoiceInput("angular", "saw", 1)], 0.3),
                ],
              });
              assertExactParity(program, SAMPLES_PER_PROGRAM, `${domain}/blend=${blend}/${thresholdOn}/${invert}`);
            });
          }
        }
      }
    }
  });

  describe("the shipped min/max cross-layer short-circuit shape (534f06f), through the compiled path", () => {
    // The exact structure the perf packet measured against: 3 scale layers,
    // intra-layer add+threshold+invert, cross-layer min — this is what
    // exercises `skipsWhenLockedLow`/`High` and the min/max short-circuit
    // inside `compileFold` together, on real Menger-shaped data.
    function scaleLayer(freq: number): FieldLayerInput {
      const axisVoice = (field: string): FieldVoiceInput => ({ field, wave: "square", freq, duty: 1 / 3, phase: -1 / 3 });
      return {
        voices: [axisVoice("linearX"), axisVoice("linearY"), axisVoice("linearZ")],
        combine: "add", thresholdOn: true, threshold: 0, invert: true, blend: "min",
      };
    }
    for (const domain of DOMAINS) {
      it(domain, () => {
        const program = buildGlyphFieldProgram({ domain, layers: [scaleLayer(1), scaleLayer(3), scaleLayer(9)] });
        assertExactParity(program, 200, `menger-shape/${domain}`);
      });
    }
  });

  it("argmax winner tie-break: strict '>' keeps the FIRST voice on an exact tie, identically in both paths", () => {
    // Two voices with the identical field/wave/freq/phase/duty/origin (so
    // their raw sample and thus their contribution are exactly equal at
    // every point) — `contribution > best` is strict, so the second voice
    // can never displace the first.
    const twin = (): FieldVoiceInput => ({ field: "linearX", wave: "sin", freq: 1.3, phase: 0.2 });
    const program = buildGlyphFieldProgram({
      domain: "2d",
      layers: [{ voices: [twin(), twin(), twin()], combine: "argmax" }],
    });
    for (let i = 0; i < 10; i++) {
      const x = coord(), y = coord();
      const interpreted = evaluateFieldProgramInterpreted(program, x, y, 0, 0);
      const compiled = evaluateFieldProgram(program, x, y, 0, 0);
      expect(interpreted.winner).toBe(0);
      expect(compiled.winner).toBe(0);
      expect(compiled.combined).toBe(interpreted.combined);
    }
  });

  it("argmax with a NaN-producing voice: winner correctly resolves to -1 (or a later finite voice), never a spurious first-voice win", () => {
    // A `freq: NaN` voice deterministically samples to NaN everywhere
    // (`raw * NaN` poisons the wave argument regardless of the point) —
    // simpler and more reliable than trying to land exactly on a field's
    // own singularity (`atan2(0, 0)` is actually well-defined as `0` in
    // JS, not NaN, despite being a common source of that assumption).
    // `foldVoices` seeds `best = -Infinity`, and `NaN > -Infinity` is
    // `false`, so a NaN-first voice must NOT win by construction — this is
    // the exact bug this test catches in the unrolled compiled path (an
    // earlier version seeded `best` at the first voice's own contribution
    // instead of `-Infinity`, which made a NaN-first voice win by default).
    const nanFirst = buildGlyphFieldProgram({
      domain: "2d",
      layers: [{
        voices: [
          { field: "linearX", wave: "sin", freq: Number.NaN },
          { field: "linearX", wave: "sin", freq: 1 },
          { field: "linearY", wave: "sin", freq: 1 },
        ],
        combine: "argmax",
      }],
    });
    const interpreted = evaluateFieldProgramInterpreted(nanFirst, 0.3, 0.7, 0, 0);
    const compiled = evaluateFieldProgram(nanFirst, 0.3, 0.7, 0, 0);
    expect(compiled.winner).toBe(interpreted.winner);
    expect(compiled.combined).toBe(interpreted.combined);
    expect(compiled.active).toBe(interpreted.active);

    // Every unrolled arity (n = 1..4), with the NaN voice in every position.
    for (let n = 1; n <= 4; n++) {
      for (let nanAt = 0; nanAt < n; nanAt++) {
        const voices: FieldVoiceInput[] = [];
        for (let i = 0; i < n; i++) {
          voices.push(i === nanAt
            ? { field: "linearX", wave: "sin", freq: Number.NaN }
            : randomVoiceInput("linearX", "sin", 1));
        }
        const program = buildGlyphFieldProgram({ domain: "2d", layers: [{ voices, combine: "argmax" }] });
        const x = coord(), y = coord();
        const interp = evaluateFieldProgramInterpreted(program, x, y, 0, 0);
        const comp = evaluateFieldProgram(program, x, y, 0, 0);
        expect(comp.winner, `n=${n} nanAt=${nanAt} winner`).toBe(interp.winner);
        expect(comp.combined, `n=${n} nanAt=${nanAt} combined`).toBe(interp.combined);
      }
    }
  });

  it("argmax across multiple populated layers reports winner -1 in both paths (winner only meaningful single-layer)", () => {
    const program = buildGlyphFieldProgram({
      domain: "3d",
      layers: [
        { voices: [randomVoiceInput("radial", "sin", 1), randomVoiceInput("linearX", "square", 1)], combine: "argmax" },
        { voices: [randomVoiceInput("linearY", "saw", 1)], combine: "add", blend: "add" },
      ],
    });
    assertExactParity(program, SAMPLES_PER_PROGRAM, "argmax-multi-layer");
  });

  it("rawOverride present: evaluateFieldProgram delegates to the interpreted evaluator unchanged (no silent divergence)", () => {
    const program = buildGlyphFieldProgram({
      domain: "2d",
      layers: [{ voices: [randomVoiceInput("normalX", "sin", 1), randomVoiceInput("linearX", "square", 1)] }],
    });
    const override: FieldVoiceRawOverride = (voice) => (voice.field === "normalX" ? 0.42 : undefined);
    for (let i = 0; i < 10; i++) {
      const x = coord(), y = coord();
      const interpreted = evaluateFieldProgramInterpreted(program, x, y, 0, 0, 0, 0, 0, override);
      const withOverride = evaluateFieldProgram(program, x, y, 0, 0, 0, 0, 0, override);
      expect(withOverride).toEqual(interpreted);
    }
    // And with the override removed, the SAME program object still resolves
    // through the (now cached) compiled path — proves the cache isn't
    // corrupted by an earlier rawOverride call against the same program.
    assertExactParity(program, SAMPLES_PER_PROGRAM, "post-rawOverride reuse");
  });

  it("repeated evaluate calls against the SAME program object reuse one compiled entry (identity cache) without drifting", () => {
    const program = buildGlyphFieldProgram({
      domain: "3d",
      layers: [{ voices: [randomVoiceInput("menger", "step", 1), randomVoiceInput("sierpinski", "step", 0.6)], combine: "min" }],
    });
    // First pass warms the cache; second pass proves the cached compile is
    // stable (not rebuilt, not stale) across many subsequent calls.
    assertExactParity(program, SAMPLES_PER_PROGRAM, "cache-warm");
    assertExactParity(program, SAMPLES_PER_PROGRAM, "cache-reuse");
  });

  it("two structurally-identical but distinct program objects each get their own correct compile (identity, not structural, caching)", () => {
    // Fixed literal values (not `randomVoiceInput`, which draws fresh
    // numbers from the shared RNG on every call) — these two builds must be
    // structurally IDENTICAL, differing only in object identity, for this
    // test to actually exercise "compiled by identity, not by structure".
    const voice: FieldVoiceInput = { field: "gyroid", wave: "sin", freq: 1.7, speed: 0.3, amp: 1, phase: 0.4, duty: 0.5, angle: 25, originU: 0.1, originV: -0.2, originW: 0.05 };
    const build = (): FieldProgram => buildGlyphFieldProgram({
      domain: "2d",
      layers: [{ voices: [{ ...voice }] }],
    });
    const a = build();
    const b = build();
    expect(a).not.toBe(b);
    for (let i = 0; i < 10; i++) {
      const x = coord(), y = coord();
      const ra = evaluateFieldProgram(a, x, y, 0, 0);
      const rb = evaluateFieldProgram(b, x, y, 0, 0);
      const interp = evaluateFieldProgramInterpreted(a, x, y, 0, 0);
      expect(ra.combined).toBe(interp.combined);
      expect(rb.combined).toBe(interp.combined);
    }
  });
});
