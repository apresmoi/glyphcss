import { describe, expect, it, vi } from "vitest";
import {
  GLYPH_FIELD_SYNTH_VALIDATION_RULES,
  GlyphFieldSynthEffect as fieldSynth,
  GlyphIridescentShellPreset,
  GlyphIridescentSpongePreset,
} from "@glyphcss/effects";
import { createUrlCodec, encodeEffectParamsPacked } from "../../lib/urlState";
import {
  COERCION_HANDLED_RULES,
  LEGACY_V2_FIELD_SYNTH_SCHEMA,
  MAX_VOICES,
  SYNTH_PARAM_DEFAULTS,
  SYNTH_REPAIR_TABLE,
  SYNTH_URL_DEFAULTS,
  applySynthValidityGate,
  decodeSynthUrlState,
  encodeSynthUrlState,
  sanitizeCarveRenderForSpace,
  synthCodec,
  type Lighting,
  type Params,
  type SynthUrlState,
} from "./synthUrlState";

// Captured once by running the "pins the ... packed URL string" tests below
// and reading back the produced value (the same "compute, then pin" process
// `"omits the whole param when everything is default"`'s `"p3"` used) — not
// hand-derived from the base62 packing scheme.
const IRIDESCENT_SPONGE_PACKED = "p3s1t3g7cd1iv17a23ce21ok1uK9zelmm16paj.13213516371a810d2e3f1ag10l7m3n1ao10p1kt1u3v1uw10x1kB2C3D1uE10F1kJ7K3L1uM10N1kX5f8w1Y2a2nkZ18_181x_191x_1a1x_1b1x_1c1x_1d1x_1e2-x_1f2-x_1g2-x_1h2-x_1i2-x_1j2-x_1t12_1u12_1v12_1w0_1x0_1y0_1z1_1A1_1B1_1F1_1G1_1H1_1I3_1J3_1K3_1O1_1Q21e_1Z1_202_217_223_233_243_2522i_2622i_2722i_2810_2910_2a10_2b1k_2c1k_2d1k_2q1x_2r1x_2s1x_2t2-x_2u2-x_2v2-x_2z13_2A13_2B13_2F1_2H1_2K228_2Me_2S1a_2V11";
const IRIDESCENT_SHELL_PACKED = "p3s2t3g7cd1iv17a23ce21ok1uK9zelmm16p1d.1321a71ah10S10T1kU1.█_2F1_2H1_2K22i_2Me_2S1a_2V11";

function representativePatch(): { shape: string; params: Params; timeScale: number; density: number; lighting: Lighting; voiceSlots: number[] } {
  const params: Params = {
    ...SYNTH_PARAM_DEFAULTS,
    field1: "spiral", wave1: "square", freq1: 7.5, speed1: -1.2, amp1: 0.8, color1: "#ff0000",
    field2: "noise", wave2: "triangle", freq2: 3.3, speed2: 0.9, amp2: 0.6, color2: "#00ff00",
    field3: "diagonal", wave3: "saw", freq3: 5, speed3: 0.4, amp3: 0.3, color3: "#0000ff",
    combine: "difference",
    gain: 2.5,
    bias: 0.1,
    glyphs: "  ..--==##@@",
    color: "#7df9ff",
    colorB: "#ff4fa3",
    gradient: 0.6,
    lit: 0.8,
    voiceColors: true,
  };
  return {
    shape: "sphere",
    params,
    timeScale: 2.1,
    density: 1.8,
    lighting: { azimuth: 120, elevation: 60, keyIntensity: 1.5, keyColor: "#ffddaa", ambient: 0.3 },
    voiceSlots: [1, 2, 3],
  };
}

describe("synth url state", () => {
  it("omits the whole param when everything is default", () => {
    const packed = encodeSynthUrlState({
      shape: SYNTH_URL_DEFAULTS.shape,
      params: SYNTH_PARAM_DEFAULTS,
      timeScale: SYNTH_URL_DEFAULTS.timeScale,
      density: SYNTH_URL_DEFAULTS.density,
      lighting: { azimuth: 40, elevation: 38, keyIntensity: 1.1, keyColor: "#ffffff", ambient: 0.5 },
      voiceSlots: [1, 2],
    });
    expect(packed).toBe("p3");
  });

  it("round-trips a representative multi-voice patch", () => {
    const patch = representativePatch();
    const restored = decodeSynthUrlState(encodeSynthUrlState(patch));
    expect(restored.shape).toBe(patch.shape);
    expect(restored.timeScale).toBe(patch.timeScale);
    expect(restored.density).toBeCloseTo(patch.density, 5);
    expect(restored.lighting).toEqual(patch.lighting);
    expect(restored.voiceSlots).toEqual(patch.voiceSlots);
    for (const [key, value] of Object.entries(patch.params)) {
      if (key === "time") continue;
      if (typeof value === "number") expect(restored.params[key]).toBeCloseTo(value, 3);
      else expect(restored.params[key]).toBe(value);
    }
  });

  it("packs a busy patch to a reasonable size (well under base64(JSON) territory)", () => {
    const packed = encodeSynthUrlState(representativePatch());
    expect(packed.length).toBeLessThan(200);
    // eslint-disable-next-line no-console
    console.log(`synth representative packed length: ${packed.length}`);
  });

  it("supports up to MAX_VOICES distinct slots in the bitmask (VOLUMETRIC-3.md §4: 9, not the pre-bump 6)", () => {
    const allSlots = Array.from({ length: MAX_VOICES }, (_, i) => i + 1);
    const patch = { ...representativePatch(), voiceSlots: allSlots };
    expect(MAX_VOICES).toBe(9);
    expect(decodeSynthUrlState(encodeSynthUrlState(patch)).voiceSlots).toEqual(allSlots);
  });

  it("round-trips the new voice7-9 param keys (VOLUMETRIC-3.md §4's SYNTH_VOICES 6 -> 9 bump, appended at the schema tail)", () => {
    const base = representativePatch();
    const patch = {
      ...base,
      params: {
        ...base.params,
        field7: "gyroid", wave7: "sin", freq7: 2.5, speed7: 0.2, amp7: 0.5, color7: "#ffaa00",
        field8: "menger", wave8: "step", freq8: 1.1, speed8: 0, amp8: 0.4, color8: "#00aaff", iter8: 2,
        field9: "sierpinski", wave9: "step", freq9: 0.9, speed9: 0, amp9: 0.7, color9: "#aa00ff", iter9: 4,
      },
    };
    const restored = decodeSynthUrlState(encodeSynthUrlState(patch));
    for (const [key, value] of Object.entries(patch.params)) {
      if (typeof value === "number") expect(restored.params[key], key).toBeCloseTo(value, 3);
      else expect(restored.params[key], key).toBe(value);
    }
  });

  it("never throws on garbage/truncated input", () => {
    for (const garbage of ["", "not-json-anymore", "p9futurever", "z1garbage"]) {
      expect(() => synthCodec.decode(garbage)).not.toThrow();
    }
  });

  it("round-trips a free-text glyph ramp with special characters", () => {
    const patch = { ...representativePatch(), params: { ...representativePatch().params, glyphs: " .:-=+*#%@~" } };
    expect(decodeSynthUrlState(encodeSynthUrlState(patch)).params.glyphs).toBe(" .:-=+*#%@~");
  });
});

// VOLUMETRIC-4.md §1's shipped patch: both iridescent presets exercise the
// colour voice stack's full new key range (colorStackOn, cfield1, colorMode,
// hueRange/Offset/Sat/Light) through the REAL shipped preset objects, not a
// hand-built patch — the same precedent "round-trips the new voice7-9 param
// keys" above sets for the prior schema-tail bump. Pinning the exact packed
// STRING (not just a round-trip) is the same style `"omits the whole param
// when everything is default"` uses above: it catches a schema-tail
// reordering or an index shift immediately, as a diff in this literal,
// rather than only when some future decode happens to disagree.
describe("iridescent presets (VOLUMETRIC-4.md §1's shipped patch)", () => {
  function presetPatch(preset: { params: Partial<Params> }, shape: string) {
    return {
      ...representativePatch(),
      shape,
      params: { ...SYNTH_PARAM_DEFAULTS, ...(preset.params as Params) },
    };
  }

  // The packed codec quantizes every NUMBER param to its OWN schema `step`
  // (`round(value, step) === Math.round(value/step)*step` — urlState.ts's
  // `round`), so the correct round-trip tolerance is "within half a step",
  // not a fixed decimal-places guess. `mengerSpongePreset`'s recipe (which
  // "Iridescent sponge" inherits unchanged) uses `1/3`/`-1/3` for several
  // `duty`/`phase`/`scale` keys — none of those are step-aligned, so this is
  // pre-existing, unrelated to this preset's own colour-stack additions
  // (every colour-stack key here IS step-aligned and round-trips exactly).
  function stepFor(key: string): number {
    const spec = (fieldSynth.parameterSchema as unknown as Record<string, { step?: number }>)[key];
    return spec?.step && spec.step > 0 ? spec.step : 0.0001;
  }

  function expectParamsRoundTrip(patch: ReturnType<typeof presetPatch>): void {
    const restored = decodeSynthUrlState(encodeSynthUrlState(patch));
    for (const [key, value] of Object.entries(patch.params)) {
      if (key === "time") continue;
      if (typeof value === "number") {
        const step = stepFor(key);
        expect(Math.abs((restored.params[key] as number) - value), key).toBeLessThanOrEqual(step / 2 + 1e-9);
      } else {
        expect(restored.params[key], key).toBe(value);
      }
    }
  }

  it("round-trips the Iridescent sponge preset's params exactly (within each param's own schema step)", () => {
    expectParamsRoundTrip(presetPatch(GlyphIridescentSpongePreset, "cube"));
  });

  it("round-trips the Iridescent shell preset's params exactly (within each param's own schema step)", () => {
    expectParamsRoundTrip(presetPatch(GlyphIridescentShellPreset, "sphere"));
  });

  it("pins the Iridescent sponge preset's packed URL string", () => {
    const packed = encodeSynthUrlState(presetPatch(GlyphIridescentSpongePreset, "cube"));
    expect(packed).toBe(IRIDESCENT_SPONGE_PACKED);
  });

  it("pins the Iridescent shell preset's packed URL string", () => {
    const packed = encodeSynthUrlState(presetPatch(GlyphIridescentShellPreset, "sphere"));
    expect(packed).toBe(IRIDESCENT_SHELL_PACKED);
  });
});

// ── Acceptance 7 (VOLUMETRIC.md): the URL codec's schema-index cap ─────────
// `encodeEffectParamsPacked` keyed params by a single base62 char, capping at
// index 61. `fieldSynthSchema` is well past 120 keys, so every param below —
// `lit`/`voiceColors`/`color1..6` (pre-existing, silently dropped before this
// fix) and every VOLUMETRIC.md param (layers, duty, phase, originW, render,
// marchSteps, marchFade) — lands past that cap and needs the multi-char index
// escape (`encodeTokenIndex`/`decodeTokenIndex` in `../../lib/urlState`) to
// round-trip at all.
function everyNewParamPatch(): { shape: string; params: Params; timeScale: number; density: number; lighting: Lighting; voiceSlots: number[] } {
  const base = representativePatch();
  return {
    ...base,
    params: {
      ...base.params,
      space: "object",
      scale: 1.5,
      // Pre-existing indices >= 62, dropped before this fix.
      lit: 0.35,
      voiceColors: true,
      color1: "#111111", color2: "#222222", color3: "#333333",
      color4: "#444444", color5: "#555555", color6: "#666666",
      // Step 2 (3D voices): duty/phase/originW, one distinct value per slot.
      duty1: 0.15, duty2: 0.25, duty3: 0.35, duty4: 0.45, duty5: 0.55, duty6: 0.65,
      phase1: -0.1, phase2: 0.15, phase3: -0.2, phase4: 0.25, phase5: -0.3, phase6: 0.35,
      originW1: 0.1, originW2: -0.1, originW3: 0.2, originW4: -0.2, originW5: 0.3, originW6: -0.3,
      amp4: 0.7, amp5: 0.6, amp6: 0.5,
      // Step 3 (voice layers): every voice split across all 3 layers, every
      // layer's shaping knob touched.
      layer1: 1, layer2: 1, layer3: 2, layer4: 2, layer5: 3, layer6: 3,
      layerCombine1: "add", layerCombine2: "max", layerCombine3: "min",
      layerThresholdOn1: true, layerThresholdOn2: true, layerThresholdOn3: true,
      layerThreshold1: 1.5, layerThreshold2: -1, layerThreshold3: 2,
      layerInvert1: true, layerInvert2: false, layerInvert3: true,
      layerBlend1: "add", layerBlend2: "difference", layerBlend3: "max",
      layerAmp1: 0.8, layerAmp2: 0.6, layerAmp3: 0.4,
      // Carve mode.
      subcellRes: "1x1",
      render: "carve",
      marchSteps: 96,
      marchFade: 2.5,
    },
  };
}

describe("synth url state — VOLUMETRIC.md acceptance 7", () => {
  it("round-trips a patch touching every new param, including the formerly-dropped lit/voiceColors/color1..6", () => {
    const patch = everyNewParamPatch();
    const restored = decodeSynthUrlState(encodeSynthUrlState(patch));
    for (const [key, value] of Object.entries(patch.params)) {
      if (key === "time") continue;
      if (typeof value === "number") expect(restored.params[key], key).toBeCloseTo(value, 3);
      else expect(restored.params[key], key).toBe(value);
    }
  });

  it("decodes a pre-bump ('p1'-tagged) legacy URL exactly as before, with formerly-dropped fields left at default", () => {
    // Built with the pre-fix (version "1") encoder — the fields it touches
    // (shape, voice1/voice2 basics, combine/gain/bias, glyphs, color/colorB/
    // gradient) all sit at indices < 62, so the encoded bytes are identical
    // whether the pre-fix or the fixed encoder produced them; what this test
    // actually exercises is the outer "p1" version tag routing to the legacy
    // codec instead of being rejected by the version-2 gate.
    const legacy = "p1s2t3g7cd1ia23ce21ok1uK9zelmm16p1j.5563722382-o91gd6e1f1xg1ih1cR4S21eT12Uc.  ..--==##@@Z1c";
    const restored = decodeSynthUrlState(legacy);
    expect(restored.shape).toBe("sphere");
    expect(restored.timeScale).toBe(2.1);
    expect(restored.density).toBeCloseTo(1.8, 5);
    expect(restored.lighting).toEqual({ azimuth: 120, elevation: 60, keyIntensity: 1.5, keyColor: "#ffddaa", ambient: 0.3 });
    expect(restored.params.field1).toBe("spiral");
    expect(restored.params.wave1).toBe("square");
    expect(restored.params.freq1).toBeCloseTo(7.5, 3);
    expect(restored.params.speed1).toBeCloseTo(-1.2, 3);
    expect(restored.params.amp1).toBeCloseTo(0.8, 3);
    expect(restored.params.field2).toBe("noise");
    expect(restored.params.combine).toBe("difference");
    expect(restored.params.gain).toBeCloseTo(2.5, 3);
    expect(restored.params.bias).toBeCloseTo(0.1, 3);
    expect(restored.params.glyphs).toBe("  ..--==##@@");
    expect(restored.params.color).toBe("#7df9ff");
    expect(restored.params.colorB).toBe("#ff4fa3");
    expect(restored.params.gradient).toBeCloseTo(0.6, 3);
    // Never encoded by the pre-fix link (index >= 62 was silently dropped) —
    // decoding it today must NOT retroactively invent values for them.
    expect(restored.params.lit).toBe(SYNTH_PARAM_DEFAULTS.lit);
    expect(restored.params.voiceColors).toBe(SYNTH_PARAM_DEFAULTS.voiceColors);
    expect(restored.params.color1).toBe(SYNTH_PARAM_DEFAULTS.color1);
  });

  it("enum index stability: linearZ (appended to SYNTH_FIELDS) and render's carve value decode to the expected string", () => {
    const patch = { ...representativePatch(), params: { ...representativePatch().params, field3: "linearZ", render: "carve", space: "object", subcellRes: "1x1" } };
    const restored = decodeSynthUrlState(encodeSynthUrlState(patch));
    expect(restored.params.field3).toBe("linearZ");
    expect(restored.params.render).toBe("carve");
  });
});

// ── Slab removal: SYNTH_SCHEMA_VERSION 2 -> 3 (VOLUMETRIC-2.md §1 Reconciliation) ──
// Slab's three schema keys sat BEFORE `iter1..6` (and every later Phase-4
// key), not at the schema tail, so removing them shifts every later key's
// positional index in the packed `paramsPacked` token stream. A "2"-tagged
// link's `paramsPacked` must therefore decode against the OLD key order
// (`LEGACY_V2_FIELD_SYNTH_SCHEMA`) to land iter1..6/etc. correctly — these
// tests build a genuine "p2..."-tagged link the same way the live v2 encoder
// once did (against the OLD schema, since the current encoder only ever
// produces "p3").
function maskFromSlots(slots: readonly number[]): number {
  let mask = 0;
  for (const slot of slots) mask |= 1 << (slot - 1);
  return mask;
}
const LEGACY_V2_DEFAULTS: Params = { ...SYNTH_PARAM_DEFAULTS, slabAxis: "none", slabStart: -1, slabEnd: 1 };
const legacyV2OuterCodec = createUrlCodec<SynthUrlState>("2", synthCodec.fields);
function encodeLegacyV2(state: ReturnType<typeof representativePatch>, legacyParams: Params): string {
  const paramsPacked = encodeEffectParamsPacked(LEGACY_V2_FIELD_SYNTH_SCHEMA, LEGACY_V2_DEFAULTS, legacyParams);
  return legacyV2OuterCodec.encode({
    shape: state.shape,
    timeScale: state.timeScale,
    density: state.density,
    voiceSlotMask: maskFromSlots(state.voiceSlots),
    lightAzimuth: state.lighting.azimuth,
    lightElevation: state.lighting.elevation,
    lightKeyIntensity: state.lighting.keyIntensity,
    lightKeyColor: state.lighting.keyColor,
    lightAmbient: state.lighting.ambient,
    paramsPacked,
  });
}

describe("synth url state — v2 legacy decode (post-slab-removal)", () => {
  it("a v2 URL with slab params set decodes to the same patch, minus slab (the values are parsed then discarded)", () => {
    const patch = representativePatch();
    const legacyParams: Params = { ...patch.params, slabAxis: "z", slabStart: 0.3, slabEnd: 0.7, iter1: 4, iter2: 2 };
    const packed = encodeLegacyV2(patch, legacyParams);
    expect(packed[1]).toBe("2"); // sanity: genuinely v2-tagged
    const restored = decodeSynthUrlState(packed);
    expect("slabAxis" in restored.params).toBe(false);
    expect("slabStart" in restored.params).toBe(false);
    expect("slabEnd" in restored.params).toBe(false);
    // Every non-slab override (including iter1/iter2, which sit AFTER slab in
    // the old key order) must still land correctly despite the index shift.
    for (const [key, value] of Object.entries(legacyParams)) {
      if (key === "time" || key === "slabAxis" || key === "slabStart" || key === "slabEnd") continue;
      if (typeof value === "number") expect(restored.params[key], key).toBeCloseTo(value, 3);
      else expect(restored.params[key], key).toBe(value);
    }
    expect(restored.params.iter1).toBeCloseTo(4, 3);
    expect(restored.params.iter2).toBeCloseTo(2, 3);
  });

  it("a v2 URL without any slab override decodes identically to the equivalent v3 link", () => {
    const patch = representativePatch();
    const packedLegacy = encodeLegacyV2(patch, patch.params);
    const packedCurrent = encodeSynthUrlState(patch);
    const restoredLegacy = decodeSynthUrlState(packedLegacy);
    const restoredCurrent = decodeSynthUrlState(packedCurrent);
    for (const [key, value] of Object.entries(patch.params)) {
      if (key === "time") continue;
      if (typeof value === "number") {
        expect(restoredLegacy.params[key], key).toBeCloseTo(value, 3);
        expect(restoredLegacy.params[key], key).toBeCloseTo(restoredCurrent.params[key] as number, 3);
      } else {
        expect(restoredLegacy.params[key], key).toBe(value);
        expect(restoredLegacy.params[key], key).toBe(restoredCurrent.params[key]);
      }
    }
  });

  it("v3 (current) links round-trip and are tagged \"p3\"", () => {
    const patch = representativePatch();
    const packed = encodeSynthUrlState(patch);
    expect(packed[1]).toBe("3");
    const restored = decodeSynthUrlState(packed);
    expect("slabAxis" in restored.params).toBe(false);
    for (const [key, value] of Object.entries(patch.params)) {
      if (key === "time") continue;
      if (typeof value === "number") expect(restored.params[key], key).toBeCloseTo(value, 3);
      else expect(restored.params[key], key).toBe(value);
    }
  });

  it("the v1 path is unaffected: a \"p1\"-tagged link still decodes against the current (post-removal) schema with no slab leakage", () => {
    const legacy = "p1s2t3g7cd1ia23ce21ok1uK9zelmm16p1j.5563722382-o91gd6e1f1xg1ih1cR4S21eT12Uc.  ..--==##@@Z1c";
    const restored = decodeSynthUrlState(legacy);
    expect(restored.shape).toBe("sphere");
    expect(restored.params.field1).toBe("spiral");
    expect("slabAxis" in restored.params).toBe(false);
  });
});

// ── Final-gate fix: cross-field-invalid {space, render} hydration ──────────
// A hand-crafted URL can encode {space: any non-"object", render: "carve"}
// directly — no live UI write can ever produce it (every `space` write routes
// through `resolveSpaceChange`), but decode has no gate of its own, so that
// combination used to decode cleanly and hand `fieldSynth.program
// .validateParams` a patch it throws on the moment `addEffectLayer` mounts it
// (`validateFieldSynthRender` requires `space: "object"` for `render:
// "carve"`), crashing the /synth React island to a blank stage.
describe("synth url state — carve/space hydration is sanitized", () => {
  it("a v2 URL encoding {space:'surface', render:'carve'} decodes to params that pass validateParams (render coerced to paint)", () => {
    const patch = { ...representativePatch(), params: { ...representativePatch().params, space: "surface", render: "carve" } };
    const packed = encodeSynthUrlState(patch);
    const restored = decodeSynthUrlState(packed);
    expect(restored.params.space).toBe("surface");
    expect(restored.params.render).toBe("paint");
    expect(() => fieldSynth.program.validateParams?.({ ...restored.params, time: 0 } as never)).not.toThrow();
  });

  it("control: a legit {space:'object', render:'carve'} URL round-trips carve intact", () => {
    const patch = { ...representativePatch(), params: { ...representativePatch().params, space: "object", render: "carve", subcellRes: "1x1" } };
    const packed = encodeSynthUrlState(patch);
    const restored = decodeSynthUrlState(packed);
    expect(restored.params.space).toBe("object");
    expect(restored.params.render).toBe("carve");
    expect(() => fieldSynth.program.validateParams?.({ ...restored.params, time: 0 } as never)).not.toThrow();
  });

  // VOLUMETRIC-2.md §4: the coercion extends to xray the same way it already
  // covers carve.
  it("a v2 URL encoding {space:'surface', render:'xray'} decodes to params that pass validateParams (render coerced to paint)", () => {
    const patch = { ...representativePatch(), params: { ...representativePatch().params, space: "surface", render: "xray" } };
    const packed = encodeSynthUrlState(patch);
    const restored = decodeSynthUrlState(packed);
    expect(restored.params.space).toBe("surface");
    expect(restored.params.render).toBe("paint");
    expect(() => fieldSynth.program.validateParams?.({ ...restored.params, time: 0 } as never)).not.toThrow();
  });

  it("control: a legit {space:'object', render:'xray'} URL round-trips xray intact", () => {
    const patch = { ...representativePatch(), params: { ...representativePatch().params, space: "object", render: "xray", subcellRes: "1x1" } };
    const packed = encodeSynthUrlState(patch);
    const restored = decodeSynthUrlState(packed);
    expect(restored.params.space).toBe("object");
    expect(restored.params.render).toBe("xray");
    expect(() => fieldSynth.program.validateParams?.({ ...restored.params, time: 0 } as never)).not.toThrow();
  });

  it("sanitizeCarveRenderForSpace itself treats \"carve\" and \"xray\" identically", () => {
    expect(sanitizeCarveRenderForSpace("surface", "carve")).toBe("paint");
    expect(sanitizeCarveRenderForSpace("surface", "xray")).toBe("paint");
    expect(sanitizeCarveRenderForSpace("object", "carve")).toBe("carve");
    expect(sanitizeCarveRenderForSpace("object", "xray")).toBe("xray");
    expect(sanitizeCarveRenderForSpace("surface", "paint")).toBe("paint");
  });
});

// ── URL hydration validity gate (VOLUMETRIC-2.md §4) ────────────────────────
describe("synth url state — hydration validity gate (VOLUMETRIC-2.md §4)", () => {
  // VOLUMETRIC-3.md §2: carve+ink and carve+2x4 became legal — a crafted
  // carve+2x4/ink URL must round-trip completely UNTOUCHED by the gate, not
  // get "repaired" to the schema default subcellRes anymore.
  it.each(["2x4", "ink"] as const)("a crafted carve+%s URL hydrates untouched — carve computes it directly, nothing to repair", (subcellRes) => {
    const patch = {
      ...representativePatch(),
      params: { ...representativePatch().params, space: "object", render: "carve", subcellRes },
    };
    const packed = encodeSynthUrlState(patch);
    const restored = decodeSynthUrlState(packed);
    expect(restored.params.render).toBe("carve");
    expect(restored.params.subcellRes).toBe(subcellRes);
    expect(() => fieldSynth.program.validateParams?.({ ...restored.params, time: 0 } as never)).not.toThrow();
  });

  it.each(["2x4", "ink"] as const)("a crafted xray+%s URL hydrates to a working page: subcellRes resets to the schema default", (subcellRes) => {
    const patch = {
      ...representativePatch(),
      params: { ...representativePatch().params, space: "object", render: "xray", subcellRes },
    };
    const restored = decodeSynthUrlState(encodeSynthUrlState(patch));
    expect(restored.params.render).toBe("xray");
    expect(restored.params.subcellRes).toBe(SYNTH_PARAM_DEFAULTS.subcellRes);
    expect(() => fieldSynth.program.validateParams?.({ ...restored.params, time: 0 } as never)).not.toThrow();
  });

  it("a crafted multi-layer-argmax URL hydrates to a working page: combine resets to the schema default", () => {
    const patch = {
      ...representativePatch(),
      params: {
        ...representativePatch().params,
        combine: "argmax",
        amp1: 1, layer1: 1, layerCombine1: "inherit",
        amp2: 1, layer2: 2, layerCombine2: "inherit",
      },
    };
    const restored = decodeSynthUrlState(encodeSynthUrlState(patch));
    expect(restored.params.combine).toBe(SYNTH_PARAM_DEFAULTS.combine);
    expect(() => fieldSynth.program.validateParams?.({ ...restored.params, time: 0 } as never)).not.toThrow();
  });

  it("empty glyphs and non-positive scale both repair to the schema default", () => {
    const emptyGlyphs = decodeSynthUrlState(encodeSynthUrlState({
      ...representativePatch(),
      params: { ...representativePatch().params, glyphs: "" },
    }));
    expect(emptyGlyphs.params.glyphs).toBe(SYNTH_PARAM_DEFAULTS.glyphs);

    const badScale = applySynthValidityGate({ ...SYNTH_PARAM_DEFAULTS, scale: 0 } as Params);
    expect(badScale.scale).toBe(SYNTH_PARAM_DEFAULTS.scale);
    expect(() => fieldSynth.program.validateParams?.({ ...badScale, time: 0 } as never)).not.toThrow();
  });

  it("a single populated layer resolving to argmax stays legal (argmax is single-layer-only, not banned outright)", () => {
    const params = { ...SYNTH_PARAM_DEFAULTS, combine: "argmax", amp1: 1, layer1: 1 } as Params;
    const repaired = applySynthValidityGate(params);
    expect(repaired.combine).toBe("argmax"); // untouched — nothing to repair
    expect(() => fieldSynth.program.validateParams?.({ ...repaired, time: 0 } as never)).not.toThrow();
  });

  it("a legit volumetric URL with no invalid combination round-trips completely untouched by the gate", () => {
    const patch = {
      ...representativePatch(),
      params: { ...representativePatch().params, space: "object", render: "carve", subcellRes: "1x1", marchSteps: 96, marchFade: 2.5 },
    };
    const gated = applySynthValidityGate({ ...SYNTH_PARAM_DEFAULTS, ...patch.params } as Params);
    expect(gated).toEqual({ ...SYNTH_PARAM_DEFAULTS, ...patch.params });
  });

  it("tier 2: if a hypothetical future validator throws for a combination no repair-table row fixes, the WHOLE effect-param object resets to schema defaults", () => {
    // Simulate a throw the repair table doesn't (and can't) know about —
    // mock the REAL validator to throw unconditionally, on an otherwise
    // perfectly valid patch. `applySynthValidityGate` must not loop forever
    // or return a still-"invalid" (per the mock) patch; it must fall back to
    // the full schema defaults.
    const spy = vi.spyOn(fieldSynth.program, "validateParams").mockImplementation(() => {
      throw new TypeError("a future validator this repair table doesn't know about");
    });
    try {
      const gated = applySynthValidityGate({ ...SYNTH_PARAM_DEFAULTS });
      expect(gated).toEqual(SYNTH_PARAM_DEFAULTS);
    } finally {
      spy.mockRestore();
    }
  });

  // Completeness (VOLUMETRIC-2.md §4 P2 fix): every rule id in the REAL
  // exported `GLYPH_FIELD_SYNTH_VALIDATION_RULES` (packages/effects/src/
  // stock.ts's own throw-site registry — not a website-side hand mirror of
  // it) is covered by either `SYNTH_REPAIR_TABLE` or `COERCION_HANDLED_RULES`.
  // This is genuine drift detection: a validator added to stock.ts gets a
  // new id appended to that exported array automatically, and if nobody adds
  // a matching website entry, THIS assertion fails — no manually-maintained
  // trigger list to keep in sync, and no self-referential length check.
  it("every exported field-synth validation rule id has a repair-table row or an explicit coercion entry", () => {
    for (const id of GLYPH_FIELD_SYNTH_VALIDATION_RULES) {
      const handled = id in SYNTH_REPAIR_TABLE || COERCION_HANDLED_RULES.includes(id);
      expect(handled, `rule id "${id}" has neither a SYNTH_REPAIR_TABLE row nor a COERCION_HANDLED_RULES entry`).toBe(true);
    }
  });

  it("SYNTH_REPAIR_TABLE and COERCION_HANDLED_RULES don't overlap (one guard per rule id, not two competing ones)", () => {
    for (const id of COERCION_HANDLED_RULES) {
      expect(id in SYNTH_REPAIR_TABLE, `"${id}" is in both SYNTH_REPAIR_TABLE and COERCION_HANDLED_RULES`).toBe(false);
    }
  });

  interface KnownThrowSite {
    readonly id: (typeof GLYPH_FIELD_SYNTH_VALIDATION_RULES)[number];
    readonly make: (base: Params) => Params;
  }
  // One real trigger per exported rule id — these exercise the REAL
  // validator (not a re-derivation of its logic), and the first assertion
  // below (the trigger still throws, tagged with exactly that id) is what
  // makes a stale trigger fail loudly instead of silently passing.
  const KNOWN_THROW_SITES: readonly KnownThrowSite[] = [
    { id: "empty-glyphs", make: (p) => ({ ...p, glyphs: "" }) },
    { id: "non-positive-scale", make: (p) => ({ ...p, scale: 0 }) },
    {
      id: "multi-layer-argmax",
      make: (p) => ({ ...p, combine: "argmax", amp1: 1, layer1: 1, layerCombine1: "inherit", amp2: 1, layer2: 2, layerCombine2: "inherit" }),
    },
    { id: "xray-subcell-unsupported", make: (p) => ({ ...p, space: "object", render: "xray", subcellRes: "2x4" }) },
    { id: "carve-requires-object-space", make: (p) => ({ ...p, space: "surface", render: "carve" }) },
    { id: "normal-field-requires-color-stack", make: (p) => ({ ...p, field1: "incidence", amp1: 1 }) },
  ];

  it("KNOWN_THROW_SITES covers every exported rule id exactly once (no missing/extra trigger)", () => {
    expect(new Set(KNOWN_THROW_SITES.map((s) => s.id))).toEqual(new Set(GLYPH_FIELD_SYNTH_VALIDATION_RULES));
  });

  it("every known throw site's REAL error is tagged with exactly its own rule id", () => {
    for (const site of KNOWN_THROW_SITES) {
      const malformed = { ...SYNTH_PARAM_DEFAULTS, time: 0, ...site.make(SYNTH_PARAM_DEFAULTS) } as Params;
      try {
        fieldSynth.program.validateParams?.(malformed as never);
        expect.unreachable(`expected "${site.id}" trigger to throw`);
      } catch (error) {
        expect((error as { code?: string }).code, site.id).toBe(site.id);
      }
    }
  });

  it("every known validateParams throw site is repaired by the full decode pipeline (coercion + repair table)", () => {
    for (const site of KNOWN_THROW_SITES) {
      const base = { ...SYNTH_PARAM_DEFAULTS, time: 0 } as Params;
      const malformed = site.make(base);
      expect(() => fieldSynth.program.validateParams?.(malformed as never), site.id).toThrow();

      const afterCoercion = { ...malformed, render: sanitizeCarveRenderForSpace(malformed.space, malformed.render as string) };
      const repaired = applySynthValidityGate(afterCoercion as Params);
      expect(() => fieldSynth.program.validateParams?.({ ...repaired, time: 0 } as never), site.id).not.toThrow();
    }
  });
});
