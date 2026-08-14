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
    expect(packed).toBe("p1");
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
