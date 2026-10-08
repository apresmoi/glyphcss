import { type WordArtUrlState } from "../model/urlState";
import { readInitialWordArtState } from "./wordartUrlState";

// All controls persist to a single packed `?w=` query param — see
// `wordartUrlState.ts` (shared codec: website/src/lib/urlState.ts). Measured
// on a representative state: 419 chars verbose -> 93 chars packed.
export const initialWordArtState = readInitialWordArtState();

export const qs = <K extends keyof WordArtUrlState>(key: K): WordArtUrlState[K] => initialWordArtState[key];
