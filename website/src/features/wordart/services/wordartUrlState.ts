import { defaultGlyphColorEncoding } from "../../../services/rendering/glyphColorEncodingDefault";
import { readUrlParam, scheduleCompactedUrlWrite } from "../../../services/url-state/history";
import { encodeEffectParamsPacked } from "../../../utils/url-state/codec";
import { galleryEffectDefaultParams, galleryEffectDefinition } from "../../gallery/model/effects";
import type { GalleryEffectState } from "../../gallery/model/types";
import {
  type WordArtUrlState,
  decodeWordArtOuter,
  WORD_ART_DEFAULTS,
  WORD_ART_PARAM,
  wordArtCodec,
} from "../model/urlState";

/** Read the initial state from the URL (defaults for anything absent/garbage
 *  — `decode` never throws, see urlState.ts). */
export function readInitialWordArtState(): WordArtUrlState {
  const decoded = decodeWordArtOuter(readUrlParam(WORD_ART_PARAM));
  return {
    ...WORD_ART_DEFAULTS,
    // See `synthUrlState.ts` for why the codec's own default stays "spans"
    // while the hydrated default is feature-detected: a browser-dependent
    // omission sentinel would make shared links decode differently per engine.
    colorEncoding: decoded.colorEncoding ?? defaultGlyphColorEncoding(),
    ...decoded,
  };
}

/** Pack every control (non-defaults only) into the single `?w=` param.
 *  `effectState` is folded in here (not a second query key) so it can't race
 *  the rest of the page's controls for the last write. */
export function writeWordArtUrlState(state: WordArtUrlState, effectState: GalleryEffectState): void {
  const definition = effectState.effectId ? galleryEffectDefinition(effectState.effectId) : null;
  const full: WordArtUrlState = {
    ...state,
    effectId: definition ? definition.id : "",
    effectBlend: definition ? effectState.blend : "replace",
    effectPaused: definition ? effectState.paused : false,
    effectTimeScale: definition ? effectState.timeScale : 1,
    effectParams: definition
      ? encodeEffectParamsPacked(definition.parameterSchema, galleryEffectDefaultParams(definition), effectState.params)
      : "",
  };
  scheduleCompactedUrlWrite(wordArtCodec, WORD_ART_PARAM, full);
}
