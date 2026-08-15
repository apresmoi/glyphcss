import { describe, expect, it } from "vitest";
import {
  MAX_VOICES,
  SYNTH_PARAM_DEFAULTS,
  SYNTH_URL_DEFAULTS,
  decodeSynthUrlState,
  encodeSynthUrlState,
  synthCodec,
  type Lighting,
  type Params,
} from "./synthUrlState";

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
    expect(packed).toBe("p2");
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

  it("supports up to MAX_VOICES distinct slots in the bitmask", () => {
    const patch = { ...representativePatch(), voiceSlots: [1, 2, 3, 4, 5, 6] };
    expect(patch.voiceSlots.length).toBe(MAX_VOICES);
    expect(decodeSynthUrlState(encodeSynthUrlState(patch)).voiceSlots).toEqual([1, 2, 3, 4, 5, 6]);
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
