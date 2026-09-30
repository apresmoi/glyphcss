import { GlyphFieldSynthEffect as fieldSynth } from "@glyphcss/effects";
import { readUrlParam, scheduleCompactedUrlWrite } from "../../../services/url-state/history";
import { encodeEffectParamsPacked } from "../../../utils/url-state/codec";
import {
  SYNTH_PARAM,
  SYNTH_PARAM_DEFAULTS,
  type SynthInitialState,
  type SynthPatch,
  type SynthUrlState,
  encodeVoiceSlots,
  synthCodec,
} from "../model/urlState";
import { decodeSynthUrlState, decodeSynthUrlStateAsync } from "./decodeUrlState";

export function readInitialSynthState(): SynthInitialState {
  return decodeSynthUrlState(readUrlParam(SYNTH_PARAM));
}

/** Async catch-up for the CURRENT `?s=` URL param — the page-facing wrapper
 *  around `decodeSynthUrlStateAsync` (which takes `raw` directly so it stays
 *  pure/testable). Call once on mount; a non-null result means the initial
 *  synchronous `readInitialSynthState()` read defaults because the URL held
 *  a compressed link, and the caller should apply this result over that
 *  initial state. */
export async function readInitialSynthStateAsync(): Promise<SynthInitialState | null> {
  return decodeSynthUrlStateAsync(readUrlParam(SYNTH_PARAM));
}

export function writeSynthUrlState(state: SynthPatch): void {
  const paramsPacked = encodeEffectParamsPacked(fieldSynth.parameterSchema, SYNTH_PARAM_DEFAULTS, state.params);
  const full: SynthUrlState = {
    shape: state.shape,
    timeScale: state.timeScale,
    density: state.density,
    voiceSlotMask: encodeVoiceSlots(state.voiceSlots),
    lightAzimuth: state.lighting.azimuth,
    lightElevation: state.lighting.elevation,
    lightKeyIntensity: state.lighting.keyIntensity,
    lightKeyColor: state.lighting.keyColor,
    lightAmbient: state.lighting.ambient,
    colorTolerance: state.colorTolerance,
    colorEncoding: state.colorEncoding,
    paramsPacked,
  };
  scheduleCompactedUrlWrite(synthCodec, SYNTH_PARAM, full);
}
