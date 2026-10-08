import type { GlyphEffectId } from "@glyphcss/effects";
import { readUrlParam } from "../../../services/url-state/history";
import { decodeEffectParamsPacked, decodeEffectParamsPackedLegacy } from "../../../utils/url-state/codec";
import {
  DEFAULT_GALLERY_EFFECT_STATE,
  galleryEffectDefaultParams,
  galleryEffectDefinition,
  sanitizeGalleryEffectParams,
} from "../../gallery/model/effects";
import type { GalleryEffectParamValue, GalleryEffectState } from "../../gallery/model/types";
import { type WordArtUrlState, WORD_ART_PARAM } from "../model/urlState";

/** Restore the Effects folder's selection (mirrors the gallery's `fx` shape,
 *  folded into this page's single packed param instead of a second key).
 *  Re-reads the raw `?w=` param (cheap, same page load `readInitialWordArtState`
 *  already read it on) purely to resolve which `effectParams` wire format a
 *  "1"-tagged link used — everything else about `state` is already correctly
 *  decoded by the OUTER dispatch above. */
export function wordArtEffectStateFromUrlState(state: WordArtUrlState): GalleryEffectState {
  if (!state.effectId) return DEFAULT_GALLERY_EFFECT_STATE;
  const definition = galleryEffectDefinition(state.effectId as GlyphEffectId);
  if (!definition) return DEFAULT_GALLERY_EFFECT_STATE;
  const defaults = galleryEffectDefaultParams(definition);
  const raw = readUrlParam(WORD_ART_PARAM);
  const decodeParams = raw && raw[1] === "1" ? decodeEffectParamsPackedLegacy : decodeEffectParamsPacked;
  const overrides = decodeParams(definition.parameterSchema, state.effectParams) as Record<
    string,
    GalleryEffectParamValue
  >;
  return {
    effectId: definition.id,
    effectVersion: definition.version,
    blend: state.effectBlend,
    paused: state.effectPaused,
    timeScale: state.effectTimeScale,
    params: sanitizeGalleryEffectParams(definition, { ...defaults, ...overrides }),
  };
}
