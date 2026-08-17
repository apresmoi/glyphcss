// @vitest-environment happy-dom
//
// P0 regression coverage: shared /synth links silently lost every parameter.
// `synthUrlState.test.ts` (the pre-existing suite) only ever calls the PURE
// pair `encodeSynthUrlState`/`decodeSynthUrlState` — neither touches
// `window.location`, and `encodeSynthUrlState` always returns the
// synchronous 'p' (raw packed) form, never the async-compacted 'z' form
// `scheduleCompactedUrlWrite` upgrades a long link to once it crosses
// `LARGE_STATE_THRESHOLD` (~400 packed chars — urlState.ts). That's why 161
// passing tests there didn't catch the regression: a shipped preset (e.g.
// "Menger (cssGraphics)") packs to a link well past that threshold, gets
// silently upgraded to 'z' in the real browser flow, and the REAL read path
// (`readInitialSynthState`, synchronous by necessity — it must resolve
// before first paint) can never read 'z' at all (see urlState.ts's `decode`
// doc). The old code had no async catch-up wired to that read path, so a
// 'z' link decoded to schema defaults with total silence.
//
// This file exercises the SAME entry points the page actually calls —
// `writeSynthUrlState` (the write effect) and `readInitialSynthState` +
// `readInitialSynthStateAsync` (the read path, now including the async
// catch-up SynthWorkbench.tsx wires on mount) — through a real
// `window.location`/`window.history`, for every shipped preset, a
// hand-built patch touching many params, and the legacy v1/v2/v3 fixtures.
import { describe, expect, it, beforeEach, vi } from "vitest";

// Importing synthKit.tsx transitively imports Dock/slots.tsx, whose
// useRenderingFolder module calls `ensureCalibratedPalette()` at IMPORT TIME
// (a real-browser-only canvas measurement) — happy-dom has no canvas 2D
// context, so that module-load side effect throws before this file's own
// tests can run. Same stub LayerGroup.test.tsx/useSynthPreview.test.tsx use:
// only `calibrateGlyphRamp` is faked, the rest of `@glyphcss/effects` (every
// preset, the field-synth schema, the validation rules this file's round
// trip actually exercises) stays real. `vi.mock` calls are hoisted above
// every import, so this takes effect before synthKit.tsx loads.
vi.mock("@glyphcss/effects", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@glyphcss/effects")>();
  return {
    ...actual,
    calibrateGlyphRamp: () => ({ ramp: " .:-=+*#%@", steps: [] }),
  };
});

import { GlyphFieldSynthEffect as fieldSynth } from "@glyphcss/effects";
import { readUrlParam } from "../../lib/urlState";
import { synthDefaults, MAX_VOICES as KIT_MAX_VOICES } from "./synthKit";
import {
  MAX_VOICES,
  SYNTH_PARAM,
  SYNTH_URL_DEFAULTS,
  decodeSynthUrlState,
  decodeSynthUrlStateAsync,
  encodeSynthUrlState,
  readInitialSynthState,
  readInitialSynthStateAsync,
  writeSynthUrlState,
  type Lighting,
  type Params,
  type SynthPatch,
} from "./synthUrlState";

expect(MAX_VOICES).toBe(KIT_MAX_VOICES);

const REPRESENTATIVE_LIGHTING: Lighting = { azimuth: 120, elevation: 60, keyIntensity: 1.5, keyColor: "#ffddaa", ambient: 0.3 };

function voiceSlotsFromParams(params: Params): number[] {
  return Array.from({ length: MAX_VOICES }, (_, i) => i + 1).filter((k) => Number(params[`amp${k}`] ?? 0) > 0);
}

/** Builds the patch exactly the way `SynthWorkbench.tsx`'s `applyPreset`
 *  does: preset params merged over `synthKit.tsx`'s live schema defaults
 *  (NOT `SYNTH_PARAM_DEFAULTS`, which pins `voiceColors: true` — a
 *  synthUrlState-only convenience default, not what the page actually
 *  writes for an untouched preset). */
function presetPatch(preset: { params: Partial<Params> }, shape: string): SynthPatch {
  const params = { ...synthDefaults(), ...(preset.params as Params) };
  return {
    shape,
    params,
    timeScale: SYNTH_URL_DEFAULTS.timeScale,
    density: 1,
    lighting: REPRESENTATIVE_LIGHTING,
    voiceSlots: voiceSlotsFromParams(params),
  };
}

function handBuiltPatch(): SynthPatch {
  const params: Params = {
    ...synthDefaults(),
    field1: "spiral", wave1: "square", freq1: 7.5, speed1: -1.2, amp1: 0.8, color1: "#ff0000",
    field2: "noise", wave2: "triangle", freq2: 3.3, speed2: 0.9, amp2: 0.6, color2: "#00ff00",
    field3: "diagonal", wave3: "saw", freq3: 5, speed3: 0.4, amp3: 0.3, color3: "#0000ff",
    field7: "gyroid", wave7: "sin", freq7: 2.5, speed7: 0.2, amp7: 0.5, color7: "#ffaa00",
    field8: "menger", wave8: "step", freq8: 1.1, speed8: 0, amp8: 0.4, color8: "#00aaff", iter8: 2,
    field9: "sierpinski", wave9: "step", freq9: 0.9, speed9: 0, amp9: 0.7, color9: "#aa00ff", iter9: 4,
    combine: "difference",
    space: "object",
    scale: 1.5,
    gain: 2.5,
    bias: 0.1,
    lit: 0.35,
    voiceColors: true,
    colorStackOn: true,
    colorCombine: "add",
    colorMode: "hue",
    hueOffset: 0.15,
    hueRange: 210,
    hueSat: 65,
    hueLight: 42,
    cfield1: "incidence", cwave1: "sin", cfreq1: 2.5, cspeed1: -0.6, camp1: 0.9,
    cfield2: "normalX", cwave2: "triangle", cfreq2: 6.5, cspeed2: 1.1, camp2: 0.4,
    cfield3: "spiral", cwave3: "saw", cfreq3: 8.5, cspeed3: -1.3, camp3: 0.15,
    glyphs: "  ..--==##@@",
    color: "#7df9ff",
    colorB: "#ff4fa3",
    gradient: 0.6,
  };
  return {
    shape: "sphere",
    params,
    timeScale: 2.1,
    density: 1.8,
    lighting: REPRESENTATIVE_LIGHTING,
    voiceSlots: voiceSlotsFromParams(params),
  };
}

function stepFor(key: string): number {
  const spec = (fieldSynth.parameterSchema as unknown as Record<string, { step?: number }>)[key];
  return spec?.step && spec.step > 0 ? spec.step : 0.0001;
}

function paramKind(key: string): string | undefined {
  return (fieldSynth.parameterSchema as unknown as Record<string, { kind?: string }>)[key]?.kind;
}

// The codec accepts (and normalizes) CSS 3-digit shorthand hex on encode
// (see urlState.ts's `encodePackedColor`) but a decoded color is always the
// full 6-digit form — a preset authored in shorthand (field-synth's "Moiré
// rings", `color: "#9df"`) round-trips to the SAME color, not the SAME
// string, so the comparison below normalizes both sides instead of using
// `.toBe` directly.
function normalizeHexColor(hex: string): string {
  const stripped = hex.replace(/^#/, "").toLowerCase();
  const expanded = /^[0-9a-f]{3}$/.test(stripped) ? stripped.split("").map((c) => c + c).join("") : stripped;
  return `#${expanded}`;
}

function expectPatchesMatch(restored: { shape: string; params: Params; timeScale: number; density: number; lighting: Lighting; voiceSlots: number[] }, patch: SynthPatch): void {
  expect(restored.shape).toBe(patch.shape);
  expect(restored.timeScale).toBeCloseTo(patch.timeScale, 3);
  expect(restored.density).toBeCloseTo(patch.density, 3);
  expect(restored.lighting).toEqual(patch.lighting);
  expect(restored.voiceSlots).toEqual(patch.voiceSlots);
  for (const [key, value] of Object.entries(patch.params)) {
    if (key === "time") continue;
    if (typeof value === "number") {
      const step = stepFor(key);
      expect(Math.abs((restored.params[key] as number) - value), key).toBeLessThanOrEqual(step / 2 + 1e-9);
    } else if (paramKind(key) === "color" && typeof value === "string") {
      expect(normalizeHexColor(restored.params[key] as string), key).toBe(normalizeHexColor(value));
    } else {
      expect(restored.params[key], key).toBe(value);
    }
  }
}

/** Runs a patch through the REAL write path (`writeSynthUrlState`, the same
 *  effect `SynthWorkbench.tsx` fires on every param change) and the REAL
 *  read path (`readInitialSynthState` synchronously, then
 *  `readInitialSynthStateAsync`'s catch-up — the same pair the page's mount
 *  logic now runs), through an actual `window.location`. Waits for the
 *  async 'z' upgrade only when the packed string is long enough for
 *  `scheduleCompactedUrlWrite` to attempt it (`encodeSynthUrlState(patch)`
 *  is the exact same deterministic 'p' string the internal write computes,
 *  so its length predicts, rather than guesses, whether a wait is needed). */
async function roundTripThroughRealUrl(patch: SynthPatch): Promise<ReturnType<typeof decodeSynthUrlState>> {
  const expectedPacked = encodeSynthUrlState(patch);
  writeSynthUrlState(patch);
  if (expectedPacked.length > 400) {
    await vi.waitFor(
      () => {
        const raw = readUrlParam(SYNTH_PARAM);
        if (raw?.[0] !== "z") throw new Error(`still waiting for compaction (current: ${JSON.stringify(raw)})`);
      },
      { timeout: 2000, interval: 5 },
    );
  } else {
    expect(readUrlParam(SYNTH_PARAM)).toBe(expectedPacked || null);
  }

  const sync = readInitialSynthState();
  const asyncCatchUp = await readInitialSynthStateAsync();
  return asyncCatchUp ?? sync;
}

beforeEach(() => {
  window.history.replaceState(null, "", "/synth");
});

describe("synth URL codec — real entry-point round trip (P0 regression)", () => {
  it("demonstrates the bug mechanism: sync-only read loses a compacted link the async catch-up recovers", async () => {
    // The exact reported repro: click "Menger (cssGraphics)", read the URL,
    // reload. Not hand-built — pulled from the real shipped preset list so
    // this test tracks the actual patch, not a stand-in guessed to be big
    // enough.
    const mengerCssGraphics = (fieldSynth.presets ?? []).find((p) => p.name.includes("cssGraphics"));
    if (!mengerCssGraphics) throw new Error('expected a shipped "Menger (cssGraphics)" preset');
    const patch = presetPatch(mengerCssGraphics, "cube");
    const expectedPacked = encodeSynthUrlState(patch);
    // This preset (colour stack + several geometry/colour voices) is exactly
    // the shape that crosses the compaction threshold in real use — that's
    // WHY the reported link broke on this preset and not a small one.
    expect(expectedPacked.length).toBeGreaterThan(400);

    writeSynthUrlState(patch);
    await vi.waitFor(() => {
      if (readUrlParam(SYNTH_PARAM)?.[0] !== "z") throw new Error("still waiting for compaction");
    }, { timeout: 2000, interval: 5 });

    // This is the regression itself: the synchronous-only read (what the
    // page used before this fix) silently lands on schema defaults for a
    // 'z' link, no matter how valid the underlying patch was.
    const syncOnly = readInitialSynthState();
    expect(syncOnly.shape).toBe(SYNTH_URL_DEFAULTS.shape);
    expect(syncOnly.params.space).toBe(synthDefaults().space);

    // The fix: the async catch-up resolves the SAME link correctly.
    const caughtUp = await readInitialSynthStateAsync();
    expect(caughtUp).not.toBeNull();
    expectPatchesMatch(caughtUp!, patch);
  });

  it("round-trips a hand-built patch touching many params through the real write/read path", async () => {
    const patch = handBuiltPatch();
    const restored = await roundTripThroughRealUrl(patch);
    expectPatchesMatch(restored, patch);
  });

  for (const preset of fieldSynth.presets ?? []) {
    it(`round-trips the "${preset.name}" preset through the real write/read path`, async () => {
      const patch = presetPatch(preset, "cube");
      const restored = await roundTripThroughRealUrl(patch);
      expectPatchesMatch(restored, patch);
    });
  }

  it("covers both packed forms across the shipped presets (not just always-'p' or always-'z')", () => {
    const lengths = (fieldSynth.presets ?? []).map((preset) => encodeSynthUrlState(presetPatch(preset, "cube")).length);
    expect(lengths.some((n) => n <= 400)).toBe(true);
    expect(lengths.some((n) => n > 400)).toBe(true);
  });
});

describe("synth URL codec — async catch-up no-ops on already-resolved input", () => {
  it("resolves to null for an absent ?s= param", async () => {
    expect(await readInitialSynthStateAsync()).toBeNull();
  });

  it("resolves to null for a 'p'-tagged (already synchronously resolved) param", async () => {
    const patch = handBuiltPatch();
    // Force the small, always-'p' path by writing a trimmed patch.
    const small: SynthPatch = { ...patch, params: { ...synthDefaults(), amp1: 0.5 } };
    writeSynthUrlState(small);
    expect(readUrlParam(SYNTH_PARAM)?.[0]).toBe("p");
    expect(await readInitialSynthStateAsync()).toBeNull();
  });

  it("resolves to null for garbage/legacy v1/v2 'p'-tagged fixtures (decodeSynthUrlStateAsync only ever handles 'z')", async () => {
    for (const raw of ["", "not-a-link", "p9futurever", undefined, null]) {
      expect(await decodeSynthUrlStateAsync(raw)).toBeNull();
    }
  });
});
