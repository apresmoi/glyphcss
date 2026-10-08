import { defaultGlyphColorEncoding } from "../../../services/rendering/glyphColorEncodingDefault";
import {
  type Params,
  type SynthInitialState,
  type SynthUrlState,
  applySynthValidityGate,
  decodeOuterState,
  decodeParamsPacked,
  decodeVoiceSlots,
  outerCodecFor,
  paramsSchemaFor,
  sanitizeCarveRenderForSpace,
  SYNTH_PARAM_DEFAULTS,
  SYNTH_URL_DEFAULTS,
} from "../model/urlState";

/** Shared post-processing for BOTH the synchronous ('p') and async ('z')
 *  decode paths below: merge the decoded outer fields over defaults, decode
 *  the nested `paramsPacked` effect patch against the right schema for
 *  `raw`'s version, discard retired keys, coerce carve/xray to the right
 *  space, and run the URL hydration validity gate. `raw` is only consulted
 *  for its version tag (`decodeOuterState`/`paramsSchemaFor` above), never
 *  re-decoded here — callers already resolved `outer` themselves (sync via
 *  `codec.decode`, async via `codec.decodeAsync`). */
function buildSynthInitialState(raw: string | null | undefined, outer: Partial<SynthUrlState>): SynthInitialState {
  const decoded = { ...SYNTH_URL_DEFAULTS, ...outer };
  const overrides = decodeParamsPacked(raw, paramsSchemaFor(raw), decoded.paramsPacked);
  // The retired slab keys only ever appear when `overrides` was decoded
  // against `LEGACY_V2_FIELD_SYNTH_SCHEMA` (a "1"/"2"-tagged link), and
  // `colorQuantize` only when decoded against `LEGACY_V3_FIELD_SYNTH_SCHEMA`
  // (a "3"-tagged link) — discard all four unconditionally rather than
  // branch on which schema was used: none of these features exist anymore,
  // and `SYNTH_PARAM_DEFAULTS` no longer has any of these keys either.
  delete overrides.slabAxis;
  delete overrides.slabStart;
  delete overrides.slabEnd;
  delete overrides.colorQuantize;
  let params = { ...SYNTH_PARAM_DEFAULTS, ...overrides } as Params;
  params.render = sanitizeCarveRenderForSpace(params.space, params.render as string);
  params = applySynthValidityGate(params);
  return {
    shape: decoded.shape,
    params,
    timeScale: decoded.timeScale,
    density: decoded.density,
    colorTolerance: decoded.colorTolerance,
    // Feature-detected site default, applied only when the LINK carries no
    // choice. `SYNTH_URL_DEFAULTS.colorEncoding` deliberately stays "spans":
    // it is the codec's omission sentinel, and a browser-dependent sentinel
    // would make the same patch encode differently on different engines, so a
    // link shared from a supporting browser would decode to the wrong value on
    // one that isn't. Reading `outer` (the decoded partial) instead of the
    // merged object is what keeps an explicit `?e=…E…` value winning.
    colorEncoding: outer.colorEncoding ?? defaultGlyphColorEncoding(),
    lighting: {
      azimuth: decoded.lightAzimuth,
      elevation: decoded.lightElevation,
      keyIntensity: decoded.lightKeyIntensity,
      keyColor: decoded.lightKeyColor,
      ambient: decoded.lightAmbient,
    },
    voiceSlots: decodeVoiceSlots(decoded.voiceSlotMask),
  };
}

/** Pure decode: packed `?s=` value -> patch (defaults for absent/garbage).
 *  Synchronous, so it can only ever read the 'p' (raw packed) format — a
 *  'z' (deflated) link decodes to defaults here (see urlState.ts's `decode`
 *  doc, which now warns when this happens) and needs `decodeSynthUrlStateAsync`
 *  to actually resolve. */
export function decodeSynthUrlState(raw: string | null | undefined): SynthInitialState {
  return buildSynthInitialState(raw, decodeOuterState(raw));
}

/** Async catch-up for a 'z'-tagged (deflated) `?s=` link that
 *  `decodeSynthUrlState`/`readInitialSynthState` cannot read synchronously
 *  (decompression is inherently async — see urlState.ts's format doc). This
 *  is the fix for the P0 where a shared link past the compaction threshold
 *  (~400 packed chars — routine once a preset touches many voices/colour-
 *  stack keys, e.g. "Menger (cssGraphics)") silently loaded as schema
 *  defaults with no signal at all: the synchronous read alone can NEVER
 *  resolve a 'z' link, no matter how the rest of the pipeline is fixed.
 *
 *  Returns `null` for an absent or already-'p'-tagged param (nothing to
 *  catch up on — the synchronous read already fully resolved it) so call
 *  sites can tell "nothing to do" apart from "resolved, and it's a genuine
 *  no-op patch". Warns to the console (via `codec.decodeAsync`) when a
 *  present 'z' param fails to decode — garbage, truncated, an unsupported
 *  version, or a browser with no DecompressionStream support — instead of
 *  resolving to defaults with no trace. */
export async function decodeSynthUrlStateAsync(raw: string | null | undefined): Promise<SynthInitialState | null> {
  if (!raw || raw[0] !== "z") return null;
  const outer = await outerCodecFor(raw).decodeAsync(raw);
  return buildSynthInitialState(raw, outer);
}
