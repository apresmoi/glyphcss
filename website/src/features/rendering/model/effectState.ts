export interface Instrument3DEffectsState {
  /** `"none"` means no effect layer is mounted. */
  readonly effectId: string;
  /** `Instrument3DEffectsFolder.ALL_TARGET_ID` means scene-wide (every targetable mesh); otherwise one target's own `id`. */
  readonly targetId: string;
}

export const INSTRUMENT_3D_EFFECT_NONE = "none";

export const INSTRUMENT_3D_EFFECT_ALL_TARGET = "all";
